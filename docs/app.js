const app = document.getElementById("app");
const searchInput = document.getElementById("search");

let episodes = [];
let byId = new Map();
let series = [];

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const normalize = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

const formatDuration = (s) => (s ? `${Math.round(s / 60)} min` : "");

const plural = (n, singular, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

const thumb = (src, preset = "200x200") => (src ? `${src}/${preset}` : "");

// Same deep link as the "Ouvrir dans l'App" button on radiofrance.fr (iOS and Android apps)
const isMobile = /android|iPad|iPhone|iPod/i.test(navigator.userAgent);
const appUrl = (id) => `radiofrance://radiofrance.fr/layout?id=${encodeURIComponent(id)}`;

function buildSeries() {
  const map = new Map();
  for (const e of episodes) {
    if (!e.serie_id) continue;
    if (!map.has(e.serie_id)) {
      map.set(e.serie_id, { id: e.serie_id, title: e.serie_title, url: e.serie_url, episodes: [] });
    }
    map.get(e.serie_id).episodes.push(e);
  }
  for (const s of map.values()) {
    s.episodes.sort((a, b) => (a.serie_episode ?? 0) - (b.serie_episode ?? 0) || (a.date || "").localeCompare(b.date || ""));
    s.date = s.episodes.map((e) => e.date || "").sort().at(-1);
    s.image = s.episodes.find((e) => e.image)?.image;
  }
  return [...map.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function episodeCard(e) {
  const position = e.serie_episode ? `<span class="badge">${e.serie_episode}/${e.serie_episode_count ?? "?"}</span>` : "";
  return `
    <a class="card episode" href="#/episode/${e.id}">
      ${e.image ? `<img loading="lazy" src="${thumb(e.image)}" alt="">` : `<div class="noimg"></div>`}
      <div>
        <h3>${position}${escapeHtml(e.title)}</h3>
        <p class="muted">${formatDate(e.date)} · ${formatDuration(e.duration)}${e.serie_title ? ` · ${escapeHtml(e.serie_title)}` : ""}</p>
        ${e.summary ? `<p class="summary">${escapeHtml(e.summary)}</p>` : ""}
      </div>
    </a>`;
}

function renderSeriesList() {
  app.innerHTML = `
    <h2>${plural(series.length, "série")}</h2>
    <div class="grid">
      ${series
        .map(
          (s) => `
        <a class="card serie" href="#/serie/${s.id}">
          ${s.image ? `<img loading="lazy" src="${thumb(s.image, "300x169")}" alt="">` : `<div class="noimg"></div>`}
          <h3>${escapeHtml(s.title)}</h3>
          <p class="muted">${plural(s.episodes.length, "épisode")} · ${formatDate(s.date)}</p>
        </a>`
        )
        .join("")}
    </div>`;
}

function renderSerie(id) {
  const s = series.find((s) => s.id === id);
  if (!s) return renderNotFound();
  app.innerHTML = `
    <p><a href="#/">← Toutes les séries</a></p>
    <h2>${escapeHtml(s.title)}</h2>
    <p class="muted">${plural(s.episodes.length, "épisode")}${s.url ? ` · <a href="${s.url}" target="_blank" rel="noopener">Voir sur Radio France</a>` : ""}</p>
    <div class="list">${s.episodes.map(episodeCard).join("")}</div>`;
}

function renderEpisodeList(list, heading) {
  app.innerHTML = `
    <h2>${heading}</h2>
    <div class="list">${list.map(episodeCard).join("") || `<p class="muted">Aucun épisode trouvé.</p>`}</div>`;
}

let shuffleRank = new Map();

function reshuffle() {
  const ids = episodes.map((e) => e.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  shuffleRank = new Map(ids.map((id, i) => [id, i]));
}

function renderAllEpisodes(params) {
  const themeCounts = new Map();
  for (const e of episodes) for (const t of e.themes) themeCounts.set(t, (themeCounts.get(t) || 0) + 1);
  const themes = [...themeCounts.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  const dates = episodes.map((e) => e.date).filter(Boolean).sort();
  const [minDate, maxDate] = [dates[0] || "", dates.at(-1) || ""];

  app.innerHTML = `
    <div class="filters">
      <div class="field">
        <span>Thèmes</span>
        <details id="theme-picker">
          <summary id="theme-summary"></summary>
          <div class="theme-panel">
            <input id="theme-search" type="search" placeholder="Filtrer les thèmes…" autocomplete="off">
            <div id="theme-options">
              ${themes
                .map(
                  (t) => `
                <label class="theme-option" data-search="${escapeHtml(normalize(t))}">
                  <input type="checkbox" value="${escapeHtml(t)}">
                  <span>${escapeHtml(t)}</span>
                  <span class="muted">${themeCounts.get(t)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>
        </details>
      </div>
      <label>Du
        <input id="from" type="date" min="${minDate}" max="${maxDate}">
      </label>
      <label>Au
        <input id="to" type="date" min="${minDate}" max="${maxDate}">
      </label>
      <label>Ordre
        <select id="sort">
          <option value="desc">Plus récents d’abord</option>
          <option value="asc">Plus anciens d’abord</option>
          <option value="aleatoire">Aléatoire</option>
        </select>
      </label>
      <button id="reshuffle" type="button">Remélanger</button>
    </div>
    <div class="chips" id="theme-chips"></div>
    <h2 id="count"></h2>
    <div class="list" id="episode-list"></div>`;

  const themeSummary = document.getElementById("theme-summary");
  const themeSearch = document.getElementById("theme-search");
  const themeCheckboxes = [...document.querySelectorAll("#theme-options input")];
  const chips = document.getElementById("theme-chips");
  const sortSelect = document.getElementById("sort");
  const reshuffleButton = document.getElementById("reshuffle");
  const fromInput = document.getElementById("from");
  const toInput = document.getElementById("to");
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

  const initialThemes = new Set(params.getAll("theme"));
  for (const cb of themeCheckboxes) cb.checked = initialThemes.has(cb.value);
  sortSelect.value = ["asc", "aleatoire"].includes(params.get("tri")) ? params.get("tri") : "desc";
  fromInput.value = isDate(params.get("du")) ? params.get("du") : "";
  toInput.value = isDate(params.get("au")) ? params.get("au") : "";

  const update = () => {
    const selected = themeCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    const sort = sortSelect.value;
    const from = fromInput.value;
    const to = toInput.value;
    if (sort === "aleatoire" && shuffleRank.size !== episodes.length) reshuffle();
    reshuffleButton.hidden = sort !== "aleatoire";
    themeSummary.textContent = selected.length
      ? plural(selected.length, "thème sélectionné", "thèmes sélectionnés")
      : "Tous les thèmes";
    chips.innerHTML = selected.length
      ? selected.map((t) => `<button type="button" class="chip" data-theme="${escapeHtml(t)}">${escapeHtml(t)} ×</button>`).join("") +
        `<button type="button" class="chip clear" data-theme="">Effacer</button>`
      : "";

    const matchesThemes = (e) => !selected.length || selected.some((t) => e.themes.includes(t));
    const list = episodes.filter(
      (e) => matchesThemes(e) && (!from || (e.date && e.date >= from)) && (!to || (e.date && e.date <= to))
    );
    if (sort === "aleatoire") list.sort((a, b) => shuffleRank.get(a.id) - shuffleRank.get(b.id));
    else list.sort((a, b) => (sort === "asc" ? 1 : -1) * (a.date || "").localeCompare(b.date || ""));

    document.getElementById("count").textContent = plural(list.length, "épisode");
    document.getElementById("episode-list").innerHTML =
      list.map(episodeCard).join("") || `<p class="muted">Aucun épisode trouvé.</p>`;

    const query = new URLSearchParams();
    for (const t of selected) query.append("theme", t);
    if (from) query.set("du", from);
    if (to) query.set("au", to);
    if (sort !== "desc") query.set("tri", sort);
    history.replaceState(null, "", `#/episodes${query.size ? `?${query}` : ""}`);
  };

  for (const el of [...themeCheckboxes, sortSelect, fromInput, toInput]) el.addEventListener("change", update);
  themeSearch.addEventListener("input", () => {
    const q = normalize(themeSearch.value.trim());
    for (const option of document.querySelectorAll(".theme-option")) option.hidden = !option.dataset.search.includes(q);
  });
  chips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    for (const cb of themeCheckboxes) if (!chip.dataset.theme || cb.value === chip.dataset.theme) cb.checked = false;
    update();
  });
  reshuffleButton.addEventListener("click", () => {
    reshuffle();
    update();
  });
  update();
}

function renderEpisode(id) {
  const e = byId.get(id);
  if (!e) return renderNotFound();
  app.innerHTML = `
    <article class="detail">
      ${e.image ? `<img src="${thumb(e.image, "560x315")}" alt="">` : ""}
      <h2>${escapeHtml(e.title)}</h2>
      <p class="muted">${formatDate(e.date)} · ${formatDuration(e.duration)}</p>
      ${
        e.serie_id
          ? `<p>Série : <a href="#/serie/${e.serie_id}">${escapeHtml(e.serie_title)}</a>${e.serie_episode ? ` (épisode ${e.serie_episode}/${e.serie_episode_count ?? "?"})` : ""}</p>`
          : ""
      }
      ${e.summary ? `<p>${escapeHtml(e.summary)}</p>` : ""}
      ${e.guests.length ? `<p><strong>Invités :</strong> ${e.guests.map(escapeHtml).join(", ")}</p>` : ""}
      ${
        e.themes.length
          ? `<p class="tags">${e.themes
              .map((t) => `<a href="#/episodes?${new URLSearchParams({ theme: t })}">${escapeHtml(t)}</a>`)
              .join("")}</p>`
          : ""
      }
      ${e.audio ? `<audio controls preload="none" src="${e.audio}"></audio>` : ""}
      <p class="links">
        ${isMobile ? `<a class="app-link" href="${appUrl(e.id)}" data-fallback="${e.url || ""}">Ouvrir dans l’application Radio France</a>` : ""}
        ${e.url ? `<a href="${e.url}" target="_blank" rel="noopener">Voir sur Radio France</a>` : ""}
      </p>
    </article>`;
}

function renderSearch(query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const results = episodes.filter((e) => {
    const text = e._search;
    return terms.every((t) => text.includes(t));
  });
  renderEpisodeList(results, `${plural(results.length, "résultat")} pour « ${escapeHtml(query)} »`);
}

function renderNotFound() {
  app.innerHTML = `<p>Page introuvable. <a href="#/">Retour aux séries</a></p>`;
}

function route() {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const hash = decodeURIComponent(path) || "/";
  const [, view, arg] = hash.split("/");
  if (view !== "recherche") searchInput.value = "";
  if (!view) renderSeriesList();
  else if (view === "serie") renderSerie(arg);
  else if (view === "episode") renderEpisode(arg);
  else if (view === "episodes") renderAllEpisodes(new URLSearchParams(query));
  else if (view === "recherche") renderSearch(hash.slice("/recherche/".length));
  else renderNotFound();
  window.scrollTo(0, 0);
}

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchInput.value.trim();
    const target = q ? `#/recherche/${encodeURIComponent(q)}` : "#/";
    // Replace rather than push so each keystroke doesn't add a history entry
    if (location.hash.startsWith("#/recherche/")) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
    route();
  }, 200);
});

document.getElementById("random").addEventListener("click", () => {
  const e = episodes[Math.floor(Math.random() * episodes.length)];
  location.hash = `#/episode/${e.id}`;
});

window.addEventListener("hashchange", route);

// If the app isn't installed the page stays visible, so open the web page instead
let appFallbackTimer;
document.addEventListener("click", (event) => {
  const link = event.target.closest(".app-link");
  if (!link?.dataset.fallback) return;
  clearTimeout(appFallbackTimer);
  appFallbackTimer = setTimeout(() => (location.href = link.dataset.fallback), 2500);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") clearTimeout(appFallbackTimer);
});

document.addEventListener("click", (event) => {
  const picker = document.getElementById("theme-picker");
  if (picker?.open && !picker.contains(event.target)) picker.open = false;
});

fetch("episodes.json")
  .then((r) => r.json())
  .then((data) => {
    episodes = data;
    for (const e of episodes) e._search = normalize(`${e.title} ${e.summary || ""}`);
    byId = new Map(episodes.map((e) => [e.id, e]));
    series = buildSeries();
    route();
  })
  .catch((err) => {
    app.innerHTML = `<p>Impossible de charger les épisodes : ${escapeHtml(err.message)}</p>`;
  });
