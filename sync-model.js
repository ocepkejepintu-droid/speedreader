// sync-model.js
// Pure ES module for cross-device RSVP Reader progress sync.
//
// Responsibilities:
//   - Build a versioned account sync snapshot from a local library.
//   - Merge a remote snapshot into a local library deterministically.
//   - Resolve progress conflicts by progressUpdatedAt and absoluteWordIndex.
//   - Support cloud placeholders (hasLocalContent: false) so a book the user
//     has read on another device appears in the library with title/author/
//     progress, even when the local EPUB text has not been re-uploaded.
//   - Never delete local books just because they're missing on the server
//     (deletion is explicit via tombstones).
//
// Backward compatible with the existing version 2 export shape.

const SNAPSHOT_VERSION = 3;
const CONFLICT_WINDOW_MS = 2000; // timestamps within this are treated as a tie

/**
 * Compute the absolute word index for a (chapterIndex, wordIndex) pair
 * based on a book's chapter word counts.
 *
 * @param {{chapters?: Array<{wordCount:number}>}|null|undefined} book
 * @param {number} chapterIndex
 * @param {number} wordIndex
 * @returns {number}
 */
export function absoluteWordIndex(book, chapterIndex, wordIndex) {
  if (!book?.chapters?.length) return Math.max(0, wordIndex | 0);
  const chMax = book.chapters.length;
  // Past the last chapter counts as "the whole book plus this offset".
  const requested = Math.max(0, chapterIndex | 0);
  const ch = Math.min(requested, chMax);
  const wi = Math.max(0, wordIndex | 0);
  let total = 0;
  for (let i = 0; i < ch; i++) total += book.chapters[i]?.wordCount || 0;
  return total + wi;
}

/**
 * @typedef {Object} ProgressRecord
 * @property {number} chapterIndex
 * @property {number} wordIndex
 * @property {number} [absoluteWordIndex]
 * @property {number} [wpm]
 * @property {number} updatedAt         ms epoch — strict monotonic
 * @property {number} [progressUpdatedAt] alias for updatedAt; one is set
 * @property {string} [deviceId]
 */

/**
 * Normalize any progress-shaped object into { chapterIndex, wordIndex,
 * absoluteWordIndex, wpm, updatedAt, deviceId }.
 */
export function normalizeProgress(progress, book = null, deviceId = null) {
  const chapterIndex = Math.max(0, progress?.chapterIndex | 0);
  const wordIndex = Math.max(0, progress?.wordIndex | 0);
  const absolute = progress?.absoluteWordIndex != null
    ? Math.max(0, progress.absoluteWordIndex | 0)
    : absoluteWordIndex(book, chapterIndex, wordIndex);
  const updatedAt = Math.max(
    0,
    Number(progress?.progressUpdatedAt ?? progress?.updatedAt ?? progress?.lastReadAt ?? 0),
  );
  const wpm = progress?.wpm != null ? Math.max(0, progress.wpm | 0) : null;
  return { chapterIndex, wordIndex, absoluteWordIndex: absolute, wpm, updatedAt, deviceId: progress?.deviceId ?? deviceId ?? null };
}

/**
 * Resolve a progress conflict deterministically.
 *
 * Rules:
 *   1. If either side is missing, the other side wins.
 *   2. If timestamps differ by more than the conflict window, the newer one wins.
 *   3. If timestamps are within the window, the side with the larger
 *      absoluteWordIndex wins (furthest progress). Ties keep local.
 */
export function resolveProgressConflict(localProg, remoteProg) {
  if (!localProg && !remoteProg) return null;
  if (!localProg) return remoteProg;
  if (!remoteProg) return localProg;

  const dt = Math.abs((localProg.updatedAt || 0) - (remoteProg.updatedAt || 0));
  if (dt > CONFLICT_WINDOW_MS) {
    return (remoteProg.updatedAt || 0) > (localProg.updatedAt || 0) ? remoteProg : localProg;
  }

  // Conflict window: take furthest progress, break ties in favour of local
  // to avoid gratuitous cloud overwrites when both devices just opened the app.
  if ((remoteProg.absoluteWordIndex || 0) > (localProg.absoluteWordIndex || 0)) {
    return remoteProg;
  }
  return localProg;
}

/**
 * Build a versioned account sync snapshot from a local library. Chapter text
 * is omitted so the payload stays small and privacy-friendly — only metadata
 * + progress + deviceId travels. Placeholders (hasLocalContent: false) are
 * only produced for books that already have a known cloudBookId; new uploads
 * always have content.
 */
export function buildAccountSnapshot(localBooks, {
  deviceId = null,
  exportedAt = Date.now(),
  tombstones = [],
} = {}) {
  const books = (Array.isArray(localBooks) ? localBooks : []).map((book) => {
    const hasLocalContent = !!(book?.chapters?.length && book.chapters.some((c) => c.text));
    const contentHash = book?.contentHash || book?.id || null;
    const cloudBookId = contentHash ? `hash:${contentHash}` : null;
    const totalWords = book?.totalWords
      || (book?.chapters || []).reduce((s, c) => s + (c.wordCount || 0), 0);
    return {
      cloudBookId,
      contentHash,
      title: book?.title || '',
      author: book?.author || '',
      fileName: book?.fileName || '',
      totalWords,
      chapterCount: book?.chapters?.length || 0,
      hasLocalContent,
      progress: book ? normalizeProgress(book, book, deviceId) : null,
    };
  });

  return {
    version: SNAPSHOT_VERSION,
    schemaVersion: SNAPSHOT_VERSION,
    exportedAt,
    deviceId,
    books: books.filter((b) => b.contentHash),
    tombstones: Array.isArray(tombstones) ? tombstones : [],
  };
}

/**
 * Parse a JSON or already-parsed payload into a normalized account snapshot.
 * Accepts version 2 (legacy library export) and version 3 (account snapshot).
 */
export function parseAccountSnapshot(raw) {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid sync payload');
  }

  if (payload.version === 2 && Array.isArray(payload.books)) {
    // Legacy library export: convert to version 3 snapshot
    return {
      version: SNAPSHOT_VERSION,
      schemaVersion: SNAPSHOT_VERSION,
      exportedAt: payload.exportedAt ?? null,
      deviceId: null,
      books: payload.books
        .filter((b) => b?.id || b?.contentHash)
        .map((b) => {
          const contentHash = b.contentHash || b.id;
          const hasLocalContent = !!(b.chapters?.length && b.chapters.some((c) => c.text));
          return {
            cloudBookId: `hash:${contentHash}`,
            contentHash,
            title: b.title || '',
            author: b.author || '',
            fileName: b.fileName || '',
            totalWords: b.totalWords || (b.chapters || []).reduce((s, c) => s + (c.wordCount || 0), 0),
            chapterCount: b.chapters?.length || 0,
            hasLocalContent,
            progress: b ? normalizeProgress(b, b) : null,
          };
        }),
      tombstones: [],
    };
  }

  if (payload.version === SNAPSHOT_VERSION || payload.schemaVersion === SNAPSHOT_VERSION) {
    return {
      version: SNAPSHOT_VERSION,
      schemaVersion: payload.schemaVersion ?? SNAPSHOT_VERSION,
      exportedAt: payload.exportedAt ?? null,
      deviceId: payload.deviceId ?? null,
      books: Array.isArray(payload.books) ? payload.books : [],
      tombstones: Array.isArray(payload.tombstones) ? payload.tombstones : [],
    };
  }

  // Unknown payload — return as-is so caller can decide what to do
  return {
    version: payload.version ?? 0,
    schemaVersion: payload.schemaVersion ?? 0,
    exportedAt: payload.exportedAt ?? null,
    deviceId: payload.deviceId ?? null,
    books: Array.isArray(payload.books) ? payload.books : [],
    tombstones: Array.isArray(payload.tombstones) ? payload.tombstones : [],
  };
}

/**
 * Merge a remote account snapshot into a local library.
 *
 * Per-book, keyed by contentHash:
 *   - Both have content + same hash: merge metadata, choose progress by
 *     resolveProgressConflict.
 *   - Remote has no content (placeholder) and local has content matching
 *     the hash: attach local chapters/text to the remote progress slot,
 *     preserving the remote progress.
 *   - Local has no content but remote has content: keep a placeholder record
 *     locally so the book still appears in the library. The placeholder keeps
 *     remote progress and asks the user to re-upload the EPUB to continue.
 *   - Remote is a tombstone and local has a matching record: delete it.
 *   - Remote is missing for a local book: leave local untouched (never delete
 *     implicitly).
 *
 * @param {Array} localBooks  full local library array
 * @param {Object} remote     parsed account snapshot (from parseAccountSnapshot)
 * @param {Object} [opts]
 * @param {string} [opts.deviceId]  current device id
 * @returns {{ books: Array, tombstones: Array, conflicts: Array, attached: number, placeholders: number, deleted: number }}
 */
export function mergeAccountSnapshot(localBooks, remote, { deviceId = null } = {}) {
  const local = Array.isArray(localBooks) ? localBooks.slice() : [];
  const remoteBooks = Array.isArray(remote?.books) ? remote.books : [];
  const remoteTombstones = Array.isArray(remote?.tombstones) ? remote.tombstones : [];

  const tombstoneSet = new Set(
    remoteTombstones
      .map((t) => (typeof t === 'string' ? t : t?.contentHash))
      .filter(Boolean),
  );

  const byHash = new Map();
  for (const b of local) {
    const key = b?.contentHash || b?.id;
    if (key) byHash.set(key, b);
  }

  const conflicts = [];
  let attached = 0;
  let placeholders = 0;
  let deleted = 0;

  for (const remoteBook of remoteBooks) {
    const hash = remoteBook?.contentHash;
    if (!hash) continue;
    const localBook = byHash.get(hash) || byHash.get(remoteBook?.cloudBookId);
    const localHasContent = !!(localBook?.chapters?.length && localBook.chapters.some((c) => c.text));
    const remoteHasContent = !!remoteBook.hasLocalContent;

    if (tombstoneSet.has(hash)) {
      if (localBook) {
        const idx = local.indexOf(localBook);
        if (idx >= 0) local.splice(idx, 1);
        deleted++;
      }
      continue;
    }

    if (localBook && localHasContent && remoteHasContent) {
      // Both sides have content + same hash: merge metadata + progress.
      // Remote progress is wrapped in { progress: { chapterIndex, ... } } on a
      // version-3 snapshot, but normalizeProgress reads the fields directly —
      // so unwrap if the snapshot shape is present.
      const remoteProgressRaw = remoteBook.progress && typeof remoteBook.progress === 'object'
        ? remoteBook.progress
        : remoteBook;
      const localProg = normalizeProgress(localBook, localBook, deviceId);
      const remoteProg = normalizeProgress(remoteProgressRaw, localBook, remoteBook.deviceId ?? remoteProgressRaw.deviceId ?? null);
      const winner = resolveProgressConflict(localProg, remoteProg);
      if (winner !== localProg && winner !== remoteProg) {
        conflicts.push({ contentHash: hash, resolution: 'furthest' });
      } else if (winner === remoteProg && remoteProg.updatedAt > (localProg.updatedAt || 0)) {
        conflicts.push({ contentHash: hash, resolution: 'remote-newer' });
      }
      // Adopt remote metadata fields only when local doesn't already have them,
      // and always keep local chapters/text (they're the canonical content).
      localBook.title = localBook.title || remoteBook.title || '';
      localBook.author = localBook.author || remoteBook.author || '';
      localBook.fileName = localBook.fileName || remoteBook.fileName || '';
      if (winner === remoteProg) {
        localBook.chapterIndex = remoteProg.chapterIndex;
        localBook.wordIndex = remoteProg.wordIndex;
        if (remoteProg.wpm != null) localBook.wpm = remoteProg.wpm;
        localBook.progressUpdatedAt = remoteProg.updatedAt;
        localBook.lastReadAt = Math.max(remoteProg.updatedAt, localBook.lastReadAt || 0);
        localBook.lastSyncedFromDeviceId = remoteBook.deviceId ?? remoteProg.deviceId ?? null;
      } else {
        localBook.progressUpdatedAt = Math.max(localProg.updatedAt, remoteProg.updatedAt || 0);
        localBook.lastReadAt = Math.max(localBook.progressUpdatedAt, localBook.lastReadAt || 0);
      }
      continue;
    }

    if (localBook && localHasContent && !remoteHasContent) {
      // Local has content; remote is a placeholder. The local content
      // "attaches" to the cloud slot and we preserve any remote progress.
      const remoteProgressRaw = remoteBook.progress && typeof remoteBook.progress === 'object'
        ? remoteBook.progress
        : remoteBook;
      const remoteProg = normalizeProgress(remoteProgressRaw, localBook, remoteBook.deviceId ?? remoteProgressRaw.deviceId ?? null);
      if (remoteProg.updatedAt > (localBook.lastReadAt || 0)) {
        localBook.chapterIndex = remoteProg.chapterIndex;
        localBook.wordIndex = remoteProg.wordIndex;
        if (remoteProg.wpm != null) localBook.wpm = remoteProg.wpm;
        localBook.lastReadAt = remoteProg.updatedAt;
      }
      localBook.progressUpdatedAt = localBook.progressUpdatedAt || localBook.lastReadAt || Date.now();
      localBook.lastSyncedFromDeviceId = remoteBook.deviceId ?? remoteProg.deviceId ?? null;
      continue;
    }

    if (localBook && !localHasContent && remoteHasContent) {
      // Local was a placeholder; remote has actual content. Trust remote
      // metadata but keep local placeholder record (we don't push chapter text
      // in the account sync payload). Mark needsReupload if chapter data is
      // genuinely missing locally.
      localBook.title = localBook.title || remoteBook.title || '';
      localBook.author = localBook.author || remoteBook.author || '';
      localBook.fileName = localBook.fileName || remoteBook.fileName || '';
      const remoteProgressRaw = remoteBook.progress && typeof remoteBook.progress === 'object'
        ? remoteBook.progress
        : remoteBook;
      const remoteProg = normalizeProgress(remoteProgressRaw, localBook, remoteBook.deviceId ?? remoteProgressRaw.deviceId ?? null);
      if (!localBook.chapterIndex && remoteProg.chapterIndex) {
        localBook.chapterIndex = remoteProg.chapterIndex;
        localBook.wordIndex = remoteProg.wordIndex;
      }
      if (remoteProg.wpm != null) localBook.wpm = remoteProg.wpm;
      localBook.lastReadAt = Math.max(localBook.lastReadAt || 0, remoteProg.updatedAt);
      localBook.progressUpdatedAt = Math.max(localBook.progressUpdatedAt || 0, remoteProg.updatedAt);
      continue;
    }

    if (!localBook) {
      // No local book at all — create a placeholder record so it shows in the
      // library with title/author/progress.
      const placeholder = {
        id: hash,
        contentHash: hash,
        cloudBookId: remoteBook.cloudBookId || `hash:${hash}`,
        title: remoteBook.title || '',
        author: remoteBook.author || '',
        fileName: remoteBook.fileName || '',
        type: 'book',
        totalWords: remoteBook.totalWords || 0,
        chapters: [],
        startChapter: 0,
        addedAt: remoteBook.exportedAt || Date.now(),
        lastReadAt: 0,
        chapterIndex: remoteBook.progress?.chapterIndex || 0,
        wordIndex: remoteBook.progress?.wordIndex || 0,
        wpm: remoteBook.progress?.wpm || 300,
        progressUpdatedAt: remoteBook.progress?.updatedAt || 0,
        lastSyncedFromDeviceId: remoteBook.deviceId ?? remoteBook.progress?.deviceId ?? null,
        needsReupload: true,
        isCloudPlaceholder: true,
      };
      local.push(placeholder);
      placeholders++;
      continue;
    }

    // localBook exists but localHasContent is false and remoteHasContent is also
    // false — both are placeholders. Update progress by conflict policy.
    const localProg = normalizeProgress(localBook, localBook, deviceId);
    const remoteProgressRaw = remoteBook.progress && typeof remoteBook.progress === 'object'
      ? remoteBook.progress
      : remoteBook;
    const remoteProg = normalizeProgress(remoteProgressRaw, localBook, remoteBook.deviceId ?? remoteProgressRaw.deviceId ?? null);
    const winner = resolveProgressConflict(localProg, remoteProg);
    if (winner === remoteProg) {
      localBook.chapterIndex = remoteProg.chapterIndex;
      localBook.wordIndex = remoteProg.wordIndex;
      if (remoteProg.wpm != null) localBook.wpm = remoteProg.wpm;
      localBook.progressUpdatedAt = remoteProg.updatedAt;
      localBook.lastReadAt = Math.max(localBook.lastReadAt || 0, remoteProg.updatedAt);
      localBook.lastSyncedFromDeviceId = remoteBook.deviceId ?? remoteProg.deviceId ?? null;
    }
  }

  // No destructive pull: local books not present on the server are kept.
  // Apply tombstones last so a "deleted on server" entry overrides any later
  // remote book record with the same hash.
  for (const tomb of tombstoneSet) {
    const target = byHash.get(tomb) || local.find((b) => b?.contentHash === tomb || b?.id === tomb);
    if (target) {
      const idx = local.indexOf(target);
      if (idx >= 0) {
        local.splice(idx, 1);
        deleted++;
      }
    }
  }

  return {
    books: local,
    tombstones: Array.from(tombstoneSet),
    conflicts,
    attached,
    placeholders,
    deleted,
  };
}

/**
 * Validate the structural shape of a payload suitable for the sync server.
 * Returns null on success, or a string error message on failure.
 */
export function validateSnapshotShape(payload) {
  if (!payload || typeof payload !== 'object') return 'payload must be an object';
  const v = payload.version ?? payload.schemaVersion;
  if (v !== 2 && v !== 3) return `unsupported version ${v}`;
  if (payload.books != null && !Array.isArray(payload.books)) return 'books must be an array';
  if (payload.tombstones != null && !Array.isArray(payload.tombstones)) return 'tombstones must be an array';
  return null;
}

/**
 * Generate (or fetch) a stable per-device id.
 *
 * Stored under the given localStorage-like shim. Returns a short string id.
 */
export function getOrCreateDeviceId(storage) {
  if (!storage) return null;
  try {
    let id = storage.getItem('rsvp-device-id');
    if (!id) {
      const rand = Math.random().toString(36).slice(2, 10);
      id = `dev_${Date.now().toString(36)}_${rand}`;
      storage.setItem('rsvp-device-id', id);
    }
    return id;
  } catch {
    return null;
  }
}

export { SNAPSHOT_VERSION, CONFLICT_WINDOW_MS };
