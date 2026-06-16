// Tests for the share-to-RSVP feature (Sprint 5 / v1.1).
//
//   * POST /share with {url, title, text} returns a saved article shape
//   * POST /share with the same payload returns {deduped: true}
//   * POST /share with rate-limit-busting returns 429
//   * article-extract: given a 1KB HTML doc, returns > 100 words of text
//
// Uses Node's built-in test runner. No external deps beyond what's already
// in the project (jsdom is devDep).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvp-share-test-'));
process.env.RSVP_SHARE_DIR = TMP_DIR;

const { server, startServer, _resetRateLimitsForTest } = await import('../share.mjs');
const { handleShareRequest, dedupeKey } = await import('../share-store.mjs');
const { extractArticleFromHtml, fetchAndExtract } = await import('../article-extract.mjs');

const { port } = await startServer(0);
const base = `http://127.0.0.1:${port}`;

test.after(() => {
  server.close();
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('dedupeKey is stable for the same (url, text)', () => {
  const a = dedupeKey('https://example.com', 'hello world');
  const b = dedupeKey('https://example.com', 'hello world');
  const c = dedupeKey('https://example.com', 'hello world!');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('handleShareRequest saves a new article and returns the record shape', async () => {
  const result = handleShareRequest({
    ip: '127.0.0.1',
    url: 'https://example.com/post-1',
    title: 'Post One',
    text: 'First sentence here. Second sentence follows.',
    shareSource: 'json',
  });
  assert.equal(result.deduped, undefined);
  assert.equal(result.title, 'Post One');
  assert.equal(result.text, 'First sentence here. Second sentence follows.');
  assert.equal(result.totalWords, 6);
  assert.ok(result.id);
  assert.ok(result.chapters?.[0]?.sentenceStarts?.length >= 1);
});

test('handleShareRequest returns deduped:true for a repeat save', async () => {
  const args = {
    ip: '127.0.0.2',
    url: 'https://example.com/post-2',
    title: 'Post Two',
    text: 'A short test of the dedupe path on a per-IP bucket.',
    shareSource: 'json',
  };
  const first = handleShareRequest(args);
  const second = handleShareRequest({ ...args, title: 'Different title' });
  assert.equal(first.deduped, undefined);
  assert.equal(second.deduped, true);
  // The existing title should win on a deduped save (we don't overwrite).
  assert.equal(second.title, 'Post Two');
});

test('POST /share JSON roundtrip returns a save-article-shaped body', async () => {
  _resetRateLimitsForTest();
  const res = await fetch(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com/article-a',
      title: 'Article A',
      text: 'The quick brown fox jumps over the lazy dog. This is the second sentence in the paragraph.',
      shareSource: 'json',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, 'Article A');
  assert.ok(body.id, 'expected id in response');
  assert.equal(typeof body.text, 'string');
  assert.ok(body.text.length > 0);
  assert.equal(typeof body.wordCount, 'number');
  assert.ok(body.wordCount > 0);
  assert.equal(body.type, 'article');
  assert.equal(body.deduped, false);
});

test('POST /share with the same body returns {deduped: true}', async () => {
  _resetRateLimitsForTest();
  const payload = {
    url: 'https://example.com/article-b',
    title: 'Article B',
    text: 'Dedup test body. Two sentences in the body. Three? Yes, three.',
    shareSource: 'json',
  };
  const first = await fetch(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const firstBody = await first.json();
  assert.equal(firstBody.deduped, false);

  const second = await fetch(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const secondBody = await second.json();
  assert.equal(secondBody.deduped, true);
  assert.equal(secondBody.id, firstBody.id);
});

test('POST /share with 35 rapid requests returns 429 within 60s', async () => {
  _resetRateLimitsForTest();
  let saw429 = false;
  let retryAfter = null;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${base}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `https://example.com/burst-${i}`,
        title: `Burst ${i}`,
        text: `Burst body number ${i} with a few words.`,
        shareSource: 'json',
      }),
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
  assert.ok(ra > 0 && ra <= 60, `expected Retry-After in 1..60, got ${ra}`);
});

test('POST /share with neither url nor text returns 400', async () => {
  _resetRateLimitsForTest();
  const res = await fetch(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error || '', /url or text/i);
});

test('GET /share returns a friendly HTML explainer', async () => {
  const res = await fetch(`${base}/share`, { method: 'GET' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /RSVP Reader/i);
  assert.match(text, /share/i);
  assert.match(text, /<h1>/);
});

test('GET /share/article/:id returns the saved article (used by the PWA handoff)', async () => {
  _resetRateLimitsForTest();
  const post = await fetch(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com/article-c',
      title: 'Article C',
      text: 'Saved for the article GET endpoint. Two sentences here for good measure.',
      shareSource: 'json',
    }),
  });
  const postBody = await post.json();
  const id = postBody.id;

  const res = await fetch(`${base}/share/article/${id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, id);
  assert.equal(body.title, 'Article C');
  assert.ok(body.text.length > 0);
});

test('GET /share/article/<missing> returns 404', async () => {
  _resetRateLimitsForTest();
  const res = await fetch(`${base}/share/article/0000000000000000000000000000000000000000000000000000000000000000`);
  assert.equal(res.status, 404);
});

test('article-extract: ~1KB HTML doc returns > 100 words of text', () => {
  // Build a chunky article: header, nav, footer, aside, then a real article
  // body with 3 paragraphs of 50+ words each.
  const longPara = (seed) => Array.from({ length: 50 }, (_, i) => `word${i}-${seed}`).join(' ');
  const html = `<!doctype html>
<html><head><title>Real Title</title>
<meta property="og:title" content="OG Title">
</head><body>
<header><h1>Site Name</h1></header>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<aside class="sidebar">Sidebar noise. ${longPara('side')} ${longPara('side2')}</aside>
<main>
  <article>
    <h2>${longPara('head')}</h2>
    <p>${longPara('one')}.</p>
    <p>${longPara('two')}.</p>
    <p>${longPara('three')}.</p>
  </article>
</main>
<footer>Footer noise. ${longPara('foot')}</footer>
<script>console.log('hidden')</script>
<style>.x{color:red}</style>
</body></html>`;
  assert.ok(html.length > 1000, `expected > 1KB html, got ${html.length} chars`);

  const { title, text, wordCount, paragraphs } = extractArticleFromHtml(html, 'https://example.com');
  assert.equal(title, 'OG Title', 'og:title should win over <title>');
  assert.ok(wordCount > 100, `expected > 100 words, got ${wordCount}`);
  assert.ok(paragraphs.length >= 1, 'expected at least one paragraph');
  // Noise must not survive: there should be no <script> or <style> content.
  assert.ok(!/console\.log/.test(text), 'script body should be stripped');
  assert.ok(!/Sidebar noise/.test(text), 'aside text should be stripped');
  assert.ok(!/Footer noise/.test(text), 'footer text should be stripped');
  // And the article's words should be present.
  assert.ok(text.includes('word0-one'), 'first article paragraph should be present');
});

test('article-extract: a 50,001-char input is trimmed to the cap', () => {
  const filler = 'alpha '.repeat(20_000); // ~120k chars; will be capped
  const html = `<html><body><article><p>${filler}</p></article></body></html>`;
  const { text, wordCount } = extractArticleFromHtml(html, 'https://example.com');
  assert.ok(text.length <= 50_000, `expected text.length <= 50000, got ${text.length}`);
  // We still expect a lot of words.
  assert.ok(wordCount > 100, `expected many words before/after trim, got ${wordCount}`);
});

test('article-extract: handles malformed HTML gracefully', () => {
  const html = '<html><body><p>Hello <b>world</b>!<p>Second paragraph.';
  const { text, wordCount } = extractArticleFromHtml(html, 'https://example.com');
  assert.ok(wordCount > 0, 'expected non-zero word count');
  assert.match(text, /Hello world/);
});

test('fetchAndExtract rejects non-http URLs', async () => {
  await assert.rejects(
    () => fetchAndExtract('file:///etc/passwd'),
    /http/i,
  );
});

test('fetchAndExtract reads from a custom fetchImpl', async () => {
  const fakeHtml = '<html><body><article><p>Alpha beta gamma. Delta epsilon zeta.</p></article></body></html>';
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/fake',
    body: null,
    text: async () => fakeHtml,
  });
  const result = await fetchAndExtract('https://example.com/fake', { fetchImpl: fakeFetch });
  assert.equal(result.title, '');
  assert.ok(result.wordCount >= 6, `expected >= 6 words, got ${result.wordCount}`);
  assert.equal(result.finalUrl, 'https://example.com/fake');
});
