# 013: Fix review TSX surfaces
- Findings: A11Y-2, A11Y-7, COPY-3 (StoryView part), COPY-4 (TSX part), COPY-8, COPY-9, COPY-14 (ReviewApp part), A11Y-12 (review part), TYP-6 (review part)
- Severity: HIGH
- Wave: 2
- Owned files: client/surfaces/review/StoryHealth.tsx, client/surfaces/review/Sidebar.tsx, client/surfaces/review/ReviewApp.tsx, client/surfaces/review/ReviewView.tsx, client/surfaces/review/StoryView.tsx

## Problem
Read these IDs in lenses/accessibility.md and lenses/copy.md. Health severity is a dot with an unannounced aria-label on a plain span; file rows hide reviewed/unexplained/regenerated state from AT; depth names differ between generators (user-facing sets: keep Explain set Quick tour/Guided tour/Deep dive - apply in StoryView); excluded files called "kept lazy"/"bounded renderer"; singular "version differ"; coverage counts lines but labels changes; command palette mixes title/sentence case and capitalises Unexplained mid-sentence.

## Target
1. StoryHealth: prefix each finding message with visible "Error: " or "Warning: " text (keep dot as visual cue).
2. Sidebar: build file button aria-label including path plus reviewed / N unexplained changes / regenerated state when present; keep glyphs aria-hidden.
3. StoryView DEPTHS titles -> Quick tour, Guided tour, Deep dive with same descriptions as ExplainApp.
4. ReviewView/Sidebar/StoryView strings: "Large file not loaded in this view", heading "Files left out of this view", count "N files not loaded", intro "Read the diff under All files."
5. ReviewApp divergent tab name: verb differs/differ by count. Command titles sentence case: Open story, Open all files, Open review.
6. ReviewView coverage stats: both units "changed lines".
7. StoryView generator note: "flagged as unexplained" lowercase.
8. Decorative Lucide icons in these files aria-hidden="true".

## Boundaries
- Owned files only (engine JS is plan 014). Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client
- Done when: typecheck passes.
