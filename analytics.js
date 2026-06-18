// analytics.js
// Reading-event tracking, daily word aggregation, and achievements for
// RSVP Reader. Pure ES module — no IndexedDB, no network.
//
// Reading events are derived from progress deltas: every reading session
// emits one or more { deviceId, contentHash, startAbs, endAbs, wpm, startedAt,
// endedAt, wordsRead } records. Aggregate by local-tz day for UI, but store
// timestamps in UTC ms.

const EVENT_BUCKET_MS = 1000; // 1s bucketing prevents duplicate-event noise

/**
 * @typedef {Object} ReadingEvent
 * @property {string} eventId
 * @property {string} deviceId
 * @property {string} contentHash
 * @property {string} [bookId]
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {number} startAbsoluteWordIndex
 * @property {number} endAbsoluteWordIndex
 * @property {number} wordsRead
 * @property {number} wpm
 */

/**
 * Build a deterministic event id from the unique reading interval, device and
 * time bucket so re-syncs collapse into a single event.
 */
export function makeEventId({ deviceId, contentHash, startAbs, endAbs, ts }) {
  const bucket = Math.floor((ts || Date.now()) / EVENT_BUCKET_MS);
  return [deviceId || 'anon', contentHash || 'unknown', startAbs | 0, endAbs | 0, bucket].join(':');
}

/**
 * Construct a reading event. If the interval has no forward progress, returns
 * null.
 */
export function buildReadingEvent({
  deviceId, contentHash, bookId,
  startAbs, endAbs, wpm, startedAt, endedAt,
}) {
  const start = Math.max(0, startAbs | 0);
  const end = Math.max(start, endAbs | 0);
  const wordsRead = end - start;
  if (wordsRead <= 0) return null;
  return {
    eventId: makeEventId({ deviceId, contentHash, startAbs: start, endAbs: end, ts: endedAt }),
    deviceId: deviceId || 'anon',
    contentHash: contentHash || '',
    bookId: bookId || contentHash || '',
    startedAt: startedAt || endedAt,
    endedAt,
    startAbsoluteWordIndex: start,
    endAbsoluteWordIndex: end,
    wordsRead,
    wpm: Math.max(0, wpm | 0),
  };
}

/**
 * Merge a remote event list into a local one, deduplicating by eventId. The
 * resulting list is sorted ascending by endedAt.
 */
export function mergeEvents(localEvents, remoteEvents) {
  const seen = new Set();
  const out = [];
  for (const e of (Array.isArray(remoteEvents) ? remoteEvents : [])) {
    if (!e?.eventId) continue;
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    out.push(e);
  }
  for (const e of (Array.isArray(localEvents) ? localEvents : [])) {
    if (!e?.eventId) continue;
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    out.push(e);
  }
  out.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  return out;
}

/**
 * Convert UTC ms to a local-tz YYYY-MM-DD key.
 */
export function localDayKey(ts, tzOffsetMin = new Date(ts).getTimezoneOffset()) {
  const local = new Date(ts - tzOffsetMin * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Group events into local-day buckets: { 'YYYY-MM-DD': { words, minutes, events, books:Set } }
 */
export function groupEventsByLocalDay(events, tzOffsetMin = new Date().getTimezoneOffset()) {
  const buckets = new Map();
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || e.wordsRead == null) continue;
    const key = localDayKey(e.endedAt, tzOffsetMin);
    let b = buckets.get(key);
    if (!b) { b = { words: 0, minutes: 0, events: 0, books: new Set() }; buckets.set(key, b); }
    b.words += e.wordsRead;
    b.minutes += e.wpm > 0 ? e.wordsRead / e.wpm : 0;
    b.events += 1;
    if (e.contentHash) b.books.add(e.contentHash);
  }
  const out = {};
  for (const [k, v] of buckets) {
    out[k] = {
      words: v.words,
      minutes: Math.round(v.minutes * 10) / 10,
      events: v.events,
      bookCount: v.books.size,
    };
  }
  return out;
}

/**
 * Compute aggregate reading stats. Local-tz days are used for daily cuts; if
 * tzOffsetMin is omitted, the current runtime timezone is used.
 */
export function aggregateStats(events, { now = Date.now(), tzOffsetMin = new Date().getTimezoneOffset() } = {}) {
  const arr = Array.isArray(events) ? events : [];
  const dayMs = 86_400_000;

  const today = localDayKey(now, tzOffsetMin);
  const cutoff7 = now - 7 * dayMs;
  const cutoff30 = now - 30 * dayMs;

  let wordsToday = 0;
  let minutesToday = 0;
  let words7d = 0;
  let minutes7d = 0;
  let words30d = 0;
  let activeDaysSet = new Set();
  let totalWpm = 0;
  let totalWpmCount = 0;
  const books = new Set();
  let totalEvents = 0;
  let totalWords = 0;

  for (const e of arr) {
    if (!e) continue;
    totalEvents++;
    totalWords += e.wordsRead || 0;
    if (e.contentHash) books.add(e.contentHash);
    if (e.wpm > 0) { totalWpm += e.wpm; totalWpmCount++; }
    const key = localDayKey(e.endedAt, tzOffsetMin);
    if (key === today) {
      wordsToday += e.wordsRead || 0;
      minutesToday += e.wpm > 0 ? (e.wordsRead || 0) / e.wpm : 0;
    }
    if ((e.endedAt || 0) >= cutoff7) {
      words7d += e.wordsRead || 0;
      minutes7d += e.wpm > 0 ? (e.wordsRead || 0) / e.wpm : 0;
    }
    if ((e.endedAt || 0) >= cutoff30) {
      words30d += e.wordsRead || 0;
    }
    activeDaysSet.add(key);
  }

  // Streak: count back from today while the user has activity each local day
  let currentStreak = 0;
  const dayIter = new Date(now - tzOffsetMin * 60_000);
  for (let i = 0; i < 366; i++) {
    const y = dayIter.getUTCFullYear();
    const m = String(dayIter.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dayIter.getUTCDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    if (activeDaysSet.has(key)) {
      currentStreak++;
      dayIter.setUTCDate(dayIter.getUTCDate() - 1);
    } else if (i === 0) {
      // Today is allowed to be empty without breaking the streak — break only
      // if yesterday is empty too.
      dayIter.setUTCDate(dayIter.getUTCDate() - 1);
    } else {
      break;
    }
  }

  // Best streak: scan all days, find longest run
  const sortedDays = Array.from(activeDaysSet).sort();
  let bestStreak = 0;
  let run = 0;
  let prevKey = null;
  for (const k of sortedDays) {
    if (prevKey && nextDayKey(prevKey) === k) {
      run++;
    } else {
      run = 1;
    }
    if (run > bestStreak) bestStreak = run;
    prevKey = k;
  }
  bestStreak = Math.max(bestStreak, currentStreak);

  return {
    wordsToday,
    minutesToday: Math.round(minutesToday * 10) / 10,
    words7d,
    minutes7d: Math.round(minutes7d * 10) / 10,
    words30d,
    activeDays: activeDaysSet.size,
    currentStreak,
    bestStreak,
    avgWpm: totalWpmCount > 0 ? Math.round(totalWpm / totalWpmCount) : 0,
    booksTouched: books.size,
    totalEvents,
    totalWords,
  };
}

function nextDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}


export const DAILY_WORD_GOAL = 5000;

export const READER_LEVELS = [
  { level: 1, name: 'Focus Seed', minWords: 0 },
  { level: 2, name: 'Page Starter', minWords: 2_000 },
  { level: 3, name: 'Coffee Reader', minWords: 5_000 },
  { level: 4, name: 'Chapter Climber', minWords: 15_000 },
  { level: 5, name: 'Streak Builder', minWords: 30_000 },
  { level: 6, name: 'Deep Reader', minWords: 60_000 },
  { level: 7, name: 'Library Pro', minWords: 120_000 },
  { level: 8, name: 'Focus Legend', minWords: 250_000 },
];

export function getReaderLevel(totalWords = 0) {
  const words = Math.max(0, Number(totalWords) || 0);
  let current = READER_LEVELS[0];
  let next = null;
  for (let i = 0; i < READER_LEVELS.length; i++) {
    if (words >= READER_LEVELS[i].minWords) {
      current = READER_LEVELS[i];
      next = READER_LEVELS[i + 1] || null;
    }
  }
  const span = next ? Math.max(1, next.minWords - current.minWords) : 1;
  const gained = Math.max(0, words - current.minWords);
  return {
    ...current,
    totalWords: words,
    nextLevel: next,
    wordsToNext: next ? Math.max(0, next.minWords - words) : 0,
    progress: next ? Math.min(100, Math.round((gained / span) * 100)) : 100,
  };
}

function maxDailyWords(days = {}) {
  return Math.max(0, ...Object.values(days).map((d) => d?.words || 0));
}

function badgeProgress(kind, target, stats, days, extra = {}) {
  let value = 0;
  if (kind === 'daily') value = maxDailyWords(days);
  if (kind === 'today') value = stats.wordsToday || 0;
  if (kind === 'streak') value = Math.max(stats.currentStreak || 0, stats.bestStreak || 0);
  if (kind === 'weekly') value = stats.words7d || 0;
  if (kind === 'total') value = stats.totalWords || 0;
  if (kind === 'chapters') value = extra.chapterCompletions || 0;
  if (kind === 'books') value = extra.booksFinished || 0;
  if (kind === 'devices') value = extra.uniqueDevices7d || 0;
  if (kind === 'sessionMs') value = extra.longestSingleSessionMs || 0;
  return {
    value,
    target,
    percent: target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 100,
  };
}

/**
 * Achievement definitions. Each rule receives the aggregate stats and the
 * daily-bucket map and returns either null (locked) or { unlockedAt }.
 */
export const ACHIEVEMENTS = [
  {
    id: 'first-thousand',
    icon: '✨',
    title: 'First 1K Day',
    description: 'Read 1,000 words in a single day.',
    kind: 'daily',
    target: 1000,
    check: (_stats, days) => (maxDailyWords(days) >= 1000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'daily-quest-5k',
    icon: '☕',
    title: 'Coffee Quest',
    description: 'Hit the 5,000-word daily quest.',
    kind: 'daily',
    target: DAILY_WORD_GOAL,
    check: (_stats, days) => (maxDailyWords(days) >= DAILY_WORD_GOAL ? { unlockedAt: 0 } : null),
  },
  {
    id: 'streak-7',
    icon: '🔥',
    title: '7-Day Streak',
    description: 'Read on 7 consecutive days.',
    kind: 'streak',
    target: 7,
    check: (stats) => (stats.currentStreak >= 7 || stats.bestStreak >= 7 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'ten-k-week',
    icon: '⚡',
    title: '10K Week',
    description: 'Read 10,000 words in a rolling 7-day window.',
    kind: 'weekly',
    target: 10000,
    check: (stats) => (stats.words7d >= 10000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'total-30k',
    icon: '🏔️',
    title: '30K Climber',
    description: 'Read 30,000 total words.',
    kind: 'total',
    target: 30000,
    check: (stats) => (stats.totalWords >= 30000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'first-chapter',
    icon: '📘',
    title: 'First Chapter',
    description: 'Complete your first chapter end-to-end.',
    kind: 'chapters',
    target: 1,
    check: (_stats, _days, extra) => (extra?.chapterCompletions >= 1 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'first-book',
    icon: '🏁',
    title: 'First Book',
    description: 'Reach 100% on a book.',
    kind: 'books',
    target: 1,
    check: (_stats, _days, extra) => (extra?.booksFinished >= 1 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'two-devices',
    icon: '🔁',
    title: 'Two-Device Reader',
    description: 'Read from at least 2 devices in one week.',
    kind: 'devices',
    target: 2,
    check: (_stats, _days, extra) => ((extra?.uniqueDevices7d || 0) >= 2 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'wpm-ten-min',
    icon: '⏱️',
    title: '10-Minute Flow',
    description: 'Read at your chosen WPM for 10 minutes straight.',
    kind: 'sessionMs',
    target: 10 * 60_000,
    check: (_stats, _days, extra) => ((extra?.longestSingleSessionMs || 0) >= 10 * 60_000 ? { unlockedAt: 0 } : null),
  },
];

/**
 * Run all achievement rules and return the new unlock set. Existing unlocks
 * are preserved.
 */
export function checkAchievements(stats, days, extra = {}, existing = []) {
  const byId = new Map((Array.isArray(existing) ? existing : []).map((a) => [a.id, a]));
  const out = [];
  for (const a of ACHIEVEMENTS) {
    const progress = badgeProgress(a.kind, a.target, stats, days, extra);
    const prior = byId.get(a.id);
    const result = prior ? { unlockedAt: prior.unlockedAt } : a.check(stats, days, extra);
    if (result) {
      out.push({
        id: a.id,
        icon: prior?.icon || a.icon,
        title: prior?.title || a.title,
        description: prior?.description || a.description,
        unlockedAt: prior?.unlockedAt || result.unlockedAt || Date.now(),
        progress,
      });
    }
  }
  // Preserve unknown legacy achievements instead of dropping user data.
  for (const item of (Array.isArray(existing) ? existing : [])) {
    if (item?.id && !ACHIEVEMENTS.some((a) => a.id === item.id)) out.push(item);
  }
  return out;
}

export function buildGamificationSummary(events, existingAchievements = [], extra = {}, options = {}) {
  const stats = aggregateStats(events, options);
  const days = groupEventsByLocalDay(events, options.tzOffsetMin);
  const achievements = checkAchievements(stats, days, extra, existingAchievements);
  const unlockedIds = new Set(achievements.map((a) => a.id));
  const badges = ACHIEVEMENTS.map((a) => {
    const unlocked = achievements.find((item) => item.id === a.id);
    const progress = badgeProgress(a.kind, a.target, stats, days, extra);
    return unlocked || {
      id: a.id,
      icon: a.icon,
      title: a.title,
      description: a.description,
      locked: true,
      progress,
    };
  });
  return {
    stats,
    days,
    dailyGoal: DAILY_WORD_GOAL,
    dailyPercent: Math.min(100, Math.round(((stats.wordsToday || 0) / DAILY_WORD_GOAL) * 100)),
    wordsToDailyGoal: Math.max(0, DAILY_WORD_GOAL - (stats.wordsToday || 0)),
    level: getReaderLevel(stats.totalWords || 0),
    achievements,
    badges,
    unlockedCount: unlockedIds.size,
    totalBadgeCount: ACHIEVEMENTS.length,
  };
}

/**
 * Build a per-book completion summary from progress (chapterIndex/wordIndex
 * per book). Inputs: an array of book records, each with
 * { id, contentHash, totalWords, chapters:[{wordCount}], chapterIndex, wordIndex }.
 * Returns { booksFinished, chapterCompletions }.
 */
export function summarizeCompletions(books) {
  let booksFinished = 0;
  let chapterCompletions = 0;
  for (const b of (Array.isArray(books) ? books : [])) {
    const total = b.totalWords || (b.chapters || []).reduce((s, c) => s + (c.wordCount || 0), 0);
    if (!total) continue;
    let wordsRead = 0;
    const ch = Math.max(0, b.chapterIndex | 0);
    for (let i = 0; i < ch && i < (b.chapters || []).length; i++) {
      wordsRead += b.chapters[i]?.wordCount || 0;
      chapterCompletions++;
    }
    wordsRead += Math.max(0, b.wordIndex | 0);
    if (wordsRead >= total) booksFinished++;
  }
  return { booksFinished, chapterCompletions };
}

export { ACHIEVEMENTS as ACHIEVEMENT_DEFINITIONS };
