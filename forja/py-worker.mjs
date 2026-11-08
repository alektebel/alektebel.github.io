// The learner's Python runs in this browser worker, never on the site server.
// Pin the runtime so a future Pyodide release cannot silently change checks.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const ready = loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/" });
const ROOT = "/forja-aws";
const MODULES = ["iam", "s3", "sqs", "dynamodb", "lambda_svc", "sns", "kms", "vpc", "capstone", "stage_checks"];

self.onmessage = async ({ data }) => {
  const { id, files, stage } = data;
  try {
    if (!Number.isInteger(stage) || stage < 1 || stage > 63) throw new Error("Invalid stage");
    const pyodide = await ready;
    pyodide.FS.mkdirTree(ROOT);
    for (const [name, source] of Object.entries(files || {})) {
      if (!/^[a-z0-9_]+\.py$/.test(name) || typeof source !== "string") continue;
      pyodide.FS.writeFile(`${ROOT}/${name}`, source, { encoding: "utf8" });
    }
    pyodide.globals.set("forja_stage", stage);
    pyodide.globals.set("forja_root", ROOT);
    pyodide.globals.set("forja_modules", MODULES);
    const result = await pyodide.runPythonAsync(`
import importlib, json, os, sys, traceback
os.chdir(forja_root)
if forja_root not in sys.path:
    sys.path.insert(0, forja_root)
for name in forja_modules:
    sys.modules.pop(name, None)
importlib.invalidate_caches()
try:
    import stage_checks
    stage_checks.CHECKS[forja_stage - 1]()
    outcome = {"status": "PASS", "detail": "Stage passed."}
except NotImplementedError as exc:
    frames = traceback.extract_tb(exc.__traceback__)
    learner = next((f for f in reversed(frames) if f.filename.startswith(forja_root) and not f.filename.endswith("stage_checks.py")), None)
    outcome = {"status": "TODO", "detail": str(exc) or "Finish the indicated function, then run again.",
               "file": os.path.basename(learner.filename) if learner else "", "line": learner.lineno if learner else 0}
except AssertionError as exc:
    outcome = {"status": "FAIL", "detail": str(exc) or "The stage assertion failed."}
except Exception as exc:
    frames = traceback.extract_tb(exc.__traceback__)
    learner = next((f for f in reversed(frames) if f.filename.startswith(forja_root) and not f.filename.endswith("stage_checks.py")), None)
    where = f"{os.path.basename(learner.filename)}:{learner.lineno}: " if learner else ""
    outcome = {"status": "ERROR", "detail": where + type(exc).__name__ + ": " + str(exc),
               "file": os.path.basename(learner.filename) if learner else "", "line": learner.lineno if learner else 0}
json.dumps(outcome)
`);
    self.postMessage({ id, ...JSON.parse(result) });
  } catch (error) {
    self.postMessage({ id, status: "ERROR", detail: error?.message || String(error) });
  }
};
