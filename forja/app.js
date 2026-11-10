/* forja web — v2 catalog design, driven entirely by build_state().
   Local:  python3 codecraft/serve.py  →  /api/state + live /api/events
   Static: alektebel.github.io/forja   →  state.json (baked by scripts/forja_site.py)

   Views: home (continue + catalog), work (challenge detail + stages),
   map (dependency graph of projects). State lives in the URL query
   (?view=&challenge=&node=) so refresh and back/forward work. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = new Intl.NumberFormat("en");

/* Workspace mode. Local CLI keeps the stage brief, stage rail and test rail;
   the browser mode swaps in the zip's split brief/editor shell. */
let WORK_MODE = "local";
let WORK_COURSE = null;
let WORK_STAGE = null;

const STATE_LABEL = {
  complete: "complete", doing: "in progress", ready: "not started",
  author: "to author", salvage: "port from a branch", legacy: "no checker yet",
  missing: "not in this repo",
};
/* status → colour, mirroring the v2 palette */
const C = { complete: "#54d1a4", doing: "#e0b44e", ready: "#9AA3AB", blocked: "#6B747C" };

/* Branch layout for the dependency graph: category → angle (deg) and colour. Every
   project in the repo gets a node; the disk is bigger than the viewport so the
   graph is explored by dragging. */
const BR = { AI: -90, Distributed: -18, Networking: 54, Systems: 126, Finance: 198 };
const BC = {
  AI: "#a58cf0", Distributed: "#54d1a4", Networking: "#f0995a",
  Systems: "#6aa5f0", Finance: "#e0b44e",
};
const DISK = 1500, CX = 750, CIRC = 169.6;
const RING_R = [0, 140, 265, 390, 505, 615, 690];
const WEDGE = 72;                 // degrees of arc owned by one branch
const LABEL_R = 740;              // branch labels sit beyond the outermost ring
const NODE_W = 104, NODE_HALF_GAP = 60;
/* Completion paints lines in its own growth colour, deliberately distinct from
   the five branch hues: bright when both ends are complete, soft when only one
   is, so the tree fills in as courses land. */
const GROW = "#6ee7a8";
const GROW_SOFT = "rgba(110,231,168,.7)";
/* All-project dependency graph in the project detail: grouped lanes, one node
   per project, depth on the x axis. */
const DEP_GROUP_ORDER = Object.keys(BR);
const DEP_GAP_X = 142, DEP_NODE_W = 118, DEP_NODE_H = 28, DEP_ROW = 34, DEP_LEFT = 146;

/* ------------------------------------------------------- AWS stage tree */
/* Official AWS Architecture Icons (svgs) live in logos/aws-*.svg. The stage
   prerequisites below are curated from the course itself: stages build in
   order inside one mechanism; IAM gates every service; the condition rules are reused by SNS filters and KMS context; the
   integration ladder wires the last behavior of each service. Keep the ids
   in sync with aws-from-scratch/lessons.json. */
const COURSE_TREES = {
  "aws-from-scratch": {
    summary: "eight mechanisms · five integration stages",
    groups: [
      { id: "iam", label: "IAM", icon: "logos/aws-iam.svg", color: "#e0565b", files: ["iam.py"] },
      { id: "s3", label: "S3", icon: "logos/aws-s3.svg", color: "#7aa2f7", files: ["s3.py"] },
      { id: "sqs", label: "SQS", icon: "logos/aws-sqs.svg", color: "#b48ead", files: ["sqs.py"] },
      { id: "dynamodb", label: "DynamoDB", icon: "logos/aws-dynamodb.svg", color: "#6ee7a8", files: ["dynamodb.py"] },
      { id: "lambda", label: "Lambda", icon: "logos/aws-lambda.svg", color: "#f2b84b", files: ["lambda_svc.py"] },
      { id: "sns", label: "SNS", icon: "logos/aws-sns.svg", color: "#e0b44e", files: ["sns.py"] },
      { id: "kms", label: "KMS", icon: "logos/aws-kms.svg", color: "#54d1a4", files: ["kms.py"] },
      { id: "vpc", label: "VPC", icon: "logos/aws-vpc.svg", color: "#6aa5f0", files: ["vpc.py"] },
      { id: "capstone", label: "Integration", icon: "logos/aws-cfn.svg", color: "#ff9900", files: ["capstone.py"] },
    ],
    stageIcons: { 46: "logos/aws-eventbridge.svg", 47: "logos/aws-eventbridge.svg" },
    deps: [
      /* one behavior at a time inside each mechanism */
      [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
      [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17],
      [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 25], [25, 26],
      [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 33],
      [34, 35], [35, 36], [36, 37], [37, 38], [38, 39], [39, 40], [40, 41], [41, 42],
      [43, 44], [44, 45], [45, 46], [46, 47],
      [48, 49], [49, 50], [50, 51],
      [52, 53], [53, 54], [54, 55], [55, 56], [56, 57], [57, 58],
      [59, 60], [60, 61], [61, 62], [62, 63],
      /* IAM gates every service; the condition rule returns in filters and KMS */
      [8, 9], [8, 18], [8, 27], [8, 34], [8, 43], [8, 48], [8, 52], [8, 59],
      [5, 44], [5, 45], [5, 50],
      [23, 42],
      /* the integration ladder wires the last behavior of each service */
      [9, 59], [43, 59], [18, 60], [34, 61], [27, 61], [8, 62], [9, 62],
      [31, 63], [42, 63],
    ],
  },
};
/* Nine service lanes, one stage per row. Wide enough for nine stages
   (IAM, S3, SQS and Lambda all have nine) without overlaps. */
const COURSE_TREE_LAYOUT = {
  laneW: 126, gap: 14, left: 16, top: 14, headerH: 58,
  rowH: 40, nodeW: 126, nodeH: 36, bottom: 18,
  get width() { return this.left * 2 + 9 * this.laneW + 8 * this.gap; },
  get height() { return this.top + this.headerH + 9 * this.rowH + this.bottom; },
};

/* which branch a project belongs to */
const CATEGORY = {
  "llm-from-scratch": "AI", "autograd-from-scratch": "AI",
  "context-caching": "AI", "contextcite": "AI",
  "rag-from-scratch": "AI", "vector-index-from-scratch": "AI",
  "evals-from-scratch": "AI", "agents-from-scratch": "AI",
  "mcp-from-scratch": "AI", "agent-harness-from-scratch": "AI",
  "benchmark-from-scratch": "AI", "eval-framework-from-scratch": "AI",
  "agentic-retrieval-from-scratch": "AI", "transformer-inference-physics": "AI",
  "llm-security-from-scratch": "AI", "mechinterp-from-scratch": "AI",
  "continual-learning-from-scratch": "AI", "hierarchical-sequence-from-scratch": "AI",
  "recursive-depth-from-scratch": "AI", "library-learning-from-scratch": "AI",
  "causal-invariance-from-scratch": "AI",

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
  "interconnects-from-scratch": "Systems", "physics-engine-from-scratch": "Systems",
  "rasterizer-from-scratch": "Systems",

  "credit-origination-from-scratch": "Finance", "credit-lifecycle-from-scratch": "Finance",
  "collections-workout-from-scratch": "Finance", "irb-capital-from-scratch": "Finance",
  "distressed-debt-from-scratch": "Finance", "lbo-model-from-scratch": "Finance",
  "sas-lgd-from-scratch": "Finance",
};

let STATE = null;
let VIEW = "home";          // home | work | map | course
let SELECTED = null;        // { kind: "challenge"|"node"|"course", id }
let STAGE = null;           // stage number inside the work detail
let MAP_PREVIEW = null;     // course hovered/focused in the map side panel
let DEP_HIDDEN = new Set(); // groups folded away in the project dependency graph
let FILTER = "All";
let LIVE = false;
let LAST_SEQ = 0;
let LIVE_POLLING = false;
const SOURCE_CACHE = new Map(); // "course\0stage" → analyzer payload
const SOURCE_MISS = new Set();  // stages with no source target (authored courses)
const SOURCE_REVIEW = new Map(); // "course\0stage" → per-line review result
let SOURCE_TOKEN = 0;           // drops a late source response after a stage switch
const PERSONAL_KEY = "forja.personal.completed.v1";
let PERSONAL_DONE = {};
const BROWSER_KEY = "forja.browser.passed.v1";
let BROWSER_DONE = {};

function loadPersonalDone() {
  try {
    const value = JSON.parse(localStorage.getItem(PERSONAL_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function importPersonalCompletion() {
  PERSONAL_DONE = loadPersonalDone();
  try { BROWSER_DONE = JSON.parse(localStorage.getItem(BROWSER_KEY) || "{}"); }
  catch { BROWSER_DONE = {}; }
  const url = new URL(location.href);
  if (url.searchParams.get("complete") !== "aws-iam") return;
  const previous = Array.isArray(PERSONAL_DONE["aws-from-scratch"])
    ? PERSONAL_DONE["aws-from-scratch"] : [];
  PERSONAL_DONE["aws-from-scratch"] = [...new Set([...previous, ...Array.from({ length: 8 }, (_, i) => i + 1)])];
  try { localStorage.setItem(PERSONAL_KEY, JSON.stringify(PERSONAL_DONE)); } catch { /* private mode */ }
  url.searchParams.delete("complete");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function completion(stages) {
  const done = stages.filter((s) => s.status === "PASS" || s.status === "PERSONAL" || s.status === "BROWSER").length;
  const previous = stages.filter((s) => s.status === "PERSONAL").length;
  return { done, previous, total: stages.length };
}

function applyPersonalDone() {
  for (const item of allItems()) {
    if (!item.course || !item.stages?.length) continue;
    const completed = new Set(Array.isArray(PERSONAL_DONE[item.course]) ? PERSONAL_DONE[item.course] : []);
    const browserPassed = new Set(Array.isArray(BROWSER_DONE[item.course]) ? BROWSER_DONE[item.course] : []);
    for (const stage of item.stages) {
      if (completed.has(stage.id) && stage.status !== "PASS") stage.status = "PERSONAL";
      if (browserPassed.has(stage.id) && stage.status !== "PASS") stage.status = "BROWSER";
    }
    const progress = completion(item.stages);
    if (!progress.done) continue;
    item.personal_done = progress.previous;
    item.next_step = item.stages.find((s) => !["PASS", "PERSONAL", "BROWSER"].includes(s.status))?.id || null;
    if (item.state === "ready") item.state = "doing";
    const track = trackRows().find((row) => row.slug === item.course);
    if (track) {
      track.stages_detail = item.stages;
      track.personal_done = progress.previous;
      track.next_step = item.next_step;
      if (track.state === "ready") track.state = "doing";
    }
    if (STATE.next?.course === item.course && item.next_step) {
      const stage = item.stages.find((s) => s.id === item.next_step);
      STATE.next.stage = stage.id;
      STATE.next.action = stage.action || stage.title;
      STATE.next.command = `forja test ${item.course} --stage ${stage.id}`;
    }
  }
}

window.forjaBrowserPassed = (course, stageId) => {
  const ids = Array.isArray(BROWSER_DONE[course]) ? BROWSER_DONE[course] : [];
  BROWSER_DONE[course] = [...new Set([...ids, stageId])];
  applyPersonalDone();
  render();
};

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
    MAP_PREVIEW = null;
    /* derive from the URL (initial load, back/forward) */
    const params = new URLSearchParams(location.search);
    const challenge = params.get("challenge");
    const node = params.get("node");
    const course = params.get("course");
    const stage = Number(params.get("stage"));
    const view = params.get("view");
    if (challenge && findChallenge(challenge)) {
      VIEW = "work";
      SELECTED = { kind: "challenge", id: challenge };
      STAGE = null;
    } else if (view === "course" && course && COURSE_TREES[course]) {
      VIEW = "course";
      SELECTED = { kind: "course", id: course };
      STAGE = null;
    } else if (node && findItem(node)) {
      VIEW = view === "work" ? "work" : "map";
      SELECTED = { kind: "node", id: node };
      STAGE = VIEW === "work" && Number.isInteger(stage) && stage > 0 ? stage : null;
    } else if (view === "work" || view === "map" || view === "home") {
      VIEW = view;
      SELECTED = null;
      STAGE = null;
    } else {
      VIEW = "home";
      SELECTED = null;
      STAGE = null;
    }
  }
  if (push) {
    const q = new URLSearchParams();
    q.set("view", VIEW);
    if (VIEW === "course" && SELECTED?.kind === "course") {
      q.set("course", SELECTED.id);
    } else if (SELECTED) {
      q.set(SELECTED.kind === "challenge" ? "challenge" : "node", SELECTED.id);
    }
    if (VIEW === "work" && STAGE) q.set("stage", STAGE);
    history.pushState({}, "", `${location.pathname}?${q}`);
  }
  render();
}

function go(view) { MAP_PREVIEW = null; STAGE = null; VIEW = view; applyRoute(true); }
function selectChallenge(slug) {
  MAP_PREVIEW = null;
  STAGE = null;
  VIEW = "work";
  const challenge = findChallenge(slug);
  const node = challenge ? null : findNodeByCourse(slug);
  SELECTED = challenge ? { kind: "challenge", id: slug }
    : node ? { kind: "node", id: node.id } : null;
  applyRoute(true);
}
function selectNode(id, view = "map") {
  MAP_PREVIEW = null;
  STAGE = null;
  VIEW = view;
  SELECTED = findItem(id) ? { kind: "node", id } : null;
  applyRoute(true);
}
function selectCourse(course) {
  if (!COURSE_TREES[course]) return;
  MAP_PREVIEW = null;
  STAGE = null;
  VIEW = "course";
  SELECTED = { kind: "course", id: course };
  applyRoute(true);
}
function openStage(course, stage) {
  const item = findNodeByCourse(course);
  if (!item) return;
  MAP_PREVIEW = null;
  STAGE = stage;
  VIEW = "work";
  SELECTED = { kind: "node", id: item.id };
  applyRoute(true);
}

/* ---------------------------------------------------------------- render */
let LAST_VIEW = null;
function render() {
  if (!STATE) return; // init loads state before first paint
  $$(".zj-nav-btn[data-view]").forEach((b) => {
    b.classList.toggle("is-active",
      b.dataset.view === VIEW || (VIEW === "course" && b.dataset.view === "map"));
  });
  $("#view-home").hidden = VIEW !== "home";
  $("#view-work").hidden = VIEW !== "work";
  $("#view-map").hidden = VIEW !== "map";
  $("#view-course").hidden = VIEW !== "course";
  if (VIEW === "home") renderHome();
  if (VIEW === "work") renderWork();
  if (VIEW === "map") {
    /* every visit starts centered on the core */
    if (VIEW !== LAST_VIEW) fitTree(true);
    renderMap();
  }
  if (VIEW === "course") renderCourse();
  LAST_VIEW = VIEW;
}

/* home -------------------------------------------------------------- */
const HOME_TRACK = [
  { course: "aws-from-scratch", id: "A1", title: "Build your own AWS",
    blurb: "Learn about IAM, S3, leased queues, DynamoDB and more", logo: "logos/aws.svg", cat: "Distributed" },
  { course: "infrastructure-from-scratch", id: "A5", title: "Build your own Infrastructure",
    blurb: "Learn about caching, rate limits, queues, capacity and more", logo: "logos/infra.svg", cat: "Distributed" },
  { course: "llm-from-scratch", id: "A2", title: "Build your own LLM",
    blurb: "Learn about tokenization, attention, sampling, KV cache and more", logo: "logos/llm.svg", cat: "AI" },
  { course: "evals-from-scratch", id: "C1", title: "Build your own Evals",
    blurb: "Learn about metrics, judges, significance, the gate and more", logo: "logos/evals.svg", cat: "AI" },
  { course: "agents-from-scratch", id: "C2", title: "Build your own Agents",
    blurb: "Learn about tool loops, retries, sandboxes, budgets and more", logo: "logos/agents.svg", cat: "AI" },
];
const HOME_MORE = [
  ["autograd", "autograd-from-scratch", "Autograd", "AI", "Reverse-mode differentiation, one op at a time", "autograd"],
  ["rag", "rag-from-scratch", "RAG", "AI", "Chunking, retrieval, reranking, grounding", "rag"],
  ["vector-index", "vector-index-from-scratch", "Vector index", "AI", "HNSW graphs and nearest-neighbour search", "hnsw"],
  ["mcp", "mcp-from-scratch", "MCP server", "AI", "Tools, resources and the protocol wire", "mcp"],
  ["agent-harness", "agent-harness-from-scratch", "Agent harness", "AI", "Environments, rollouts and scoring", "harness"],
  ["context-caching", "context-caching", "KV cache", "AI", "Prefix, paged and radix caches", "kvcache"],
  ["cuda", "cuda-from-scratch", "CUDA kernels", "Systems", "Threads, blocks, shared memory", "cuda"],
  ["cpu", "cpu-from-scratch", "CPU", "Systems", "An ISA, a decoder and a pipeline", "cpu"],
  ["os", "os-from-scratch", "Operating system", "Systems", "Processes, paging, syscalls", "os"],
  ["c-compiler", "c-compiler", "C compiler", "Systems", "Lexer, parser, codegen, optimizer", "compiler"],
  ["shell", "shell-from-scratch", "Shell", "Systems", "Fork, exec, pipes and job control", "shell"],
  ["git", "git-from-scratch", "Git", "Systems", "Objects, trees, commits and refs", "git"],
  ["compression", "compression-from-scratch", "Compression", "Systems", "Huffman, LZ77, DEFLATE", "compress"],
  ["query-engine", "query-engine-from-scratch", "Query engine", "Systems", "Scans, joins, a planner", "sql"],
  ["consensus", "consensus-from-scratch", "Consensus", "Distributed", "Leader election and log replication", "consensus"],
  ["dynamo", "dynamo-paper", "Dynamo", "Distributed", "Consistent hashing, quorums, hinted handoff", "dynamo"],
  ["queue-and-workers", "queue-and-workers-from-scratch", "Queue & workers", "Distributed", "Leases, retries, dead letters", "queue"],
  ["durable-execution", "durable-execution-from-scratch", "Durable execution", "Distributed", "Replayable workflows", "durable"],
  ["distributed-training", "distributed-training-from-scratch", "Distributed training", "Distributed", "Data, tensor and pipeline parallel", "disttrain"],
  ["tcp-ip", "tcp-ip-from-scratch", "TCP/IP", "Networking", "Handshakes, windows, retransmits", "tcp"],
  ["websocket", "websocket-from-scratch", "WebSocket", "Networking", "Framing, masking, the upgrade", "websocket"],
  ["mqtt-broker", "mqtt-broker-from-scratch", "MQTT broker", "Networking", "Topics, QoS and retained messages", "mqtt"],
  ["concurrent-servers", "concurrent-servers-from-scratch", "Concurrent servers", "Networking", "Threads, event loops, backpressure", "servers"],
  ["blockchain", "blockchain-from-scratch", "Blockchain", "Networking", "Keys, ledgers and a gossip net", "chain"],
  ["credit-origination", "credit-origination-from-scratch", "Credit origination", "Finance", "Policy rules and decisioning", "credit"],
  ["irb-capital", "irb-capital-from-scratch", "IRB capital", "Finance", "PD, LGD, EAD and RWA", "capital"],
  ["sas-lgd", "sas-lgd-from-scratch", "SAS LGD", "Finance", "Contagion, recoveries and weighted LGD", "capital"],
  ["lbo-model", "lbo-model-from-scratch", "LBO model", "Finance", "Debt schedules and returns", "lbo"],
  ["distressed-debt", "distressed-debt-from-scratch", "Distressed debt", "Finance", "Waterfalls and recoveries", "debt"],
];
const HOME_FILTERS = ["All", "AI", "Systems", "Distributed", "Networking", "Finance"];
const HOME_STATE = { complete: "#54d1a4", doing: "#e0b44e", ready: "#6B747C", blocked: "#6B747C" };
let HOME_SEL = null;

function homeEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function homeProgress(stages, checks) {
  const total = checks?.total || stages.length || 0;
  const done = checks?.total ? Number(checks.passed || 0) : completion(stages).done;
  return { done, total };
}
function homeState(done, total, raw) {
  if (total > 0 && done >= total) return "complete";
  if (done > 0 || raw === "doing") return "doing";
  if (raw === "blocked" || raw === "missing") return "blocked";
  return "ready";
}
function homeBaseStages(stages) {
  return stages.map((s) => ({
    file: s.file || `stage_${String(s.id).padStart(2, "0")}.py`,
    status: s.status || "TODO",
    title: s.title || "",
    sym: (s.status === "PASS" || s.status === "PERSONAL" || s.status === "BROWSER") ? "✓"
      : s.status === "FAIL" ? "✗" : "·",
    color: (s.status === "PASS" || s.status === "PERSONAL" || s.status === "BROWSER") ? "#54d1a4"
      : s.status === "FAIL" ? "#d05a5a" : "#6B747C",
  }));
}
function homeRow(def, node, checks, stages, rawState) {
  const { done, total } = homeProgress(stages, checks);
  const state = homeState(done, total, rawState);
  const next = node?.next_step && done < total ? node.next_step : null;
  const baseCmd = `forja test ${def.course}`;
  return {
    slug: def.course || def.slug,
    id: def.id,
    title: def.title,
    blurb: def.blurb,
    logo: asset(def.logo),
    cat: def.cat,
    done, total, state,
    stateLabel: stateLabel(state),
    stateColor: HOME_STATE[state] || HOME_STATE.ready,
    stageLabel: (state === "doing" || state === "complete") ? `${done}/${total} stages` : `${total} stages`,
    pct: total ? `${Math.round((done / total) * 100)}%` : "0%",
    cmd: next ? `${baseCmd} --stage ${next}` : baseCmd,
    nextStage: next,
    stages: homeBaseStages(stages),
  };
}
function homeRows() {
  const tracks = HOME_TRACK.map((def) => {
    const row = trackRows().find((r) => r.slug === def.course);
    const node = findNodeByCourse(def.course);
    const stages = node?.stages || row?.stages_detail || [];
    const checks = row?.checks || node?.checks || null;
    return homeRow(def, node, checks, stages, row?.state || node?.state);
  });
  const more = HOME_MORE.map(([slug, course, title, cat, blurb, logo]) => {
    const item = allItems().find((i) => i.course === course) || null;
    const stages = item?.stages || [];
    const checks = item?.checks || null;
    return homeRow({
      slug, course, title: `Build your own ${title}`, cat, blurb,
      logo: `logos/${logo}.svg`, id: cat[0] + "·",
    }, item, checks, stages, item?.state);
  });
  return { tracks, more };
}
function homeFilterButton(label) {
  const on = label === FILTER;
  return `<button type="button" class="zj-filter${on ? " is-active" : ""}" data-home-filter="${homeEsc(label)}" style="border:1px solid ${on ? "#F4F4F5" : "rgba(255,255,255,.07)"};background:${on ? "#F4F4F5" : "transparent"};color:${on ? "#191B24" : "#9AA3AB"}">${homeEsc(label)}</button>`;
}
function homeTrackCard(row) {
  return `<button type="button" class="zj-track-card" data-home-slug="${homeEsc(row.slug)}" style="border-color:${HOME_SEL === row.slug ? "#D6D8DC" : "rgba(255,255,255,.07)"}">
    <span class="zj-track-id">${homeEsc(row.id)}</span>
    <span class="zj-track-logo"><img src="${row.logo}" alt="" width="72" height="72"></span>
    <span class="zj-track-title">${homeEsc(row.title)}</span>
    <span class="zj-track-blurb">${homeEsc(row.blurb)}</span>
    <span class="zj-track-foot">
      <span class="zj-progress"><span style="width:${row.pct};background:${row.stateColor}"></span></span>
      <span class="zj-track-meta"><span>${homeEsc(row.stageLabel)}</span><span style="color:${row.stateColor}">${homeEsc(row.stateLabel)}</span></span>
    </span>
  </button>`;
}
function homeMoreCard(row) {
  return `<button type="button" class="zj-more-card" data-home-slug="${homeEsc(row.slug)}" style="border-color:${HOME_SEL === row.slug ? "#D6D8DC" : "rgba(255,255,255,.07)"}">
    <span class="zj-more-top">
      <span class="zj-more-logo"><img src="${row.logo}" alt="" width="48" height="48"></span>
      <span class="zj-more-copy"><span class="zj-more-title">${homeEsc(row.title)}</span><span class="zj-more-cat">${homeEsc(row.cat)}</span></span>
    </span>
    <span class="zj-more-blurb">${homeEsc(row.blurb)}</span>
    <span class="zj-more-foot"><span>${homeEsc(row.stageLabel)}</span><span style="color:${row.stateColor}">${row.state === "complete" ? "●" : row.state === "doing" ? "◐" : "○"}</span></span>
  </button>`;
}
function homeDrawer(row) {
  if (!row) return "";
  return `<div class="zj-drawer-back" data-home-close></div>
  <aside class="zj-drawer" role="dialog" aria-modal="true" aria-label="${homeEsc(row.title)}">
    <div class="zj-drawer-head">
      <span style="color:${row.stateColor}">${homeEsc(row.stateLabel)} · ${homeEsc(row.id)}</span>
      <button type="button" class="zj-close" data-home-close aria-label="Close">×</button>
    </div>
    <div class="zj-drawer-title"><img src="${row.logo}" width="64" height="64" alt=""><h2>${homeEsc(row.title)}</h2></div>
    <p class="zj-drawer-blurb">${homeEsc(row.blurb)}</p>
    <div class="zj-drawer-cmd"><code>${homeEsc(row.cmd)}</code><button type="button" class="zj-copy" data-copy-text="${homeEsc(row.cmd)}">Copy</button><button type="button" class="zj-copy" data-home-open="${homeEsc(row.slug)}">Open workspace</button></div>
    <h3>Progress</h3>
    <div class="zj-progress zj-progress-lg"><span style="width:${row.pct};background:${row.stateColor}"></span></div>
    <p class="zj-drawer-meta">${homeEsc(row.stageLabel)}</p>
    <h3>Stages</h3>
    <ul class="zj-stages">${row.stages.map((s) => `<li><span style="color:${s.color}">${s.sym}</span><span class="zj-stage-file">${homeEsc(s.file)}</span><span class="zj-stage-status">${homeEsc(s.status)}</span></li>`).join("")}</ul>
  </aside>`;
}
function renderHome() {
  const root = $("#home-root");
  if (!root || !STATE) return;
  const { tracks, more } = homeRows();
  const all = [...tracks, ...more];
  const next = STATE.next;
  const nextRow = next ? (all.find((r) => r.slug === next.course) || null) : null;
  const continueLogo = nextRow?.logo || asset(next ? `logos/${next.logo || "forge"}.svg` : "logos/forge.svg");
  const continueTitle = next?.headline || next?.title || next?.course || "";
  const continueCmd = next?.command || (nextRow ? `forja test ${nextRow.slug}` : "");
  const continueStage = next?.stage ? `Stage ${String(next.stage).padStart(2, "0")} · ${next.file || ""}` : nextRow?.stageLabel || "";
  const completed = tracks.filter((r) => r.state === "complete").length;
  const doing = tracks.filter((r) => r.state === "doing").length;
  const totalStages = all.reduce((sum, r) => sum + (r.total || 0), 0);
  const showTrack = FILTER === "All";
  const pool = showTrack ? more : all.filter((r) => r.cat === FILTER);
  const moreHead = showTrack ? "More challenges" : FILTER;
  const selected = HOME_SEL ? all.find((r) => r.slug === HOME_SEL) : null;
  root.innerHTML = `
  <section class="zj-hero">
    <div>
      <p class="zj-eyebrow">$ forja test --stage 1</p>
      <h1>Forge the systems<br>you use every day.</h1>
      <p class="zj-lede">Rebuild AWS, an LLM, a shell, Git — from scratch, in your own editor, graded locally stage by stage. <a href="#how">New here? See how it works.</a></p>
      <dl class="zj-stats">
        <div><dt>Challenges</dt><dd>${all.length}</dd></div>
        <div><dt>Stages</dt><dd>${totalStages}</dd></div>
        <div><dt>Complete</dt><dd class="zj-green">${completed}/${tracks.length}</dd></div>
        <div><dt>In progress</dt><dd class="zj-amber">${doing}</dd></div>
      </dl>
    </div>
    <div class="zj-hero-mark"><img src="logos/forja.svg" width="176" height="176" alt="forja"></div>
  </section>

  ${next ? `<section class="zj-continue">
    <img src="${continueLogo}" width="56" height="56" alt="">
    <div class="zj-continue-copy">
      <p>Continue where you left off</p>
      <h2>${homeEsc(continueTitle)}</h2>
      <p class="zj-continue-meta">${homeEsc(continueStage)}</p>
    </div>
    <div class="zj-continue-actions">
      <code>${homeEsc(continueCmd)}</code>
      <button type="button" class="zj-copy" data-copy-text="${homeEsc(continueCmd)}">Copy</button>
      ${next ? `<button type="button" class="zj-copy" data-home-open="${homeEsc(next.course || "")}">Continue</button>` : ""}
    </div>
  </section>` : ""}

  <section class="zj-catalog" id="challenges">
    <div class="zj-catalog-head">
      <div><h2>Pick a challenge</h2><p>Each one is a real system, split into stages. Select a card to see stages and the exact command.</p></div>
      <div class="zj-filters">${HOME_FILTERS.map(homeFilterButton).join("")}</div>
    </div>
    ${showTrack ? `<p class="zj-kicker"><b>Track</b> · the five-course prep path</p>
    <div class="zj-track-grid">${tracks.map(homeTrackCard).join("")}</div>` : ""}
    <p class="zj-kicker" id="path"><b>${homeEsc(moreHead)}</b> · ${pool.length} challenges</p>
    <div class="zj-more-grid">${pool.map(homeMoreCard).join("")}</div>
  </section>

  <section class="zj-how" id="how">
    <h2>Simple by design</h2>
    <p>Pick a challenge, open your editor, <code>forja test</code>. That’s it.</p>
    <ol>
      <li><span>1</span><div><h3>Choose your challenge</h3><p>AWS, Infrastructure, LLM, Evals, Agents — real systems, not toy drills.</p></div></li>
      <li><span>2</span><div><h3>Code in your own setup</h3><p>Your IDE, your extensions, your terminal. No toy editors.</p></div></li>
      <li><span>3</span><div><h3>Test and get feedback</h3><p><code>forja test</code> runs the grader. Causes and hints in seconds.</p></div></li>
    </ol>
  </section>

  <footer class="zj-footer">
    <div><img src="logos/forja.svg" width="22" height="22" alt=""><span>The engine is the CLI — this page only reads it.</span></div>
    <ul>
      <li><code>./forja track</code><span>the five-course prep track</span></li>
      <li><code>./forja guide &lt;course&gt; 1</code><span>one stage’s page</span></li>
      <li><code>./forja test &lt;course&gt;</code><span>run the grader</span></li>
      <li><code>cz next</code><span>the next action</span></li>
    </ul>
  </footer>
  ${homeDrawer(selected)}`;
}

/* home events: cards, filters, drawer, copy. The root is stable; only its
   contents are replaced, so one delegated listener is enough. */
function homeOpen(slug) {
  if (!slug) return;
  const item = allItems().find((i) => i.course === slug || i.id === slug);
  const course = item?.course || slug;
  const node = findNodeByCourse(course) || item;
  if (!node) return;
  HOME_SEL = null;
  if (node.course) {
    if (node.next_step) openStage(node.course, node.next_step);
    else selectChallenge(node.course);
  } else {
    selectNode(node.id, "work");
  }
}

function bindHome() {
  const root = $("#home-root");
  if (!root) return;
  root.addEventListener("click", async (event) => {
    const filter = event.target.closest("[data-home-filter]");
    if (filter) {
      FILTER = filter.dataset.homeFilter;
      HOME_SEL = null;
      renderHome();
      return;
    }
    const close = event.target.closest("[data-home-close]");
    if (close) {
      HOME_SEL = null;
      renderHome();
      return;
    }
    const card = event.target.closest("[data-home-slug]");
    if (card) {
      HOME_SEL = card.dataset.homeSlug;
      renderHome();
      return;
    }
    const open = event.target.closest("[data-home-open]");
    if (open) {
      event.stopPropagation();
      homeOpen(open.dataset.homeOpen);
      return;
    }
    const copy = event.target.closest("[data-copy-text]");
    if (copy) {
      event.stopPropagation();
      const text = copy.dataset.copyText;
      const ok = await copyText(text);
      const old = copy.textContent;
      copy.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { copy.textContent = old; }, 1600);
    }
  });
  const scrollHome = (id) => {
    if (VIEW !== "home") go("home");
    requestAnimationFrame(() => $(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  $("#nav-how")?.addEventListener("click", () => scrollHome("#how"));
}

/* work -------------------------------------------------------------- */
function setWorkMode(mode) {
  const browser = mode === "browser" && !!WORK_COURSE && !!WORK_STAGE;
  WORK_MODE = browser ? "browser" : "local";
  const view = $("#view-work");
  if (!view) return;
  view.classList.toggle("is-browser", browser);
  view.classList.toggle("is-local", !browser);
  const ribbon = $("#v2-ribbon");
  if (ribbon) ribbon.hidden = !browser;
  const split = $("#v2-split");
  if (split) split.hidden = !browser;
  const tests = $("#v2-tests");
  if (tests) tests.hidden = browser || view.hidden;
  const editor = $("#browser-editor");
  if (editor) editor.hidden = !browser;
  const browserBtn = $("#w-open-editor");
  const localBtn = $("#w-local-mode");
  if (browserBtn) browserBtn.setAttribute("aria-pressed", String(browser));
  if (localBtn) localBtn.setAttribute("aria-pressed", String(!browser));
  if (browser) requestAnimationFrame(() => {
    const cm = $("#editor-code-area .CodeMirror");
    if (cm?.CodeMirror) cm.CodeMirror.refresh();
  });
}

function openWorkEditor() {
  if (!WORK_COURSE || !WORK_STAGE) return;
  setWorkMode("browser");
  return window.forjaEditor?.open(WORK_COURSE, WORK_STAGE);
}

function resetWorkMode() {
  WORK_MODE = "local";
  const view = $("#view-work");
  if (view) {
    view.classList.remove("is-browser");
    view.classList.add("is-local");
  }
  const ribbon = $("#v2-ribbon");
  if (ribbon) ribbon.hidden = true;
  const split = $("#v2-split");
  if (split) split.hidden = true;
  const tests = $("#v2-tests");
  if (tests) tests.hidden = false;
  const editor = $("#browser-editor");
  if (editor) editor.hidden = true;
  $("#w-open-editor")?.setAttribute("aria-pressed", "false");
  $("#w-local-mode")?.setAttribute("aria-pressed", "true");
}

/* Resizable workspace tiles: brief/editor and code/console. Values persist
   per browser; double-click and Enter reset to the v2 defaults. */
const WORK_SPLIT_KEY = "forja.work.split.v1";
const WORK_CONSOLE_KEY = "forja.work.console.v1";
function savedNumber(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch { return fallback; }
}
let workSplitPct = savedNumber(WORK_SPLIT_KEY, 42);
let workConsolePx = savedNumber(WORK_CONSOLE_KEY, 300);
function refreshWorkEditor() {
  requestAnimationFrame(() => {
    const cm = $("#editor-code-area .CodeMirror")?.CodeMirror;
    cm?.refresh();
  });
}
function applyWorkSplit(value, persist = true) {
  workSplitPct = Math.max(24, Math.min(70, Number(value) || 42));
  $("#work-main")?.style.setProperty("--work-split", workSplitPct.toFixed(2));
  if (persist) {
    try { localStorage.setItem(WORK_SPLIT_KEY, workSplitPct.toFixed(2)); } catch { /* storage disabled */ }
  }
  refreshWorkEditor();
}
function applyWorkConsole(value, persist = true) {
  const pane = $("#browser-editor");
  const height = pane?.offsetHeight || 0;
  const maximum = height > 240 ? height - 150 : 10000;
  workConsolePx = Math.max(110, Math.min(maximum, Number(value) || 300));
  pane?.style.setProperty("--editor-console-h", `${Math.round(workConsolePx)}px`);
  if (persist) {
    try { localStorage.setItem(WORK_CONSOLE_KEY, String(Math.round(workConsolePx))); } catch { /* storage disabled */ }
  }
  refreshWorkEditor();
}
function bindWorkResizers() {
  const column = $("#v2-split");
  if (column) {
    column.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const main = $("#work-main");
      const rect = main.getBoundingClientRect();
      const move = (ev) => applyWorkSplit(((ev.clientX - rect.left) / rect.width) * 100);
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.classList.remove("resizing-tiles", "v2-col");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      document.body.classList.add("resizing-tiles", "v2-col");
    };
    column.ondblclick = () => applyWorkSplit(42);
    column.onkeydown = (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        applyWorkSplit(workSplitPct + (event.key === "ArrowLeft" ? -2 : 2));
      }
      if (event.key === "Enter") applyWorkSplit(42);
    };
  }
  const row = $("#v2-editor-split");
  if (row) {
    row.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = $("#browser-editor").getBoundingClientRect();
      const move = (ev) => applyWorkConsole(rect.bottom - ev.clientY - 5);
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.classList.remove("resizing-tiles", "v2-row");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      document.body.classList.add("resizing-tiles", "v2-row");
    };
    row.ondblclick = () => applyWorkConsole(300);
    row.onkeydown = (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        applyWorkConsole(workConsolePx + (event.key === "ArrowUp" ? 20 : -20));
      }
      if (event.key === "Enter") applyWorkConsole(300);
    };
  }
}

function renderWorkTests(data) {
  const list = $("#v2-tests-list");
  const score = $("#v2-tests-score");
  if (!list) return;
  list.replaceChildren();
  const rows = data?.rows || [];
  for (const row of rows) {
    const li = document.createElement("li");
    li.dataset.status = row.status || "pending";
    const sym = document.createElement("span");
    sym.className = "v2-test-sym";
    sym.textContent = { passed: "✓", failed: "✗", error: "!", pending: "○" }[row.status] || "○";
    const label = document.createElement("span");
    label.className = "v2-test-label";
    label.textContent = row.label;
    li.append(sym, label);
    list.appendChild(li);
  }
  if (score) {
    const total = data?.total ?? rows.length;
    const failed = rows.some((row) => row.status === "failed" || row.status === "error");
    score.textContent = data ? `${data.passed} / ${total}` : "—";
    score.dataset.complete = String(Boolean(data && data.passed === total && total > 0));
    score.dataset.failed = String(Boolean(data && failed));
  }
}

const reviewPlayback = { timer: null, paused: true, speed: 1, current: 0, total: 0, rows: [], bubbles: [] };
function stopReviewPlayback() {
  clearInterval(reviewPlayback.timer);
  reviewPlayback.timer = null;
}
function paintReviewFrame() {
  const { current, rows, bubbles, total } = reviewPlayback;
  for (const row of rows) {
    const line = Number(row.dataset.line);
    row.classList.toggle("is-seen", line <= current);
    row.classList.toggle("is-current", line === current);
  }
  for (const bubble of bubbles) {
    bubble.classList.toggle("is-on", Number(bubble.dataset.line) <= current);
  }
  const progress = $("#v2-review-progress");
  if (progress) progress.style.width = `${total ? (current / total) * 100 : 0}%`;
}
function finishReviewPlayback() {
  stopReviewPlayback();
  reviewPlayback.paused = true;
  reviewPlayback.current = reviewPlayback.total;
  paintReviewFrame();
  const toggle = $("#v2-review-toggle");
  if (toggle) toggle.textContent = "Play";
  const footer = $("#v2-review-foot");
  if (footer) footer.hidden = false;
}
function startReviewPlayback() {
  stopReviewPlayback();
  reviewPlayback.paused = false;
  const toggle = $("#v2-review-toggle");
  if (toggle) toggle.textContent = "Pause";
  $("#v2-review-foot").hidden = true;
  reviewPlayback.timer = setInterval(() => {
    if (reviewPlayback.paused) return;
    reviewPlayback.current += 1;
    paintReviewFrame();
    if (reviewPlayback.current >= reviewPlayback.total) finishReviewPlayback();
  }, 70 / reviewPlayback.speed);
}
function resetReviewPlayback() {
  stopReviewPlayback();
  reviewPlayback.current = 0;
  paintReviewFrame();
  startReviewPlayback();
}
const REVIEW_LAST_PREFIX = "forja.review.last.v1:";
function reviewSourceLines(text) {
  const lines = String(text ?? "").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function changedLineNumbers(before, after) {
  const a = reviewSourceLines(before);
  const b = reviewSourceLines(after);
  if (a.length === b.length && a.every((line, index) => line === b[index])) return new Set();
  if (a.length * b.length > 4000000) return new Set(b.map((_, index) => index + 1));
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const changed = new Set();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { i -= 1; j -= 1; continue; }
    if (table[i - 1][j] >= table[i][j - 1]) i -= 1;
    else { changed.add(j); j -= 1; }
  }
  while (j > 0) { changed.add(j); j -= 1; }
  if (!changed.size && before !== after) return new Set(b.map((_, index) => index + 1));
  return changed;
}
function closeWorkReview() {
  stopReviewPlayback();
  reviewPlayback.paused = true;
  const modal = $("#v2-review-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("review-open");
}
function openWorkReview(snapshot) {
  const modal = $("#v2-review-modal");
  const codeBox = $("#v2-review-code");
  const commentBox = $("#v2-review-comments");
  if (!modal || !codeBox || !commentBox || !snapshot) return;
  stopReviewPlayback();
  codeBox.replaceChildren();
  commentBox.replaceChildren();

  const lines = reviewSourceLines(snapshot.source);
  const lastKey = REVIEW_LAST_PREFIX + `${WORK_COURSE}:${snapshot.stage.id}:${snapshot.file}`;
  let previous = null;
  try { previous = localStorage.getItem(lastKey); } catch { /* storage disabled */ }
  const changed = previous === null ? null : changedLineNumbers(previous, snapshot.source);
  const changedCount = changed ? changed.size : 0;
  const byLine = new Map();
  for (const row of snapshot.review.lines || []) {
    if (changed && !changed.has(row.line)) continue;
    for (const comment of row.comments || []) {
      const list = byLine.get(row.line) || [];
      list.push(comment);
      byLine.set(row.line, list);
    }
  }

  reviewPlayback.rows = [];
  reviewPlayback.bubbles = [];
  reviewPlayback.current = 0;
  reviewPlayback.total = lines.length;
  reviewPlayback.speed = 1;

  const scope = changed ? (changedCount ? ` · ${changedCount} changed line${changedCount === 1 ? "" : "s"}` : " · no changes") : "";
  $("#v2-review-title").textContent = `Code review · ${snapshot.file}`;
  $("#v2-review-sub").textContent = `Stage ${String(snapshot.stage.id).padStart(2, "0")} · ${snapshot.stage.target || snapshot.stage.file}${scope}`;
  const bad = [...byLine.values()].reduce((sum, list) => sum + list.length, 0);
  $("#v2-review-bad").textContent = `✗ ${bad} issue${bad === 1 ? "" : "s"}`;
  const scopeCount = changed ? changedCount : lines.length;
  const flagged = byLine.size;
  $("#v2-review-good").textContent = changed && !changedCount
    ? "✓ no changes"
    : `✓ ${Math.max(0, scopeCount - flagged)} line${scopeCount - flagged === 1 ? "" : "s"} clean`;
  const noChanges = Boolean(changed && !changedCount);
  $("#v2-review-toggle").textContent = "Pause";
  $("#v2-review-speed").textContent = "1×";
  $("#v2-review-foot").hidden = true;
  $("#v2-review-foot-text").textContent = noChanges
    ? "No code changes since the last review."
    : "Review complete. Fix the highlighted lines, then run again.";
  $("#v2-review-replay").hidden = noChanges;
  $("#v2-review-progress").style.width = "0%";

  lines.forEach((text, index) => {
    const line = index + 1;
    const row = document.createElement("div");
    const inScope = !changed || changed.has(line);
    row.className = `v2-rv-line${byLine.has(line) ? " is-bad" : ""}${inScope && changed ? " is-changed" : ""}${changed && !inScope ? " is-unchanged" : ""}`;
    row.dataset.line = String(line);
    const number = document.createElement("span");
    number.className = "n";
    number.textContent = String(line);
    const content = document.createElement("span");
    content.className = "code";
    content.textContent = text || " ";
    row.append(number, content);
    codeBox.appendChild(row);
    reviewPlayback.rows.push(row);
  });

  try { localStorage.setItem(lastKey, snapshot.source); } catch { /* storage disabled */ }

  for (const [line, comments] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const bubble = document.createElement("div");
    bubble.className = `v2-rv-bubble${comments.some((c) => c.kind === "error") ? " is-error" : ""}`;
    bubble.dataset.line = String(line);
    bubble.style.top = `${(line - 1) * 22 + 8}px`;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `Line ${line} · ${comments.some((c) => c.kind === "error") ? "error" : "guideline"}`;
    const message = document.createElement("span");
    message.className = "msg";
    message.textContent = comments.map((c) => c.message).join(" ");
    bubble.append(tag, message);
    commentBox.appendChild(bubble);
    reviewPlayback.bubbles.push(bubble);
  }

  modal.hidden = false;
  document.body.classList.add("review-open");
  paintReviewFrame();
  requestAnimationFrame(() => {
    $("#v2-review-close")?.focus();
    if (noChanges) finishReviewPlayback();
    else startReviewPlayback();
  });
}
async function playWorkReview() {
  if (!WORK_COURSE || !WORK_STAGE) return;
  let snapshot = window.forjaEditor?.review?.();
  if (!snapshot) {
    await window.forjaEditor?.open(WORK_COURSE, WORK_STAGE);
    snapshot = window.forjaEditor?.review?.();
  }
  if (snapshot) openWorkReview(snapshot);
}
function bindReviewModal() {
  const modal = $("#v2-review-modal");
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = "1";
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeWorkReview();
  });
  $("#v2-review-close")?.addEventListener("click", closeWorkReview);
  $("#v2-review-replay")?.addEventListener("click", resetReviewPlayback);
  $("#v2-review-toggle")?.addEventListener("click", () => {
    if (reviewPlayback.paused) {
      if (reviewPlayback.current >= reviewPlayback.total) resetReviewPlayback();
      else startReviewPlayback();
    } else {
      reviewPlayback.paused = true;
      stopReviewPlayback();
      $("#v2-review-toggle").textContent = "Play";
    }
  });
  $("#v2-review-speed")?.addEventListener("click", () => {
    reviewPlayback.speed = reviewPlayback.speed === 1 ? 2 : reviewPlayback.speed === 2 ? 4 : 1;
    $("#v2-review-speed").textContent = `${reviewPlayback.speed}×`;
    if (!reviewPlayback.paused) startReviewPlayback();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#v2-review-modal")?.hidden) closeWorkReview();
  });
}

function renderWorkRibbon(logo, title, checks, stages, current, course) {
  const ribbon = $("#v2-ribbon");
  if (!ribbon) return;
  const done = completion(stages).done;
  ribbon.replaceChildren();
  const head = document.createElement("div");
  head.className = "v2-ribbon-head";
  const img = document.createElement("img");
  img.src = asset(logo);
  img.width = 24;
  img.height = 24;
  img.alt = "";
  const name = document.createElement("span");
  name.className = "v2-ribbon-title";
  name.textContent = title;
  const count = document.createElement("span");
  count.className = "v2-ribbon-count mono";
  count.textContent = `${fmt.format(done)} / ${fmt.format(stages.length)}`;
  head.append(img, name, count);

  const ol = document.createElement("ol");
  ol.className = "v2-ribbon-stages";
  for (const s of stages) {
    const li = document.createElement("li");
    const active = current && s.id === current.id;
    li.className = active ? "is-current" : "";
    const sym = { PASS: "✓", PERSONAL: "✓", BROWSER: "✓", FAIL: "✗", ERROR: "✗" }[s.status] || "○";
    const symbol = document.createElement("span");
    symbol.className = "v2-ribbon-sym";
    symbol.textContent = sym;
    const number = document.createElement("span");
    number.className = "v2-ribbon-num";
    number.textContent = String(s.id).padStart(2, "0");
    li.append(symbol, number);
    if (active) {
      const label = document.createElement("span");
      label.className = "v2-ribbon-label";
      label.textContent = s.title;
      const meta = document.createElement("span");
      meta.className = "v2-ribbon-meta mono";
      meta.textContent = s.file;
      li.append(label, meta);
    }
    li.title = `${String(s.id).padStart(2, "0")} · ${s.title}`;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.onclick = () => openStage(course, s.id);
    li.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openStage(course, s.id);
      }
    };
    ol.appendChild(li);
  }
  ribbon.append(head, ol);
}

function prepareWorkShell() {
  const main = $("#work-main");
  const editor = $("#browser-editor");
  if (main && editor && editor.parentElement !== main) main.appendChild(editor);
  const slot = $("#v2-tests-legacy");
  const source = $("#w-source-wrap");
  const run = $(".w-run");
  if (slot && source && source.parentElement !== slot) slot.appendChild(source);
  if (slot && run && run.parentElement !== slot) slot.appendChild(run);
  const browserButton = $("#w-open-editor");
  const localButton = $("#w-local-mode");
  const reviewButton = $("#w-play-review");
  const editorReviewButton = $("#editor-review");
  if (browserButton) browserButton.onclick = openWorkEditor;
  if (localButton) localButton.onclick = () => resetWorkMode();
  if (reviewButton) reviewButton.onclick = playWorkReview;
  if (editorReviewButton) editorReviewButton.onclick = playWorkReview;
  bindReviewModal();
  bindWorkResizers();
  applyWorkSplit(workSplitPct, false);
  applyWorkConsole(workConsolePx, false);
  const goHome = $("#v2-home");
  const navHome = $("#v2-nav-home");
  const navWork = $("#v2-nav-work");
  const navDeps = $("#v2-nav-deps");
  const start = $("#v2-start");
  if (goHome) goHome.onclick = () => go("home");
  if (navHome) navHome.onclick = () => go("home");
  if (navWork) navWork.onclick = () => { if (VIEW !== "work") go("work"); };
  if (navDeps) navDeps.onclick = () => go("map");
  if (start) start.onclick = () => $("#gh-signin")?.click();
}

window.forjaWorkspace = {
  setMode: (mode) => setWorkMode(mode),
  onTests: (data) => renderWorkTests(data),
};

function renderWork() {
  prepareWorkShell();
  const empty = $("#work-empty");
  const detail = $("#work-detail");
  const item = SELECTED?.kind === "node" ? findItem(SELECTED.id) : null;
  const track = SELECTED?.kind === "challenge" ? findChallenge(SELECTED.id) : null;
  if (!item && !track) {
    empty.hidden = false;
    detail.hidden = true;
    $("#w-deps").hidden = true;
    resetWorkMode();
    $("#v2-ribbon").hidden = true;
    $("#v2-tests").hidden = true;
    return;
  }
  empty.hidden = true;
  detail.hidden = false;

  const course = item?.course || track?.slug;
  const graph = course ? courseGraph() : null;
  const current = graph?.byCourse.get(course) || null;
  const stages = item?.stages || track?.stages_detail || [];
  const checks = item?.checks || track?.checks || {};
  const logo = track?.logo_url || item?.logo_url || "logos/forge.svg";
  const title = track?.headline || item?.title || course;

  /* header: use the selected stage, or the next one to do */
  const nextStep = item?.next_step || track?.next_step
    || (checks.total ? Math.min((checks.passed || 0) + 1, stages.length) : 1);
  const stage = (Number.isInteger(STAGE) && stages.find((s) => s.id === STAGE))
    || stages.find((s) => s.id === nextStep) || stages[0];
  WORK_COURSE = course || null;
  WORK_STAGE = stage || null;

  $("#w-crumb").textContent = stage
    ? `Stage ${String(stage.id).padStart(2, "0")} · ${stage.file}`
    : (item?.id || track?.id || "");
  $("#w-title").textContent = stage?.title || title;
  $("#w-why").textContent = stage?.why || item?.why || track?.description || "";
  $("#w-why").hidden = !($("#w-why").textContent);

  /* v2 stage dependency chips */
  const uses = $("#w-uses");
  uses.replaceChildren();
  const tree = course ? COURSE_TREES[course] : null;
  const labelFor = (s) => (s.file || "").replace(/\.py$/, "").replace(/_svc$/, "").toUpperCase();
  const addChip = (id, direction) => {
    const other = stages.find((s) => s.id === id);
    if (!other) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `chip ${direction === "uses" ? "chip-req" : "chip-unlock"}`;
    const passed = ["PASS", "PERSONAL", "BROWSER"].includes(other.status);
    chip.textContent = `${direction} ${String(other.id).padStart(2, "0")} ${labelFor(other)}${passed ? " ✓" : ""}`;
    chip.title = `${direction === "uses" ? "Requires" : "Unlocks"} stage ${other.id}: ${other.title}`;
    chip.onclick = () => openStage(course, other.id);
    uses.appendChild(chip);
  };
  const stageDeps = (tree?.deps || []).filter(([, to]) => stage && to === stage.id).map(([from]) => from);
  const stageUnlocks = (tree?.deps || []).filter(([from]) => stage && from === stage.id).map(([, to]) => to);
  for (const id of stageDeps) addChip(id, "uses");
  for (const id of stageUnlocks) addChip(id, "unlocks");
  if (!stageDeps.length && !stageUnlocks.length) {
    const chip = document.createElement("span");
    chip.className = "chip chip-muted";
    chip.textContent = "no stage prerequisites";
    uses.appendChild(chip);
  }

  /* v2 stage brief */
  const spec = stage ? window.forjaEditor?.specFor?.(stage.id, course, stage) : null;
  const ifaceCode = $("#w-v2-interface-code");
  ifaceCode.textContent = (spec?.signatures || []).join("\n");
  $("#w-v2-interface").hidden = !ifaceCode.textContent;

  const reqList = $("#w-v2-req-list");
  reqList.replaceChildren();
  for (const text of stage?.requirements || []) {
    const li = document.createElement("li");
    li.textContent = text;
    reqList.appendChild(li);
  }
  $("#w-v2-requirements").hidden = !reqList.children.length;

  const exampleList = $("#w-v2-example-list");
  exampleList.replaceChildren();
  const exampleWhy = [
    "The stage only needs a non-empty placeholder ETag; stage 11 replaces it.",
    "get_object returns the stored Version, not the raw body.",
    "The body comes back as the exact bytes written.",
    "The full key, slash included, is the dictionary key.",
  ];
  for (let i = 0; i < (spec?.examples || []).length; i += 1) {
    const ex = spec.examples[i];
    const card = document.createElement("div");
    card.className = "v2-example";
    const heading = document.createElement("span");
    heading.className = "v2-example-title";
    heading.textContent = `Example ${i + 1}`;
    const grid = document.createElement("div");
    grid.className = "v2-example-grid";
    const add = (label, value, className = "") => {
      const term = document.createElement("span");
      term.className = "v2-example-label";
      term.textContent = label;
      const detail = document.createElement("span");
      detail.className = `v2-example-value ${className}`.trim();
      detail.textContent = value;
      grid.append(term, detail);
    };
    add("Input", `${spec.setup}\n${ex.call}`);
    add("Output", ex.output);
    add("Why", exampleWhy[i] || stage?.why || "", "v2-example-why");
    card.append(heading, grid);
    exampleList.appendChild(card);
  }
  $("#w-v2-examples").hidden = !exampleList.children.length;

  const scopeList = $("#w-v2-scope-list");
  scopeList.replaceChildren();
  for (const text of stage?.out_of_scope || []) {
    const li = document.createElement("li");
    li.textContent = text;
    scopeList.appendChild(li);
  }
  $("#w-v2-scope").hidden = !scopeList.children.length;

  const hintsRoot = $("#w-v2-hint-list");
  hintsRoot.replaceChildren();
  for (const text of stage?.hints || []) {
    const box = document.createElement("div");
    box.className = "v2-hint";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span>${text}</span><span class="h-sym">+</span>`;
    const body = document.createElement("p");
    body.hidden = true;
    body.textContent = stage?.action || stage?.why || "";
    btn.onclick = () => {
      body.hidden = !body.hidden;
      btn.querySelector(".h-sym").textContent = body.hidden ? "+" : "−";
    };
    box.append(btn, body);
    hintsRoot.appendChild(box);
  }
  $("#w-v2-hints").hidden = !hintsRoot.children.length;

  const pad = stage ? String(stage.id).padStart(2, "0") : "";
  $("#w-v2-review-meta").textContent = stage ? `${stage.file} · stage ${pad}` : "";
  $("#w-v2-review-cta").onclick = null;

  const browserButton = $("#w-open-editor");
  const localButton = $("#w-local-mode");
  const hasWorkspace = !STATE?.workspaces || STATE.workspaces.includes(course);
  const canBrowse = Boolean(course && stage && hasWorkspace);
  browserButton.hidden = !canBrowse;
  localButton.hidden = !canBrowse;
  const playReviewButton = $("#w-play-review");
  if (playReviewButton) playReviewButton.hidden = !hasWorkspace;
  if (canBrowse) {
    browserButton.onclick = openWorkEditor;
    localButton.onclick = resetWorkMode;
    if (WORK_MODE === "browser") {
      setWorkMode("browser");
      if ($("#browser-editor").hidden) window.forjaEditor?.open(course, stage);
      else window.forjaEditor?.onStage(course, stage);
    } else {
      resetWorkMode();
    }
  } else {
    resetWorkMode();
  }

  renderWorkTests(spec ? {
    passed: 0,
    total: spec.cases.length,
    rows: spec.cases.map((test) => ({ label: test.label, status: "pending" })),
  } : null);

  renderSource(course, stage);

  /* commands */
  const cmd = course && stage ? `forja test ${course} --stage ${stage.id}`
    : (item?.command || track?.command || `forja test ${course}`);
  const cmdEl = $("#w-cmd");
  if (cmdEl) cmdEl.textContent = cmd;
  const cmdHint = $("#w-cmd-hint");
  if (cmdHint) cmdHint.textContent = "Runs against the browser draft and saved files.";

  renderStageBar(logo, title, checks, stages, stage, course);
  renderWorkRibbon(logo, title, checks, stages, stage, course);
  renderAllDeps(course, graph);
}

/* ---------------------------------------------------------- stage source */
function sourceKey(course, stage) { return `${course}\u0000${stage}`; }

async function fetchStageSource(course, stage) {
  const key = sourceKey(course, stage);
  if (SOURCE_CACHE.has(key)) return SOURCE_CACHE.get(key);
  const url = `/api/stage-source?course=${encodeURIComponent(course)}&stage=${encodeURIComponent(stage)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`source HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok || !data.source) throw new Error(data.error || "no source target");
  SOURCE_CACHE.set(key, data.source);
  return data.source;
}

function renderSource(course, stage) {
  const wrap = $("#w-source-wrap");
  if (!wrap) return;
  const token = ++SOURCE_TOKEN;
  if (!LIVE || !course || !stage?.action || !stage.file) {
    wrap.hidden = true;
    return;
  }
  const key = sourceKey(course, stage.id);
  const cached = SOURCE_CACHE.get(key);
  if (cached) {
    paintSource(cached, key, stage);
    return;
  }
  if (SOURCE_MISS.has(key)) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $("#w-source-lines").replaceChildren();
  $("#w-source-meta").textContent = "reading source…";
  $("#w-source-note").textContent = "";
  fetchStageSource(course, stage.id)
    .then((source) => {
      if (token !== SOURCE_TOKEN) return;
      paintSource(source, key, stage);
    })
    .catch(() => {
      if (token !== SOURCE_TOKEN) return;
      SOURCE_MISS.add(key);
      wrap.hidden = true;
    });
}

function reviewSource(source, key, stage) {
  if (!window.forjaCodeReview) return;
  const result = window.forjaCodeReview.review(source.lines.join("\n"), {
    ranges: source.ranges,
    target: source.target,
    stage: stage?.id,
    task: stage?.action,
    failureLine: source.failure_line,
    failureDetail: source.detail,
  });
  SOURCE_REVIEW.set(key, result);
  paintSource(source, key, stage);
}

function paintSource(source, key, stage) {
  const wrap = $("#w-source-wrap");
  const list = $("#w-source-lines");
  wrap.hidden = false;
  list.replaceChildren();
  const ranges = source.ranges || [];
  const review = SOURCE_REVIEW.get(key);
  const byLine = new Map((review?.lines || []).map((row) => [row.line, row.comments]));
  const summary = $("#w-source-review");
  if (review) {
    summary.hidden = false;
    summary.textContent = `${review.total} note${review.total === 1 ? "" : "s"} · ` +
      `${review.errors} error${review.errors === 1 ? "" : "s"} · ` +
      `${review.guidelines} guideline${review.guidelines === 1 ? "" : "s"}`;
  } else {
    summary.hidden = true;
    summary.textContent = "";
  }
  const reviewButton = $("#w-review-source");
  if (reviewButton) {
    reviewButton.onclick = () => reviewSource(source, key, stage);
    reviewButton.disabled = false;
  }
  const inTarget = (n) => ranges.some(([start, end]) => n >= start && n <= end);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < (source.lines || []).length; i += 1) {
    const n = i + 1;
    const li = document.createElement("li");
    li.className = "source-line";
    const target = inTarget(n);
    const failed = source.failure_line === n;
    if (target) li.classList.add("is-target");
    if (failed) li.classList.add("is-fail");
    if (failed) {
      li.title = source.failure_kind === "last"
        ? "The checker last executed this line"
        : "The checker stopped at this line";
    } else if (target) {
      li.title = "Line in the stage's target function";
    }
    const number = document.createElement("span");
    number.className = "sl-n";
    number.textContent = String(n);
    const code = document.createElement("code");
    code.textContent = source.lines[i] || " ";
    li.append(number, code);
    const comments = byLine.get(n) || [];
    if (comments.length) {
      const block = document.createElement("div");
      block.className = "source-comments";
      for (const comment of comments) {
        const note = document.createElement("p");
        note.className = `source-comment${comment.kind === "error" ? " is-error" : ""}`;
        const label = document.createElement("b");
        label.textContent = `${comment.kind} · ${comment.rule}`;
        note.append(label, document.createTextNode(comment.message));
        block.appendChild(note);
      }
      li.appendChild(block);
      li.classList.add("has-comments");
    }
    frag.appendChild(li);
  }
  list.appendChild(frag);
  requestAnimationFrame(() => {
    const focus = list.querySelector(".is-fail") || list.querySelector(".is-target");
    if (!focus) return;
    const box = list.getBoundingClientRect();
    const row = focus.getBoundingClientRect();
    if (row.top < box.top || row.bottom > box.bottom) {
      list.scrollTop += row.top - box.top - 18;
    }
  });

  const rangeText = ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}–${end}`))
    .join(", ");
  let note = source.target
    ? `Target function${source.target.includes("/") ? "s" : ""}: ${source.target}` +
      (rangeText ? ` · line${rangeText.includes(",") ? "s" : ""} ${rangeText}` : " · not found in this file")
    : "No target function is declared for this stage.";
  if (source.status) note += ` · checker: ${source.status}`;
  if (source.failure_line) {
    note += source.failure_kind === "last"
      ? ` · last executed at line ${source.failure_line}`
      : ` · stopped at line ${source.failure_line}`;
  }
  $("#w-source-meta").textContent = `${source.file} · ${(source.lines || []).length} lines`;
  $("#w-source-note").textContent = note;
}

function renderStageBar(logo, title, checks, stages, current, course) {
  const bar = $("#stagebar");
  bar.innerHTML = "";
  const head = document.createElement("div");
  head.className = "stagebar-head";
  head.innerHTML = `
    <img src="${asset(logo)}" width="36" height="36" alt="">
    <span class="stagebar-titlerow">
      <span class="stagebar-title">${title}</span>
      <span class="stagebar-count">${checks?.total ? `${fmt.format(completion(stages).done)} / ${fmt.format(checks.total)} stages done` : ""}</span>
    </span>`;
  bar.appendChild(head);
  const progress = document.createElement("div");
  progress.className = "bar";
  progress.innerHTML = `<div class="bar-fill" style="transform:scaleX(${(checks?.total ? completion(stages).done / checks.total : 0).toFixed(4)})"></div>`;
  bar.appendChild(progress);

  const ol = document.createElement("ol");
  ol.className = "stage-list";
  for (const s of stages) {
    const li = document.createElement("li");
    if (current && s.id === current.id) li.classList.add("is-current");
    const sym = { PASS: "✓", PERSONAL: "✓", BROWSER: "✓", FAIL: "✗", ERROR: "✗" }[s.status] || "○";
    const color = ["PASS", "PERSONAL", "BROWSER"].includes(s.status)
      ? "#54d1a4" : s.status === "TODO" ? "#6B747C" : "#d05a5a";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "stage-open";
    open.innerHTML = `
      <span class="s-sym" style="color:${color}">${sym}</span>
      <span class="s-copy">
        <span class="s-name">${String(s.id).padStart(2, "0")} · ${s.title}</span>
        <span class="s-meta">${s.file}${s.status === "PERSONAL" ? " · completed before" : s.status === "BROWSER" ? " · passed in browser" : ""}</span>
      </span>`;
    open.setAttribute("aria-label", `Open stage ${s.id}: ${s.title}`);
    open.onclick = () => openStage(course, s.id);
    li.appendChild(open);
    if (course && s.status !== "PERSONAL") {
      const run = document.createElement("button");
      run.type = "button";
      run.className = "stage-run";
      run.textContent = "Run";
      run.title = `Run the grader for stage ${s.id}: forja test ${course} --stage ${s.id}`;
      run.setAttribute("aria-label", `Run the grader for stage ${s.id}`);
      run.onclick = (event) => {
        event.stopPropagation();
        runStage(course, s.id, run);
      };
      li.appendChild(run);
    }
    ol.appendChild(li);
  }
  bar.appendChild(ol);
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
  if (st === "doing") return `${fmt.format(completion(item.stages || []).done)}/${fmt.format(checks.total || 0)}`;
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

/* The project graph every surface shares: one course per node, an edge for
   every prerequisite, and depth = longest prerequisite chain. */
function courseGraph() {
  const { byId, courses } = courseIndex();
  const deps = new Map();
  const rev = new Map();
  for (const course of courses.keys()) {
    deps.set(course, new Set());
    rev.set(course, new Set());
  }
  for (const [course, item] of courses) {
    for (const id of item.prereq || []) {
      const parent = byId.get(id)?.course;
      if (!parent || parent === course || !courses.has(parent)) continue;
      deps.get(course).add(parent);
      rev.get(parent).add(course);
    }
  }

  const depth = new Map();
  const depthOf = (course, seen = new Set()) => {
    if (depth.has(course)) return depth.get(course);
    if (seen.has(course)) return 0;
    seen.add(course);
    const parents = deps.get(course) || new Set();
    const d = parents.size ? 1 + Math.max(...[...parents].map((p) => depthOf(p, seen))) : 0;
    seen.delete(course);
    depth.set(course, d);
    return d;
  };

  const nodes = [];
  const byCourse = new Map();
  for (const [course, item] of courses) {
    const node = { course, item, cat: CATEGORY[course] || "Systems", depth: depthOf(course) };
    nodes.push(node);
    byCourse.set(course, node);
  }

  const edges = [];
  for (const [course, parents] of deps) {
    for (const parent of parents) {
      edges.push({ from: byCourse.get(parent), to: byCourse.get(course) });
    }
  }
  return { nodes, edges, deps, rev, depth, depthOf, byCourse, courses, byId };
}

function treeNodes() {
  const { courses, deps, depthOf } = courseGraph();

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
    const parents = [...(deps.get(n.course) || [])]
      .map((c) => byCourse.get(c))
      .filter(Boolean);
    n.parent = parents[0] || null;
    n.extra = parents.slice(1);
  }
  return out;
}

function renderMap() {
  const nodes = treeNodes();
  const byId = new Map(nodes.map((n) => [n.item.id, n]));
  const preview = MAP_PREVIEW ? nodes.find((n) => n.course === MAP_PREVIEW) : null;
  const selected = SELECTED?.kind === "node" ? byId.get(SELECTED.id) : null;
  const focus = preview || selected;

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
    const hot = focus && focus.item.id === node.item.id;
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
    const parentHot = focus && node.parent && focus.item.id === node.parent.item.id;
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
      const secHot = focus && focus.item.id === sec.item.id;
      addEdge(edges, sec, node,
        secTouched ? (secBoth ? GROW : GROW_SOFT) : "rgba(255,255,255,.13)",
        secTouched ? (secBoth ? 1.8 : 1.5) : hot || secHot ? 3 : 1.25,
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
    if (preview && preview.item.id === item.id) el.classList.add("is-preview");
    const hasTree = !!COURSE_TREES[item.course];
    el.title = hasTree ? `Open ${item.title} stage tree` : `Open ${item.title}`;
    el.setAttribute("aria-label", hasTree
      ? `Open ${item.title} stage dependency tree`
      : `Open ${item.title} project detail`);
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
    el.onclick = () => hasTree ? selectCourse(item.course) : selectNode(item.id, "work");
    el.onmouseenter = () => { MAP_PREVIEW = node.course; renderMapSide(nodes, byId); };
    el.onfocus = () => { MAP_PREVIEW = node.course; renderMapSide(nodes, byId); };
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
  const preview = MAP_PREVIEW ? nodes.find((n) => n.course === MAP_PREVIEW) : null;
  const sel = preview || (SELECTED?.kind === "node" ? byId.get(SELECTED.id) : null);
  if (!sel) {
    side.innerHTML = `<div class="map-empty-hint">Hover or focus a node to preview it, then click it to open the project detail.</div>`;
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
  const hasTree = !!COURSE_TREES[item.course];
  cta.textContent = hasTree ? "Open stage tree"
    : st === "blocked" ? "Blocked" : st === "doing" ? "Continue" : "Start";
  if (hasTree) cta.onclick = () => selectCourse(item.course);
  else if (st !== "blocked") cta.onclick = () => selectNode(item.id, "work");
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

/* ------------------------------------------------------- dependencies */
/* Every project in the repo, grouped into lanes, with prerequisite edges
   running left to right. This is the detail view's map of the whole repo. */
function depClosure(course, links) {
  const out = new Set();
  const stack = [...(links.get(course) || [])];
  while (stack.length) {
    const c = stack.pop();
    if (c === course || out.has(c)) continue;
    out.add(c);
    for (const next of links.get(c) || []) stack.push(next);
  }
  return out;
}

function depLayout(g) {
  const visible = g.nodes.filter((n) => !DEP_HIDDEN.has(n.cat));
  const lanes = [];
  let y = 10;
  let maxDepth = 0;
  for (const cat of DEP_GROUP_ORDER) {
    const list = visible
      .filter((n) => n.cat === cat)
      .sort((a, b) => a.depth - b.depth || a.item.title.localeCompare(b.item.title));
    if (!list.length) continue;
    const slots = new Map();
    let rows = 0;
    for (const n of list) {
      maxDepth = Math.max(maxDepth, n.depth);
      const k = slots.get(n.depth) || 0;
      n.x = DEP_LEFT + n.depth * DEP_GAP_X;
      n.y = y + 28 + k * DEP_ROW;
      slots.set(n.depth, k + 1);
      rows = Math.max(rows, k + 1);
    }
    const h = 28 + rows * DEP_ROW + 12;
    lanes.push({ cat, y, h, count: list.length });
    y += h + 8;
  }
  return {
    lanes, nodes: visible,
    width: DEP_LEFT + maxDepth * DEP_GAP_X + DEP_NODE_W + 24,
    height: y + 8,
  };
}

function renderDepGroups(g, sel) {
  const root = $("#w-deps-groups");
  root.innerHTML = "";
  const counts = new Map(DEP_GROUP_ORDER.map((cat) => [cat, 0]));
  for (const n of g.nodes) counts.set(n.cat, (counts.get(n.cat) || 0) + 1);
  for (const cat of DEP_GROUP_ORDER) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dep-group-chip";
    b.classList.toggle("is-off", DEP_HIDDEN.has(cat));
    b.classList.toggle("is-selected", cat === sel.cat);
    b.style.setProperty("--gc", BC[cat]);
    b.setAttribute("aria-pressed", String(!DEP_HIDDEN.has(cat)));
    b.title = cat === sel.cat
      ? "The selected project's group stays open"
      : `${DEP_HIDDEN.has(cat) ? "Show" : "Fold"} ${cat}`;
    b.innerHTML = `<i></i><span>${cat}</span><b>${counts.get(cat) || 0}</b>`;
    if (cat === sel.cat) {
      b.setAttribute("aria-disabled", "true");
    } else {
      b.onclick = () => {
        if (DEP_HIDDEN.has(cat)) DEP_HIDDEN.delete(cat); else DEP_HIDDEN.add(cat);
        renderAllDeps(sel.course, g);
      };
    }
    root.appendChild(b);
  }
  if (DEP_HIDDEN.size) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "dep-group-chip is-reset";
    all.textContent = "Show all groups";
    all.onclick = () => { DEP_HIDDEN.clear(); renderAllDeps(sel.course, g); };
    root.appendChild(all);
  }
}

function renderDepLanes(layout) {
  const root = $("#w-deps-lanes");
  root.innerHTML = "";
  for (const lane of layout.lanes) {
    const el = document.createElement("div");
    el.className = "deps-lane";
    el.style.top = `${lane.y}px`;
    el.style.height = `${lane.h}px`;
    el.style.setProperty("--gc", BC[lane.cat]);
    const label = document.createElement("div");
    label.className = "deps-lane-label";
    label.style.color = BC[lane.cat];
    label.innerHTML = `<span>${lane.cat}</span><b>${lane.count}</b>`;
    el.appendChild(label);
    root.appendChild(el);
  }
}

function renderDepEdges(layout, g, sel) {
  const svg = $("#w-deps-svg");
  const visible = new Set(layout.nodes.map((n) => n.course));
  const defs = DEP_GROUP_ORDER.map((cat) => `
    <marker id="dep-arrow-${cat}" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="${BC[cat]}"></path>
    </marker>`).join("");
  const paths = [];
  for (const edge of g.edges) {
    if (!visible.has(edge.from.course) || !visible.has(edge.to.course)) continue;
    const hot = edge.from.course === sel.course || edge.to.course === sel.course;
    const x1 = edge.from.x + DEP_NODE_W, y1 = edge.from.y + DEP_NODE_H / 2;
    const x2 = edge.to.x, y2 = edge.to.y + DEP_NODE_H / 2;
    const bend = Math.max(28, (x2 - x1) * .45);
    const d = `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
    paths.push(`<path d="${d}" fill="none" stroke="${BC[edge.to.cat]}"
      stroke-width="${hot ? 2.2 : 1.2}" opacity="${hot ? 1 : .35}"
      marker-end="url(#dep-arrow-${edge.to.cat})"></path>`);
  }
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  svg.innerHTML = `<defs>${defs}</defs>${paths.join("")}`;
}

function renderDepNodes(layout, g, sel) {
  const root = $("#w-deps-nodes");
  root.innerHTML = "";
  for (const n of layout.nodes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dep-node";
    b.dataset.course = n.course;
    b.style.left = `${n.x}px`;
    b.style.top = `${n.y}px`;
    b.style.setProperty("--gc", BC[n.cat]);
    b.classList.toggle("is-selected", n.course === sel.course);
    if (n.course === sel.course) b.setAttribute("aria-current", "true");
    const reqs = g.deps.get(n.course)?.size || 0;
    const unlocks = g.rev.get(n.course)?.size || 0;
    b.title = `${n.item.title} — ${nodeLabel(n.item)}; requires ${reqs}, unlocks ${unlocks}`;
    b.setAttribute("aria-label", `${n.item.title}: ${nodeLabel(n.item)}. Requires ${reqs} projects, unlocks ${unlocks}.`);
    b.innerHTML = `<i class="dep-dot" style="background:${stateColor(itemState(n.item))}"></i><span>${n.item.title}</span>`;
    b.onclick = () => COURSE_TREES[n.item.course]
      ? selectCourse(n.item.course)
      : selectNode(n.item.id, "work");
    root.appendChild(b);
  }
}

function renderAllDeps(selectedCourse, g = null) {
  const sec = $("#w-deps");
  if (!sec) return;
  if (!selectedCourse || !STATE) { sec.hidden = true; return; }
  g = g || courseGraph();
  const sel = g.byCourse.get(selectedCourse);
  if (!sel) { sec.hidden = true; return; }
  sec.hidden = false;
  DEP_HIDDEN.delete(sel.cat);

  const before = depClosure(sel.course, g.deps);
  const after = depClosure(sel.course, g.rev);
  $("#w-deps-note").textContent =
    `${g.nodes.length} projects in ${DEP_GROUP_ORDER.length} groups · ${sel.item.title}: ` +
    `${before.size} upstream, ${after.size} downstream.`;

  renderDepGroups(g, sel);
  const layout = depLayout(g);
  const canvas = $("#w-deps-canvas");
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  renderDepLanes(layout);
  renderDepEdges(layout, g, sel);
  renderDepNodes(layout, g, sel);

  const tree = $("#w-deps-tree");
  if (tree) tree.onclick = () => selectNode(sel.item.id, "map");

  requestAnimationFrame(() => {
    const scroll = $("#w-deps-scroll");
    const node = layout.nodes.find((n) => n.course === sel.course);
    if (scroll && node) {
      scroll.scrollLeft = Math.max(0, node.x - Math.max(0, (scroll.clientWidth - DEP_NODE_W) / 2));
    }
  });
}

/* ------------------------------------------------------- course stage tree */
function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function courseStageGraph(course) {
  const cfg = COURSE_TREES[course];
  if (!cfg || !STATE) return null;
  const item = findNodeByCourse(course);
  if (!item?.stages?.length) return null;

  const groups = cfg.groups.map((g, index) => ({
    ...g, stages: [], laneX: COURSE_TREE_LAYOUT.left + index * (COURSE_TREE_LAYOUT.laneW + COURSE_TREE_LAYOUT.gap),
  }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const byFile = new Map();
  for (const g of groups) for (const file of g.files) byFile.set(file, g.id);

  const byStage = new Map();
  const nodes = [];
  const L = COURSE_TREE_LAYOUT;
  const stages = [...item.stages].sort((a, b) => a.id - b.id);
  for (const stage of stages) {
    const gid = byFile.get(stage.file) || "capstone";
    const group = groupById.get(gid);
    if (!group) continue;
    const index = group.stages.length;
    const node = {
      stage, group,
      icon: cfg.stageIcons?.[stage.id] || group.icon,
      x: group.laneX + L.laneW / 2,
      y: L.top + L.headerH + index * L.rowH + L.nodeH / 2,
    };
    group.stages.push(stage);
    nodes.push(node);
    byStage.set(stage.id, node);
  }

  const edges = [];
  for (const [from, to] of cfg.deps || []) {
    const a = byStage.get(from);
    const b = byStage.get(to);
    if (!a || !b) continue;
    edges.push({
      from: a, to: b,
      cross: a.group.id !== b.group.id,
      capstone: b.group.id === "capstone",
    });
  }
  return { course, cfg, item, stages, groups, nodes, byStage, edges };
}

function courseEdgePoint(a, b) {
  const L = COURSE_TREE_LAYOUT;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tx = dx ? (L.nodeW / 2) / Math.abs(dx) : Infinity;
  const ty = dy ? (L.nodeH / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function renderCourse() {
  const course = SELECTED?.kind === "course" ? SELECTED.id : null;
  const tree = courseStageGraph(course);
  if (!tree) { VIEW = "map"; SELECTED = null; render(); return; }

  const { cfg, item, stages, groups, nodes } = tree;
  const checks = item.checks || {};
  const total = checks.total || stages.length;
  const passed = completion(stages).done;

  $("#course-title").textContent = item.title;
  $("#course-sub").textContent =
    `${stages.length} stages · ${cfg.summary}`;
  $("#course-count").textContent = `${fmt.format(passed)} / ${fmt.format(total)} done`;
  $("#course-bar").style.transform = `scaleX(${total ? (passed / total).toFixed(4) : 0})`;
  $("#course-back").onclick = () => selectNode(item.id, "map");
  $("#course-work").onclick = () => selectNode(item.id, "work");

  const legend = $("#course-legend");
  legend.innerHTML = groups.map((g) => `
    <span class="course-key" style="--ac:${g.color}">
      <img src="${asset(g.icon)}" width="18" height="18" alt="">
      <span>${htmlEscape(g.label)}</span><b>${g.stages.length}</b>
    </span>`).join("") + `
    <span class="course-key course-key-note"><i class="ck-arrow"></i>arrow = prerequisite</span>
    <span class="course-key course-key-note">click a stage to open it</span>`;

  const L = COURSE_TREE_LAYOUT;
  const canvas = $("#course-canvas");
  canvas.style.width = `${L.width}px`;
  canvas.style.height = `${L.height}px`;

  const roots = $("#course-roots");
  roots.innerHTML = "";
  for (const group of groups) {
    const root = document.createElement("div");
    root.className = "course-root";
    root.style.left = `${group.laneX}px`;
    root.style.top = `${L.top}px`;
    root.style.width = `${L.laneW}px`;
    root.style.setProperty("--ac", group.color);
    root.title = `${group.label}: ${group.stages.length} stage${group.stages.length === 1 ? "" : "s"}`;
    root.innerHTML = `
      <span class="cr-icon"><img src="${asset(group.icon)}" width="28" height="28" alt=""></span>
      <span class="cr-copy">
        <span class="cr-label">${htmlEscape(group.label)}</span>
        <span class="cr-count">${group.stages.length} stages</span>
      </span>`;
    roots.appendChild(root);
  }

  const svg = $("#course-svg");
  svg.setAttribute("width", String(L.width));
  svg.setAttribute("height", String(L.height));
  svg.setAttribute("viewBox", `0 0 ${L.width} ${L.height}`);

  const defs = `
    <marker id="cs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#9AA3AB"></path>
    </marker>
    <marker id="cs-arrow-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#6aa5f0"></path>
    </marker>
    <marker id="cs-arrow-cap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#ffb340"></path>
    </marker>`;

  const spokes = groups.map((group) => {
    const last = [...nodes].reverse().find((n) => n.group === group);
    if (!last) return "";
    const x = group.laneX + L.laneW / 2;
    return `<path class="cs-spoke" d="M${x} ${L.top + L.headerH - 4} L${x} ${last.y + L.nodeH / 2}" stroke="${group.color}"></path>`;
  }).join("");

  const paths = tree.edges.map((edge) => {
    const start = courseEdgePoint(edge.from, edge.to);
    const end = courseEdgePoint(edge.to, edge.from);
    let d = `M${start.x} ${start.y} L${end.x} ${end.y}`;
    if (edge.cross) {
      const mid = (start.x + end.x) / 2;
      d = `M${start.x} ${start.y} C${mid} ${start.y} ${mid} ${end.y} ${end.x} ${end.y}`;
    }
    const marker = edge.capstone ? "cs-arrow-cap" : edge.cross ? "cs-arrow-cross" : "cs-arrow";
    const color = edge.capstone ? "#ffb340" : edge.cross ? "#6aa5f0" : "rgba(232,234,235,.34)";
    return `<path class="cs-edge" data-from="${edge.from.stage.id}" data-to="${edge.to.stage.id}"
      d="${d}" fill="none" stroke="${color}" stroke-width="1.25"
      marker-end="url(#${marker})"></path>`;
  }).join("");

  svg.innerHTML = `<defs>${defs}</defs>${spokes}${paths}`;

  const root = $("#course-nodes");
  root.innerHTML = "";
  const edges = () => [...svg.querySelectorAll(".cs-edge")];
  const setHot = (stageId) => {
    for (const path of edges()) {
      const hot = stageId !== null
        && (path.dataset.from === String(stageId) || path.dataset.to === String(stageId));
      path.classList.toggle("is-hot", hot);
      path.classList.toggle("is-dim", stageId !== null && !hot);
    }
  };

  for (const node of nodes) {
    const stage = node.stage;
    const done = ["PASS", "PERSONAL", "BROWSER"].includes(stage.status);
    const failed = stage.status === "FAIL" || stage.status === "ERROR";
    const color = done ? C.complete : failed ? C.blocked : C.ready;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "course-stage";
    el.dataset.stage = String(stage.id);
    el.style.left = `${node.x - COURSE_TREE_LAYOUT.nodeW / 2}px`;
    el.style.top = `${node.y - COURSE_TREE_LAYOUT.nodeH / 2}px`;
    el.style.setProperty("--ac", node.group.color);
    el.title = `Stage ${stage.id} · ${stage.title}\n${stage.action || ""}`;
    const progressLabel = stage.status === "PERSONAL" ? "Completed before"
      : stage.status === "BROWSER" ? "Passed in browser"
      : stage.status === "PASS" ? "Passing" : "Not passing";
    el.setAttribute("aria-label",
      `Stage ${stage.id}: ${stage.title}. ${progressLabel}. Open stage.`);
    el.innerHTML = `
      <span class="cs-icon"><img src="${asset(node.icon)}" width="22" height="22" alt=""></span>
      <span class="cs-body">
        <span class="cs-num">${String(stage.id).padStart(2, "0")}</span>
        <span class="cs-title">${htmlEscape(stage.title)}</span>
      </span>
      <i class="cs-dot" style="background:${color}"></i>`;
    el.onclick = () => openStage(tree.course, stage.id);
    el.onmouseenter = () => setHot(stage.id);
    el.onfocus = () => setHot(stage.id);
    el.onmouseleave = () => setHot(null);
    el.onblur = () => setHot(null);
    root.appendChild(el);
  }

  requestAnimationFrame(() => {
    const viewport = $("#course-viewport");
    if (!viewport) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  });
}

/* ------------------------------------------------------------- run stage */
function runToast(title, detail, color = "#54d1a4") {
  const el = document.createElement("div");
  el.className = "live-toast";
  el.setAttribute("role", "status");
  const sym = document.createElement("span");
  sym.className = "lt-sym";
  sym.style.color = color;
  sym.textContent = "●";
  const head = document.createElement("b");
  head.textContent = title;
  const body = document.createElement("span");
  body.className = "lt-score";
  body.textContent = String(detail || "").slice(0, 220);
  el.append(sym, head, body);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 400);
  }, 5200);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), 900)),
      ]);
      return true;
    } catch {
      /* fall through to the execCommand shim */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function runStage(course, stage, button) {
  const command = `forja test ${course} --stage ${stage}`;
  if (VIEW === "work" && STAGE !== stage) openStage(course, stage);
  const original = button ? button.textContent : "Run";
  if (button) {
    button.disabled = true;
    button.textContent = "…";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    /* Try the local runner first; a static mirror answers 404/405 and falls
       back to copying the command. Do not gate this on LIVE: a stale state
       fallback should not hide a working local runner. */
    const res = await fetch("/api/run-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course, stage }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const copied = await copyText(command);
      runToast(copied ? "Run locally — command copied" : "Run locally", command, "#ffb340");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const row = (data.result?.stages || []).find((s) => s.id === stage)
      || (data.result?.stages || [])[0] || {};
    const status = row.status || "DONE";
    const color = status === "PASS" ? "#54d1a4"
      : status === "TODO" ? "#9AA3AB" : "#d05a5a";
    runToast(`Stage ${stage} · ${status}`, row.detail || command, color);
    if (data.source) {
      const key = sourceKey(course, stage);
      data.source.status = status;
      data.source.detail = row.detail || "";
      SOURCE_CACHE.set(key, data.source);
      SOURCE_REVIEW.delete(key);
    }
    /* The stage result is the freshest fact here, and authored courses do not
       expose it through /api/state. Keep it on the in-memory item instead of
       re-running every checker just to repaint one line. */
    const item = findNodeByCourse(course);
    const observed = item?.stages?.find((s) => s.id === stage);
    if (observed) {
      observed.status = status;
      render();
    }
  } catch (err) {
    const copied = await copyText(command);
    runToast("Could not run here", `${err.message || err}; ${copied ? "command copied" : "run it locally"}`, "#d05a5a");
  } finally {
    clearTimeout(timer);
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
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


$("#go-home").addEventListener("click", () => {
  go("home");
  requestAnimationFrame(() => scrollTo({ top: 0, behavior: "smooth" }));
});
$$(".zj-nav-btn[data-view]").forEach((b) => b.addEventListener("click", () => {
  go(b.dataset.view);
  if (b.dataset.view === "home") {
    requestAnimationFrame(() => $("#challenges")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}));
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
  else if (HOME_SEL) { HOME_SEL = null; renderHome(); }
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
  applyPersonalDone();
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
        /* static mirror or transient failure */
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  };
  loop();
}

async function init() {
  ghLoad(); renderGh();      // cached pill immediately; commits need STATE below
  importPersonalCompletion();
  STATE = await loadState();
  applyPersonalDone();
  ghRestore();               // re-check the fork, then read its commits
  bindHome();
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
