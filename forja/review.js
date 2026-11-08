/* Static, per-line code review for the AWS workspace.
   The review is scoped to the stage's target function, the code the checker
   actually exercises. It comments on the pipeline's own rules (standard
   library, injected clock, unfinished template) and on the line where the
   checker stopped. It does not pretend to read semantics it cannot see. */
(() => {
  const BANNED = new Set([
    "time", "random", "threading", "asyncio", "socket", "subprocess",
    "secrets", "uuid",
  ]);
  /* AWS From Scratch keeps to the Python standard library and the supplied
     toy interfaces; an import outside this set would make the stage depend on
     something the course does not ship. */
  const STDLIB = new Set([
    "abc", "argparse", "ast", "base64", "bisect", "builtins", "collections",
    "copy", "dataclasses", "enum", "fnmatch", "functools", "hashlib", "heapq",
    "hmac", "ipaddress", "itertools", "json", "math", "os", "re", "shlex",
    "statistics", "string", "struct", "sys", "textwrap", "time", "types",
    "typing", "unittest", "uuid", "warnings",
  ]);
  const LOCAL = new Set([
    "iam", "s3", "sqs", "dynamodb", "lambda_svc", "sns", "kms", "vpc",
    "capstone", "stage_checks",
  ]);
  const RULES = {
    banned: "AWS From Scratch is deterministic and offline: the clock and randomness are supplied as inputs, so importing this module is refused.",
    stdlib: "The AWS course keeps the Python standard library and the supplied toy interfaces; an outside dependency will not exist in the checker.",
    clock: "The AWS checks run as a function of their inputs; wall clocks, sleeps and randomness make a stage non-deterministic.",
    template: "The starter keeps the exercise. Finish the named target instead of leaving a placeholder.",
    target: "This is inside the function the stage asks you to change; the checker exercises it.",
    checker: "The stage checker stopped at this line; its message is the justification.",
    todo: "The target is still a stub, so the grader reports TODO instead of a pass.",
  };

  function targetRanges(lines, target) {
    const ranges = [];
    for (const raw of String(target || "").split("/")) {
      const name = raw.trim().split(".").pop()?.match(/^[A-Za-z_]\w*/)?.[0];
      if (!name) continue;
      const start = lines.findIndex((line) =>
        new RegExp(`^\\s*(?:async\\s+)?def\\s+${name}\\s*\\(`).test(line));
      if (start < 0) continue;
      const indent = (lines[start].match(/^\s*/) || [""])[0].length;
      let end = lines.length - 1;
      for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        const nextIndent = (line.match(/^\s*/) || [""])[0].length;
        if (nextIndent <= indent) { end = i - 1; break; }
      }
      ranges.push([start + 1, end + 1]);
    }
    return ranges;
  }

  function inRanges(ranges, line) {
    return ranges.some(([start, end]) => line >= start && line <= end);
  }

  function review(text, options = {}) {
    const lines = String(text ?? "").split("\n");
    const ranges = options.ranges || targetRanges(lines, options.target);
    const byLine = new Map();
    const add = (line, kind, rule, message) => {
      if (!Number.isInteger(line) || line < 1 || line > lines.length) return;
      const row = byLine.get(line) || [];
      if (row.some((item) => item.rule === rule && item.message === message)) return;
      row.push({ kind, rule, message });
      byLine.set(line, row);
    };

    const targetOnly = ranges.length > 0;
    lines.forEach((raw, index) => {
      const line = index + 1;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const inScope = !targetOnly || inRanges(ranges, line);
      if (!inScope) return;

      const imported = raw.match(
        /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/);
      if (imported) {
        const root = (imported[1] || imported[2] || "").split(".")[0];
        if (BANNED.has(root)) {
          add(line, "guideline", "banned", `Importing \`${root}\` is banned here. ${RULES.banned}`);
        } else if (root && !STDLIB.has(root) && !LOCAL.has(root)
                   && !raw.trim().startsWith("from .")) {
          add(line, "guideline", "stdlib", `Importing \`${root}\` leaves the standard library. ${RULES.stdlib}`);
        }
      }

      if (!trimmed.startsWith("#")) {
        if (/(?:^|[^\w.])(?:time|random)\s*\./.test(raw)) {
          add(line, "guideline", "clock", `This reads a wall clock or randomness. ${RULES.clock}`);
        }
        if (/^\s*except\s*:/.test(raw)) {
          add(line, "error", "checker", "A bare `except:` can swallow `NotImplementedError`; let it escape so the grader reports TODO cleanly.");
        }
        if (/^\s*raise\s+NotImplementedError\b/.test(raw)) {
          add(line, "error", "todo", `This line is still the stub. ${RULES.todo}`);
        }
        if (/\bTODO\b|\bFIXME\b/.test(raw)) {
          add(line, "guideline", "template", RULES.template);
        }
      }
    });

    const firstTarget = ranges[0]?.[0];
    if (options.stage && firstTarget) {
      const task = String(options.task || "complete the named function.").slice(0, 240);
      add(firstTarget, "guideline", "target",
        `Stage ${options.stage} target${options.target ? ` (${options.target})` : ""}: ${task} ${RULES.target}`);
    }
    if (options.failureLine) {
      add(options.failureLine, "error", "checker",
        `${RULES.checker}${options.failureDetail ? ` ${String(options.failureDetail).slice(0, 240)}` : ""}`);
    }

    const rows = [];
    for (const [line, comments] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      rows.push({
        line,
        code: lines[line - 1],
        target: inRanges(ranges, line),
        comments,
      });
    }
    return {
      lines: rows,
      total: rows.reduce((sum, row) => sum + row.comments.length, 0),
      errors: rows.reduce((sum, row) => sum + row.comments.filter((c) => c.kind === "error").length, 0),
      guidelines: rows.reduce((sum, row) => sum + row.comments.filter((c) => c.kind === "guideline").length, 0),
      ranges,
    };
  }

  window.forjaCodeReview = { review, targetRanges };
})();
