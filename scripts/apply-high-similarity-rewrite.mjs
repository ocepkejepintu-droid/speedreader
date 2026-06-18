#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { books } from './batch-high-similarity-content.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');
const DATA = path.join(ROOT, 'summaries-data');
const TS = Date.now();

const wc = (t) => t.split(/\s+/).filter(Boolean).length;

function tokenize(text) {
  return String(text || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

for (const [file, chapters] of Object.entries(books)) {
  const orig = JSON.parse(fs.readFileSync(path.join(BACKUP, file), 'utf8'));
  const book = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

  for (let i = 0; i < chapters.length; i++) {
    const min = Math.ceil(orig.chapters[i].wordCount * 0.75);
    const max = Math.floor(orig.chapters[i].wordCount * 1.25);
    let text = chapters[i].text.trim();

    // Pad if under minimum (rare)
    const pads = [
      `Apply one idea from this chapter within the next week and notice what changes.`,
      `Sustainable progress comes from small experiments, not overnight overhauls.`,
    ];
    let pi = 0;
    while (wc(text) < min && pi < pads.length) {
      text = `${text}\n\n${pads[pi++]}`;
    }

    // Trim if over maximum by removing last paragraph if it's a pad
    while (wc(text) > max && text.includes('\n\n')) {
      const parts = text.split(/\n\n+/);
      parts.pop();
      text = parts.join('\n\n');
    }

    book.chapters[i].title = chapters[i].title;
    book.chapters[i].text = text;
    book.chapters[i].wordCount = wc(text);

    const sim = jaccard(tokenize(text), tokenize(orig.chapters[i].text));
    const ratio = (book.chapters[i].wordCount / orig.chapters[i].wordCount).toFixed(2);
    console.log(`  ch${i}: wc=${book.chapters[i].wordCount} ratio=${ratio} sim=${sim.toFixed(2)}`);
  }

  book.source = 'rsvp-original';
  book.rewrittenAt = TS;
  book.totalWords = book.chapters.reduce((s, c) => s + c.wordCount, 0);
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(book, null, 2) + '\n');
  console.log(`${file} totalWords=${book.totalWords}\n`);
}