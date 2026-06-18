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

/**
 * Achievement definitions. Each rule receives the aggregate stats and the
 * daily-bucket map and returns either null (locked) or { unlockedAt }.
 */
export const ACHIEVEMENTS = [
  {
    id: 'first-thousand',
    title: '1,000 words in a day',
    description: 'Read 1,000 words in a single day.',
    check: (stats, days) => {
      for (const k of Object.keys(days)) {
        if ((days[k].words || 0) >= 1000) return { unlockedAt: 0 };
      }
      return null;
    },
  },
  {
    id: 'streak-7',
    title: '7-day streak',
    description: 'Read on 7 consecutive days.',
    check: (stats) => (stats.currentStreak >= 7 || stats.bestStreak >= 7 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'ten-k-week',
    title: '10,000 words in a week',
    description: 'Read 10,000 words in any rolling 7-day window.',
    check: (stats) => (stats.words7d >= 10000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'first-chapter',
    title: 'First chapter finished',
    description: 'Complete your first chapter end-to-end.',
    // Chapter completions come in as separate events; we count them via totalEvents
    // plus the dedicated chapterEnd eventId prefix.
    check: (stats, _days, extra) => (extra?.chapterCompletions >= 1 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'first-book',
    title: 'First book finished',
    description: 'Reach 100% on a book.',
    check: (_stats, _days, extra) => (extra?.booksFinished >= 1 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'two-devices',
    title: 'Read on 2 devices in 1 week',
    description: 'Have reading events from at least 2 different devices in the last 7 days.',
    check: (_stats, _days, extra) => ((extra?.uniqueDevices7d || 0) >= 2 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'wpm-ten-min',
    title: 'WPM target for 10 minutes',
    description: 'Read at your chosen WPM for 10 minutes straight.',
    check: (_stats, _days, extra) => {
      const t = extra?.longestSingleSessionMs || 0;
      if (t >= 10 * 60_000) return { unlockedAt: 0 };
      return null;
    },
  },
];

/**
 * Run all achievement rules and return the new unlock set. Existing unlocks
 * are preserved.
 */
export function checkAchievements(stats, days, extra = {}, existing = []) {
  const known = new Set(existing.map((a) => a.id));
  const out = existing.slice();
  for (const a of ACHIEVEMENTS) {
    if (known.has(a.id)) continue;
    const result = a.check(stats, days, extra);
    if (result) {
      out.push({ id: a.id, title: a.title, description: a.description, unlockedAt: result.unlockedAt || Date.now() });
    }
  }
  return out;
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
