#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { batch059 } from './batch-059-content.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const rewrittenAt = Date.now();

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function buildBook({ base, chapters }) {
  let totalWords = 0;
  const chs = chapters.map((ch) => {
    const wc = wordCount(ch.text);
    totalWords += wc;
    return { title: ch.title, text: ch.text, wordCount: wc };
  });
  return {
    ...base,
    source: 'rsvp-original',
    rewrittenAt,
    chapters: chs,
    totalWords,
  };
}

for (const [file, spec] of Object.entries(batch059)) {
  const book = buildBook(spec);
  const out = path.join(DATA, file);
  fs.writeFileSync(out, JSON.stringify(book, null, 2) + '\n');
  console.log(`Wrote ${file}: ${book.chapters.length} chapters, ${book.totalWords} words`);
}

console.log(`rewrittenAt: ${rewrittenAt}`);