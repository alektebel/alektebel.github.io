# Mus benchmark — trace viewer

Static, dependency-free replay of a finished mus match. No build step, no framework,
no CDN: an `index.html`, a JSON trace, and the card art.

## Deploy to GitHub Pages

Copy this directory to the path you want to serve:

```bash
# from this repo, into your pages repo
mkdir -p /path/to/alektebel.github.io/benchmarks/mus-benchmark/viewer
cp -r publish/web/* /path/to/alektebel.github.io/benchmarks/mus-benchmark/viewer/
```

That puts the post at `/benchmarks/mus-benchmark/` and the viewer at
`/benchmarks/mus-benchmark/viewer/`, which is the layout `docs/blog-draft.md`
links against.

All asset paths are **relative** (`cards/…`, `traces/…`), so it works from any
subdirectory without configuration.

**Before publishing, shrink the card art** — it is 16 MB raw (2.3 MB gzipped), and
`card_back.svg` alone is 2.5 MB:

```bash
npx svgo -f cards --multipass -p 1
```

## Add another trace

```bash
python publish/export_trace.py results/<run_dir> --out publish/web/traces/<slug>.json --slug <slug>
```

Then point the viewer at it — `index.html` currently fetches `traces/seed6.json`
(one line, near the top of the `<script>` block). To offer several, add a `<select>`
that re-fetches and calls `boot()`.

## Trace format

```jsonc
{
  "slug": "seed6",
  "lines":  ["…"],        // shared line table; prompts index into this
  "meta":   {"models": [...], "status": "timeout", "hands_completed": 16, ...},
  "score":  {"vacas_a": 2, "piedras_a": 116, ...},
  "usage":  {"calls": 712, "tokens_in": 2995626, ...},
  "signals":{"published": 97, "caught": 75, "missed": 22},
  "agents": [{"name": "A0", "seat": 0, "calls": 231, "api_errors": 24, ...}],
  "hands":  [{"hand": 1, "dealt": {...}, "gain_a": 51, "winner": 0, ...}],
  "turns":  [{"t": 0.0, "seat": 0, "phase": "MUS_REQUEST", "action": "no",
              "thought": "…", "prompt": [12,13,…], "raw": "{…}", "seen": [...]}],
  "notes":  [{"seat": 0, "raw": "…"}],   // private notes carried across a vaca
  "signal_events": [{"from": 0, "to": 2, "gesture": "guinar-el-ojo",
                     "t_pub": 0.0, "delivered_at": 4.0, "expired": false,
                     "truthful": true}]
}
```

`prompt` is an array of indices into `lines` — prompts repeat a large static rules
preamble every turn, so the shared table cuts the trace from 4.8 MB to 968 KB
(159 KB gzipped). Join with `"\n"` to reconstruct.

A turn with `"prompt": null` is a **fallback**: the model returned nothing usable and
the engine forced a legal action. There are 5 in `seed6`.

## Controls

`←` `→` step · `space` play/pause · speed and hand-jump in the transport bar ·
Every turn deep-links as `#t=<n>`.
