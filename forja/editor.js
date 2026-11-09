/* A local, stage-aware Python workspace. Drafts never leave this browser. */
(() => {
  const $ = (id) => document.getElementById(id);
  const PREFIX = "forja.code.aws-from-scratch.";
  const learning = window.forjaLearning;
  let bundle = null;
  let course = null;
  let stage = null;
  let file = null;
  let hintIndex = 0;
  let running = false;
  let lastOutcome = null;

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
    if (lastOutcome?.file && lastOutcome.file !== name) lastOutcome = null;
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
    if (bundle?.editable.includes(stage.file)) selectFile(stage.file);
    if (bundle) showPractice();
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
    jumpToTask();
  }
  async function run() {
    if (running || !bundle || !stage) return;
    save();
    const checkedStage = stage;
    const checkedCourse = course;
    running = true;
    $("editor-run").disabled = true;
    $("editor-run").textContent = "Running…";
    result("TODO", "Loading Python and checking this stage. The first run may take a moment.");
    const files = { ...bundle.files };
    for (const name of bundle.editable) files[name] = draft(name) ?? bundle.files[name];
    const source = files[checkedStage.file] || "";
    const prior = records().filter((e) => e.kind === "run" && e.course === checkedCourse && e.stage === checkedStage.id);
    let worker;
    let outcome;
    try {
      worker = new Worker(asset("py-worker.mjs"), { type: "module" });
      const id = Date.now();
      outcome = await new Promise((resolve, reject) => {
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
        worker.postMessage({ id, files, stage: checkedStage.id });
      });
    } catch (error) { outcome = { status: "ERROR", detail: error.message }; }
    finally {
      worker?.terminate();
      running = false;
      $("editor-run").disabled = false;
      $("editor-run").textContent = "Run stage";
    }
    const advice = learning.runAdvice(checkedStage.learning, checkedStage.target, outcome, source, prior);
    learning.append(localStorage, {
      ts: Date.now(), course: checkedCourse, stage: checkedStage.id, kind: "run",
      status: outcome.status, detail: outcome.detail,
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
    result(outcome.status, outcome.detail);
    $("editor-run-advice").textContent = advice.message;
    $("editor-run-advice").hidden = false;
    if (advice.probe && currentLearning()?.concept) showConcept();
    if (outcome.status === "PASS") showPractice();
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
  $("editor-concept-toggle").addEventListener("click", showConcept);
  $("editor-concept-submit").addEventListener("click", () => submitQuestion("concept"));
  $("editor-practice-submit").addEventListener("click", () => submitQuestion("practice"));
  $("editor-practice-jump").addEventListener("click", () => {
    $("editor-practice").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  function jumpToLine(line) {
    const code = $("editor-code");
    const value = code.value;
    const lines = value.split("\n");
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) offset += lines[i].length + 1;
    const end = offset + (lines[line - 1]?.length || 0);
    code.focus();
    code.setSelectionRange(offset, end);
    code.scrollTop = Math.max(0, (line - 4) * 21);
    $("editor-lines").scrollTop = code.scrollTop;
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
      const code = document.createElement("code");
      code.className = "review-code";
      code.textContent = row.code || " ";
      item.append(head, code);
      for (const comment of row.comments) {
        const message = document.createElement("p");
        message.className = "review-message";
        message.textContent = comment.message;
        item.appendChild(message);
      }
      list.appendChild(item);
    }
  }

  function reviewCode() {
    if (!stage || !$("editor-code").value) return;
    const code = $("editor-code").value;
    const ranges = window.forjaCodeReview?.targetRanges(code.split("\n"), stage.target) || [];
    const failureLine = lastOutcome?.file === file
      && lastOutcome.sourceHash === learning.fingerprint(code) ? lastOutcome.line : null;
    const result = window.forjaCodeReview?.review(code, {
      ranges,
      target: stage.target,
      stage: stage.id,
      task: stage.action || stage.task,
      failureLine,
      failureDetail: lastOutcome?.detail,
    });
    if (result) renderReview(result);
  }

  $("editor-review").addEventListener("click", reviewCode);
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
