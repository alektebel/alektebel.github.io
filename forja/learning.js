/* Small, inspectable learning rules for the AWS browser pilot.
   A code check, a concept answer, and later recall remain separate evidence. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.forjaLearning = api;
})(globalThis, function () {
  const KEY = "forja.learning.events.v1";
  const DAY = 24 * 60 * 60 * 1000;

  function read(storage) {
    try {
      const events = JSON.parse(storage.getItem(KEY) || "[]");
      return Array.isArray(events) ? events.filter((e) => e && typeof e === "object") : [];
    } catch { return []; }
  }

  function append(storage, event) {
    const events = read(storage);
    events.push(event);
    try { storage.setItem(KEY, JSON.stringify(events.slice(-400))); } catch { /* private mode */ }
    return events;
  }

  function fingerprint(source) {
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function unfinishedTarget(source, target) {
    const lines = source.split("\n");
    const names = (target || "").split("/").map((part) =>
      part.trim().split(".").pop().match(/^[A-Za-z_]\w*/)?.[0]).filter(Boolean);
    for (const name of names) {
      const start = lines.findIndex((line) => new RegExp(`^([ \\t]*)def\\s+${name}\\s*\\(`).test(line));
      if (start < 0) continue;
      const indent = lines[start].match(/^\s*/)[0].length;
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() && !line.trimStart().startsWith("#") && line.match(/^\s*/)[0].length <= indent) break;
        if (line.includes("raise NotImplementedError")) return name;
      }
    }
    return null;
  }

  function runAdvice(learning, target, outcome, source, priorRuns) {
    const previous = priorRuns.at(-1);
    const currentHash = fingerprint(source);
    const expression = outcome.check?.expression || "";
    const check = expression.startsWith("assert ") ? expression.slice(7)
      : expression.startsWith("raise AssertionError(") ? outcome.detail : expression;
    const checkId = outcome.check?.line || null;
    if (outcome.status === "PASS") {
      return { message: previous && previous.status !== "PASS"
        ? "Your latest change passed the stage check. Check the idea separately when you're ready."
        : "The code check passed. You can check the idea separately when you're ready.", probe: false };
    }
    if (outcome.status === "ERROR") {
      const runtimeLookup = /(?:KeyError|IndexError|S3Error):/.test(outcome.detail || "");
      return { message: runtimeLookup && learning?.failure_focus
        ? [learning.check_case, learning.failure_focus].filter(Boolean).join(" ")
        : "Fix the reported Python error first, then rerun this stage.", probe: false };
    }
    if (previous?.sourceHash === currentHash && previous?.status === outcome.status
        && (outcome.status !== "FAIL" || (previous.checkId ?? null) === checkId)) {
      return { message: "This run used the same code and got the same result. Make one small edit before running again.", probe: false };
    }
    const stub = outcome.status === "TODO" ? unfinishedTarget(source, target) : null;
    if (stub) {
      return { message: `The checker reached the unfinished ${stub} function. Start with that function, then rerun the stage.`, probe: false };
    }
    const caseText = check ? `The failing check is: ${check}.` : learning?.check_case || "";
    const focus = learning?.failure_focus || "Inspect that behavior before changing more code.";
    const sameFailure = outcome.status === "FAIL" && checkId != null
      && priorRuns.some((run) => run.status === "FAIL" && run.checkId === checkId
        && run.sourceHash !== currentHash);
    const movedFailure = outcome.status === "FAIL" && previous?.status === "FAIL"
      && previous.checkId != null && checkId != null && previous.checkId !== checkId;
    return {
      message: [movedFailure ? "Your edit reached a different check." :
        sameFailure ? "The same check still fails after your edit." : "",
      caseText, focus].filter(Boolean).join(" "),
      probe: sameFailure,
    };
  }

  function answer(question, choice) {
    if (!question || !Number.isInteger(choice) || choice < 0 || choice >= question.options.length) return null;
    return { correct: choice === question.correct, feedback: question.feedback[choice] };
  }

  function duePractice(events, passedIds, learning, currentStage, now) {
    const passed = new Set(passedIds);
    for (const id of Object.keys(learning || {}).map(Number).sort((a, b) => a - b)) {
      if (!passed.has(id) || !learning[id]?.transfer) continue;
      const last = events.filter((e) => e.kind === "practice" && e.stage === id).at(-1);
      if (last?.correct) continue;
      if (last && now - last.ts < DAY) continue;
      const pass = events.find((e) => e.kind === "run" && e.stage === id && e.status === "PASS");
      const progressed = currentStage >= id + 2 && [...passed].some((other) => other > id && other < currentStage);
      const aged = pass && now - pass.ts >= DAY;
      if (last || progressed || aged) return id;
    }
    return null;
  }

  return { KEY, read, append, fingerprint, unfinishedTarget, runAdvice, answer, duePractice };
});
