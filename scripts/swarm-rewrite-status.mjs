#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const BATCH_DIR = path.join(ROOT, '.grok', 'swarm', 'rewrite-batches');

const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
let rewritten = 0;
const pendingFiles = [];

for (const f of files) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    if (b.source === 'rsvp-original') rewritten++;
    else pendingFiles.push(f);
  } catch {
    pendingFiles.push(f);
  }
}

const batches = fs.existsSync(BATCH_DIR)
  ? fs.readdirSync(BATCH_DIR).filter((f) => f.startsWith('batch-') && f.endsWith('.json')).sort()
  : [];

const batchStatus = batches.map((name) => {
  const batch = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, name), 'utf8'));
  const done = batch.files.filter((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')).source === 'rsvp-original';
    } catch {
      return false;
    }
  });
  return {
    batchId: batch.batchId,
    total: batch.files.length,
    done: done.length,
    complete: done.length === batch.files.length,
    pending: batch.files.filter((f) => !done.includes(f)),
  };
});

const nextIncomplete = batchStatus.filter((b) => !b.complete).slice(0, 6).map((b) => b.batchId);

console.log(JSON.stringify({
  totalFiles: files.length,
  rewritten,
  pending: files.length - rewritten,
  pct: Math.round((rewritten / files.length) * 100),
  batchesComplete: batchStatus.filter((b) => b.complete).length,
  batchesTotal: batchStatus.length,
  nextBatches: nextIncomplete,
}, null, 2));