#!/usr/bin/env node
/** Partition the current pending (Headway-source) summaries into N new batch manifests
 * starting at batch-100 (leaves 001-061 reserved for the original swarm) and
 * saved to .grok/swarm/rewrite-batches/ alongside the existing batches.
 * Each batch gets 5 files by default. Pass --size N to override.
 *
 * Usage:  node scripts/partition-rewrite-pending.mjs [--size 5] [--start 100]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const OUT = path.join(ROOT, '.grok', 'swarm', 'rewrite-batches');

const args = process.argv.slice(2);
const sizeArg = args.indexOf('--size');
const startArg = args.indexOf('--start');
const BATCH_SIZE = sizeArg > -1 ? Number(args[sizeArg + 1]) : 5;
const START_ID = startArg > -1 ? Number(args[startArg + 1]) : 100;

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

const pending = files.filter(isPending);
console.log('Total files:', files.length, 'Pending:', pending.length);

const existing = new Set(
  fs.existsSync(OUT)
    ? fs.readdirSync(OUT).filter((f) => /^batch-\d+\.json$/.test(f))
    : [],
);

let nextId = START_ID;
const written = [];
for (let i = 0; i < pending.length; i += BATCH_SIZE) {
  const slice = pending.slice(i, i + BATCH_SIZE);
  const id = String(nextId).padStart(3, '0');
  const filename = `batch-${id}.json`;
  // skip if file already exists, so this script is idempotent
  if (existing.has(filename)) {
    nextId++;
    continue;
  }
  fs.writeFileSync(
    path.join(OUT, filename),
    JSON.stringify({ batchId: id, files: slice }, null, 2),
  );
  written.push({ id, count: slice.length });
  nextId++;
}

console.log('Wrote', written.length, 'new batches of size', BATCH_SIZE, 'starting at', String(START_ID).padStart(3, '0'));
console.log('First 3:', written.slice(0, 3));
console.log('Last 3:', written.slice(-3));
