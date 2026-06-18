# Swarm worker: rewrite Headway summaries

You are rewriting book summary JSON files for RSVP Reader. The output is fed into an RSVP (rapid serial visual presentation) flash-reader that shows one word at a time, so the prose must be clean, flowing, and easy to read at speed.

## Allowed paths
ONLY edit files listed in your batch manifest under `summaries-data/`.
Do NOT edit any other files.

## Rules — deep rewrite, not synonym swap

1. Rewrite every `chapters[].title` and `chapters[].text` in fresh prose.
2. Preserve factual meaning and key points; change sentence structure and vocabulary.
3. Do NOT copy phrases verbatim from the source text. Avoid Jaccard similarity > 0.5 with the source.
4. Keep each chapter roughly similar length (between 0.75x and 1.25x of the original `wordCount`).
5. Preserve paragraph breaks (`\n\n`) where they aid readability.
6. Strip HTML like `<br>` unless needed; prefer plain text.
7. Deduplicate identical chapters if the source has copy-paste duplicates. Merge the meaning into one distinct chapter or vary the rewrite.
8. Update metadata on each file:
   - `"source": "rsvp-original"`
   - `"rewrittenAt": <unix ms timestamp, e.g. Date.now()>
   - recompute each `chapters[].wordCount` from the new text
   - recompute `totalWords` as the sum of chapter word counts
9. Keep unchanged: `id`, `title`, `author`, `type`, `addedAt` (unless missing).

## Style rules — STRICT, optimized for RSVP flash-reading

- NO em dash (`—`) anywhere. Replace with a period, comma, or "and"/"but"/"yet" as appropriate.
- NO en dash (`–`) used as a list separator. Use commas or rewrite as a list.
- NO emojis. Ever.
- NO bullet lists, numbered lists, or markdown list syntax. Convert lists into flowing prose. Example: "The four steps are X, Y, Z, and W" instead of a bulleted list.
- NO "Did you know?" callout boxes. Merge that information into a normal sentence.
- NO blockquotes. If a quote is in the source, paraphrase it as the author's view rather than a direct quote, unless a verbatim quote is essential to the meaning.
- NO Latin abbreviations like "e.g.", "i.e.", "etc.". Write "for example", "that is", "and so on" instead.
- NO leading "~" or "—" before author attributions. If you keep a quote, attribute it inline: "as William James once wrote, ..."
- NO curly quotes. Use straight quotes (`"` and `'`).
- NO ellipsis (`...`) within sentences. If something trails off, complete the thought or break into a new sentence.
- NO parenthetical authorial asides longer than 8 words. Either integrate into the surrounding sentence or drop.
- NO ALL-CAPS for emphasis. Italics are fine in the source; replace with rephrasing.
- Keep sentences short, average 12-18 words. The reader sees one word at a time, so long sentences are exhausting.
- Use simple, common words. Prefer "use" over "utilize", "help" over "facilitate", "show" over "demonstrate", "think about" over "contemplate".
- Keep paragraphs to 3-5 sentences. Break long paragraphs.
- Write in plain English, grade 6-8 reading level.
- Match the source's tense and point of view. Most Headway summaries are in present tense, second person. Keep that.

## What good output looks like

Bad (lists, em dash, "Did you know", Latin abbreviation):
> The four steps are:
> - Step one: identify your goal
> - Step two: break it down
> Did you know? Most people fail at step 1 — they pick the wrong goal.

Good (flowing prose, no em dash, simple):
> Four steps make up the process. First, identify your goal clearly. Then break it down into smaller pieces that you can finish in a day. Most people fail at the first step, because they pick a goal that does not match what they actually want. Be specific. Write the goal in one sentence and read it out loud.

## Word count helper
`wordCount = text.split(/\s+/).filter(Boolean).length`

## Verification

After editing your batch files, run:
```
node scripts/validate-rewritten-summary.mjs
```

Report: files done, any validation warnings for your files, max Jaccard similarity observed per chapter.

## Return format

- batch id
- files rewritten (list)
- any chapters skipped or merged
- validation result
- max Jaccard similarity seen per file
