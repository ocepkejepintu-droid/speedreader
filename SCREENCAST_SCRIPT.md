# RSVP Reader — 90s Screencast Script

Total runtime: 90 seconds. Record at 1920x1080, 30fps. Use QuickTime New Screen Recording, then trim in QuickTime. No music, no narration overlay — captions are baked in post. Each shot is a single continuous take unless noted.

Voiceover: founder, neutral and direct. Pace around 160 wpm. No buzzwords.

---

## Shot 1 — Drop in an EPUB (0:00-0:10)
**On screen:** The PWA opens to the empty library state. The drop zone reads "Drop an EPUB here or tap to choose." The cursor hovers, then drags a real EPUB (`pg11-imagesofrussians00moul.epub` from Project Gutenberg is fine) into the window. The book's cover thumbnail appears in the grid with a title, author, and 0% progress chip.
**Voiceover:** "RSVP Reader lives in the browser. You drop an EPUB in, the file stays on your device. No upload."
**Notes:** Slow pan from top of the page to the empty grid, then track the drag. The drop should fill the lower 60% of the frame.

## Shot 2 — RSVP mode, ORP word display (0:10-0:25)
**On screen:** Tap the book. The reader opens to chapter 1. One word is centered with a red letter in the middle. Hit space — words advance at 300 wpm. The user nudges WPM up to 450 with a slider at the bottom. Tap to pause.
**Voiceover:** "One word on the same focal point, with the red letter as the optical recognition point. Your eyes don't move. Spacebar to play, tap to pause."
**Notes:** Tight crop on the word display, slightly off-center so the red ORP letter reads. Slider change should be visible. Cut on the pause.

## Shot 3 — Phantom mode (0:25-0:45)
**On screen:** From paused state, open the mode picker (top right), choose "Phantom." The screen now shows three dimmed words on either side of the focal word, with the focal word larger and centered. Hit play. The flanking words slide across the screen as the focal point stays still.
**Voiceover:** "Phantom mode shows you the words before and after, dimmed, so you keep the syntax without losing the speed. Useful for fiction, less so for dense nonfiction."
**Notes:** Wider frame to capture the flanking words. Show 8-10 seconds of continuous play, then pause on a sentence ending.

## Shot 4 — Scroll mode, WPM scrub (0:45-1:00)
**On screen:** Switch mode to "Scroll." The text reflows into a normal reading column with the current word highlighted. Press-and-hold on the progress scrubber at the bottom — drag it left to rewind by half a chapter, then right to skip ahead. The current-word highlight jumps in real time.
**Voiceover:** "Scroll mode for the things you want to read slowly. The scrubber at the bottom jumps to a specific word, not just a page, so you can recover from a distraction."
**Notes:** Show one fast scrub forward, one scrub back. End on a clean shot of the scrubber at 30%.

## Shot 5 — Library grid (1:00-1:15)
**On screen:** Back to the library. The book now shows 30% progress, "last read 2 min ago." Two more books are visible in the grid (a Project Gutenberg short story and a personal EPUB of choice). Grid view, dark theme, all the chips visible.
**Voiceover:** "The library remembers where you stopped. Last read timestamp, percent complete, cover art. All local."
**Notes:** Hold the wide shot for 5 seconds, slight zoom in on the 30% chip on the first book.

## Shot 6 — Open on phone (1:15-1:30)
**On screen:** The shot cuts to an iPhone screen recording (or a browser window resized to 390x844 in DevTools if you don't want to film a second device). Open the same URL `zipang.id/rsvp/`. The library loads with the same three books. Tap one. The reader opens at exactly the same line.
**Voiceover:** "Open the same URL on your phone. Same library, same line. That's the whole sync model."
**Notes:** End on the phone reader at the focal word, frozen for 1 second before the screencast fades to the URL `zipang.id/rsvp/` in plain text, centered, 2 seconds.

---

## Post-production checklist
- Trim each shot to its time budget; do not let any shot run long.
- Add a 3-frame fade-to-black between shots. Total transitions should be unobtrusive.
- No background music. The click of the spacebar, the soft sound of the page reflow, and the voiceover are enough.
- End card: `zipang.id/rsvp/` on a black background, 2 seconds, no animation.
- Export H.264 1080p, target file size under 25 MB so HN can stream it.
- Host on the same domain as a static file at `/screencast.mp4` so the post link is permanent.
