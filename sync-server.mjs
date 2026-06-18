#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getToken } from 'next-auth/jwt';
import {
  createRsvpSyncToken,
  isRsvpSyncSigningConfigured,
  verifyRsvpSyncToken,
} from './rsvp-sync-token.mjs';
import { validateSnapshotShape, SNAPSHOT_VERSION } from './sync-model.js';

const PORT = Number(process.env.RSVP_SYNC_PORT || 9877);
const DATA_DIR = process.env.RSVP_SYNC_DIR || path.join(process.cwd(), 'sync-data');
const SESSION_SECRET = () => (
  process.env.RSVP_SYNC_JWT_SECRET || process.env.NEXTAUTH_SECRET || ''
);

// Hard caps. Tuned for a personal library — even a heavy user is well under
// 1 MB after the chapter-text-is-not-shipped refactor. Anything bigger is
// either a runaway loop or an attempted abuse; reject before buffering.
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_BOOKS = 5000; // sanity cap on the books array

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateMap = new Map();
function checkRate(userId) {
  const now = Date.now();
  const entry = rateMap.get(userId) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  entry.count++;
  rateMap.set(userId, entry);
  if (entry.count > RATE_MAX) return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { limited: false };
}

function send(res, code, body, type = 'application/json', extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function bearerToken(req) {
  const raw = req.headers.authorization || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function verifyAuth(req) {
  const token = bearerToken(req);
  if (!token) return { error: 'Sign in required', status: 401 };

  if (!isRsvpSyncSigningConfigured()) {
    return { error: 'Server auth not configured', status: 503 };
  }

  const payload = verifyRsvpSyncToken(token);
  if (!payload?.userId) {
    return { error: 'Invalid or expired session', status: 401 };
  }

  return { userId: payload.userId };
}

function userFilePath(userId) {
  const safe = userId.replace(/[^a-zA-Z0-9@._+-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

/**
 * Atomic write: write to a unique temp file in the same directory, fsync,
 * then rename over the destination. A crash mid-write leaves the previous
 * file intact; we never expose a half-written library.
 */
async function atomicWriteJSON(filePath, payload) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const handle = await fs.promises.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.promises.rename(tmp, filePath);
}

function usesSecureCookies(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto) return proto.split(',')[0].trim() === 'https';
  const host = String(req.headers.host || '').toLowerCase();
  return host.endsWith('zipang.id');
}

async function handleTokenRequest(req, res) {
  const secret = SESSION_SECRET();
  if (!secret) return send(res, 503, { error: 'Server auth not configured' });

  const session = await getToken({
    req: { headers: { cookie: req.headers.cookie || '' } },
    secret,
    secureCookie: usesSecureCookies(req),
  });

  const email = String(session?.email || '').trim().toLowerCase();
  if (!email) return send(res, 401, { error: 'Sign in required' });

  const userId = String(session?.id || session?.sub || email).trim().toLowerCase();
  const { token, expiresAt } = createRsvpSyncToken(userId);
  return send(res, 200, { token, expiresAt });
}

/**
 * Read the request body with a hard byte cap. We never trust Content-Length
 * because it can be missing or wrong; instead we count bytes as we read and
 * abort the moment we cross the cap.
 */
async function readBoundedBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleSnapshotRequest(req, res) {
  const auth = verifyAuth(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });

  const rate = checkRate(auth.userId);
  if (rate.limited) {
    return send(res, 429, { error: 'Rate limit exceeded' }, 'application/json', { 'Retry-After': String(rate.retryAfter) });
  }

  const filePath = userFilePath(auth.userId);

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      return send(res, 200, { version: SNAPSHOT_VERSION, schemaVersion: SNAPSHOT_VERSION, exportedAt: null, deviceId: null, books: [], tombstones: [] });
    }
    const data = await fs.promises.readFile(filePath, 'utf8');
    return send(res, 200, data);
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readBoundedBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err && err.message === 'PAYLOAD_TOO_LARGE') {
        return send(res, 413, { error: 'Payload too large', maxBytes: MAX_BODY_BYTES });
      }
      return send(res, 400, { error: 'Failed to read body' });
    }
    if (!body) return send(res, 400, { error: 'Empty body' });

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }

    const shapeErr = validateSnapshotShape(parsed);
    if (shapeErr) return send(res, 400, { error: 'Invalid snapshot', reason: shapeErr });

    if (Array.isArray(parsed.books) && parsed.books.length > MAX_BOOKS) {
      return send(res, 400, { error: 'Too many books', limit: MAX_BOOKS });
    }

    try {
      await atomicWriteJSON(filePath, JSON.stringify(parsed));
    } catch (err) {
      return send(res, 500, { error: 'Failed to persist snapshot' });
    }
    return send(res, 200, { ok: true, version: SNAPSHOT_VERSION, bytes: body.length });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

// Legacy catch-all: any pre-v3 client that still POSTs to / is forwarded
// through the same validation path. Reads return the stored payload as-is
// (which may be a v2 or v3 snapshot); writes are wrapped to v3 if needed.
async function handleLegacySyncRequest(req, res) {
  const auth = verifyAuth(req);
  if (auth.error) return send(res, auth.status, { error: auth.error });

  const rate = checkRate(auth.userId);
  if (rate.limited) {
    return send(res, 429, { error: 'Rate limit exceeded' }, 'application/json', { 'Retry-After': String(rate.retryAfter) });
  }

  const filePath = userFilePath(auth.userId);

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      return send(res, 200, { version: 2, exportedAt: null, books: [] });
    }
    const data = await fs.promises.readFile(filePath, 'utf8');
    return send(res, 200, data);
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readBoundedBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err && err.message === 'PAYLOAD_TOO_LARGE') {
        return send(res, 413, { error: 'Payload too large', maxBytes: MAX_BODY_BYTES });
      }
      return send(res, 400, { error: 'Failed to read body' });
    }
    if (!body) return send(res, 400, { error: 'Empty body' });

    // Best-effort parse, validate, and rewrite. If the client still speaks
    // v2, we accept and persist as v2 so its round-trip is preserved.
    try {
      const parsed = JSON.parse(body);
      const shapeErr = validateSnapshotShape(parsed);
      if (shapeErr) return send(res, 400, { error: 'Invalid snapshot', reason: shapeErr });
      if (Array.isArray(parsed.books) && parsed.books.length > MAX_BOOKS) {
        return send(res, 400, { error: 'Too many books', limit: MAX_BOOKS });
      }
    } catch {
      return send(res, 400, { error: 'Invalid JSON' });
    }

    try {
      await atomicWriteJSON(filePath, body);
    } catch (err) {
      return send(res, 500, { error: 'Failed to persist snapshot' });
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/health') return send(res, 200, { ok: true, ts: Date.now() });

  if (pathname === '/token' && req.method === 'GET') {
    return handleTokenRequest(req, res);
  }

  if (pathname === '/snapshot') {
    return handleSnapshotRequest(req, res);
  }

  if (pathname === '/' || pathname === '') {
    return handleLegacySyncRequest(req, res);
  }

  return send(res, 404, { error: 'Not found' });
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`RSVP sync listening on 127.0.0.1:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start sync server:', err);
    process.exit(1);
  });
}

export { server, startServer, checkRate, atomicWriteJSON, readBoundedBody, MAX_BODY_BYTES, MAX_BOOKS };
