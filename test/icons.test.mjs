// Verify the generated PWA icons at /Users/yoseph/rsvp-reader/icons/.
//
// Each test:
//   1. The file exists.
//   2. The PNG signature (89 50 4E 47 0D 0A 1A 0A) is correct.
//   3. The IHDR chunk declares the expected width and height.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ICONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// Minimal PNG parser — only what's needed to validate the signature and the
// IHDR width/height. We deliberately do not pull in a full PNG decoder; the
// build-icons.mjs script is also a from-scratch encoder, so checking the
// bytes the encoder writes is enough to validate the contract.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngHeader(buf) {
  if (buf.length < 24) {
    throw new Error(`PNG too small: ${buf.length} bytes`);
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG signature mismatch');
  }
  // Bytes 8..12 = IHDR chunk length (4), then 'IHDR' (4), then width (4 BE).
  // We read width and height directly.
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

const SIZES = [16, 32, 180, 192, 512];
const REWARD_VARIANTS = ['midnight', 'ember', 'obsidian', 'crystal', 'gold'];

for (const size of SIZES) {
  test(`icon-${size}.png exists with the correct PNG header and dimensions`, () => {
    const path = resolve(ICONS_DIR, `icon-${size}.png`);
    assert.ok(existsSync(path), `expected ${path} to exist`);
    const buf = readFileSync(path);
    assert.ok(buf.length > 0, `${path} must not be empty`);
    assert.ok(
      buf.subarray(0, 8).equals(PNG_SIGNATURE),
      `${path} must start with the PNG signature 89 50 4E 47 0D 0A 1A 0A; ` +
      `got ${[...buf.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
    );
    const { width, height } = parsePngHeader(buf);
    assert.equal(width, size, `${path} width should be ${size}, got ${width}`);
    assert.equal(height, size, `${path} height should be ${size}, got ${height}`);
  });
}

test('all 5 icon sizes are present (set regression guard)', () => {
  for (const size of SIZES) {
    assert.ok(
      existsSync(resolve(ICONS_DIR, `icon-${size}.png`)),
      `icon-${size}.png must exist; the build-icons.mjs default set is ${SIZES.join(', ')}`,
    );
  }
});

test('icon PNGs include a terminator IEND chunk', () => {
  // A well-formed PNG ends with the IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82.
  // We check just the last 12 bytes of each file.
  const IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  for (const size of SIZES) {
    const buf = readFileSync(resolve(ICONS_DIR, `icon-${size}.png`));
    const tail = buf.subarray(buf.length - 12);
    assert.ok(
      tail.equals(IEND),
      `icon-${size}.png must end with the IEND chunk; ` +
      `got ${[...tail].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
    );
  }
});

test('build-icons.mjs script is syntactically valid and reproducible', () => {
  // We do not execute the script here — `node --check` already ran in the
  // build step. The point of this test is to make sure the build script
  // exists at the canonical path and is importable as an ES module.
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-icons.mjs');
  assert.ok(existsSync(path), `${path} must exist`);
  // Force the script to be treated as an ES module by re-importing it
  // dynamically. The script's top-level code writes files; we tolerate the
  // side effects and just confirm the import succeeds.
  return import(path).then(() => {
    // After import, every icon should still exist with the right size.
    for (const size of SIZES) {
      const p = resolve(ICONS_DIR, `icon-${size}.png`);
      const buf = readFileSync(p);
      const { width, height } = parsePngHeader(buf);
      assert.equal(width, size);
      assert.equal(height, size);
    }
  });
});

for (const variant of REWARD_VARIANTS) {
  for (const size of [180, 192, 512]) {
    test(`reward icon ${variant}@${size} exists with the correct dimensions`, () => {
      const p = resolve(ICONS_DIR, `icon-${variant}-${size}.png`);
      assert.ok(existsSync(p), `expected ${p} to exist`);
      const buf = readFileSync(p);
      assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${p} must have a PNG signature`);
      const { width, height } = parsePngHeader(buf);
      assert.equal(width, size);
      assert.equal(height, size);
    });
  }
}

test('manifest.json declares every reward variant at 192 and 512', () => {
  const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sources = new Set((manifest.icons || []).map((i) => i.src));
  for (const variant of REWARD_VARIANTS) {
    assert.ok(sources.has(`icons/icon-${variant}-192.png`), `manifest must list icons/icon-${variant}-192.png`);
    assert.ok(sources.has(`icons/icon-${variant}-512.png`), `manifest must list icons/icon-${variant}-512.png`);
  }
});
