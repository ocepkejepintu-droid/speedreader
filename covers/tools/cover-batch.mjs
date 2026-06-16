#!/usr/bin/env node
/**
 * cover-batch.mjs — driver for the 263-book cover loop.
 *
 * Reads summaries-catalog.md + summaries-categories.json, then for each book
 * invokes the design pipeline. This script is the *single owner* of disk
 * writes; subagents only return concept JSONs.
 *
 * Usage:
 *   node tools/cover-batch.mjs                  # process all 263 books
 *   node tools/cover-batch.mjs --limit 5        # process first 5 only (smoke test)
 *   node tools/cover-batch.mjs --only <slug>    # process a single book
 *   node tools/cover-batch.mjs --category "Self-Growth"  # process by category
 *   node tools/cover-batch.mjs --redo <slug>    # re-render from saved concept
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const CONCEPTS = path.join(ROOT, 'concepts');
const MANIFESTS = path.join(ROOT, 'manifests');
const RENDERS = path.join(ROOT, 'renders');
for (const d of [CONCEPTS, MANIFESTS, RENDERS]) mkdirSync(d, { recursive: true });

const CATALOG = '/Users/yoseph/rsvp-reader/summaries-catalog.md';
const CATS = '/Users/yoseph/rsvp-reader/summaries-categories.json';
const DATA = '/Users/yoseph/rsvp-reader/summaries-data';

function parseArgs() {
  const args = { limit: null, only: null, category: null, redo: null, parallel: 4, sweep: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--limit') args.limit = parseInt(process.argv[++i], 10);
    else if (a === '--only') args.only = process.argv[++i];
    else if (a === '--category') args.category = process.argv[++i];
    else if (a === '--redo') args.redo = process.argv[++i];
    else if (a === '--parallel') args.parallel = parseInt(process.argv[++i], 10);
    else if (a === '--sweep') args.sweep = true;
  }
  return args;
}

function loadCatalog() {
  const md = readFileSync(CATALOG, 'utf8');
  const cats = JSON.parse(readFileSync(CATS, 'utf8'));
  const books = [];
  // Parse lines like: | 1 | slug | Title | Author | Category | subtopics |
  const re = /^\|\s*(\d+)\s*\|\s*([a-z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/;
  for (const line of md.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const [, num, slug, title, author, category, subtopics] = m;
    if (!slug || /slug/i.test(slug)) continue;
    books.push({
      slug: slug.trim(),
      title: title.trim(),
      author: author.trim() || '',
      category: (category.trim() || cats.category?.[slug] || '').replace(/\s+/g, ' '),
      subtopics: subtopics.trim() || cats.subtopics?.[slug] || '',
    });
  }
  return books;
}

function loadBook(slug) {
  const p = path.join(DATA, `${slug}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function conceptPath(slug) { return path.join(CONCEPTS, `${slug}.json`); }
function manifestPath(slug) { return path.join(MANIFESTS, `${slug}.json`); }

function hasRendered(slug) {
  return existsSync(path.join(RENDERS, `${slug}.png`));
}

function loadConcept(slug) {
  const p = conceptPath(slug);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function saveConcept(slug, concept) {
  writeFileSync(conceptPath(slug), JSON.stringify(concept, null, 2));
}

function saveManifest(slug, m) {
  writeFileSync(manifestPath(slug), JSON.stringify(m, null, 2));
}

function render(slug) {
  const concept = loadConcept(slug);
  if (!concept) { console.error(`no concept for ${slug}`); return false; }
  try {
    const out = execFileSync('node', [path.join(TOOLS, 'cover.mjs'), conceptPath(slug)], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    const parsed = JSON.parse(out.trim().split('\n').pop());
    return parsed.ok === true;
  } catch (e) {
    console.error(`render ${slug} failed:`, e.message);
    return false;
  }
}

function summarize(book) {
  return {
    slug: book.slug,
    title: book.title,
    author: book.author,
    category: book.category,
    subtopics: book.subtopics,
  };
}

async function main() {
  const args = parseArgs();
  const books = loadCatalog();
  console.log(`catalog: ${books.length} books`);

  let queue = books;
  if (args.only) queue = queue.filter(b => b.slug === args.only);
  else if (args.category) queue = queue.filter(b => b.category === args.category);
  else if (args.redo) queue = queue.filter(b => b.slug === args.redo);
  if (args.limit) queue = queue.slice(0, args.limit);

  console.log(`processing: ${queue.length} books`);

  // Group by category for the subagents — 5 design angles per book.
  // The subagents are spawned by the Claude main session via Agent tool,
  // driven by the prompts in concept-template.md. This driver just keeps
  // the queue and renders the saved concept JSONs.
  for (const book of queue) {
    if (hasRendered(book.slug) && !args.redo && !args.sweep) {
      console.log(`skip ${book.slug} (already rendered)`);
      continue;
    }
    const m = {
      slug: book.slug,
      title: book.title,
      author: book.author,
      category: book.category,
      subtopics: book.subtopics,
      status: 'queued',
      ts: Date.now(),
    };
    saveManifest(book.slug, m);
  }

  // Write the queue as a JSON the main session reads to dispatch subagents.
  writeFileSync(path.join(ROOT, 'queue.json'), JSON.stringify(queue.map(summarize), null, 2));
  console.log(`wrote queue.json with ${queue.length} entries`);
}

main().catch(e => { console.error(e); process.exit(1); });
