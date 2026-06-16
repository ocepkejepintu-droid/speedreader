#!/usr/bin/env node
/**
 * cover.mjs — Render one book cover HTML to PNG via headless Chromium.
 *
 * Usage:
 *   node tools/cover.mjs <concept-json-path>
 *   node tools/cover.mjs -          # read JSON from stdin
 *
 * Output: writes <slug>.png into covers/renders/
 *
 * The composition is a function of the concept JSON. The HTML uses ThoughtLab
 * tokens from /Users/yoseph/Downloads/DESIGN.md (--color-signal-red, etc.).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const OUT = path.join(ROOT, 'renders');
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Find Chromium binary (prefer Playwright cache, fall back to system Chrome)
const CHROME_PATHS = [
  '/Users/yoseph/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Users/yoseph/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    try { execSync(`test -x "${p}"`); return p; } catch {}
  }
  throw new Error('No Chromium binary found. Tried:\n  ' + CHROME_PATHS.join('\n  '));
}

const CHROME = findChrome();

// Read concept JSON
const arg = process.argv[2] || '-';
const conceptRaw = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
const concept = JSON.parse(conceptRaw);

const slug = String(concept.slug || '').replace(/[^a-z0-9._-]/gi, '_');
if (!slug) { console.error('concept missing slug'); process.exit(1); }

// Sanitize: concept is treated as data, not code. The HTML template is
// built from a fixed DSL, and user strings are escaped before injection.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const W = 1600, H = 2400;
const title = esc(concept.title || '');
const author = esc(concept.author || '');
const category = esc(concept.category || '');
const year = esc(concept.year || '');
const motif = String(concept.motif || 'orb'); // orb | hairlines | arc | number | wordmark | split | mark
const accent = String(concept.accent || 'brand'); // brand | none
const titleWeight = Number(concept.titleWeight) || 300;
const titleSize = Number(concept.titleSize) || 198;
const titlePos = String(concept.titlePos || 'top'); // top | center | bottom | split
const titleTransform = String(concept.titleTransform || 'uppercase'); // uppercase | none | italic
const layout = String(concept.layout || 'editorial');
const lines = Array.isArray(concept.lines) ? concept.lines : []; // explicit line breaks override auto-wrap
const subline = esc(concept.subline || '');
const mark = esc(concept.mark || ''); // small brand mark text (used as red dot in design)
const fontFamily = "'Sui', 'Söhne', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// Build title block
const titleHTML = (lines.length ? lines : [concept.title || ''])
  .map(l => `<div class="title-line">${esc(l)}</div>`)
  .join('');

const transformStyle = titleTransform === 'italic' ? 'italic' : 'normal';
const transformCase = titleTransform === 'uppercase' ? 'uppercase' : 'none';

// Motif renderers
function renderMotif() {
  if (motif === 'orb') {
    return `
      <div class="orb-wrap">
        <div class="orb">
          <div class="orb-inner"></div>
          <div class="orb-rim"></div>
          <div class="orb-highlight"></div>
        </div>
      </div>`;
  }
  if (motif === 'hairlines') {
    const count = Number(concept.motifCount) || 5;
    const lines = Array.from({length: count}, (_, i) =>
      `<div class="hairline" style="top:${20 + (i * (160 / (count - 1)))}%"></div>`
    ).join('');
    return `<div class="hairlines">${lines}</div>`;
  }
  if (motif === 'arc') {
    return `<div class="arc-wrap"><svg viewBox="0 0 1600 2400" preserveAspectRatio="xMidYMid meet">
      <circle cx="800" cy="2400" r="2000" fill="none" stroke="#cccccc" stroke-width="2"/>
      <circle cx="800" cy="2400" r="1700" fill="none" stroke="#4c4c4c" stroke-width="1"/>
      <circle cx="800" cy="2400" r="1400" fill="none" stroke="#4c4c4c" stroke-width="1"/>
    </svg></div>`;
  }
  if (motif === 'number') {
    return `<div class="number-bg">${esc(concept.number || '1')}</div>`;
  }
  if (motif === 'wordmark') {
    return `<div class="wordmark-bg">${title}</div>`;
  }
  if (motif === 'split') {
    return `<div class="split-top"></div><div class="split-seam"></div><div class="split-bot"></div>`;
  }
  if (motif === 'mark') {
    return `<div class="mark-wrap"><div class="mark-glyph">${mark || '•'}</div></div>`;
  }
  if (motif === 'venn') {
    return `<div class="venn">
      <svg viewBox="0 0 1600 1600" preserveAspectRatio="xMidYMid meet">
        <circle cx="600" cy="700" r="380" fill="none" stroke="#cccccc" stroke-width="3"/>
        <circle cx="1000" cy="700" r="380" fill="none" stroke="#cccccc" stroke-width="3"/>
        <circle cx="800" cy="1100" r="380" fill="none" stroke="#cccccc" stroke-width="3"/>
      </svg></div>`;
  }
  if (motif === 'custom') {
    return concept.customHTML || '';
  }
  return '';
}

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  :root {
    --color-signal-red: #fc1c46;
    --color-pure-white: #ffffff;
    --color-ash: #cccccc;
    --color-graphite: #4c4c4c;
    --color-void: #000000;
    --surface-obsidian-canvas: #0a0a0a;
    --surface-carbon-panel: #1a1a1a;
    --surface-smoke-overlay: #2a2a2a;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; background: #0a0a0a; overflow: hidden; font-family: ${fontFamily}; color: #ffffff; }
  .cover { position: relative; width: ${W}px; height: ${H}px; background: #0a0a0a; }

  /* Top rule + dateline */
  .top-rule {
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: #4c4c4c;
  }
  .top-dateline {
    position: absolute; top: 22px; left: 126px; right: 126px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; font-weight: 400; color: #cccccc; line-height: 1.2;
    letter-spacing: 0.04em; text-transform: uppercase;
  }

  /* Title block */
  .title-block {
    position: absolute; left: 126px; right: 126px;
    color: #ffffff;
    ${titlePos === 'top' ? 'top: 180px;' : ''}
    ${titlePos === 'center' ? 'top: 50%; transform: translateY(-50%);' : ''}
    ${titlePos === 'bottom' ? 'bottom: 200px;' : ''}
    ${titlePos === 'split' ? 'top: 880px;' : ''}
  }
  .title-line {
    font-weight: ${titleWeight};
    font-size: ${titleSize}px;
    line-height: 0.92;
    letter-spacing: -0.067em;
    text-transform: ${transformCase};
    font-style: ${transformStyle};
    word-break: break-word;
  }
  .author-block {
    position: absolute;
    ${titlePos === 'bottom' ? 'top: 200px; left: 126px; right: 126px;' : 'bottom: 200px; left: 126px; right: 126px;'}
    font-size: 27px; font-weight: 400; color: #cccccc; line-height: 1.2;
    letter-spacing: -0.009em;
  }
  .author-name { display: block; }
  .author-cat { display: block; font-size: 14px; color: #4c4c4c; margin-top: 14px; text-transform: uppercase; letter-spacing: 0.04em; }

  /* Brand mark (signal red accent) */
  .brand-mark {
    position: absolute;
    ${accent === 'brand-top' ? 'top: 60px; left: 126px;' : ''}
    ${accent === 'brand-bottom' ? 'bottom: 80px; right: 126px;' : ''}
    ${accent === 'brand-corner' ? 'top: 60px; right: 126px;' : ''}
    display: flex; align-items: center; gap: 12px;
    font-size: 15px; font-weight: 500; color: #ffffff; letter-spacing: 0.02em; text-transform: uppercase;
  }
  .brand-mark .dot { width: 8px; height: 8px; background: var(--color-signal-red); border-radius: 50%; display: inline-block; }

  /* Pill accent (one optional red pill per cover) */
  .pill {
    position: absolute; display: inline-block;
    background: var(--color-signal-red); color: #ffffff;
    padding: 9px 22px; border-radius: 9999px;
    font-size: 14px; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase;
  }
  .pill-top { top: 180px; right: 126px; }
  .pill-bot { bottom: 80px; left: 126px; }

  /* Single red hairline rule */
  .red-rule {
    position: absolute; left: 126px; right: 126px; height: 1px; background: var(--color-signal-red);
  }
  .red-rule-top { top: 150px; }
  .red-rule-bot { bottom: 160px; }

  /* Subline (used in some concepts) */
  .subline {
    position: absolute; left: 126px; right: 126px;
    font-size: 17px; font-weight: 400; color: #cccccc; line-height: 1.5;
  }
  .subline-top { top: 200px; }
  .subline-bot { bottom: 240px; }

  /* MOTIFS */
  .orb-wrap {
    position: absolute; right: -200px; top: 50%; transform: translateY(-50%);
    width: 1400px; height: 1400px;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .orb {
    width: 1100px; height: 1100px; position: relative;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #1a1a1a 0%, #0a0a0a 45%, #000 100%);
    box-shadow: inset -120px -120px 240px rgba(0,0,0,0.95), inset 60px 60px 180px rgba(252, 28, 70, 0.06);
  }
  .orb-inner {
    position: absolute; inset: 0; border-radius: 50%;
    background: radial-gradient(circle at 70% 70%, rgba(124, 58, 237, 0.18) 0%, transparent 35%),
                radial-gradient(circle at 30% 30%, rgba(252, 28, 70, 0.10) 0%, transparent 30%);
    mix-blend-mode: screen;
  }
  .orb-rim {
    position: absolute; inset: -8px; border-radius: 50%;
    background: conic-gradient(from 180deg at 50% 50%,
      transparent 0%, rgba(124, 58, 237, 0.5) 8%, transparent 18%,
      transparent 50%, rgba(252, 28, 70, 0.4) 60%, transparent 70%,
      transparent 100%);
    filter: blur(28px); opacity: 0.85;
  }
  .orb-highlight {
    position: absolute; top: 18%; left: 22%;
    width: 22%; height: 14%;
    background: radial-gradient(ellipse, rgba(255,255,255,0.18) 0%, transparent 70%);
    border-radius: 50%;
    filter: blur(8px);
  }

  .hairlines { position: absolute; inset: 0; }
  .hairlines .hairline { position: absolute; left: 126px; right: 126px; height: 1px; background: #4c4c4c; }

  .arc-wrap { position: absolute; inset: 0; }
  .arc-wrap svg { width: 100%; height: 100%; }

  .number-bg {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-size: 1800px; font-weight: 300; color: #1a1a1a; line-height: 1;
    letter-spacing: -0.05em;
  }
  .wordmark-bg {
    position: absolute; bottom: -120px; right: -80px;
    font-size: 480px; font-weight: 300; color: #1a1a1a; line-height: 0.9;
    letter-spacing: -0.07em; text-transform: uppercase; text-align: right;
    transform: rotate(-90deg); transform-origin: right bottom;
  }
  .split-top { position: absolute; top: 0; left: 0; right: 0; height: 50%; background: #0a0a0a; }
  .split-bot { position: absolute; top: 50%; left: 0; right: 0; height: 50%; background: #050505; }
  .split-seam { position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--color-signal-red); }

  .mark-wrap { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  .mark-glyph { font-size: 1200px; color: var(--color-signal-red); line-height: 1; }

  .venn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 1400px; height: 1400px; opacity: 0.7; }
  .venn svg { width: 100%; height: 100%; }
</style>
</head>
<body>
<div class="cover">
  <div class="top-rule"></div>
  <div class="top-dateline">
    <span>${esc(concept.datelineLeft || 'BOOK SUMMARY')}</span>
    <span>${esc(concept.datelineRight || '')}</span>
  </div>
  ${renderMotif()}
  <div class="brand-mark" style="${accent === 'brand-top' ? 'display:flex;' : accent === 'brand-bottom' ? 'display:flex;' : accent === 'brand-corner' ? 'display:flex;' : 'display:none;'}">
    ${concept.brandMark ? `<span class="dot"></span><span>${esc(concept.brandMark)}</span>` : ''}
  </div>
  ${concept.pill ? `<div class="pill pill-${concept.pillPos || 'top'}">${esc(concept.pill)}</div>` : ''}
  ${concept.redRule ? `<div class="red-rule ${concept.redRule === 'top' ? 'red-rule-top' : 'red-rule-bot'}"></div>` : ''}
  ${subline ? `<div class="subline ${concept.sublinePos || 'subline-bot'}">${subline}</div>` : ''}
  <div class="title-block">
    ${titleHTML}
  </div>
  <div class="author-block">
    <span class="author-name">${author}</span>
    <span class="author-cat">${category}${year ? ' · ' + year : ''}</span>
  </div>
</div>
</body></html>`;

const tmpFile = path.join(TMP, `${slug}.html`);
writeFileSync(tmpFile, html);

const outPng = path.join(OUT, `${slug}.png`);

// Render with headless Chromium. Use --hide-scrollbars and a precise window
// size. Note: --screenshot only writes when --window-size matches the
// document, so we set both to 1600x2400.
const args = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${W},${H}`,
  '--default-background-color=00000000',
  '--virtual-time-budget=4000',
  '--run-all-compositor-stages-before-draw',
  `--screenshot=${outPng}`,
  `file://${tmpFile}`,
];

execFileSync(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });

// Resize for thumb (44x58 fits the .book-cover slot in app/index.html:412-423)
// We keep the full 1600x2400 as the source of truth and write a thumb separately.
// sharp is already in node_modules at rsvp-reader/node_modules/sharp.
let sharp;
try { sharp = require('/Users/yoseph/rsvp-reader/node_modules/sharp'); } catch { sharp = null; }

if (sharp) {
  const thumbDir = path.join(ROOT, 'thumbs');
  mkdirSync(thumbDir, { recursive: true });
  const thumbPath = path.join(thumbDir, `${slug}.webp`);
  await sharp(outPng).resize(132, 196, { fit: 'cover' }).webp({ quality: 80 }).toFile(thumbPath);
}

console.log(JSON.stringify({ slug, outPng, ok: true }));
