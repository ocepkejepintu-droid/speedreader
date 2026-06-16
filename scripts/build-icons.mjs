#!/usr/bin/env node
// Generate 5 real icons (16, 32, 180, 192, 512) for the RSVP Reader PWA.
// Uses only Node's built-in `zlib` (no external deps).
//
// Design: dark #1a1a1a background with a centered red #ff4444 "R" mark.
// The R is built from 3 rectangles — vertical bar (left), top crossbar,
// and a diagonal leg — composed into a bitmap buffer. Output is encoded
// as a minimal but spec-compliant PNG (signature + IHDR + IDAT + IEND).
//
// Usage: node scripts/build-icons.mjs
//   writes:
//     icons/icon-16.png
//     icons/icon-32.png
//     icons/icon-180.png
//     icons/icon-192.png
//     icons/icon-512.png
//
// Optional: pass sizes on the command line, e.g. `node scripts/build-icons.mjs 64 128`
//          (defaults to the PWA standard set above).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '..', 'icons');

const BG = { r: 0x1a, g: 0x1a, b: 0x1a, a: 0xff };
const FG = { r: 0xff, g: 0x44, b: 0x44, a: 0xff };

const DEFAULT_SIZES = [16, 32, 180, 192, 512];

// ---------------------------------------------------------------------------
// CRC32 (PNG uses IEEE CRC32 over each chunk).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Build a PNG from a raw RGBA buffer (top-left origin, 8-bit/channel).
// ---------------------------------------------------------------------------
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width, height, bit depth 8, color type 6 (RGBA), compression 0,
  //        filter 0, interlace 0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  // Pre-filter scanlines: each row prefixed with a filter byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw, { level: 9 });

  const ihdr = makeChunk(0x49484452, ihdrData); // 'IHDR'
  const idat = makeChunk(0x49444154, idatData); // 'IDAT'
  const iend = makeChunk(0x49454e44, Buffer.alloc(0)); // 'IEND'

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32BE(type, 0);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// ---------------------------------------------------------------------------
// Drawing primitives on an RGBA buffer (0,0 = top-left).
// ---------------------------------------------------------------------------
function setPx(rgba, w, x, y, c) {
  if (x < 0 || y < 0 || x >= w) return;
  const stride = w * 4;
  const i = y * stride + x * 4;
  rgba[i]     = c.r;
  rgba[i + 1] = c.g;
  rgba[i + 2] = c.b;
  rgba[i + 3] = c.a;
}

function fillRect(rgba, w, h, x0, y0, rw, rh, c) {
  const x1 = Math.min(w, x0 + rw);
  const y1 = Math.min(h, y0 + rh);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      setPx(rgba, w, x, y, c);
    }
  }
}

// Brensenham-ish diagonal leg, drawn 1-px wide per row, with thickness built
// in by stepping dx across rh.  Result is a parallelogram with vertical sides.
function fillDiagonalLeg(rgba, w, h, x0, y0, length, thickness, c) {
  for (let i = 0; i < length; i++) {
    const y = y0 + i;
    if (y < 0 || y >= h) continue;
    // dx grows from 0 to length-thickness, so the leg slopes right-down.
    const dx = Math.floor((i / Math.max(1, length - 1)) * (length - thickness));
    for (let t = 0; t < thickness; t++) {
      setPx(rgba, w, x0 + dx + t, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Compose the R mark into a fresh RGBA buffer filled with BG.
// "designW/H" is the conceptual grid (5x7) and we scale to the target canvas.
// For 16x16 the leg is dropped to keep the glyph readable at tiny size.
// ---------------------------------------------------------------------------
function drawR(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4]     = BG.r;
    rgba[i * 4 + 1] = BG.g;
    rgba[i * 4 + 2] = BG.b;
    rgba[i * 4 + 3] = BG.a;
  }

  // The R occupies ~50% of the canvas.  We design in a 5x7 grid and scale.
  const targetW = Math.max(4, Math.round(size * 0.5));
  const targetH = Math.max(4, Math.round(size * 0.58));
  // integer scale-up: how many pixels per grid cell
  const cellW = Math.max(1, Math.floor(targetW / 5));
  const cellH = Math.max(1, Math.floor(targetH / 7));
  const pxW = cellW * 5;
  const pxH = cellH * 7;

  // Subtle rounded-corner mask via inset = 1 cell on the leg side.
  const ox = Math.floor((size - pxW) / 2);
  const oy = Math.floor((size - pxH) / 2);

  // Vertical bar — left side, full height.
  fillRect(rgba, size, size, ox, oy, cellW, cellH * 7, FG);

  // Top crossbar — top row across the full 5-cell width.
  fillRect(rgba, size, size, ox, oy, cellW * 5, cellH, FG);

  // Right stem of the top bowl (rows 1..3 on column 4).
  fillRect(rgba, size, size, ox + cellW * 4, oy + cellH, cellW, cellH * 3, FG);

  // Middle crossbar — connects bar to bowl on row 3.
  fillRect(rgba, size, size, ox, oy + cellH * 3, cellW * 5, cellH, FG);

  if (size >= 32) {
    // Diagonal leg from (col 2..3 at row 4) down to (col 4..5 at row 7).
    // Approximated as a parallelogram with thickness = cellW.
    const legX0 = ox + cellW * 2;
    const legY0 = oy + cellH * 4;
    const legLen = cellH * 3;          // rows 4..6
    const legThick = Math.max(1, cellW);
    fillDiagonalLeg(rgba, size, size, legX0, legY0, legLen, legThick, FG);
  } else {
    // Tiny variant: render the leg as a single slanted block (3 cells wide,
    // stepped 1px right per row) so the R is still legible.
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = ox + cellW * (2 + col) + row;
        const y = oy + cellH * (4 + row);
        if (x >= 0 && y >= 0 && x < size && y < size) {
          fillRect(rgba, size, size, x, y, 1, cellH, FG);
        }
      }
    }
  }

  return rgba;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function build(size) {
  const rgba = drawR(size);
  const png = encodePng(size, size, rgba);
  const out = join(ICONS_DIR, `icon-${size}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  return { size, path: out, bytes: png.length };
}

function main() {
  const sizes = process.argv.slice(2).length
    ? process.argv.slice(2).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0)
    : DEFAULT_SIZES;

  const results = sizes.map(build);
  for (const r of results) {
    console.log(`wrote ${r.path} (${r.size}x${r.size}, ${r.bytes} bytes)`);
  }
}

main();
