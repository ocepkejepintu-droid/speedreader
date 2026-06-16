#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getToken } from 'next-auth/jwt';
import {
  createRsvpSyncToken,
  isRsvpSyncSigningConfigured,
  verifyRsvpSyncToken,
} from './rsvp-sync-token.mjs';

const PORT = Number(process.env.RSVP_SYNC_PORT || 9877);
const DATA_DIR = process.env.RSVP_SYNC_DIR || path.join(process.cwd(), 'sync-data');
const SESSION_SECRET = () => (
  process.env.RSVP_SYNC_JWT_SECRET || process.env.NEXTAUTH_SECRET || ''
);

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

async function handleSyncRequest(req, res) {
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
    const data = fs.readFileSync(filePath, 'utf8');
    return send(res, 200, data);
  }

  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    if (!body) return send(res, 400, { error: 'Empty body' });
    await fs.promises.writeFile(filePath, body, 'utf8');
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

  if (pathname === '/' || pathname === '') {
    return handleSyncRequest(req, res);
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

export { server, startServer, checkRate };