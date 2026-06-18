#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/fix-summary-counts.mjs <file.json> ...');
  process.exit(1);
}

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

for (const file of files) {
  const p = path.resolve(file);
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let total = 0;
  for (const ch of book.chapters) total += (ch.wordCount = wordCount(ch.text));
  book.totalWords = total;
  fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  console.log(path.basename(p), total);
}