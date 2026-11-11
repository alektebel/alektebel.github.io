/* A local, stage-aware Python workspace. Drafts never leave this browser. */
(() => {
  const $ = (id) => document.getElementById(id);
  const draftKey = (name) => `forja.code.${course}.${name}`;
  const learning = window.forjaLearning;
  const VIM_KEY = "forja.vim.enabled.v1";
  const STAGE_SPECS = {
    "aws-from-scratch": {
      9: {
      title: "S3 object round trip",
      setup: 'from s3 import S3\nstore = S3()\nstore.create_bucket("b")',
      note: "The slash is part of the key. It does not create a folder. ETag text is not checked until stage 11.",
      signatures: [
        "put_object(bucket, key, body, metadata=None) -> ETag str",
        "get_object(bucket, key, version_id=None) -> Version",
      ],
      examples: [
        {
          call: 'store.put_object("b", "a/b.txt", b"hello")',
          output: "an ETag string (any non-empty placeholder is enough here)",
        },
        {
          call: 'store.get_object("b", "a/b.txt")',
          output: 'a Version; its .body is b"hello"',
        },
        {
          call: 'store.get_object("b", "a/b.txt").body',
          output: 'b"hello"',
        },
        {
          call: 'sorted(store.buckets["b"].objects)',
          output: '["a/b.txt"]',
        },
      ],
      cases: [
        {
          id: "etag",
          label: "put_object returns an ETag",
          input: 'store.put_object("b", "a/b.txt", b"hello")',
          expected: "non-empty str",
        },
        {
          id: "roundtrip",
          label: "get_object returns the written bytes",
          input: 'store.get_object("b", "a/b.txt").body',
          expected: 'b"hello"',
        },
        {
          id: "full_key",
          label: "the slash stays in one key",
          input: 'sorted(store.buckets["b"].objects)',
          expected: '["a/b.txt"]',
        },
        {
          id: "two_keys",
          label: "different full keys do not collide",
          input: 'put "a/b.txt" then "a/c.txt"; read both',
          expected: 'b"hello" and b"world"',
        },
        {
          id: "empty",
          label: "an empty body round trips",
          input: 'store.put_object("b", "empty", b"")',
          expected: 'get_object(...).body == b""',
        },
      ],
      },
    },
  };

  let bundle = null;
  let course = null;
  let stage = null;
  let file = null;
  let hintIndex = 0;
  let running = false;
  let runningTests = false;
  let lastOutcome = null;
  let cm = null;
  let vimEnabled = true;
  let vimMode = "normal";
  let vimLog = [];
  let burstStart = 0;
  let lastKeyAt = 0;
  let settingCode = false;

  function currentLearning() { return stage?.learning || bundle?.learning?.[stage?.id] || null; }
  function records() { return learning.read(localStorage); }
  function passedStages() {
    try { return JSON.parse(localStorage.getItem("forja.browser.passed.v1") || "{}")[course] || []; }
    catch { return []; }
  }
  function question(kind, data) {
    const choices = $(`editor-${kind}-choices`);
    choices.replaceChildren();
    $(`editor-${kind}-prompt`).textContent = data.prompt;
    $(`editor-${kind}-reason`).value = "";
    const feedback = $(`editor-${kind}-feedback`);
    feedback.textContent = "";
    delete feedback.dataset.correct;
    $(`editor-${kind}-submit`).disabled = false;
    for (let i = 0; i < data.options.length; i++) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `editor-${kind}-choice`;
      input.value = String(i);
      const words = document.createElement("span");
      words.textContent = data.options[i];
      label.append(input, words);
      choices.appendChild(label);
    }
  }
  function showConcept() {
    const data = currentLearning()?.concept;
    if (!data) return;
    showHelper("guide");
    question("concept", data);
    $("editor-concept").hidden = false;
    $("editor-concept-toggle").hidden = true;
    $("editor-concept").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function showPractice() {
    const due = learning.duePractice(records(), passedStages(), bundle?.learning, stage.id, Date.now());
    const panel = $("editor-practice");
    panel.hidden = !due;
    $("editor-practice-jump").hidden = !due;
    if (!due) return;
    showHelper("guide");
    panel.dataset.stage = String(due);
    $("editor-practice-jump").textContent = `Recall from stage ${due} · 1 question`;
    $("editor-practice-title").textContent = `Recall · Stage ${due}`;
    question("practice", bundle.learning[due].transfer);
  }
  function submitQuestion(kind) {
    const owner = kind === "concept" ? stage?.id : Number($("editor-practice").dataset.stage);
    const data = kind === "concept" ? currentLearning()?.concept : bundle?.learning?.[owner]?.transfer;
    const selected = document.querySelector(`input[name="editor-${kind}-choice"]:checked`);
    const feedback = $(`editor-${kind}-feedback`);
    if (!selected) { feedback.textContent = "Choose one answer first."; return; }
    const choice = Number(selected.value);
    const judged = learning.answer(data, choice);
    if (!judged) return;
    const reasoning = $(`editor-${kind}-reason`).value.trim().slice(0, 600);
    learning.append(localStorage, {
      ts: Date.now(), course, stage: owner, kind, choice,
      correct: judged.correct, reasoning,
    });
    feedback.dataset.correct = String(judged.correct);
    feedback.textContent = `${judged.correct ? "Yes." : `The answer is: ${data.options[data.correct]}.`} ${judged.feedback}`;
    $(`editor-${kind}-submit`).disabled = true;
  }

  const stagePath = (name) => bundle?.stageFiles?.[name] || name;
  function draft(name) {
    try { return localStorage.getItem(draftKey(name)); } catch { return null; }
  }
  function save() {
    if (!file || !bundle || !cm || settingCode) return;
    try {
      localStorage.setItem(draftKey(file), cm.getValue());
      $("editor-save-state").textContent = "Saved in this browser";
    } catch {
      $("editor-save-state").textContent = "Storage unavailable · download your file";
    }
  }
  function code() {
    return cm ? cm.getValue() : "";
  }
  let markedLines = [];
  function clearErrorLines() {
    if (!cm) return;
    for (const handle of markedLines) cm.removeLineClass(handle, "background", "cm-error-line");
    markedLines = [];
  }
  function markErrorLines(lines) {
    clearErrorLines();
    if (!cm) return;
    const unique = [...new Set(lines.filter((line) =>
      Number.isInteger(line) && line > 0 && line <= cm.lineCount()))];
    for (const line of unique) markedLines.push(cm.addLineClass(line - 1, "background", "cm-error-line"));
    if (unique.length) cm.scrollIntoView({ line: unique[0] - 1, ch: 0 }, 80);
  }
  function flashEditor(message) {
    const label = $("editor-format-msg");
    if (!label) return;
    label.textContent = message;
    clearTimeout(flashEditor.timer);
    flashEditor.timer = setTimeout(() => { label.textContent = ""; }, 2200);
  }
  function formatCode() {
    if (!cm) return;
    const before = cm.getValue();
    const after = before
      .replace(/\t/g, "    ")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\s*$/, "\n");
    if (after === before) {
      flashEditor("Already formatted");
      return;
    }
    cm.setValue(after);
    cm.clearHistory();
    save();
    flashEditor("Formatted");
  }
  function resetCode() {
    if (!cm || !file || !bundle) return;
    cm.setValue(bundle.files[file]);
    cm.clearHistory();
    cm.setCursor({ line: 0, ch: 0 });
    save();
    flashEditor("Reset to starter");
  }
  function currentFiles() {
    const files = { ...bundle.files };
    for (const name of bundle.editable) {
      files[name] = name === file ? code() : draft(name) ?? bundle.files[name];
    }
    return files;
  }
  function selectFile(name) {
    if (!bundle?.editable.includes(name)) return;
    const saved = draft(name);
    file = name;
    $("editor-file").value = name;
    settingCode = true;
    cm.setValue(saved ?? bundle.files[name]);
    cm.setOption("mode", name.endsWith(".sas") ? "text/x-sas" : "python");
    const badge = document.querySelector(".v2-editor-badge");
    if (badge) badge.textContent = name.endsWith(".sas") ? "SAS" : "Python 3.12";
    settingCode = false;
    cm.clearHistory();
    cm.setCursor({ line: 0, ch: 0 });
    $("editor-save-state").textContent = saved === null ? "Starter code · edits save here" : "Saved in this browser";
    if (lastOutcome?.file && lastOutcome.file !== name) lastOutcome = null;
    cm.refresh();
  }
  function taskLine() {
    const wanted = (stage?.target || "").split("/")[0].trim().split(".").pop().match(/^[A-Za-z_]\w*/)?.[0];
    if (!wanted) return null;
    const match = new RegExp(`^[ \\t]*(?:async[ \\t]+)?def[ \\t]+${wanted}[ \\t]*\\(`, "m").exec(code());
    if (!match) return null;
    const before = code().slice(0, match.index).split("\n");
    return { line: before.length - 1, ch: before[before.length - 1].length };
  }
  function jumpToTask() {
    if (!stage) return;
    const target = stagePath(stage.file);
    if (target && file !== target && bundle?.editable.includes(target)) selectFile(target);
    const at = taskLine();
    if (!at) return;
    cm.setCursor(at);
    cm.scrollIntoView(at, 120);
    cm.focus();
  }
  async function load() {
    if (bundle && bundle.course === course) return bundle;
    let response;
    try { response = await fetch(`/api/workspace/${course}`); } catch { /* static site */ }
    if (!response?.ok) response = await fetch(asset(`workspaces/${course}.json`));
    if (!response.ok) throw new Error(`Could not load the ${course} starter files. Refresh and try again.`);
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
  function genericSpec(targetStage) {
    if (!targetStage) return null;
    return {
      title: targetStage.title,
      setup: `# ${targetStage.file || "stage"}`,
      note: targetStage.action || "Run the stage checker against the current browser draft.",
      signatures: [],
      examples: [],
      cases: [{
        id: "stage",
        label: "Stage checker",
        input: targetStage.action || targetStage.title || "stage check",
        expected: "PASS",
      }],
    };
  }
  function specFor(stageId, courseName = course, stageData = null) {
    return STAGE_SPECS[courseName]?.[stageId] || genericSpec(stageData);
  }
  function spec() {
    return specFor(stage?.id, course, stage);
  }
  function showHelper(name) {
    for (const button of document.querySelectorAll("[data-helper-tab]")) {
      const active = button.dataset.helperTab === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const panel of document.querySelectorAll(".helper-panel")) {
      panel.hidden = panel.id !== `helper-panel-${name}`;
    }
  }
  function renderExamples(stageSpec) {
    const box = $("editor-examples");
    box.replaceChildren();
    const setup = document.createElement("div");
    setup.className = "test-example-setup";
    const setupCode = document.createElement("code");
    setupCode.textContent = stageSpec.setup;
    setup.append("Setup: ", setupCode);
    box.appendChild(setup);
    for (const signature of stageSpec.signatures || []) {
      const line = document.createElement("div");
      line.className = "test-signature";
      line.textContent = signature;
      box.appendChild(line);
    }
    for (const example of stageSpec.examples) {
      const row = document.createElement("div");
      row.className = "test-example";
      const call = document.createElement("div");
      call.className = "test-example-call";
      call.textContent = example.call;
      const output = document.createElement("div");
      output.className = "test-example-output";
      output.append("→ ");
      const value = document.createElement("code");
      value.textContent = example.output;
      output.appendChild(value);
      row.append(call, output);
      box.appendChild(row);
    }
  }
  function renderTests(stageSpec, results = new Map()) {
    const list = $("editor-test-list");
    list.replaceChildren();
    let passed = 0;
    let finished = 0;
    const rows = [];
    const errorLines = [];
    for (const test of stageSpec.cases) {
      const actual = results.get(test.id);
      const status = actual?.status || "pending";
      if (status === "passed") passed += 1;
      if (status !== "pending") finished += 1;
      if (status !== "passed" && actual?.line) errorLines.push(actual.line);
      rows.push({ label: test.label, status });
      const item = document.createElement("li");
      item.className = "test-case";
      item.dataset.status = status;
      const head = document.createElement("div");
      head.className = "test-case-head";
      const mark = document.createElement("span");
      mark.className = "test-status";
      mark.textContent = { passed: "✓", failed: "✗", error: "!", pending: "○" }[status] || "○";
      const label = document.createElement("span");
      label.className = "test-label";
      label.textContent = test.label;
      head.append(mark, label);
      const input = document.createElement("code");
      input.textContent = test.input;
      const expected = document.createElement("small");
      expected.append("Expected: ");
      const expectedValue = document.createElement("b");
      expectedValue.textContent = test.expected;
      expected.appendChild(expectedValue);
      item.append(head, input, expected);
      if (actual?.actual !== undefined && actual?.actual !== null) {
        const actualLine = document.createElement("small");
        actualLine.append("Actual: ");
        const actualValue = document.createElement("b");
        actualValue.textContent = String(actual.actual).slice(0, 220);
        actualLine.appendChild(actualValue);
        item.appendChild(actualLine);
      }
      if (actual?.error) {
        const errorLine = document.createElement("small");
        errorLine.append("Error: ");
        const errorValue = document.createElement("b");
        errorValue.textContent = String(actual.error).slice(0, 220);
        errorLine.appendChild(errorValue);
        item.appendChild(errorLine);
      }
      list.appendChild(item);
    }
    markErrorLines(errorLines);
    const summary = $("editor-tests-summary");
    if (finished) {
      summary.textContent = `${passed}/${stageSpec.cases.length} passing` +
        (finished < stageSpec.cases.length ? ` · ${stageSpec.cases.length - finished} still pending` : "");
    } else {
      summary.textContent = "Not run yet. Tests run against the current browser draft.";
    }
    window.forjaWorkspace?.onTests?.({ passed, total: stageSpec.cases.length, rows });
  }
  function guide() {
    hintIndex = 0;
    lastOutcome = null;
    $("editor-review-wrap").hidden = true;
    $("editor-stage-title").textContent = `Stage ${String(stage.id).padStart(2, "0")} · ${stage.title}`;
    $("editor-goal").textContent = stage.action || stage.task || "Complete this stage, then run its check.";
    $("editor-target").textContent = stage.target ? `Edit ${stage.target} in ${stage.file}.` : `Edit ${stage.file}.`;
    $("editor-hint-text").textContent = "Hints appear one at a time. Try the stage yourself first.";
    $("editor-hint").disabled = false;
    $("editor-result").hidden = true;
    $("editor-run-advice").hidden = true;
    $("editor-concept").hidden = true;
    $("editor-concept-toggle").hidden = !currentLearning()?.concept;
    const priorConcept = records().filter((e) => e.kind === "concept" && e.course === course && e.stage === stage.id).at(-1);
    $("editor-concept-toggle").textContent = priorConcept
      ? (priorConcept.correct ? "Idea check answered · revisit" : "Revisit idea check")
      : "Check the idea";
    const stageSpec = spec();
    $("helper-tab-tests").hidden = !stageSpec;
    if (stageSpec) {
      renderExamples(stageSpec);
      renderTests(stageSpec);
      $("editor-tests-note").textContent = stageSpec.note;
    }
    showHelper(stageSpec ? "case" : "guide");
    const target = stagePath(stage.file);
    if (target && bundle?.editable.includes(target)) selectFile(target);
    if (bundle) showPractice();
  }
  async function open(nextCourse, nextStage) {
    if (!nextCourse || !nextStage) return;
    if (course !== nextCourse) bundle = null;
    course = nextCourse;
    stage = nextStage;
    window.forjaWorkspace?.setMode?.("browser");
    $("browser-editor").hidden = false;
    $("editor-goal").textContent = "Loading starter files…";
    requestAnimationFrame(() => cm.refresh());
    try {
      await load();
      guide();
      jumpToTask();
      requestAnimationFrame(() => cm.focus());
    } catch (error) { result("ERROR", error.message); }
  }
  function onStage(nextCourse, nextStage) {
    if ($("browser-editor").hidden || nextCourse !== course || !nextStage) return;
    if (stage?.id === nextStage.id) return;
    stage = nextStage;
    guide();
    jumpToTask();
  }
  function workerRequest(payload) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(asset("py-worker.mjs") + "?v=20261109e", { type: "module" });
      const id = Date.now();
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Python took too long to load. Check your connection and try again."));
      }, 90000);
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        clearTimeout(timeout);
        worker.terminate();
        resolve(data);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error("Python could not load. Check your connection and try again."));
      };
      worker.postMessage({ id, ...payload });
    });
  }
  async function run() {
    if (running || !bundle || !stage) return;
    save();
    clearErrorLines();
    const checkedStage = stage;
    const checkedCourse = course;
    running = true;
    $("editor-run").disabled = true;
    $("editor-run").textContent = "Submitting…";
    result("TODO", "Loading Python and checking this stage. The first run may take a moment.");
    const files = currentFiles();
    const source = files[checkedStage.file] || "";
    const prior = records().filter((e) => e.kind === "run" && e.course === checkedCourse && e.stage === checkedStage.id);
    let outcome;
    try {
      outcome = await workerRequest({
        files, stage: checkedStage.id, course: checkedCourse,
        entry: bundle.entry, label: checkedStage.title, input: checkedStage.action,
      });
    } catch (error) {
      outcome = { status: "ERROR", detail: error.message };
    } finally {
      running = false;
      $("editor-run").disabled = false;
      $("editor-run").textContent = "Submit";
    }
    const advice = learning.runAdvice(checkedStage.learning, checkedStage.target, outcome, source, prior);
    learning.append(localStorage, {
      ts: Date.now(), course: checkedCourse, stage: checkedStage.id, kind: "run",
      status: outcome.status, detail: outcome.detail,
      checkId: outcome.check?.line || null,
      sourceHash: learning.fingerprint(source), hintCount: hintIndex,
    });
    if (outcome.status === "PASS") {
      try {
        const key = "forja.browser.passed.v1";
        const passed = JSON.parse(localStorage.getItem(key) || "{}");
        passed[checkedCourse] = [...new Set([...(passed[checkedCourse] || []), checkedStage.id])];
        localStorage.setItem(key, JSON.stringify(passed));
        window.forjaBrowserPassed?.(checkedCourse, checkedStage.id);
      } catch { /* progress still visible for this run */ }
    }
    if (stage?.id !== checkedStage.id || course !== checkedCourse) return;
    lastOutcome = { ...outcome, sourceHash: learning.fingerprint(source) };
    if (outcome.status !== "PASS" && outcome.line
        && (!outcome.file || outcome.file === checkedStage.file)) {
      markErrorLines([outcome.line]);
    }
    result(outcome.status, outcome.detail);
    $("editor-run-advice").textContent = advice.message;
    $("editor-run-advice").hidden = false;
    showHelper("guide");
    if (advice.probe && currentLearning()?.concept) showConcept();
    if (outcome.status === "PASS") showPractice();
  }
  async function runTests() {
    const stageSpec = spec();
    if (runningTests || !bundle || !stage || !stageSpec) return;
    save();
    clearErrorLines();
    showHelper("tests");
    runningTests = true;
    $("editor-tests-run").disabled = true;
    $("editor-tests-run").textContent = "Running…";
    const summary = $("editor-tests-summary");
    summary.dataset.status = "running";
    summary.textContent = `Running ${stageSpec.cases.length} test cases…`;
    try {
      const outcome = await workerRequest({
        files: currentFiles(), stage: stage.id, mode: "tests",
        course, entry: bundle.entry, label: stage.title, input: stage.action,
      });
      if (!Array.isArray(outcome.cases)) {
        if (outcome.line) markErrorLines([outcome.line]);
        throw new Error(outcome.detail || "The test worker returned no cases.");
      }
      const results = new Map(outcome.cases.map((test) => [test.id, test]));
      renderTests(stageSpec, results);
      const statuses = outcome.cases.map((test) => test.status);
      summary.dataset.status = statuses.includes("error")
        ? "error"
        : statuses.some((status) => status !== "passed") ? "failed" : "passed";
    } catch (error) {
      const learner = error.message.match(/File "\/forja-[^/]+\/([^"]+)", line (\d+)/);
      if (learner) markErrorLines([Number(learner[2])]);
      summary.dataset.status = "error";
      summary.textContent = `Could not run tests: ${error.message}`;
    } finally {
      runningTests = false;
      $("editor-tests-run").disabled = false;
      $("editor-tests-run").textContent = "Run";
    }
  }

  function normalizeKey(event) {
    if (event.key === "ArrowUp") return "↑";
    if (event.key === "ArrowDown") return "↓";
    if (event.key === "ArrowLeft") return "←";
    if (event.key === "ArrowRight") return "→";
    if (event.key === "Escape") return "<Esc>";
    if (event.key === "Backspace") return "<BS>";
    if (event.key === "Delete") return "<Del>";
    if (event.key === "Enter") return "<CR>";
    if (event.key === "Tab") return "<Tab>";
    if (event.key === " ") return "␠";
    return event.key.length === 1 ? event.key : null;
  }
  function vimStatusMode() {
    if (!vimEnabled) return "off";
    if (cm?.state.vim?.insertMode) return "insert";
    if (cm?.state.vim?.visualMode) return "visual";
    return vimMode === "replace" ? "replace" : "normal";
  }
  function updateVimStatus() {
    const mode = vimStatusMode();
    const status = $("editor-vim-status");
    status.dataset.mode = mode;
    status.textContent = {
      normal: "-- NORMAL --", insert: "-- INSERT --", visual: "-- VISUAL --",
      replace: "-- REPLACE --", off: "-- VIM OFF --",
    }[mode];
    const toggle = $("editor-vim-toggle");
    toggle.textContent = "Vim";
    toggle.title = vimEnabled ? "Vim keybindings on" : "Vim keybindings off";
    toggle.setAttribute("aria-pressed", String(vimEnabled));
    $("editor-vim-keys").textContent = `${vimLog.length} keys`;
  }
  function recordKey(event) {
    if (!vimEnabled || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = normalizeKey(event);
    if (!key) return;
    const now = performance.now();
    if (now - lastKeyAt > 1000) burstStart = vimLog.length;
    lastKeyAt = now;
    vimLog.push({ key, mode: vimStatusMode(), line: cm.getCursor().line + 1 });
    if (vimLog.length > 2000) {
      const drop = 500;
      vimLog.splice(0, drop);
      burstStart = Math.max(0, burstStart - drop);
    }
    updateVimStatus();
  }
  function setVim(next) {
    vimEnabled = next;
    cm.setOption("keyMap", vimEnabled ? "vim" : "default");
    vimMode = "normal";
    try { localStorage.setItem(VIM_KEY, vimEnabled ? "on" : "off"); } catch { /* session only */ }
    updateVimStatus();
  }
  function addTip(tips, title, detail, savings) {
    if (!tips.some((tip) => tip.title === title)) tips.push({ title, detail, savings });
  }
  function analyzeVim(log) {
    const tips = [];
    const normal = log.filter((key) => key.mode === "normal").length;
    const insert = log.filter((key) => key.mode === "insert").length;
    const arrows = log.filter((key) => ["↑", "↓", "←", "→"].includes(key.key)).length;
    if (arrows) {
      addTip(tips, "Leave the arrow keys alone",
        `${arrows} arrow press${arrows === 1 ? "" : "es"}. Use h/j/k/l for single steps; use w, b, 0, $ or a count when the target is further away.`,
        null);
    }
    for (const [key, direction] of [["h", "left"], ["l", "right"], ["j", "down"], ["k", "up"]]) {
      let i = 0;
      while (i < log.length) {
        let j = i + 1;
        while (j < log.length && log[j].key === key && log[j].mode === "normal") j += 1;
        const count = j - i;
        if (count >= 3 && log[i].mode === "normal") {
          addTip(tips, `Count a ${direction} run`,
            `${count} ${key} presses in a row. \`${count}${key}\` is ${count - 2} keys shorter; w/b or 0/$ may be shorter still.`,
            count - 2);
        }
        i = j;
      }
    }
    let i = 0;
    while (i < log.length) {
      let j = i + 1;
      while (j < log.length && log[j].key === log[i].key && log[j].mode === log[i].mode) j += 1;
      const count = j - i;
      if (count >= 3 && log[i].mode === "normal" && log[i].key === "x") {
        addTip(tips, "Delete a range, not one character at a time",
          `${count} \`x\` presses. \`d${count}l\` deletes the same run in three keys; \`dw\` or \`diw\` may fit better.`,
          Math.max(0, count - 3));
      }
      if (count >= 4 && log[i].mode === "insert" && ["<BS>", "<Del>"].includes(log[i].key)) {
        addTip(tips, "Replace the word instead of erasing it",
          `${count} ${log[i].key} presses. If you are replacing a word, \`ciw\` (3 keys) then Esc is shorter; \`cc\` replaces a whole line.`,
          Math.max(0, count - 2));
      }
      i = j;
    }
    for (let n = 0; n < log.length - 1; n += 1) {
      if (log[n].mode !== "normal" || log[n + 1].mode !== "normal") continue;
      if (log[n].key === "0" && log[n + 1].key === "i") {
        addTip(tips, "Use I at the start of a line", "`0` then `i` is the long way to `I`.", 1);
      }
      if (log[n].key === "$" && log[n + 1].key === "i") {
        addTip(tips, "Use A at the end of a line", "`$` then `i` is the long way to `A`.", 1);
      }
    }
    tips.sort((a, b) => (b.savings ?? -1) - (a.savings ?? -1));
    return { normal, insert, arrows, tips };
  }
  function analyzeKeys() {
    const summary = $("vim-coach-summary");
    const burstBox = $("vim-coach-burst");
    const list = $("vim-coach-list");
    list.replaceChildren();
    if (!vimLog.length) {
      summary.textContent = "No Vim keys recorded yet. Put the cursor in the editor and make an edit.";
      burstBox.textContent = "";
      return;
    }
    const burst = vimLog.slice(burstStart);
    const session = analyzeVim(vimLog);
    const latest = burst.length >= 2 ? analyzeVim(burst) : null;
    summary.textContent = `${vimLog.length} keys · ${session.normal} normal · ${session.insert} insert · ${session.arrows} arrow${session.arrows === 1 ? "" : "s"}`;
    burstBox.replaceChildren();
    burstBox.append(`Last burst: ${burst.length} keys `);
    const sequence = document.createElement("code");
    sequence.textContent = burst.slice(-40).map((key) => key.key).join(" ");
    burstBox.appendChild(sequence);
    const tips = [];
    for (const tip of (latest?.tips || [])) {
      if (!tips.some((item) => item.title === tip.title)) tips.push(tip);
    }
    for (const tip of session.tips) {
      if (!tips.some((item) => item.title === tip.title)) tips.push(tip);
    }
    if (!tips.length) {
      const empty = document.createElement("li");
      empty.className = "vim-tip";
      const title = document.createElement("b");
      title.textContent = "No obvious wasted keys yet";
      const detail = document.createElement("span");
      detail.textContent = "Make a larger edit, then analyze again. Repeats, arrows and long backspace runs are the clearest signals.";
      empty.append(title, detail);
      list.appendChild(empty);
      return;
    }
    for (const tip of tips.slice(0, 5)) {
      const item = document.createElement("li");
      item.className = "vim-tip";
      const title = document.createElement("b");
      title.textContent = tip.title;
      const detail = document.createElement("span");
      detail.textContent = tip.detail;
      if (Number.isFinite(tip.savings) && tip.savings > 0) {
        const save = document.createElement("em");
        save.textContent = ` Save ~${tip.savings} key${tip.savings === 1 ? "" : "s"}.`;
        detail.appendChild(save);
      }
      item.append(title, detail);
      list.appendChild(item);
    }
  }

  function jumpToLine(line) {
    if (!cm) return;
    const target = { line: Math.max(0, line - 1), ch: 0 };
    cm.setCursor(target);
    cm.scrollIntoView(target, 120);
    cm.focus();
  }
  function renderReview(review) {
    const wrap = $("editor-review-wrap");
    const list = $("editor-review-list");
    const summary = $("editor-review-summary");
    wrap.hidden = false;
    list.replaceChildren();
    summary.textContent = review.total
      ? `${review.total} note${review.total === 1 ? "" : "s"} · ${review.errors} error${review.errors === 1 ? "" : "s"} · ${review.guidelines} guideline${review.guidelines === 1 ? "" : "s"}`
      : "No guideline or checker issues in the target.";
    if (!review.total) {
      const empty = document.createElement("li");
      empty.className = "review-empty";
      empty.textContent = "No comments for the target function.";
      list.appendChild(empty);
      return;
    }
    for (const row of review.lines) {
      const item = document.createElement("li");
      item.className = "review-row" + (row.comments.some((c) => c.kind === "error") ? " is-error" : "");
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Review line ${row.line}`);
      item.onclick = () => jumpToLine(row.line);
      item.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpToLine(row.line);
        }
      };
      const head = document.createElement("div");
      head.className = "review-row-head";
      const number = document.createElement("span");
      number.className = "review-line";
      number.textContent = `Line ${row.line}`;
      head.appendChild(number);
      for (const comment of row.comments) {
        const kind = document.createElement("span");
        kind.className = "review-kind";
        kind.textContent = `${comment.kind} · ${comment.rule}`;
        head.appendChild(kind);
      }
      const source = document.createElement("code");
      source.className = "review-code";
      source.textContent = row.code || " ";
      item.append(head, source);
      for (const comment of row.comments) {
        const message = document.createElement("p");
        message.className = "review-message";
        message.textContent = comment.message;
        item.appendChild(message);
      }
      list.appendChild(item);
    }
  }
  function reviewSnapshot() {
    if (!stage || !file || !code()) return null;
    const source = code();
    const ranges = window.forjaCodeReview?.targetRanges(source.split("\n"), stage.target) || [];
    const failureFile = lastOutcome?.file;
    const failureLine = (failureFile === file || failureFile === stage.file)
      && lastOutcome.sourceHash === learning.fingerprint(source) ? lastOutcome.line : null;
    const review = window.forjaCodeReview?.review(source, {
      ranges,
      target: stage.target,
      stage: stage.id,
      task: stage.action || stage.task,
      failureLine,
      failureDetail: lastOutcome?.detail,
    });
    return review ? { file, stage, source, ranges, failureLine, review } : null;
  }
  function reviewCode() {
    const snapshot = reviewSnapshot();
    if (!snapshot) return;
    renderReview(snapshot.review);
  }

  cm = CodeMirror.fromTextArea($("editor-code"), {
    mode: "python",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    keyMap: "vim",
    viewportMargin: 20,
    extraKeys: {
      "Ctrl-Enter": () => run(),
      "Cmd-Enter": () => run(),
      Tab: (editor) => {
        if (!vimEnabled || editor.state.vim?.insertMode) editor.replaceSelection("    ", "end");
      },
    },
  });
  try {
    vimEnabled = localStorage.getItem(VIM_KEY) !== "off";
  } catch { vimEnabled = true; }
  if (!vimEnabled) cm.setOption("keyMap", "default");
  cm.on("change", () => {
    if (!settingCode) clearErrorLines();
    save();
  });
  cm.on("keydown", (editor, event) => recordKey(event));
  cm.on("vim-mode-change", (change) => {
    vimMode = change.mode;
    updateVimStatus();
  });
  cm.on("cursorActivity", updateVimStatus);
  updateVimStatus();

  $("editor-file").addEventListener("change", (event) => selectFile(event.target.value));
  $("editor-jump").addEventListener("click", jumpToTask);
  $("editor-format").addEventListener("click", formatCode);
  $("editor-reset").addEventListener("click", resetCode);
  $("editor-vim-toggle").addEventListener("click", () => setVim(!vimEnabled));
  for (const button of document.querySelectorAll("[data-helper-tab]")) {
    button.addEventListener("click", () => showHelper(button.dataset.helperTab));
  }
  $("editor-hint").addEventListener("click", () => {
    const available = stage?.hints?.length ? stage.hints : [
      `Look at ${stage?.target || stage?.file || "the named function"}. Find the first unfinished part needed for this stage.`,
      "Run the stage after a small edit. The check result will tell you what to inspect next."
    ];
    $("editor-hint-text").textContent = available[Math.min(hintIndex, available.length - 1)];
    hintIndex++;
    if (hintIndex >= available.length) $("editor-hint").disabled = true;
  });
  $("editor-concept-toggle").addEventListener("click", showConcept);
  $("editor-concept-submit").addEventListener("click", () => submitQuestion("concept"));
  $("editor-practice-submit").addEventListener("click", () => submitQuestion("practice"));
  $("editor-practice-jump").addEventListener("click", () => {
    $("editor-practice").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("editor-tests-run").addEventListener("click", runTests);
  $("vim-analyze").addEventListener("click", analyzeKeys);

  $("editor-run").addEventListener("click", run);
  $("editor-close").addEventListener("click", () => {
    $("browser-editor").hidden = true;
    window.forjaWorkspace?.setMode?.("local");
  });
  $("editor-download").addEventListener("click", () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([code()], { type: "text/x-python" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.forjaEditor = {
    open,
    onStage,
    review: reviewSnapshot,
    code,
    specFor,
  };
})();
