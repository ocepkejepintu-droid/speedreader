# Changelog

All notable changes to RSVP Reader are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-16

Version 1 locked for production at [zipang.id/rsvp/](https://zipang.id/rsvp/).

### Added

- Reader with four reading modes: RSVP, Phantom, Scroll, and Paragraph, all
  using ORP-anchored focal word placement.
- Adjustable WPM (100-1000) with swipe up/down to change and on-screen toast.
- Length, frequency (wordlist-backed), and punctuation timing multipliers
  toggleable from the settings sheet; pause-on-sentence-end toggle.
- Keyboard shortcuts on fine-pointer devices: Space play/pause, ArrowLeft/Right
  seek, ArrowUp/Down WPM, `[` / `]` WPM, `R` restart paragraph, `V` cycle
  reading mode, `S` open sheet, `Esc` close sheet or return to library,
  PageUp/PageDown switch chapter.
- Touch gestures: single-tap play/pause, double-tap play-lock, swipe up/down
  to change WPM, swipe down from top to return to library, long-press to open
  the settings sheet, horizontal drag to scrub to a specific word.
- Desktop mode (auto-detected, force-on, force-off) that widens the ORP
  column, brightens Phantom context, and enables keyboard shortcuts on wide
  screens.
- EPUB and TXT upload with dedupe by SHA-256 content hash; library grid with
  search, last-read chip, percent chip, and delete.
- Article paste-to-save (title + text) that stores a one-chapter "book" record
  using the same library code path.
- Library export to JSON and import from JSON with merge by `lastReadAt`.
- IndexedDB v2 migration from the older per-book localStorage layout.
- Optional Google sign-in via NextAuth; library sync between devices with a
  debounced 2.5s push; auth-enabled hosts are `zipang.id` and `localhost`
  (other hosts run in local mode without lockout).
- Node sync server (`sync-server.mjs`) with bearer-token auth, per-user
  rate limit (30 requests / 60s) returning 429 with `Retry-After`,
  `GET /health`, and async `fs.promises.writeFile`.
- Hidden local-only stats panel (`#statsPanel`) backed by
  `getCompletionStats()` reading from the `rsvp-completions` localStorage
  key. Visit `?stats=1` to see chapter-completion stats (total, 7d, 30d,
  unique books, average WPM at completion).
- PWA manifest with name, short_name, description, icons (192, 512),
  standalone display, portrait orientation, dark theme color.
- `index.html` meta tags: viewport, iOS PWA, `theme-color`, manifest link,
  Open Graph, Twitter card.
- Show HN post (196 words) and three reply templates (Show & tell, reading
  habits, minimal-tools) for non-RSVP threads.
- Sprint 1 tests for EPUB parsing, library progress, boundary rebuild, and
  library roundtrip; sync server smoke tests for `/health`, POST/GET
  roundtrip, and 429 behaviour.
- iOS SwiftUI shell (separate repo, unlisted) wrapping the same `index.html`
  in a `WKWebView` with inline media playback and no scroll bounce.
- ThoughtLab landing page with GLSL hills hero, live phantom demo embed, and bento feature grid.
- Shared book summaries catalog (263 titles, 14 categories) with category chips, grouped shelves, and daily top picks.
- Landing-aligned library home shell (`app/home.css`): obsidian theme, scrollable panels, static catalog grid.

### Changed

- Scroll mode: full-chapter paragraph flow, stable highlight, smoother auto-scroll positioning.
- Catalog cards: fixed 2/3/4-column grid, uniform card height, vertical layout for readability.
- Signal-red design tokens (`#fc1c46`) aligned across landing and app shell.

### Known issues

- Icons in `manifest.json` resolve to 1x1 placeholder PNGs; real artwork is
  deferred to v1.1. iOS PWA install now uses `icons/icon-192.png` via the
  added `<link rel="apple-touch-icon">` tag.
- Stats panel requires the `?stats=1` URL flag to render; a long-press
  in-app trigger for Android is in the v1.1 punch list.
- iOS SwiftUI shell is unlisted and not submitted to the App Store; it has
  no bundle id, no provisioning, and no screenshots.
- Nano device sync, AI summaries, highlights export, and subscription
  billing are explicitly out of scope for v1.0.
