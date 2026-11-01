/* forja web — CodeCrafters-shaped catalog.
   Local:  python3 codecraft/serve.py  →  /api/state + live /api/events
   Static: alektebel.github.io/forja   →  state.json (baked by scripts/forja_site.py)
*/

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = new Intl.NumberFormat("en");
const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 1, style: "percent" });
const fmtPct = (f) => pct.format(f || 0);

const STATE_LABEL = {
  complete: "complete", doing: "in progress", ready: "not started",
  author: "to author", salvage: "port from a branch", legacy: "no checker yet",
  missing: "not in this repo",
};

let STATE = null;
let SELECTED = null; // { kind: "challenge"|"node", id }
let LIVE = false;    // true when talking to a local serve.py

/** Directory of this page — works for `/`, `/forja/`, `/forja/index.html`. */
function basePath() {
  const explicit = document.documentElement.dataset.base;
  if (explicit) return explicit.endsWith("/") ? explicit : `${explicit}/`;
  const path = location.pathname;
  if (path.endsWith("/")) return path;
  if (path.split("/").pop().includes(".")) {
    return path.slice(0, path.lastIndexOf("/") + 1) || "./";
  }
  return `${path}/`;
}

function asset(url) {
  if (!url) return url;
  if (/^(https?:|data:)/i.test(url)) return url;
  if (url.startsWith("/")) {
    // Absolute-from-root paths break under /forja/ on Pages — rewrite.
    return basePath() + url.replace(/^\/+/, "");
  }
  return basePath() + url.replace(/^\.\//, "");
}

async function loadState() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) {
      LIVE = true;
      return res.json();
    }
  } catch {
    /* static host — fall through */
  }
  const res = await fetch(asset("state.json"), { cache: "no-store" });
  if (!res.ok) throw new Error(`state.json HTTP ${res.status}`);
  LIVE = false;
  return res.json();
}

/* ---------------------------------------------------------------- theme */
function effectiveTheme() {
  const saved = localStorage.getItem("codecraft-theme");
  if (saved === "dark" || saved === "light") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#090A0C" : "#f4f5f6");
  const glyph = $("#theme-glyph");
  if (glyph) glyph.textContent = theme === "dark" ? "☾" : "☀";
  const btn = $("#theme");
  if (btn) {
    const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
}
$("#theme").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  localStorage.setItem("codecraft-theme", next);
  applyTheme(next);
});
function initialTheme() {
  const wanted = new URLSearchParams(location.search).get("theme");
  if (wanted === "dark" || wanted === "light") return wanted;
  // Catalog defaults to dark — the CodeCrafters marketing surface feel.
  const saved = localStorage.getItem("codecraft-theme");
  return saved || "dark";
}
applyTheme(initialTheme());

/* ---------------------------------------------------------------- copy */
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".copy, .ghost-action[data-copy]");
  if (!btn || !btn.dataset.copy) return;
  const target = $(btn.dataset.copy);
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.textContent.trim());
    const status = btn.parentElement.querySelector(".copied");
    if (status) {
      status.textContent = "copied";
      setTimeout(() => { status.textContent = ""; }, 1600);
    }
  } catch {
    const status = btn.parentElement.querySelector(".copied");
    if (status) status.textContent = "press ⌘/Ctrl-C";
  }
});

/* --------------------------------------------------------------- render */
function renderTotals(t) {
  const cells = [
    ["Complete", `${fmt.format(t.complete)}/${fmt.format(t.courses)}`],
    ["In progress", fmt.format(t.doing)],
    ["Checks", `${fmt.format(t.checks_passed)}/${fmt.format(t.checks_total)}`],
    ["Written", fmtPct(t.repo_fraction)],
  ];
  $("#totals").innerHTML = cells.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
}

function renderNext(next) {
  const card = $("#next");
  if (!next) { card.hidden = true; return; }
  card.hidden = false;
  $("#next-h").textContent = next.headline || next.title || `${next.id} · ${next.label || ""}`;
  $("#next-stage").textContent = `Stage ${next.stage}`;
  $("#next-file").textContent = next.file || "";
  $("#next-what").textContent = next.action || next.stage_title || "";
  $("#next-cmd").textContent = next.command;
}

function challengeEl(row) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "challenge";
  btn.dataset.slug = row.slug;
  btn.dataset.state = row.state || "ready";
  btn.setAttribute("role", "listitem");
  const checks = row.checks || {};
  const stageLabel = checks.total
    ? `${fmt.format(checks.passed)}/${fmt.format(checks.total)} stages`
    : `${fmt.format(row.stages)} stages`;
  const stateLabel = STATE_LABEL[row.state] || "";
  btn.setAttribute("aria-label",
    `${row.headline}: ${stateLabel}${checks.total ? `, ${checks.passed} of ${checks.total} passing` : ""}`);
  btn.innerHTML = `
    <span class="challenge-logo" aria-hidden="true">
      <img src="${asset(row.logo_url)}" alt="" width="56" height="56">
    </span>
    <span class="challenge-title">${row.headline}</span>
    <span class="challenge-blurb">${row.blurb}</span>
    <span class="challenge-foot">
      <span class="challenge-stages">${stageLabel}</span>
      <span class="challenge-state">${stateLabel}</span>
    </span>`;
  return btn;
}

function renderCatalog(track) {
  const root = $("#catalog");
  root.innerHTML = "";
  for (const row of track) root.appendChild(challengeEl(row));
}

function repoChip(repo) {
  if (!repo || !repo.baseline) return "";
  const label = repo.remaining === 0
    ? "all markers written"
    : `${fmt.format(repo.remaining)} markers left`;
  return `<span class="chip" title="stub markers still standing in the templates">${label}</span>`;
}

function nodeEl(item) {
  const a = document.createElement("a");
  a.className = "node";
  a.href = `?node=${encodeURIComponent(item.id)}`;
  a.dataset.id = item.id;
  a.dataset.state = item.state;
  const checks = item.checks || {};
  const bar = checks.total
    ? `<div class="bar" aria-hidden="true"><div class="bar-fill" style="transform:scaleX(${checks.fraction.toFixed(4)})"></div></div>
       <span class="node-stage">${fmt.format(checks.passed)}/${fmt.format(checks.total)} checks</span>`
    : `<span class="node-stage">${STATE_LABEL[item.state]}</span>`;
  const prereq = (item.prereq || []).map((p) => `<span class="chip">after ${p}</span>`).join("");
  a.setAttribute("aria-label",
    `${item.id} ${item.title}: ${STATE_LABEL[item.state]}` +
    (checks.total ? `, ${checks.passed} of ${checks.total} checks passing` : ""));
  const logo = item.logo_url
    ? `<img class="node-logo" src="${asset(item.logo_url)}" alt="" width="36" height="36">`
    : "";
  a.innerHTML = `
    <span class="node-top">${logo}<span class="node-id">${item.id}</span>
      <span class="node-sym" aria-hidden="true">${item.symbol}</span></span>
    <span class="node-title">${item.title}</span>
    ${bar}
    <span class="node-meta">${repoChip(item.repo)}${prereq}</span>`;
  return a;
}

function renderPhases(phases) {
  const root = $("#phases");
  root.innerHTML = "";
  for (const phase of phases) {
    const section = document.createElement("section");
    section.className = "phase";
    section.id = `phase-${phase.code}`;
    const head = document.createElement("h2");
    head.innerHTML = `<b>${phase.code}</b> · ${phase.title}`;
    section.appendChild(head);
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const item of phase.items) grid.appendChild(nodeEl(item));
    section.appendChild(grid);
    root.appendChild(section);
  }
}

function stageSymbol(status) {
  return { PASS: "✓", FAIL: "✗", ERROR: "✗", TODO: "·" }[status] || "·";
}

function stagesList(stages) {
  if (!stages || !stages.length) return "";
  const rows = stages.map((s) => `
    <li>
      <span class="sdot" data-s="${s.status}" aria-hidden="true">${stageSymbol(s.status)}</span>
      <span><span class="stage-file">${s.file}</span> ${s.title}</span>
      <span class="stage-tags">${(s.tags || []).map((t) => `<span class="chip">${t}</span>`).join("")}</span>
    </li>`).join("");
  return `<h3>Stages</h3><ul class="stagelist">${rows}</ul>`;
}

function renderChallengeDetail(row) {
  $("#detail-empty").hidden = true;
  const body = $("#detail-body");
  body.hidden = false;
  const checks = row.checks || {};
  const progress = checks.total
    ? `<h3>Progress</h3><div class="bar" aria-hidden="true"><div class="bar-fill" style="transform:scaleX(${(checks.fraction || 0).toFixed(4)})"></div></div>
       <p class="dim">${fmt.format(checks.passed)} of ${fmt.format(checks.total)} stages passing</p>`
    : "";
  const cmds = [];
  if (row.smoke) {
    cmds.push(`<div class="cmd"><code id="detail-smoke">${row.smoke}</code>
      <button type="button" class="ghost-action" data-copy="#detail-smoke">Copy</button>
      <span class="copied" role="status" aria-live="polite"></span></div>`);
  }
  if (row.command) {
    cmds.push(`<div class="cmd"><code id="detail-cmd">${row.command}</code>
      <button type="button" class="copy primary-btn" data-copy="#detail-cmd">Copy</button>
      <span class="copied" role="status" aria-live="polite"></span></div>`);
  }
  if (row.guide) {
    cmds.push(`<div class="cmd"><code id="detail-guide">${row.guide}</code>
      <button type="button" class="ghost-action" data-copy="#detail-guide">Copy</button>
      <span class="copied" role="status" aria-live="polite"></span></div>`);
  }
  body.innerHTML = `
    <div class="logo-row">
      <img src="${asset(row.logo_url)}" alt="" width="48" height="48">
      <div>
        <p class="challenge-state" style="margin:0">${STATE_LABEL[row.state] || ""} · ${row.id}</p>
        <h2>${row.headline}</h2>
      </div>
    </div>
    <p class="why">${row.description || row.blurb}</p>
    ${cmds.join("")}
    ${progress}
    ${stagesList(row.stages_detail)}`;
}

function renderNodeDetail(item) {
  $("#detail-empty").hidden = true;
  const body = $("#detail-body");
  body.hidden = false;
  const checks = item.checks || {};
  const repo = item.repo;
  const prereq = (item.prereq || []).length
    ? `<div class="prereq"><span class="chip">After</span>${item.prereq.map((p) => `<span class="chip">${p}</span>`).join("")}</div>`
    : "";
  const progress = checks.total
    ? `<h3>Checks</h3><div class="bar" aria-hidden="true"><div class="bar-fill" style="transform:scaleX(${checks.fraction.toFixed(4)})"></div></div>
       <p class="dim">${fmt.format(checks.passed)} of ${fmt.format(checks.total)} passing</p>`
    : "";
  const repoBlock = repo && repo.baseline
    ? `<h3>Written</h3><p class="dim">${fmt.format(repo.written)} of ${fmt.format(repo.baseline)} template markers written (${fmtPct(repo.fraction)})</p>`
    : "";
  body.innerHTML = `
    <p class="challenge-state" style="margin:0">${item.id} · ${STATE_LABEL[item.state]}</p>
    <h2>${item.title}</h2>
    <p class="why">${item.why}</p>
    ${prereq}
    ${item.command ? `<div class="cmd"><code id="detail-cmd">${item.command}</code>
      <button type="button" class="copy primary-btn" data-copy="#detail-cmd">Copy</button>
      <span class="copied" role="status" aria-live="polite"></span></div>` : ""}
    ${progress}
    ${repoBlock}
    ${stagesList(item.stages)}`;
}

function clearDetail() {
  $("#detail-empty").hidden = false;
  $("#detail-body").hidden = true;
  $("#detail-body").innerHTML = "";
}

function findChallenge(slug) {
  return (STATE.showcase?.track || []).find((r) => r.slug === slug) || null;
}

function findItem(id) {
  for (const phase of STATE.phases) {
    const hit = phase.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return null;
}

function syncCurrent() {
  for (const el of $$(".challenge")) {
    el.setAttribute("aria-current", String(SELECTED?.kind === "challenge" && el.dataset.slug === SELECTED.id));
  }
  for (const a of $$(".node")) {
    a.setAttribute("aria-current", String(SELECTED?.kind === "node" && a.dataset.id === SELECTED.id));
  }
}

function selectChallenge(slug, push = true) {
  const row = findChallenge(slug);
  SELECTED = row ? { kind: "challenge", id: slug } : null;
  syncCurrent();
  if (row) renderChallengeDetail(row);
  else clearDetail();
  if (push) {
    const url = row ? `?challenge=${encodeURIComponent(slug)}` : location.pathname;
    history.pushState({ kind: "challenge", id: slug }, "", url);
  }
  if (row) $("#detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function selectNode(id, push = true) {
  const item = findItem(id);
  SELECTED = item ? { kind: "node", id } : null;
  syncCurrent();
  if (item) renderNodeDetail(item);
  else clearDetail();
  if (push) {
    const url = item ? `?node=${encodeURIComponent(id)}` : location.pathname;
    history.pushState({ kind: "node", id }, "", url);
  }
}

document.addEventListener("click", (event) => {
  const card = event.target.closest(".challenge");
  if (card) {
    event.preventDefault();
    selectChallenge(card.dataset.slug);
    return;
  }
  const a = event.target.closest(".node");
  if (!a || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  selectNode(a.dataset.id);
});

addEventListener("popstate", (event) => {
  if (event.state?.kind === "challenge") return selectChallenge(event.state.id, false);
  if (event.state?.kind === "node") return selectNode(event.state.id, false);
  const params = new URLSearchParams(location.search);
  if (params.get("challenge")) return selectChallenge(params.get("challenge"), false);
  if (params.get("node")) return selectNode(params.get("node"), false);
  SELECTED = null;
  syncCurrent();
  clearDetail();
});

/* ------------------------------------------------------------- live runs */
let LAST_SEQ = 0;
let LIVE_POLLING = false;

function liveBadge(event) {
  const el = document.createElement("div");
  el.className = "live-toast";
  el.setAttribute("role", "status");
  const pctDone = event.total ? Math.round((event.passed / event.total) * 100) : 0;
  el.innerHTML = `<span class="lt-sym">●</span>
    <b>${event.title || event.course}</b>
    <span class="lt-score">${fmt.format(event.passed)}/${fmt.format(event.total)} checks · ${pctDone}%</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 4200);
}

function restoreSelection() {
  const params = new URLSearchParams(location.search);
  const challenge = params.get("challenge");
  const node = params.get("node");
  if (challenge && findChallenge(challenge)) selectChallenge(challenge, false);
  else if (node && findItem(node)) selectNode(node, false);
  else {
    SELECTED = null;
    syncCurrent();
    clearDetail();
  }
}

async function refreshState() {
  STATE = await loadState();
  renderTotals(STATE.totals);
  renderNext(STATE.next);
  renderCatalog(STATE.showcase?.track || []);
  renderPhases(STATE.phases);
  restoreSelection();
}

function pollEvents() {
  if (!LIVE || LIVE_POLLING) return;
  LIVE_POLLING = true;
  const loop = async () => {
    while (true) {
      try {
        const res = await fetch(`/api/events?since=${encodeURIComponent(LAST_SEQ)}`, { cache: "no-store" });
        const data = await res.json();
        const events = data.events || [];
        if (events.length) {
          LAST_SEQ = events[events.length - 1].seq;
          for (const e of events) liveBadge(e);
          await refreshState();
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  loop();
}

/* ----------------------------------------------------------------- init */
async function init() {
  STATE = await loadState();
  if (STATE.brand?.tagline) {
    document.title = `${STATE.brand.name || "forja"} · Challenges`;
  }
  renderTotals(STATE.totals);
  renderNext(STATE.next);
  renderCatalog(STATE.showcase?.track || []);
  renderPhases(STATE.phases);
  restoreSelection();
}

init().then(() => {
  if (!LIVE) return;
  fetch("/api/runs", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      const events = data.events || [];
      if (events.length) {
        LAST_SEQ = events[events.length - 1].seq;
        if (Date.now() / 1000 - events[events.length - 1].ts < 30) {
          for (const e of events.slice(-1)) liveBadge(e);
        }
      }
      pollEvents();
    })
    .catch(pollEvents);
}).catch((err) => {
  $("#lede").textContent = "Could not read state — open via `cz web` or the baked /forja page.";
  console.error(err);
});
