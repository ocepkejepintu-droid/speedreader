// Tests for /Users/yoseph/rsvp-reader/analytics.js
// Runs under Node's built-in test runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEventId,
  buildReadingEvent,
  mergeEvents,
  localDayKey,
  groupEventsByLocalDay,
  aggregateStats,
  checkAchievements,
  summarizeCompletions,
  ACHIEVEMENT_DEFINITIONS,
} from '../analytics.js';

test('makeEventId is stable for the same interval+device+bucket', () => {
  const a = makeEventId({ deviceId: 'd1', contentHash: 'h1', startAbs: 10, endAbs: 20, ts: 1000 });
  const b = makeEventId({ deviceId: 'd1', contentHash: 'h1', startAbs: 10, endAbs: 20, ts: 1500 });
  // 1000/1000 = bucket 1; 1500/1000 = bucket 1; same id
  assert.equal(a, b);
  assert.match(a, /^d1:h1:10:20:1$/);
});

test('buildReadingEvent returns null when no forward progress', () => {
  const e = buildReadingEvent({ deviceId: 'd1', contentHash: 'h1', startAbs: 10, endAbs: 10, wpm: 300, startedAt: 0, endedAt: 1000 });
  assert.equal(e, null);
});

test('buildReadingEvent records wordsRead as end - start', () => {
  const e = buildReadingEvent({ deviceId: 'd1', contentHash: 'h1', startAbs: 0, endAbs: 100, wpm: 300, startedAt: 0, endedAt: 20_000 });
  assert.equal(e.wordsRead, 100);
  assert.equal(e.startAbsoluteWordIndex, 0);
  assert.equal(e.endAbsoluteWordIndex, 100);
  assert.equal(e.wpm, 300);
});

test('mergeEvents dedupes by eventId and sorts by endedAt', () => {
  const local = [
    { eventId: 'e1', endedAt: 2000, wordsRead: 5 },
    { eventId: 'e3', endedAt: 4000, wordsRead: 10 },
  ];
  const remote = [
    { eventId: 'e1', endedAt: 2000, wordsRead: 5 }, // duplicate
    { eventId: 'e2', endedAt: 3000, wordsRead: 7 },
  ];
  const merged = mergeEvents(local, remote);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((e) => e.eventId), ['e1', 'e2', 'e3']);
});

test('localDayKey respects timezone offset', () => {
  // 2024-01-15 00:30 UTC = 2024-01-14 19:30 in UTC-5
  const ts = Date.UTC(2024, 0, 15, 0, 30);
  assert.equal(localDayKey(ts, 0), '2024-01-15');
  assert.equal(localDayKey(ts, 300), '2024-01-14'); // 5h west of UTC
});

test('groupEventsByLocalDay sums words/minutes/books per local day', () => {
  const events = [
    { endedAt: Date.UTC(2024, 0, 15, 1, 0), wordsRead: 100, wpm: 300, contentHash: 'h1' },
    { endedAt: Date.UTC(2024, 0, 15, 2, 0), wordsRead: 200, wpm: 300, contentHash: 'h1' },
    { endedAt: Date.UTC(2024, 0, 15, 3, 0), wordsRead: 50, wpm: 100, contentHash: 'h2' },
  ];
  const days = groupEventsByLocalDay(events, 0);
  assert.equal(days['2024-01-15'].words, 350);
  assert.equal(days['2024-01-15'].bookCount, 2);
  assert.equal(days['2024-01-15'].events, 3);
});

test('aggregateStats computes today/7d/30d and current streak', () => {
  const dayMs = 86_400_000;
  const now = Date.UTC(2024, 0, 30, 12, 0);
  // 3 days of activity leading up to today, no gap
  const events = [
    { endedAt: now - 0 * dayMs, wordsRead: 100, wpm: 300, contentHash: 'h1' },
    { endedAt: now - 1 * dayMs, wordsRead: 200, wpm: 300, contentHash: 'h1' },
    { endedAt: now - 2 * dayMs, wordsRead: 50, wpm: 100, contentHash: 'h2' },
    { endedAt: now - 40 * dayMs, wordsRead: 999, wpm: 300, contentHash: 'h3' }, // outside 30d
  ];
  const stats = aggregateStats(events, { now, tzOffsetMin: 0 });
  assert.equal(stats.wordsToday, 100);
  assert.equal(stats.words7d, 350);
  assert.equal(stats.words30d, 350);
  assert.equal(stats.currentStreak, 3);
  // 3 unique contentHash values across all events, including the >30d one
  assert.equal(stats.booksTouched, 3);
  assert.ok(stats.avgWpm >= 200, `expected avgWpm >= 200, got ${stats.avgWpm}`);
});

test('checkAchievements unlocks first-thousand when any day crosses 1000 words', () => {
  const dayMs = 86_400_000;
  const events = [{ endedAt: 0, wordsRead: 1500, wpm: 300, contentHash: 'h1' }];
  const stats = aggregateStats(events, { now: dayMs, tzOffsetMin: 0 });
  const days = groupEventsByLocalDay(events, 0);
  const unlocks = checkAchievements(stats, days, {}, []);
  const ids = unlocks.map((a) => a.id);
  assert.ok(ids.includes('first-thousand'));
});

test('checkAchievements preserves existing unlocks', () => {
  const days = { '2024-01-15': { words: 2000, minutes: 6, events: 1, bookCount: 1 } };
  const stats = { currentStreak: 10, bestStreak: 10, words7d: 2000 };
  const existing = [{ id: 'first-thousand', title: '1k', description: 'd', unlockedAt: 1 }];
  const out = checkAchievements(stats, days, {}, existing);
  const first = out.find((a) => a.id === 'first-thousand');
  assert.equal(first.unlockedAt, 1, 'should not re-unlock an already-known achievement');
  assert.ok(out.find((a) => a.id === 'streak-7'));
});

test('summarizeCompletions counts books and chapters finished', () => {
  const books = [
    { contentHash: 'h1', totalWords: 100, chapters: [{ wordCount: 50 }, { wordCount: 50 }], chapterIndex: 1, wordIndex: 50 }, // 100% done, 1 chapter done
    { contentHash: 'h2', totalWords: 100, chapters: [{ wordCount: 50 }, { wordCount: 50 }], chapterIndex: 2, wordIndex: 0 }, // past-end done, 2 chapters done
    { contentHash: 'h3', totalWords: 200, chapters: [{ wordCount: 100 }, { wordCount: 100 }], chapterIndex: 1, wordIndex: 10 }, // mid, 1 chapter done
  ];
  const r = summarizeCompletions(books);
  assert.equal(r.booksFinished, 2);
  assert.equal(r.chapterCompletions, 4); // h1: 1, h2: 2, h3: 1
});

test('ACHIEVEMENT_DEFINITIONS covers the seven expected ids', () => {
  const ids = ACHIEVEMENT_DEFINITIONS.map((a) => a.id);
  for (const expected of ['first-thousand', 'streak-7', 'ten-k-week', 'first-chapter', 'first-book', 'two-devices', 'wpm-ten-min']) {
    assert.ok(ids.includes(expected), `missing ${expected}`);
  }
});
