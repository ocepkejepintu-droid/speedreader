// Verify the TWA build artifacts in /Users/yoseph/rsvp-reader/twa/.
//
// Tests:
//   1. twa-manifest.json parses
//   2. assetlinks.json is an array of one entry with the right package name
//   3. store-listing short description is <= 80 chars
//   4. bubblewrap.config.js loads as a CommonJS module and matches the manifest
//   5. assetlinks.json is identical to the assetStatements inside twa-manifest.json

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const TWA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'twa');

const twaManifest = JSON.parse(readFileSync(resolve(TWA_DIR, 'twa-manifest.json'), 'utf8'));
const assetLinks  = JSON.parse(readFileSync(resolve(TWA_DIR, 'assetlinks.json'),  'utf8'));
const storeListing = readFileSync(resolve(TWA_DIR, 'store-listing.md'), 'utf8');

test('twa-manifest.json parses and references the correct package + host', () => {
  assert.equal(twaManifest.packageId, 'id.zipang.rsvp', 'packageId must match zipang.id domain');
  assert.equal(twaManifest.host, 'zipang.id');
  assert.equal(twaManifest.webManifestUrl, 'https://zipang.id/rsvp/manifest.json');
  assert.ok(typeof twaManifest.appVersionCode === 'number' && twaManifest.appVersionCode > 0,
    'appVersionCode must be a positive integer');
  assert.ok(Array.isArray(twaManifest.assetStatements) && twaManifest.assetStatements.length >= 1,
    'twa-manifest.json must include assetStatements');
});

test('assetlinks.json is well-formed and pins package id.zipang.rsvp', () => {
  assert.ok(Array.isArray(assetLinks), 'assetlinks.json must be a top-level array');
  assert.equal(assetLinks.length, 1, 'expected exactly one delegation entry');
  const entry = assetLinks[0];
  assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(entry.target.namespace, 'android_app');
  assert.equal(entry.target.package_name, 'id.zipang.rsvp');
  assert.ok(Array.isArray(entry.target.sha256_cert_fingerprints));
  assert.ok(entry.target.sha256_cert_fingerprints.length >= 1);
  // The first run uses an obvious placeholder; once the keystore exists, this
  // should be a 64-char hex string (no colons) or 95 chars (with colons).
  const fp = entry.target.sha256_cert_fingerprints[0];
  assert.ok(
    fp === 'REPLACE_WITH_SHA256_OF_UPLOAD_KEY' ||
      /^[0-9A-F]{64}$/i.test(fp) ||
      /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/i.test(fp),
    `fingerprint must be the placeholder or a valid SHA-256 (with or without colons); got: ${fp}`,
  );
});

test('store-listing short description is within the 80-char Play limit', () => {
  // Match the first fenced ``` block immediately after the
  // "Short description" heading.
  const m = storeListing.match(
    /## Short description[\s\S]*?```\n([\s\S]*?)\n```/,
  );
  assert.ok(m, 'short description fenced block must be present');
  const short = m[1].replace(/\s+/g, ' ').trim();
  assert.ok(short.length > 0, 'short description must not be empty');
  assert.ok(short.length <= 80, `short description is ${short.length} chars (max 80): ${short}`);
});

test('store-listing contains all four required Play Console fields', () => {
  for (const heading of ['Short description', 'Full description', 'Short notes', "What's new"]) {
    assert.match(storeListing, new RegExp(`## ${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`),
      `missing required section: ${heading}`);
  }
  // Hard limits from Play Console (do not let these drift past submission):
  const blocks = {
    'Full description': /## Full description[\s\S]*?```\n([\s\S]*?)\n```/,
    'Short notes':      /## Short notes[\s\S]*?```\n([\s\S]*?)\n```/,
    "What's new":       /## What's new[\s\S]*?```\n([\s\S]*?)\n```/,
  };
  assert.ok(blocks['Full description'].exec(storeListing)[1].length <= 4000,
    'full description must be <= 4000 chars');
  assert.ok(blocks['Short notes'].exec(storeListing)[1].length <= 500,
    'short notes must be <= 500 chars');
  assert.ok(blocks["What's new"].exec(storeListing)[1].length <= 500,
    "what's new must be <= 500 chars");
});

test('bubblewrap.config.cjs loads via require() and matches twa-manifest.json', () => {
  const require = createRequire(import.meta.url);
  // Bubblewrap ships as a CJS file (module.exports = {...}); the project's
  // package.json sets "type": "module", so we ship the config as .cjs and
  // require() it explicitly.
  const cfg = require(resolve(TWA_DIR, 'bubblewrap.config.cjs'));
  assert.equal(cfg.packageId, twaManifest.packageId);
  assert.equal(cfg.host, twaManifest.host);
  assert.equal(cfg.appVersion, twaManifest.appVersion);
  assert.equal(cfg.appVersionCode, twaManifest.appVersionCode);
  assert.equal(cfg.themeColor, twaManifest.themeColor);
});

test('twa-manifest.json assetStatements mirror assetlinks.json', () => {
  // Bubblewrap will copy assetStatements into the generated AndroidManifest.
  // They must match the public assetlinks.json byte-for-byte (modulo whitespace
  // — we re-serialise and compare).
  const fromManifest = JSON.stringify(twaManifest.assetStatements[0]);
  const fromAssetLinks = JSON.stringify(assetLinks[0]);
  assert.equal(fromManifest, fromAssetLinks,
    'assetStatements[0] in twa-manifest.json must match assetlinks.json');
});
