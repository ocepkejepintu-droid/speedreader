#!/usr/bin/env node
/**
 * Re-backs up the current summaries-data/ into summaries-data-headway-backup/,
 * but only files that don't already exist in backup.
 * Use this after a scraping batch (e.g. batch16) so that newly scraped
 * Headway originals are also preserved in backup.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'summaries-data');
const BACKUP = path.join(ROOT, 'summaries-data-headway-backup');

const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
fs.mkdirSync(BACKUP, { recursive: true });

let copied = 0, skipped = 0, nonHeadway = 0;
for (const f of files) {
  const dest = path.join(BACKUP, f);
  if (fs.existsSync(dest)) {
    skipped++;
    continue;
  }
  const src = path.join(DATA, f);
  const book = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (book.source !== 'headway') {
    nonHeadway++;
    continue; // don't back up rsvp-original rewrites
  }
  fs.copyFileSync(src, dest);
  copied++;
}

console.log(`Copied: ${copied}, Already in backup: ${skipped}, Non-headway skipped: ${nonHeadway}`);
