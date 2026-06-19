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
 * Per-level daily quest target. Word goals scale with reader level so new
 * readers aren't asked to grind 5K on day one.
 */
export const DAILY_QUEST_TABLE = {
  1: 500,    // Focus Seed — a 2-minute warm-up
  2: 1000,   // Page Starter — a single chapter
  3: 2000,   // Coffee Reader — one sitting
  4: 3000,   // Chapter Climber
  5: 4000,   // Streak Builder
  6: 5000,   // Deep Reader — legacy 5K default
  7: 6500,   // Library Pro
  8: 7500,   // Focus Legend — full immersion
};

export function getDailyQuestTarget(level = 1) {
  const capped = Math.max(1, Math.min(8, level | 0));
  return DAILY_QUEST_TABLE[capped] || 1000;
}

export const DAILY_WORD_GOAL = 5000; // legacy default, superseded by getDailyQuestTarget()

/**
 * Returns a { icon, accent } descriptor for a reader level, used by the level
 * badge and the level-up toast.
 */
export const LEVEL_VISUALS = {
  1: { icon: '🌱', accent: '#7C3AED' }, // Focus Seed
  2: { icon: '📖', accent: '#7C3AED' }, // Page Starter
  3: { icon: '☕', accent: '#D97706' }, // Coffee Reader
  4: { icon: '🧗', accent: '#D97706' }, // Chapter Climber
  5: { icon: '🔥', accent: '#DC2626' }, // Streak Builder
  6: { icon: '🧠', accent: '#DC2626' }, // Deep Reader
  7: { icon: '📚', accent: '#059669' }, // Library Pro
  8: { icon: '🏆', accent: '#059669' }, // Focus Legend
};

/**
 * Title rewards unlocked by reaching a particular level. Titles decorate the
 * reader's profile and reading-mode signature line.
 */
export const TITLES = [
  { id: 't-budding',      name: 'Budding Reader',   minLevel: 1 },
  { id: 't-page-walker',  name: 'Page Walker',      minLevel: 2 },
  { id: 't-coffee-philo', name: 'Coffee Philosopher', minLevel: 3 },
  { id: 't-climber',      name: 'Climber of Chapters', minLevel: 4 },
  { id: 't-streaker',     name: 'Streak Stoker',    minLevel: 5 },
  { id: 't-deep',         name: 'Deep Current',     minLevel: 6 },
  { id: 't-librarian',    name: 'Field Librarian',  minLevel: 7 },
  { id: 't-legend',       name: 'Focus Legend',     minLevel: 8 },
];

/**
 * App-icon rewards — alternate manifest icons the user can pick. Unlocked
 * by hitting a streak milestone or a level.
 */
export const APP_ICONS = [
  { id: 'icon-default',  name: 'Crimson Reader',   kind: 'default',   accent: '#fc1c46', unlock: { type: 'level', level: 1 } },
  { id: 'icon-midnight', name: 'Midnight Focus',   kind: 'dark',      accent: '#7C3AED', unlock: { type: 'level', level: 3 } },
  { id: 'icon-ember',    name: 'Ember Streak',     kind: 'fire',      accent: '#D97706', unlock: { type: 'streak', days: 7 } },
  { id: 'icon-obsidian', name: 'Obsidian Library', kind: 'obsidian',  accent: '#059669', unlock: { type: 'level', level: 5 } },
  { id: 'icon-crystal',  name: 'Crystal Mind',     kind: 'crystal',   accent: '#0EA5E9', unlock: { type: 'level', level: 7 } },
  { id: 'icon-gold',     name: 'Gold Legend',      kind: 'gold',      accent: '#D97706', unlock: { type: 'level', level: 8 } },
];

/**
 * Reader themes unlocked through gameplay. Each theme overrides the visual
 * accent used across the UI; the ORP word color, conic quest ring, and
 * progress chips all read from `theme.accent`.
 */
export const THEMES = [
  { id: 'theme-default',  name: 'Signal Crimson',  accent: '#fc1c46', unlock: { type: 'level', level: 1 } },
  { id: 'theme-violet',   name: 'Violet Focus',    accent: '#7C3AED', unlock: { type: 'level', level: 2 } },
  { id: 'theme-amber',    name: 'Amber Streak',    accent: '#D97706', unlock: { type: 'streak', days: 3 } },
  { id: 'theme-ember',    name: 'Ember Library',   accent: '#DC2626', unlock: { type: 'streak', days: 7 } },
  { id: 'theme-deep',     name: 'Deep Current',    accent: '#0EA5E9', unlock: { type: 'level', level: 5 } },
  { id: 'theme-jade',     name: 'Jade Archive',    accent: '#059669', unlock: { type: 'level', level: 6 } },
  { id: 'theme-gold',     name: 'Gold Legend',     accent: '#D97706', unlock: { type: 'level', level: 8 } },
  { id: 'theme-obsidian', name: 'Obsidian Noon',   accent: '#4c4c4c', unlock: { type: 'level', level: 7 } },
];

/**
 * Full reward catalog. Anything the user can earn — themes, icons, titles —
 * lives here. The active reward set is the subset whose unlock conditions are
 * met.
 */
export const REWARDS = [
  ...THEMES.map((t) => ({ ...t, category: 'theme' })),
  ...APP_ICONS.map((i) => ({ ...i, category: 'icon' })),
  ...TITLES.map((t) => ({ ...t, category: 'title' })),
];

/**
 * Resolve the list of reward ids currently unlocked for a given reader state.
 */
export function unlockedRewardIds({ level = 1, currentStreak = 0, bestStreak = 0 } = {}) {
  const best = Math.max(currentStreak | 0, bestStreak | 0);
  return REWARDS.filter((r) => {
    const u = r.unlock;
    if (!u) return true;
    if (u.type === 'level' && level >= (u.level || 1)) return true;
    if (u.type === 'streak' && best >= (u.days || 1)) return true;
    return false;
  }).map((r) => r.id);
}

/**
 * Return the catalog entry for a given reward id, or null.
 */
export function getReward(id) {
  return REWARDS.find((r) => r.id === id) || null;
}

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
  // --- Day / pace ---
  {
    id: 'first-hundred',
    icon: '🟢',
    title: 'First Hundred',
    description: 'Read your first 100 words in a day.',
    kind: 'today',
    target: 100,
    check: (stats) => (stats.wordsToday >= 100 ? { unlockedAt: 0 } : null),
  },
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
    target: 5000,
    check: (_stats, days) => (maxDailyWords(days) >= 5000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'daily-quest-10k',
    icon: '🛡️',
    title: 'Iron Day',
    description: 'Read 10,000 words in a single day.',
    kind: 'daily',
    target: 10000,
    check: (_stats, days) => (maxDailyWords(days) >= 10000 ? { unlockedAt: 0 } : null),
  },
  // --- Streaks ---
  {
    id: 'streak-3',
    icon: '🌅',
    title: 'Hat Trick',
    description: '3-day reading streak.',
    kind: 'streak',
    target: 3,
    check: (stats) => (stats.currentStreak >= 3 || stats.bestStreak >= 3 ? { unlockedAt: 0 } : null),
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
    id: 'streak-30',
    icon: '🌙',
    title: '30-Day Streak',
    description: 'A whole month of daily reading.',
    kind: 'streak',
    target: 30,
    check: (stats) => (stats.currentStreak >= 30 || stats.bestStreak >= 30 ? { unlockedAt: 0 } : null),
  },
  // --- Volume ---
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
    id: 'total-100k',
    icon: '💯',
    title: 'Six-Figure Reader',
    description: 'Read 100,000 total words.',
    kind: 'total',
    target: 100000,
    check: (stats) => (stats.totalWords >= 100000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'total-250k',
    icon: '🏆',
    title: 'Quarter-Million',
    description: 'Read 250,000 total words.',
    kind: 'total',
    target: 250000,
    check: (stats) => (stats.totalWords >= 250000 ? { unlockedAt: 0 } : null),
  },
  // --- Books / chapters ---
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
    id: 'chapter-25',
    icon: '📚',
    title: '25 Chapters',
    description: 'Finish 25 chapters.',
    kind: 'chapters',
    target: 25,
    check: (_stats, _days, extra) => ((extra?.chapterCompletions || 0) >= 25 ? { unlockedAt: 0 } : null),
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
    id: 'bookshelf-5',
    icon: '🗄️',
    title: 'Bookshelf Builder',
    description: 'Finish 5 books.',
    kind: 'books',
    target: 5,
    check: (_stats, _days, extra) => ((extra?.booksFinished || 0) >= 5 ? { unlockedAt: 0 } : null),
  },
  // --- Sessions / devices ---
  {
    id: 'wpm-ten-min',
    icon: '⏱️',
    title: '10-Minute Flow',
    description: 'Read at your chosen WPM for 10 minutes straight.',
    kind: 'sessionMs',
    target: 10 * 60_000,
    check: (_stats, _days, extra) => ((extra?.longestSingleSessionMs || 0) >= 10 * 60_000 ? { unlockedAt: 0 } : null),
  },
  {
    id: 'wpm-thirty-min',
    icon: '🌀',
    title: 'Deep Flow',
    description: 'A 30-minute single-session flow.',
    kind: 'sessionMs',
    target: 30 * 60_000,
    check: (_stats, _days, extra) => ((extra?.longestSingleSessionMs || 0) >= 30 * 60_000 ? { unlockedAt: 0 } : null),
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

  const level = getReaderLevel(stats.totalWords || 0);
  const dailyGoal = getDailyQuestTarget(level.level);
  const wordsToday = stats.wordsToday || 0;
  const dailyPercent = Math.min(100, Math.round((wordsToday / dailyGoal) * 100));

  return {
    stats,
    days,
    dailyGoal,
    dailyPercent,
    wordsToDailyGoal: Math.max(0, dailyGoal - wordsToday),
    level,
    achievements,
    badges,
    unlockedCount: unlockedIds.size,
    totalBadgeCount: ACHIEVEMENTS.length,
    rewards: {
      unlockedIds: unlockedRewardIds({
        level: level.level,
        currentStreak: stats.currentStreak,
        bestStreak: stats.bestStreak,
      }),
      themes: THEMES,
      icons: APP_ICONS,
      titles: TITLES,
    },
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

/**
 * Compute which reward/achievement ids are NEWLY unlocked given the prior
 * state. Used to fire toasts after each reading event flush.
 */
export function diffUnlocks(prev = {}, next = {}) {
  const newly = { rewards: [], achievements: [], level: null };
  const prevRewards = new Set(prev.rewardIds || []);
  for (const id of (next.rewardIds || [])) if (!prevRewards.has(id)) newly.rewards.push(id);
  const prevAch = new Set(prev.achievementIds || []);
  for (const id of (next.achievementIds || [])) if (!prevAch.has(id)) newly.achievements.push(id);
  if (prev.level != null && next.level != null && next.level > prev.level) {
    newly.level = next.level;
  }
  return newly;
}

/**
 * Snapshot of unlock state suitable for persistence. Persist this and feed it
 * to diffUnlocks() on the next flush.
 */
export function snapshotUnlockState(summary) {
  return {
    rewardIds: summary?.rewards?.unlockedIds || [],
    achievementIds: (summary?.achievements || []).map((a) => a.id),
    level: summary?.level?.level || 1,
  };
}
