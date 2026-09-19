# Memory — what this chatbot is, and what Diego has done with it

This file is the ask backend's long-term memory. It is read at cold start and
prepended to the system prompt, so the bot can answer "what's new with this
chatbot?" from real notes instead of guessing.

How to update it:
  1. Add a new dated entry at the TOP of the log below. One short paragraph is
     plenty; write it the way you'd tell a colleague.
  2. Redeploy the Lambda with this file in the package (it sits next to app.py,
     so any `zip backend/ask` step already includes it).
  3. The bot picks it up on the next cold start. Nothing in the frontend
     changes — the page just starts answering from the new memory.

Keep entries factual and concrete. Don't log secrets, API keys, or anything you
wouldn't want a visitor reading back in an answer. Oldest entries can be pruned
once they stop being interesting; the loader caps the file at ~8000 characters
and trims from the bottom.

<!-- newest first -->

## 2026-09-19 — the bot got a memory
The ask backend now reads this file into its system prompt, so it can talk
about its own recent history. Entries here feed directly into answers about the
chatbot and what Diego is building with it.

## 2026-09-18 — play-by-play traces
Added full play-by-play traces to the mus project, with a sample page comparing
Jev against DeepSeek, Gemma and Qwen. You can watch how each model handles the
covert signalling channel move by move.

## 2026-09-15 — mus play page rebuilt
Rebuilt the live mus table: single vaca, mobile-first layout, and seat-token
adoption so a seat can be claimed and carried between rounds.

## 2026-09-14 — "Teaching LLMs to wink" published
Wrote up the mus-against-the-machine experiment: two AI teams cooperating
through facial twitches only, an órdago decided on a tiebreak rule, and about a
quarter of the signalling channel lost to timing. The harness caught an error
that had already made it into a draft.

## 2026-09-09 — bilingual ask backend
Shipped this chatbot: a Lambda behind an HTTP API on AWS, answering in
Castilian Spanish or English depending on the language of the question, backed
by qwen3.6 through NaN. The key lives in Secrets Manager, CORS is answered in
the function itself, and the static page degrades to an email fallback if the
backend is unreachable.

## 2026-09-09 — site moved to diegoatencia.dev
Personal site published from GitHub Pages on the custom domain diegoatencia.dev,
with DNS pointed at GitHub and both backends allow-listing the new origin.
