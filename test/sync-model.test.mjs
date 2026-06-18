// Tests for sync-model.js — pure merge functions for cross-device progress.
// Runs under Node's built-in test runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absoluteWordIndex,
  buildAccountSnapshot,
  parseAccountSnapshot,
  mergeAccountSnapshot,
  resolveProgressConflict,
  normalizeProgress,
  validateSnapshotShape,
  getOrCreateDeviceId,
  SNAPSHOT_VERSION,
} from '../sync-model.js';

// Test helpers
function makeBook(overrides = {}) {
  return {
    id: 'h1',
    contentHash: 'h1',
    title: 'Test',
    author: 'Tester',
    fileName: 't.epub',
    type: 'book',
    totalWords: 300,
    chapters: [
      { title: 'Ch1', text: 'word '.repeat(100).trim(), wordCount: 100, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] },
      { title: 'Ch2', text: 'word '.repeat(100).trim(), wordCount: 100, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] },
      { title: 'Ch3', text: 'word '.repeat(100).trim(), wordCount: 100, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] },
    ],
    startChapter: 0,
    addedAt: 1,
    lastReadAt: 1,
    chapterIndex: 0,
    wordIndex: 0,
    wpm: 300,
    ...overrides,
  };
}

function makeRemoteBook(overrides = {}) {
  return {
    cloudBookId: 'hash:h1',
    contentHash: 'h1',
    title: 'Test',
    author: 'Tester',
    fileName: 't.epub',
    totalWords: 300,
    chapterCount: 3,
    hasLocalContent: true,
    progress: {
      chapterIndex: 0,
      wordIndex: 0,
      absoluteWordIndex: 0,
      wpm: 300,
      updatedAt: 1000,
      deviceId: 'dev_other',
    },
    ...overrides,
  };
}

test('absoluteWordIndex sums chapter wordCounts', () => {
  const book = makeBook();
  assert.equal(absoluteWordIndex(book, 0, 5), 5);
  assert.equal(absoluteWordIndex(book, 1, 0), 100);
  assert.equal(absoluteWordIndex(book, 2, 50), 250);
  assert.equal(absoluteWordIndex(book, 5, 5), 305); // clamps to last chapter
});

test('resolveProgressConflict picks newer when timestamps differ', () => {
  const local = normalizeProgress({ chapterIndex: 0, wordIndex: 5, updatedAt: 1000 }, makeBook(), 'd1');
  const remote = normalizeProgress({ chapterIndex: 1, wordIndex: 0, updatedAt: 5000 }, makeBook(), 'd2');
  const winner = resolveProgressConflict(local, remote);
  assert.equal(winner.updatedAt, 5000);
  assert.equal(winner.chapterIndex, 1);
});

test('resolveProgressConflict within window picks furthest absolute word', () => {
  const local = normalizeProgress({ chapterIndex: 0, wordIndex: 80, updatedAt: 1000 }, makeBook(), 'd1');
  const remote = normalizeProgress({ chapterIndex: 1, wordIndex: 5, updatedAt: 1500 }, makeBook(), 'd2');
  // 80 vs 105 absolute → remote wins (further)
  const winner = resolveProgressConflict(local, remote);
  assert.equal(winner.absoluteWordIndex, 105);
  assert.equal(winner.chapterIndex, 1);
});

test('resolveProgressConflict local wins on tie', () => {
  const local = normalizeProgress({ chapterIndex: 0, wordIndex: 50, updatedAt: 1000 }, makeBook(), 'd1');
  const remote = normalizeProgress({ chapterIndex: 0, wordIndex: 50, updatedAt: 1000 }, makeBook(), 'd2');
  const winner = resolveProgressConflict(local, remote);
  assert.equal(winner.deviceId, 'd1');
});

test('mergeAccountSnapshot: remote progress newer advances local', () => {
  const local = [makeBook({ lastReadAt: 100, chapterIndex: 0, wordIndex: 10, progressUpdatedAt: 100 })];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 2000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h1',
      contentHash: 'h1',
      title: 'Test',
      totalWords: 300,
      chapterCount: 3,
      hasLocalContent: true,
      progress: { chapterIndex: 2, wordIndex: 50, wpm: 400, updatedAt: 2000, deviceId: 'dev_b' },
    }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books[0].chapterIndex, 2);
  assert.equal(result.books[0].wordIndex, 50);
  assert.equal(result.books[0].wpm, 400);
  assert.ok(result.books[0].lastSyncedFromDeviceId === 'dev_b');
});

test('mergeAccountSnapshot: local progress newer does not regress', () => {
  const local = [makeBook({ lastReadAt: 5000, chapterIndex: 2, wordIndex: 80, progressUpdatedAt: 5000, wpm: 350 })];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 2000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h1',
      contentHash: 'h1',
      title: 'Test',
      totalWords: 300,
      chapterCount: 3,
      hasLocalContent: true,
      progress: { chapterIndex: 1, wordIndex: 0, wpm: 300, updatedAt: 1000, deviceId: 'dev_b' },
    }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books[0].chapterIndex, 2);
  assert.equal(result.books[0].wordIndex, 80);
  assert.equal(result.books[0].wpm, 350);
});

test('mergeAccountSnapshot: near-equal timestamps pick furthest progress', () => {
  const local = [makeBook({ lastReadAt: 1000, chapterIndex: 0, wordIndex: 50, progressUpdatedAt: 1000 })];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 1000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h1',
      contentHash: 'h1',
      title: 'Test',
      totalWords: 300,
      chapterCount: 3,
      hasLocalContent: true,
      progress: { chapterIndex: 1, wordIndex: 20, wpm: 300, updatedAt: 1500, deviceId: 'dev_b' },
    }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  // remote 120 > local 50 → remote wins
  assert.equal(result.books[0].chapterIndex, 1);
  assert.equal(result.books[0].wordIndex, 20);
  assert.equal(result.conflicts.length, 1);
});

test('mergeAccountSnapshot: local content attaches to remote placeholder', () => {
  const local = [makeBook({ lastReadAt: 100, chapterIndex: 1, wordIndex: 0, progressUpdatedAt: 100 })];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 2000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h1',
      contentHash: 'h1',
      title: 'Test',
      totalWords: 300,
      chapterCount: 3,
      hasLocalContent: false, // placeholder
      progress: { chapterIndex: 2, wordIndex: 30, wpm: 380, updatedAt: 2000, deviceId: 'dev_b' },
    }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books[0].chapterIndex, 2);
  assert.equal(result.books[0].wordIndex, 30);
  assert.equal(result.books[0].wpm, 380);
  // local still has content
  assert.equal(result.books[0].chapters.length, 3);
});

test('mergeAccountSnapshot: remote-only placeholder creates local placeholder', () => {
  const local = [];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 2000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h1',
      contentHash: 'h1',
      title: 'Placeholder Book',
      author: 'Someone',
      totalWords: 5000,
      chapterCount: 7,
      hasLocalContent: false,
      progress: { chapterIndex: 3, wordIndex: 100, wpm: 360, updatedAt: 2000, deviceId: 'dev_b' },
    }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].isCloudPlaceholder, true);
  assert.equal(result.books[0].needsReupload, true);
  assert.equal(result.books[0].title, 'Placeholder Book');
  assert.equal(result.books[0].chapterIndex, 3);
  assert.equal(result.books[0].chapters.length, 0);
  assert.equal(result.placeholders, 1);
});

test('mergeAccountSnapshot: missing remote book does NOT delete local', () => {
  const local = [makeBook()];
  const remote = parseAccountSnapshot({ version: 3, exportedAt: 1000, deviceId: 'dev_b', books: [] });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books.length, 1, 'local book should be preserved');
  assert.equal(result.deleted, 0);
});

test('mergeAccountSnapshot: tombstone deletes local book', () => {
  const local = [makeBook({ contentHash: 'h1' })];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 1000,
    deviceId: 'dev_b',
    books: [],
    tombstones: ['h1'],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  assert.equal(result.books.length, 0);
  assert.equal(result.deleted, 1);
});

test('parseAccountSnapshot accepts legacy v2 export', () => {
  const v2 = {
    version: 2,
    exportedAt: 1000,
    books: [{
      id: 'h1',
      contentHash: 'h1',
      title: 'Legacy',
      chapters: [{ wordCount: 50, text: 'a '.repeat(50).trim() }],
      lastReadAt: 2000,
    }],
  };
  const snap = parseAccountSnapshot(v2);
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.books.length, 1);
  assert.equal(snap.books[0].hasLocalContent, true);
  assert.equal(snap.books[0].progress.updatedAt, 2000);
});

test('buildAccountSnapshot omits chapter text', () => {
  const books = [makeBook()];
  const snap = buildAccountSnapshot(books, { deviceId: 'dev_a' });
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.books.length, 1);
  assert.equal(snap.books[0].hasLocalContent, true);
  assert.equal(snap.books[0].cloudBookId, 'hash:h1');
  // No chapter text in the snapshot
  assert.equal(snap.books[0].text, undefined);
  assert.equal(snap.books[0].chapters, undefined);
  // But metadata is preserved
  assert.equal(snap.books[0].title, 'Test');
  assert.equal(snap.books[0].totalWords, 300);
});

test('buildAccountSnapshot marks placeholder for content-less book', () => {
  const placeholder = makeBook({ chapters: [], totalWords: 0 });
  const snap = buildAccountSnapshot([placeholder], { deviceId: 'dev_a' });
  assert.equal(snap.books[0].hasLocalContent, false);
  assert.equal(snap.books[0].totalWords, 0);
});

test('validateSnapshotShape rejects bad payload', () => {
  assert.equal(validateSnapshotShape(null), 'payload must be an object');
  assert.equal(validateSnapshotShape({}), 'unsupported version undefined');
  assert.equal(validateSnapshotShape({ version: 99 }), 'unsupported version 99');
  assert.equal(validateSnapshotShape({ version: 3, books: 'nope' }), 'books must be an array');
  assert.equal(validateSnapshotShape({ version: 2, books: [] }), null);
  assert.equal(validateSnapshotShape({ version: 3, books: [] }), null);
});

test('getOrCreateDeviceId returns stable id from storage shim', () => {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  const id1 = getOrCreateDeviceId(shim);
  const id2 = getOrCreateDeviceId(shim);
  assert.ok(id1);
  assert.equal(id1, id2);
  assert.ok(id1.startsWith('dev_'));
});

test('getOrCreateDeviceId returns null without storage', () => {
  assert.equal(getOrCreateDeviceId(null), null);
});

test('mergeAccountSnapshot: two books, one new, one existing, one tombstoned', () => {
  const local = [
    makeBook({ contentHash: 'h1' }),
    makeBook({ id: 'h2', contentHash: 'h2', title: 'Two', lastReadAt: 5 }),
  ];
  const remote = parseAccountSnapshot({
    version: 3,
    exportedAt: 2000,
    deviceId: 'dev_b',
    books: [{
      cloudBookId: 'hash:h3',
      contentHash: 'h3',
      title: 'Three',
      totalWords: 100,
      chapterCount: 1,
      hasLocalContent: true,
      progress: { chapterIndex: 0, wordIndex: 0, wpm: 300, updatedAt: 1000, deviceId: 'dev_b' },
    }],
    tombstones: [{ contentHash: 'h2' }],
  });
  const result = mergeAccountSnapshot(local, remote, { deviceId: 'dev_a' });
  const hashes = result.books.map((b) => b.contentHash).sort();
  assert.deepEqual(hashes, ['h1', 'h3']);
  assert.equal(result.deleted, 1);
  // h3 had no local match → becomes a cloud placeholder
  assert.equal(result.placeholders, 1);
  const placeholder = result.books.find((b) => b.contentHash === 'h3');
  assert.equal(placeholder.isCloudPlaceholder, true);
});
