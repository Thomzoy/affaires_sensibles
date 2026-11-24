"""Build docs/episodes.json for the static site from the scraped data."""

import json
from pathlib import Path

DATA_DIR = Path("data")
SITE_DIR = Path("docs")


def load_details() -> dict:
    details = {}
    cache_file = DATA_DIR / "details_cache.jsonl"
    if cache_file.exists():
        with cache_file.open() as f:
            for line in f:
                row = json.loads(line)
                details[row["id"]] = row["detail"]
    return details


def main():
    episodes = json.loads((DATA_DIR / "episodes.json").read_text())
    details = load_details()

    # One entry per episode, dated by its first broadcast
    by_id = {}
    for e in episodes:
        prev = by_id.get(e["id"])
        if prev is None or (e["start_date"] or "") < (prev["start_date"] or ""):
            by_id[e["id"]] = e

    site_episodes = []
    for e in by_id.values():
        d = details.get(e["id"], {})
        site_episodes.append({
            "id": e["id"],
            "title": e["title"],
            "url": e["url"],
            "date": (e["start_date"] or "")[:10] or None,
            "duration": e["duration_s"],
            "image": e["image_url"],
            "summary": d.get("summary"),
            "audio": d.get("audio_url"),
            "guests": d.get("guests") or [],
            "themes": d.get("themes") or [],
            "serie_id": d.get("serie_id"),
            "serie_title": d.get("serie_title"),
            "serie_url": d.get("serie_url"),
            "serie_episode": d.get("serie_episode"),
            "serie_episode_count": d.get("serie_episode_count"),
        })
    site_episodes.sort(key=lambda e: e["date"] or "", reverse=True)

    SITE_DIR.mkdir(exist_ok=True)
    out = SITE_DIR / "episodes.json"
    out.write_text(json.dumps(site_episodes, ensure_ascii=False, separators=(",", ":")))
    n_series = len({e["serie_id"] for e in site_episodes if e["serie_id"]})
    n_details = sum(1 for e in site_episodes if e["id"] in details)
    print(f"Wrote {len(site_episodes)} episodes ({n_details} with details, {n_series} series) to {out}")


if __name__ == "__main__":
    main()
