#!/usr/bin/env python3
"""Build TUI blog posts from markdown sources.

Usage:
    python3 blog/build.py                 # build every blog/posts/*.md
    python3 blog/build.py path/to/post.md # build one file
    python3 blog/build.py --stdout post.md

A source file is markdown with front matter:

    ---
    title: Teaching LLMs to wink
    date: 2026-09-14
    tags: multi-agent, games
    excerpt: Optional one-sentence summary for the index.
    ---

    Body in markdown. Math between $...$ or $$...$$ is rendered by KaTeX.

The script writes blog/<slug>.html (slug = filename or a `slug:` key) and
upserts the entry in blog/posts.json, which drives the index.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import subprocess
import sys
from pathlib import Path

BLOG = Path(__file__).resolve().parent
POSTS_DIR = BLOG / "posts"
MANIFEST = BLOG / "posts.json"

KATEX = """<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, {delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false});">
</script>"""

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>{title} • Diego Rodríguez Atencia</title>
<meta content="{description}" name="description"/>
{katex}
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=Space+Grotesk:wght@400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="/assets/personal/tui.css" rel="stylesheet"/>
<script defer src="/blog/tui.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
<a href="/">diego rodríguez atencia</a>
<nav aria-label="Site">
<a href="/index.html">me</a>
<a href="/cv.html">cv</a>
<a aria-current="page" href="/blog/blog.html">blog</a>
<a class="github-link" href="https://github.com/alektebel" rel="noopener noreferrer" target="_blank">github ↗</a>
</nav>
</header>
<main class="wrap" id="main">
<header class="post-header">
<h1>{title}</h1>
<p class="post-meta">{date_label} · {tags}</p>
</header>
<article class="content">
{body}
</article>
</main>
<footer class="site-footer">
<div class="inner">
<nav aria-label="Elsewhere">
<a href="mailto:dratencia@gmail.com">email</a>
<a href="https://github.com/alektebel" rel="noopener noreferrer" target="_blank">github</a>
<a href="/blog/blog.html">all posts</a>
<a href="/">home</a>
</nav>
<span class="copy">© 2026 Diego Rodríguez Atencia</span>
</div>
</footer>
</body>
</html>
"""


def fail(message: str) -> None:
    sys.exit(f"build.py: {message}")


def parse_front_matter(text: str, source: Path) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        fail(f"{source}: missing front matter (first line must be ---)")
    try:
        close = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        fail(f"{source}: front matter is not closed with ---")
    meta: dict[str, str] = {}
    for line in lines[1:close]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            fail(f"{source}: bad front matter line: {line!r}")
        meta[key.strip().lower()] = value.strip().strip("\"'")
    body = "\n".join(lines[close + 1 :]).strip()
    if not meta.get("title"):
        fail(f"{source}: front matter needs a title")
    return meta, body


MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
MONTHS_SHORT = tuple(name[:3] for name in MONTHS)

FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
DISPLAY_MATH = re.compile(r"\$\$.*?\$\$", re.S)
INLINE_MATH = re.compile(r"(?<!\\)\$(?!\s)[^$\n]*?(?<!\s)(?<!\\)\$")


def protect_math(markdown: str) -> tuple[str, list[str]]:
    """Hide math from the markdown renderer so LaTeX escapes survive."""
    stash: list[str] = []

    def keep(match: re.Match[str]) -> str:
        stash.append(match.group(0))
        return f"MATHSTASH{len(stash) - 1}END"

    out: list[str] = []
    block: list[str] = []
    fence: str | None = None

    def flush() -> None:
        if not block:
            return
        text = "\n".join(block)
        block.clear()
        text = DISPLAY_MATH.sub(keep, text)
        text = INLINE_MATH.sub(keep, text)
        out.append(text)

    for line in markdown.splitlines():
        marker = FENCE.match(line)
        if fence:
            out.append(line)
            if marker and marker.group(1).startswith(fence):
                fence = None
            continue
        if marker:
            flush()
            fence = marker.group(1)
            out.append(line)
            continue
        block.append(line)
    flush()
    return "\n".join(out), stash


def render_markdown(body: str, source: Path) -> str:
    safe, stash = protect_math(body)
    for command in (["md2html", "--gfm"], ["markdown-it", "--stdin"]):
        try:
            result = subprocess.run(command, input=safe, text=True, capture_output=True)
        except FileNotFoundError:
            continue
        if result.returncode != 0:
            detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else f"exit {result.returncode}"
            fail(f"{source}: {command[0]} failed: {detail}")
        rendered = result.stdout.strip()
        for index, math in enumerate(stash):
            rendered = rendered.replace(f"MATHSTASH{index}END", html.escape(math, quote=False))
        return rendered
    fail("no markdown renderer found; install md4c (md2html) or markdown-it-py (markdown-it)")


def split_tags(meta: dict[str, str]) -> list[str]:
    raw = meta.get("tags", "")
    raw = raw.strip("[]")
    return [tag.strip() for tag in raw.split(",") if tag.strip()]


def plain_text(body_html: str) -> str:
    text = re.sub(r"</?(?:p|li|h[1-6]|blockquote|pre|tr|td|th|br|hr)\s*/?>", " ", body_html, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def excerpt_for(body_html: str, meta: dict[str, str]) -> str:
    if meta.get("excerpt"):
        return meta["excerpt"]
    text = plain_text(body_html)
    if len(text) <= 220:
        return text
    cut = text[:220].rsplit(" ", 1)[0]
    return cut.rstrip(".,;:") + "…"


def has_math(markdown: str) -> bool:
    return bool(re.search(r"\$\$|\$[^\s$][^$\n]*[^\s$]\$", markdown))


def build(source: Path, write: bool) -> str | Path:
    meta, body = parse_front_matter(source.read_text(encoding="utf-8"), source)
    slug = meta.get("slug") or source.stem
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
        fail(f"{source}: slug must be lowercase letters, digits and dashes (got {slug!r})")
    date_text = meta.get("date") or dt.date.today().isoformat()
    try:
        date = dt.date.fromisoformat(date_text)
    except ValueError:
        fail(f"{source}: date must be YYYY-MM-DD (got {date_text!r})")

    body_html = render_markdown(body, source)
    excerpt = excerpt_for(body_html, meta)
    tags = split_tags(meta)
    page = PAGE.format(
        title=html.escape(meta["title"]),
        description=html.escape(excerpt, quote=True),
        katex=KATEX if has_math(body) else "",
        date_label=f"{MONTHS[date.month - 1].capitalize()} {date.year}",
        tags=" · ".join(tag if any(ch.isupper() for ch in tag) else tag.capitalize() for tag in tags),
        body=body_html,
    )

    target = BLOG / f"{slug}.html"
    if write:
        target.write_text(page, encoding="utf-8")

    entry = {
        "slug": slug,
        "title": meta["title"],
        "date": date.isoformat(),
        "dateLabel": f"{MONTHS_SHORT[date.month - 1]} {date.year}",
        "tags": tags,
        "excerpt": excerpt,
    }
    if write:
        update_manifest(entry)
        return target
    return page


def update_manifest(entry: dict) -> None:
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = {"posts": []}
    posts = data.get("posts", data)
    posts = [post for post in posts if post.get("slug") != entry["slug"]]
    posts.append(entry)
    posts.sort(key=lambda post: (post.get("date", ""), post.get("slug", "")), reverse=True)
    MANIFEST.write_text(
        json.dumps({"posts": posts}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build TUI blog posts from markdown.")
    parser.add_argument("sources", nargs="*", type=Path, help="markdown files (default: blog/posts/*.md)")
    parser.add_argument("--stdout", action="store_true", help="print generated HTML instead of writing")
    args = parser.parse_args()

    sources = args.sources or sorted(POSTS_DIR.glob("*.md"))
    if not sources:
        fail(f"no markdown sources (put them in {POSTS_DIR.relative_to(BLOG.parent)}/)")
    if args.stdout and len(sources) > 1:
        fail("--stdout accepts a single source")

    for source in sources:
        if not source.is_file():
            fail(f"{source}: not a file")
        result = build(source, write=not args.stdout)
        if args.stdout:
            print(result)
        else:
            print(f"built {result.relative_to(BLOG.parent)}")

    if not args.stdout:
        print("preview: python3 -m http.server 8000 → /blog/")


if __name__ == "__main__":
    main()
