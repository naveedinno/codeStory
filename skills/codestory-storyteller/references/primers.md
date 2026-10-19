# Concept pages

Part of the codestory-storyteller skill. Read when a code stop needs a mental
model the reviewer does not have yet.

### 3.75. Test for concept gaps

Run the Concept-gap test before finalizing the path: before each code stop, can
the reviewer explain the terminology, roles, relationships, or state model the
next lines need? When a model lands better shown than told, build a concept
page for it. You decide how many pages the change needs and where they sit.
Pages may open the story, close it, or sit back to back.

- Overview is the whole-change reading map. A concept page is a mental model,
  not a summary of the diff.
- Teach with a concrete instance from this diff, not a generic textbook
  picture: the real function names, the real numbers, the real states.
- Starting ideas, not a menu: an interactive state machine the reviewer steps
  through; an animated money or data flow; a before/after toggle; a worked
  numeric example with sliders (a position's margin as price moves); a
  lifecycle timeline; a table that fills in as you scrub. Build whatever
  teaches best.

### 6.25. Write concept pages

```jsonc
{
  "id": "concept-margin",
  "order": 2,
  "title": "How margin moves with price",
  "kind": "concept",
  "page": "<!doctype html><html><head>…</head><body>…</body></html>",
  "narration": "Drag the price. The margin line falls until it crosses the liquidation threshold, which is the check step 3 moves.",
  "preparesFor": ["s3"],
  "tags": ["mental-model"]
}
```

- `page` is a complete HTML document. Anything goes: HTML, CSS, SVG, canvas,
  and JavaScript. It runs in a sandboxed frame that fills the stage, and it
  cannot reach codeStory or the reviewer's files.
- The page is offline by default: every network request is blocked. Set
  `"network": true` on the step only when the page genuinely needs remote
  resources (a CDN library or font — d3, three.js, Chart.js…). Prefer inline
  SVG, canvas, and system fonts so the page works with no network at all.
  The reviewer sees a Network badge on pages that opted in.
- `narration` is what you would say while pointing at the page. Plain text,
  no tags. Aloud reads it and screen readers announce it, so it must make
  sense without seeing the page.
- A concept page must teach its model in a still frame: no fact may live only
  in motion, hover, or a transient state, and the page must read equivalently
  with reduced motion.
- The page has no background of its own. It sits directly on codeStory's
  background, which shows through, so don't paint `html` or `body` (the frame
  forces both transparent anyway). Inner elements may have fills: a card, a
  legend chip, a bar.
- Optional theming: the frame sets `data-ds-theme="light"` or `"dark"` on
  `<html>` and follows the app's theme live. The variables `--ds-surface`,
  `--ds-text`, `--ds-text-2`, `--ds-text-3`, `--ds-line`, `--ds-accent`,
  `--ds-add`, `--ds-del` match the app's palette. Use them or ignore them, but
  pick text colors that read on both the light and the dark app background.
- Only story navigation keys leave the page: the left and right arrows, `j`,
  `k`, and Space. They still move the story (Space plays and pauses
  narration) unless the page handles them (`preventDefault()`) or focus is in
  a text field (input, textarea, select, contenteditable), so claim the keys
  your page needs. Space on a button or link in your page stays with it. Every
  other key stays in the page.
- `preparesFor` (optional) names code steps the page sets up.
- A concept step must not contain `file`, `range`, `ranges`, `viewport`,
  `highlights`, `beats`, `why`, `calls`, or `returnsTo`, nor legacy `focus`.
  Concept steps never claim diff coverage.
- Older stories carry a text `body` with an optional Mermaid `diagram`
  instead of `page`; keep them intact when repairing. New concept steps use
  `page`.
