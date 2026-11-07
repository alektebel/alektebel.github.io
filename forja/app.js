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

/* Branch layout for the tech tree, straight from the design comp:
   category → angle (deg) and colour. */
const BR = { AI: -90, Distributed: -18, Networking: 54, Systems: 126, Finance: 198 };
const BC = {
  AI: "#a58cf0", Distributed: "#54d1a4", Networking: "#f0995a",
  Systems: "#6aa5f0", Finance: "#e0b44e",
};
const RR = [0, 140, 265, 390], CX = 500, CIRC = 169.6;

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
  if (VIEW === "map") renderMap();
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

  /* interface block: the stage action + prediction read like a spec */
  const iface = $("#w-interface-sec");
  if (stage?.action) {
    iface.hidden = false;
    $("#w-interface").textContent =
      `${stage.file} · stage ${stage.id}\n\n` +
      `action:  ${stage.action}\n` +
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
  return st;
}

/* The tech tree is curated exactly like the design comp: five branches,
   30 flagship nodes, fixed angles and rings. [slug, branch, parent, angle, ring,
   secondaryParents]. Courses absent from this repo are skipped. */
const TREE = [
  ["autograd-from-scratch", "AI", null, 0, 1],
  ["llm-from-scratch", "AI", "autograd-from-scratch", -13, 2],
  ["vector-index-from-scratch", "AI", "autograd-from-scratch", 13, 2],
  ["context-caching", "AI", "llm-from-scratch", -27, 3],
  ["evals-from-scratch", "AI", "llm-from-scratch", -9, 3],
  ["rag-from-scratch", "AI", "vector-index-from-scratch", 9, 3, ["llm-from-scratch"]],
  ["agent-harness-from-scratch", "AI", "vector-index-from-scratch", 27, 3, ["evals-from-scratch"]],

  ["infrastructure-from-scratch", "Distributed", null, 0, 1],
  ["aws-from-scratch", "Distributed", "infrastructure-from-scratch", -13, 2],
  ["queue-and-workers-from-scratch", "Distributed", "infrastructure-from-scratch", 13, 2],
  ["agents-from-scratch", "Distributed", "aws-from-scratch", -27, 3, ["evals-from-scratch"]],
  ["dynamo-paper", "Distributed", "aws-from-scratch", -9, 3],
  ["durable-execution-from-scratch", "Distributed", "queue-and-workers-from-scratch", 9, 3],
  ["consensus-from-scratch", "Distributed", "queue-and-workers-from-scratch", 27, 3],

  ["tcp-ip-from-scratch", "Networking", null, 0, 1],
  ["concurrent-servers-from-scratch", "Networking", "tcp-ip-from-scratch", -13, 2],
  ["websocket-from-scratch", "Networking", "tcp-ip-from-scratch", 13, 2],
  ["blockchain-from-scratch", "Networking", "concurrent-servers-from-scratch", -18, 3],
  ["mqtt-broker-from-scratch", "Networking", "websocket-from-scratch", 14, 3],

  ["cpu-from-scratch", "Systems", null, 0, 1],
  ["os-from-scratch", "Systems", "cpu-from-scratch", -13, 2],
  ["c-compiler", "Systems", "cpu-from-scratch", 13, 2],
  ["shell-from-scratch", "Systems", "os-from-scratch", -27, 3],
  ["cuda-from-scratch", "Systems", "os-from-scratch", -9, 3],
  ["git-from-scratch", "Systems", "c-compiler", 9, 3],
  ["query-engine-from-scratch", "Systems", "c-compiler", 27, 3],

  ["credit-origination-from-scratch", "Finance", null, 0, 1],
  ["irb-capital-from-scratch", "Finance", "credit-origination-from-scratch", -13, 2],
  ["lbo-model-from-scratch", "Finance", "credit-origination-from-scratch", 13, 2],
  ["distressed-debt-from-scratch", "Finance", "lbo-model-from-scratch", 13, 3],
];

/** Resolve the tree against live state: one entry per node present here. */
function treeNodes() {
  const out = [];
  for (const [slug, cat, parent, angle, ring, extra] of TREE) {
    const item = findNodeByCourse(slug);
    if (!item) continue;
    const deg = (BR[cat] + angle) * Math.PI / 180;
    const r = RR[ring];
    out.push({
      item, slug, cat, ring,
      parentSlug: parent,
      extraSlugs: extra || [],
      x: CX + r * Math.cos(deg),
      y: CX + r * Math.sin(deg),
    });
  }
  const bySlug = new Map(out.map((n) => [n.slug, n]));
  for (const n of out) {
    n.parent = n.parentSlug ? bySlug.get(n.parentSlug) : null;
    n.extra = n.extraSlugs.map((s) => bySlug.get(s)).filter(Boolean);
  }
  return out;
}

function renderMap() {
  const nodes = treeNodes();
  const byId = new Map(nodes.map((n) => [n.item.id, n]));

  /* branch labels, placed on the outer edge at the design's angles */
  const branches = $("#tree-branches");
  branches.innerHTML = "";
  for (const cat of Object.keys(BR)) {
    const deg = BR[cat] * Math.PI / 180;
    const span = document.createElement("span");
    span.className = "branch-label";
    span.style.left = `${CX + 455 * Math.cos(deg)}px`;
    span.style.top = `${CX + 455 * Math.sin(deg)}px`;
    span.style.color = BC[cat];
    span.textContent = cat;
    branches.appendChild(span);
  }

  /* edges: core spoke for roots, line for the primary parent, dashed arc for
     the secondary ones — matching the comp */
  const edges = $("#tree-edges");
  edges.innerHTML = "";
  for (const node of nodes) {
    const hot = SELECTED?.kind === "node" && SELECTED.id === node.item.id;
    if (!node.parent) {
      const deg = (BR[node.cat]) * Math.PI / 180;
      addEdge(edges, { x: CX + 38 * Math.cos(deg), y: CX + 38 * Math.sin(deg) },
        node, BC[node.cat], hot ? 3 : 2, "");
      continue;
    }
    const parentHot = SELECTED?.kind === "node" && SELECTED.id === node.parent.item.id;
    const done = itemState(node.parent.item) === "complete";
    addEdge(edges, node.parent, node,
      done ? BC[node.cat] : hot || parentHot ? "rgba(232,234,235,.5)" : "rgba(255,255,255,.13)",
      hot || parentHot ? 3 : 2, "");
    for (const sec of node.extra) {
      addEdge(edges, sec, node, done ? BC[node.cat] : "rgba(255,255,255,.13)",
        hot ? 3 : 1.25, "3 5", true);
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
    el.style.left = `${node.x - 52}px`;
    el.style.top = `${node.y - 26}px`;
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
  }

  renderMapSide(nodes, byId);
}

function addEdge(root, a, b, color, w, dash = "", curved = false) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const d = curved
    ? `M${a.x} ${a.y} Q${CX + (a.x + b.x - 2 * CX) * .35} ${CX + (a.y + b.y - 2 * CX) * .35} ${b.x} ${b.y}`
    : `M${a.x} ${a.y} L${b.x} ${b.y}`;
  path.setAttribute("d", d);
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", w);
  if (dash) path.setAttribute("stroke-dasharray", dash);
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

/* ---------------------------------------------------------------- init */
$("#go-home").addEventListener("click", () => go("home"));
$$(".topnav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
addEventListener("popstate", () => applyRoute(false));

/* scale the tech-tree disk to the available width */
const ro = new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  const disk = $(".tree-disk");
  const sized = $("#tree-sized");
  if (!disk || !w) return;
  const scale = Math.min(1, w / 1000);
  disk.style.transform = `scale(${scale})`;
  sized.style.width = `${Math.min(1000, w)}px`;
  sized.style.height = `${Math.min(1000, w)}px`;
});
ro.observe($("#tree-ref"));

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
