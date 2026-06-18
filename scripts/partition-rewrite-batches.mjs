#!/usr/bin/env node
/** Partition summaries-data/*.json into N batch manifest files for swarm workers. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const OUT = path.join(ROOT, '.grok', 'swarm', 'rewrite-batches');
const BATCH_SIZE = Number(process.env.REWRITE_BATCH_SIZE || 5);
const args = process.argv.slice(2);
const onlyPending = args.includes('--pending');

const files = fs.readdirSync(DATA)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

function isPending(file) {
  try {
    const book = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
    return book.source !== 'rsvp-original';
  } catch {
    return true;
  }
}

const work = onlyPending ? files.filter(isPending) : files;
const batches = [];
for (let i = 0; i < work.length; i += BATCH_SIZE) {
  batches.push(work.slice(i, i + BATCH_SIZE));
}

fs.mkdirSync(OUT, { recursive: true });
for (let i = 0; i < batches.length; i++) {
  const id = String(i + 1).padStart(3, '0');
  fs.writeFileSync(path.join(OUT, `batch-${id}.json`), JSON.stringify({
    batchId: id,
    files: batches[i],
  }, null, 2));
}

const manifest = {
  totalFiles: work.length,
  batchSize: BATCH_SIZE,
  batchCount: batches.length,
  outDir: OUT,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));