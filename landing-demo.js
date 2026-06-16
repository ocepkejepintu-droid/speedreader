const API = '/rsvp/summaries';
const DEFAULT_MODE = 'phantom';
const DEFAULT_WPM = 300;

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function demoIframe() {
  return $('appDemo');
}

function iframeOrigin() {
  return window.location.origin;
}

function currentWpm() {
  const slider = $('demoWpm');
  return slider ? +slider.value : DEFAULT_WPM;
}

function currentMode() {
  const active = document.querySelector('[data-demo-mode].active');
  return active?.dataset.demoMode || DEFAULT_MODE;
}

function postToDemo(message) {
  const frame = demoIframe();
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage(message, iframeOrigin());
}

function syncDemoToIframe() {
  postToDemo({ type: 'rsvp-set-mode', mode: currentMode() });
  postToDemo({ type: 'rsvp-set-wpm', wpm: currentWpm() });
  postToDemo({ type: 'rsvp-play' });
}

function buildDemoUrl(summaryId) {
  const url = new URL('/rsvp/app/', window.location.origin);
  url.searchParams.set('embed', 'landing');
  url.searchParams.set('mode', currentMode());
  url.searchParams.set('wpm', String(currentWpm()));
  url.searchParams.set('autoplay', '1');
  if (summaryId) url.searchParams.set('summary', summaryId);
  return url.pathname + url.search;
}

function setDemoSummary(id) {
  const frame = demoIframe();
  if (!frame || !id) return;
  frame.src = buildDemoUrl(id);
}

function setDemoMode(mode) {
  document.querySelectorAll('[data-demo-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.demoMode === mode);
  });
  postToDemo({ type: 'rsvp-set-mode', mode });
}

function setDemoWpm(wpm) {
  const out = $('demoWpmOut');
  const slider = $('demoWpm');
  if (slider) slider.value = wpm;
  if (out) out.textContent = String(wpm);
  if (slider) slider.setAttribute('aria-valuenow', String(wpm));
  postToDemo({ type: 'rsvp-set-wpm', wpm });
}

function buildPickerOptions(summaries) {
  const featured = summaries.filter((s) => s.featured);
  const rest = summaries.filter((s) => !s.featured).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return [...featured, ...rest].slice(0, 24);
}

function initReveal() {
  const nodes = document.querySelectorAll('.reveal');
  if (!nodes.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  nodes.forEach((el) => io.observe(el));
}

async function initLandingDemo() {
  const sel = $('demoSummarySelect');
  const wpmSlider = $('demoWpm');

  sel?.addEventListener('change', (e) => setDemoSummary(e.target.value));

  document.querySelectorAll('[data-demo-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setDemoMode(btn.dataset.demoMode));
  });

  wpmSlider?.addEventListener('input', (e) => setDemoWpm(+e.target.value));

  window.addEventListener('message', (event) => {
    if (event.origin !== iframeOrigin()) return;
    if (event.data?.type === 'rsvp-ready') {
      syncDemoToIframe();
    }
  });

  initReveal();

  try {
    const res = await fetch(`${API}/catalog`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Catalog unavailable');
    const data = await res.json();
    const pick = buildPickerOptions(data.summaries || []);
    if (!sel) return;
    sel.innerHTML = pick.map((s) =>
      `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`,
    ).join('');
    if (pick[0]) setDemoSummary(pick[0].id);
  } catch {
    if (sel) sel.innerHTML = '<option value="">Summaries unavailable</option>';
  }
}

initLandingDemo();