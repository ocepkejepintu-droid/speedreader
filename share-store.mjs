// share-store.mjs
// v1.1 — persistence layer for /share articles. Mirrors the browser-side
// `saveArticle` shape so the client can adopt an article returned from the
// server as if it came from the local IndexedDB.
//
// Dedupe key: SHA-256 of (url + "\n" + text) — same URL + same text = same
// article, which matches the way `library.js#saveArticle` does it on the
// client (hash of the text only). We use url + text here so the share sheet
// can also distinguish a slightly-different excerpt of the same URL from a
// true duplicate.
//
// Per-IP storage: this is a single-user personal tool right now, so we
// key articles by client IP. The PWA reader (the same user, in their
// browser) will hit /share via the same IP when triggered from the PWA
// share sheet, so this works end-to-end for the v1.1 demo. Real auth and
// cross-device sync is a v1.2 problem.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SENTENCE_END_RE = /[.!?…](?:["'\)\]\}»]+)?$/;

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function dedupeKey(url, text) {
  return hash(`${url || ''}\n${text || ''}`);
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function buildBoundaries(text) {
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const sentenceStarts = [0];
  for (let i = 0; i < words.length; i++) {
    if (SENTENCE_END_RE.test(words[i]) && i + 1 < words.length) {
      sentenceStarts.push(i + 1);
    }
  }
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0 && text) paragraphs = [text.trim()];
  const paragraphStarts = [0];
  let wordOffset = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) paragraphStarts.push(wordOffset);
    wordOffset += countWords(paragraphs[i]);
  }
  return { sentenceStarts, paragraphStarts, paragraphs };
}

function ipFilePath(dataDir, ip) {
  // Sanitise the IP. IPv6 colons and other punctuation get hexed out.
  const safe = String(ip).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return path.join(dataDir, `share-${safe}.json`);
}

function ipBucketKey(ip) {
  return String(ip).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'unknown';
}

function readBucket(dataDir, ip) {
  const fp = ipFilePath(dataDir, ip);
  if (!fs.existsSync(fp)) return { version: 1, articles: {} };
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, articles: {} };
    if (!parsed.articles || typeof parsed.articles !== 'object') parsed.articles = {};
    return parsed;
  } catch { return { version: 1, articles: {} }; }
}

function writeBucket(dataDir, ip, bucket) {
  const fp = ipFilePath(dataDir, ip);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bucket));
  fs.renameSync(tmp, fp);
}

function defaultDataDir() {
  return process.env.RSVP_SHARE_DIR || path.join(process.cwd(), 'share-data');
}

/**
 * Save (or dedupe) a shared article under the given IP bucket.
 * Returns a record shaped like `library.js#saveArticle` would produce on
 * the client: { id, contentHash, title, text, wordCount, boundaries,
 *   chapter: {...}, chapters: [...], totalWords, ... }.
 *
 * If the same (url, text) was already shared from the same IP, returns
 * the existing record and marks it with `deduped: true`.
 *
 * @param {{
 *   url: string, title: string, text: string,
 *   shareSource?: string, ip: string,
 *   dataDir?: string, now?: number,
 * }} input
 */
function handleShareRequest(input) {
  const dataDir = input.dataDir || defaultDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const ip = input.ip || 'unknown';
  const now = input.now || Date.now();

  const key = dedupeKey(input.url, input.text);
  const bucket = readBucket(dataDir, ip);
  const existing = bucket.articles[key];
  if (existing) {
    existing.lastSharedAt = now;
    existing.shareCount = (existing.shareCount || 1) + 1;
    bucket.articles[key] = existing;
    writeBucket(dataDir, ip, bucket);
    return { ...existing, deduped: true };
  }

  const wordCount = countWords(input.text);
  const boundaries = buildBoundaries(input.text);
  const record = {
    id: key,
    contentHash: key,
    fileName: '',
    title: (input.title || 'Shared article').trim() || 'Shared article',
    author: '',
    type: 'article',
    sourceUrl: input.url || '',
    shareSource: input.shareSource || 'unknown',
    totalWords: wordCount,
    text: input.text,
    wordCount,
    boundaries,
    startChapter: 0,
    addedAt: now,
    lastReadAt: now,
    lastSharedAt: now,
    shareCount: 1,
    chapterIndex: 0,
    wordIndex: 0,
    wpm: 300,
    chapter: {
      title: 'Article',
      text: input.text,
      wordCount,
      ...boundaries,
    },
    chapters: [{
      title: 'Article',
      text: input.text,
      wordCount,
      ...boundaries,
    }],
  };

  bucket.articles[key] = record;
  writeBucket(dataDir, ip, bucket);
  return record;
}

/**
 * Build the wire response. Strips the `chapter` (server-only convenience)
 * and keeps the `chapters[]` array the client expects.
 */
function buildShareResponse(result) {
  // If the result is already in wire shape (e.g. coming from
  // /share/article/:id which stored the full record), normalise it.
  if (!result || (result.chapters === undefined && result.boundaries !== undefined)) {
    return {
      id: result?.id,
      contentHash: result?.contentHash,
      title: result?.title,
      text: result?.text,
      wordCount: result?.wordCount || countWords(result?.text || ''),
      boundaries: result?.boundaries || null,
      type: result?.type || 'article',
      sourceUrl: result?.sourceUrl,
      shareSource: result?.shareSource,
      deduped: !!result?.deduped,
    };
  }
  const chapter0 = result.chapters?.[0];
  return {
    id: result.id,
    contentHash: result.contentHash,
    title: result.title,
    text: result.text,
    wordCount: result.wordCount || countWords(result.text || ''),
    boundaries: chapter0
      ? {
          sentenceStarts: chapter0.sentenceStarts,
          paragraphStarts: chapter0.paragraphStarts,
          paragraphs: chapter0.paragraphs,
        }
      : null,
    type: 'article',
    sourceUrl: result.sourceUrl,
    shareSource: result.shareSource,
    deduped: !!result.deduped,
  };
}

export {
  dedupeKey,
  handleShareRequest,
  buildShareResponse,
  readBucket,
  writeBucket,
  ipBucketKey,
  countWords,
  buildBoundaries,
};
