// Tests for /Users/yoseph/rsvp-reader/sync-server.mjs
// Uses Node's built-in test runner. No external deps.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.RSVP_SYNC_JWT_SECRET = 'test-secret-' + Math.random().toString(36).slice(2);
process.env.RSVP_SYNC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-sync-test-'));

const { server, startServer, atomicWriteJSON, readBoundedBody, MAX_BODY_BYTES } = await import('../sync-server.mjs');
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

test('POST /snapshot rejects non-JSON body with 400', async () => {
  const { token: t } = createRsvpSyncToken('shape-user@example.com');
  const res = await fetch(`${base}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: 'not-json{',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Invalid JSON/);
});

test('POST /snapshot rejects unsupported version with 400', async () => {
  const { token: t } = createRsvpSyncToken('shape-user@example.com');
  const res = await fetch(`${base}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ version: 99, books: [] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.reason, /unsupported version 99/);
});

test('POST /snapshot rejects books-as-non-array with 400', async () => {
  const { token: t } = createRsvpSyncToken('shape-user@example.com');
  const res = await fetch(`${base}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ version: 3, books: 'nope' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.reason, /books must be an array/);
});

test('POST /snapshot accepts a valid v3 snapshot and returns ok', async () => {
  const { token: t } = createRsvpSyncToken('valid-user@example.com');
  const snap = {
    version: 3,
    schemaVersion: 3,
    exportedAt: Date.now(),
    deviceId: 'dev_a',
    books: [
      { cloudBookId: 'hash:h1', contentHash: 'h1', title: 'T', author: 'A', fileName: 'f', totalWords: 100, chapterCount: 1, hasLocalContent: true, progress: { chapterIndex: 0, wordIndex: 5, wpm: 300, updatedAt: Date.now(), deviceId: 'dev_a' } },
    ],
    tombstones: [],
  };
  const res = await fetch(`${base}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(snap),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, 3);
});

test('POST /snapshot rejects body larger than MAX_BODY_BYTES with 413', async () => {
  const { token: t } = createRsvpSyncToken('size-user@example.com');
  // 4 MiB > 2 MiB cap
  const fat = { version: 3, schemaVersion: 3, exportedAt: Date.now(), deviceId: 'd', books: [], tombstones: [] };
  const body = JSON.stringify(fat) + 'x'.repeat(4 * 1024 * 1024);
  const res = await fetch(`${base}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body,
  });
  assert.equal(res.status, 413);
  const j = await res.json();
  assert.equal(j.maxBytes, MAX_BODY_BYTES);
});

test('atomicWriteJSON leaves no temp files on success and overwrites the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-atomic-'));
  const file = path.join(dir, 'data.json');
  await atomicWriteJSON(file, JSON.stringify({ a: 1 }));
  const written = fs.readFileSync(file, 'utf8');
  assert.equal(written, JSON.stringify({ a: 1 }));
  const remaining = fs.readdirSync(dir);
  assert.deepEqual(remaining, ['data.json'], `expected only data.json, got ${remaining.join(',')}`);

  await atomicWriteJSON(file, JSON.stringify({ a: 2 }));
  const written2 = fs.readFileSync(file, 'utf8');
  assert.equal(written2, JSON.stringify({ a: 2 }));
});

test('readBoundedBody throws PAYLOAD_TOO_LARGE when stream exceeds cap', async () => {
  // Build a fake req-like async iterable that yields chunks > cap
  const cap = 100;
  const big = Buffer.alloc(cap * 2, 'a');
  const fakeReq = (async function* () { yield big; })();
  let threw = false;
  try {
    await readBoundedBody(fakeReq, cap);
  } catch (err) {
    threw = err && err.message === 'PAYLOAD_TOO_LARGE';
  }
  assert.equal(threw, true);
});

test('readBoundedBody returns the body when within cap', async () => {
  const cap = 1024;
  const fakeReq = (async function* () {
    yield Buffer.from('hello ');
    yield Buffer.from('world');
  })();
  const out = await readBoundedBody(fakeReq, cap);
  assert.equal(out, 'hello world');
});
