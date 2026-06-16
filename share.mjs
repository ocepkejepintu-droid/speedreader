// share.mjs
// v1.1 Sprint 5 — share-to-RSVP server endpoint.
//
//   POST /share
//   body: { url, title, text }
//   returns: { id, title, text, wordCount, boundaries, deduped?, shareSource? }
//
//   POST /share-target    (manifest share_target form post handler)
//   returns: HTML page that redirects to the PWA reader
//
//   GET  /share          (friendly explainer, for people who land here)
//
// Strategy:
//   * `text` is required and authoritative if present (the share sheet from
//     iOS Safari usually supplies the page excerpt).
//   * If `text` is empty but `url` is set, we fetch the URL server-side
//     (article-extract) to get a clean readable text.
//   * We dedupe by SHA-256 of (url + "\n" + text) — the same article shared
//     from the same URL is the same article.
//   * Rate-limited per IP (30/min) to keep the door closed on abuse.

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndExtract } from './article-extract.mjs';
import { handleShareRequest, buildShareResponse, dedupeKey, readBucket } from './share-store.mjs';

const SHARE_PORT = Number(process.env.RSVP_SHARE_PORT || 9878);
const DATA_DIR = process.env.RSVP_SHARE_DIR || path.join(process.cwd(), 'share-data');
const SHARE_LOG = path.join(DATA_DIR, 'share-log.ndjson');
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const MAX_TEXT = 200_000;
const MAX_URL = 2048;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- rate limit (per IP) ---------------------------------------------------
const rateMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count++;
  rateMap.set(ip, entry);
  if (entry.count > RATE_MAX) {
    return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { limited: false };
}

// Test hook — clear the in-memory rate-limit map. Production code never
// calls this; only the test suite resets between cases.
function _resetRateLimitsForTest() {
  rateMap.clear();
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function send(res, code, body, type = 'application/json', extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function appendShareLog(entry) {
  try {
    fs.appendFileSync(SHARE_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
  } catch { /* logging is best-effort */ }
}

// ---- /share handler (JSON) -------------------------------------------------
async function handleJsonShare(req, res) {
  const ip = clientIp(req);
  const rate = checkRate(ip);
  if (rate.limited) {
    return send(res, 429, { error: 'Rate limit exceeded' }, 'application/json', { 'Retry-After': String(rate.retryAfter) });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return send(res, 400, { error: err.message || 'Bad request' }); }

  const url = typeof body.url === 'string' ? body.url.slice(0, MAX_URL) : '';
  const suppliedTitle = typeof body.title === 'string' ? body.title.slice(0, 500) : '';
  const suppliedText = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';

  if (!url && !suppliedText) {
    return send(res, 400, { error: 'Provide url or text' });
  }

  let title = suppliedTitle;
  let text = suppliedText;
  let finalUrl = url;
  let extracted = false;

  if (!text) {
    try {
      const result = await fetchAndExtract(url);
      text = result.text;
      if (!title && result.title) title = result.title;
      finalUrl = result.finalUrl || url;
      extracted = true;
    } catch (err) {
      return send(res, 502, { error: 'Could not fetch URL', detail: err.message });
    }
  }

  text = (text || '').trim();
  if (!text) return send(res, 422, { error: 'No text after extraction' });
  if (!title) {
    try {
      title = new URL(url).hostname;
    } catch { title = 'Shared article'; }
  }

  const shareSource = typeof body.shareSource === 'string' ? body.shareSource.slice(0, 64) : 'json';

  const result = await handleShareRequest({
    url: finalUrl,
    title,
    text,
    shareSource,
    ip,
  });

  appendShareLog({
    ip,
    shareSource,
    url: finalUrl,
    title,
    textLength: text.length,
    deduped: !!result.deduped,
    id: result.id,
  });

  return send(res, 200, buildShareResponse(result));
}

// ---- /share-target handler (form post from manifest share_target) ---------
//
// The manifest posts `multipart/form-data` with `url`, `title`, `text`. We
// can also receive `application/x-www-form-urlencoded`. We accept both.
function readFormBody(req) {
  return new Promise((resolve, reject) => {
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > 512 * 1024) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ ctype, raw });
    });
    req.on('error', reject);
  });
}

function parseFormFields(ctype, raw) {
  // Returns a plain { url, title, text } object.
  if (ctype.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    return {
      url: params.get('url') || '',
      title: params.get('title') || '',
      text: params.get('text') || '',
    };
  }
  if (ctype.includes('multipart/form-data')) {
    // Minimal multipart parser — we just need the first occurrences of url,
    // title, and text fields. The body is bounded so this stays cheap.
    const fields = { url: '', title: '', text: '' };
    const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = m ? (m[1] || m[2] || '').trim() : '';
    if (!boundary) return fields;
    const sep = `--${boundary}`;
    const parts = raw.split(sep);
    for (const part of parts) {
      if (part === '' || part === '--' || part === '--\r\n' || part === '--\n') continue;
      const headerEnd = part.indexOf('\r\n\r\n');
      const headerEndLf = part.indexOf('\n\n');
      const split = headerEnd !== -1 ? headerEnd : headerEndLf;
      if (split === -1) continue;
      const headerBlock = part.slice(0, split);
      const body = part.slice(split).replace(/^\r\n\r\n|^\n\n/, '').replace(/\r\n--$|\n--$/, '');
      const nameMatch = headerBlock.match(/name="([^"]+)"/i);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      if (name in fields && fields[name]) continue; // first wins
      const value = body.replace(/\r\n$/, '').replace(/\n$/, '');
      fields[name] = value;
    }
    return fields;
  }
  return { url: '', title: '', text: '' };
}

async function handleShareTargetPost(req, res) {
  const ip = clientIp(req);
  const rate = checkRate(ip);
  if (rate.limited) {
    res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Rate limit</title><p>Too many share requests. Try again in a minute.</p>');
    return;
  }

  let fields;
  try {
    const { ctype, raw } = await readFormBody(req);
    fields = parseFormFields(ctype, raw);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Bad request</title><p>${err.message}</p>`);
    return;
  }

  const url = (fields.url || '').slice(0, MAX_URL);
  const suppliedTitle = (fields.title || '').slice(0, 500);
  const suppliedText = (fields.text || '').slice(0, MAX_TEXT);

  if (!url && !suppliedText) {
    // Nothing to do — send the user back to the library.
    res.writeHead(302, { Location: '/rsvp/app/' });
    res.end();
    return;
  }

  let title = suppliedTitle;
  let text = suppliedText;
  let finalUrl = url;
  if (!text) {
    try {
      const result = await fetchAndExtract(url);
      text = result.text;
      if (!title && result.title) title = result.title;
      finalUrl = result.finalUrl || url;
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Could not fetch</title><p>RSVP Reader could not fetch the shared URL: ${err.message}</p>`);
      return;
    }
  }
  text = (text || '').trim();
  if (!text) {
    res.writeHead(422, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Empty</title><p>No text was found to save.</p>');
    return;
  }
  if (!title) {
    try { title = new URL(finalUrl).hostname; } catch { title = 'Shared article'; }
  }

  const result = await handleShareRequest({
    url: finalUrl,
    title,
    text,
    shareSource: 'share_target',
    ip,
  });

  appendShareLog({
    ip,
    shareSource: 'share_target',
    url: finalUrl,
    title,
    textLength: text.length,
    deduped: !!result.deduped,
    id: result.id,
  });

  // 302-redirect to the PWA. The article has been written to the user's
  // library (under their IP key — see share-store) and the client-side
  // `initReaderApp` will pick it up via the `?article=<id>` query.
  res.writeHead(302, {
    Location: `/rsvp/app/?article=${encodeURIComponent(result.id)}`,
    'Cache-Control': 'no-store',
  });
  res.end();
}

// ---- HTTP plumbing ---------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/health') {
    return send(res, 200, { ok: true, ts: Date.now() });
  }

  if (pathname === '/share' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>RSVP Reader — Share</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:1rem;line-height:1.5;color:#1a1a1a}</style>
</head><body>
<h1>RSVP Reader — share target</h1>
<p>This URL is the share target for the <a href="/rsvp/app/">RSVP Reader PWA</a>.</p>
<p>From your iPhone: open the page you want to save, tap <strong>Share</strong>, pick <strong>RSVP</strong> from the share sheet. (You may need to install the PWA first via <em>Add to Home Screen</em>.)</p>
<p>Programmatic access: <code>POST /share</code> with JSON <code>{url, title, text}</code>.</p>
</body></html>`);
  }

  if (pathname === '/share' && req.method === 'POST') {
    return handleJsonShare(req, res);
  }

  if (pathname === '/share-target' && req.method === 'POST') {
    return handleShareTargetPost(req, res);
  }

  if (pathname === '/share-target' && req.method === 'GET') {
    // Friendly explainer if someone hits the form-action URL directly.
    res.writeHead(302, { Location: '/rsvp/app/' });
    res.end();
    return;
  }

  // GET /share/article/:id — fetch a previously-saved article (used by the
  // PWA's handoff when the share target was triggered from another device
  // or a different IP and the local library is empty).
  const articleMatch = pathname.match(/^\/share\/article\/([a-f0-9]{6,128})$/i);
  if (articleMatch && req.method === 'GET') {
    const ip = clientIp(req);
    const rate = checkRate(ip);
    if (rate.limited) {
      return send(res, 429, { error: 'Rate limit exceeded' });
    }
    const id = articleMatch[1].toLowerCase();
    const fsBucket = readBucket(
      process.env.RSVP_SHARE_DIR || path.join(process.cwd(), 'share-data'),
      ip,
    );
    const record = fsBucket.articles[id];
    if (!record) return send(res, 404, { error: 'Not found' });
    return send(res, 200, buildShareResponse(record));
  }

  return send(res, 404, { error: 'Not found' });
});

function startServer(port = SHARE_PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`RSVP share target listening on 127.0.0.1:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start share server:', err);
    process.exit(1);
  });
}

export {
  server,
  startServer,
  checkRate,
  clientIp,
  dedupeKey,
  // re-exported for testability
  parseFormFields,
  readJsonBody,
  handleJsonShare,
  handleShareTargetPost,
  _resetRateLimitsForTest,
};
