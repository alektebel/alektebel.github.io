/* forja web — v2 catalog design, driven entirely by build_state().
   Local:  python3 codecraft/serve.py  →  /api/state + live /api/events
   Static: alektebel.github.io/forja   →  state.json (baked by scripts/forja_site.py)

   Views: home (continue + catalog), work (challenge detail + stages),
   map (tech tree of phases/branches). State lives in the URL query
   (?view=&challenge=&node=) so refresh and back/forward work. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = new Intl.NumberFormat("en");

const STATE_LABEL = {
  complete: "complete", doing: "in progress", ready: "not started",
  author: "to author", salvage: "port from a branch", legacy: "no checker yet",
  missing: "not in this repo",
};
/* status → colour, mirroring the v2 palette */
const C = { complete: "#54d1a4", doing: "#e0b44e", ready: "#9AA3AB", blocked: "#6B747C" };

/* Branch layout for the tech tree: category → angle (deg) and colour. Every
   project in the repo gets a node; the disk is bigger than the viewport so the
   tree is explored by dragging. */
const BR = { AI: -90, Distributed: -18, Networking: 54, Systems: 126, Finance: 198 };
const BC = {
  AI: "#a58cf0", Distributed: "#54d1a4", Networking: "#f0995a",
  Systems: "#6aa5f0", Finance: "#e0b44e",
};
const CIRC = 169.6;
const WEDGE = 72;                 // degrees of longitude owned by one branch

/* which branch a project belongs to */
const CATEGORY = {
  "llm-from-scratch": "AI", "autograd-from-scratch": "AI",
  "context-caching": "AI", "contextcite": "AI",
  "rag-from-scratch": "AI", "vector-index-from-scratch": "AI",
  "evals-from-scratch": "AI", "agents-from-scratch": "AI",
  "mcp-from-scratch": "AI", "agent-harness-from-scratch": "AI",
  "benchmark-from-scratch": "AI", "eval-framework-from-scratch": "AI",
  "agentic-retrieval-from-scratch": "AI", "transformer-inference-physics": "AI",
  "llm-security-from-scratch": "AI",

  "infrastructure-from-scratch": "Distributed", "aws-from-scratch": "Distributed",
  "queue-and-workers-from-scratch": "Distributed", "dynamo-paper": "Distributed",
  "deploy-and-debug": "Distributed", "durable-execution-from-scratch": "Distributed",
  "consensus-from-scratch": "Distributed", "orchestration-from-scratch": "Distributed",
  "failover-from-scratch": "Distributed", "distributed-training-from-scratch": "Distributed",
  "sandbox-capabilities-from-scratch": "Distributed", "agent-metrics-from-scratch": "Distributed",
  "fde-from-scratch": "Distributed",

  "tcp-ip-from-scratch": "Networking", "concurrent-servers-from-scratch": "Networking",
  "websocket-from-scratch": "Networking", "mqtt-broker-from-scratch": "Networking",
  "blockchain-from-scratch": "Networking",

  "cpu-from-scratch": "Systems", "cuda-from-scratch": "Systems", "c-compiler": "Systems",
  "os-from-scratch": "Systems", "shell-from-scratch": "Systems",
  "runtime-from-scratch": "Systems", "compiler-and-vgpu": "Systems",
  "git-from-scratch": "Systems", "query-engine-from-scratch": "Systems",
  "linux-device-driver-from-scratch": "Systems", "compression-from-scratch": "Systems",
  "interconnects-from-scratch": "Systems",

  "credit-origination-from-scratch": "Finance", "credit-lifecycle-from-scratch": "Finance",
  "collections-workout-from-scratch": "Finance", "irb-capital-from-scratch": "Finance",
  "distressed-debt-from-scratch": "Finance", "lbo-model-from-scratch": "Finance",
};

let STATE = null;
let VIEW = "home";          // home | work | map
let SELECTED = null;        // { kind: "challenge"|"node", id }
let FILTER = "All";
let LIVE = false;
let LAST_SEQ = 0;
let LIVE_POLLING = false;

/* ---------------------------------------------------------------- utils */
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
  if (url.startsWith("/")) return basePath() + url.replace(/^\/+/, "");
  return basePath() + url.replace(/^\.\//, "");
}

function itemState(item) {
  const s = item?.state || "ready";
  return s === "doing" || s === "complete" || s === "ready" || s === "blocked" ? s
    : s === "missing" ? "blocked" : "ready";
}

function stateLabel(s) {
  return { complete: "complete", doing: "in progress", ready: "not started", blocked: "blocked" }[s] || STATE_LABEL[s] || s;
}

function stateColor(s) { return C[s] || "#9AA3AB"; }

/* ---------------------------------------------------------------- data */
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

function trackRows() { return STATE.showcase?.track || []; }
function allItems() {
  if (!STATE) return [];
  return STATE.phases.flatMap((p) => p.items);
}
function findChallenge(slug) {
  return trackRows().find((r) => r.slug === slug) || null;
}
function findItem(id) {
  for (const phase of STATE.phases) {
    const hit = phase.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return null;
}
function findNodeByCourse(course) {
  return allItems().find((i) => i.course === course) || null;
}

/* ---------------------------------------------------------------- routing */
function applyRoute(push = false) {
  if (!push) {
    /* derive from the URL (initial load, back/forward) */
    const params = new URLSearchParams(location.search);
    const challenge = params.get("challenge");
    const node = params.get("node");
    const view = params.get("view");
    if (challenge && findChallenge(challenge)) {
      VIEW = "work";
      SELECTED = { kind: "challenge", id: challenge };
    } else if (node && findItem(node)) {
      VIEW = view === "work" ? "work" : "map";
      SELECTED = { kind: "node", id: node };
    } else if (view === "work" || view === "map" || view === "home") {
      VIEW = view;
      SELECTED = null;
    } else {
      VIEW = "home";
      SELECTED = null;
    }
  }
  if (push) {
    const q = new URLSearchParams();
    q.set("view", VIEW);
    if (SELECTED) q.set(SELECTED.kind === "challenge" ? "challenge" : "node", SELECTED.id);
    history.pushState({}, "", `${location.pathname}?${q}`);
  }
  render();
}

function go(view) { VIEW = view; applyRoute(true); }
function selectChallenge(slug) {
  VIEW = "work";
  SELECTED = findChallenge(slug) ? { kind: "challenge", id: slug } : null;
  applyRoute(true);
}
function selectNode(id, view = "map") {
  VIEW = view;
  SELECTED = findItem(id) ? { kind: "node", id } : null;
  applyRoute(true);
}

/* ---------------------------------------------------------------- render */
let LAST_VIEW = null;
function render() {
  if (!STATE) return; // init loads state before first paint
  $$(".topnav button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === VIEW);
  });
  $("#view-home").hidden = VIEW !== "home";
  $("#view-work").hidden = VIEW !== "work";
  $("#view-map").hidden = VIEW !== "map";
  if (VIEW === "home") renderHome();
  if (VIEW === "work") renderWork();
  if (VIEW === "map") {
    /* every visit starts from the same centred camera */
    if (VIEW !== LAST_VIEW) {
      GLOBE.yaw = 0; GLOBE.pitch = -0.10; GLOBE.dist = GLOBE_DIST0;
      GLOBE.panX = 0; GLOBE.panY = 0;
    }
    renderMap();
  }
  LAST_VIEW = VIEW;
}

/* home -------------------------------------------------------------- */
function renderHome() {
  renderNext(STATE.next);
  renderAlso();
  renderFilters();
  renderCatalog();
}

function renderNext(next) {
  const card = $("#next-card");
  if (!next) { card.hidden = true; return; }
  card.hidden = false;
  const item = next.course ? findNodeByCourse(next.course) : null;
  const logo = item?.logo_url || `logos/${next.logo || "forge"}.svg`;
  $("#next-logo").src = asset(logo);
  $("#next-logo").alt = next.title || "";
  $("#next-h").textContent = next.headline || next.title || next.course;
  const checks = next.checks || item?.checks;
  $("#next-count").textContent = checks?.total
    ? `${fmt.format(checks.passed)} / ${fmt.format(checks.total)} checks`
    : "";
  $("#next-bar").style.transform = `scaleX(${(checks?.fraction ?? 0).toFixed(4)})`;
  $("#next-what").textContent = next.action
    ? `Next: Stage ${String(next.stage).padStart(2, "0")} · ${next.action}`
    : `Next: ${next.title || next.course}`;
  $("#next-cmd").textContent = next.command || "";
  $("#next-go").onclick = () => selectChallenge(next.course);
}

function renderAlso() {
  const doing = trackRows().filter((r) => r.state === "doing" && r.slug !== STATE.next?.course);
  const sec = $("#also");
  if (!doing.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const grid = $("#also-grid");
  grid.innerHTML = "";
  for (const row of doing) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "also-card";
    const checks = row.checks || {};
    btn.innerHTML = `
      <img src="${asset(row.logo_url)}" alt="" width="44" height="44">
      <span class="also-copy">
        <span class="also-row"><b>${row.headline}</b>
          <span class="mono">${fmt.format(checks.passed || 0)} / ${fmt.format(checks.total || row.stages)}</span></span>
        <span class="bar"><span class="bar-fill" style="transform:scaleX(${(checks.fraction || 0).toFixed(4)})"></span></span>
      </span>`;
    btn.onclick = () => selectChallenge(row.slug);
    grid.appendChild(btn);
  }
}

function renderFilters() {
  const cats = ["All", "Cloud & LLM", "RAG", "Evals & agents", "Machine stack", "Applied", "Banking", "Drivers", "Web3"];
  const root = $("#filters");
  root.innerHTML = "";
  for (const label of cats) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.classList.toggle("is-active", label === FILTER);
    b.onclick = () => { FILTER = label; renderFilters(); renderCatalog(); };
    root.appendChild(b);
  }
}

function renderCatalog() {
  const root = $("#catalog");
  root.innerHTML = "";
  const items = [];
  for (const phase of STATE.phases) {
    if (FILTER !== "All" && !phase.title.toLowerCase().includes(FILTER.split(" ")[0].toLowerCase())) continue;
    for (const item of phase.items) items.push(item);
  }
  for (const item of items) {
    const s = itemState(item);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-card";
    const checks = item.checks || {};
    const label = checks.total
      ? `${fmt.format(checks.passed)}/${fmt.format(checks.total)}`
      : stateLabel(s);
    btn.innerHTML = `
      <img src="${asset(item.logo_url)}" alt="" width="40" height="40" style="opacity:${s === "blocked" ? .45 : 1}">
      <span class="cat-copy">
        <span class="cat-title">${item.title}</span>
        <span class="cat-state" style="color:${stateColor(s)}">${label}</span>
      </span>`;
    btn.onclick = () => selectNode(item.id, "work");
    root.appendChild(btn);
  }
}

/* work -------------------------------------------------------------- */
function renderWork() {
  const empty = $("#work-empty");
  const detail = $("#work-detail");
  const item = SELECTED?.kind === "node" ? findItem(SELECTED.id) : null;
  const track = SELECTED?.kind === "challenge" ? findChallenge(SELECTED.id) : null;
  if (!item && !track) {
    empty.hidden = false;
    detail.hidden = true;
    return;
  }
  empty.hidden = true;
  detail.hidden = false;

  const course = item?.course || track?.slug;
  const stages = item?.stages || track?.stages_detail || [];
  const checks = item?.checks || track?.checks || {};
  const logo = track?.logo_url || item?.logo_url || "logos/forge.svg";
  const title = track?.headline || item?.title || course;
  const why = track?.description || track?.blurb || item?.why || "";

  /* header: use the stage's action as the crumb line */
  const nextStep = item?.next_step || (checks.total ? Math.min((checks.passed || 0) + 1, stages.length) : 1);
  const stage = stages.find((s) => s.id === nextStep) || stages[0];
  $("#w-crumb").textContent = stage
    ? `Stage ${String(stage.id).padStart(2, "0")} · ${stage.file}`
    : (item?.id || track?.id || "");
  $("#w-title").textContent = title;
  $("#w-why").textContent = why;

  /* prereq chips */
  const uses = $("#w-uses");
  uses.innerHTML = "";
  for (const p of item?.prereq || []) {
    const req = findItem(p);
    if (!req) continue;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `requires ${p} ${req.title}`;
    uses.appendChild(chip);
  }

  /* interface block: the stage action + why + prediction read like a spec */
  const iface = $("#w-interface-sec");
  if (stage?.action) {
    iface.hidden = false;
    $("#w-interface").textContent =
      `${stage.file} · stage ${stage.id}\n\n` +
      `action:  ${stage.action}\n` +
      (stage.why ? `why:     ${stage.why}\n` : "") +
      (stage.predict ? `predict: ${stage.predict}\n` : "") +
      (stage.tags?.length ? `tags:    ${stage.tags.join(", ")}\n` : "");
  } else {
    iface.hidden = true;
  }

  /* requirements: per-stage titles */
  const reqs = $("#w-reqs");
  reqs.innerHTML = "";
  for (const s of stages) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${s.file}</code> — ${s.title}`;
    reqs.appendChild(li);
  }

  /* hints: collapse of stage actions for upcoming stages */
  const hintsSec = $("#w-hints-sec");
  const hintsRoot = $("#w-hints");
  hintsRoot.innerHTML = "";
  const upcoming = stages.filter((s) => s.status !== "PASS" && s.action);
  if (!upcoming.length) {
    hintsSec.hidden = true;
  } else {
    hintsSec.hidden = false;
    for (const s of upcoming.slice(0, 4)) {
      const box = document.createElement("div");
      box.className = "hint";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<span>Stage ${String(s.id).padStart(2, "0")} — what's the catch?</span><span class="h-sym">+</span>`;
      const body = document.createElement("p");
      body.hidden = true;
      body.textContent = s.action;
      btn.onclick = () => {
        body.hidden = !body.hidden;
        btn.querySelector(".h-sym").textContent = body.hidden ? "+" : "−";
      };
      box.append(btn, body);
      hintsRoot.appendChild(box);
    }
  }

  /* commands */
  const cmd = item?.command || track?.command || `forja test ${course}`;
  $("#w-cmd").textContent = cmd;
  $("#w-side-cmd").textContent = cmd;
  $("#w-cmd-hint").textContent = track?.smoke ? `smoke test: ${track.smoke}` : "";
  $("#w-side-note").textContent = checks.total
    ? `${fmt.format(checks.passed)} / ${fmt.format(checks.total)} checks passing`
    : "The engine is the CLI — this page only reads it.";

  renderStageBar(logo, title, checks, stages, stage);
  renderTestList(stages, checks);

  /* repo markers block */
  const repo = item?.repo || track?.repo;
  const revSec = $("#w-review-sec");
  if (repo?.baseline) {
    revSec.hidden = false;
    $("#w-repo").textContent =
      `${fmt.format(repo.written)} of ${fmt.format(repo.baseline)} template markers written`;
    $("#w-repo-bar").style.transform = `scaleX(${(repo.fraction || 0).toFixed(4)})`;
  } else {
    revSec.hidden = true;
  }
}

function renderStageBar(logo, title, checks, stages, current) {
  const bar = $("#stagebar");
  bar.innerHTML = "";
  const head = document.createElement("div");
  head.className = "stagebar-head";
  head.innerHTML = `
    <img src="${asset(logo)}" width="36" height="36" alt="">
    <span class="stagebar-titlerow">
      <span class="stagebar-title">${title}</span>
      <span class="stagebar-count">${checks?.total ? `${fmt.format(checks.passed)} / ${fmt.format(checks.total)} checks` : ""}</span>
    </span>`;
  bar.appendChild(head);
  const progress = document.createElement("div");
  progress.className = "bar";
  progress.innerHTML = `<div class="bar-fill" style="transform:scaleX(${(checks?.fraction || 0).toFixed(4)})"></div>`;
  bar.appendChild(progress);

  const ol = document.createElement("ol");
  ol.className = "stage-list";
  for (const s of stages) {
    const li = document.createElement("li");
    if (current && s.id === current.id) li.classList.add("is-current");
    const sym = { PASS: "✓", FAIL: "✗", ERROR: "✗" }[s.status] || "○";
    const color = s.status === "PASS" ? "#54d1a4" : s.status === "TODO" ? "#6B747C" : "#d05a5a";
    li.innerHTML = `
      <span class="s-sym" style="color:${color}">${sym}</span>
      <span class="s-copy">
        <span class="s-name">${String(s.id).padStart(2, "0")} · ${s.title}</span>
        <span class="s-meta">${s.file}</span>
      </span>`;
    ol.appendChild(li);
  }
  bar.appendChild(ol);
}

function renderTestList(stages, checks) {
  const ul = $("#w-stages");
  ul.innerHTML = "";
  $("#w-checks").textContent = checks?.total
    ? `${fmt.format(checks.passed)} / ${fmt.format(checks.total)}`
    : "";
  for (const s of stages) {
    const li = document.createElement("li");
    const ok = s.status === "PASS";
    li.innerHTML = `
      <span class="t-sym" data-s="${s.status}">${ok ? "✓" : "○"}</span>
      <span class="t-name">${s.title}<br><span class="t-file">${s.file}</span></span>`;
    ul.appendChild(li);
  }
}

/* map --------------------------------------------------------------- */
function nodeStatus(item) {
  const s = itemState(item);
  if (s === "complete") return "done";
  if (s === "doing") return "doing";
  return s === "blocked" ? "blocked" : "ready";
}

function nodeLabel(item) {
  const st = nodeStatus(item);
  const checks = item.checks || {};
  if (st === "done") return "complete";
  if (st === "doing") return `${fmt.format(checks.passed || 0)}/${fmt.format(checks.total || 0)}`;
  return stateLabel(itemState(item));
}

/* One node per project in the repo (a course can appear in several challenge
   rows — 73 rows collapse to 51 projects here). Position comes from the
   prerequisite graph: shallower projects sit on the inner rings, and nodes are
   packed per branch so 104px-wide nodes never collide. */
function courseIndex() {
  const rows = allItems();
  const byId = new Map();
  for (const r of rows) if (r.id && !byId.has(r.id)) byId.set(r.id, r);
  const courses = new Map();
  for (const r of rows) {
    if (!r.course) continue;
    const prev = courses.get(r.course);
    if (!prev || (prev.kind !== "ready" && r.kind === "ready")) courses.set(r.course, r);
  }
  return { byId, courses };
}

/* A branch owns a lune. Nodes are laid out on latitude rows (south = shallow
   prerequisites, north = deep ones) with as many rows as it takes to keep the
   neighbours apart; the arc a row offers shrinks with cos(latitude). */
const LUNE_LON = (WEDGE - 6) * Math.PI / 180;    // usable longitude inside a lune
const LUNE_SIN = 0.93;                           // latitude range, as sin(lat)
const NODE_ARC = 0.50;                           // model-space arc one node needs

function luneRows(n) {
  let rows = 1;
  for (; rows <= 12; rows++) {
    let capacity = 0;
    for (let r = 0; r < rows; r++) {
      const sinLat = LUNE_SIN * (-1 + (2 * (r + 0.5)) / rows);
      const lat = Math.asin(sinLat);
      capacity += Math.max(1, Math.floor((LUNE_LON * Math.cos(lat)) / NODE_ARC));
    }
    if (capacity >= n) break;
  }
  return rows;
}

function layoutLune(list, cat) {
  const n = list.length;
  const rows = luneRows(n);
  const bands = [];
  for (let r = 0; r < rows; r++) {
    const sinLat = rows === 1 ? 0 : LUNE_SIN * (-1 + (2 * (r + 0.5)) / rows);
    const lat = Math.asin(Math.max(-0.985, Math.min(0.985, sinLat)));
    const cols = Math.max(1, Math.floor((LUNE_LON * Math.cos(lat)) / NODE_ARC));
    bands.push({ lat, cols, members: [] });
  }
  /* fill rows in depth order; a branch too big for one band spills outward */
  let band = 0;
  for (const entry of list) {
    while (band < bands.length - 1 && bands[band].members.length >= bands[band].cols) band++;
    bands[band].members.push(entry);
  }

  const base = (BR[cat] * Math.PI) / 180;
  const out = [];
  bands.forEach((b, row) => {
    const k = b.members.length;
    /* alternate rows sideways: two single-node rows would otherwise sit in a
       straight line and their rings would touch */
    const shift = (row % 2 ? 1 : -1) * 0.08;
    b.members.forEach((entry, i) => {
      const lonPos = k === 1 ? 0.5 : (i + 0.5) / k;
      const lon = base + shift + (lonPos - 0.5) * LUNE_LON;
      const r = Math.cos(b.lat);
      out.push({
        item: entry.item, course: entry.course, cat,
        p: { x: r * Math.cos(lon), y: Math.sin(b.lat), z: r * Math.sin(lon) },
      });
    });
  });
  return out;
}

/* Every project sits on the surface of a unit sphere: one 72° lune per branch,
   latitude ordered by prerequisite depth (roots toward the south, leaves toward
   the north), longitude scattered with the golden angle so no two nodes of a
   lune stack. Only the front hemisphere is drawn, so the far half waits for a
   rotation. */
function globeNodes() {
  const { byId, courses } = courseIndex();
  const prereq = new Map();
  for (const course of courses.keys()) {
    const ids = courses.get(course).prereq || [];
    const deps = [];
    for (const id of ids) {
      const c = byId.get(id)?.course;
      if (c && c !== course && courses.has(c) && !deps.includes(c)) deps.push(c);
    }
    prereq.set(course, deps);
  }

  const depth = new Map();
  const depthOf = (c, seen = new Set()) => {
    if (depth.has(c)) return depth.get(c);
    if (seen.has(c)) return 0;
    seen.add(c);
    const deps = prereq.get(c) || [];
    const d = deps.length ? 1 + Math.max(...deps.map((p) => depthOf(p, seen))) : 0;
    seen.delete(c);
    depth.set(c, d);
    return d;
  };

  const branches = new Map();
  for (const [course, item] of courses) {
    const cat = CATEGORY[course] || "Systems";
    if (!branches.has(cat)) branches.set(cat, []);
    branches.get(cat).push({ course, item });
  }

  const out = [];
  for (const [cat, list] of branches) {
    list.sort((a, b) => depthOf(a.course) - depthOf(b.course) || a.item.title.localeCompare(b.item.title));
    for (const node of layoutLune(list, cat)) out.push(node);
  }

  const byCourse = new Map(out.map((n) => [n.course, n]));
  for (const n of out) {
    const deps = (prereq.get(n.course) || []).map((c) => byCourse.get(c)).filter(Boolean);
    n.parent = deps[0] || null;
    n.extra = deps.slice(1);
  }
  return out;
}

/* ------------------------------------------------------------ globe camera */
const GLOBE = {
  yaw: 0, pitch: -0.10, dist: 2.9,
  panX: 0, panY: 0,
  w: 0, h: 0, dpr: 1, fit: 0.40,
  focal: 0, nodes: [], els: new Map(),
  canvas: null, ctx: null,
  drag: null, moved: false, raf: 0,
};
const GLOBE_MIN_DIST = 1.55, GLOBE_MAX_DIST = 6.5, GLOBE_DIST0 = 2.9;
const NODE_BASE = 0.70, GLOBE_REF_RADIUS = 303;         /* node box scale at the reference distance */

/* model → screen. The camera sits on +z at `dist`, looking at the origin. */
function projectPoint(px, py, pz) {
  const cy = Math.cos(GLOBE.yaw), sy = Math.sin(GLOBE.yaw);
  const cp = Math.cos(GLOBE.pitch), sp = Math.sin(GLOBE.pitch);
  const x1 = px * cy + pz * sy;
  const z1 = -px * sy + pz * cy;
  const y2 = py * cp - z1 * sp;
  const z2 = py * sp + z1 * cp;
  const d = GLOBE.dist - z2;
  return {
    x: GLOBE.w / 2 + GLOBE.panX + (GLOBE.focal * x1) / d,
    y: GLOBE.h / 2 + GLOBE.panY - (GLOBE.focal * y2) / d,
    z: z2, d,
    /* node size follows the globe: on a small screen the sphere shrinks and the
       rings have to shrink with it, or they collide */
    scale: Math.max(0.12, Math.min(2.3,
      NODE_BASE * (globeRadiusPx() / GLOBE_REF_RADIUS) * (GLOBE.dist / d))),
  };
}

/* screen → point on the unit sphere (null when the cursor misses the globe) */
function unproject(mx, my) {
  const ox = mx - GLOBE.w / 2 - GLOBE.panX;
  const oy = -(my - GLOBE.h / 2 - GLOBE.panY);
  const dirX = ox / GLOBE.focal, dirY = oy / GLOBE.focal;
  /* point(λ) = (dirX·λ, dirY·λ, dist − λ) */
  const a = dirX * dirX + dirY * dirY + 1;
  const b = -2 * GLOBE.dist;
  const c = GLOBE.dist * GLOBE.dist - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const lam = (-b - Math.sqrt(disc)) / (2 * a);
  /* invert the model rotation to get the surface point in model space */
  const cx = dirX * lam, cy = dirY * lam, cz = GLOBE.dist - lam;
  const cp = Math.cos(GLOBE.pitch), sp = Math.sin(-GLOBE.pitch);
  const y1 = cy * cp - cz * sp;
  const z1 = cy * sp + cz * cp;
  const cyw = Math.cos(GLOBE.yaw), syw = Math.sin(-GLOBE.yaw);
  return {
    x: cx * cyw + z1 * syw,
    y: y1,
    z: -cx * syw + z1 * cyw,
    camZ: cz,
  };
}

function updateGlobeSize() {
  const vp = treeViewport();
  const canvas = GLOBE.canvas;
  if (!vp || !canvas) return;
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  GLOBE.w = w; GLOBE.h = h;
  GLOBE.dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * GLOBE.dpr);
  canvas.height = Math.round(h * GLOBE.dpr);
  GLOBE.focal = Math.min(w, h) * GLOBE.fit * GLOBE_DIST0;
  clampPan();
}

function clampPan() {
  const lim = Math.min(GLOBE.w, GLOBE.h) * 0.9;
  GLOBE.panX = Math.max(-lim, Math.min(lim, GLOBE.panX));
  GLOBE.panY = Math.max(-lim, Math.min(lim, GLOBE.panY));
}

function frameGlobe() {
  if (GLOBE.raf) return;
  GLOBE.raf = requestAnimationFrame(() => {
    GLOBE.raf = 0;
    drawGlobe();
    placeNodes();
  });
}

/* ---- canvas: sphere body, graticule and the prerequisite arcs ---- */
function globeRadiusPx() {
  return GLOBE.focal / Math.sqrt(Math.max(1.0001, GLOBE.dist * GLOBE.dist - 1));
}

function drawGlobe() {
  const ctx = GLOBE.ctx;
  if (!ctx || !GLOBE.w) return;
  const { w, h } = GLOBE;
  ctx.setTransform(GLOBE.dpr, 0, 0, GLOBE.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2 + GLOBE.panX;
  const cy = h / 2 + GLOBE.panY;
  const R = globeRadiusPx();
  if (R < 2) return;

  /* body */
  const grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
  grad.addColorStop(0, "#18212a");
  grad.addColorStop(0.62, "#0f151a");
  grad.addColorStop(1, "#0a0e11");
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  /* graticule */
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  for (let lat = -60; lat <= 60; lat += 30) strokeParallel(lat * Math.PI / 180, 0.35);
  for (let lon = -180; lon < 180; lon += 30) strokeMeridian(lon * Math.PI / 180, 0.30);

  /* branch seams, tinted with the branch colour */
  for (const cat of Object.keys(BR)) {
    const seam = ((BR[cat] + WEDGE / 2) * Math.PI) / 180;
    strokeMeridian(seam, 0.55, hexAlpha(BC[cat], 0.34));
  }

  /* prerequisite arcs, lifted just above the surface */
  for (const node of GLOBE.nodes) {
    const hot = SELECTED?.kind === "node" && SELECTED.id === node.item.id;
    if (node.parent) {
      const parentHot = SELECTED?.kind === "node" && SELECTED.id === node.parent.item.id;
      const done = itemState(node.parent.item) === "complete";
      strokeArc(node.parent.p, node.p, hot || parentHot ? 2.4 : 1.4,
        hot || parentHot ? "rgba(232,234,235,.6)" : done ? hexAlpha(BC[node.cat], .55) : "rgba(255,255,255,.18)", null);
    }
    for (const sec of node.extra) {
      strokeArc(sec.p, node.p, 1.1,
        hot ? "rgba(232,234,235,.45)" : "rgba(255,255,255,.12)", [3, 5]);
    }
  }
  ctx.restore();

  /* rim */
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232,234,235,.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

const GRID_SAMPLES = 72;
function strokeMeridian(lon, alphaScale, color) {
  const ctx = GLOBE.ctx;
  const step = (Math.PI * 2) / GRID_SAMPLES;
  ctx.beginPath();
  let pen = false;
  for (let lat = -Math.PI / 2; lat <= Math.PI / 2 + 1e-6; lat += step) {
    const p = projectPoint(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    if (p.z <= 0.02) { pen = false; continue; }
    if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
  }
  ctx.strokeStyle = color || `rgba(255,255,255,${0.05 * (alphaScale / 0.3)})`;
  ctx.stroke();
}

function strokeParallel(lat, _alpha) {
  const ctx = GLOBE.ctx;
  const step = (Math.PI * 2) / GRID_SAMPLES;
  ctx.beginPath();
  let pen = false;
  for (let lon = 0; lon <= Math.PI * 2 + 1e-6; lon += step) {
    const p = projectPoint(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    if (p.z <= 0.02) { pen = false; continue; }
    if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
  }
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  ctx.stroke();
}

function strokeArc(a, b, width, color, dash) {
  const ctx = GLOBE.ctx;
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const segs = Math.max(6, Math.min(28, Math.round(omega * 24)));
  const grow = omega > 0.001 ? 1.012 : 1.012;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let px, py, pz;
    if (omega < 1e-4) { px = a.x; py = a.y; pz = a.z; }
    else {
      const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const s2 = Math.sin(t * omega) / Math.sin(omega);
      px = a.x * s1 + b.x * s2;
      py = a.y * s1 + b.y * s2;
      pz = a.z * s1 + b.z * s2;
    }
    const p = projectPoint(px * grow, py * grow, pz * grow);
    if (p.z <= 0.02) { pen = false; continue; }
    if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
  }
  ctx.setLineDash(dash || []);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
}

function hexAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* ---- nodes: DOM, positioned by the same projection ---- */
function placeNodes() {
  for (const node of GLOBE.nodes) {
    const el = GLOBE.els.get(node.item.id);
    if (!el) continue;
    const p = projectPoint(node.p.x, node.p.y, node.p.z);
    /* near the limb the sphere foreshortens and nodes would pile up, so the
       horizon fades out instead of turning into a fringe of overlapping logos */
    const fade = Math.min(1, Math.max(0, (p.z - 0.26) / 0.2));
    el.style.transform =
      `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${p.scale.toFixed(3)}) translate(-52px, -26px)`;
    el.style.opacity = fade.toFixed(3);
    el.style.zIndex = String(1000 - Math.round(p.d * 100));
    /* names appear once you are close enough to read them, or on hover */
    el.classList.toggle("is-near", p.scale >= 1.2);
    el.style.pointerEvents = fade > 0.6 ? "auto" : "none";
  }
}

function renderMap() {
  const nodes = globeNodes();
  GLOBE.nodes = nodes;
  const byId = new Map(nodes.map((n) => [n.item.id, n]));

  const legend = $("#map-branches");
  if (legend) {
    legend.setAttribute("aria-label", `Branches: ${Object.keys(BR).join(", ")}`);
    legend.innerHTML = Object.keys(BR).map((cat) =>
      `<span class="lg-branch"><i style="background:${BC[cat]}"></i>${cat}</span>`).join("");
  }

  const nodesRoot = $("#tree-nodes");
  nodesRoot.innerHTML = "";
  GLOBE.els.clear();
  for (const node of nodes) {
    const item = node.item;
    const st = nodeStatus(item);
    const checks = item.checks || {};
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tree-node";
    if (SELECTED?.kind === "node" && SELECTED.id === item.id) el.classList.add("is-selected");
    const frac = checks.total ? (checks.passed / checks.total) : 0;
    const op = st === "blocked" ? .35 : 1;
    el.innerHTML = `
      <span class="tn-ring" style="background:${st === "done" ? "#162027" : "#10161a"};box-shadow:${st === "ready" ? `0 0 0 1px ${BC[node.cat]}55` : "none"}">
        <svg width="52" height="52" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="27" stroke="${st === "blocked" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.12)"}" stroke-width="3" fill="none"></circle>
          <circle cx="30" cy="30" r="27" stroke="${frac ? BC[node.cat] : "transparent"}" stroke-width="3" fill="none"
            stroke-dasharray="${(frac * CIRC).toFixed(1)} ${CIRC}" stroke-linecap="round"></circle>
        </svg>
        <img src="${asset(item.logo_url)}" width="32" height="32" alt="" style="opacity:${op};filter:${st === "blocked" ? "grayscale(1)" : "none"}">
      </span>
      <span class="tn-title">${item.title}</span>
      <span class="tn-label" style="color:${stateColor(itemState(item))}">${nodeLabel(item)}</span>`;
    el.onclick = () => selectNode(item.id, "map");
    nodesRoot.appendChild(el);
    GLOBE.els.set(item.id, el);
  }

  updateGlobeSize();
  placeNodes();
  drawGlobe();
  renderMapSide(nodes, byId);
}

function renderMapSide(nodes, byId) {
  const side = $("#map-side");
  const sel = SELECTED?.kind === "node" ? byId.get(SELECTED.id) : null;
  if (!sel) {
    side.innerHTML = `<div class="map-empty-hint">Select a node in the tree to see what it requires and what it unlocks.</div>`;
    return;
  }
  const item = sel.item;
  const st = nodeStatus(item);
  side.innerHTML = "";
  const head = document.createElement("div");
  head.className = "map-side-head";
  head.innerHTML = `
    <img src="${asset(item.logo_url)}" width="52" height="52" alt="">
    <div class="map-side-titlerow">
      <h2>${item.title}</h2>
      <span class="mono" style="color:${BC[sel.cat]}">${nodeLabel(item)}</span>
    </div>`;
  side.appendChild(head);

  const blurb = document.createElement("p");
  blurb.textContent = item.why || "";
  side.appendChild(blurb);

  const reqs = [sel.parent, ...sel.extra].filter(Boolean);
  side.appendChild(mkRefList("Requires",
    reqs.map((n) => ({ id: n.item.id, item: n.item })),
    (r) => r.item.title).box);

  const unlocks = nodes.filter((n) => n.parent === sel || n.extra.includes(sel));
  side.appendChild(mkRefList("Unlocks",
    unlocks.map((n) => ({ id: n.item.id, item: n.item })),
    (r) => r.item.title).box);

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "cta cta-green";
  cta.style.marginTop = "auto";
  cta.textContent = st === "blocked" ? "Blocked" : st === "doing" ? "Continue" : "Start";
  if (st !== "blocked") cta.onclick = () => selectNode(item.id, "work");
  else cta.disabled = true;
  side.appendChild(cta);
}

function mkRefList(title, refs, label) {
  const box = document.createElement("div");
  box.style.display = "flex";
  box.style.flexDirection = "column";
  box.style.gap = "8px";
  const h = document.createElement("h3");
  h.textContent = title;
  box.appendChild(h);
  if (!refs.length) {
    const s = document.createElement("span");
    s.className = "dim";
    s.style.fontSize = "13px";
    s.textContent = "Nothing.";
    box.appendChild(s);
    return { box };
  }
  const list = document.createElement("div");
  list.className = "ref-list";
  for (const r of refs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ref-btn";
    const st = nodeStatus(r.item);
    b.innerHTML = `<span>${label(r)}</span>
      <span class="mono" style="color:${stateColor(itemState(r.item))}">${nodeLabel(r.item)}</span>`;
    b.onclick = () => selectNode(r.id, "map");
    list.appendChild(b);
  }
  box.appendChild(list);
  return { box };
}

/* ---------------------------------------------------------------- copy */
document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".copy");
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

/* ---------------------------------------------------------------- init */
$("#go-home").addEventListener("click", () => go("home"));
$$(".topnav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
addEventListener("popstate", () => applyRoute(false));

/* ------------------------------------------------------- globe controls */
/* Drag rotates the sphere (the surface point under the cursor follows it);
   the wheel dollies toward the cursor so the point under the mouse stays put
   while everything around it grows — the Planetary Annihilation zoom. */
function treeViewport() { return $("#tree-viewport"); }

function rotateBy(dxPx, dyPx, camZ) {
  /* radians per pixel at the depth of the grabbed surface point */
  const k = (GLOBE.dist - camZ) / GLOBE.focal;
  GLOBE.yaw += dxPx * k;
  GLOBE.pitch += dyPx * k;
  const lim = 1.45;
  GLOBE.pitch = Math.max(-lim, Math.min(lim, GLOBE.pitch));
  frameGlobe();
}

function zoomAt(mx, my, factor) {
  const spot = unproject(mx, my);
  const z = spot ? spot.camZ : 0;
  const dist = GLOBE.dist;
  const next = Math.max(GLOBE_MIN_DIST, Math.min(GLOBE_MAX_DIST, dist * factor));
  if (Math.abs(next - dist) < 1e-5) return;
  const qx = mx - GLOBE.w / 2 - GLOBE.panX;
  const qy = my - GLOBE.h / 2 - GLOBE.panY;
  const ratio = (dist - z) / (next - z) - 1;
  GLOBE.dist = next;
  GLOBE.panX += qx * ratio;
  GLOBE.panY += qy * ratio;
  clampPan();
  frameGlobe();
}

function bindGlobe() {
  const vp = treeViewport();
  const canvas = $("#globe-canvas");
  if (!vp || !canvas) return;
  GLOBE.canvas = canvas;
  GLOBE.ctx = canvas.getContext("2d");

  const local = (e) => {
    const r = vp.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  vp.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    const spot = unproject(p.x, p.y);
    GLOBE.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, camZ: spot ? spot.camZ : 0 };
    GLOBE.moved = false;
  });

  vp.addEventListener("pointermove", (e) => {
    if (!GLOBE.drag || e.pointerId !== GLOBE.drag.id) return;
    const dx = e.clientX - GLOBE.drag.x;
    const dy = e.clientY - GLOBE.drag.y;
    if (!GLOBE.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!GLOBE.moved) {
      /* capture only once it is a drag, otherwise the click is retargeted to
         the viewport and node selection never fires */
      GLOBE.moved = true;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("is-dragging");
    }
    rotateBy(dx, dy, GLOBE.drag.camZ);
    GLOBE.drag.x = e.clientX;
    GLOBE.drag.y = e.clientY;
  });

  const end = (e) => {
    if (!GLOBE.drag || (e && e.pointerId !== GLOBE.drag.id)) return;
    vp.classList.remove("is-dragging");
    if (e && vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
    GLOBE.drag = null;
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);

  vp.addEventListener("click", (e) => {
    if (!GLOBE.moved) return;
    GLOBE.moved = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    const factor = Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0016);
    zoomAt(p.x, p.y, factor);
  }, { passive: false });

  vp.addEventListener("keydown", (e) => {
    const step = 0.12;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = moves[e.key];
    if (!d) return;
    e.preventDefault();
    const k = GLOBE.dist / GLOBE.focal;
    GLOBE.yaw += d[0] * GLOBE.focal * k;
    GLOBE.pitch = Math.max(-1.45, Math.min(1.45, GLOBE.pitch + d[1] * GLOBE.focal * k));
    frameGlobe();
  });

  vp.addEventListener("scroll", () => { vp.scrollLeft = 0; vp.scrollTop = 0; });

  new ResizeObserver(() => { updateGlobeSize(); frameGlobe(); }).observe(vp);
  updateGlobeSize();
  frameGlobe();
}
bindGlobe();

/* ------------------------------------------------------------- live runs */
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

async function refreshState() {
  STATE = await loadState();
  render();
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

async function init() {
  STATE = await loadState();
  applyRoute(false);
  render();
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
  $("#work-empty h1").textContent = "Could not read state";
  $("#work-empty p").textContent = "Open via `cz web` or the baked /forja page.";
  console.error(err);
});
