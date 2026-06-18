import { parseEpub, parseTxt } from './epub.js';
import {
  listBooks, getBook, saveBook, saveProgress, deleteBook,
  migrateFromLocalStorage, bookProgress, formatLastRead,
  findBookByHash, estimateTimeRemaining, exportLibrary, importLibrary, saveArticle,
  exportOpml, ensureChapterBoundaries,
} from './library.js';
import { loadWordlist, msPerWord as calcMsPerWord } from './timing.js';
import {
  initAuth, isAuthConfigured, isSignedIn, getSessionToken,
  mountSignIn, mountUserButton, onAuthChange, userLabel,
} from './auth.js';
import {
  fetchSummaryCatalog, fetchSummaryBook, summaryToBookRecord,
  saveSummaryProgress, summaryListMeta, summaryCategories, summaryCategoryName,
  groupSummariesByCategory, sortSummariesForDisplay,
  formatLastRead as formatSummaryLastRead,
} from './summaries.js';
import {
  buildAccountSnapshot, parseAccountSnapshot, mergeAccountSnapshot,
  validateSnapshotShape, getOrCreateDeviceId, SNAPSHOT_VERSION, absoluteWordIndex,
} from './sync-model.js';
import {
  buildReadingEvent, mergeEvents as mergeReadingEvents,
  groupEventsByLocalDay, aggregateStats, checkAchievements,
  summarizeCompletions,
} from './analytics.js';

const $ = (id) => document.getElementById(id);

const COMPLETIONS_KEY = 'rsvp-completions';
function recordChapterCompletion(chapterIndex, bookId, wpm, wordCount) {
  try {
    const raw = localStorage.getItem(COMPLETIONS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), ch: chapterIndex, b: bookId, wpm, words: wordCount });
    // Keep last 500 events
    while (arr.length > 500) arr.shift();
    localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

export function getCompletionStats() {
  try {
    const raw = localStorage.getItem('rsvp-completions');
    const arr = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const day = 86400000;
    const last7 = arr.filter((e) => e.t > now - 7 * day);
    const last30 = arr.filter((e) => e.t > now - 30 * day);
    const bookSet = new Set(arr.map((e) => e.b));
    const wpmAvg = arr.length ? Math.round(arr.reduce((s, e) => s + (e.wpm || 0), 0) / arr.length) : 0;
    return {
      totalChapters: arr.length,
      chapters7d: last7.length,
      chapters30d: last30.length,
      uniqueBooks: bookSet.size,
      avgWpm: wpmAvg,
    };
  } catch { return { totalChapters: 0, chapters7d: 0, chapters30d: 0, uniqueBooks: 0, avgWpm: 0 }; }
}

export function getWeeklyBreakdown() {
  try {
    const raw = localStorage.getItem('rsvp-completions');
    const arr = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - 7 * 86400000;
    const recent = arr.filter((e) => e.t > cutoff);
    const byBook = new Map();
    for (const e of recent) {
      const cur = byBook.get(e.b) || { chapters: 0, words: 0, minutes: 0 };
      cur.chapters += 1;
      cur.words += e.words || 0;
      cur.minutes += e.words && e.wpm ? (e.words / e.wpm) : 0;
      byBook.set(e.b, cur);
    }
    return Array.from(byBook.entries())
      .map(([bookId, agg]) => ({ bookId, ...agg, minutes: Math.round(agg.minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
  } catch { return []; }
}

const DESKTOP_FONT_BOOST = 0.5;
const ORP_ANCHOR_PERCENT = 0.35;
const PHANTOM_WORD_GAP_PX = 24; // rsvpnano kPhantomCurrentGapMedium

const LONG_PRESS_MS = 450;
const SWIPE_DOWN_THRESHOLD = 70;
const DOUBLE_TAP_MS = 320;
const SCRUB_RADIUS = 15;

const state = {
  words: [],
  index: 0,
  playing: false,
  playLocked: false,
  timer: null,
  wpm: 300,
  pauseMult: 2,
  fontSize: 3,
  lengthDelayEnabled: false,
  lengthDelayFactor: 0.1,
  frequencyDelayEnabled: false,
  frequencyDelayFactor: 0.3,
  pauseAtSentenceEnd: false,
  pendingStop: false,
  book: null,
  chapterIndex: 0,
  sentenceStarts: [0],
  paragraphStarts: [0],
  paragraphs: [],
  inReader: false,
  hintShown: false,
  libraryBooks: [],
  summaryCatalog: [],
  homeTab: 'summaries',
  searchQuery: '',
  summariesSearchQuery: '',
  summariesCategory: 'all',
  readingMode: 'rsvp',
  progressFooterMode: 0,
  scrubbing: false,
  scrubIndex: 0,
  wordlist: null,
  desktopModePref: 'auto',
};

let pressTimer = null;
let pressStart = null;
let longPressFired = false;
let lastTapTime = 0;
let wpmToastTimer = null;
let syncPushTimer = null;
let syncPromise = null;
let libraryDirty = false;
let authConfigured = false;

const SYNC_API = './sync';
const SYNC_SNAPSHOT_API = './sync/snapshot';
const DEVICE_ID_KEY = 'rsvp-device-id';
const READING_EVENTS_KEY = 'rsvp-reading-events';
const ACHIEVEMENTS_KEY = 'rsvp-achievements';
const MAX_LOCAL_EVENTS = 2000;

function getDeviceId() {
  try { return getOrCreateDeviceId(window.localStorage); }
  catch { return null; }
}

function loadLocalEvents() {
  try {
    const raw = localStorage.getItem(READING_EVENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveLocalEvents(events) {
  try {
    const trimmed = events.slice(-MAX_LOCAL_EVENTS);
    localStorage.setItem(READING_EVENTS_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

function loadAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveAchievements(list) {
  try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const etaDisplay = { chapterSec: null, bookSec: null, lastWpm: null };

const proseCache = {
  scroll: { start: -1, end: -1, lastIndex: -1 },
  paragraph: { start: -1, end: -1, lastIndex: -1 },
};

const PROSE_MODES = {
  scroll: {
    containerId: 'scrollView',
    wordClass: 'scroll-word',
    innerHtml: (body) => `<div class="scroll-content">${body}</div>`,
    queryCurrent: '.scroll-word.current',
  },
  paragraph: {
    containerId: 'paragraphView',
    wordClass: 'para-word',
    innerHtml: (body) => `<div class="paragraph-content">${body}</div>`,
    queryCurrent: '.para-word.current',
  },
};

function timingSettings() {
  return {
    pauseMult: state.pauseMult,
    lengthDelayEnabled: state.lengthDelayEnabled,
    lengthDelayFactor: state.lengthDelayFactor,
    frequencyDelayEnabled: state.frequencyDelayEnabled,
    frequencyDelayFactor: state.frequencyDelayFactor,
    wordlist: state.wordlist,
  };
}

function stableMsPerWord() {
  let mult = 1.12;
  mult += Math.max(0, state.pauseMult - 1) * 0.06;
  if (state.lengthDelayEnabled) mult += state.lengthDelayFactor * 1.5;
  if (state.frequencyDelayEnabled) mult += state.frequencyDelayFactor * 0.35;
  return (60000 / state.wpm) * mult;
}

function resetEtaDisplay() {
  etaDisplay.chapterSec = null;
  etaDisplay.bookSec = null;
  etaDisplay.lastWpm = null;
}

function resetProseCache(mode) {
  if (mode) {
    proseCache[mode] = { start: -1, end: -1, lastIndex: -1 };
  } else {
    proseCache.scroll = { start: -1, end: -1, lastIndex: -1 };
    proseCache.paragraph = { start: -1, end: -1, lastIndex: -1 };
  }
}

async function loadChapterBoundaries() {
  const ch = state.book?.chapters?.[state.chapterIndex];
  if (!ch) return;
  const { sentenceStarts, paragraphStarts, paragraphs, rebuilt } = ensureChapterBoundaries(
    ch,
    state.words.length || ch.wordCount,
  );
  state.sentenceStarts = sentenceStarts;
  state.paragraphStarts = paragraphStarts;
  state.paragraphs = paragraphs;
  resetProseCache();
  if (rebuilt) persistChapterBoundaries().catch(() => {});
}

function persistChapterBoundaries() {
  if (!state.book?.id || state.book.isSharedSummary) return Promise.resolve();
  const ch = state.book.chapters[state.chapterIndex];
  if (!ch) return Promise.resolve();
  return saveBook(state.book, {
    chapterIndex: state.chapterIndex,
    wordIndex: state.index,
    wpm: state.wpm,
  });
}

function setBodyMode() {
  document.body.classList.toggle('playing', state.playing);
  document.body.classList.toggle('paused', !state.playing);
  document.body.classList.toggle('play-locked', state.playLocked);
  document.body.classList.remove('mode-rsvp', 'mode-phantom', 'mode-scroll', 'mode-paragraph');
  document.body.classList.add(`mode-${state.readingMode}`);
}

function setReadingMode(mode) {
  state.readingMode = mode;
  localStorage.setItem('rsvp-reading-mode', mode);
  document.querySelectorAll('#modeSegment button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  setBodyMode();
  updateScrollLayout();
  hideScrub();
  resetProseCache();
  updateUI();
}

function setWpm(wpm) {
  const next = Math.max(100, Math.min(1000, Math.round(+wpm || 300)));
  state.wpm = next;
  if ($('wpm')) $('wpm').value = next;
  if ($('wpmOut')) $('wpmOut').textContent = next;
  localStorage.setItem('rsvp-wpm', next);
  updateProgressFooter();
  if (state.playing) {
    clearTimeout(state.timer);
    tick();
  }
}

async function showLibrary() {
  await requestStop();
  await persistProgress();
  state.inReader = false;
  state.playLocked = false;
  document.body.classList.remove('in-reader');
  $('reader').classList.add('hidden');
  $('library').classList.remove('hidden');
  closeSheet();
  unlockOrientation();
  updateScrollLayout();
  if (state.homeTab === 'summaries') {
    await renderSummariesGrid();
  } else {
    await renderLibraryGrid();
  }
}

function showReader() {
  state.inReader = true;
  document.body.classList.add('in-reader');
  $('library').classList.add('hidden');
  $('reader').classList.remove('hidden');
  setBodyMode();
  updateUI();
  updateScrollLayout();
  showTapHintOnce();
}

function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}

/**
 * Recompute the analytics dashboard from the local events store and write any
 * newly-unlocked achievements to localStorage. Lightweight enough to call on
 * every library render.
 */
function refreshAnalyticsView() {
  const panel = $('libStats');
  if (!panel) return;
  const events = loadLocalEvents();
  const stats = aggregateStats(events);
  const days = groupEventsByLocalDay(events);
  const dayList = Object.entries(days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7);
  panel.innerHTML = `
    <div class="lib-stats-grid">
      <div class="lib-stat"><div class="lib-stat-num">${stats.wordsToday.toLocaleString()}</div><div class="lib-stat-label">words today</div></div>
      <div class="lib-stat"><div class="lib-stat-num">${stats.words7d.toLocaleString()}</div><div class="lib-stat-label">7-day words</div></div>
      <div class="lib-stat"><div class="lib-stat-num">${stats.currentStreak}</div><div class="lib-stat-label">day streak</div></div>
      <div class="lib-stat"><div class="lib-stat-num">${stats.bestStreak}</div><div class="lib-stat-label">best streak</div></div>
    </div>
    ${renderSparkline(dayList)}
    <div class="lib-achievements" id="libAchievements">${renderAchievementsList()}</div>
  `;
  // Re-check achievement unlocks after a render
  const existing = loadAchievements();
  const books = state.libraryBooks || [];
  const summary = summarizeCompletions(books);
  const newList = checkAchievements(stats, days, {
    chapterCompletions: stats.totalEvents,
    booksFinished: summary.booksFinished,
    uniqueDevices7d: new Set(events.map((e) => e.deviceId).filter(Boolean)).size,
    longestSingleSessionMs: 0,
  }, existing);
  if (newList.length !== existing.length) saveAchievements(newList);
  const listEl = $('libAchievements');
  if (listEl) listEl.innerHTML = renderAchievementsList();
}

function renderSparkline(dayList) {
  if (!dayList.length) return '';
  const max = Math.max(1, ...dayList.map(([, d]) => d.words));
  const w = 280, h = 60, gap = 4;
  const barW = (w - gap * (dayList.length - 1)) / dayList.length;
  return `<svg class="lib-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Words per day, last 7 days">
    ${dayList.map(([, d], i) => {
      const bh = Math.round((d.words / max) * h);
      const x = i * (barW + gap);
      const y = h - bh;
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${bh}" rx="2" />`;
    }).join('')}
  </svg>`;
}

function renderAchievementsList() {
  const list = loadAchievements();
  if (!list.length) return '<div class="lib-achievements-empty">No achievements yet — read 1,000 words in a day to start.</div>';
  return `<ul class="lib-achievements-list">${list.map((a) => `
    <li class="lib-achievement">
      <span class="lib-achievement-title">${escapeHtml(a.title)}</span>
      <span class="lib-achievement-desc">${escapeHtml(a.description)}</span>
    </li>`).join('')}</ul>`;
}

function detectDesktopCapable() {
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const wide = window.matchMedia('(min-width: 768px)').matches;
  const veryWide = window.matchMedia('(min-width: 1024px)').matches;
  return (finePointer && wide) || veryWide;
}

function isDesktopMode() {
  if (state.desktopModePref === 'on') return true;
  if (state.desktopModePref === 'off') return false;
  return detectDesktopCapable();
}

function desktopModeLabel() {
  const detected = detectDesktopCapable();
  if (state.desktopModePref === 'auto') {
    return detected
      ? 'Auto · detected desktop (wide screen + mouse)'
      : 'Auto · detected mobile/tablet';
  }
  if (state.desktopModePref === 'on') return 'Forced on';
  return 'Forced off';
}

function updateDesktopMode() {
  const active = isDesktopMode();
  document.body.classList.toggle('desktop-mode', active);
  applyFontSize();
  updateDesktopModeUI();
  if (state.inReader && (state.readingMode === 'phantom' || state.readingMode === 'rsvp')) {
    layoutOrpReader();
  }
}

function updateDesktopModeUI() {
  const hint = $('desktopModeHint');
  if (!hint) return;
  hint.textContent = isDesktopMode()
    ? `${desktopModeLabel()} — centered column, brighter Phantom context, keyboard shortcuts`
    : `${desktopModeLabel()} — phone layout`;
  document.querySelectorAll('#desktopModeSegment button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.desktop === state.desktopModePref);
  });
}

function setDesktopModePref(pref) {
  if (!['auto', 'on', 'off'].includes(pref)) return;
  state.desktopModePref = pref;
  localStorage.setItem('rsvp-desktop-mode', pref);
  updateDesktopMode();
}

function phantomCharBudget() {
  if (!isDesktopMode()) return 14;
  const w = window.innerWidth;
  if (w >= 1200) return 22;
  if (w >= 768) return 18;
  return 14;
}

function desktopKeyboardEnabled() {
  return isDesktopMode() || window.matchMedia('(pointer: fine)').matches;
}

function updateScrollLayout() {
  const scrollRem = Math.max(1.05, state.fontSize * 0.44);
  document.documentElement.style.setProperty('--scroll-font-size', `${scrollRem}rem`);
}

function unlockOrientation() {
  screen.orientation?.unlock?.();
}

function showTapHintOnce() {
  if (state.hintShown || !state.words.length) return;
  state.hintShown = true;
  const hint = $('tapHint');
  hint.textContent = desktopKeyboardEnabled()
    ? 'Click to pause · Hold to open menu'
    : 'Tap to pause · Hold to open menu';
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 3500);
}

function openSheet() {
  requestStop();
  updateDesktopModeUI();
  if (state.book) {
    $('sheetTitle').textContent = state.book.title;
    const total = state.words.length;
    const pct = total ? Math.round((state.index / total) * 100) : 0;
    const modeLabel = { rsvp: 'RSVP', phantom: 'Phantom', scroll: 'Scroll', paragraph: 'Paragraph' }[state.readingMode];
    $('sheetMeta').textContent = `${modeLabel} · ${state.index} / ${total} words · ${pct}% · ${state.wpm} WPM`;
  }
  $('sheetOverlay').classList.add('open');
}

function closeSheet() {
  $('sheetOverlay').classList.remove('open');
}

function tokenize(text) {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function isWordCharacter(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

function orpOrdinalForLength(length) {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

function orpIndex(word) {
  const letterIndexes = [];
  for (let i = 0; i < word.length; i++) {
    if (isWordCharacter(word[i])) letterIndexes.push(i);
  }
  if (!letterIndexes.length) return 0;
  const target = Math.min(orpOrdinalForLength(letterIndexes.length), letterIndexes.length - 1);
  return letterIndexes[target];
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function orpWordHtml(raw) {
  const idx = orpIndex(raw);
  return [...raw].map((ch, i) => {
    const e = escapeHtml(ch);
    return i === idx ? `<span class="word-orp">${e}</span>` : e;
  }).join('');
}

function measureOrpLayout(wordEl, track) {
  // Match rsvpnano rsvpStartX: anchorX - focusCenterX with layout at x=0.
  wordEl.style.left = '0';
  wordEl.style.transform = 'translateY(-50%)';

  const trackRect = track.getBoundingClientRect();
  const wordRect = wordEl.getBoundingClientRect();
  const minX = wordRect.left - trackRect.left;
  const maxX = wordRect.right - trackRect.left;

  const orp = wordEl.querySelector('.word-orp');
  let focusCenterX = minX + (maxX - minX) / 2;
  if (orp) {
    const orpRect = orp.getBoundingClientRect();
    focusCenterX = orpRect.left + orpRect.width / 2 - trackRect.left;
  }

  return { minX, maxX, focusCenterX, trackWidth: track.clientWidth };
}

function layoutOrpReader() {
  const track = $('orpTrack');
  const wordEl = $('orpWord');
  const beforeEl = $('phantomBefore');
  const afterEl = $('phantomAfter');

  if (!track || !wordEl || !wordEl.textContent) {
    if (wordEl) {
      wordEl.style.left = '0';
      wordEl.style.transform = 'translateY(-50%)';
    }
    return;
  }

  const { minX, maxX, focusCenterX, trackWidth } = measureOrpLayout(wordEl, track);
  const anchorX = trackWidth * ORP_ANCHOR_PERCENT;
  const shiftX = anchorX - focusCenterX;

  wordEl.style.left = '0';
  wordEl.style.transform = `translate(${shiftX}px, -50%)`;

  const gap = PHANTOM_WORD_GAP_PX;
  const wordLeft = minX + shiftX;
  const wordRight = maxX + shiftX;

  if (beforeEl?.textContent) {
    const width = Math.max(0, wordLeft - gap);
    beforeEl.style.left = '0';
    beforeEl.style.right = 'auto';
    beforeEl.style.width = `${width}px`;
  } else if (beforeEl) {
    beforeEl.style.width = '';
  }

  if (afterEl?.textContent) {
    const left = wordRight + gap;
    afterEl.style.left = `${left}px`;
    afterEl.style.right = 'auto';
    afterEl.style.width = 'auto';
    afterEl.style.maxWidth = `${Math.max(0, trackWidth - left)}px`;
  } else if (afterEl) {
    afterEl.style.left = '';
    afterEl.style.maxWidth = '';
  }
}

function paintOrpWord(raw, phantomBefore = '', phantomAfter = '') {
  const container = $('wordContainer');
  const wordEl = $('orpWord');
  const beforeEl = $('phantomBefore');
  const afterEl = $('phantomAfter');
  const placeholder = $('wordPlaceholder');
  if (!container || !wordEl) return;

  container.classList.remove('is-empty');

  if (!raw) {
    wordEl.innerHTML = '';
    if (beforeEl) beforeEl.textContent = '';
    if (afterEl) afterEl.textContent = '';
    layoutOrpReader();
    return;
  }

  wordEl.innerHTML = orpWordHtml(raw);
  if (beforeEl) beforeEl.textContent = phantomBefore;
  if (afterEl) afterEl.textContent = phantomAfter;
  layoutOrpReader();
}

function showWordPlaceholder(msg) {
  const container = $('wordContainer');
  const placeholder = $('wordPlaceholder');
  const wordEl = $('orpWord');
  const beforeEl = $('phantomBefore');
  const afterEl = $('phantomAfter');
  if (!container) return;
  container.classList.add('is-empty');
  if (placeholder) placeholder.textContent = msg;
  if (wordEl) wordEl.innerHTML = '';
  if (beforeEl) beforeEl.textContent = '';
  if (afterEl) afterEl.textContent = '';
}

function isAtChapterEnd() {
  return state.words.length > 0 && state.index >= state.words.length;
}

function hasNextChapter() {
  return !!state.book && state.chapterIndex < state.book.chapters.length - 1;
}

function isBookComplete() {
  return !!state.book && !hasNextChapter() && isAtChapterEnd();
}

function endPlaceholder() {
  if (isBookComplete()) return 'End of book';
  return 'End of chapter';
}

function phantomSideText(start, step) {
  const parts = [];
  let chars = 0;
  const budget = phantomCharBudget();
  for (let i = start; i >= 0 && i < state.words.length && chars < budget; i += step) {
    const w = state.words[i];
    if (!w) break;
    if (step < 0) parts.unshift(w);
    else parts.push(w);
    chars += w.length + 1;
  }
  return parts.join(' ');
}

function sentenceRangeFor(wordIdx) {
  const starts = state.sentenceStarts?.length ? state.sentenceStarts : [0];
  let si = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= wordIdx) si = i;
    else break;
  }
  const start = starts[si];
  const end = si + 1 < starts.length ? starts[si + 1] - 1 : state.words.length - 1;
  return { si, start, end };
}

function paraSentencePhase(wordIdx) {
  const cur = sentenceRangeFor(state.index);
  const word = sentenceRangeFor(wordIdx);
  if (word.si < cur.si) return 'read';
  if (word.si === cur.si) return 'current';
  return 'ahead';
}

function proseWordHtml(i, wordClass) {
  const w = escapeHtml(state.words[i]);
  const sentClass = wordClass === 'para-word' ? ` para-sent-${paraSentencePhase(i)}` : '';
  let cls = wordClass;
  if (i === state.index) cls += ' current';
  else if (i < state.index) cls += ' read';
  cls += sentClass;
  const useMark = wordClass === 'para-word' && i === state.index;
  const tag = useMark ? 'mark' : 'span';
  return `<${tag} class="${cls.trim()}" data-i="${i}">${w}</${tag}>`;
}

function scrollProseHtml() {
  const starts = state.paragraphStarts?.length ? state.paragraphStarts : [0];
  const paraCount = Math.max(starts.length, state.paragraphs.length || 1);

  return Array.from({ length: paraCount }, (_, pi) => {
    const pStart = starts[pi] ?? 0;
    const pEnd = pi + 1 < starts.length ? starts[pi + 1] : state.words.length;
    const spans = [];
    for (let gi = pStart; gi < pEnd && gi < state.words.length; gi++) {
      spans.push(proseWordHtml(gi, 'scroll-word'));
    }
    if (!spans.length) return '';
    return `<p class="scroll-para">${spans.join(' ')}</p>`;
  }).filter(Boolean).join('');
}

function paragraphBlocksHtml() {
  const starts = state.paragraphStarts?.length ? state.paragraphStarts : [0];
  const paraCount = Math.max(starts.length, state.paragraphs.length || 1);

  return Array.from({ length: paraCount }, (_, pi) => {
    const pStart = starts[pi] ?? 0;
    const pEnd = pi + 1 < starts.length ? starts[pi + 1] : state.words.length;
    const spans = [];
    for (let gi = pStart; gi < pEnd && gi < state.words.length; gi++) {
      spans.push(proseWordHtml(gi, 'para-word'));
    }
    if (!spans.length) return '';
    const isCurrent = state.index >= pStart && state.index < pEnd;
    return `<p class="para-block${isCurrent ? ' current' : ''}">${spans.join(' ')}</p>`;
  }).filter(Boolean).join('');
}

function proseFullRender(mode) {
  const cfg = PROSE_MODES[mode];
  const container = $(cfg.containerId);
  let body;

  if (mode === 'paragraph') {
    body = paragraphBlocksHtml() || `<p class="para-block current">${proseWordHtml(state.index, 'para-word')}</p>`;
    proseCache.paragraph.start = 0;
    proseCache.paragraph.end = state.words.length;
  } else {
    body = scrollProseHtml()
      || `<p class="scroll-para">${proseWordHtml(state.index, cfg.wordClass)}</p>`;
    proseCache.scroll.start = 0;
    proseCache.scroll.end = state.words.length;
  }

  container.innerHTML = cfg.innerHtml(body);
  proseCache[mode].lastIndex = state.index;
  proseScrollIfNeeded(cfg.containerId, cfg.queryCurrent);
}

function proseSetParaSentencePhase(container, from, to, phase) {
  for (let i = from; i <= to; i++) {
    const el = container.querySelector(`[data-i="${i}"]`);
    if (!el) continue;
    el.classList.remove('para-sent-read', 'para-sent-current', 'para-sent-ahead');
    el.classList.add(`para-sent-${phase}`);
  }
}

function proseUpdateParaSentence(prevIndex, newIndex) {
  const prevSent = sentenceRangeFor(prevIndex);
  const newSent = sentenceRangeFor(newIndex);
  if (prevSent.si === newSent.si) return;

  const container = $('paragraphView');
  proseSetParaSentencePhase(container, prevSent.start, prevSent.end, 'read');
  proseSetParaSentencePhase(container, newSent.start, newSent.end, 'current');
}

function proseUpdateClasses(containerId, wordClass, prevIndex, newIndex) {
  const container = $(containerId);
  const prevEl = container.querySelector(`[data-i="${prevIndex}"]`);
  const newEl = container.querySelector(`[data-i="${newIndex}"]`);

  if (prevEl) {
    prevEl.classList.remove('current');
    prevEl.classList.add('read');
    if (wordClass === 'para-word' && prevEl.tagName === 'MARK') {
      const span = document.createElement('span');
      span.className = prevEl.className;
      span.dataset.i = prevEl.dataset.i;
      span.textContent = prevEl.textContent;
      prevEl.replaceWith(span);
    }
  }

  if (newEl) {
    newEl.classList.remove('read');
    newEl.classList.add('current');
    if (wordClass === 'para-word' && newEl.tagName === 'SPAN') {
      const mark = document.createElement('mark');
      mark.className = newEl.className;
      mark.dataset.i = newEl.dataset.i;
      mark.textContent = newEl.textContent;
      newEl.replaceWith(mark);
    }
  }

  if (wordClass === 'para-word') proseUpdateParaSentence(prevIndex, newIndex);
}

function proseScrollIfNeeded(containerId, currentSelector) {
  const container = $(containerId);
  const el = container.querySelector(currentSelector);
  if (!el) return;

  const cRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const readLine = cRect.top + cRect.height * 0.38;
  const wordMid = rect.top + rect.height * 0.5;
  const drift = wordMid - readLine;

  if (Math.abs(drift) > 10) {
    container.scrollTop += drift;
  }
}

function updateProseView(mode) {
  const cfg = PROSE_MODES[mode];
  const cache = proseCache[mode];
  const prevIndex = cache.lastIndex;

  if (cache.start < 0) {
    proseFullRender(mode);
    return;
  }

  if (prevIndex !== state.index && prevIndex >= 0) {
    proseUpdateClasses(cfg.containerId, cfg.wordClass, prevIndex, state.index);
    cache.lastIndex = state.index;
    proseScrollIfNeeded(cfg.containerId, cfg.queryCurrent);
  } else if (prevIndex < 0) {
    proseFullRender(mode);
  }
}

function renderScrollView() {
  updateProseView('scroll');
}

function renderParagraphView() {
  updateProseView('paragraph');
}

function sentenceContext() {
  if (!state.words.length || state.playing || state.readingMode === 'scroll' || state.readingMode === 'paragraph') return '';
  const ctx = 5;
  const start = Math.max(0, state.index - ctx);
  const end = Math.min(state.words.length - 1, state.index + ctx);
  const parts = [];
  for (let i = start; i <= end; i++) {
    const w = escapeHtml(state.words[i]);
    parts.push(i === state.index ? `<span class="ctx-current">${w}</span>` : w);
  }
  const pre = start > 0 ? '… ' : '';
  const post = end < state.words.length - 1 ? ' …' : '';
  return pre + parts.join(' ') + post;
}

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function updateProgressFooter() {
  const el = $('progressFooter');
  if (!state.inReader || !state.book) {
    el.textContent = '';
    return;
  }

  const raw = estimateTimeRemaining(
    state.book,
    state.chapterIndex,
    state.index,
    stableMsPerWord(),
  );

  const mode = state.progressFooterMode % 3;
  if (mode === 0) {
    el.textContent = `${raw.percent}%`;
    return;
  }

  if (etaDisplay.lastWpm !== state.wpm) {
    resetEtaDisplay();
    etaDisplay.lastWpm = state.wpm;
  }

  const key = mode === 1 ? 'chapterSec' : 'bookSec';
  const label = mode === 1 ? 'left in chapter' : 'left in book';

  if (etaDisplay[key] == null) {
    etaDisplay[key] = raw[key];
  } else if (state.playing) {
    const smoothed = Math.round(etaDisplay[key] * 0.88 + raw[key] * 0.12);
    etaDisplay[key] = Math.min(etaDisplay[key], smoothed, raw[key]);
  } else {
    etaDisplay[key] = raw[key];
  }

  el.textContent = `${formatDuration(etaDisplay[key])} ${label}`;
}

function showWpmToast() {
  const el = $('wpmToast');
  el.textContent = `${state.wpm} WPM`;
  el.classList.add('show');
  clearTimeout(wpmToastTimer);
  wpmToastTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

function adjustWpm(delta) {
  state.wpm = Math.max(100, Math.min(1000, state.wpm + delta));
  $('wpm').value = state.wpm;
  $('wpmOut').textContent = state.wpm;
  localStorage.setItem('rsvp-wpm', state.wpm);
  showWpmToast();
  resetEtaDisplay();
  etaDisplay.lastWpm = state.wpm;
  updateProgressFooter();
}

function applyFontSize() {
  const boost = isDesktopMode() ? DESKTOP_FONT_BOOST : 0;
  document.documentElement.style.setProperty('--font-size-word', `${state.fontSize + boost}rem`);
}

function updateUI() {
  const total = state.words.length;
  const word = state.words[state.index] || '';

  if (!total) {
    showWordPlaceholder('Upload a book to start');
    $('scrollView').innerHTML = '';
    $('paragraphView').innerHTML = '';
    resetProseCache();
  } else if (state.scrubbing) {
    renderScrubView();
  } else if (state.readingMode === 'scroll') {
    renderScrollView();
  } else if (state.readingMode === 'paragraph') {
    renderParagraphView();
  } else if (state.readingMode === 'phantom') {
    if (!word) showWordPlaceholder(endPlaceholder());
    else {
      paintOrpWord(
        word,
        phantomSideText(state.index - 1, -1),
        phantomSideText(state.index + 1, 1),
      );
    }
  } else {
    if (!word) showWordPlaceholder(endPlaceholder());
    else paintOrpWord(word);
  }

  $('sentenceCtx').innerHTML = sentenceContext();
  updateProgressFooter();
  setBodyMode();
}

function haptic() {
  navigator.vibrate?.(12);
}

function doStop() {
  state.playing = false;
  state.pendingStop = false;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  saveProgressNow();
  flushReadingEvent();
  updateUI();
}

function requestStop() {
  if (!state.playing) return Promise.resolve();
  if (state.pauseAtSentenceEnd && !state.pendingStop) {
    state.pendingStop = true;
    return Promise.resolve();
  }
  state.playLocked = false;
  doStop();
  return Promise.resolve();
}

function sentenceEndAfter(idx) {
  for (const s of state.sentenceStarts) {
    if (s > idx) {
      const end = s - 1;
      return end >= idx ? end : idx;
    }
  }
  return state.words.length - 1;
}

function rewindSentence() {
  let target = 0;
  for (let i = state.sentenceStarts.length - 1; i >= 0; i--) {
    const s = state.sentenceStarts[i];
    if (s < state.index) { target = s; break; }
    if (s === state.index && i > 0) { target = state.sentenceStarts[i - 1]; break; }
  }
  state.index = target;
  updateUI();
  saveProgressNow();
  haptic();
}

function restartParagraph() {
  let target = 0;
  for (let i = state.paragraphStarts.length - 1; i >= 0; i--) {
    if (state.paragraphStarts[i] <= state.index) {
      target = state.paragraphStarts[i];
      break;
    }
  }
  state.index = target;
  updateUI();
  saveProgressNow();
  haptic();
}

async function applyChapter(idx, wordIdx = 0) {
  state.chapterIndex = idx;
  state.index = wordIdx;
  state.book.chapterIndex = idx;
  state.book.wordIndex = wordIdx;
  $('inputText').value = state.book.chapters[idx].text;
  state.words = tokenize($('inputText').value);
  resetProseCache();
  resetEtaDisplay();
  await loadChapterBoundaries();
  renderChapterSelects();
}

async function loopLandingDemo(continuePlaying = false) {
  if (!isLandingEmbed() || !state.book || !continuePlaying) return false;
  await applyChapter(0, 0);
  if (!state.words.length) return false;
  saveProgressNow();
  state.playing = true;
  updateUI();
  tick();
  window.parent?.postMessage({ type: 'rsvp-looped' }, '*');
  return true;
}

async function advanceToNextChapter(continuePlaying = false) {
  if (!hasNextChapter()) {
    if (await loopLandingDemo(continuePlaying)) return true;
    doStop();
    return false;
  }
  await applyChapter(state.chapterIndex + 1, 0);
  if (!state.words.length) return await advanceToNextChapter(continuePlaying);
  saveProgressNow();
  if (continuePlaying) {
    state.playing = true;
    updateUI();
    tick();
  } else {
    doStop();
    updateUI();
  }
  haptic();
  return true;
}

async function tick() {
  if (!state.playing) { doStop(); return; }
  if (state.pendingStop) {
    const end = sentenceEndAfter(state.index);
    if (state.index >= end) {
      doStop();
      return;
    }
  }
  if (state.index >= state.words.length) {
    recordChapterCompletion(state.chapterIndex, state.book?.id, state.wpm, state.book?.chapters?.[state.chapterIndex]?.wordCount || 0);
    await advanceToNextChapter(true);
    return;
  }
  noteReadStartIfNeeded();
  const word = state.words[state.index] || '';
  const delay = calcMsPerWord(word, state.wpm, timingSettings());
  state.index++;
  updateUI();
  saveProgressNow();
  if (state.index >= state.words.length) {
    recordChapterCompletion(state.chapterIndex, state.book?.id, state.wpm, state.book?.chapters?.[state.chapterIndex]?.wordCount || 0);
    await advanceToNextChapter(true);
    return;
  }
  state.timer = setTimeout(tick, delay);
}

async function play() {
  if (!state.words.length && !hasNextChapter()) {
    if (isLandingEmbed() && state.book) await applyChapter(0, 0);
    else return;
  }
  if (isAtChapterEnd()) {
    if (hasNextChapter()) await advanceToNextChapter(false);
    else if (isLandingEmbed() && state.book) await applyChapter(0, 0);
    else return;
  }
  closeSheet();
  hideScrub();
  $('tapHint').classList.remove('show');
  state.playing = true;
  state.pendingStop = false;
  haptic();
  updateUI();
  tick();
}

function togglePlay() {
  if (state.playing) requestStop();
  else play();
  if (!state.playing) haptic();
}

function seek(delta) {
  state.index = Math.max(0, Math.min(state.words.length - 1, state.index + delta));
  resetEtaDisplay();
  updateUI();
  saveProgressNow();
  if (state.playing) { clearTimeout(state.timer); tick(); }
}

function renderScrubView() {
  const center = state.scrubIndex;
  const start = Math.max(0, center - SCRUB_RADIUS);
  const end = Math.min(state.words.length, center + SCRUB_RADIUS + 1);
  const parts = [];
  for (let i = start; i < end; i++) {
    const w = escapeHtml(state.words[i]);
    parts.push(i === center
      ? `<mark class="scrub-word current">${w}</mark>`
      : `<span class="scrub-word">${w}</span>`);
  }
  $('scrubOverlay').innerHTML = `<div class="scrub-content">${parts.join(' ')}</div>`;
  $('scrubOverlay').classList.remove('hidden');
}

function hideScrub() {
  state.scrubbing = false;
  $('scrubOverlay').classList.add('hidden');
}

function handleReaderTap(clientX, width, target) {
  if (!state.inReader || $('sheetOverlay').classList.contains('open')) return;

  if (state.scrubbing) {
    hideScrub();
    state.index = state.scrubIndex;
    updateUI();
    saveProgressNow();
    return;
  }

  const now = Date.now();
  const isDoubleTap = now - lastTapTime < DOUBLE_TAP_MS;
  lastTapTime = now;

  if (!state.playing && isDoubleTap) {
    state.playLocked = true;
    play();
    return;
  }

  if (state.playLocked && state.playing) {
    state.playLocked = false;
    requestStop();
    return;
  }

  if (!state.playing && (state.readingMode === 'scroll' || state.readingMode === 'paragraph')) {
    const wordEl = target?.closest?.('.scroll-word, .para-word');
    if (wordEl?.dataset.i != null) {
      state.index = +wordEl.dataset.i;
      updateUI();
      saveProgressNow();
      return;
    }
  }

  const ratio = clientX / width;

  if (!state.playing && state.readingMode !== 'scroll' && state.readingMode !== 'paragraph') {
    if (ratio < 0.12) { rewindSentence(); return; }
    if (ratio < 0.25) { seek(-1); haptic(); return; }
    if (ratio > 0.75) { seek(1); haptic(); return; }
  }

  if (!state.playLocked) togglePlay();
}

function bindReaderGestures() {
  const el = $('wordDisplay');

  const clearPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
    longPressFired = false;
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    longPressFired = false;
    pressTimer = setTimeout(() => {
      longPressFired = true;
      haptic();
      openSheet();
    }, LONG_PRESS_MS);
  });

  el.addEventListener('pointermove', (e) => {
    if (!pressStart || longPressFired || state.playing) return;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;
    if (Math.abs(dx) > 18 || Math.abs(dy) > 18) {
      clearTimeout(pressTimer);
      pressTimer = null;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 24) {
        state.scrubbing = true;
        state.scrubIndex = Math.max(0, Math.min(state.words.length - 1, state.index + Math.round(dx / 12)));
        updateUI();
      }
    }
  });

  el.addEventListener('pointerup', (e) => {
    if (!pressStart) return;
    const dt = Date.now() - pressStart.time;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;

    if (!longPressFired && dt < LONG_PRESS_MS) {
      if (dy > SWIPE_DOWN_THRESHOLD && pressStart.y < 80 && Math.abs(dx) < 30) {
        showLibrary();
      } else if (!state.playing && Math.abs(dx) < 12 && Math.abs(dy) > 40) {
        adjustWpm(dy < 0 ? 25 : -25);
      } else if (Math.abs(dy) < 20 && Math.abs(dx) < 12) {
        handleReaderTap(e.clientX, el.offsetWidth, e.target);
      } else if (state.scrubbing) {
        state.index = state.scrubIndex;
        hideScrub();
        updateUI();
        saveProgressNow();
      }
    }

    clearPress();
  });

  el.addEventListener('pointercancel', clearPress);

  window.addEventListener('pagehide', () => {
    // Best-effort flush — sendBeacon is unavailable here so fire-and-forget the IDB write.
    try { persistProgress(); } catch { /* ignore */ }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { persistProgress(); } catch { /* ignore */ }
    }
  });

  $('progressFooter')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.progressFooterMode = (state.progressFooterMode + 1) % 3;
    updateProgressFooter();
    haptic();
  });
}

async function loadText(resetIndex = true) {
  state.words = tokenize($('inputText').value);
  await loadChapterBoundaries();
  if (resetIndex && state.book) {
    state.index = state.book.wordIndex ?? 0;
  }
  resetProseCache();
  resetEtaDisplay();
  doStop();
  updateUI();
}

/**
 * Track reading progress as an event for analytics. The event is created
 * lazily — we only need a tiny shim of "where I was N words ago vs. now" —
 * and rolled into the local events store, which the next sync push carries
 * to the server.
 *
 * We avoid emitting an event if the interval has zero forward progress, and
 * we collapse quick re-renders into a single event per pause.
 */
let pendingReadSession = null; // { startAbs, startAt, wpm, contentHash, bookId }
function noteReadStartIfNeeded() {
  if (!state.book?.id) return;
  if (state.book.isSharedSummary) return;
  if (pendingReadSession) return;
  const abs = absoluteWordIndex(state.book, state.chapterIndex, state.index);
  pendingReadSession = {
    startAbs: abs,
    startAt: Date.now(),
    wpm: state.wpm,
    contentHash: state.book.contentHash || state.book.id || '',
    bookId: state.book.id,
  };
}

function flushReadingEvent() {
  if (!pendingReadSession || !state.book?.id) return;
  const endAbs = absoluteWordIndex(state.book, state.chapterIndex, state.index);
  const ev = buildReadingEvent({
    deviceId: getDeviceId(),
    contentHash: pendingReadSession.contentHash,
    bookId: pendingReadSession.bookId,
    startAbs: pendingReadSession.startAbs,
    endAbs,
    wpm: state.wpm,
    startedAt: pendingReadSession.startAt,
    endedAt: Date.now(),
  });
  pendingReadSession = null;
  if (!ev) return;
  const events = loadLocalEvents();
  const merged = mergeReadingEvents([], [ev, ...events]);
  saveLocalEvents(merged);
  refreshAnalyticsView();
}

async function persistProgress() {
  if (!state.book?.id) return;
  state.book.chapterIndex = state.chapterIndex;
  state.book.wordIndex = state.index;
  state.book.wpm = state.wpm;
  state.book.progressUpdatedAt = Date.now();
  if (state.book.isSharedSummary && state.book.summaryId) {
    saveSummaryProgress(state.book.summaryId, {
      chapterIndex: state.chapterIndex,
      wordIndex: state.index,
      wpm: state.wpm,
    });
    state.book.lastReadAt = Date.now();
    return;
  }
  await saveProgress(state.book.id, {
    chapterIndex: state.chapterIndex,
    wordIndex: state.index,
    wpm: state.wpm,
    progressUpdatedAt: state.book.progressUpdatedAt,
  });
}

function saveProgressNow() {
  persistProgress().catch(() => {});
  if (!state.book?.isSharedSummary) markLibraryDirty();
}

function markLibraryDirty() {
  libraryDirty = true;
  scheduleSyncPush();
}

function scheduleSyncPush() {
  if (!authConfigured || !isSignedIn()) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => {
    pushLibraryToAccount().catch(() => {});
  }, 2500);
}

async function authHeaders() {
  const token = await getSessionToken();
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function parseLibraryPayload(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (payload?.library) {
    return typeof payload.library === 'string' ? JSON.parse(payload.library) : payload.library;
  }
  return payload;
}

function setSyncBanner(message, tone = 'info') {
  const banner = $('libSyncBanner');
  if (!banner || !message) {
    banner?.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden', 'error', 'info', 'success');
  banner.classList.add(tone);
  banner.textContent = message;
}

async function pushLibraryToAccount() {
  const headers = await authHeaders();
  if (!headers) {
    setSyncBanner('Could not sync — sign in again to restore your library.', 'error');
    return false;
  }

  const libJson = await exportLibrary();
  const local = parseLibraryPayload(libJson);
  const localBooks = Array.isArray(local?.books) ? local.books : [];
  const deviceId = getDeviceId();
  const snap = buildAccountSnapshot(localBooks, { deviceId, exportedAt: Date.now() });
  // Validate the payload before shipping — we own this code path, but a
  // bad book record should not propagate to the server.
  const shapeErr = validateSnapshotShape(snap);
  if (shapeErr) throw new Error(`Refusing to push invalid snapshot: ${shapeErr}`);

  const t0 = performance.now();
  const res = await fetch(SYNC_SNAPSHOT_API, { method: 'POST', headers, body: JSON.stringify(snap) });
  const dt = Math.round(performance.now() - t0);
  if (typeof console !== 'undefined') console.info(`[rsvp-sync] push ${res.status} ${dt}ms`);
  if (!res.ok) throw new Error('Could not save library to your account');
  libraryDirty = false;
  return true;
}

async function pullLibraryFromAccount() {
  const headers = await authHeaders();
  if (!headers) {
    throw new Error('Sign in required to load your library');
  }
  const res = await fetch(SYNC_SNAPSHOT_API, { headers });
  if (res.status === 404) {
    // Server is the older /sync-only build; gracefully fall back so the
    // client still works during the deploy window.
    return { books: await listBooks(), tombstones: [], attached: 0, placeholders: 0, deleted: 0, changed: false, bookCount: 0 };
  }
  if (!res.ok) throw new Error('Could not load library from your account');
  const raw = await res.text();
  const parsed = parseAccountSnapshot(raw);
  const localBooks = await listBooks();
  const deviceId = getDeviceId();
  const merged = mergeAccountSnapshot(localBooks, parsed, { deviceId });
  await replaceAllBooks(merged.books);
  await renderLibraryGrid();
  return {
    ...merged,
    changed: (merged.attached + merged.placeholders + merged.deleted) > 0,
    bookCount: merged.books.length,
  };
}

/**
 * Replace the local library wholesale after a sync merge. Each book is saved
 * (idempotent) and any books that no longer exist locally are deleted. We
 * never delete books that the server did not return + did not tombstone.
 */
async function replaceAllBooks(books) {
  const keep = new Set();
  for (const b of (Array.isArray(books) ? books : [])) {
    if (!b?.id && !b?.contentHash) continue;
    const id = b.id || b.contentHash;
    keep.add(id);
    await saveBook(b);
  }
  const existing = await listBooks();
  for (const e of existing) {
    const id = e.id || e.contentHash;
    if (!keep.has(id)) await deleteBook(e.id);
  }
}

async function syncAccountLibrary({ forcePush = false } = {}) {
  if (!authConfigured || !isSignedIn()) return;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    setSyncBanner('Syncing your library…', 'info');
    try {
      const pullResult = await pullLibraryFromAccount();
      const localBooks = await listBooks();
      const shouldPush = libraryDirty || (forcePush && localBooks.length > 0);
      if (shouldPush) await pushLibraryToAccount();
      if (localBooks.length > 0 || pullResult?.bookCount > 0) {
        setSyncBanner(`Synced ${Math.max(localBooks.length, pullResult?.bookCount || 0)} book(s) to your account.`, 'success');
      } else {
        setSyncBanner('');
      }
    } catch (err) {
      setSyncBanner(err?.message || 'Sync failed. Tap Sign in to try again.', 'error');
      throw err;
    }
  })()
    .catch(() => {})
    .finally(() => { syncPromise = null; });

  return syncPromise;
}

function mountHeaderSignIn(target) {
  if (!target) return;
  target.innerHTML = '';
  const link = document.createElement('a');
  link.href = '/auth/signin?callbackUrl=' + encodeURIComponent(location.pathname + location.search + location.hash || '/rsvp/app/');
  link.className = 'auth-header-signin';
  link.textContent = 'Sign in';
  target.appendChild(link);
}

function updateAuthUI() {
  const gate = $('authGate');
  const libraryPanel = $('libraryPanel');
  const signedIn = authConfigured && isSignedIn();

  if (!authConfigured) {
    gate?.classList.add('hidden');
    libraryPanel?.classList.remove('auth-locked');
    $('authUserSlot')?.replaceChildren();
    if ($('authGateMsg')) {
      $('authGateMsg').textContent = 'Local mode — your library stays on this device. Sign in to sync across devices.';
    }
    if ($('authSignIn')) mountSignIn($('authSignIn'));
    return;
  }

  if (signedIn) {
    gate?.classList.add('hidden');
    libraryPanel?.classList.remove('auth-locked');
    mountUserButton($('authUserButton'));
    const label = $('authStatusLabel');
    if (label) label.textContent = userLabel();
  } else {
    libraryPanel?.classList.add('auth-locked');
    const label = $('authStatusLabel');
    if (label) label.textContent = '';
    mountHeaderSignIn($('authUserButton'));
    if ($('authGateMsg')) {
      $('authGateMsg').textContent = 'Sign in with Google to sync your EPUB library across devices. Book Summaries are available without signing in.';
    }
    mountSignIn($('authSignIn'));
    if (state.homeTab === 'library') {
      gate?.classList.remove('hidden');
      setSyncBanner('Sign in to load your EPUB library and sync across devices.', 'info');
    } else {
      gate?.classList.add('hidden');
      $('libSyncBanner')?.classList.add('hidden');
    }
  }
}

function setHomeTab(tab) {
  state.homeTab = tab === 'library' ? 'library' : 'summaries';
  $('tabSummaries')?.classList.toggle('active', state.homeTab === 'summaries');
  $('tabLibrary')?.classList.toggle('active', state.homeTab === 'library');
  $('summariesPanel')?.classList.toggle('hidden', state.homeTab !== 'summaries');
  $('libraryPanel')?.classList.toggle('hidden', state.homeTab !== 'library');
  $('uploadBtn')?.classList.toggle('hidden', state.homeTab !== 'library');
  updateAuthUI();
  if (state.homeTab === 'summaries') {
    renderSummariesGrid().catch(() => {});
  } else {
    renderLibraryGrid().catch(() => {});
  }
}

async function setupAuth() {
  authConfigured = isAuthConfigured();
  updateAuthUI();
  if (!authConfigured) return;

  await initAuth();
  updateAuthUI();

  onAuthChange(async () => {
    updateAuthUI();
    if (isSignedIn()) await syncAccountLibrary({ forcePush: true });
  });

  if (isSignedIn()) await syncAccountLibrary({ forcePush: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isSignedIn()) {
      syncAccountLibrary();
    }
  });
}

function setOverlay(show, msg = 'Loading…') {
  $('overlay').classList.toggle('hidden', !show);
  $('overlayMsg').textContent = msg;
}

function firstReadableChapter(book) {
  const idx = book.chapters.findIndex((c) => c.wordCount >= 50);
  return idx === -1 ? 0 : idx;
}

function renderChapterSelects() {
  const book = state.book;
  if (!book) return;
  const sheetSel = $('chapterSelect');
  if (book.chapters.length > 1) {
    $('sheetChapterRow').classList.remove('hidden');
    sheetSel.innerHTML = book.chapters.map((c, i) =>
      `<option value="${i}"${i === state.chapterIndex ? ' selected' : ''}>${escapeHtml(c.title)}</option>`
    ).join('');
  } else {
    $('sheetChapterRow').classList.add('hidden');
  }
}

function renderSummaryCard(s) {
  const prog = summaryListMeta(s);
  const catLabel = s.category ? `<span class="book-card-cat">${escapeHtml(s.category)}</span>` : '';
  const topBadge = s.featured ? '<span class="book-card-top">Top pick</span>' : '';
  const badges = [topBadge, catLabel].filter(Boolean).join('') || '<span class="book-card-type">Summary</span>';
  return `
    <div class="book-card summary-card" data-summary-id="${escapeHtml(s.id)}">
      <div class="book-card-badges">${badges}</div>
      <div class="book-card-body">
        <div class="book-card-title">${escapeHtml(s.title)}</div>
        <div class="book-card-author">${escapeHtml(s.author || 'Summary')}</div>
        <div class="book-card-meta">
          <span class="book-progress-pct">${prog.percent}%</span>
          <span>${escapeHtml(prog.sectionLabel)}</span>
          <span>${formatSummaryLastRead(prog.lastReadAt)}</span>
        </div>
      </div>
    </div>`;
}

function renderSummariesCategoryChips() {
  const wrap = $('summariesCategoryChips');
  if (!wrap) return;
  const cats = summaryCategories(state.summaryCatalog);
  const total = state.summaryCatalog.length;
  const chips = [
    `<button type="button" class="cat-chip${state.summariesCategory === 'all' ? ' active' : ''}" data-cat="all" aria-pressed="${state.summariesCategory === 'all'}">All <span class="cat-chip-count">${total}</span></button>`,
    ...cats.map(([name, count]) =>
      `<button type="button" class="cat-chip${state.summariesCategory === name ? ' active' : ''}" data-cat="${escapeHtml(name)}" aria-pressed="${state.summariesCategory === name}">${escapeHtml(name)} <span class="cat-chip-count">${count}</span></button>`,
    ),
  ];
  wrap.innerHTML = chips.join('');
  const active = wrap.querySelector('.cat-chip.active');
  active?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function filterSummaryCatalog(catalog, { category = 'all', query = '' } = {}) {
  const q = query.toLowerCase();
  return catalog.filter((s) => {
    if (category !== 'all' && summaryCategoryName(s) !== category) return false;
    if (!q) return true;
    return (s.title || '').toLowerCase().includes(q)
      || (s.author || '').toLowerCase().includes(q)
      || summaryCategoryName(s).toLowerCase().includes(q)
      || (s.subtopics || '').toLowerCase().includes(q);
  });
}

function renderSummariesBrowseGrid(items, { grouped = false, excludeFeatured = false } = {}) {
  const grid = $('summariesGrid');
  if (!grid) return;

  if (grouped) {
    const groups = groupSummariesByCategory(items, { excludeFeatured });
    grid.className = 'summaries-browse';
    grid.innerHTML = groups.map((g) => `
      <section class="summaries-cat-section" id="cat-${g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}">
        <h2 class="summaries-section-title summaries-cat-heading">
          ${escapeHtml(g.name)}
          <span class="summaries-cat-count">${g.items.length}</span>
        </h2>
        <div class="book-grid">${g.items.map(renderSummaryCard).join('')}</div>
      </section>`).join('');
    return;
  }

  grid.className = 'book-grid';
  grid.innerHTML = items.map(renderSummaryCard).join('');
}

async function renderSummariesGrid() {
  try {
    if (!state.summaryCatalog.length) {
      state.summaryCatalog = await fetchSummaryCatalog();
    }
  } catch (err) {
    $('summariesGrid').innerHTML = '';
    $('summariesFeaturedGrid')?.replaceChildren();
    $('summariesFeaturedWrap')?.classList.add('hidden');
    $('summariesEmpty').textContent = err.message || 'Could not load summaries.';
    $('summariesEmpty').classList.remove('hidden');
    return;
  }

  renderSummariesCategoryChips();

  const q = state.summariesSearchQuery;
  const cat = state.summariesCategory;
  const filtered = sortSummariesForDisplay(filterSummaryCatalog(state.summaryCatalog, { category: cat, query: q }));
  const browseAll = cat === 'all' && !q.trim();

  const countEl = $('summariesCount');
  if (countEl) {
    countEl.textContent = filtered.length === state.summaryCatalog.length
      ? `${filtered.length} summaries`
      : `${filtered.length} of ${state.summaryCatalog.length}`;
  }

  if (filtered.length === 0) {
    $('summariesGrid').innerHTML = '';
    $('summariesFeaturedGrid')?.replaceChildren();
    $('summariesFeaturedWrap')?.classList.add('hidden');
    $('summariesEmpty').textContent = state.summaryCatalog.length
      ? 'No summaries match your filters.'
      : 'No summaries yet.';
    $('summariesEmpty').classList.remove('hidden');
    return;
  }

  $('summariesEmpty').classList.add('hidden');

  const showTopSection = browseAll;
  if (showTopSection) {
    const featured = filtered.filter((s) => s.featured);
    const featuredWrap = $('summariesFeaturedWrap');
    const featuredGrid = $('summariesFeaturedGrid');
    if (featured.length && featuredWrap && featuredGrid) {
      featuredWrap.classList.remove('hidden');
      featuredGrid.innerHTML = featured.map(renderSummaryCard).join('');
    } else {
      featuredWrap?.classList.add('hidden');
      featuredGrid?.replaceChildren();
    }
    renderSummariesBrowseGrid(filtered, {
      grouped: true,
      excludeFeatured: featured.length > 0,
    });
  } else {
    $('summariesFeaturedWrap')?.classList.add('hidden');
    $('summariesFeaturedGrid')?.replaceChildren();
    renderSummariesBrowseGrid(filtered);
  }
}

async function openSummaryById(summaryId) {
  setOverlay(true, 'Loading summary…');
  try {
    const raw = await fetchSummaryBook(summaryId);
    const record = summaryToBookRecord(raw);
    setOverlay(false);
    await openBookRecord(record, true);
  } catch (err) {
    setOverlay(false);
    alert(err.message || 'Could not open summary');
  }
}

async function renderLibraryGrid() {
  state.libraryBooks = await listBooks();
  const hasBooks = state.libraryBooks.length > 0;
  const q = state.searchQuery.toLowerCase();
  const signedIn = authConfigured && isSignedIn();

  if (!signedIn) {
    $('libSyncBanner').classList.remove('hidden');
  } else {
    $('libSyncBanner').classList.toggle('hidden', hasBooks);
    if (!hasBooks) {
      setSyncBanner('Library empty on this account. Upload an EPUB — it syncs to your other devices automatically.', 'info');
    }
  }
  $('uploadZone').classList.toggle('hidden', hasBooks);
  $('libSearch').classList.toggle('hidden', !hasBooks);
  $('libActions').classList.remove('hidden');

  if (!hasBooks) {
    $('libGrid').classList.add('hidden');
    $('libEmpty').classList.add('hidden');
    return;
  }

  const filtered = state.libraryBooks.filter((b) => {
    if (!q) return true;
    return (b.title || '').toLowerCase().includes(q)
      || (b.author || '').toLowerCase().includes(q)
      || (b.fileName || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    $('libGrid').classList.add('hidden');
    $('libEmpty').classList.remove('hidden');
    return;
  }

  $('libEmpty').classList.add('hidden');
  $('libGrid').classList.remove('hidden');
  $('libGrid').innerHTML = filtered.map((b) => {
    const prog = bookProgress(b);
    const author = b.author || (b.type === 'article' ? 'Article' : 'Unknown author');
    const chLabel = prog.chapterTitle ? escapeHtml(prog.chapterTitle) : `Ch. ${(b.chapterIndex ?? 0) + 1}`;
    const typeLabel = b.type === 'article' ? 'Article' : b.type === 'summary' ? 'Summary' : 'EPUB';
    const placeholderBadge = b.isCloudPlaceholder
      ? `<span class="book-card-badge" title="This book is on another device — open the EPUB to read here.">On your other device</span>`
      : '';
    const reuploadBtn = b.isCloudPlaceholder
      ? `<button class="book-reupload" data-id="${escapeHtml(b.id)}" type="button">Open EPUB</button>`
      : '';
    return `
      <div class="book-card${b.isCloudPlaceholder ? ' is-placeholder' : ''}" data-id="${escapeHtml(b.id)}">
        <div class="book-card-badges"><span class="book-card-type">${typeLabel}</span>${placeholderBadge}</div>
        <div class="book-card-body">
          <div class="book-card-title">${escapeHtml(b.title)}</div>
          <div class="book-card-author">${escapeHtml(author)}</div>
          <div class="book-card-meta">
            <span class="book-progress-pct">${prog.percent}%</span>
            <span>${chLabel}</span>
            <span>${formatLastRead(b.lastReadAt)}</span>
          </div>
          ${reuploadBtn}
        </div>
        <button class="book-delete" data-id="${escapeHtml(b.id)}" type="button" aria-label="Delete">×</button>
      </div>`;
  }).join('');
  refreshAnalyticsView();
}

async function openBookRecord(record, enterReader = true) {
  state.book = record;
  state.chapterIndex = record.chapterIndex ?? record.startChapter ?? 0;
  state.index = record.wordIndex ?? 0;
  state.wpm = record.wpm ?? state.wpm;
  $('wpm').value = state.wpm;
  $('wpmOut').textContent = state.wpm;
  $('inputText').value = record.chapters[state.chapterIndex]?.text || '';
  state.hintShown = false;
  state.playLocked = false;
  renderChapterSelects();
  await loadText(false);
  if (enterReader) showReader();
}

async function loadBookFromFile(file) {
  setOverlay(true, `Parsing ${file.name}…`);
  try {
    const parsed = file.name.toLowerCase().endsWith('.epub')
      ? await parseEpub(file, (msg) => { $('overlayMsg').textContent = msg; })
      : await parseTxt(file);

    const dup = await findBookByHash(parsed.id);
    if (dup) {
      setOverlay(false);
      const open = confirm(`"${dup.title}" is already in your library. Open it?`);
      if (open) await openBookRecord(dup, true);
      return;
    }

    const record = await saveBook(parsed, {
      chapterIndex: parsed.startChapter ?? firstReadableChapter(parsed),
      wordIndex: 0,
      wpm: state.wpm,
    });

    setOverlay(false);
    markLibraryDirty();
    await openBookRecord(record, true);
  } catch (err) {
    setOverlay(false);
    const errEl = $('uploadError');
    if (errEl) {
      errEl.textContent = err.message || 'Could not parse file';
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 6000);
    }
  }
}

async function switchChapter(idx) {
  if (!state.book?.chapters[idx]) return;
  await persistProgress();
  await applyChapter(idx, 0);
  doStop();
  updateUI();
  saveProgressNow();
}

async function exportLib() {
  const json = await exportLibrary();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-library-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportOpmlFile() {
  const xml = await exportOpml();
  const blob = new Blob([xml], { type: 'text/x-opml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rsvp-library-${Date.now()}.opml`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importLibFile(file) {
  const text = await file.text();
  const { imported, updated, skipped } = await importLibrary(text, { merge: true });
  alert(`Imported ${imported}, updated ${updated}, skipped ${skipped}.`);
  await renderLibraryGrid();
  markLibraryDirty();
}

async function saveArticleFromForm() {
  const title = $('articleTitle').value.trim();
  const text = $('articleText').value.trim();
  if (!text) return alert('Paste some text first.');
  setOverlay(true, 'Saving article…');
  try {
    const record = await saveArticle({ title, text });
    $('articleTitle').value = '';
    $('articleText').value = '';
    $('articlePanel').classList.add('hidden');
    setOverlay(false);
    await renderLibraryGrid();
    markLibraryDirty();
    await openBookRecord(record, true);
  } catch (err) {
    setOverlay(false);
    alert(err.message);
  }
}

function bindUI() {
  $('tabSummaries')?.addEventListener('click', () => setHomeTab('summaries'));
  $('tabLibrary')?.addEventListener('click', () => setHomeTab('library'));
  $('summariesSearch')?.addEventListener('input', (e) => {
    state.summariesSearchQuery = e.target.value.trim();
    renderSummariesGrid().catch(() => {});
  });
  $('summariesCategoryChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.cat-chip');
    if (!chip?.dataset.cat) return;
    state.summariesCategory = chip.dataset.cat;
    renderSummariesGrid().catch(() => {});
  });
  $('summariesPanel')?.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-summary-id]');
    if (!card) return;
    await openSummaryById(card.dataset.summaryId);
  });

  $('uploadBtn').addEventListener('click', () => $('epubInput').click());
  $('addArticleBtn').addEventListener('click', () => {
    $('articlePanel').classList.toggle('hidden');
  });
  $('saveArticleBtn').addEventListener('click', saveArticleFromForm);
  $('exportLibBtn').addEventListener('click', exportLib);
  $('exportOpmlBtn')?.addEventListener('click', exportOpmlFile);
  $('importLibBtn').addEventListener('click', () => $('importInput').click());

  $('importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importLibFile(file);
  });

  $('epubInput').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) await loadBookFromFile(file);
  });

  $('libSearch').addEventListener('input', async (e) => {
    state.searchQuery = e.target.value;
    await renderLibraryGrid();
  });

  $('libGrid').addEventListener('click', async (e) => {
    const del = e.target.closest('.book-delete');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.id;
      const book = state.libraryBooks.find((b) => b.id === id);
      if (!book) return;
      if (!confirm(`Delete "${book.title}"?`)) return;
      await deleteBook(id);
      if (state.book?.id === id) state.book = null;
      await renderLibraryGrid();
      markLibraryDirty();
      return;
    }
    const card = e.target.closest('.book-card');
    if (!card) return;
    const record = await getBook(card.dataset.id);
    if (record) await openBookRecord(record, true);
  });

  $('chapterSelect').addEventListener('change', (e) => switchChapter(+e.target.value));
  $('btnLibrary').addEventListener('click', showLibrary);
  $('readerBackBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showLibrary();
  });
  $('btnCloseSheet').addEventListener('click', closeSheet);
  $('btnRestartPara').addEventListener('click', () => { restartParagraph(); closeSheet(); });
  $('sheetOverlay').addEventListener('click', (e) => {
    if (e.target === $('sheetOverlay')) closeSheet();
  });

  $('wpm').addEventListener('input', (e) => {
    setWpm(+e.target.value);
  });

  $('pauseMult').addEventListener('input', (e) => {
    state.pauseMult = +e.target.value;
    $('pauseMultOut').textContent = `${state.pauseMult}×`;
    localStorage.setItem('rsvp-pause-mult', state.pauseMult);
  });

  $('fontSize').addEventListener('input', (e) => {
    state.fontSize = +e.target.value;
    $('fontSizeOut').textContent = `${state.fontSize}rem`;
    localStorage.setItem('rsvp-font-size', state.fontSize);
    applyFontSize();
    updateScrollLayout();
    layoutOrpReader();
    if (state.readingMode === 'scroll' || state.readingMode === 'paragraph') updateUI();
  });

  $('lengthDelay').addEventListener('change', (e) => {
    state.lengthDelayEnabled = e.target.checked;
    localStorage.setItem('rsvp-length-delay', e.target.checked ? '1' : '0');
  });

  $('lengthDelayFactor').addEventListener('input', (e) => {
    state.lengthDelayFactor = +e.target.value;
    $('lengthDelayOut').textContent = state.lengthDelayFactor.toFixed(1);
    localStorage.setItem('rsvp-length-factor', state.lengthDelayFactor);
  });

  $('freqDelay').addEventListener('change', (e) => {
    state.frequencyDelayEnabled = e.target.checked;
    localStorage.setItem('rsvp-freq-delay', e.target.checked ? '1' : '0');
  });

  $('freqDelayFactor').addEventListener('input', (e) => {
    state.frequencyDelayFactor = +e.target.value;
    $('freqDelayOut').textContent = state.frequencyDelayFactor.toFixed(1);
    localStorage.setItem('rsvp-freq-factor', state.frequencyDelayFactor);
  });

  $('pauseSentence').addEventListener('change', (e) => {
    state.pauseAtSentenceEnd = e.target.checked;
    localStorage.setItem('rsvp-pause-sentence', e.target.checked ? '1' : '0');
  });

  $('modeSegment').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setReadingMode(btn.dataset.mode);
  });

  $('desktopModeSegment')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-desktop]');
    if (btn) setDesktopModePref(btn.dataset.desktop);
  });

  document.addEventListener('keydown', (e) => {
    if (!desktopKeyboardEnabled()) return;
    if (!state.inReader || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ($('sheetOverlay').classList.contains('open') && e.code !== 'Escape') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); seek(-1); haptic(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); seek(1); haptic(); }
    if (e.code === 'ArrowUp') { e.preventDefault(); adjustWpm(25); }
    if (e.code === 'ArrowDown') { e.preventDefault(); adjustWpm(-25); }
    if (e.code === 'KeyR') restartParagraph();
    if (e.code === 'BracketLeft') adjustWpm(-25);
    if (e.code === 'BracketRight') adjustWpm(25);
    if (e.code === 'PageUp') {
      const prev = state.chapterIndex - 1;
      if (prev >= 0) switchChapter(prev);
    }
    if (e.code === 'PageDown') {
      if (hasNextChapter()) switchChapter(state.chapterIndex + 1);
    }
    if (e.code === 'Escape') {
      if ($('sheetOverlay').classList.contains('open')) closeSheet();
      else if (!state.playing) showLibrary();
    }
    if (e.code === 'KeyS' && !state.playing) openSheet();
    if (e.code === 'KeyV') {
      e.preventDefault();
      const modes = ['rsvp', 'phantom', 'scroll', 'paragraph'];
      setReadingMode(modes[(modes.indexOf(state.readingMode) + 1) % modes.length]);
    }
  });
}

function loadSettings() {
  const mode = localStorage.getItem('rsvp-reading-mode');
  if (['rsvp', 'phantom', 'scroll', 'paragraph'].includes(mode)) setReadingMode(mode);
  else setReadingMode('rsvp');

  const savedWpm = localStorage.getItem('rsvp-wpm');
  if (savedWpm) { state.wpm = +savedWpm; $('wpm').value = savedWpm; $('wpmOut').textContent = savedWpm; }

  const savedPause = localStorage.getItem('rsvp-pause-mult');
  if (savedPause) { state.pauseMult = +savedPause; $('pauseMult').value = savedPause; $('pauseMultOut').textContent = `${savedPause}×`; }

  const savedFont = localStorage.getItem('rsvp-font-size');
  if (savedFont) { state.fontSize = +savedFont; $('fontSize').value = savedFont; $('fontSizeOut').textContent = `${savedFont}rem`; }

  state.lengthDelayEnabled = localStorage.getItem('rsvp-length-delay') === '1';
  $('lengthDelay').checked = state.lengthDelayEnabled;
  state.lengthDelayFactor = +(localStorage.getItem('rsvp-length-factor') || '0.1');
  $('lengthDelayFactor').value = state.lengthDelayFactor;
  $('lengthDelayOut').textContent = state.lengthDelayFactor.toFixed(1);

  state.frequencyDelayEnabled = localStorage.getItem('rsvp-freq-delay') === '1';
  $('freqDelay').checked = state.frequencyDelayEnabled;
  state.frequencyDelayFactor = +(localStorage.getItem('rsvp-freq-factor') || '0.3');
  $('freqDelayFactor').value = state.frequencyDelayFactor;
  $('freqDelayOut').textContent = state.frequencyDelayFactor.toFixed(1);

  state.pauseAtSentenceEnd = localStorage.getItem('rsvp-pause-sentence') === '1';
  $('pauseSentence').checked = state.pauseAtSentenceEnd;

  const savedDesktop = localStorage.getItem('rsvp-desktop-mode');
  if (['auto', 'on', 'off'].includes(savedDesktop)) state.desktopModePref = savedDesktop;

  updateDesktopMode();
  updateScrollLayout();
}

function isLandingEmbed() {
  return new URLSearchParams(window.location.search).get('embed') === 'landing';
}

function bindLandingEmbedMessages() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'rsvp-set-mode' && data.mode) {
      const modes = ['rsvp', 'phantom', 'scroll', 'paragraph'];
      if (modes.includes(data.mode)) setReadingMode(data.mode);
    }
    if (data.type === 'rsvp-set-wpm' && data.wpm != null) {
      setWpm(data.wpm);
    }
    if (data.type === 'rsvp-play') {
      play().catch(() => {});
    }
    if (data.type === 'rsvp-open-summary' && data.id) {
      openSummaryById(data.id).catch(() => {});
    }
  });
}

async function initLandingEmbed() {
  document.body.classList.add('embed-landing');
  $('authGate')?.classList.add('hidden');

  const params = new URLSearchParams(window.location.search);
  const embedMode = params.get('mode') || 'phantom';
  const modes = ['rsvp', 'phantom', 'scroll', 'paragraph'];
  if (modes.includes(embedMode)) setReadingMode(embedMode);

  const embedWpm = params.get('wpm');
  if (embedWpm) setWpm(embedWpm);

  const shouldAutoplay = params.get('autoplay') !== '0';

  let summaryId = params.get('summary');
  if (!summaryId) {
    try {
      const catalog = await fetchSummaryCatalog();
      summaryId = sortSummariesForDisplay(catalog)[0]?.id || null;
    } catch {
      summaryId = null;
    }
  }

  if (summaryId) {
    await openSummaryById(summaryId);
  } else {
    showWordPlaceholder('No summary available');
    $('reader')?.classList.remove('hidden');
    state.inReader = true;
    document.body.classList.add('in-reader');
  }

  bindLandingEmbedMessages();

  if (shouldAutoplay && state.words.length) {
    requestAnimationFrame(() => {
      play().catch(() => {});
    });
  }

  window.parent?.postMessage({ type: 'rsvp-ready' }, '*');
}

export async function initReaderApp() {
  loadSettings();
  try {
    state.wordlist = await loadWordlist();
  } catch {
    console.warn('Wordlist not loaded');
  }

  await migrateFromLocalStorage();
  await setupAuth();

  const landingEmbed = isLandingEmbed();
  if (landingEmbed) {
    await initLandingEmbed();
  } else {
    setHomeTab('summaries');
    await renderSummariesGrid();
  }

  // ── Share-to-RSVP handoff ───────────────────────────────────────────
  // The PWA share sheet lands on `/?article=<id>`. Open that book in the
  // reader right away (after the library has had a chance to render).
  // The article id is the contentHash / dedupe key from the share server.
  try {
    const params = new URLSearchParams(window.location.search);
    const articleId = params.get('article');
    if (articleId) {
      // Clear the query so a reload doesn't replay the open.
      params.delete('article');
      const search = params.toString();
      const cleanUrl = window.location.pathname + (search ? `?${search}` : '') + window.location.hash;
      window.history.replaceState(null, '', cleanUrl);
      let record = await getBook(articleId);
      if (!record) {
        // The article was saved server-side under the share-sheet request's
        // IP; pull it down and save it locally so the reader can open it.
        try {
          const res = await fetch('/share/article/' + encodeURIComponent(articleId));
          if (res.ok) {
            const remote = await res.json();
            if (remote && remote.text) {
              record = await saveArticle({ title: remote.title, text: remote.text });
              if (record && record.id && record.id !== articleId) {
                // Hashes shouldn't drift, but if they do, follow the local id.
                articleId = record.id;
              }
            }
          }
        } catch (err) {
          console.warn('Share-to-RSVP: remote fetch failed', err);
        }
      }
      if (record) {
        await openBookRecord(record, true);
      } else {
        console.warn('Share-to-RSVP: article id not available', articleId);
      }
    }
  } catch (err) {
    console.warn('Share-to-RSVP handoff failed', err);
  }

  window.matchMedia('(orientation: portrait)').addEventListener('change', () => {
    updateScrollLayout();
    updateDesktopMode();
    if (state.inReader && (state.readingMode === 'scroll' || state.readingMode === 'paragraph')) updateUI();
  });
  window.matchMedia('(pointer: fine)').addEventListener('change', updateDesktopMode);
  window.matchMedia('(min-width: 768px)').addEventListener('change', updateDesktopMode);
  window.addEventListener('resize', () => {
    updateScrollLayout();
    updateDesktopMode();
    layoutOrpReader();
  });

  bindReaderGestures();
  bindUI();
  setBodyMode();
  updateUI();
  if (!landingEmbed) await mountPaymentUI();
}

function isPaymentsEnabled() {
  try {
    const v = localStorage.getItem('rsvp-payments-enabled');
    if (v == null) return false;
    return /^(1|true|yes|on)$/i.test(String(v).trim());
  } catch {
    return false;
  }
}

// Wire the payment UI into the settings sheet and library footer.
// Gated by `rsvp-payments-enabled`; no-ops when the flag is unset.
async function mountPaymentUI() {
  if (!isPaymentsEnabled()) return;

  let mountPaymentButton;
  let loadPaymentConfig;
  try {
    const mod = await import('./payments/payment-button.mjs');
    mountPaymentButton = mod.mountPaymentButton;
    loadPaymentConfig = mod.loadConfig;
  } catch {
    return;
  }

  // Settings sheet — mount the button into the existing #paymentSection.
  const sheetSection = document.getElementById('paymentSection');
  if (sheetSection) {
    sheetSection.classList.remove('hidden');
    sheetSection.removeAttribute('hidden');
    const ok = await mountPaymentButton('paymentBtn');
    if (!ok) {
      // Fallback: bind click on the existing #paymentBtn button if mount
      // couldn't replace it (e.g. test environment, script load failure).
      const btn = document.getElementById('paymentBtn');
      if (btn) {
        btn.addEventListener('click', async (ev) => {
          ev.preventDefault();
          const config = await loadPaymentConfig();
          try {
            console.log('[rsvp-pay] click', {
              ts: new Date().toISOString(),
              url: config.checkoutUrl,
            });
          } catch { /* ignore */ }
          try { window.open(config.checkoutUrl, '_blank', 'noopener,noreferrer'); }
          catch { window.location.href = config.checkoutUrl; }
        });
      }
    }
  }

  // Library footer — unhide the support link and route its click to the
  // same checkout flow.
  const libLink = document.getElementById('librarySupportLink');
  if (libLink) {
    libLink.classList.remove('hidden');
    libLink.removeAttribute('hidden');
    libLink.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const config = await loadPaymentConfig();
      try {
        console.log('[rsvp-pay] click', {
          ts: new Date().toISOString(),
          url: config.checkoutUrl,
          from: 'library-footer',
        });
      } catch { /* ignore */ }
      try { window.open(config.checkoutUrl, '_blank', 'noopener,noreferrer'); }
      catch { window.location.href = config.checkoutUrl; }
    });
  }
}