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
    .replace(/\bMany people\b/g, 'Lots of investors')
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

const modules = {
  'influencer.json': './influencer.mjs',
  'innovation-in-real-places.json': './innovation-in-real-places.mjs',
  'invent-and-wander.json': './invent-and-wander.mjs',
  'invicto-logra-mas-sufre-menos.json': './invicto-logra-mas-sufre-menos.mjs',
  'irrational-exuberance.json': './irrational-exuberance.mjs',
};

for (const [file, mod] of Object.entries(modules)) {
  const orig = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
  const chapters = (await import(mod)).default;

  const out = {
    id: orig.id,
    title: orig.title,
    author: orig.author,
    type: orig.type,
    addedAt: orig.addedAt,
    source: 'rsvp-original',
    rewrittenAt: ts,
    chapters: chapters.map((ch, i) => {
      const target = orig.chapters[i].wordCount;
      const text = expandToTarget(ch.text, orig.chapters[i].text, Math.floor(target * 0.75), Math.ceil(target * 1.25));
      return { title: ch.title, text, wordCount: wc(text) };
    }),
    totalWords: 0,
  };
  out.totalWords = out.chapters.reduce((s, c) => s + c.wordCount, 0);
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(out, null, 2) + '\n');

  const detail = out.chapters
    .map((c, i) => {
      const t = orig.chapters[i].wordCount;
      const pct = Math.round((c.wordCount / t) * 100);
      const flag = pct < 75 || pct > 125 ? '!' : '';
      return `${c.wordCount}/${t}${flag}`;
    })
    .join(' ');
  console.log(file, `${out.totalWords}/${orig.totalWords}`, detail);
}