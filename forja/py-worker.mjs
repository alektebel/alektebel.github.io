// The learner's Python runs in this browser worker, never on the site server.
// Pin the runtime so a future Pyodide release cannot silently change checks.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const ready = loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/" });

const PRELUDE = `
import importlib, json, os, sys, traceback
os.chdir(forja_root)
if forja_root not in sys.path:
    sys.path.insert(0, forja_root)
for name in forja_modules:
    sys.modules.pop(name, None)
importlib.invalidate_caches()
`;

const CHECK_CALL = `
    if forja_mode == "course":
        import course as _checker
        _checker.STAGES[forja_stage - 1].check()
    else:
        import check as _checker
        _entry = _checker.CHECKS[forja_stage - 1]
        if isinstance(_entry, (tuple, list)):
            _entry[2]()
        elif hasattr(_entry, "check"):
            _entry.check()
        else:
            _entry()
`;

const STAGE_SCRIPT = `
try:
${CHECK_CALL}
    outcome = {"status": "PASS", "detail": "Stage passed."}
except NotImplementedError as exc:
    frames = traceback.extract_tb(exc.__traceback__)
    learner = next((f for f in reversed(frames)
                    if f.filename.startswith(forja_root)
                    and not f.filename.endswith(("check.py", "course.py", "stage_checks.py"))), None)
    outcome = {"status": "TODO", "detail": str(exc) or "Finish the indicated function, then run again.",
               "file": os.path.basename(learner.filename) if learner else "", "line": learner.lineno if learner else 0}
except AssertionError as exc:
    frames = traceback.extract_tb(exc.__traceback__)
    check = next((f for f in reversed(frames)
                  if f.filename.endswith(("check.py", "course.py", "stage_checks.py"))), None)
    outcome = {"status": "FAIL", "detail": str(exc) or "The stage assertion failed.",
               "check": {"line": check.lineno, "expression": (check.line or "").strip()[:240]} if check else None}
except SystemExit as exc:
    code = getattr(exc, "code", None)
    detail = str(exc) or "The stage checker exited without a message."
    todo = code in (2, 42) or "not implemented" in detail.lower()
    outcome = {"status": "TODO" if todo else "ERROR",
               "detail": "Stage is not implemented yet." if todo else detail}
except Exception as exc:
    frames = traceback.extract_tb(exc.__traceback__)
    learner = next((f for f in reversed(frames)
                    if f.filename.startswith(forja_root)
                    and not f.filename.endswith(("check.py", "course.py", "stage_checks.py"))), None)
    where = f"{os.path.basename(learner.filename)}:{learner.lineno}: " if learner else ""
    outcome = {"status": "ERROR", "detail": where + type(exc).__name__ + ": " + str(exc),
               "file": os.path.basename(learner.filename) if learner else "", "line": learner.lineno if learner else 0}
json.dumps(outcome)
`;

const GENERIC_TEST_SCRIPT = `
def _line_for(exc):
    frames = traceback.extract_tb(exc.__traceback__)
    learner = next((f for f in reversed(frames)
                    if f.filename.startswith(forja_root)
                    and not f.filename.endswith(("check.py", "course.py", "stage_checks.py"))), None)
    return learner.lineno if learner else 0

try:
${CHECK_CALL}
    case = {"status": "passed", "actual": "PASS", "error": ""}
except NotImplementedError as exc:
    case = {"status": "failed", "actual": "", "error": "NotImplementedError: " + (str(exc) or "finish the stage"),
            "line": _line_for(exc)}
except AssertionError as exc:
    case = {"status": "failed", "actual": "", "error": "AssertionError: " + (str(exc) or "the stage assertion failed"),
            "line": _line_for(exc)}
except SystemExit as exc:
    code = getattr(exc, "code", None)
    todo = code in (2, 42) or "not implemented" in (str(exc) or "").lower()
    case = {"status": "failed", "actual": "",
            "error": "Not implemented yet." if todo else "SystemExit: " + (str(exc) or "the stage checker exited")}
except Exception as exc:
    case = {"status": "error", "actual": "",
            "error": type(exc).__name__ + ": " + str(exc), "line": _line_for(exc)}
json.dumps({"cases": [{"id": "stage", "label": forja_label or "Stage checker",
                       "input": forja_input or "", "expected": "PASS", **case}]})
`;

const TEST_SCRIPTS = {
  "aws-from-scratch:9": `
from s3 import S3, S3Error

def _store():
    store = S3()
    store.create_bucket("b")
    return store

def _run(case_id, label, input_text, expected, fn):
    try:
        actual, ok = fn()
        return {"id": case_id, "label": label, "input": input_text,
                "expected": expected, "status": "passed" if ok else "failed",
                "actual": str(actual)[:400]}
    except Exception as exc:
        frames = traceback.extract_tb(exc.__traceback__)
        learner = next((f for f in reversed(frames)
                        if f.filename.startswith(forja_root)
                        and not f.filename.endswith("stage_checks.py")), None)
        return {"id": case_id, "label": label, "input": input_text,
                "expected": expected, "status": "error", "actual": "",
                "line": learner.lineno if learner else 0,
                "error": (type(exc).__name__ + ": " + str(exc))[:400]}

def _etag():
    store = _store()
    etag = store.put_object("b", "a/b.txt", b"hello")
    return repr(etag), isinstance(etag, str) and len(etag) > 0

def _roundtrip():
    store = _store()
    store.put_object("b", "a/b.txt", b"hello")
    body = store.get_object("b", "a/b.txt").body
    return repr(body), body == b"hello"

def _full_key():
    store = _store()
    store.put_object("b", "a/b.txt", b"hello")
    keys = sorted(store.buckets["b"].objects)
    return repr(keys), keys == ["a/b.txt"]

def _two_keys():
    store = _store()
    store.put_object("b", "a/b.txt", b"hello")
    store.put_object("b", "a/c.txt", b"world")
    first = store.get_object("b", "a/b.txt").body
    second = store.get_object("b", "a/c.txt").body
    return repr((first, second)), first == b"hello" and second == b"world"

def _empty():
    store = _store()
    store.put_object("b", "empty", b"")
    body = store.get_object("b", "empty").body
    return repr(body), body == b""

cases = [
    _run("etag", "put_object returns an ETag",
         'store.put_object("b", "a/b.txt", b"hello")', "non-empty str", _etag),
    _run("roundtrip", "get_object returns the written bytes",
         'store.get_object("b", "a/b.txt").body', 'b"hello"', _roundtrip),
    _run("full_key", "the slash stays in one key",
         'sorted(store.buckets["b"].objects)', '["a/b.txt"]', _full_key),
    _run("two_keys", "different full keys do not collide",
         'put "a/b.txt" then "a/c.txt"; read both', 'b"hello" and b"world"', _two_keys),
    _run("empty", "an empty body round trips",
         'store.put_object("b", "empty", b"")', 'get_object(...).body == b""', _empty),
]
json.dumps({"cases": cases})
`,
};

function moduleNames(files) {
  const names = new Set(["codecraft", "codecraft.api"]);
  for (const name of Object.keys(files || {})) {
    if (!name.endsWith(".py")) continue;
    names.add(name.slice(0, -3).replaceAll("/", "."));
  }
  return [...names];
}

self.onmessage = async ({ data }) => {
  const { id, files, stage, mode = "stage", course = "aws-from-scratch", label = "", input = "" } = data;
  const root = `/forja-${course}`;
  try {
    if (!Number.isInteger(stage) || stage < 1 || stage > 63) throw new Error("Invalid stage");
    if (!/^[a-z0-9-]+$/.test(course)) throw new Error("Invalid course");
    const specific = mode === "tests" ? TEST_SCRIPTS[`${course}:${stage}`] : null;
    const script = specific || (mode === "tests" ? GENERIC_TEST_SCRIPT : STAGE_SCRIPT);
    const pyodide = await ready;
    pyodide.FS.mkdirTree(root);
    for (const [name, source] of Object.entries(files || {})) {
      if (typeof source !== "string") continue;
      if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name) || name.includes("..")) continue;
      const path = `${root}/${name}`;
      const slash = path.lastIndexOf("/");
      if (slash > 0) pyodide.FS.mkdirTree(path.slice(0, slash));
      pyodide.FS.writeFile(path, source, { encoding: "utf8" });
    }
    pyodide.globals.set("forja_stage", stage);
    pyodide.globals.set("forja_root", root);
    pyodide.globals.set("forja_mode", data.entry === "course.py" ? "course" : "check");
    pyodide.globals.set("forja_modules", moduleNames(files));
    pyodide.globals.set("forja_label", label);
    pyodide.globals.set("forja_input", input);
    const result = await pyodide.runPythonAsync(PRELUDE + script);
    self.postMessage({ id, mode, ...JSON.parse(result) });
  } catch (error) {
    const detail = error?.message || String(error);
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const learner = detail.match(new RegExp(`File "${escaped}/([^"]+)", line (\\d+)`));
    self.postMessage({
      id, mode, status: "ERROR", detail,
      file: learner?.[1] || "",
      line: learner ? Number(learner[2]) : 0,
    });
  }
};
