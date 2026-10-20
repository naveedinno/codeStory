# Color findings
Scope inspected: quick change review of changed client CSS/TSX across all six surfaces, shared chrome, canonical `src/theme.ts`, generated `client/generated/theme.css`, `scripts/build-theme-css.mjs`, `test/theme.test.mjs`, and the new server 404 markup/styles in `src/server.ts`. Read the original color findings and fix briefs. Independently computed WCAG ratios from the token values, including alpha compositing, nested line and word tints, focused-line gutters, and annotation hover fills. Read subsequent source fixes made during this recheck.
Not inspected: post-fix rendered screenshots, increased-contrast emulation, forced-colors emulation, and actual browser focus captures. `fixes/runtime-recheck.md` and `fixes/screens/` were absent at completion, so this is source and calculated-pair evidence only. No P3 colors or new chart palette were introduced. Locale-specific color meaning is not applicable to the single shipped locale.
Score: 4/4, no remaining actionable color findings in the inspected source; browser rendering-mode coverage remains unverified.

## Findings

No unresolved HIGH, MEDIUM, or LOW color findings in this recheck. Additional contrast and rendering-mode gaps found during review were corrected before this report was finalized.

## Original finding dispositions

| ID | Disposition | Current replacement and verification |
|---|---|---|
| COL-1 | Fixed in source | `client/surfaces/review/review.css:49` and `:50` point both container-label aliases at `var(--accent-text)`. Accent-text on accent-soft over surface, surface-2, surface-3 or page passes in both themes, with a worst measured pair of 4.87:1 light and 6.43:1 dark across those surfaces. Active filter, wrap and read-aloud labels inherit these aliases. |
| COL-2 | Fixed in source, including followup | `src/theme.ts:165` lowers dark word tint alpha to .2; `:203` supplies light word tint alpha .12; dark comment ink becomes `#a6acb5` at `:167`. Every syntax/text ink over both layered line-plus-word backgrounds passes, minimum 5.13:1 dark and 4.80:1 light. `client/surfaces/review/review.css:943`–`:958` now keeps story/voice focus off code backgrounds and uses gutter cues. `:1109` and `:1110` preserve word emphasis. See resolved-during-recheck notes below. |
| COL-3 | Fixed in source | `client/surfaces/review/review.css:1276` uses text-2 for inactive numerals, and `:1282` uses accent-text for the active numeral. On surface-2 these measure 6.27:1 / 5.90:1 light and 11.25:1 / 8.78:1 dark. Numerals also increased to the text-xl token, but the pairs already pass the stricter 4.5:1 threshold. |
| COL-4 | Fixed in source, including followup | Sweep, concept, eyebrow, additions and not-run rules use accent-text, diff-add-text and amber-text at `client/surfaces/review/review.css:273`, `:1287`, `:1296`, `:663`, `:313`. Light examples: sweep over surface 5.59:1, concept eyebrow on page 5.85:1, additions on surface-2 5.49:1, not-run on page 5.68:1. Followup also replaces raw rail ink in Story focus, annotation labels/actions, and Reload. |
| COL-5 | Fixed in source | `client/shared/shared.css:233` and `:382`, plus `client/surfaces/progress/ProgressPanel.tsx:106`, `:433` and `:440`, use the canonical solid-plus-soft shadow-focus. The solid accent on surface measures 8.13:1 dark and 4.80:1 light, exceeding the 3:1 graphical threshold. Focus visibility/clipping still requires browser inspection by A11Y. |
| COL-6 | Fixed in source, rendering pending | `src/theme.ts:206` defines canonical increased-contrast text, line and ink values in both themes. `scripts/build-theme-css.mjs:276` extracts and emits the media block. The old global canonical overrides were removed from `client/surfaces/review/review.css:1457`; only review component selectors remain. Secondary/tertiary text on surface-3 measures APCA Lc95.9/81.2 dark and Lc88.0/80.9 light. Canonical tiers remain distinct. |
| COL-7 | Fixed in source, rendering pending | `client/styles.css:89`–`:125` restores system-color borders for add/delete, dashed untoured outlines, badge borders, and active/jump/voice outlines. `client/surfaces/stories/StoryRow.tsx:156` exposes the ds-story-state hook. `client/surfaces/review/review.css:1666` adds Highlight outlines for active film, filter and wrap controls. Existing forced-colors focus outline remains important at `:1605`, so more specific ordinary focus styles cannot suppress it. Existing add/delete signs and status labels retain their text evidence. Actual system palette rendering is not verified. |
| COL-8 | Fixed in source | Unused green-hi, md-tertiary, add-bd and text-minimum aliases and the overridden lavender intro rules are absent. The later intro-card rules remain at `client/surfaces/review/review.css:1204`. No replacement literal hue was introduced. |
| COL-9 | Fixed in source | `scripts/build-theme-css.mjs:119` and `:204` mark shadcn names vendor-only and state the first-party semantic names. The generated bridge carries the same comments. Existing compatibility aliases remain intentionally available. |
| COL-10 | Fixed in source | `client/surfaces/progress/ProgressPanel.tsx:432` uses `text-[var(--on-accent)]`. The actual canonical on-accent/accent pairs pass in either inherited theme: 8.55:1 dark, 4.80:1 light. The existing nested data-theme="dark" attribute alone does not reset :root-scoped canonical values, so the conclusion does not rely on that comment's dark-pinning assumption. |

## Resolved during recheck

- **Layered focus plus word emphasis:** the first patch passed the new theme tests but still layered story/voice blue gradients between line tint and word tint. Calculated worst-stop examples were dark comment ink 4.20:1 on story-focused additions and 3.42:1 on voice-focused additions, and light string ink 3.52:1 on voice-focused deletions. The final rules at `client/surfaces/review/review.css:943`–`:958` set code-cell and unified-row background-image to none. They keep focus in the gutter with accent-soft, accent-text and the voice inset marker. The worst measured focus-gutter pair over either add/delete line is 6.17:1 dark and 5.29:1 light. Code keeps the safe two-layer composition verified by the theme test. These are source calculations; no rendered state was supplied.
- **Additional rail inks:** Story focus's pseudo-label at `client/surfaces/review/review.css:845` initially measured 3.72:1 light on the actual tinted surface-2 toolbar; it now uses accent-text and measures 5.18:1. Annotation tags, relation text, arrow and destination action at `:922`, `:928`, `:930`, `:935` now use amber-text; on the 8% amber/surface background they measure 5.87:1 light, and the destination hover composite measures 5.21:1. Reload at `:1538` now uses accent-text; it measures 6.16:1 light normally and 5.32:1 on hover.
- **Canonical contrast inheritance:** the original review media rule reassigned text-2/text-3 to the same 88% mix. Because review.css is imported globally, this shadowed new dark canonical values across surfaces. It is absent from the final `client/surfaces/review/review.css:1457` rule.
- **Forced-color current states:** the final `client/surfaces/review/review.css:1666` rule supplies explicit system outlines for active film, filter and wrap controls. This closes the source fallback gap found after the first forced-colors patch.

## Verification

- `node --test test/theme.test.mjs`: 12 passed, 0 failed in this agent's final run. Tests calculate all syntax/text pairs on ordinary line-plus-word surfaces in both themes. Increased contrast currently has a source-presence assertion; the APCA values above were computed independently.
- Independent WCAG script calculated full composites, both add/delete emphasis backgrounds, all six syntax inks plus text, focus gutters, corrected annotations, action labels and hover fills.
- Canonical values remain in src/theme.ts; the bridge imports the increased-contrast rule and aliases semantic roles. No component primitive hue or new palette family was introduced by the fixes. Literal occurrences were inspected in changed CSS/TSX, including SVG fill/stroke and the 404 stylesheet.
- The new 404 stylesheet at `src/server.ts:4647` uses existing semantic surfaces, text, on-accent, focus and hover tokens. No new color pair problem found.
- No browser, operating system high-contrast palette, mobile device or deployment claim is made by this source recheck.

## Recommendations

- Extend `test/theme.test.mjs:209` to guard the replacement focus mechanism as well as base emphasis pairs, so a future blue gradient on code cells cannot invalidate the safe composition. The main agent has taken ownership of that followup; no test change was made by this reviewer.

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/review/review.css:1003` | Raw accent-blue remains in ds-band-pair | It is an SVG bridge fill role, not text. It must continue to share the relocation rail hue. |
| `client/surfaces/picker/RecentRepos.tsx:193` | Raw accent in the repository folder icon | The icon is a graphic with a distinct folder shape, accompanied by full text. It is not small control text. |
| `client/surfaces/progress/ProgressPanel.tsx:170` | The nested dark attribute does not independently retheme canonical root tokens | This predates the patch. The changed on-accent and focus tokens now follow the actual inherited light or dark palette and pass either way. The comment's intended dark-console behavior is a separate product convention check, not a remaining contrast failure. |

## Handoffs

- A11Y: confirm focused controls remain visible and not clipped, and verify current-state and diff distinctions under forced-colors with actual captures. Source fallbacks now exist at `client/styles.css:82`, `client/surfaces/review/review.css:1604`, `:1666`.
- Capture/orchestrator: inspect light/dark review states, focus gutters, ordinary and increased-contrast labels, and forced-colors after the final build. This file intentionally records source-only evidence until those captures arrive.
