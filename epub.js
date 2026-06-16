const SKIP_TAGS = new Set([
  'head', 'math', 'nav', 'script', 'style', 'svg', 'aside', 'noscript',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_TAGS = new Set([
  'address', 'article', 'blockquote', 'body', 'br', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'header', 'hr', 'li', 'main', 'ol', 'p',
  'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const SKIP_PATH_RE = /(?:^|\/)(?:cover|wrap|nav|toc|titlepage|copyright|dedication|colophon|frontmatter)\b|\.ncx$/i;

let jszipPromise = null;

async function loadJsZip() {
  if (!jszipPromise) {
    jszipPromise = import('./jszip.mjs')
      .then((m) => m.default)
      .catch(() => import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm').then((m) => m.default));
  }
  return jszipPromise;
}

function localName(node) {
  return (node.localName || node.nodeName.split(':').pop()).toLowerCase();
}

function normalizeZipPath(path) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function zipDirname(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx + 1);
}

function zipJoin(base, href) {
  const clean = href.split('#')[0].split('?')[0];
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  if (decoded.startsWith('/')) return decoded.replace(/^\/+/, '');
  return `${zipDirname(base)}${decoded}`;
}

function findZipEntry(zip, requestedPath) {
  const normalized = normalizeZipPath(requestedPath);
  const exact = zip.file(normalized);
  if (exact) return exact;
  const lower = normalized.toLowerCase();
  return Object.values(zip.files).find(
    (e) => !e.dir && normalizeZipPath(e.name).toLowerCase() === lower,
  ) || null;
}

function decodeTextBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function readZipText(zip, path) {
  const entry = findZipEntry(zip, path);
  if (!entry) throw new Error(`Missing EPUB file: ${path}`);
  const bytes = await entry.async('uint8array');
  return decodeTextBytes(bytes);
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${label} is invalid XML`);
  return doc;
}

function firstText(doc, tag) {
  for (const node of doc.getElementsByTagName('*')) {
    if (localName(node) === tag) {
      const t = (node.textContent || '').trim();
      if (t) return t;
    }
  }
  return '';
}

function isContentDoc(path, mediaType) {
  const p = path.toLowerCase();
  const t = (mediaType || '').toLowerCase();
  if (SKIP_PATH_RE.test(p)) return false;
  return (
    t === 'application/xhtml+xml' ||
    t === 'text/html' ||
    p.endsWith('.xhtml') ||
    p.endsWith('.html') ||
    p.endsWith('.htm') ||
    /\.htm\.html$/i.test(p)
  );
}

function isSkippablePath(path) {
  return SKIP_PATH_RE.test(path);
}

function cleanText(raw) {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2000-\u200B\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

const SENTENCE_END_RE = /[.!?…](?:["'\)\]\}»]+)?$/;

function buildBoundaries(text, sourceParagraphs = null) {
  const words = text ? text.split(/\s+/).filter(Boolean) : [];

  const sentenceStarts = [0];
  for (let i = 0; i < words.length; i++) {
    if (SENTENCE_END_RE.test(words[i]) && i + 1 < words.length) {
      sentenceStarts.push(i + 1);
    }
  }

  let paragraphs;
  if (sourceParagraphs && sourceParagraphs.length > 0) {
    paragraphs = sourceParagraphs.map((p) => cleanText(p)).filter(Boolean);
  } else if (text) {
    paragraphs = text.split(/\n\n+/).map((p) => cleanText(p)).filter(Boolean);
  } else {
    paragraphs = [];
  }
  if (paragraphs.length === 0 && text) paragraphs = [cleanText(text)];

  const paragraphStarts = [0];
  let wordOffset = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) paragraphStarts.push(wordOffset);
    wordOffset += countWords(paragraphs[i]);
  }

  return { sentenceStarts, paragraphStarts, paragraphs };
}

export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseHtmlDocument(markup) {
  let doc = new DOMParser().parseFromString(markup, 'text/html');
  const body = doc.body;
  if (!body || countWords(body.textContent || '') < 5) {
    doc = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
  }
  return doc;
}

function htmlToText(markup) {
  const doc = parseHtmlDocument(markup);
  const events = [];
  const textParts = [];
  let chapterTitle = '';

  const flushText = () => {
    const text = cleanText(textParts.join(' '));
    textParts.length = 0;
    if (text) events.push(text);
  };

  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textParts.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    if (HEADING_TAGS.has(tag)) {
      flushText();
      const heading = cleanText(node.textContent || '');
      if (heading && !chapterTitle) chapterTitle = heading;
      return;
    }

    if (tag === 'br' || tag === 'hr') {
      flushText();
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flushText();

    for (const child of node.childNodes) visit(child);

    if (isBlock) flushText();
  };

  const root = doc.body || doc.documentElement;
  if (root) visit(root);
  flushText();

  let text = events.join(' ');
  let paragraphs = events.filter(Boolean);
  const fallback = cleanText((doc.body || doc.documentElement)?.textContent || '');

  // If structured walk missed content (common with XHTML namespaces), use full body text
  if (countWords(text) < countWords(fallback) * 0.5) {
    text = fallback;
    paragraphs = text.split(/\n\n+/).map((p) => cleanText(p)).filter(Boolean);
  }
  if (paragraphs.length === 0 && text) paragraphs = [text];

  if (!chapterTitle) {
    const h = doc.querySelector('h1,h2,h3,h4,h5,h6,title');
    if (h) chapterTitle = cleanText(h.textContent || '');
  }
  if (!chapterTitle) chapterTitle = cleanText(doc.title || '') || 'Chapter';

  return { title: chapterTitle, text, wordCount: countWords(text), paragraphs };
}

async function containerRootfile(zip) {
  const xml = await readZipText(zip, 'META-INF/container.xml');
  const doc = parseXml(xml, 'container.xml');
  for (const node of doc.getElementsByTagName('*')) {
    if (localName(node) === 'rootfile') {
      const path = node.getAttribute('full-path');
      if (path) return path;
    }
  }
  throw new Error('EPUB container.xml has no rootfile');
}

async function parsePackage(zip, opfPath) {
  const xml = await readZipText(zip, opfPath);
  const doc = parseXml(xml, 'package');
  const title = firstText(doc, 'title');
  const author = firstText(doc, 'creator');

  const manifest = new Map();
  for (const node of doc.getElementsByTagName('*')) {
    if (localName(node) !== 'item') continue;
    const id = node.getAttribute('id');
    const href = node.getAttribute('href');
    const mediaType = node.getAttribute('media-type') || '';
    if (!id || !href) continue;
    manifest.set(id, { path: zipJoin(opfPath, href), mediaType, href });
  }

  const spineEntries = [];
  for (const node of doc.getElementsByTagName('*')) {
    if (localName(node) !== 'itemref') continue;
    const idref = node.getAttribute('idref');
    const linear = (node.getAttribute('linear') || 'yes').toLowerCase();
    const item = idref ? manifest.get(idref) : null;
    if (!item) continue;
    spineEntries.push({ ...item, linear });
  }

  let spinePaths = spineEntries
    .filter((e) => e.linear !== 'no' && isContentDoc(e.path, e.mediaType) && !isSkippablePath(e.path))
    .map((e) => e.path);

  if (spinePaths.length === 0) {
    spinePaths = [...manifest.values()]
      .filter((item) => isContentDoc(item.path, item.mediaType) && !isSkippablePath(item.path))
      .map((item) => item.path);
  }

  if (spinePaths.length === 0) {
    spinePaths = Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir)
      .filter((name) => /\.(xhtml|html|htm)$/i.test(name) && !isSkippablePath(name))
      .sort();
  }

  return { title, author, spinePaths };
}

function firstReadableChapterIndex(chapters) {
  const idx = chapters.findIndex((c) => c.wordCount >= 50);
  return idx === -1 ? 0 : idx;
}

export async function parseEpub(file, onProgress) {
  const JSZip = await loadJsZip();
  onProgress?.('Opening EPUB…');
  const zip = await JSZip.loadAsync(file);
  const opfPath = await containerRootfile(zip);
  const { title, author, spinePaths } = await parsePackage(zip, opfPath);
  const id = await hashFile(file);

  const chapters = [];
  for (let i = 0; i < spinePaths.length; i++) {
    onProgress?.(`Reading section ${i + 1} of ${spinePaths.length}…`);
    try {
      const markup = await readZipText(zip, spinePaths[i]);
      const { title: chTitle, text, wordCount, paragraphs } = htmlToText(markup);
      if (wordCount < 8) continue;
      const boundaries = buildBoundaries(text, paragraphs);
      chapters.push({
        index: chapters.length,
        title: chTitle || `Section ${chapters.length + 1}`,
        text,
        wordCount,
        path: spinePaths[i],
        ...boundaries,
      });
    } catch (err) {
      console.warn('Skip spine item', spinePaths[i], err);
    }
  }

  if (chapters.length === 0) throw new Error('No readable text found in this EPUB');

  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
  const startChapter = firstReadableChapterIndex(chapters);

  return {
    id,
    fileName: file.name,
    title: title || file.name.replace(/\.epub$/i, ''),
    author,
    chapters,
    totalWords,
    startChapter,
    fullText: chapters.map((c) => c.text).join('\n\n'),
  };
}

export function parseTxt(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '').trim();
        if (!text) return reject(new Error('File is empty'));
        const wordCount = countWords(text);
        const boundaries = buildBoundaries(text);
        const id = await hashFile(file);
        resolve({
          id,
          fileName: file.name,
          title: file.name.replace(/\.(txt|md|markdown)$/i, ''),
          author: '',
          chapters: [{ index: 0, title: 'Full text', text, wordCount, ...boundaries }],
          totalWords: wordCount,
          startChapter: 0,
          fullText: text,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}