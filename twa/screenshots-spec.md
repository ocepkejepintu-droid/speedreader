# Screenshot specifications — Google Play

Play Console requires **at least 2 phone screenshots**. You can submit up to
8 per device class. We recommend 4 phone + 1 seven-inch tablet.

All screenshots are PNG or JPEG (24-bit, no alpha). Add 1–2 px of padding
around the artwork so Google doesn't crop. **Do not** include device chrome
unless you want it cropped; show the app UI directly.

## Phone (required, minimum 2)

Pixel-target canvas: **1080×1920** (16:9) is the smallest Play accepts.
Modern phones prefer **1080×2400** (20:9) — the extra vertical pixels show
off the reader view. The PWA is portrait-locked, so vertical is the right
choice for the reader app.

| # | Filename (suggested)        | Size       | Subject                                                                 |
|---|------------------------------|------------|-------------------------------------------------------------------------|
| 1 | `01-reader-and-orp.png`      | 1080×2400  | Main reader view, mid-sentence, red ORP highlight visible.              |
| 2 | `02-library.png`             | 1080×2400  | Library / book list, showing progress bars and last-read timestamps.    |
| 3 | `03-controls.png`            | 1080×2400  | WPM slider open, ORP color picker, theme toggle.                        |
| 4 | `04-share-target.png`        | 1080×2400  | Android share sheet showing "RSVP Reader" as a share target for an article. |

## 7-inch tablet (optional, recommended)

Canvas: **1200×1920**.

| # | Filename        | Subject                                                            |
|---|-----------------|--------------------------------------------------------------------|
| 1 | `tablet-01.png` | Reader view, landscape — shows the two-line preview if enabled.    |

## 10-inch tablet (optional)

Canvas: **1600×2560**.

| # | Filename            | Subject                                                  |
|---|----------------------|----------------------------------------------------------|
| 1 | `tablet10-01.png`   | Library grid, large thumbnails.                          |

## Feature graphic (required, no exceptions)

The Play Console will reject the listing without a feature graphic.

- Size: **1024×500** PNG or JPEG.
- Subject: App name in the dark+red palette, the R icon to the left, the
  one-line tagline "Read faster. One word at a time." in a clean sans-serif.
- Background: solid `#1a1a1a`; the icon and text in `#ff4444` and `#f0f0f0`.

## App icon for Play Store

Play uses the **512×512** PNG inside the APK. It does **not** display the
PWA's adaptive `purpose: "maskable"` icon directly, but the APK should still
declare it for the Android launcher's circular mask.

## Capture workflow

1. Install the PWA on the test device: visit `https://zipang.id/rsvp/` and
   "Add to Home Screen" (Android) or share-target test article.
2. Use `adb exec-out screencap -p > 01-reader-and-orp.png` to capture each
   view, OR run the equivalent on a desktop browser with a 1080×2400
   viewport.
3. Lightly edit with `sips` (resize) or any image tool — do not add fake
   device bezels.
4. Drag-drop into the Play Console "Graphics" section of the store listing.
