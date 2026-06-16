# QA Rubric for Subagents

You are QA-reviewing a single book cover concept for the RSVP Reader. Score 1-5 on each dimension, then return a verdict: `approve` (≥3.5 avg) or `reject` (else). Justify with 1 sentence per dimension.

## Inputs you receive
- The book spec: slug, title, author, category, subtopics.
- The concept JSON (the design spec).
- The rendered PNG (path, viewable).
- The ThoughtLab tokens from `/Users/yoseph/Downloads/DESIGN.md`.

## Rubric (each 1-5)

### 1. Token discipline (weight 2x)
- Background is `#0a0a0a` (or `#050505` for split layouts).
- Type uses only `#ffffff`, `#cccccc`, `#4c4c4c`.
- At most ONE red `#fc1c46` element (or zero).
- No other colors. No gradients on UI chrome. No shadows on UI chrome.
- Border-radius: 0 for cards, 9999px for any pill. Binary.

### 2. Typography craft (weight 2x)
- Title weight is 300 or 500 (never in-between).
- Title size is in the 91-198px range, scaled to fit 2-4 lines.
- Letter-spacing is negative for big display (-0.067em at 198px).
- Title is left-aligned (never center-aligned for the title body; the layout can be visually centered but the type itself reads left).
- No more than 4 type sizes on one cover.

### 3. Layout & whitespace (weight 1x)
- 86-108px section gaps respected (top dateline, title block, author block, hairline).
- 126px horizontal padding from edges.
- Headline breaks across 2-3 lines naturally (not forced to single line, not crammed into 5+ lines).
- No element feels crowded or floating awkwardly.

### 4. Motif choice (weight 1x)
- The motif reflects the book's actual content. An orb-only book feels generic — the motif should surprise.
- The motif is rendered with simple primitives (CSS / SVG), not invented clip-art.
- 60% of books can use the orb; the other 40% should have a book-specific motif.

### 5. Originality (weight 1x)
- Could you swap the title and the cover still works? If yes, the design is too generic — reject.
- Does the cover evoke THIS book, or does it evoke "any book in the series"? A great cover evokes both — series cohesion AND book specificity.
- The pill / red rule / brand mark placement should be unique to this book (not always the same corner).

## Verdict format
```json
{
  "scores": { "tokens": 5, "type": 4, "layout": 4, "motif": 5, "originality": 4 },
  "weighted_avg": 4.4,
  "verdict": "approve",
  "issues": ["title overlaps the orb", "red rule + red pill = 2 reds"],
  "fixes": ["move the pill into the same element as the rule (a single accent)"]
}
```

## Rejection → redo brief
If you reject, write a `redo_brief` with 2-3 specific edits. The redo subagent takes this brief and produces a revised concept.

## Approve
If you approve, the concept goes to `tools/cover.mjs` for rendering.
