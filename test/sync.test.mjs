// Smoke tests for /Users/yoseph/rsvp-reader/sync-server.mjs
// Uses Node's built-in test runner. No external deps.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.RSVP_SYNC_JWT_SECRET = 'test-secret-' + Math.random().toString(36).slice(2);
process.env.RSVP_SYNC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-sync-test-'));

const { server, startServer } = await import('../sync-server.mjs');
const { createRsvpSyncToken } = await import('../rsvp-sync-token.mjs');

const { port } = await startServer(0);
const base = `http://127.0.0.1:${port}`;

const userId = 'tester@example.com';
const { token } = createRsvpSyncToken(userId);

test.after(() => {
  server.close();
});

test('GET /health returns 200 and { ok: true, ts }', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.ts, 'number');
  assert.ok(body.ts > 0);
});

test('POST then GET roundtrips a library payload', async () => {
  const lib = { version: 2, exportedAt: Date.now(), books: [{ id: 'b1', title: 'Hello', contentHash: 'h1' }] };
  const postRes = await fetch(`${base}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(lib),
  });
  assert.equal(postRes.status, 200);
  const postBody = await postRes.json();
  assert.equal(postBody.ok, true);

  const getRes = await fetch(`${base}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.books.length, 1);
  assert.equal(fetched.books[0].id, 'b1');
  assert.equal(fetched.books[0].title, 'Hello');
});

test('exceeding 30 requests in 60s returns 429 with Retry-After', async () => {
  const { token: rateToken } = createRsvpSyncToken('rate-user@example.com');
  let saw429 = false;
  let retryAfter = null;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${base}/`, {
      headers: { Authorization: `Bearer ${rateToken}` },
    });
    if (res.status === 429) {
      saw429 = true;
      retryAfter = res.headers.get('Retry-After');
      break;
    }
  }
  assert.equal(saw429, true, 'expected at least one 429 within 35 requests');
  assert.ok(retryAfter, 'expected Retry-After header on 429');
  const ra = Number(retryAfter);
  assert.ok(ra > 0 && ra <= 60, `expected Retry-After between 1 and 60, got ${ra}`);
});
