// v1.1 batch tests for /Users/yoseph/rsvp-reader/
// Covers: weekly breakdown, OPML export, bookmarklet page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
await import('fake-indexeddb/auto');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.FileReader = dom.window.FileReader;
globalThis.File = dom.window.File;
globalThis.Blob = dom.window.Blob;
globalThis.Node = dom.window.Node;
globalThis.TextEncoder = dom.window.TextEncoder;
globalThis.localStorage = dom.window.localStorage;
try { Object.defineProperty(globalThis, 'crypto', { value: dom.window.crypto || (await import('node:crypto')).webcrypto, configurable: true }); } catch { /* already defined */ }

// Use a fresh storage slot per test by clearing the completion key.
function clearCompletions() {
  globalThis.localStorage.removeItem('rsvp-completions');
}
function setCompletions(arr) {
  globalThis.localStorage.setItem('rsvp-completions', JSON.stringify(arr));
}

const { getWeeklyBreakdown } = await import('../reader-app.js?weekly=1');
const { exportOpml, saveBook, listBooks } = await import('../library.js?opml=1');

test('getWeeklyBreakdown returns [] when completions are empty', () => {
  clearCompletions();
  const out = getWeeklyBreakdown();
  assert.deepEqual(out, []);
});

test('getWeeklyBreakdown groups by book, sums words and minutes, sorts by minutes desc', () => {
  const now = Date.now();
  setCompletions([
    // Book A: two chapters, total 1200 words at 300wpm => 4 min
    { t: now - 1000, b: 'bookA', ch: 0, wpm: 300, words: 600 },
    { t: now - 2000, b: 'bookA', ch: 1, wpm: 300, words: 600 },
    // Book B: one chapter, 900 words at 300wpm => 3 min
    { t: now - 3000, b: 'bookB', ch: 0, wpm: 300, words: 900 },
  ]);
  const out = getWeeklyBreakdown();
  assert.equal(out.length, 2, 'expected two books');
  assert.equal(out[0].bookId, 'bookA', 'bookA (more minutes) should be first');
  assert.equal(out[0].chapters, 2);
  assert.equal(out[0].words, 1200);
  assert.equal(out[0].minutes, 4);
  assert.equal(out[1].bookId, 'bookB');
  assert.equal(out[1].chapters, 1);
  assert.equal(out[1].words, 900);
  assert.equal(out[1].minutes, 3);
});

test('getWeeklyBreakdown filters out events older than 7 days', () => {
  const day = 86400000;
  const now = Date.now();
  setCompletions([
    { t: now - 1 * day, b: 'fresh', ch: 0, wpm: 300, words: 300 },
    { t: now - 8 * day, b: 'stale', ch: 0, wpm: 300, words: 300 },
    { t: now - 30 * day, b: 'ancient', ch: 0, wpm: 300, words: 300 },
  ]);
  const out = getWeeklyBreakdown();
  assert.equal(out.length, 1);
  assert.equal(out[0].bookId, 'fresh');
});

test('exportOpml returns valid OPML with opml/head/body tags', async () => {
  // Two-book library
  await saveBook({
    id: 'opml-book-1', contentHash: 'opml-book-1', title: 'Atlas Shrugged', author: 'Ayn Rand', type: 'book',
    totalWords: 100,
    chapters: [{ title: 'Ch1', text: 'word '.repeat(100).trim(), wordCount: 100, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
  }, { chapterIndex: 0, wordIndex: 0, wpm: 300 });
  await saveBook({
    id: 'opml-book-2', contentHash: 'opml-book-2', title: 'Sapiens', author: 'Yuval Noah Harari', type: 'book',
    totalWords: 100,
    chapters: [{ title: 'Ch1', text: 'word '.repeat(100).trim(), wordCount: 100, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
  }, { chapterIndex: 0, wordIndex: 0, wpm: 300 });

  const xml = await exportOpml();
  assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<opml version="2\.0">/);
  assert.match(xml, /<head>/);
  assert.match(xml, /<\/head>/);
  assert.match(xml, /<body>/);
  assert.match(xml, /<\/body>/);
  assert.match(xml, /<\/opml>/);
  assert.match(xml, /text="Atlas Shrugged"/);
  assert.match(xml, /author="Ayn Rand"/);
  assert.match(xml, /text="Sapiens"/);
  assert.match(xml, /author="Yuval Noah Harari"/);
});

test('exportOpml escapes <, &, > in titles', async () => {
  // Wipe the DB so the test isn't polluted by the previous saveBook calls.
  // Save a book with a hostile title.
  await saveBook({
    id: 'escape-book-1', contentHash: 'escape-book-1', title: 'Tom & Jerry <3 > Adventures', author: 'A & B', type: 'book',
    totalWords: 10,
    chapters: [{ title: 'Ch1', text: 'word '.repeat(10).trim(), wordCount: 10, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
  }, { chapterIndex: 0, wordIndex: 0, wpm: 300 });
  const xml = await exportOpml();
  assert.match(xml, /text="Tom &amp; Jerry &lt;3 &gt; Adventures"/);
  assert.match(xml, /author="A &amp; B"/);
  // Ensure the raw unescaped form does not appear in attribute position.
  assert.ok(!/text="Tom & Jerry/.test(xml), 'unescaped & must not appear');
  assert.ok(!/text="[^"]*<3[^"]*"/.test(xml), 'unescaped < must not appear');
});

test('bookmarklet.html exists and contains the literal fetch URL', () => {
  assert.ok(existsSync('/Users/yoseph/rsvp-reader/bookmarklet.html'));
  const html = readFileSync('/Users/yoseph/rsvp-reader/bookmarklet.html', 'utf8');
  assert.match(html, /https:\/\/zipang\.id\/rsvp\/share/);
});

test("bookmarklet.html's href contains shareSource 'bookmarklet'", () => {
  const html = readFileSync('/Users/yoseph/rsvp-reader/bookmarklet.html', 'utf8');
  const m = html.match(/<a[^>]+id="bm"[^>]+href="([^"]+)"/);
  assert.ok(m, 'expected an anchor with id="bm" and an href attribute');
  const href = m[1];
  assert.ok(href.includes("shareSource:'bookmarklet'"), 'href must include shareSource:bookmarklet');
  assert.ok(href.length < 2000, `bookmarklet href is ${href.length} chars (must be < 2000)`);
});
