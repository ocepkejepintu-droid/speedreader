#!/usr/bin/env node
/**
 * concept-gen.mjs — generate a deterministic concept for a book using
 * a content-driven heuristic. Acts as a fast baseline concept writer
 * (subagent-style) so we always have a renderable concept even before
 * the 5+1+1 subagent fan-out runs.
 *
 * The subagent-driven design loop (5+1+1) later refines these.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONCEPTS = path.join(ROOT, 'concepts');
mkdirSync(CONCEPTS, { recursive: true });

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function pickMotif(book) {
  const t = (book.title || '').toLowerCase();
  const s = (book.subtopics || '').toLowerCase();
  if (/atomic|alchemist|element/.test(t)) return { motif: 'hairlines', motifCount: 4 };
  if (/sapiens|human|kind|people|civiliz/.test(t + ' ' + s)) return { motif: 'orb' };
  if (/1984|big brother|surveillance|watching/.test(t + ' ' + s)) return { motif: 'mark' };
  if (/art of war|sun tzu|strategy|tactics/.test(t + ' ' + s)) return { motif: 'arc' };
  if (/ikigai|four|venn|overlap|intersect/.test(t + ' ' + s)) return { motif: 'venn' };
  if (/four thousand|4000|time|productiv/.test(t + ' ' + s)) return { motif: 'split' };
  if (/lean startup|mvp/.test(t + ' ' + s)) return { motif: 'number', number: '01' };
  if (/thinking, fast|slow|system|kahneman/.test(t + ' ' + s)) return { motif: 'split' };
  if (/war|attack|hook/.test(t)) return { motif: 'mark' };
  if (/stoic|meditations|chinese|tzu/.test(t + ' ' + s)) return { motif: 'arc' };
  return { motif: 'orb' };
}

function pickAccent(book, motif) {
  if (motif === 'mark') return 'brand-bottom';
  if (motif === 'number') return 'brand-corner';
  if (motif === 'venn') return 'brand-top';
  return 'brand-top';
}

function pickRedElement(book) {
  const t = (book.title || '').toLowerCase();
  // Books that beg for a "1%" / "0 to 1" / number pill
  if (/%/.test(t) || /one|0|zero|1\b/.test(t)) {
    return { pill: '1', pillPos: 'top' };
  }
  if (/1984/.test(t)) return { redRule: 'top' };
  if (/war/.test(t)) return { redRule: 'top' };
  if (/edged|edg/.test(t)) return { redRule: 'top' };
  return { redRule: 'none', pill: undefined };
}

function splitTitle(title) {
  // Try to break the title at natural word boundaries into 2-3 lines
  // for display. Single-word titles stay single.
  const words = String(title || '').split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [title];
  if (words.length === 2) return words;
  if (words.length === 3) return [words[0], words.slice(1).join(' ')];
  if (words.length === 4) return [[words[0], words[1]].join(' '), [words[2], words[3]].join(' ')];
  return [words.slice(0, 2).join(' '), words.slice(2, 4).join(' '), words.slice(4).join(' ')];
}

function build(book) {
  const { motif, motifCount, number } = pickMotif(book);
  const accent = pickAccent(book, motif);
  const red = pickRedElement(book);
  const lines = splitTitle(book.title);
  const titleSize = lines.some(l => l.length > 8) ? 198 : (lines.length === 1 ? 540 : 198);
  const titleWeight = 300;
  const titleTransform = (book.category === 'Personalities' || /memoir|biography/.test((book.subtopics||'').toLowerCase())) ? 'none' : 'uppercase';

  return {
    slug: book.slug,
    title: book.title,
    author: book.author,
    category: book.category,
    subtopics: book.subtopics,
    year: book.year || '',
    datelineLeft: 'BOOK SUMMARY',
    datelineRight: (book.category || 'SUMMARY').toUpperCase(),
    motif, motifCount, number,
    titlePos: motif === 'mark' ? 'center' : 'top',
    titleWeight, titleSize, titleTransform,
    lines,
    subline: book.subtopics ? book.subtopics.split(',')[0].trim() : '',
    sublinePos: 'subline-bot',
    accent, brandMark: 'THOUGHTLAB',
    ...red,
    rationale: `motif=${motif} for "${book.title}" (${book.category}) — composed from book tokens.`,
  };
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: concept-gen.mjs <slug1> [slug2...]');
  console.error('       concept-gen.mjs --all');
  process.exit(1);
}

if (arg === '--all') {
  const md = readFileSync('/Users/yoseph/rsvp-reader/summaries-catalog.md', 'utf8');
  const re = /^\|\s*\d+\s*\|\s*([a-z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/;
  let count = 0;
  for (const line of md.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const [, slug, title, author, category, subtopics] = m;
    if (!slug) continue;
    const book = { slug, title: title.trim(), author: author.trim(), category: category.trim(), subtopics: subtopics.trim() };
    const c = build(book);
    writeFileSync(path.join(CONCEPTS, `${slug}.json`), JSON.stringify(c, null, 2));
    count++;
  }
  console.log(`generated ${count} concepts`);
} else {
  for (const slug of process.argv.slice(2)) {
    // Read the book from the queue
    const queue = JSON.parse(readFileSync(path.join(ROOT, 'queue.json'), 'utf8'));
    const book = queue.find(b => b.slug === slug);
    if (!book) { console.error(`no book in queue: ${slug}`); continue; }
    const c = build(book);
    writeFileSync(path.join(CONCEPTS, `${slug}.json`), JSON.stringify(c, null, 2));
    console.log(`wrote concept for ${slug}`);
  }
}
