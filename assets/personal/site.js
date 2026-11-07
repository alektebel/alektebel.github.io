'use strict';
const ASK_ENDPOINT = 'https://20rv2a9if4.execute-api.eu-west-1.amazonaws.com/ask';
const clock = document.getElementById('madrid-time');
if (clock) {
  const tick = () => {
    clock.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date());
  };
  tick();
  setInterval(tick, 30000);
}
const commit = document.getElementById('latest-commit');
if (commit) {
  (async () => {
    try {
      const response = await fetch('https://api.github.com/users/alektebel/events/public?per_page=30');
      if (!response.ok) throw new Error('GitHub unavailable');
      const events = await response.json();
      const event = events.find(item => item.type === 'PushEvent' && item.repo?.name?.startsWith('alektebel/'));
      if (!event) throw new Error('No public commits');
      const repo = event.repo.name.split('/')[1];
      const message = event.payload?.commits?.at(-1)?.message?.split('\n')[0];
      const url = message && event.payload.commits.at(-1).sha
        ? `https://github.com/${event.repo.name}/commit/${event.payload.commits.at(-1).sha}`
        : `https://github.com/${event.repo.name}`;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = message ? `${repo}: ${message.slice(0, 70)}` : repo;
      commit.replaceChildren(link);
    } catch {
      const link = document.createElement('a');
      link.href = 'https://github.com/alektebel';
      link.textContent = 'see GitHub activity ↗';
      commit.replaceChildren(link);
    }
  })();
}
for (const form of document.querySelectorAll('.ask-form')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const status = form.querySelector('.ask-status');
    const answer = form.querySelector('.ask-answer');
    const question = input.value.trim();
    if (!question || button.disabled) return;
    button.disabled = true;
    button.textContent = 'thinking…';
    status.hidden = false;
    status.textContent = 'Consulting the archive…';
    answer.hidden = true;
    try {
      const response = await fetch(ASK_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      if (!response.ok) throw new Error('Backend unavailable');
      const data = await response.json();
      if (!data?.answer?.trim()) throw new Error('Empty answer');
      answer.textContent = data.answer.trim();
    } catch {
      answer.textContent = 'That did not go through. Ask me directly: dratencia@gmail.com';
    } finally {
      answer.hidden = false;
      status.hidden = true;
      button.disabled = false;
      button.textContent = 'ask';
    }
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
document.querySelectorAll('.barrapp-visual video').forEach(video => {
  const sync = () => {
    if (reducedMotion.matches) video.pause();
    else video.play().catch(() => {});
  };
  reducedMotion.addEventListener('change', sync);
  sync();
});

const projectsSection = document.querySelector('.projects-section');
if (projectsSection) {
  const content = projectsSection.querySelector('.projects-content');
  const viewport = projectsSection.querySelector('.project-window');
  const track = projectsSection.querySelector('.project-track');
  let travel = 0;
  let enabled = false;
  let frame = 0;

  const render = () => {
    frame = 0;
    if (!enabled) return;
    const distance = Math.min(travel, Math.max(0, -projectsSection.getBoundingClientRect().top));
    track.style.transform = `translateX(${-distance}px)`;
  };
  const onScroll = () => {
    if (!frame && enabled) frame = requestAnimationFrame(render);
  };
  const measure = () => {
    travel = Math.max(0, track.scrollWidth - viewport.clientWidth);
    // Mobile, short viewports and reduced-motion keep a normal swipeable row.
    enabled = window.innerWidth >= 700 && !reducedMotion.matches && travel > 0 && content.offsetHeight + 64 <= window.innerHeight;
    projectsSection.classList.toggle('has-scroll', enabled);
    projectsSection.style.height = enabled ? `${content.offsetHeight + travel}px` : '';
    track.style.transform = '';
    if (enabled) viewport.scrollLeft = 0;
    render();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  reducedMotion.addEventListener('change', measure);
  new ResizeObserver(measure).observe(content);
  document.fonts.ready.then(measure);
  viewport.addEventListener('focusin', event => {
    if (!enabled) return;
    const card = event.target.closest('.project-card');
    if (!card) return;
    const offset = card.getBoundingClientRect().left - track.getBoundingClientRect().left;
    const sectionTop = window.scrollY + projectsSection.getBoundingClientRect().top;
    viewport.scrollLeft = 0;
    window.scrollTo({ top: sectionTop + Math.min(travel, offset), behavior: 'instant' });
    render();
  });
  measure();
}
