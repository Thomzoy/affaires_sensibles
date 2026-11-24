import argparse
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

BASE_URL = "https://www.radiofrance.fr"
PODCAST_PATH = "/franceinter/podcasts/affaires-sensibles"
OUTPUT_DIR = Path("data")

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0"


def decode_devalue(values: list):
    """Rebuild the object graph from SvelteKit's flattened "devalue" format."""
    memo = {}

    def hydrate(i: int):
        if i < 0:
            return None
        if i in memo:
            return memo[i]
        v = values[i]
        if isinstance(v, dict):
            obj = memo[i] = {}
            obj.update({k: hydrate(x) for k, x in v.items()})
            return obj
        if isinstance(v, list):
            # Typed values such as ["Date", "..."] start with a type name
            if v and isinstance(v[0], str):
                return v
            arr = memo[i] = []
            arr.extend(hydrate(x) for x in v)
            return arr
        return v

    return hydrate(0)


def fetch_page_data(path: str, params: dict | None = None, retries: int = 3) -> dict:
    """Return the decoded `data` node that holds the page `content`."""
    url = f"{BASE_URL}{path}/__data.json"
    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            break
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
    payload = resp.json()
    if payload.get("type") == "redirect":
        location = payload["location"].split("?")[0]
        if location.rstrip("/") == path.rstrip("/") and not params:
            raise ValueError(f"Redirect loop on {resp.url}")
        return fetch_page_data(location, retries=retries)
    for node in payload["nodes"]:
        if node and node.get("type") == "data":
            data = decode_devalue(node["data"])
            if isinstance(data, dict) and "content" in data:
                return data
    raise ValueError(f"No content node in {resp.url}")


def to_iso(ts: int | None) -> str | None:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None


def parse_list_item(item: dict) -> dict:
    title_props = item.get("titleProps") or {}
    visual = item.get("visual") or {}
    href = title_props.get("href") or ""
    return {
        "id": item.get("id"),
        "title": (title_props.get("title") or "").strip(),
        "url": f"{BASE_URL}{href}" if href else None,
        "path": href or None,
        "published_date": item.get("publishedDate"),
        "start_date": to_iso(item.get("startDate")),
        "end_date": to_iso(item.get("endDate")),
        "duration_s": item.get("duration"),
        "is_expired": item.get("isExpired"),
        "is_timeshiftable": item.get("isTimeshiftable"),
        "image_url": visual.get("src"),
        "image_legend": visual.get("legend"),
        "image_copyright": visual.get("copyright"),
    }


def fetch_list_items(page: int) -> tuple[dict, list[dict]]:
    data = fetch_page_data(PODCAST_PATH, {"p": page} if page > 1 else None)
    expressions = data["content"].get("expressions") or {}
    return data["content"], expressions.get("items") or []


def fetch_episode_list(delay: float) -> list[dict]:
    content, items = fetch_list_items(1)
    total = content["expressionCount"]
    page_size = len(items)
    last_page = math.ceil(total / page_size)
    print(f"{total} episodes, {page_size} per page -> {last_page} pages")

    # Rebroadcasts reuse the episode id, so a list entry is identified by (id, start date)
    key = lambda e: (e["id"], e["start_date"])
    episodes = [parse_list_item(it) for it in items]
    seen = {key(e) for e in episodes}
    for page in range(2, last_page + 1):
        time.sleep(delay)
        _, items = fetch_list_items(page)
        new = [e for e in map(parse_list_item, items) if key(e) not in seen]
        # Past the last page the server redirects to page 1, i.e. only known entries
        if not new:
            print(f"Page {page} returned no new episodes, stopping")
            break
        seen.update(map(key, new))
        episodes.extend(new)
        print(f"Page {page}/{last_page}: {len(episodes)} episodes")

    if len(episodes) != total:
        print(f"Warning: expected {total} episodes, got {len(episodes)}")

    first_broadcast = {}
    for e in episodes:
        if e["start_date"] and (e["id"] not in first_broadcast or e["start_date"] < first_broadcast[e["id"]]):
            first_broadcast[e["id"]] = e["start_date"]
    for e in episodes:
        e["is_rebroadcast"] = e["start_date"] != first_broadcast.get(e["id"], e["start_date"])
    print(f"{len(first_broadcast)} unique episodes, {sum(e['is_rebroadcast'] for e in episodes)} rebroadcasts")
    return episodes


def parse_episode_detail(content: dict) -> dict:
    manifestation = content.get("manifestation") or {}
    names = lambda people: [p.get("name") or (p.get("titleProps") or {}).get("title") for p in people or []]
    serie = (content.get("series") or [{}])[0]
    serie_href = serie.get("href")
    # The position in the series only appears in the SEO title: "...: épisode 1/6 du podcast ..."
    position = re.search(r"épisode (\d+)/(\d+)", (content.get("seo") or {}).get("title") or "")
    return {
        "serie_id": serie.get("id"),
        "serie_title": serie.get("title"),
        "serie_url": f"{BASE_URL}{serie_href}" if serie_href else None,
        "serie_episode": int(position[1]) if position else None,
        "serie_episode_count": int(position[2]) if position else None,
        "summary": (content.get("chapo") or "").strip() or None,
        "audio_url": manifestation.get("url"),
        "producers": names(content.get("producers")),
        "guests": names(content.get("guest")),
        "guest_roles": [(g.get("titleProps") or {}).get("text") for g in content.get("guest") or []],
        "themes": [t.get("title") for t in content.get("themes") or []],
    }


def fetch_episode_details(episodes: list[dict], cache_file: Path, delay: float):
    """Fetch each episode page; results are cached so interrupted runs can resume."""
    cache = {}
    if cache_file.exists():
        with cache_file.open() as f:
            for line in f:
                row = json.loads(line)
                cache[row["id"]] = row["detail"]

    todo = list({e["id"]: e for e in episodes if e["path"] and e["id"] not in cache}.values())
    print(f"Episode details: {len(cache)} cached, {len(todo)} to fetch")
    with cache_file.open("a") as f:
        for i, ep in enumerate(todo, 1):
            try:
                detail = parse_episode_detail(fetch_page_data(ep["path"])["content"])
            except (requests.RequestException, ValueError) as exc:
                print(f"  [{i}/{len(todo)}] failed {ep['path']}: {exc}")
                continue
            cache[ep["id"]] = detail
            f.write(json.dumps({"id": ep["id"], "detail": detail}, ensure_ascii=False) + "\n")
            f.flush()
            if i % 50 == 0:
                print(f"  [{i}/{len(todo)}]")
            time.sleep(delay)

    for ep in episodes:
        ep.update(cache.get(ep["id"], {}))


def main():
    parser = argparse.ArgumentParser(description="Fetch Affaires Sensibles episode metadata")
    parser.add_argument("--details", action="store_true", help="also fetch each episode page (summary, audio URL, guests, themes)")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between requests")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(exist_ok=True)
    episodes = fetch_episode_list(args.delay)

    if args.details:
        fetch_episode_details(episodes, OUTPUT_DIR / "details_cache.jsonl", args.delay)

    json_path = OUTPUT_DIR / "episodes.json"
    json_path.write_text(json.dumps(episodes, ensure_ascii=False, indent=2))
    csv_path = OUTPUT_DIR / "episodes.csv"
    pd.DataFrame(episodes).to_csv(csv_path, index=False)
    print(f"Saved {len(episodes)} episodes to {json_path} and {csv_path}")


if __name__ == "__main__":
    main()
