#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.RSVP_SUMMARIES_PORT || 9879);
const DATA_DIR = process.env.RSVP_SUMMARIES_DIR || path.join(process.cwd(), 'summaries-data');
const CATEGORIES_FILE = path.join(DATA_DIR, '_categories.json');
const FEATURED_FILE = path.join(DATA_DIR, '_featured.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadFeaturedIds() {
  if (!fs.existsSync(FEATURED_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(FEATURED_FILE, 'utf8'));
    const ids = Array.isArray(data) ? data : (data.featured || []);
    return new Set(ids.map((id) => safeId(id)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function loadCategories() {
  if (!fs.existsSync(CATEGORIES_FILE)) return { map: {}, subtopics: {} };
  try {
    const data = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
    return { map: data.category || {}, subtopics: data.subtopics || {} };
  } catch {
    return { map: {}, subtopics: {} };
  }
}

function send(res, code, body, type = 'application/json', extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300',
    ...extraHeaders,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function listSummaries() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && f !== 'catalog.json' && !f.startsWith('_'));
  const { map: catMap, subtopics } = loadCategories();
  const featuredIds = loadFeaturedIds();
  const summaries = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const book = JSON.parse(raw);
      if (!book?.id || !book?.chapters?.length) continue;
      summaries.push({
        id: book.id,
        title: book.title || 'Untitled',
        author: book.author || '',
        source: book.source || 'summary',
        chapterCount: book.chapters.length,
        totalWords: book.totalWords || book.chapters.reduce((s, c) => s + (c.wordCount || 0), 0),
        addedAt: book.addedAt || null,
        category: catMap[book.id] || null,
        subtopics: subtopics[book.id] || '',
        featured: featuredIds.has(book.id),
      });
    } catch { /* skip bad files */ }
  }
  summaries.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return summaries;
}

function loadSummary(id) {
  const safe = safeId(id);
  if (!safe) return null;
  const filePath = path.join(DATA_DIR, `${safe}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const book = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { map: catMap, subtopics } = loadCategories();
    if (book && !book.category && catMap[safe]) {
      book.category = catMap[safe];
      book.subtopics = subtopics[safe] || '';
    }
    return book;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  let pathname = (req.url || '/').split('?')[0];
  if (pathname.startsWith('/rsvp/summaries')) {
    pathname = pathname.slice('/rsvp/summaries'.length) || '/';
  }

  if (pathname === '/health') return send(res, 200, { ok: true, ts: Date.now() });

  if (pathname === '/catalog' || pathname === '/') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    return send(res, 200, { version: 1, summaries: listSummaries() });
  }

  const match = pathname.match(/^\/([^/]+)$/);
  if (match && req.method === 'GET') {
    const book = loadSummary(match[1]);
    if (!book) return send(res, 404, { error: 'Summary not found' });
    return send(res, 200, book);
  }

  return send(res, 404, { error: 'Not found' });
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`RSVP summaries listening on 127.0.0.1:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start summaries server:', err);
    process.exit(1);
  });
}

export { server, startServer, listSummaries, loadSummary };