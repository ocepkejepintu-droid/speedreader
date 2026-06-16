// article-extract.mjs
// Server-side article extractor. Strips HTML to readable text using a simple
// "densest <p>-container" heuristic. No external deps (intentionally — keep
// the server light).
//
//   import { extractArticleFromHtml, fetchAndExtract } from './article-extract.mjs';
//
//   const { title, text, wordCount } = await fetchAndExtract(url, { fetchImpl });
//
// The extraction is intentionally simple; it's a v1.1 share-target, not a
// Readability port. Tradeoffs documented in the function comments.

import { JSDOM } from 'jsdom';

const NOISE_SELECTOR = 'script,style,noscript,iframe,svg,canvas,video,audio,' +
  'nav,header,footer,aside,form,button,input,select,textarea,' +
  '[role="navigation"],[role="banner"],[role="contentinfo"],' +
  '[aria-hidden="true"],[hidden]';

const MAX_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap on the body

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function normalizeWhitespace(s) {
  return s
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '') // zero-width chars
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeText(node) {
  if (!node) return '';
  // textContent equivalent over a jsdom node
  return Array.from(node.childNodes)
    .map((child) => {
      if (child.nodeType === 3) return child.nodeValue || '';
      if (child.nodeType === 1) return nodeText(child);
      return '';
    })
    .join('');
}

function countWords(s) {
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

function findDensestPContainer(root) {
  // Walk every element; compute total <p> word count in its subtree; pick
  // the highest. The chosen element becomes the article body.
  const candidates = [];

  const walk = (el) => {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'script' || tag === 'style') return;
    const ps = el.querySelectorAll('p');
    let total = 0;
    for (const p of ps) total += countWords(nodeText(p));
    if (total > 0) candidates.push({ el, total });
    for (const child of el.children) walk(child);
  };

  walk(root.body || root);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.total - a.total);
  return candidates[0].el;
}

function paragraphsFromContainer(container) {
  if (!container) return [];
  const out = [];
  const ps = container.querySelectorAll('p');
  if (ps.length) {
    for (const p of ps) {
      const t = normalizeWhitespace(decodeEntities(nodeText(p)));
      if (t.length >= 25) out.push(t);
    }
    if (out.length) return out;
  }
  // Fall back: split the container on <br> boundaries or double newlines.
  // We use innerHTML and reparse fragments to keep the "double-newline"
  // boundary, but for simplicity we fall back to a single dump.
  const text = normalizeWhitespace(decodeEntities(nodeText(container)));
  if (text.length >= 25) out.push(text);
  return out;
}

function htmlToTextParagraphs(html) {
  // Last-ditch: strip tags and split on double newlines (rare; we always try
  // jsdom first). Not used in the primary path.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return [];
  return [normalizeWhitespace(decodeEntities(stripped))];
}

function trimToCharLimit(paragraphs, limit) {
  const out = [];
  let total = 0;
  for (const p of paragraphs) {
    if (total + p.length > limit) {
      const remaining = limit - total;
      if (remaining > 50) out.push(p.slice(0, remaining));
      break;
    }
    out.push(p);
    total += p.length;
    if (total >= limit) break;
  }
  return out;
}

function extractTitle(doc) {
  const candidates = [
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
    doc.querySelector('meta[name="title"]')?.getAttribute('content'),
    doc.querySelector('title')?.textContent,
    doc.querySelector('h1')?.textContent,
  ];
  for (const c of candidates) {
    const t = normalizeWhitespace(decodeEntities(c || ''));
    if (t && t.length <= 300) return t;
  }
  return '';
}

/**
 * Extract article text from a raw HTML string.
 * @param {string} html
 * @param {string} [fallbackUrl] used only for context
 * @returns {{ title: string, text: string, wordCount: number, paragraphs: string[] }}
 */
export function extractArticleFromHtml(html, fallbackUrl = '') {
  let dom;
  try {
    dom = new JSDOM(html, {
      url: fallbackUrl || 'about:blank',
      contentType: 'text/html',
    });
  } catch {
    const paragraphs = htmlToTextParagraphs(html || '');
    const text = paragraphs.join('\n\n');
    return {
      title: '',
      text,
      wordCount: countWords(text),
      paragraphs,
    };
  }

  const { document } = dom.window;
  // Strip noise first
  document.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove());

  const title = extractTitle(document);
  const densest = findDensestPContainer(document);
  let paragraphs = densest ? paragraphsFromContainer(densest) : [];

  if (paragraphs.length === 0) {
    // Fall back: all <p> anywhere
    const all = document.querySelectorAll('p');
    for (const p of all) {
      const t = normalizeWhitespace(decodeEntities(nodeText(p)));
      if (t.length >= 25) paragraphs.push(t);
    }
  }

  if (paragraphs.length === 0) {
    // Last-ditch: try <article> or <main> text
    const main = document.querySelector('article, main');
    if (main) {
      const t = normalizeWhitespace(decodeEntities(nodeText(main)));
      if (t.length > 0) paragraphs = [t];
    }
  }

  if (paragraphs.length === 0) {
    paragraphs = htmlToTextParagraphs(html || '');
  }

  paragraphs = trimToCharLimit(paragraphs, MAX_CHARS);
  const text = paragraphs.join('\n\n');
  return { title, text, wordCount: countWords(text), paragraphs };
}

/**
 * Fetch a URL and extract article text.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, maxBytes?: number, timeoutMs?: number }} [opts]
 */
export async function fetchAndExtract(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('No fetch implementation available');
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are supported');

  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'RSVPReader/1.1 (+https://zipang.id/rsvp/)',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Fetch failed: ${err?.message || 'network error'}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`Fetch returned HTTP ${res.status}`);
  }

  // Cap the body size
  const reader = res.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return { ...extractArticleFromHtml(html, url), finalUrl: res.url || url };
  }

  const text = await res.text();
  if (text.length > maxBytes) throw new Error(`Response exceeded ${maxBytes} bytes`);
  return { ...extractArticleFromHtml(text, url), finalUrl: res.url || url };
}
