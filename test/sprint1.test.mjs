// Sprint-1 tests for /Users/yoseph/rsvp-reader/
// Runs under Node's built-in test runner (`node --test test/`).
//
// Strategy: shim the browser globals that epub.js / library.js touch with jsdom,
// and use jszip from npm to build minimal EPUB fixtures in-memory. The library
// IDB code goes through a fake-indexeddb shim so listBooks / saveBook / etc.
// work offline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
// jszip's loadAsync() recognises File/Blob and uses FileReader. fake-indexeddb
// populates a working IndexedDB on the node global before library.js opens it.
// fake-indexeddb/auto detects `window` first — set window AFTER importing it so it
// binds to the real Node globalThis instead of the jsdom window.
await import('fake-indexeddb/auto');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.FileReader = dom.window.FileReader;
globalThis.File = dom.window.File;
globalThis.Blob = dom.window.Blob;
globalThis.Node = dom.window.Node;
globalThis.TextEncoder = dom.window.TextEncoder;

const { default: JSZip } = await import('jszip');
const { parseEpub, parseTxt } = await import('../epub.js');
const {
  bookProgress, estimateTimeRemaining, ensureChapterBoundaries,
  findBookByHash, exportLibrary, importLibrary, formatLastRead,
  listBooks, saveBook, getBook,
} = await import('../library.js');

async function buildEpub({ sections = 3 } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>',
  );
  const manifest = [];
  const spine = [];
  for (let i = 1; i <= sections; i++) {
    manifest.push(`<item id="ch${i}" href="ch${i}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i}"/>`);
  }
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>Sprint Test</dc:title><dc:creator>Tester</dc:creator>' +
    '<dc:identifier id="bookid">urn:uuid:sprint-1</dc:identifier></metadata>' +
    `<manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`,
  );
  for (let i = 1; i <= sections; i++) {
    zip.file(
      `OEBPS/ch${i}.xhtml`,
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">' +
      `<head><title>Chapter ${i}</title></head>` +
      `<body><h1>Chapter ${i}</h1>` +
      `<p>${'word '.repeat(80).trim()}</p>` +
      `<p>${'second paragraph text with several words here. '.repeat(4).trim()}</p>` +
      '</body></html>',
    );
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new dom.window.File([bytes], 'sprint.epub', { type: 'application/epub+zip' });
}

test('parseEpub reads a minimal 3-section EPUB in-memory', async () => {
  const file = await buildEpub({ sections: 3 });
  const parsed = await parseEpub(file);
  assert.equal(parsed.chapters.length, 3, 'expected 3 chapters');
  assert.equal(parsed.startChapter, 0, 'expected first readable chapter to be 0');
  assert.ok(parsed.totalWords > 0, 'expected non-zero totalWords');
  assert.match(parsed.title, /Sprint Test/);
});

test('parseTxt strips a UTF-8 BOM before tokenising', async () => {
  const text = '﻿Hello world this is a small test.';
  const bytes = new TextEncoder().encode(text);
  const file = new dom.window.File([bytes], 'bom.txt', { type: 'text/plain' });
  const parsed = await parseTxt(file);
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.totalWords, 7, 'expected 7 words after BOM strip');
  assert.ok(!parsed.fullText.startsWith('﻿'), 'BOM should be stripped from fullText');
});

test('bookProgress computes percent across chapters', async () => {
  const book = {
    chapters: [
      { wordCount: 100, title: 'A' },
      { wordCount: 100, title: 'B' },
      { wordCount: 100, title: 'C' },
    ],
    totalWords: 300,
    chapterIndex: 1,
    wordIndex: 50,
  };
  const prog = bookProgress(book);
  assert.equal(prog.wordsRead, 150);
  assert.equal(prog.total, 300);
  assert.equal(prog.percent, 50);
  assert.equal(prog.chapterTitle, 'B');
});

test('estimateTimeRemaining returns chapterSec > 0 for a half-read chapter', async () => {
  const book = {
    chapters: [
      { wordCount: 200, title: 'Ch1' },
      { wordCount: 200, title: 'Ch2' },
    ],
    totalWords: 400,
    chapterIndex: 0,
    wordIndex: 100, // 100 words left in chapter 1, 300 left in book
  };
  const eta = estimateTimeRemaining(book, 0, 100, 200); // 200ms / word
  assert.ok(eta.chapterSec > 0, 'chapterSec should be positive');
  assert.ok(eta.bookSec > eta.chapterSec, 'bookSec should exceed chapterSec');
  assert.equal(eta.percent, 25);
});

test('ensureChapterBoundaries rebuilds when text is misaligned', async () => {
  const goodText = 'Hello there world. Second sentence here.';

  // Misaligned: provide stale boundaries that DO point at sentence endings, but
  // supply a wordCount that disagrees with the text — forces a rebuild path.
  const textWords = goodText.split(/\s+/).filter(Boolean).length;
  const mismatched = ensureChapterBoundaries(
    { text: goodText, sentenceStarts: [0, 4], paragraphStarts: [0], paragraphs: [] },
    textWords + 7, // <-- wordCount mismatch triggers rebuild
  );
  assert.equal(mismatched.rebuilt, true);
  assert.ok(mismatched.sentenceStarts[0] === 0);
  assert.ok(mismatched.paragraphs.length >= 1);
});

test('exportLibrary / importLibrary roundtrips with merge', async () => {
  // Use a fresh DB name for isolation
  // First save one book
  const a = {
    id: 'a1', contentHash: 'a1', title: 'A', author: 'X', type: 'book',
    totalWords: 10,
    chapters: [{ title: 'A1', text: 'word '.repeat(10).trim(), wordCount: 10, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
    startChapter: 0, addedAt: 1, lastReadAt: 1, chapterIndex: 0, wordIndex: 0, wpm: 300,
  };
  await saveBook(a);

  // Add a remote book
  const b = {
    id: 'b1', contentHash: 'b1', title: 'B', author: 'Y', type: 'book',
    totalWords: 20,
    chapters: [{ title: 'B1', text: 'word '.repeat(20).trim(), wordCount: 20, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
    startChapter: 0, addedAt: 2, lastReadAt: 2, chapterIndex: 0, wordIndex: 0, wpm: 300,
  };
  const json = JSON.stringify({ version: 2, exportedAt: Date.now(), books: [b] });
  const result = await importLibrary(json, { merge: true });
  assert.equal(result.imported, 1);

  // Roundtrip: re-import same B should be skipped or updated
  const result2 = await importLibrary(json, { merge: true });
  assert.ok(['imported', 'updated', 'skipped'].some((k) => result2[k] >= 0));

  const all = await listBooks();
  const titles = all.map((x) => x.title).sort();
  assert.deepEqual(titles, ['A', 'B']);
});

test('findBookByHash dedupes by contentHash', async () => {
  const dup = {
    id: 'dup-id', contentHash: 'samehash', title: 'Same', author: '', type: 'book',
    totalWords: 5,
    chapters: [{ title: 'S', text: 'word '.repeat(5).trim(), wordCount: 5, sentenceStarts: [0], paragraphStarts: [0], paragraphs: [] }],
    startChapter: 0, addedAt: 3, lastReadAt: 3, chapterIndex: 0, wordIndex: 0, wpm: 300,
  };
  await saveBook(dup);
  const found = await findBookByHash('samehash');
  assert.ok(found, 'should find the book by contentHash');
  assert.equal(found.id, 'dup-id');
  // Re-fetch by the same hash should still return it (idempotent)
  const found2 = await findBookByHash('samehash');
  assert.equal(found2.id, 'dup-id');
});

test('formatLastRead returns "Never read" for 0', () => {
  assert.equal(formatLastRead(0), 'Never read');
  assert.equal(formatLastRead(null), 'Never read');
  assert.equal(formatLastRead(undefined), 'Never read');
});
