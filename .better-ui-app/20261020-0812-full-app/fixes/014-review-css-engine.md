# 014: Fix review stylesheet and engine
- Findings: A11Y-1, A11Y-10, A11Y-9, COL-1, COL-3, COL-4 (css part), COL-8, MOT-1, MOT-3, MOT-4, MOT-5, MOT-7, TYP-1, TYP-5, TYP-2 (composer part), VIS-3 (review part), VIS-6, VIS-9, LAY-8, COPY-6, COPY-10 (engine part), LAY-3 (review part)
- Severity: HIGH
- Wave: 2
- Owned files: client/surfaces/review/review.css, client/surfaces/review/engine/review-engine.js

## Problem
Read these IDs in lenses/*.md in the run folder. Exact current values are quoted there. This is the busiest surface; keep diff rendering behaviour identical except the listed defects.

## Target
1. .ds-reviewpanel:focus-visible gains box-shadow: var(--shadow-focus). .ds-filmnode:focus-visible gains the same ring (keep magnification).
2. Aliases: --md-on-primary-container and --md-on-secondary-container -> var(--accent-text). Badge/eyebrow/stat rules cited in COL-4 -> accent-text / diff-add-text / amber-text. Film numerals: inactive var(--text-2), active var(--accent-text), drop numeral-dim mix.
3. Reduced-motion block (near line 1457): add the six caret selectors from MOT-1 with transition:none!important.
4. Step transitions: keep 340ms for view switches; step moves use 150ms opacity crossfade (scope the shorter duration to step kind in engine + css). Circuit trace: shorten to 250ms tier with delays compressed proportionally. Narration width: drop width animation, keep label swap (or ease with var(--motion-ease-out) if width must stay - prefer dropping width leg).
5. Hand-typed durations map to tokens (.12s/100-120ms -> --motion-duration-press, .16s -> --motion-duration-fast, bare ease -> --motion-ease-out). Font sizes: collapse one-offs onto token scale: 8-10.5px -> var(--text-xs) except purely decorative carets; 11-11.5 -> var(--text-sm); 12-12.5 -> var(--text-md); 13-13.5 -> var(--text-base); 14-16 -> var(--text-lg); 17-20 -> var(--text-xl); 23-27 -> var(--text-2xl); larger display sizes keep px only if no token fits, report them. Add .ds-composer-ta to the coarse-pointer 16px block. Radii: 5/7px -> var(--radius-sm), 9/10px -> var(--radius), 14px -> var(--radius-lg); keep 50%/999px dots.
6. Shadows: .ds-dock and storyless filmthread lose box-shadow (flat islands); command palette and composer shadows -> var(--shadow). Diagram frame: flat background var(--panel3), outline 1px oklch black/white 10% with -1px offset per theme, radius var(--radius-lg), drop gradient.
7. Scrollers (.ds-reviewtabs, .ds-filmthread-scroll, .ds-storyscope-actions): add trailing fade mask or peek sizing so hidden content is hinted.
8. Delete dead rules/aliases in COL-8 (lavender intro rules, unused --green-hi/--md-tertiary/--add-bd/--text-minimum) after confirming zero consumers with search.
9. Engine: story reload timer pauses while toast hovered or focused-within and resumes on leave (user choice). Composer Copy button -> "Copy comment". reviewLazyAction label Retry -> Try again (keep descriptive aria-labels).
10. Physical direction in review.css: menus/resizer/pin to logical equivalents per LAY-3 list; keep left:50% centring.

## Boundaries
- Owned files only. test/motion-regressions and render tests assert some exact strings: update those tests only where a value above intentionally changed, and list every test edit in your reply. Do not touch test files beyond that; if a failure is unrelated, report it.

## Verification
- Commands: npm run build; node --test test/motion-regressions.test.mjs test/render-page.test.mjs
- Done when: build passes; test results reported exactly.
