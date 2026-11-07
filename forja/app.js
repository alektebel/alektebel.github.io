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
const DISK = 1500, CX = 750, CIRC = 169.6;
const RING_R = [0, 140, 265, 390, 505, 615];
const WEDGE = 72;                 // degrees of arc owned by one branch
const LABEL_R = 706;              // branch labels sit beyond the outermost ring
const NODE_W = 104, NODE_HALF_GAP = 60;
/* Completion paints lines in its own growth colour, deliberately distinct from
   the five branch hues: bright when both ends are complete, soft when only one
   is, so the tree fills in as courses land. */
const GROW = "#6ee7a8";
const GROW_SOFT = "rgba(110,231,168,.7)";

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
    /* every visit starts centered on the core */
    if (VIEW !== LAST_VIEW) fitTree(true);
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

/* how many nodes of this width fit across one branch's arc at radius r */
function ringCap(r) {
  const half = Math.asin(Math.min(1, NODE_HALF_GAP / r)) * 180 / Math.PI;
  return Math.max(1, Math.floor((WEDGE - 2 * half) / (2 * half)) + 1);
}

function treeNodes() {
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

    /* fill the inner rings first; a branch too large for one ring spills out */
    const rings = RING_R.map(() => []);
    let ring = 1;
    for (const entry of list) {
      while (ring < RING_R.length && rings[ring].length >= ringCap(RING_R[ring])) ring++;
      entry.ring = Math.min(ring, RING_R.length - 1);
      rings[entry.ring].push(entry);
    }

    for (let i = 1; i < RING_R.length; i++) {
      const group = rings[i];
      if (!group.length) continue;
      const r = RING_R[i];
      const half = Math.asin(Math.min(1, NODE_HALF_GAP / r)) * 180 / Math.PI;
      const window = Math.min(WEDGE / 2 - half, 26);
      const step = group.length > 1 ? (2 * window) / (group.length - 1) : 0;
      group.forEach((entry, k) => {
        const off = group.length > 1 ? -window + step * k : 0;
        const deg = (BR[cat] + off) * Math.PI / 180;
        out.push({
          item: entry.item, course: entry.course, cat, ring: i,
          x: CX + r * Math.cos(deg),
          y: CX + r * Math.sin(deg),
        });
      });
    }
  }

  const byCourse = new Map(out.map((n) => [n.course, n]));
  for (const n of out) {
    const deps = (prereq.get(n.course) || []).map((c) => byCourse.get(c)).filter(Boolean);
    n.parent = deps[0] || null;
    n.extra = deps.slice(1);
  }
  return out;
}

function renderMap() {
  const nodes = treeNodes();
  const byId = new Map(nodes.map((n) => [n.item.id, n]));

  /* branch key: the rim labels are only reachable by panning, so the legend
     carries the same names */
  const legend = $("#map-branches");
  if (legend) {
    legend.setAttribute("aria-label", `Branches: ${Object.keys(BR).join(", ")}`);
    legend.innerHTML = Object.keys(BR).map((cat) =>
      `<span class="lg-branch"><i style="background:${BC[cat]}"></i>${cat}</span>`).join("");
  }

  /* branch labels, on the branch axis outside the outermost ring so no node
     title can reach them */
  const branches = $("#tree-branches");
  branches.innerHTML = "";
  for (const cat of Object.keys(BR)) {
    const deg = BR[cat] * Math.PI / 180;
    const span = document.createElement("span");
    span.className = "branch-label";
    span.style.left = `${CX + LABEL_R * Math.cos(deg)}px`;
    span.style.top = `${CX + LABEL_R * Math.sin(deg)}px`;
    span.style.color = BC[cat];
    span.textContent = cat;
    branches.appendChild(span);
  }

  /* edges: core spoke for roots, line for the primary parent, dashed arc for
     the secondary ones. A finished project paints its lines in the growth
     colour, so the tree visibly fills in as courses get completed. */
  const edges = $("#tree-edges");
  edges.innerHTML = "";
  for (const node of nodes) {
    const hot = SELECTED?.kind === "node" && SELECTED.id === node.item.id;
    const nodeDone = itemState(node.item) === "complete";
    if (!node.parent) {
      const deg = (BR[node.cat]) * Math.PI / 180;
      const rootStartable = nodeStatus(node.item) === "ready";
      addEdge(edges, { x: CX + 38 * Math.cos(deg), y: CX + 38 * Math.sin(deg) },
        node, nodeDone ? GROW : rootStartable ? BC[node.cat] : "rgba(255,255,255,.13)",
        nodeDone ? 3.4 : rootStartable ? 3 : hot ? 3 : 2, "",
        false, nodeDone || rootStartable);
      continue;
    }
    const parentHot = SELECTED?.kind === "node" && SELECTED.id === node.parent.item.id;
    const parentDone = itemState(node.parent.item) === "complete";
    const bothDone = parentDone && nodeDone;
    const touched = parentDone || nodeDone;
    addEdge(edges, node.parent, node,
      touched ? (bothDone ? GROW : GROW_SOFT)
        : hot || parentHot ? "rgba(232,234,235,.5)" : "rgba(255,255,255,.13)",
      touched ? (bothDone ? 3.4 : 2.6) : hot || parentHot ? 3 : 2,
      "", false, touched);
    for (const sec of node.extra) {
      const secDone = itemState(sec.item) === "complete";
      const secBoth = secDone && nodeDone;
      const secTouched = secDone || nodeDone;
      addEdge(edges, sec, node,
        secTouched ? (secBoth ? GROW : GROW_SOFT) : "rgba(255,255,255,.13)",
        secTouched ? (secBoth ? 1.8 : 1.5) : hot ? 3 : 1.25,
        "3 5", true, secTouched);
    }
  }

  /* nodes */
  const nodesRoot = $("#tree-nodes");
  nodesRoot.innerHTML = "";
  for (const node of nodes) {
    const item = node.item;
    const st = nodeStatus(item);
    const checks = item.checks || {};
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tree-node";
    if (SELECTED?.kind === "node" && SELECTED.id === item.id) el.classList.add("is-selected");
    el.style.left = `${node.x - NODE_W / 2}px`;
    el.style.top = `${node.y - 26}px`;
    const frac = checks.total ? (checks.passed / checks.total) : 0;
    const op = st === "blocked" ? .35 : 1;
    el.innerHTML = `
      <span class="tn-ring ${!node.parent && st === "ready" ? "is-startable" : ""}" style="background:${st === "done" ? "#162027" : "#10161a"}">
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
  }

  renderMapSide(nodes, byId);
}

function addEdge(root, a, b, color, w, dash = "", curved = false, glow = false) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const d = curved
    ? `M${a.x} ${a.y} Q${CX + (a.x + b.x - 2 * CX) * .35} ${CX + (a.y + b.y - 2 * CX) * .35} ${b.x} ${b.y}`
    : `M${a.x} ${a.y} L${b.x} ${b.y}`;
  path.setAttribute("d", d);
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", w);
  if (dash) path.setAttribute("stroke-dasharray", dash);
  if (glow) path.classList.add("edge-grow");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  root.appendChild(path);
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

/* ---------------------------------------------------------------- github */
/* "Sign in" here means connecting a public fork, not OAuth. The page reads
   only public data — the fork, its commits, and the diff against upstream.
   No token, no client secret, no server. Progress is what those commits touch. */
const GH_KEY = "forja.github";
const GH_UPSTREAM = { owner: "alektebel", repo: "forja", branch: "main" };
const GH_API = "https://api.github.com";
const GH_TTL = 120000;             // reuse a fork read for two minutes
let GH = null;                     // {login, name, repo, branch, progress}
let GH_BUSY = false;

function ghLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(GH_KEY) || "null");
    GH = raw && raw.login && !raw.token ? raw : null;   // old device-flow rows have no login
  } catch { GH = null; }
}
function ghStore() {
  if (!GH) return;
  const { progress_loading, ...rest } = GH;
  try { localStorage.setItem(GH_KEY, JSON.stringify(rest)); } catch { /* private mode */ }
}
function ghSave(account) {
  GH = account;
  ghStore();
  renderGh();
}
function ghClear() {
  GH = null;
  try { localStorage.removeItem(GH_KEY); } catch { /* private mode */ }
  renderGh();
  renderGhStats();
}
function ghInitials(user) {
  const name = (user.name || user.login || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return two.toUpperCase();
}
function renderGh() {
  const signed = !!GH;
  $("#gh-signin").hidden = signed;
  $("#gh-account").hidden = !signed;
  if (!signed) { closeGhMenu(); return; }
  $("#gh-avatar").textContent = ghInitials(GH);
  $("#gh-login").textContent = GH.login;
  $("#gh-name").textContent = GH.name || GH.login;
  $("#gh-handle").textContent = `@${GH.login}`;
  $("#gh-user").setAttribute("aria-label", `GitHub account: ${GH.login}`);
}
function closeGhMenu() {
  const menu = $("#gh-menu");
  if (!menu.hidden) {
    menu.hidden = true;
    $("#gh-user").setAttribute("aria-expanded", "false");
  }
}
function openGhMenu() {
  $("#gh-menu").hidden = false;
  $("#gh-user").setAttribute("aria-expanded", "true");
}
function ghStatus(msg, kind = "") {
  const el = $("#gh-status");
  el.textContent = msg;
  if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
}
function ghEsc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
async function ghApi(path) {
  const res = await fetch(`${GH_API}${path}`, {
    headers: { "Accept": "application/vnd.github+json" },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset") || 0);
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
    const err = new Error(mins
      ? `GitHub API rate limit. Try again in about ${mins} min.`
      : "GitHub API rate limit. Try again in a few minutes.");
    err.code = "rate_limit";
    throw err;
  }
  if (res.status === 404) {
    const err = new Error("GitHub returned 404.");
    err.code = "not_found";
    throw err;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || `GitHub returned ${res.status}.`);
    err.code = res.status;
    throw err;
  }
  return res.json();
}
async function ghFindFork(login) {
  const upstream = `${GH_UPSTREAM.owner}/${GH_UPSTREAM.repo}`;
  try {
    const repo = await ghApi(`/repos/${encodeURIComponent(login)}/${GH_UPSTREAM.repo}`);
    if (repo.full_name === upstream) {
      const err = new Error("upstream");
      err.code = "upstream";
      throw err;
    }
    if (repo.fork && repo.parent && repo.parent.full_name === upstream) return repo;
  } catch (err) {
    if (err.code !== "not_found") throw err;
  }
  // The fork may have been renamed; GitHub keeps parent.full_name.
  const repos = await ghApi(`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=updated`);
  const found = repos.find((r) => r.fork && r.parent && r.parent.full_name === upstream);
  if (!found) {
    const err = new Error("no_fork");
    err.code = "no_fork";
    throw err;
  }
  return found;
}
async function ghConnect() {
  if (GH_BUSY) return;
  const login = $("#gh-username").value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) {
    ghStatus("Enter a GitHub username, not a URL.", "error");
    $("#gh-username").focus();
    return;
  }
  GH_BUSY = true;
  $("#gh-check").disabled = true;
  ghStatus("Looking for your fork…", "busy");
  try {
    const [user, fork] = await Promise.all([
      ghApi(`/users/${encodeURIComponent(login)}`),
      ghFindFork(login),
    ]);
    ghSave({
      login: user.login,
      name: user.name || "",
      avatar_url: user.avatar_url || "",
      repo: fork.name,
      branch: fork.default_branch || "main",
      fork: fork.full_name,
      created_at: fork.created_at || "",
    });
    $("#gh-modal").hidden = true;
    ghStatus("");
    ghRefreshProgress(true);
  } catch (err) {
    if (err.code === "no_fork") {
      ghStatus(`@${login} has no fork of ${GH_UPSTREAM.owner}/${GH_UPSTREAM.repo}. Fork it below, then connect.`, "error");
      $("#gh-fork").focus();
    } else if (err.code === "upstream") {
      ghStatus("This is the source repo; the catalog already tracks its progress. Fork it to track your own commits.", "error");
    } else if (err.code === "not_found") {
      ghStatus(`GitHub user @${login} was not found.`, "error");
    } else {
      ghStatus(err.message || "Could not read GitHub.", "error");
    }
  } finally {
    GH_BUSY = false;
    $("#gh-check").disabled = false;
  }
}
async function ghLoadProgress(account, force = false) {
  const cached = account.progress;
  if (!force && cached && cached.checked_at && Date.now() - cached.checked_at < GH_TTL) {
    return cached;
  }
  const base = `${GH_UPSTREAM.owner}:${GH_UPSTREAM.branch}`;
  const head = `${account.login}:${account.branch}`;
  let compare = null;
  let warning = "";
  try {
    compare = await ghApi(`/repos/${encodeURIComponent(account.login)}/${encodeURIComponent(account.repo)}/compare/${base}...${head}`);
  } catch (err) {
    if (err.code === "rate_limit") throw err;
    warning = err.message || "Could not compare the fork with upstream.";
  }
  const files = ((compare && compare.files) || []).map((f) => f.filename);
  const track = (STATE?.showcase?.track || []).filter((row) => row.ready);
  const rows = [];
  for (const row of track) {
    const dir = row.slug;
    const courseFiles = files.filter((f) => f === dir || f.startsWith(`${dir}/`));
    const stages = (row.stages_detail || []).filter((s) => s.file);
    const touched = stages.filter((s) => courseFiles.includes(
      s.file.includes("/") ? s.file : `${dir}/${s.file}`
    ));
    let commits = [];
    try {
      const since = account.created_at ? `&since=${encodeURIComponent(account.created_at)}` : "";
      commits = await ghApi(`/repos/${encodeURIComponent(account.login)}/${encodeURIComponent(account.repo)}/commits?path=${encodeURIComponent(dir)}${since}&per_page=100`);
    } catch (err) {
      if (err.code === "rate_limit") throw err;
    }
    const last = commits[0]?.commit;
    rows.push({
      slug: row.slug,
      label: row.label || row.slug,
      commits: commits.length,
      capped: commits.length === 100,
      stages: stages.length,
      touched: touched.length,
      files: courseFiles.length,
      last: last ? { message: last.message.split("\n")[0], date: last.author?.date || last.committer?.date } : null,
      url: `https://github.com/${account.login}/${account.repo}/commits/${encodeURIComponent(account.branch)}/${encodeURIComponent(dir)}`,
    });
  }
  const progress = {
    checked_at: Date.now(),
    ahead: compare ? compare.ahead_by : null,
    behind: compare ? compare.behind_by : null,
    total_commits: compare ? (compare.commits || []).length : null,
    files: files.length,
    warning,
    rows,
  };
  account.progress = progress;
  if (GH && GH.login === account.login) {
    GH.progress = progress;
    GH.progress_error = "";
    ghStore();
  }
  return progress;
}
async function ghRefreshProgress(force = false) {
  if (!GH || GH.progress_loading) return;
  const login = GH.login;
  GH.progress_loading = true;
  GH.progress_error = "";
  renderGhStats();
  try {
    await ghLoadProgress(GH, force);
  } catch (err) {
    if (GH && GH.login === login) GH.progress_error = err.message || "Could not read commits.";
  } finally {
    if (GH && GH.login === login) {
      GH.progress_loading = false;
      ghStore();
      renderGhStats();
    }
  }
}
function ghAgo(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function renderGhStats() {
  const body = $("#gh-stats-body");
  if (!body) return;
  if (!GH) {
    if (!$("#gh-stats-modal").hidden) closeGhStats();
    body.innerHTML = `<p class="auth-lead dim">Connect a fork to see its commits.</p>`;
    return;
  }
  if (GH.progress_error) {
    body.innerHTML = `<p class="auth-lead dim">${ghEsc(GH.progress_error)}</p>`;
    return;
  }
  if (!GH.progress) {
    body.innerHTML = `<p class="auth-lead dim">Reading your fork's commits…</p>`;
    return;
  }
  const p = GH.progress;
  const rows = (p.rows || []).map((r) => {
    const pct = r.stages ? Math.round((r.touched / r.stages) * 100) : 0;
    const count = r.capped ? "100+" : r.commits;
    return `<article class="gh-stat">
      <div class="gh-stat-top">
        <a href="${ghEsc(r.url)}" target="_blank" rel="noopener">${ghEsc(r.label)}</a>
        <span class="mono">${count} commit${r.commits === 1 ? "" : "s"}</span>
      </div>
      <div class="gh-stat-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="gh-stat-meta">
        <span>${r.touched}/${r.stages} stages touched</span>
        <span>${r.files} file${r.files === 1 ? "" : "s"}</span>
        <span>${r.last ? ghAgo(r.last.date) : "no commits"}</span>
      </div>
      ${r.last ? `<div class="gh-stat-last">${ghEsc(r.last.message)}</div>` : ""}
    </article>`;
  }).join("");
  const ahead = p.ahead == null ? "commits by course" : `${p.ahead} commit${p.ahead === 1 ? "" : "s"} ahead`;
  const behind = p.behind ? ` · ${p.behind} behind upstream` : "";
  body.innerHTML = `
    <p class="auth-lead">
      <a href="https://github.com/${ghEsc(GH.login)}/${ghEsc(GH.repo)}" target="_blank" rel="noopener">@${ghEsc(GH.login)}/${ghEsc(GH.repo)}</a>
      · ${ahead}${behind} · ${p.files} file${p.files === 1 ? "" : "s"} changed.
    </p>
    <p class="auth-lead dim">Progress is what your commits touch, not a server-side test result. Run <code>forja test</code> locally to prove a stage.</p>
    ${p.warning ? `<p class="auth-status mono" data-kind="error">${ghEsc(p.warning)}</p>` : ""}
    ${rows || `<p class="auth-lead dim">No commits yet — fork, solve, commit.</p>`}
  `;
}
function openGhStats() {
  if (!GH) return;
  closeGhMenu();
  $("#gh-stats-modal").hidden = false;
  $("#gh-stats-x").focus();
  renderGhStats();
  if (!GH.progress || Date.now() - GH.progress.checked_at > GH_TTL) ghRefreshProgress();
}
function closeGhStats() {
  $("#gh-stats-modal").hidden = true;
}
async function ghRestore() {
  ghLoad();
  renderGh();
  if (!GH) return;
  const login = GH.login;
  try {
    const fork = await ghFindFork(login);
    if (!GH || GH.login !== login) return;
    GH.repo = fork.name;
    GH.branch = fork.default_branch || "main";
    GH.fork = fork.full_name;
    GH.created_at = fork.created_at || GH.created_at || "";
    ghStore();
    renderGh();
    if (!GH.progress || Date.now() - GH.progress.checked_at > GH_TTL) ghRefreshProgress();
  } catch (err) {
    if ((err.code === "no_fork" || err.code === "not_found") && GH && GH.login === login) {
      ghClear();
    }
  }
}


$("#go-home").addEventListener("click", () => go("home"));
$$(".topnav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
addEventListener("popstate", () => applyRoute(false));

/* GitHub account and the fork dialog. */
$("#gh-signin").addEventListener("click", () => {
  $("#gh-username").value = GH?.login || "";
  ghStatus("");
  $("#gh-modal").hidden = false;
  $("#gh-username").focus();
});
$("#gh-check").addEventListener("click", ghConnect);
$("#gh-username").addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); ghConnect(); }
});
$("#gh-user").addEventListener("click", (event) => {
  event.stopPropagation();
  if ($("#gh-menu").hidden) openGhMenu(); else closeGhMenu();
});
$("#gh-progress").addEventListener("click", openGhStats);
$("#gh-repos").addEventListener("click", () => {
  if (GH) window.open(`https://github.com/${encodeURIComponent(GH.login)}/${encodeURIComponent(GH.repo)}`, "_blank", "noopener");
  closeGhMenu();
});
$("#gh-signout").addEventListener("click", () => { closeGhMenu(); ghClear(); closeGhStats(); });
$("#gh-x").addEventListener("click", () => { $("#gh-modal").hidden = true; ghStatus(""); });
$("#gh-cancel").addEventListener("click", () => { $("#gh-modal").hidden = true; ghStatus(""); });
$("#gh-modal").addEventListener("click", (event) => {
  if (event.target === $("#gh-modal")) { $("#gh-modal").hidden = true; ghStatus(""); }
});
$("#gh-stats-x").addEventListener("click", closeGhStats);
$("#gh-stats-close").addEventListener("click", closeGhStats);
$("#gh-stats-modal").addEventListener("click", (event) => {
  if (event.target === $("#gh-stats-modal")) closeGhStats();
});
$("#gh-refresh").addEventListener("click", () => ghRefreshProgress(true));
document.addEventListener("click", (event) => {
  if (!$("#gh-account").contains(event.target)) closeGhMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#gh-stats-modal").hidden) closeGhStats();
  else if (!$("#gh-modal").hidden) { $("#gh-modal").hidden = true; ghStatus(""); }
  else closeGhMenu();
});
addEventListener("storage", (event) => {
  if (event.key !== GH_KEY) return;
  ghLoad();
  renderGh();
  renderGhStats();
});

/* ------------------------------------------------------- tree panning */
/* The disk is 1500px wide — wider than the column — so the tree is navigated
   by dragging. Pan is stored in screen pixels, scale keeps the disk readable
   on narrow screens, and the view starts centered. */
const PAN = { x: 0, y: 0, scale: 1 };
let PAN_DRAG = null;
let PAN_MOVED = false;

function treeViewport() { return $("#tree-viewport"); }

function panLimits() {
  const vp = treeViewport();
  if (!vp) return { x: 0, y: 0 };
  const half = (DISK * PAN.scale) / 2;
  return {
    x: Math.max(0, vp.clientWidth / 2 + half - 140),
    y: Math.max(0, vp.clientHeight / 2 + half - 140),
  };
}

function clampPan() {
  const lim = panLimits();
  PAN.x = Math.max(-lim.x, Math.min(lim.x, PAN.x));
  PAN.y = Math.max(-lim.y, Math.min(lim.y, PAN.y));
}

function applyPan() {
  const sized = $("#tree-sized");
  if (!sized) return;
  sized.style.setProperty("--pan-x", `${PAN.x.toFixed(1)}px`);
  sized.style.setProperty("--pan-y", `${PAN.y.toFixed(1)}px`);
  sized.style.setProperty("--tree-scale", PAN.scale.toFixed(4));
}

function fitTree(center = false) {
  const vp = treeViewport();
  if (!vp || !vp.clientWidth) return;
  /* keep nodes at their designed size — the disk is meant to be explored by
     dragging, not shrunk to fit */
  PAN.scale = vp.clientWidth >= 560 ? 1 : 0.8;
  if (center) { PAN.x = 0; PAN.y = 0; }
  clampPan();
  applyPan();
}

function bindTreePan() {
  const vp = treeViewport();
  if (!vp) return;

  vp.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    PAN_DRAG = { x: e.clientX, y: e.clientY, panX: PAN.x, panY: PAN.y, id: e.pointerId };
    PAN_MOVED = false;
  });

  vp.addEventListener("pointermove", (e) => {
    if (!PAN_DRAG || e.pointerId !== PAN_DRAG.id) return;
    const dx = e.clientX - PAN_DRAG.x;
    const dy = e.clientY - PAN_DRAG.y;
    if (!PAN_MOVED && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!PAN_MOVED) {
      /* capture only once this is a drag: capturing on pointerdown would
         retarget the click to the viewport and swallow node selection */
      PAN_MOVED = true;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("is-dragging");
    }
    PAN.x = PAN_DRAG.panX + dx;
    PAN.y = PAN_DRAG.panY + dy;
    clampPan();
    applyPan();
  });

  const end = (e) => {
    if (!PAN_DRAG || (e && e.pointerId !== PAN_DRAG.id)) return;
    vp.classList.remove("is-dragging");
    if (e && vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
    PAN_DRAG = null;
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);

  /* a drag must not select whatever node happened to be under the cursor */
  vp.addEventListener("click", (e) => {
    if (!PAN_MOVED) return;
    PAN_MOVED = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  vp.addEventListener("keydown", (e) => {
    const step = 70;
    const moves = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0],
      ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    const d = moves[e.key];
    if (!d) return;
    e.preventDefault();
    PAN.x += d[0];
    PAN.y += d[1];
    clampPan();
    applyPan();
  });

  /* focusing a node would otherwise scroll the clip container and knock the
     transform-based centering off */
  vp.addEventListener("scroll", () => { vp.scrollLeft = 0; vp.scrollTop = 0; });

  new ResizeObserver(() => fitTree()).observe(vp);
  fitTree(true);
}
bindTreePan();

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
  ghLoad(); renderGh();      // cached pill immediately; commits need STATE below
  STATE = await loadState();
  ghRestore();               // re-check the fork, then read its commits
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
