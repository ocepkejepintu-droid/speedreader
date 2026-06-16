# RSVP Reader v1.0 — Decision Document

Prepared for: Founder. One page to defend v1.0, pick a monetization path, and rank the next 30 days. Date: 2026-06-14.

---

## §1. What shipped (v1.0)

RSVP Reader v1.0 is a free, no-account PWA that reads EPUBs and pasted articles one word at a time on the same focal point, with library and progress syncing across phone, tablet, and desktop. Sprints 1-3 landed together: a stable reader (RSVP, Phantom, Scroll, Paragraph modes with ORP anchoring, length/frequency/punctuation timing, keyboard and gesture controls), an IndexedDB library with article save and JSON export/import, and a NextAuth Google sign-in plus a Node sync server that pushes the library to a per-user JSON file on a 30-req/min rate limit with `/health` and async writes.

- Reader: RSVP / Phantom / Scroll / Paragraph modes, ORP-anchored focal word (`reader-app.js:351-461`).
- Reader: WPM slider 100-1000, length/frequency/punctuation timing, pause-on-sentence-end (`reader-app.js:765-774`, `1518-1559`).
- Reader: keyboard shortcuts (space, arrows, R, V, S, Esc, PageUp/Down) on fine-pointer devices (`reader-app.js:1571-1600`).
- Reader: gestures — tap, double-tap lock, swipe WPM, swipe-down-to-library, long-press sheet, drag-scrub (`reader-app.js:1033-1110`).
- Library: EPUB + TXT upload, SHA-256 content-hash dedupe, search, last-read and percent chips, delete (`library.js:158-263`).
- Library: paste-article-to-save, JSON export/import with merge, localStorage → IndexedDB v2 migration (`library.js:219-359`).
- Sync: NextAuth Google sign-in on `zipang.id` / `localhost`; debounced 2.5s push; per-user library file (`reader-app.js:1146-1222`, `auth.js:25-28`).
- Sync server: bearer auth, 30 req / 60s per-user rate limit returning 429 + `Retry-After`, `GET /health`, async `fs.promises.writeFile` (`sync-server.mjs:20-31`, `96-143`).
- PWA: manifest with name, description, 192/512 icons, standalone, dark theme (`manifest.json`).
- Pages: viewport, iOS PWA, `theme-color`, manifest link, OG/Twitter, hidden `<section id="statsPanel">` placeholder (`index.html:5-18`, `1224-1228`).
- HN prep: 196-word Show HN post (`SHOW_HN.md`), 3 reply templates (`HN_REPLIES.md`).
- Tests: Sprint 1 library/EPUB tests (`test/sprint1.test.mjs`); sync server smoke tests for `/health`, roundtrip, 429 (`test/sync.test.mjs`).
- iOS shell (separate repo, unlisted): SwiftUI `WKWebView` wrapping `index.html` (`/Users/yoseph/rsvp-reader-ios/RSVPReader/WebView.swift`).

## §2. What did NOT ship

- **iOS App Store binary.** SwiftUI shell exists but has no bundle id, provisioning, screenshots, or App Review submission. **Why cut:** 2-3 weeks + $99/yr with no paying-audience signal. **When to revisit:** after §3 measurement lands and the shell is signed locally.
- **Nano device sync.** No code beyond two layout-constant comments. **Why cut:** requires BLE/USB-HID, hardware testing, Nano maintainer coordination. **When to revisit:** only if 10+ users ask, per §4.
- **AI summaries / highlights export.** No LLM call, no highlights, no Notion/Markdown export. **Why cut:** subscription-adjacent, conflicts with the no-account thesis, comprehension claims for RSVP are overhyped. **When to revisit:** never under v1.x; if it returns, a separate "Pro" product.
- **Subscription billing.** No Stripe, no Gumroad, no plan gating. **Why cut:** ICP explicitly hates subs. **When to revisit:** only if usage crosses the bar in §4.
- **X / HN auto-reply loop.** Reddit network-blocked, X a bot graveyard. **Why cut:** energy redirected to manual HN replies. **When to revisit:** never on auto; only manual HN replies per `HN_REPLIES.md` ship in v1.0.

## §3. Measurement: the one number that matters

`chapter_completed` events are recorded in the `rsvp-completions` localStorage key and aggregated by `getCompletionStats()` into `totalChapters`, `chapters7d`, `chapters30d`, `uniqueBooks`, `avgWpm`. The stats panel renders when the URL is `?stats=1` (or on any device the founder shares that URL with).

v1.0 success criteria (day 30 after HN launch):

- **10+ chapters finished by people whose names you don't recognize in 30 days.** Proves strangers can use it.
- **1+ chapter finished on a 2nd device.** Proves sync is real end-to-end.

If those don't land by day 30, **the v1.1 punch list in §5 is wrong and the product has a different problem** — cold start, sync confusion, or ICP misfit. Read the failure mode, don't ship more features.

## §4. Monetization decision

**Decision: ship v1.0 as a free, no-monetization tool for the first 30 days, then re-evaluate with the §3 measurement in hand.**

Three conditions to revisit before day 30:

1. §3 measurement hits both bars early (e.g. 10+ chapters and 1+ 2nd-device sync within 14 days) — unlocks PWYW $5/$20.
2. 3+ distinct users ask for an iOS native build — the only fit for a one-time $4.99 App Store download.
3. 10+ users ask for Nano device sync — the only defensible $5 unlock, as a separate purchase, not a subscription.

Three things I will NOT do regardless of pressure: **no subscription, no ads/tracking/analytics SDKs in the reader, no freemium/email-capture/AI-upsell modal** — all of them break the "no account, no tracking" positioning that is the product.

## §5. v1.0 → v1.1 punch list (1 page)

First 3 are MUST. Last 4 are SHOULD.

1. **Share-to-RSVP handler for iOS Safari.** [S] — register a `share_target` action in `manifest.json` posting to `/share`, which calls the existing `saveArticle`. **Why:** article paste is the fastest non-EPUB acquisition surface; one tap is the lowest-funnel growth lever. **Blocker:** nginx route on VPS (one line).
2. **Replace 1x1 placeholder icons with real 192/512 PNGs.** [XS] — design one mark (e.g. red ORP dot on a dark field) and export both sizes. **Why:** PWA install on iOS uses the 192, 512 is the splash source, a 1x1 placeholder gets screenshotted and mocked. **Blocker:** founder owes the mark (≤ 30 min in Figma).
3. **Long-press version → /stats on Android too.** [XS] — match the `?stats=1` URL flag with an in-app trigger (long-press the app version chip in the library footer) so Android users see completions without a URL hack. **Why:** `/stats` is the only measurement surface; leaving it URL-only is fine for founder testing, terrible for any second tester. **Blocker:** item 2.
4. **"What I read this week" local summary view.** [S] — group `rsvp-completions` by book, sum words + minutes, render in the same panel from item 1. **Why:** a no-backend retention surface that gives testers something to share. **Blocker:** item 1.
5. **OPML export + a one-line "send to RSVP" bookmarklet.** [S] — extend the JSON export to also write OPML; add a `javascript:` bookmarklet that pushes the current page text into the reader. **Why:** OPML is the reader-app lingua franca; the bookmarklet bypasses the drag-and-drop cold start. **Blocker:** none.
6. **Landing page tweak: embed screencast + one social-proof slot.** [XS] — embed the 90s screencast from `SCREENCAST_SCRIPT.md` into `landing.html`, add a "as featured on Show HN" placeholder (filled only after launch). **Why:** closes the loop between HN post and first try. **Blocker:** screencast recorded first.
7. **iOS App Store pre-flight: bundle id, signing, screenshots, archive.** [L] — follow the App Store review checklist that iOS agent flagged; arm64 already patched, ATS locked, privacy manifest in place. **Why:** one-time $4.99 download path per §4. **Blocker:** 3+ distinct users asking for the native build.

## Open issues (status at v1.0 freeze)

- ✅ `getCompletionStats()` is now wired into `?stats=1` (item closed; see `<script>` block at end of `index.html`).
- ❌ Icons in `manifest.json` still resolve to 1x1 placeholder PNGs; real artwork is deferred to v1.1.
- ✅ Broken `<link rel="preload" href="/stats">` removed; replaced with `<link rel="apple-touch-icon">`.
- ❌ iOS SwiftUI shell is unlisted and not submitted to the App Store; it has no bundle id, no provisioning, and no screenshots.
- ❌ Nano device sync, AI summaries, highlights export, and subscription billing are explicitly out of scope for v1.0.

## §6. What NOT to do next week

- **Post on Product Hunt.** Wrong: no social proof, PH ranks partly on day-1 velocity; HN sets that up. **Right time:** 2-3 weeks after HN, only if a stranger asks.
- **Add a $5 button today.** Wrong: day-0 paywall destroys the only signal §3 can collect. **Right time:** day 30+ if §3 hits bars, as PWYW $5/$20.
- **Build AI summaries.** Wrong: costs server time, breaks the no-account positioning, comprehension claims are oversold. **Right time:** never under this thesis.
- **Reach out to BookWith, Kindle, or any aggregator.** Wrong: cold outreach from a launch-day PWA with no users reads as desperate. **Right time:** after §3 numbers are in hand.
- **Open a Discord / subreddit.** Wrong: audience size doesn't justify it; a quiet Discord is worse than none. **Right time:** 6+ months in, only if the same 5 users keep asking.
- **Hire a designer.** Wrong: `DESIGN.md` tokens are already in use; remaining work is icon, not layout. **Right time:** v1.1 ship, then a one-pass icons + landing refresh.
- **Add accounts beyond Google.** Wrong: no-account is the moat; each extra OAuth is maintenance + a privacy regression. **Right time:** never, unless Apple forces it.
- **Build Nano device sync.** Wrong: needs hardware, Nano has its own maintainer, zero §3 users have asked. **Right time:** if 10+ users ask, per §4 — separate $5 unlock, not v1.1.

- **Open issue (must be fixed before claiming it shipped) — RESOLVED 2026-06-14:**
- The original draft of this section called out the unwired stats panel. That is now wired (see `<script type="module">` block at the end of `index.html`, which calls `getCompletionStats()` when the URL contains `?stats=1`). The §5 punch list reflects the new top priority.
