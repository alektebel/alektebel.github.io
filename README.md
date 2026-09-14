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
