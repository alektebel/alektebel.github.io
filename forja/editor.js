/* A local, stage-aware Python workspace. Drafts never leave this browser. */
(() => {
  const $ = (id) => document.getElementById(id);
  const PREFIX = "forja.code.aws-from-scratch.";
  let bundle = null;
  let course = null;
  let stage = null;
  let file = null;
  let hintIndex = 0;
  let running = false;

  function draft(name) {
    try { return localStorage.getItem(PREFIX + name); } catch { return null; }
  }
  function save() {
    if (!file || !bundle) return;
    try {
      localStorage.setItem(PREFIX + file, $("editor-code").value);
      $("editor-save-state").textContent = "Saved in this browser";
    } catch {
      $("editor-save-state").textContent = "Storage unavailable · download your file";
    }
  }
  function lines() {
    const count = $("editor-code").value.split("\n").length;
    $("editor-lines").textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }
  function selectFile(name) {
    if (!bundle?.editable.includes(name)) return;
    file = name;
    $("editor-file").value = name;
    $("editor-code").value = draft(name) ?? bundle.files[name];
    $("editor-save-state").textContent = draft(name) === null ? "Starter code · edits save here" : "Saved in this browser";
    lines();
  }
  function jumpToTask() {
    if (!stage || file !== stage.file) selectFile(stage.file);
    const code = $("editor-code");
    const wanted = (stage.target || "").split("/")[0].trim().split(".").pop().match(/^[A-Za-z_]\w*/)?.[0];
    if (!wanted) return;
    const match = new RegExp(`^\\s*(?:async\\s+)?def\\s+${wanted}\\s*\\(`, "m").exec(code.value);
    if (!match) return;
    const line = code.value.slice(0, match.index).split("\n").length;
    code.focus();
    code.setSelectionRange(match.index, match.index);
    code.scrollTop = Math.max(0, (line - 4) * 21);
    $("editor-lines").scrollTop = code.scrollTop;
  }
  async function load() {
    if (bundle) return bundle;
    let response;
    try { response = await fetch("/api/workspace/aws-from-scratch"); } catch { /* static site */ }
    if (!response?.ok) response = await fetch(asset("workspace.json"));
    if (!response.ok) throw new Error("Could not load the AWS starter files. Refresh and try again.");
    bundle = await response.json();
    const picker = $("editor-file");
    picker.replaceChildren();
    for (const name of bundle.editable) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      picker.appendChild(option);
    }
    return bundle;
  }
  function result(status, detail) {
    const box = $("editor-result");
    box.hidden = false;
    box.dataset.status = status;
    box.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = { PASS: "Stage passed", TODO: "Keep going", FAIL: "Check failed", ERROR: "Could not run" }[status] || status;
    const body = document.createElement("p");
    body.textContent = detail;
    box.append(title, body);
  }
  function guide() {
    hintIndex = 0;
    $("editor-stage-title").textContent = `Stage ${String(stage.id).padStart(2, "0")} · ${stage.title}`;
    $("editor-goal").textContent = stage.action || stage.task || "Complete this stage, then run its check.";
    $("editor-target").textContent = stage.target ? `Edit ${stage.target} in ${stage.file}.` : `Edit ${stage.file}.`;
    $("editor-hint-text").textContent = "Hints appear one at a time. Try the stage yourself first.";
    $("editor-hint").disabled = false;
    $("editor-result").hidden = true;
    if (bundle?.editable.includes(stage.file)) selectFile(stage.file);
  }
  async function open(nextCourse, nextStage) {
    if (nextCourse !== "aws-from-scratch" || !nextStage) return;
    course = nextCourse;
    stage = nextStage;
    $("browser-editor").hidden = false;
    $("editor-goal").textContent = "Loading starter files…";
    $("browser-editor").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await load();
      guide();
      jumpToTask();
    } catch (error) { result("ERROR", error.message); }
  }
  function onStage(nextCourse, nextStage) {
    if ($("browser-editor").hidden || nextCourse !== course || !nextStage) return;
    if (stage?.id === nextStage.id) return;
    stage = nextStage;
    guide();
  }
  async function run() {
    if (running || !bundle || !stage) return;
    save();
    running = true;
    $("editor-run").disabled = true;
    $("editor-run").textContent = "Running…";
    result("TODO", "Loading Python and checking this stage. The first run may take a moment.");
    const files = { ...bundle.files };
    for (const name of bundle.editable) files[name] = draft(name) ?? bundle.files[name];
    let worker;
    try {
      worker = new Worker(asset("py-worker.mjs"), { type: "module" });
      const id = Date.now();
      const outcome = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Python took too long to load. Check your connection and try again.")), 90000);
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          clearTimeout(timeout);
          resolve(data);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Python could not load. Check your connection and try again."));
        };
        worker.postMessage({ id, files, stage: stage.id });
      });
      result(outcome.status, outcome.detail);
      if (outcome.status === "PASS") {
        try {
          const key = "forja.browser.passed.v1";
          const passed = JSON.parse(localStorage.getItem(key) || "{}");
          passed[course] = [...new Set([...(passed[course] || []), stage.id])];
          localStorage.setItem(key, JSON.stringify(passed));
          window.forjaBrowserPassed?.(course, stage.id);
        } catch { /* progress still visible for this run */ }
      }
    } catch (error) { result("ERROR", error.message); }
    finally {
      worker?.terminate();
      running = false;
      $("editor-run").disabled = false;
      $("editor-run").textContent = "Run stage";
    }
  }

  $("editor-file").addEventListener("change", (event) => selectFile(event.target.value));
  $("editor-jump").addEventListener("click", jumpToTask);
  $("editor-code").addEventListener("input", () => { save(); lines(); });
  $("editor-code").addEventListener("scroll", () => { $("editor-lines").scrollTop = $("editor-code").scrollTop; });
  $("editor-code").addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const field = event.target;
      const at = field.selectionStart;
      field.setRangeText("    ", at, field.selectionEnd, "end");
      field.dispatchEvent(new Event("input"));
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  });
  $("editor-hint").addEventListener("click", () => {
    const available = stage?.hints?.length ? stage.hints : [
      `Look at ${stage?.target || stage?.file || "the named function"}. Find the first unfinished part needed for this stage.`,
      "Run the stage after a small edit. The check result will tell you what to inspect next."
    ];
    $("editor-hint-text").textContent = available[Math.min(hintIndex, available.length - 1)];
    hintIndex++;
    if (hintIndex >= available.length) $("editor-hint").disabled = true;
  });
  $("editor-run").addEventListener("click", run);
  $("editor-close").addEventListener("click", () => { $("browser-editor").hidden = true; });
  $("editor-download").addEventListener("click", () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([$("editor-code").value], { type: "text/x-python" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.forjaEditor = { open, onStage };
})();
