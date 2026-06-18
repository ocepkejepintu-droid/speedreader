#!/usr/bin/env node
/** Validate rewritten summary JSON files. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');

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

function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

const files = fs.readdirSync(DATA)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const issues = [];
let ok = 0;
let rewritten = 0;

for (const file of files) {
  const p = path.join(DATA, file);
  let book;
  try {
    book = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    issues.push({ file, error: `invalid JSON: ${e.message}` });
    continue;
  }

  if (book.source === 'rsvp-original') rewritten++;

  if (!book.id || !book.title || !Array.isArray(book.chapters) || !book.chapters.length) {
    issues.push({ file, error: 'missing id/title/chapters' });
    continue;
  }

  let total = 0;
  for (const [i, ch] of book.chapters.entries()) {
    if (!ch.title?.trim() || !ch.text?.trim()) {
      issues.push({ file, error: `empty chapter ${i}` });
    }
    const wc = wordCount(ch.text);
    if (ch.wordCount && Math.abs(ch.wordCount - wc) > 5) {
      issues.push({ file, error: `wordCount drift ch${i}: ${ch.wordCount} vs ${wc}` });
    }
    total += wc;

    const backupPath = path.join(BACKUP, file);
    if (fs.existsSync(backupPath) && book.source === 'rsvp-original') {
      const orig = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      const origCh = orig.chapters?.[i];
      if (origCh?.text) {
        const sim = jaccard(tokenize(ch.text), tokenize(origCh.text));
        if (sim > 0.72) {
          issues.push({ file, error: `high similarity ch${i}: ${sim.toFixed(2)}`, severity: 'warn' });
        }
      }
    }
  }

  if (!issues.some((x) => x.file === file)) ok++;
  if (book.totalWords && Math.abs(book.totalWords - total) > 10) {
    issues.push({ file, error: `totalWords drift: ${book.totalWords} vs ${total}`, severity: 'warn' });
  }
}

const hard = issues.filter((x) => x.severity !== 'warn');
const warn = issues.filter((x) => x.severity === 'warn');

console.log(JSON.stringify({
  files: files.length,
  rewritten,
  pending: files.length - rewritten,
  ok,
  hardIssues: hard.length,
  warnings: warn.length,
}, null, 2));

if (hard.length) {
  console.error('\nHard issues (first 20):');
  for (const item of hard.slice(0, 20)) console.error(`- ${item.file}: ${item.error}`);
  process.exit(1);
}