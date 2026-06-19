// Tests for the gamify telemetry helper added to reader-app.js.
//
// The reader-app.js module is browser-only and depends on localStorage; we
// test the contract by spinning up a minimal global polyfill and importing
// the exported helpers directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const READER_APP = resolve(REPO_ROOT, 'reader-app.js');

function withGlobalStore(fn) {
  const store = new Map();
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    console,
    window: { location: { search: '' } },
    document: { baseURI: pathToFileURL(REPO_ROOT + '/').href },
  };
  const prev = {};
  for (const k of Object.keys(sandbox)) {
    prev[k] = globalThis[k];
    globalThis[k] = sandbox[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(sandbox)) {
        if (prev[k] === undefined) delete globalThis[k];
        else globalThis[k] = prev[k];
      }
    });
}

async function importFresh() {
  // Stamp a unique URL per call so Node treats each test as a fresh module
  // load — caches from earlier tests would otherwise leak the polyfilled
  // localStorage. Using a file:// URL is required because Node refuses the
  // raw file path with a query string appended.
  const u = new URL(`file://${READER_APP}`);
  u.searchParams.set('t', String(Date.now()));
  u.searchParams.set('r', String(Math.random()));
  return import(u.href);
}

test('trackGamify appends events with the allowed shape', async () => {
  await withGlobalStore(async () => {
    const mod = await importFresh();
    mod.trackGamify('reward_equip', { id: 'icon-midnight', category: 'icon' });
    const events = mod.getGamifyEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'reward_equip');
    assert.equal(events[0].id, 'icon-midnight');
    assert.equal(events[0].category, 'icon');
    assert.equal(typeof events[0].ts, 'number');
  });
});

test('trackGamify drops unknown event types', async () => {
  await withGlobalStore(async () => {
    const mod = await importFresh();
    mod.trackGamify('not_a_real_event', { foo: 'bar' });
    assert.deepEqual(mod.getGamifyEvents(), []);
  });
});

test('trackGamify strips non-primitive payload values', async () => {
  await withGlobalStore(async () => {
    const mod = await importFresh();
    mod.trackGamify('level_up', {
      level: 3,
      note: 'ok',
      bad: { nested: 'object' },
      arr: [1, 2, 3],
      nothing: null,
    });
    const [ev] = mod.getGamifyEvents();
    assert.equal(ev.level, 3);
    assert.equal(ev.note, 'ok');
    assert.equal(ev.bad, undefined);
    assert.equal(ev.arr, undefined);
    assert.equal(ev.nothing, null);
  });
});

test('getGamifyEvents returns events newest-first', async () => {
  await withGlobalStore(async () => {
    const mod = await importFresh();
    mod.trackGamify('reward_equip', { id: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    mod.trackGamify('reward_equip', { id: 'b' });
    const [first, second] = mod.getGamifyEvents();
    assert.equal(first.id, 'b');
    assert.equal(second.id, 'a');
  });
});

test('events buffer is capped at 500 entries', async () => {
  await withGlobalStore(async () => {
    const mod = await importFresh();
    for (let i = 0; i < 510; i += 1) {
      mod.trackGamify('reward_equip', { id: `r${i}` });
    }
    const events = mod.getGamifyEvents();
    assert.equal(events.length, 500);
    // Newest first means the last-write wins, and the oldest 10 are dropped.
    assert.equal(events[0].id, 'r509');
    assert.equal(events[499].id, 'r10');
  });
});

test('survives corrupted JSON in localStorage', async () => {
  await withGlobalStore(async () => {
    globalThis.localStorage.setItem('rsvp-gamify-events', 'not-json');
    const mod = await importFresh();
    mod.trackGamify('reward_equip', { id: 'after-corrupt' });
    const events = mod.getGamifyEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'after-corrupt');
  });
});
