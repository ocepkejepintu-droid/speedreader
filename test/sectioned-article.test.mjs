import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
await import('fake-indexeddb/auto');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.TextEncoder = dom.window.TextEncoder;

const { parseSectionedText, saveArticle, getBook } = await import('../library.js');

test('parseSectionedText returns null for plain text', () => {
  assert.equal(parseSectionedText('Just one paragraph.'), null);
});

test('parseSectionedText splits ## headers into sections', () => {
  const sections = parseSectionedText(`## First idea
Alpha bravo charlie.

## Second idea
Delta echo foxtrot.`);
  assert.equal(sections?.length, 2);
  assert.equal(sections[0].title, 'First idea');
  assert.match(sections[0].text, /Alpha bravo/);
  assert.equal(sections[1].title, 'Second idea');
});

test('saveArticle stores multi-section paste as one book with chapters', async () => {
  const record = await saveArticle({
    title: 'The Art of War',
    author: 'Sun Tzu',
    text: `## Outsmarting the enemy
War strategy consists of wit and deceit.

## Compiling plans
Good planning defines the outcome.`,
  });
  assert.equal(record.chapters.length, 2);
  assert.equal(record.title, 'The Art of War');
  assert.equal(record.author, 'Sun Tzu');
  assert.equal(record.chapters[0].title, 'Outsmarting the enemy');
  assert.equal(record.chapters[1].title, 'Compiling plans');
  assert.ok(record.totalWords > 10);

  const again = await saveArticle({
    title: 'Duplicate',
    text: `## Outsmarting the enemy
War strategy consists of wit and deceit.

## Compiling plans
Good planning defines the outcome.`,
  });
  assert.equal(again.id, record.id);

  const stored = await getBook(record.id);
  assert.equal(stored.chapters.length, 2);
});