'use strict';
/* TUI shell for the blog: title bar, post index on the left, status bar,
   keyboard navigation and a preview pane on the index page. */
(() => {
  const POSTS_URL = '/blog/posts.json';
  const main = document.querySelector('main');
  if (!main) return;
  main.tabIndex = -1;

  const isIndex = document.body.dataset.page === 'index';
  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const currentSlug = (() => {
    const file = location.pathname.split('/').pop() || '';
    return file.replace(/\.html$/, '');
  })();

  /* ---------- chrome ---------- */
  const header = document.querySelector('.site-header');
  const footer = document.querySelector('.site-footer');
  const siteNav = el('nav', 'term-nav');
  siteNav.setAttribute('aria-label', 'Site');
  siteNav.innerHTML = `
    <a href="/index.html">me</a>
    <a href="/cv.html">cv</a>
    <a aria-current="page" href="/blog/blog.html">blog</a>
    <a class="github-link" href="https://github.com/alektebel" rel="noopener noreferrer" target="_blank">github ↗</a>`;
  const footerNav = el('nav', 'status-links');
  footerNav.setAttribute('aria-label', 'Elsewhere');
  footerNav.innerHTML = `
    <a href="mailto:dratencia@gmail.com">email</a>
    <a href="https://github.com/alektebel" rel="noopener noreferrer" target="_blank">github</a>
    <a href="/blog/blog.html">all posts</a>
    <a href="/">home</a>`;
  const copyright = el('span', 'copy');
  copyright.textContent = '© 2026 Diego Rodríguez Atencia';

  const term = el('div', 'term');
  const bar = el('div', 'term-bar');
  const dots = el('div', 'term-dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.innerHTML = '<span></span><span></span><span></span>';
  const brand = el('a', 'term-brand');
  brand.href = '/';
  brand.textContent = 'diego@blog';
  const path = el('span', 'term-path');
  path.textContent = ':~/blog';
  const cursorMark = el('span', 'term-cursor');
  cursorMark.setAttribute('aria-hidden', 'true');
  cursorMark.textContent = '▮';
  bar.append(dots, brand, cursorMark, path, el('span', 'grow'), siteNav);

  const bodyWrap = el('div', 'term-body');
  const side = el('aside', 'term-side');
  side.innerHTML = `
    <div class="side-head">
      <div class="side-path"><span>~/blog</span><b>$</b><span>ls</span></div>
      <label class="filter">
        <span class="prompt" aria-hidden="true">/</span>
        <input id="post-filter" type="search" placeholder="filter…" autocomplete="off"
               spellcheck="false" aria-controls="post-index" aria-label="Filter posts">
      </label>
    </div>`;
  const list = el('ul', 'side-list');
  list.id = 'post-index';
  list.setAttribute('aria-label', 'Blog posts');
  const sideFoot = el('div', 'side-foot');
  sideFoot.textContent = 'loading index…';
  side.append(list, sideFoot);

  const pane = el('div', 'term-main');
  pane.tabIndex = 0;
  pane.setAttribute('role', 'region');
  pane.setAttribute('aria-label', isIndex ? 'Index preview' : 'Article');
  const inner = el('div', 'term-main-inner');
  const cmd = el('div', 'pane-cmd');
  const cmdPrompt = el('span', 'prompt');
  cmdPrompt.textContent = '$';
  const cmdLine = el('span', 'file');
  cmdLine.textContent = isIndex ? 'ls ~/blog/*.html' : `cat ~/blog/${currentSlug}.html`;
  cmd.append(cmdPrompt, cmdLine);
  inner.append(cmd, main);
  pane.append(inner);

  const status = el('div', 'term-status');
  const hints = el('div', 'status-hints');
  hints.innerHTML = `
    <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
    <span><kbd>↵</kbd> read</span>
    <span><kbd>/</kbd> filter</span>
    <span><kbd>g</kbd><kbd>G</kbd> ends</span>`;
  const count = el('span', 'status-count');
  count.id = 'status-count';
  count.setAttribute('aria-live', 'polite');
  status.append(hints, el('span', 'grow'), count, footerNav, copyright);

  bodyWrap.append(side, pane);
  term.append(bar, bodyWrap, status);

  if (header) header.remove();
  if (footer) footer.remove();
  const skip = document.querySelector('.skip');
  if (skip) skip.after(term);
  else document.body.prepend(term);

  const filter = side.querySelector('#post-filter');
  const preview = document.getElementById('preview');

  /* ---------- data ---------- */
  let posts = [];
  let cursor = 0;
  let currentLink = null;

  const links = () => Array.from(list.querySelectorAll('a.entry'));
  const visible = () => links().filter(a => !a.closest('li').hidden);

  function renderList() {
    list.textContent = '';
    posts.forEach(post => {
      const li = el('li', 'side-item');
      li._post = post;
      const a = el('a', 'entry');
      a.href = `/blog/${post.slug}.html`;
      a.title = post.title;
      a.dataset.slug = post.slug;
      a.tabIndex = -1;
      a.innerHTML = `
        <span class="cursor" aria-hidden="true">▸</span>
        <span class="entry-body">
          <span class="name">${esc(post.title)}</span>
          <span class="meta">${esc(post.dateLabel)} · ${esc((post.tags || []).join(' · '))}</span>
        </span>`;
      if (post.slug === currentSlug) {
        a.setAttribute('aria-current', 'page');
        li.classList.add('is-current');
      }
      li.append(a);
      list.append(li);
      if (post.slug === currentSlug) currentLink = a;
    });
    updateCounts();
  }

  function updateCounts() {
    const n = visible().length;
    const total = posts.length;
    count.textContent = n === total ? `${total} post${total === 1 ? '' : 's'}` : `${n}/${total} posts`;
    sideFoot.textContent = filter.value.trim()
      ? `${n}/${total} matches`
      : `newest first · ${total} post${total === 1 ? '' : 's'}`;
  }

  function setCursor(index, opts = {}) {
    const { focus = false, scroll = true, show = true } = opts;
    const items = visible();
    if (!items.length) {
      links().forEach(a => {
        a.tabIndex = -1;
        a.closest('li').classList.remove('is-sel');
      });
      if (preview) preview.innerHTML = '<p class="preview-excerpt">no entries match the filter.</p>';
      return;
    }
    cursor = (index + items.length) % items.length;
    links().forEach(a => {
      a.tabIndex = -1;
      a.closest('li').classList.remove('is-sel');
    });
    const active = items[cursor];
    active.tabIndex = 0;
    active.closest('li').classList.add('is-sel');
    if (focus) active.focus({ preventScroll: true });
    if (scroll) active.scrollIntoView({ block: 'nearest' });
    if (show) showPreview(active.dataset.slug);
  }

  function showPreview(slug) {
    if (!preview) return;
    const post = posts.find(item => item.slug === slug);
    if (!post) return;
    const tags = (post.tags || []).map(tag => `<span class="tag">#${esc(tag)}</span>`).join(' ');
    const url = esc(`/blog/${post.slug}.html`);
    preview.innerHTML = `
      <h2 class="preview-title"><a href="${url}">${esc(post.title)}</a></h2>
      <p class="preview-meta">${esc(post.dateLabel)} ${tags}</p>
      <p class="preview-excerpt">${esc(post.excerpt || '')}</p>
      <p class="preview-open"><a href="${url}">read the post →</a></p>`;
  }

  function applyFilter(value) {
    const query = value.trim().toLowerCase();
    const before = visible()[cursor]?.dataset.slug;
    for (const li of list.children) {
      const post = li._post;
      const haystack = `${post.title} ${post.slug} ${(post.tags || []).join(' ')} ${post.dateLabel}`.toLowerCase();
      li.hidden = Boolean(query) && !haystack.includes(query);
    }
    const items = visible();
    const index = Math.max(0, items.findIndex(a => a.dataset.slug === before));
    cursor = index;
    setCursor(index, { scroll: false });
    updateCounts();
  }

  function load() {
    fetch(POSTS_URL, { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        posts = (Array.isArray(data) ? data : data.posts || [])
          .slice()
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        renderList();
        const start = currentLink ? links().indexOf(currentLink) : 0;
        setCursor(Math.max(0, start), { scroll: false, show: isIndex });
      })
      .catch(() => {
        sideFoot.textContent = 'index unavailable';
        count.textContent = '—';
        list.innerHTML = '<li class="side-error">could not load posts.json — serve the site over http</li>';
        if (preview) {
          preview.innerHTML = '<p class="preview-excerpt">could not load <code>/blog/posts.json</code>.</p>';
        }
      });
  }

  /* ---------- events ---------- */
  filter.addEventListener('input', () => applyFilter(filter.value));
  filter.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      filter.value = '';
      applyFilter('');
      filter.blur();
      setCursor(cursor);
      event.preventDefault();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      const items = visible();
      if (!items.length) return;
      event.preventDefault();
      if (event.key === 'Enter') items[Math.min(cursor, items.length - 1)].click();
      else setCursor(cursor, { focus: true });
    }
  });

  list.addEventListener('focusin', event => {
    const link = event.target.closest('a.entry');
    if (!link) return;
    const index = visible().indexOf(link);
    if (index >= 0) setCursor(index, { focus: false, scroll: false, show: isIndex });
  });

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing = Boolean(target.matches?.('input, textarea, select, [contenteditable]'));
    if (typing) return;
    const inSidebar = Boolean(target.closest?.('.term-side'));
    const onBody = target === document.body || target === document.documentElement;

    if (event.key === '/') {
      event.preventDefault();
      filter.focus();
      filter.select();
      return;
    }
    if (event.key === 'Escape') {
      if (filter.value) {
        filter.value = '';
        applyFilter('');
        setCursor(cursor);
      }
      filter.blur();
      return;
    }
    if (!inSidebar && !onBody) return;

    const items = visible();
    if (!items.length) return;
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        setCursor(cursor + 1, { focus: true });
        break;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        setCursor(cursor - 1, { focus: true });
        break;
      case 'g':
      case 'Home':
        event.preventDefault();
        setCursor(0, { focus: true });
        break;
      case 'G':
      case 'End':
        event.preventDefault();
        setCursor(items.length - 1, { focus: true });
        break;
      case 'Enter':
        event.preventDefault();
        items[Math.min(cursor, items.length - 1)].click();
        break;
      default:
        break;
    }
  });

  load();
})();
