# GTM & Monetization Playbook — RSVP Reader

Date: 2026-06-14. Inputs: `V1_0_DECISION.md`, `SHOW_HN.md`, `HN_REPLIES.md`, `landing.html`, and the no-account/no-tracking thesis.

---

## §1. GTM strategy

No account, no analytics SDK, no email capture, solo founder. The only honest growth surface is a stranger landing on `zipang.id/rsvp/`, finishing one chapter, and coming back. Every tactic below is graded against that — does it move a stranger to one `chapter_completed` event in 7 days, then to 10 in 30?

### 1. (Top) HN Show post, Sun Jun 21 2026, 08:00 PT

- **Tactic.** Ship `SHOW_HN.md` (196 words) at the top of the HN queue. Reply within 30 min to every top-level comment with one of the three `HN_REPLIES.md` templates. The "no account, no tracking" line is the hook; the 90s screencast is the demo.
- **Cost.** $0. ~4 hrs: 1 hr screencast, 1 hr polish, 2 hr real-time replies Sun-Mon.
- **Reach.** 8k-30k HN uniques; 800-3,000 landing visits (Show HN click-through 10-30%).
- **Conversion.** 100-400 first-session opens. 10-30 first-chapter completions (3-10% activation). 3-10 will hit 10 chapters in 30 days — that's the §3 bar.
- **Risks.** HN punishes posts that disappear; the founder must own a 4-hour Sunday block. Screencast must be live *before* the post. Reply C is calibrated for the "yet another reader" thread.
- **Why #1.** Only channel that simultaneously produces a backlink, an install cohort, and quote-ready social proof for every other channel. The §3 bars are designed around HN's audience size.

### 2. Reddit r/printsf, r/books, r/productivity, r/speedreading

- **Tactic.** 4 posts, spaced 24-48h, no cross-links, 200 words each, one ORP-focal-point screenshot. Skip r/Android, r/iOS, r/privacy on the first pass.
- **Cost.** $0. ~3 hrs over a week.
- **Reach.** 5k-20k combined impressions.
- **Conversion.** 50-150 first sessions, 5-15 first-chapter completions, 1-3 power users.
- **Risks.** Auto-mod catches brand-new accounts; founder's u/ should have >50 karma. Read each sub's "Self-promotion" wiki first.
- **Why #2.** Reddit is the only other place where "I built a small PWA" posts get upvoted on post merit, not on the founder's follower count. Same ICP as HN — commuters, nonfiction readers.

### 3. Show-and-tell reply tour (HN "what apps do you use daily," "tools for focus," Indie Hackers, Lenny's)

- **Tactic.** Take the three `HN_REPLIES.md` templates and post them in adjacent HN threads. Stagger by 24h. Sign "Yoseph." Link the PWA only when the OP explicitly asks for tools.
- **Cost.** $0. ~1 hr over a week.
- **Reach.** 1k-5k targeted impressions per reply.
- **Conversion.** 20-80 visits, 1-5 first-chapter completions. Lower volume, but pre-qualified.
- **Risks.** HN bans the "planted reply" pattern within 3-4 posts. Each reply must read like a real answer.
- **Why #3.** This is how Sprout Social, Readwise, and Superhuman seeded their first 100 users. The product naturally fits "tools that respect your attention."

### 4. Product Hunt — *not* week 1, ship day 30+ only

- **Tactic.** Skip PH for the first 30 days. On day 30, if §3 has at least one 10+ chapter stranger and one 2nd-device sync, a Tue/Wed PH launch is justified. PH ranks on day-1 velocity; a 0-user launch reads as a quiet product.
- **Cost.** $0. ~6 hrs prep (screenshots, GIF, hunter ask, day-of moderation).
- **Reach.** 3k-10k PH uniques on a strong day.
- **Conversion.** 100-300 visits, 5-15 first-chapter completions.
- **Risks.** PH is the loudest failure mode for indie PWA launches. Defer until §3 has signal.
- **Why #4.** This is the "right time" answer from `V1_0_DECISION.md` §6 — pre-empted here so the founder doesn't drift back to it during HN week.

### 5. Bookmarklet distribution via "send to RSVP"

- **Tactic.** Ship the one-line `javascript:` bookmarklet from §5 punch-list item 5, then post the source to HN as "Show HN: a 200-byte bookmarklet that turns any article into RSVP." Users don't have to install the PWA — they get one chapter out of the bookmarklet alone, then notice the PWA tile, then install.
- **Cost.** $0. ~1 hr (already on the punch list).
- **Reach.** 2k-5k HN impressions.
- **Conversion.** 100-300 bookmarklet users, 20-50 of which convert to PWA install, 5-15 of which become 10+ chapter users.
- **Risks.** Must work in Safari + Firefox + Chrome — `prompt()` for article body, or `document.body.innerText` fallback. Test in Firefox first.
- **Why #5.** Highest-leverage distribution plumbing in the playbook — removes the cold-start download step.

---

## §2. Easiest payment gateway

For a $4.99 one-time or $5 PWYW on a no-account PWA, the axes are: setup time, fee, who handles VAT/sales tax, and whether the buyer can pay without yet another account.

| Gateway | Setup | Fee | Tax handled? | No-account? | Verdict |
|---|---|---|---|---|---|
| Stripe Payment Links | 15 min | 2.9% + 30¢ | No (founder files) | Email-only, hosted page | Fastest, but founder owes 50-state + EU VAT math |
| Gumroad | 20 min | 10% on free plan, 0% on Plus ($10/mo) | Yes, for Plus | Email-only, hosted checkout | Easy, but 10% is brutal at $5 ARPU |
| Lemon Squeezy | 30 min | 5% + 50¢ | Yes (Merchant of Record) | Email-only, hosted checkout | MoR handles global tax; 5% is the cleanest fit at $5 ARPU |
| Paddle | 45 min | 5% + 50¢ | Yes (MoR) | Email-only | Same as Lemon Squeezy but UI is B2B-leaning, more setup |
| Apple IAP | 2-4 wks (review) | 30% | Apple handles | Forces App Store account | Destroys margin; PWYW is the wrong product for IAP |
| Google Play IAP | 1-2 wks | 30% + $25 one-time | Google handles | Forces Play account | Same as Apple, lower bar but same margin hit |
| Wise direct-to-bank | 60 min | 1-2% FX | No (founder files) | None — manual reconciliation | Cheap but operationally heavy |

**Recommendation: use Lemon Squeezy because at $5 ARPU the 5% + 50¢ fee fits, MoR status means no US sales tax or EU VAT paperwork, and the hosted checkout is one-line embed with no account required for the buyer.**

---

## §3. Publishing the app

The product is a PWA + a SwiftUI shell. The order matches the no-account, free-for-30-days thesis and the solo founder's hours budget.

**Web/PWA.** Host on `zipang.id` (already live). Android Install Banner needs a `beforeinstallprompt` listener (currently absent in `index.html`). Add JSON-LD `SoftwareApplication` markup to `landing.html` with `price: 0` and `applicationCategory: "EducationalApplication"`. App Clip is iOS-only future work. Chrome Web Store is deprecated for PWAs (the "install as app" CTA was removed in 2024) — skip.

**iOS.** TestFlight beta first via the unlisted SwiftUI shell in `/Users/yoseph/rsvp-reader-ios/`. App Store submission requires bundle id + signing + screenshots at 6.7" (iPhone 15 Pro Max), 6.5" (iPhone 11 Pro Max), 5.5" (iPhone 8 Plus), and 12.9" iPad. App Preview video is 15-30s, no audio. Common rejections: (a) "minimum functionality" — the WKWebView wrapper *might* be flagged as "website wrapped in an app" unless native UI chrome is exposed; (b) "sign in with Apple" is not required (no other social login is offered besides Google); (c) 4.3a duplicate-app risk — search App Store Connect for "RSVP Reader" before submission. Skip until day 30+ if 3+ users ask, per `V1_0_DECISION.md` §4.

**Android.** Play Console is a one-time $25. TWA (Trusted Web Activity) wraps the PWA into a real Android app — Bubblewrap CLI generates the APK from the manifest + `assetlinks.json`. TWA gets Play Store distribution with full PWA behaviour. This is the only mobile store path to attempt in the first 30 days (TWA is ~30 minutes, see §5).

**Desktop.** Tauri wraps the same web app into a macOS/Windows/Linux binary — 2-3 hours for the first build, then a 50MB signed .dmg. Mac App Store via Tauri is the same path with notarization. Setapp is curated and $20k-$50k/yr — only viable once revenue is recurring. Snapcraft + Flathub are free but <1% of reader-app installs. Direct download on Gumroad is the cheap fast path. Defer to v1.1+.

**Recommendation: ship PWA + Android TWA in the first 30 days (PWA already done, TWA is 30 min in §5), then ship iOS TestFlight in week 5-6 if any 3+ distinct users ask for the native build, then defer everything else to v1.1.**

---

## §4. Gap to value

The two success bars: **10+ chapters finished by strangers in 30 days** and **1+ chapter finished on a 2nd device.** The gap between "I opened the PWA" and "I finished chapter 10" is dominated by cold start (no book), single-device bias (no cross-device moment), and no reason to come back (no weekly ritual).

1. **Share-target handler (iOS Safari → reader).** Closes cold start — user sees a long article, taps Share, picks "RSVP Reader," and the article is in the library. Lowest-funnel growth lever. Ship: 1 hr. Zero conflict with no-account. Cost of not shipping: every long article a tester sees is a missed first chapter, and first chapter is the only one that matters for activation.
2. **OPML export + "send to RSVP" bookmarklet.** Closes cold start from the desktop side and the "what is in this thing" question. The bookmarklet turns any article into a chapter in one click. Ship: 1 hr. Zero conflict. Cost of not shipping: anyone on the HN thread who clicks the link and isn't carrying an EPUB file bounces — the bookmarklet is what turns HN into chapter-1 completions.
3. **"What I read this week" local summary view.** Closes the "come back" gap. Once a user has 3-5 chapters they need a reason to come back on day 7; a local summary gives them a shareable artifact. Ship: 30 min. Zero conflict. Cost of not shipping: a first-session user has no on-screen artifact of "I used this" — they forget by day 4.
4. **Real 192/512 PWA icons.** Closes the "looks like a side project" perception. The 192 is used by iOS PWA install, 512 is the splash source, and a 1x1 placeholder gets screenshotted and mocked. Ship: 1 hr. Zero conflict. Cost of not shipping: a stranger on HN opens the PWA on iOS, sees a generic icon, screenshots it, posts "is this legit?" on the thread — kills conversion.
5. **Long-press version → /stats on Android.** Closes the founder's measurement loop. Without it, the founder can't ask a tester "open this URL" — they have to send `?stats=1`, and testers forget. Ship: 30 min. Zero conflict. Cost of not shipping: a 7-day measurement delay on every Android tester, which directly delays the §3 decision gate.

These five are already in `V1_0_DECISION.md` §5. The ranking above is the order to ship them in §5.

---

## §5. Loop plan for the next 8 hours

The founder is going to spend 8 hours today shipping in a loop. Each item lands in its stated time, each one ships a visible artifact, and the order is chosen so the founder can stop at any 1-hour mark with a working v1.0.x. Total: 8 hours.

| # | Item | Time | Why it ships first | Verification |
|---|---|---|---|---|
| 1 | **Spawn competitor-feedback research in parallel.** Agent reads r/printsf, r/speedreading, r/books + G2 reviews of Outread/Spritz/SwiftRead for the last 12 months; outputs a 1-page "what people actually hate" memo. Runs in background while founder does #2-#3. | 30 min | Free signal; doesn't block later steps, but may reshape #4-#8. | Memo at `/Users/yoseph/rsvp-reader/competitor-feedback-2026-06-14.md` with a 5-bullet summary. |
| 2 | **Ship share-target handler + URL→text extractor.** Add `share_target` action to `manifest.json` (`action: /share`, `method: POST`, `enctype: multipart/form-data`, `params.files: [{name: "url", accept: ["text/*", "application/epub+zip"]}]`). Nginx route on VPS to `/share` calling `saveArticle`. | 1 hr | Highest-leverage distribution move — the PWA comes to the user. | `curl -F url=@test.txt https://zipang.id/rsvp/share` returns 200; article appears in `?stats=1`. iOS Share menu shows "RSVP Reader." |
| 3 | **Ship "what I read this week" summary view.** Reuse `getCompletionStats()`; group `rsvp-completions` by `bookId`; sum `words` and `endTime - startTime` over last 7 days; render under existing stats panel. | 30 min | Items 2, 4, 5 all produce `chapter_completed` events; this is the only on-screen view that makes those events visible. | `?stats=1` shows a "This week" section with at least one book + minutes. Mobile Safari, no horizontal scroll. |
| 4 | **Ship OPML export + bookmarklet.** Extend `library.js` `exportLibrary()` to also write OPML 2.0 (one `<outline>` per book, `type=epub`, `percent` attr). Add 200-byte `javascript:` bookmarklet: `location.href='https://zipang.id/rsvp/?import='+encodeURIComponent(document.body.innerText)`. | 1 hr | Item 5 in §4 ranking, and the only "share from any page" path. Reddit + HN both have long-form posts the bookmarklet can turn into a chapter. | Bookmarklet on a long article opens the library with a new article. JSON export contains an `<opml>` document. |
| 5 | **TWA for Play Store presence.** `npm i -g @bubblewrap/cli`, `bubblewrap init --manifest=https://zipang.id/rsvp/manifest.json`, `bubblewrap build`. Upload .aab to Play Console internal test track. Add `assetlinks.json` to `.well-known/` on `zipang.id`. | 30 min | Lowest-friction mobile store path. Cheaper and faster than the iOS shell (which is unlisted and needs App Review). | `bubblewrap build` produces `app-release-bundle.aab`. `adb install` opens PWA in standalone mode. Play Console internal test track shows the bundle. |
| 6 | **Lemon Squeezy store (button gated).** Sign up at lemonsqueezy.com. Create one product "RSVP Reader — pay what you want," default $5, min $3, max $50. Capture the hosted checkout URL. Do *not* embed the button on `landing.html` until day 30 per the decision doc. | 30 min | Button is gated until day 30 (§4 forbids day-0 paywall), but the *store* must exist by day 30 to avoid a "build under deadline" panic. | Lemon Squeezy dashboard shows the product. Test checkout in sandbox mode. |
| 7 | **Design one real icon, replace placeholder.** Figma: red ORP dot (`#ff6b6b`) centered on a 1024x1024 dark field (`#0a0a0a`), with a thin white "·" caret. Export at 192, 512, 180 (apple-touch-icon), 32 + 16 (favicon). | 1 hr | The placeholder is the most screenshot-able blemish in the product. Reddit and HN will both screenshot it. | All 5 PNG sizes in `/public/icons/`. Manifest updated. Apple-touch-icon link in `index.html`. Lighthouse PWA passes "PWA installable." |
| 8 | **Bug bash via /browse on the live PWA.** Headless Chrome at 390x844 (iPhone 14 size) on `https://zipang.id/rsvp/`. Check: PWA install prompt, manifest validates, share-target route responds, `?stats=1` renders, no console errors. | 30 min | Catches "works on my machine" regressions before HN. | `/browse` session ends green; zero console errors. |
| 9 | **Re-test, re-write CHANGELOG, prepare HN Sunday post.** Load one EPUB, finish one chapter, confirm stats panel increments. Write 3-line v1.0.1 changelog. Re-read `SHOW_HN.md` against the actual product. Schedule the post for Sun Jun 21 08:00 PT. | 30 min | Closes the loop. v1.0.1 in the changelog means HN visitors see "v1.0 just shipped today," not "weeks ago." | `?stats=1` shows `chapters7d: 1` after the test read. CHANGELOG.md has a v1.0.1 section dated today. |

**Total: 8.0 hours. Stop point at any 1-hour mark: every odd-numbered item is a shippable v1.0.x.**

---

## Notes for the founder (things I could not verify)

- **Play Console signup.** I do not have a Google Play Console account. Confirm the $25 one-time fee is paid and the developer profile is complete before TWA will upload. First-time profile review is 24-48h.
- **App Store screenshot dimensions.** I do not have access to App Store Connect's current screenshot spec. As of 2026-01: iPhone 6.7" = 1290x2796, 6.5" = 1242x2688, 5.5" = 1242x2208, 12.9" iPad Pro = 2048x2732. **Confirm in App Store Connect before recording.**
- **Lemon Squeezy store creation.** I cannot create a real merchant account in your name. The 30-minute estimate assumes you have your tax info (W-9 or W-8BEN) ready.
- **TWA assetlinks.json domain verification.** Bubblewrap will prompt for a SHA-256 of the upload key. If you have not yet generated an upload key, the first `bubblewrap build` creates one — store `android.keystore` in 1Password.
- **Competitor-feedback memo (item 1).** I have spawned a research task. If it returns empty for any sub (e.g. r/speedreading is private), re-spawn with a different prompt rather than waiting.
