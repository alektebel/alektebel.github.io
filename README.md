Página web personal:
https://diegoatencia.dev/

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
- The live mus table (`52.31.169.175.sslip.io`, Caddy on AWS, not in this repo)
  currently returns `Access-Control-Allow-Origin: https://alektebel.github.io`
  only. Add `https://diegoatencia.dev` there or `/mus/play/` breaks on the new
  domain.

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
