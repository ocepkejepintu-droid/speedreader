import { buildBoundaries, bookProgress, formatLastRead } from './library.js';

const PROGRESS_KEY = 'rsvp-summary-progress';
const API_BASE = '/rsvp/summaries';

function readProgressMap() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeProgressMap(map) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function getSummaryProgress(id) {
  const map = readProgressMap();
  return map[id] || { chapterIndex: 0, wordIndex: 0, wpm: 300, lastReadAt: null };
}

export function saveSummaryProgress(id, { chapterIndex, wordIndex, wpm }) {
  const map = readProgressMap();
  map[id] = {
    chapterIndex: chapterIndex ?? 0,
    wordIndex: wordIndex ?? 0,
    wpm: wpm ?? map[id]?.wpm ?? 300,
    lastReadAt: Date.now(),
  };
  writeProgressMap(map);
}

export async function fetchSummaryCatalog() {
  const res = await fetch(`${API_BASE}/catalog`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load book summaries');
  const data = await res.json();
  return data.summaries || [];
}

export const SUMMARY_CATEGORY_ORDER = [
  'Self-Growth',
  'Productivity',
  'Happiness',
  'Health',
  'Business & Career',
  'Money & Investments',
  'Leadership',
  'Negotiation',
  'Love & Sex',
  'Family',
  'Spirituality',
  'Society & Tech',
  'Personalities',
  'Home & Environment',
  'Uncategorized',
];

export function summaryCategoryName(summary) {
  return summary?.category || 'Uncategorized';
}

export function summaryCategories(catalog) {
  const counts = new Map();
  for (const s of catalog || []) {
    const name = summaryCategoryName(s);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ordered = [];
  for (const name of SUMMARY_CATEGORY_ORDER) {
    if (counts.has(name)) ordered.push([name, counts.get(name)]);
  }
  for (const [name, count] of counts) {
    if (!SUMMARY_CATEGORY_ORDER.includes(name)) ordered.push([name, count]);
  }
  return ordered;
}

export function groupSummariesByCategory(catalog, { excludeFeatured = false } = {}) {
  const groups = new Map();
  for (const s of catalog || []) {
    if (excludeFeatured && s.featured) continue;
    const name = summaryCategoryName(s);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  for (const items of groups.values()) {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  const ordered = [];
  for (const name of SUMMARY_CATEGORY_ORDER) {
    if (groups.has(name)) ordered.push({ name, items: groups.get(name) });
  }
  for (const [name, items] of groups) {
    if (!SUMMARY_CATEGORY_ORDER.includes(name)) ordered.push({ name, items });
  }
  return ordered;
}

function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Featured summaries shuffled daily, then the rest A–Z. */
export function sortSummariesForDisplay(catalog) {
  const featured = [];
  const rest = [];
  for (const item of catalog || []) {
    if (item.featured) featured.push(item);
    else rest.push(item);
  }
  rest.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return [...seededShuffle(featured, dailySeed()), ...rest];
}

export async function fetchSummaryBook(id) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Summary not found');
  return res.json();
}

export function summaryToBookRecord(summary) {
  const progress = getSummaryProgress(summary.id);
  const chapters = (summary.chapters || []).map((ch) => {
    const text = ch.text || '';
    const boundaries = buildBoundaries(text);
    return {
      title: ch.title || 'Section',
      text,
      wordCount: ch.wordCount || text.split(/\s+/).filter(Boolean).length,
      ...boundaries,
    };
  });
  const totalWords = summary.totalWords || chapters.reduce((s, c) => s + c.wordCount, 0);
  return {
    id: `summary:${summary.id}`,
    summaryId: summary.id,
    contentHash: summary.id,
    fileName: '',
    title: summary.title || 'Untitled',
    author: summary.author || '',
    type: 'summary',
    source: summary.source || 'headway',
    totalWords,
    startChapter: 0,
    chapters,
    addedAt: summary.addedAt || Date.now(),
    lastReadAt: progress.lastReadAt,
    chapterIndex: progress.chapterIndex ?? 0,
    wordIndex: progress.wordIndex ?? 0,
    wpm: progress.wpm ?? 300,
    isSharedSummary: true,
  };
}

export function summaryCardProgress(record) {
  return bookProgress(record);
}

export function summaryListMeta(meta) {
  const p = getSummaryProgress(meta.id);
  const chapters = meta.chapterCount || 1;
  const totalWords = meta.totalWords || 0;
  let percent = 0;
  if (totalWords > 0 && ((p.chapterIndex ?? 0) > 0 || (p.wordIndex ?? 0) > 0)) {
    const wordsPerChapter = totalWords / chapters;
    const wordsRead = (p.chapterIndex ?? 0) * wordsPerChapter + (p.wordIndex ?? 0);
    percent = Math.min(100, Math.round((wordsRead / totalWords) * 100));
  } else if (chapters > 1 && (p.chapterIndex ?? 0) > 0) {
    percent = Math.min(100, Math.round(((p.chapterIndex ?? 0) / chapters) * 100));
  } else if (p.wordIndex > 0) {
    percent = 1;
  }
  return {
    percent,
    sectionLabel: `Pt. ${(p.chapterIndex ?? 0) + 1}/${chapters}`,
    lastReadAt: p.lastReadAt,
  };
}

export { formatLastRead };