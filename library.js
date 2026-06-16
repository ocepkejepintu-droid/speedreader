const DB_NAME = 'rsvp-reader';
const DB_VERSION = 2;
const STORE = 'books';

const SENTENCE_END_RE = /[.!?…](?:["'\)\]\}»]+)?$/;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        let store;
        if (!db.objectStoreNames.contains(STORE)) {
          store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('lastReadAt', 'lastReadAt', { unique: false });
          store.createIndex('title', 'title', { unique: false });
        } else {
          store = e.target.transaction.objectStore(STORE);
        }
        if (!store.indexNames.contains('contentHash')) {
          store.createIndex('contentHash', 'contentHash', { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function buildBoundaries(text, sourceParagraphs = null) {
  const words = text ? text.split(/\s+/).filter(Boolean) : [];

  const sentenceStarts = [0];
  for (let i = 0; i < words.length; i++) {
    if (SENTENCE_END_RE.test(words[i]) && i + 1 < words.length) {
      sentenceStarts.push(i + 1);
    }
  }

  let paragraphs;
  if (sourceParagraphs?.length) {
    paragraphs = sourceParagraphs.map((p) => p.trim()).filter(Boolean);
  } else if (text) {
    paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  } else {
    paragraphs = [];
  }
  if (paragraphs.length === 0 && text) paragraphs = [text.trim()];

  const paragraphStarts = [0];
  let wordOffset = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) paragraphStarts.push(wordOffset);
    wordOffset += countWords(paragraphs[i]);
  }

  return { sentenceStarts, paragraphStarts, paragraphs };
}

/** Rebuild missing or misaligned paragraph/sentence metadata from chapter text. */
export function ensureChapterBoundaries(chapter, wordCount = null) {
  const text = chapter?.text || '';
  let { sentenceStarts, paragraphStarts, paragraphs } = chapter || {};
  let rebuilt = false;

  if (!paragraphs?.length || !sentenceStarts?.length) {
    const b = buildBoundaries(text, paragraphs);
    sentenceStarts = b.sentenceStarts;
    paragraphStarts = b.paragraphStarts;
    paragraphs = b.paragraphs;
    rebuilt = true;
  }

  if (wordCount != null && paragraphs.length) {
    let total = 0;
    for (const p of paragraphs) total += countWords(p);
    if (total !== wordCount) {
      const b = buildBoundaries(text);
      sentenceStarts = b.sentenceStarts;
      paragraphStarts = b.paragraphStarts;
      paragraphs = b.paragraphs;
      rebuilt = true;
    }
  }

  if (rebuilt && chapter) {
    chapter.sentenceStarts = sentenceStarts;
    chapter.paragraphStarts = paragraphStarts;
    chapter.paragraphs = paragraphs;
  }

  return { sentenceStarts, paragraphStarts, paragraphs, rebuilt };
}

async function hashText(text) {
  const buffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function bookProgress(book) {
  if (!book?.chapters?.length) return { wordsRead: 0, total: 0, percent: 0 };
  const total = book.totalWords || book.chapters.reduce((s, c) => s + c.wordCount, 0);
  let wordsRead = 0;
  const ch = book.chapterIndex ?? 0;
  for (let i = 0; i < ch && i < book.chapters.length; i++) {
    wordsRead += book.chapters[i].wordCount;
  }
  wordsRead += book.wordIndex ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((wordsRead / total) * 100)) : 0;
  const chapterTitle = book.chapters[ch]?.title || '';
  return { wordsRead, total, percent, chapterTitle };
}

export function estimateTimeRemaining(book, chapterIndex, wordIndex, avgMsPerWord) {
  if (!book?.chapters?.length) return { chapterSec: 0, bookSec: 0, percent: 0 };

  const total = book.totalWords || book.chapters.reduce((s, c) => s + c.wordCount, 0);
  const ch = chapterIndex ?? book.chapterIndex ?? 0;
  const wi = wordIndex ?? book.wordIndex ?? 0;
  const ms = avgMsPerWord > 0 ? avgMsPerWord : 200;

  let wordsRead = 0;
  for (let i = 0; i < ch && i < book.chapters.length; i++) {
    wordsRead += book.chapters[i].wordCount;
  }
  wordsRead += wi;

  const chapterTotal = book.chapters[ch]?.wordCount ?? 0;
  const wordsRemainingChapter = Math.max(0, chapterTotal - wi);
  const wordsRemainingBook = Math.max(0, total - wordsRead);
  const percent = total > 0 ? Math.min(100, Math.round((wordsRead / total) * 100)) : 0;

  return {
    chapterSec: Math.round((wordsRemainingChapter * ms) / 1000),
    bookSec: Math.round((wordsRemainingBook * ms) / 1000),
    percent,
  };
}

export async function listBooks() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const books = await reqToPromise(tx.objectStore(STORE).getAll());
  return books.sort((a, b) => (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0));
}

export async function getBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return reqToPromise(tx.objectStore(STORE).get(id));
}

export async function findBookByHash(hash) {
  if (!hash) return null;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);

  if (store.indexNames.contains('contentHash')) {
    const matches = await reqToPromise(store.index('contentHash').getAll(hash));
    if (matches.length) return matches[0];
  }

  const all = await reqToPromise(store.getAll());
  return all.find((b) => b.contentHash === hash || b.id === hash) || null;
}

export async function saveBook(parsed, progress = {}) {
  const now = Date.now();
  const existing = await getBook(parsed.id);
  const contentHash = parsed.contentHash ?? parsed.id ?? existing?.contentHash ?? null;
  const record = {
    id: parsed.id,
    contentHash,
    fileName: parsed.fileName,
    title: parsed.title,
    author: parsed.author || '',
    type: parsed.type ?? existing?.type,
    totalWords: parsed.totalWords,
    chapters: parsed.chapters.map((c) => ({
      title: c.title,
      wordCount: c.wordCount,
      text: c.text,
      sentenceStarts: c.sentenceStarts ?? [],
      paragraphStarts: c.paragraphStarts ?? [],
      paragraphs: c.paragraphs ?? [],
    })),
    startChapter: parsed.startChapter ?? 0,
    addedAt: existing?.addedAt ?? now,
    lastReadAt: existing?.lastReadAt ?? now,
    chapterIndex: progress.chapterIndex ?? existing?.chapterIndex ?? parsed.startChapter ?? 0,
    wordIndex: progress.wordIndex ?? existing?.wordIndex ?? 0,
    wpm: progress.wpm ?? existing?.wpm ?? 300,
  };
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await reqToPromise(tx.objectStore(STORE).put(record));
  return record;
}

/**
 * Split paste text into chapters when lines use `## Section title` headers.
 * Returns null when the text is a plain single-chapter article.
 */
export function parseSectionedText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || !/^##\s+/m.test(trimmed)) return null;

  const sections = [];
  for (const chunk of trimmed.split(/\n(?=##\s+)/)) {
    const lines = chunk.split('\n');
    const header = lines[0]?.match(/^##\s+(.+)$/);
    if (!header) continue;
    const sectionTitle = header[1].trim() || 'Section';
    const body = lines.slice(1).join('\n').trim();
    if (body) sections.push({ title: sectionTitle, text: body });
  }

  return sections.length ? sections : null;
}

function chaptersFromSections(sections) {
  return sections.map((section) => {
    const boundaries = buildBoundaries(section.text);
    return {
      title: section.title,
      text: section.text,
      wordCount: countWords(section.text),
      ...boundaries,
    };
  });
}

export async function saveArticle({ title, text, author = '' }) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Article text is empty');

  const sections = parseSectionedText(trimmed);
  const bookTitle = (title || 'Untitled').trim() || 'Untitled';

  if (sections?.length) {
    const canonical = sections.map((s) => `## ${s.title}\n${s.text}`).join('\n\n');
    const contentHash = await hashText(canonical);
    const existing = await findBookByHash(contentHash);
    if (existing) return existing;

    const chapters = chaptersFromSections(sections);
    const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
    return saveBook({
      id: contentHash,
      contentHash,
      fileName: '',
      title: bookTitle,
      author: (author || '').trim(),
      type: 'article',
      totalWords,
      startChapter: 0,
      chapters,
    });
  }

  const contentHash = await hashText(trimmed);
  const existing = await findBookByHash(contentHash);
  if (existing) return existing;

  const wordCount = countWords(trimmed);
  const boundaries = buildBoundaries(trimmed);
  return saveBook({
    id: contentHash,
    contentHash,
    fileName: '',
    title: bookTitle,
    author: (author || '').trim(),
    type: 'article',
    totalWords: wordCount,
    startChapter: 0,
    chapters: [{
      title: 'Article',
      text: trimmed,
      wordCount,
      ...boundaries,
    }],
  });
}

export async function saveProgress(id, { chapterIndex, wordIndex, wpm }) {
  const book = await getBook(id);
  if (!book) return;
  book.chapterIndex = chapterIndex;
  book.wordIndex = wordIndex;
  if (wpm != null) book.wpm = wpm;
  book.lastReadAt = Date.now();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await reqToPromise(tx.objectStore(STORE).put(book));
}

export async function deleteBook(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await reqToPromise(tx.objectStore(STORE).delete(id));
}

export async function exportLibrary() {
  const books = await listBooks();
  return JSON.stringify({
    version: DB_VERSION,
    exportedAt: Date.now(),
    books,
  });
}

function xmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function exportOpml() {
  const books = await listBooks();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>RSVP Reader library</title>',
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];
  for (const b of books) {
    const title = xmlEscape(b.title || 'Untitled');
    const author = xmlEscape(b.author || '');
    lines.push(`    <outline text="${title}"${author ? ` author="${author}"` : ''} type="link"/>`);
  }
  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}

export async function importLibrary(json, { merge = false } = {}) {
  let payload;
  try {
    payload = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('Invalid library JSON');
  }

  const books = Array.isArray(payload) ? payload : payload?.books;
  if (!Array.isArray(books)) throw new Error('Invalid library JSON');

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const db = await openDb();

  for (const book of books) {
    if (!book?.id) {
      skipped++;
      continue;
    }

    const contentHash = book.contentHash ?? book.id;
    const existing = (contentHash && await findBookByHash(contentHash)) || await getBook(book.id);

    if (existing) {
      const remoteReadAt = book.lastReadAt || 0;
      const localReadAt = existing.lastReadAt || 0;
      if (merge && remoteReadAt >= localReadAt) {
        const record = {
          ...existing,
          ...book,
          contentHash,
          id: existing.id,
          chapterIndex: remoteReadAt > localReadAt
            ? (book.chapterIndex ?? existing.chapterIndex)
            : existing.chapterIndex,
          wordIndex: remoteReadAt > localReadAt
            ? (book.wordIndex ?? existing.wordIndex)
            : existing.wordIndex,
          wpm: remoteReadAt > localReadAt
            ? (book.wpm ?? existing.wpm)
            : existing.wpm,
          lastReadAt: Math.max(remoteReadAt, localReadAt),
        };
        const tx = db.transaction(STORE, 'readwrite');
        await reqToPromise(tx.objectStore(STORE).put(record));
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const record = { ...book, contentHash };
    const tx = db.transaction(STORE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE).put(record));
    imported++;
  }

  return { imported, updated, skipped };
}

export async function migrateFromLocalStorage() {
  if (localStorage.getItem('rsvp-idb-migrated') === '1') return;
  const lastId = localStorage.getItem('rsvp-last-book');
  if (!lastId) {
    localStorage.setItem('rsvp-idb-migrated', '1');
    return;
  }
  const raw = localStorage.getItem(`rsvp-book-${lastId}`);
  if (!raw) {
    localStorage.setItem('rsvp-idb-migrated', '1');
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    const ch = parseInt(localStorage.getItem(`rsvp-chapter-${lastId}`) || '0', 10);
    const wordIndex = parseInt(localStorage.getItem(`rsvp-progress-${lastId}-ch${ch}`) || '0', 10);
    const wpm = parseInt(localStorage.getItem('rsvp-wpm') || '300', 10);
    if (!(await getBook(parsed.id))) {
      await saveBook(parsed, { chapterIndex: ch, wordIndex, wpm });
    }
  } catch { /* ignore */ }
  localStorage.setItem('rsvp-idb-migrated', '1');
}

export function formatLastRead(ts) {
  if (!ts) return 'Never read';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString();
}