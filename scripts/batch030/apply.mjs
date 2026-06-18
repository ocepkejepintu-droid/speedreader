import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ts = 1781599281463;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(root, 'summaries-data');
const backupDir = path.join(root, 'summaries-data-headway-backup');

function wc(t) {
  return t.split(/\s+/).filter(Boolean).length;
}

const files = {
  'influencer.json': (await import('./influencer.mjs')).default,
  'irrational-exuberance.json': (await import('./irrational-exuberance.mjs')).default,
};

for (const [file, chapters] of Object.entries(files)) {
  const orig = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
  const out = {
    id: orig.id,
    title: orig.title,
    author: orig.author,
    type: orig.type,
    addedAt: orig.addedAt,
    source: 'rsvp-original',
    rewrittenAt: ts,
    chapters: chapters.map((ch) => ({
      title: ch.title,
      text: ch.text,
      wordCount: wc(ch.text),
    })),
    totalWords: 0,
  };
  out.totalWords = out.chapters.reduce((s, c) => s + c.wordCount, 0);
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(out, null, 2) + '\n');
  console.log(
    file,
    out.totalWords,
    '/',
    orig.totalWords,
    out.chapters.map((c, i) => `${c.wordCount}/${orig.chapters[i].wordCount}`).join(' ')
  );
}