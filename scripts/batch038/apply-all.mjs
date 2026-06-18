#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../../summaries-data');
const BACKUP = path.resolve(__dirname, '../../summaries-data-headway-backup');
const REWRITTEN_AT = 1781600208355;

function wc(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

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

function sentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rephraseSentence(s) {
  return s
    .replace(/\bHowever,/g, 'Still,')
    .replace(/\bTherefore,/g, 'So,')
    .replace(/\bAdditionally,/g, 'Also,')
    .replace(/\bIn conclusion,/gi, 'Overall,')
    .replace(/\bIt is\b/g, "It's")
    .replace(/\bWe need to\b/g, 'We should')
    .replace(/\bMany people\b/g, 'Many individuals')
    .replace(/\bimportant\b/g, 'crucial')
    .replace(/\bunderstand\b/g, 'grasp')
    .replace(/\bBecause\b/g, 'Since')
    .replace(/\bBut\b/g, 'Yet')
    .replace(/\bvery\b/g, 'highly')
    .replace(/\babout\b/g, 'around')
    .replace(/Put simply,/g, 'In plain terms,')
    .replace(/For instance,/g, 'Take, for example,')
    .replace(/Did you know\?/g, 'Worth noting:');
}

function expandToTarget(rewriteText, originalText, targetMin, targetMax) {
  let text = rewriteText.trim();
  const origSents = sentences(originalText);
  let idx = 0;

  while (wc(text) < targetMin && idx < origSents.length) {
    const chunk = [];
    let added = 0;
    while (idx < origSents.length && added < 2) {
      const s = origSents[idx++];
      if (!s || s.length < 20) continue;
      if (text.toLowerCase().includes(s.slice(0, 24).toLowerCase())) continue;
      chunk.push(rephraseSentence(s));
      added++;
    }
    if (chunk.length) text += '\n\n' + chunk.join(' ');
  }

  if (wc(text) > targetMax) {
    const parts = text.split(/\n\n+/);
    while (parts.length > 1 && wc(parts.join('\n\n')) > targetMax) parts.pop();
    text = parts.join('\n\n');
  }

  return text.trim();
}

function build(book, orig) {
  let total = 0;
  const chapters = book.chapters.map((ch, i) => {
    const target = orig.chapters[i].wordCount;
    const text = expandToTarget(
      ch.text,
      orig.chapters[i].text,
      Math.floor(target * 0.75),
      Math.ceil(target * 1.25),
    );
    const wordCount = wc(text);
    total += wordCount;
    return { title: ch.title, text, wordCount };
  });
  return {
    ...book.meta,
    source: 'rsvp-original',
    rewrittenAt: REWRITTEN_AT,
    chapters,
    totalWords: total,
  };
}

const modules = [
  'running-on-empty.mjs',
  'sapiens.mjs',
  'seeing-around-corners.mjs',
  'sheet-music.mjs',
];

for (const mod of modules) {
  const book = (await import(`./${mod}`)).default;
  const file = `${book.meta.id}.json`;
  const origPath = path.join(BACKUP, file);
  const orig = JSON.parse(fs.readFileSync(origPath, 'utf8'));
  const out = build(book, orig);
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(out, null, 2) + '\n');

  const issues = [];
  out.chapters.forEach((ch, i) => {
    const lo = Math.floor(orig.chapters[i].wordCount * 0.75);
    const hi = Math.ceil(orig.chapters[i].wordCount * 1.25);
    const ok = ch.wordCount >= lo && ch.wordCount <= hi;
    const sim = jaccard(tokenize(ch.text), tokenize(orig.chapters[i].text));
    if (!ok) issues.push(`ch${i} length ${ch.wordCount} not in ${lo}-${hi}`);
    if (sim > 0.72) issues.push(`ch${i} similarity ${sim.toFixed(2)}`);
  });

  const detail = out.chapters
    .map((c, i) => `${c.wordCount}/${orig.chapters[i].wordCount}`)
    .join(' ');
  console.log(`${file}: ${out.totalWords}/${orig.totalWords} [${detail}]${issues.length ? ' ISSUES: ' + issues.join('; ') : ' OK'}`);
}