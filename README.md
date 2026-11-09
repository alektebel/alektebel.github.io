Página web personal:
https://diegoatencia.dev/

## Blog

Posts are static pages in `blog/`, dressed by a TUI-style shell
(`assets/personal/tui.css` + `blog/tui.js`): title bar, post index on the left,
status bar at the bottom, and keyboard navigation (`↑`/`↓` or `j`/`k`, `↵` to
read, `/` to filter, `g`/`G` for the ends). `blog/posts.json` is the index — it
feeds the left pane and the preview. The shell removes the old
`.site-header`/`.site-footer` when a page still carries them, so legacy posts
keep working unchanged.

### Writing a post in markdown

```bash
mkdir -p blog/posts
$EDITOR blog/posts/my-new-post.md
python3 blog/build.py            # renders every blog/posts/*.md
```

Front matter and body:

```md
---
title: My new post
date: 2026-11-09
tags: mathematics, llm
excerpt: One sentence for the index (optional; derived from the body otherwise).
---

Body in markdown. Math between $...$ or $$...$$ is rendered by KaTeX.
```

`build.py` needs `md2html` (md4c) or `markdown-it` (markdown-it-py) on PATH.
It writes `blog/<slug>.html` and upserts the entry in `blog/posts.json`
(slug = filename, or a `slug:` front-matter key). LaTeX is protected from the
markdown renderer, so backslashes survive; avoid bare `$` outside math, since
KaTeX pairs dollar signs greedily.

Preview locally:

```bash
python3 -m http.server 8000   # http://127.0.0.1:8000/blog/blog.html
```

Then `git add -A && git commit && git push`; Pages publishes `main`.

### Identity / editing from the browser

GitHub Pages is static: there is no server-side login and everything in the
repo is public, so a login form on the site cannot protect authoring. The
credential is your GitHub account — `git push` (or `gh auth login`) is the
authentication. For a "log in and edit a post" flow, use a git-based CMS
(Sveltia or Decap) or GitHub's editor (`github.com/.../edit/main/...`, or `.`
for github.dev); those commit through the GitHub API. A CMS authoring markdown
still needs the build step above, e.g. a GitHub Action before Pages deploys.

## Custom domain — diegoatencia.dev

The site is served from the `CNAME` file at the repo root (`diegoatencia.dev`),
published from `main` by GitHub Pages.

DNS at Porkbun must point at GitHub, not at Porkbun's parking host
(`pixie.porkbun.com`):

| Type  | Host                 | Answer                | TTL |
|-------|----------------------|-----------------------|-----|
| ALIAS | `diegoatencia.dev`   | `alektebel.github.io` | 600 |
| CNAME | `www`                | `alektebel.github.io` | 600 |

Delete the wildcard `*.diegoatencia.dev -> pixie.porkbun.com` record, otherwise
every other subdomain lands on the parking page.

Instead of the ALIAS, GitHub's apex A records also work:
`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
(AAAA: `2606:50c0:8000::153` through `...8003::153`).

After DNS propagates, tick **Settings -> Pages -> Enforce HTTPS** once GitHub
has issued the certificate.

### Backends

Both backends allow-list the site origin, so each needs the new domain:

- `backend/` (ask-this-site Lambda) — `ALLOWED_ORIGIN` now takes a
  comma-separated list; redeploy the stack to pick up the new default.
- The live mus table (`34.253.36.5.sslip.io`, Caddy on AWS, not in this repo)
  allow-lists both `https://diegoatencia.dev` and `https://alektebel.github.io`.
  The table page is `/mus/` (built by `publish/build_static_play.sh` in
  mus-benchmark); `/mus/play/` and the old benchmark pages redirect to it.

### learn progress backend (Google sign-in, per-user progress)

`/learn` runs the graded checks in the browser (Pyodide). Progress lives in
localStorage; signing in with Google additionally syncs the list of
passed checks per account (DynamoDB keyed by the Google `sub`). ~$0/month:
HTTP API + Lambda free tiers, on-demand DynamoDB. Code and output never
leave the browser.

One-time setup:

1. [console.cloud.google.com](https://console.cloud.google.com) -> APIs & Services
   -> Credentials -> Create credentials -> **OAuth client ID** (type *Web application*).
   Authorized JavaScript origins: `https://diegoatencia.dev`,
   `https://www.diegoatencia.dev`, `https://alektebel.github.io`
   (plus `http://127.0.0.1:8000` while testing). No redirect URIs needed —
   the flow is ID-token only (Google Identity Services), so there is no
   client secret to keep anywhere. Copy the client id.
2. Package and upload the code (same deploy user/bucket as the ask backend):
   `cd backend/progress && zip ../progress.zip app.py`, then
   `aws s3 cp ../progress.zip s3://<CodeBucket>/learn-progress/progress.zip`.
3. `aws cloudformation deploy --region eu-west-1 \
     --template-file backend/template-progress-cfn.yaml \
     --stack-name learn-progress --capabilities CAPABILITY_IAM \
     --parameter-overrides CodeBucket=<bucket> GoogleClientId=<id>.apps.googleusercontent.com`
4. Paste the stack's `ProgressEndpoint` output and the client id into
   `PROGRESS_ENDPOINT` / `GOOGLE_CLIENT_ID` at the top of `learn/index.html`.
   Until both are filled the page behaves exactly as before (local progress,
   no sign-in button).

Login is remembered by Google itself: the site keeps the ID token until it
expires (~1 h), and the next "sign in" is a single *continue as* click while
the user has a Google session. Sync is monotonic — only PASSes are stored, so
devices merge and progress never regresses.
