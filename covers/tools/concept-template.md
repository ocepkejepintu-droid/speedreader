# Concept Template for Subagents

You are designing ONE book cover for the RSVP Reader book summary collection. Return a single concept JSON object — no prose, no markdown. Just the JSON.

## Inputs you receive
- `slug` (filesystem-safe book id, e.g. `atomic-habits`)
- `title`, `author`, `category`, `subtopics`
- The ThoughtLab design system (token values from `/Users/yoseph/Downloads/DESIGN.md`):
  - Background `#0a0a0a` (only)
  - White `#ffffff` for display text
  - Ash `#cccccc` for body / hairlines / dateline
  - Graphite `#4c4c4c` for muted metadata / hairlines
  - Signal red `#fc1c46` — the ONLY chromatic element, used ONCE per cover
  - Sui / Inter / system-ui sans, weight 300 (whisper) to 700, sizes 14 / 17 / 27 / 72 / 91 / 198
  - Pill button shape (9999px), no shadows, no gradients on UI chrome, full-bleed dark

## Concept rules (HARD)
1. One red element per cover. Pick the most dramatic spot.
2. Hairlines 1px only. Use `#cccccc` or `#4c4c4c` (or red for the single accent).
3. Title type: weight 300 for "whisper editorial" feel OR 500 for command. Never mix multiple weights in the title itself.
4. Title case: ALL CAPS by default. Italic allowed for the literary / memoir / philosophy books. Sentence case allowed for hacker / pragmatic books.
5. Background must be pure `#0a0a0a`. No other colors. The only allowed second surface is `#1a1a1a` for tonal depth (e.g. inside the orb).
6. No decorative icons, no illustrations, no stock imagery. SVG / CSS only. Orbs, hairlines, arcs, numbers, marks are all allowed.
7. The composition must reflect the *book* — different layout, motif, type treatment, accent placement for each book. No two covers should be visually similar.
8. Use the iridescent orb as the default motif only if the book has no clearer visual hook. If the book has a strong image (sapiens → a single orb above hairlines, 1984 → a single red eye-stalked eyebrow, art-of-war → a single vertical hairline + orb), use that instead.

## Concept JSON shape

```json
{
  "slug": "<slug>",
  "title": "<title>",
  "author": "<author>",
  "category": "<category>",
  "subtopics": "<comma-separated>",
  "year": "<4-digit year, optional>",
  "datelineLeft": "<short uppercase tag, e.g. 'BOOK SUMMARY' or 'VOL. 03'>",
  "datelineRight": "<category slug or year, e.g. 'SELF-GROWTH'>",
  "motif": "orb | hairlines | arc | number | wordmark | split | mark | venn | custom",
  "motifCount": 5,
  "number": "1",
  "customHTML": "<only if motif=custom>",
  "titlePos": "top | center | bottom | split",
  "titleWeight": 300,
  "titleSize": 198,
  "titleTransform": "uppercase | none | italic",
  "lines": ["ATOMIC", "HABITS"],
  "subline": "An optional 1-line italic support text, max 14 words",
  "sublinePos": "subline-top | subline-bot",
  "accent": "brand-top | brand-bottom | brand-corner | none",
  "brandMark": "THOUGHTLAB",
  "pill": "OPTIONAL pill text, e.g. '1%' or '1984' or 'NEW EDITION'",
  "pillPos": "top | bot",
  "redRule": "top | bot | none",
  "rationale": "1 sentence on the design choice"
}
```

## Process
1. Read `/Users/yoseph/Downloads/DESIGN.md` to internalize the tokens.
2. Skim `/Users/yoseph/rsvp-reader/covers/_ref/open-design/skills/design-templates/magazine-poster/SKILL.md` and `/Users/yoseph/rsvp-reader/covers/_ref/open-design/skills/design-templates/image-poster/SKILL.md` for the prompt-composition pattern (subject → lighting → palette → camera → avoid).
3. Optionally WebSearch for `"{title}" original cover` to get a 1-phrase mood anchor (e.g. "stark white text on black" or "blue silhouette"). DO NOT reproduce the original — use it as a vibe reference only.
4. Improvise a composition that fits THIS book. Ask: "what is the single most evocative object/word/mark for this book?" Use that as the motif.
5. Return ONLY the JSON object. No prose wrapper.

## Concrete examples

### Atomic Habits
```json
{
  "slug": "atomic-habits", "title": "Atomic Habits", "author": "James Clear",
  "category": "Self-Growth", "subtopics": "habit formation, behavior change, 1% improvement",
  "year": "2018",
  "datelineLeft": "BOOK SUMMARY", "datelineRight": "SELF-GROWTH",
  "motif": "hairlines", "motifCount": 4,
  "titlePos": "center", "titleWeight": 300, "titleSize": 198, "titleTransform": "uppercase",
  "lines": ["ATOMIC", "HABITS"],
  "pill": "1%", "pillPos": "top", "redRule": "none",
  "rationale": "Four concentric hairlines = the 4-step habit loop. Red '1%' pill is the only chromatic note."
}
```

### 1984
```json
{
  "slug": "1984", "title": "1984", "author": "George Orwell",
  "category": "Society & Tech", "subtopics": "totalitarianism, surveillance, dystopia",
  "year": "1949",
  "datelineLeft": "BOOK SUMMARY", "datelineRight": "SOCIETY & TECH",
  "motif": "mark", "titlePos": "center", "titleWeight": 300, "titleSize": 540,
  "titleTransform": "uppercase",
  "lines": ["1984"],
  "subline": "Big Brother is watching.",
  "sublinePos": "subline-bot",
  "accent": "brand-bottom", "brandMark": "BIG BROTHER",
  "redRule": "top",
  "rationale": "Single oversized '1984' is the entire cover. Red rule across the top + bottom brand mark = surveillance band. Subline in italic whispers the slogan."
}
```

### Sapiens
```json
{
  "slug": "sapiens", "title": "Sapiens", "author": "Yuval Noah Harari",
  "category": "Society & Tech", "subtopics": "human history, evolution, civilization",
  "year": "2011",
  "datelineLeft": "BOOK SUMMARY", "datelineRight": "SOCIETY & TECH",
  "motif": "orb", "titlePos": "top", "titleWeight": 300, "titleSize": 198,
  "titleTransform": "uppercase", "lines": ["SAPIENS"],
  "subline": "A brief history of humankind.",
  "sublinePos": "subline-bot", "accent": "brand-corner", "brandMark": "THOUGHTLAB",
  "redRule": "none",
  "rationale": "Default orb as the only mark. Title sits above the orb in whisper-weight caps. Subline quotes the subtitle."
}
```
