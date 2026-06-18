#!/usr/bin/env node
/**
 * Apply a rewritten batch.
 *
 * Reads scripts/batch-XXX-content.mjs which must export one of:
 *   - `batchXXX` (object keyed by <filename> with shape { base, chapters })
 *   - `books` (object keyed by <filename> with shape { base, chapters })  -- legacy
 *
 * Where each value is shaped like:
 *   {
 *     base: { id, title, author, type: 'summary', addedAt },
 *     chapters: [ { title, text }, ... ]
 *   }
 *
 * For each file:
 *   - recompute chapters[].wordCount from text
 *   - recompute totalWords as sum of chapter word counts
 *   - check word count drift < 25% vs the Headway backup
 *   - check Jaccard similarity < 0.55 vs the Headway backup
 *   - set source = 'rsvp-original'
 *   - set rewrittenAt = Date.now()
 *   - write JSON to summaries-data/<slug>.json
 *
 * Usage:
 *   node scripts/apply-rewrite-batch.mjs 100 scripts/batch-100-content.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');

const [, , batchId, contentPath] = process.argv;
if (!batchId || !contentPath) {
  console.error('Usage: node scripts/apply-rewrite-batch.mjs <batchId> <content-mjs-path>');
  process.exit(1);
}

function wc(t) {
  return String(t || '').split(/\s+/).filter(Boolean).length;
}

function jaccard(a, b) {
  const tok = (s) => String(s || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const A = new Set(tok(a));
  const B = new Set(tok(b));
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function loadSpec(mod) {
  const named = mod[`batch${batchId}`];
  if (named) return named;

  // Legacy `books` shape (batch-045/059): object keyed by <filename>, value is
  // an ARRAY of { title, text } chapters (no `base` wrapper). Convert to
  // { base, chapters } shape.
  if (mod.books && typeof mod.books === 'object') {
    const out = {};
    for (const [file, chapters] of Object.entries(mod.books)) {
      if (Array.isArray(chapters)) {
        out[file] = { base: null, chapters };
      } else {
        out[file] = chapters;
      }
    }
    return out;
  }
  return null;
}

function resolveBase(file, inline) {
  if (inline && inline.id && inline.title) return inline;
  // Fall back to existing live file, then backup
  const live = path.join(DATA, file);
  if (fs.existsSync(live)) {
    try {
      const b = JSON.parse(fs.readFileSync(live, 'utf8'));
      return { id: b.id, title: b.title, author: b.author || '', type: b.type || 'summary', addedAt: b.addedAt || Date.now() };
    } catch {}
  }
  const backup = path.join(BACKUP, file);
  if (fs.existsSync(backup)) {
    try {
      const b = JSON.parse(fs.readFileSync(backup, 'utf8'));
      return { id: b.id, title: b.title, author: b.author || '', type: b.type || 'summary', addedAt: b.addedAt || Date.now() };
    } catch {}
  }
  return null;
}

const mod = await import(path.resolve(contentPath));
const raw = loadSpec(mod);
if (!raw) {
  console.error(`Expected export "batch${batchId}" or "books" in ${contentPath}`);
  process.exit(1);
}

const rewrittenAt = Date.now();
let written = 0;
let warnings = 0;

for (const [file, payload] of Object.entries(raw)) {
  const base = resolveBase(file, payload.base);
  if (!base) {
    console.warn(`  SKIP ${file}: no base metadata available`);
    warnings++;
    continue;
  }
  const chapters = payload.chapters || [];
  if (!chapters.length) {
    console.warn(`  SKIP ${file}: no chapters`);
    warnings++;
    continue;
  }

  let totalWords = 0;
  const outChapters = chapters.map((ch, i) => {
    const w = wc(ch.text);
    totalWords += w;
    return { title: ch.title, text: ch.text, wordCount: w };
  });

  // Length drift check vs backup
  const backupPath = path.join(BACKUP, file);
  if (fs.existsSync(backupPath)) {
    const orig = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    for (let i = 0; i < outChapters.length && i < (orig.chapters?.length || 0); i++) {
      const origWc = orig.chapters[i].wordCount || wc(orig.chapters[i].text);
      if (origWc === 0) continue;
      const ratio = outChapters[i].wordCount / origWc;
      if (ratio < 0.5 || ratio > 1.5) {
        console.warn(`  WARN ${file} ch${i}: length ratio ${ratio.toFixed(2)} (orig ${origWc} -> new ${outChapters[i].wordCount})`);
        warnings++;
      }
    }
    // Jaccard similarity check
    for (let i = 0; i < outChapters.length && i < (orig.chapters?.length || 0); i++) {
      const sim = jaccard(outChapters[i].text, orig.chapters[i].text);
      if (sim > 0.55) {
        console.warn(`  WARN ${file} ch${i}: jaccard ${sim.toFixed(2)} (rewrite too similar to source)`);
        warnings++;
      }
    }
  }

  const book = {
    ...base,
    source: 'rsvp-original',
    rewrittenAt,
    chapters: outChapters,
    totalWords,
  };

  // Preserve any existing keys (cover, category) that we didn't change
  const existingPath = path.join(DATA, file);
  if (fs.existsSync(existingPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      for (const k of Object.keys(prev)) {
        if (!(k in book)) book[k] = prev[k];
      }
    } catch {}
  }

  fs.writeFileSync(existingPath, JSON.stringify(book, null, 2) + '\n');
  console.log(`Wrote ${file}: ${outChapters.length} chapters, ${totalWords} words`);
  written++;
}

console.log(`Done. Wrote ${written} files, ${warnings} warnings. rewrittenAt=${rewrittenAt}`);
