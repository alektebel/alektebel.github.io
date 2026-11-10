// A small SAS mode for CodeMirror 5: enough for the DATA steps and PROCs in
// sas-lgd-from-scratch. It is deliberately not a SAS grammar — comments,
// strings, numbers, keywords and dataset names are what the learner needs to
// see.
(function (mod) {
  if (typeof exports === "object" && typeof module === "object") {
    mod(require("codemirror"));
  } else {
    mod(CodeMirror);
  }
})(function (CodeMirror) {
  "use strict";

  const KEYWORDS = new Set([
    "data", "set", "merge", "by", "where", "if", "then", "else", "do", "end",
    "run", "quit", "retain", "output", "delete", "keep", "drop", "proc", "sort",
    "means", "class", "var", "out", "noprint", "first", "last", "and", "or",
    "not", "in", "to", "descending",
  ]);

  CodeMirror.defineMode("sas", function () {
    return {
      startState: function () {
        return { comment: false };
      },
      token: function (stream, state) {
        if (state.comment) {
          if (stream.skipTo("*/")) {
            stream.match("*/");
            state.comment = false;
          } else {
            stream.skipToEnd();
          }
          return "comment";
        }
        if (stream.eatSpace()) return null;
        if (stream.match("/*")) {
          state.comment = true;
          return "comment";
        }
        const quote = stream.peek();
        if (quote === '"' || quote === "'") {
          stream.next();
          let escaped = false;
          while (!stream.eol()) {
            const ch = stream.next();
            if (ch === quote && !escaped) break;
            escaped = ch === "\\" && !escaped;
          }
          return "string";
        }
        if (stream.match(/\d+(\.\d+)?/)) return "number";
        if (stream.match(/work\.\w+/i)) return "variable-2";
        if (stream.match(/[A-Za-z_]\w*/)) {
          const word = stream.current();
          if (KEYWORDS.has(word.toLowerCase())) return "keyword";
          return "variable";
        }
        stream.next();
        return null;
      },
    };
  });

  CodeMirror.defineMIME("text/x-sas", "sas");
});
