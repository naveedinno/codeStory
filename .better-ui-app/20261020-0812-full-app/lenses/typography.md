# Typography findings
Scope inspected: Type tokens in `src/theme.ts` `sharedTokens()` (generated to `client/generated/theme.css`), `client/styles.css` base layer, `client/shared/shared.css`, all six surfaces (picker, stories, change, explain, review including `client/surfaces/review/review.css` diff typography, progress), mono kickers, Space Grotesk numerals, and truncation of long paths and branch names against stress S1/S4 and S2/S5 evidence in `runtime.md`. Screenshots inspected directly: `screens/stress-S1S4-change-longbranch-1440x900-dark.png`, `screens/stress-S4-diff-longline-file-1440x900-dark.png`, `screens/picker-375x812-dark.png`, `screens/review-1440x900-dark.png`, plus the full capture list and scenario table in `runtime.md`. Rules 1 to 23 checked. Passing rules with no finding: 1 (all faces woff2), 3 (no raw `font-variation-settings` or `font-feature-settings` found, `tabular-nums` uses the property), 9 (measure caps at 46 to 68ch on prose), 10 in most surfaces (`text-balance` on headings, `text-pretty` on descriptions, `overflow-wrap` on long values), 13 (copy stored in natural case, case applied with `uppercase`, curly apostrophe in use, no `text-align: justify` found), 17 in `client/styles.css` (smoothing once on `body`), 18 for the stated scope (`lang="en"` from the shell, single locale, no RTL catalogue in the brief), 19 (no wide `user-select: none`, selection tint keeps inherited ink), 21 (no new face proposed), 22 (absence treated as enhancement only, see Recommendations).
Not inspected: Rule 18 bidi with real RTL content (no RTL locale or fixture exists in scope, brief records i18n as none found), Rule 20 at a larger browser default font size (runtime 200 percent captures did not change layout scale, see `runtime.md` Observations, so that claim stays under TYP-7 as unverified), S3 one-step versus 42-step story typography and S4 100-plus file counts (fixtures could not be injected, see `runtime.md` Not captured), physical-device iOS zoom behaviour (desktop emulation only).
Score: 2/4, Needs work. No text is unreadable at desktop sizes, but the review stylesheet has drifted off the token scale, several inputs miss the mobile size floor, and some truncated names have no reachable full value.

## Findings

### TYP-1: Review stylesheet has drifted off the type scale
- Rule: 4 Fewer fonts, sizes and weights, and 5 A type scale with semantic names
- Severity: MEDIUM
- Confidence: high
- Locations: `src/theme.ts:174`, `client/surfaces/review/review.css:125`, `client/surfaces/review/review.css:263`, `client/surfaces/review/review.css:889`
- Evidence: Canonical tokens define nine sizes, `--text-xs:10px;--text-sm:11px;--text-md:12.5px;--text-base:13px;--text-lg:16px;--text-xl:20px;--text-2xl:26px;--text-numeral:26px;--text-numeral-lg:56px` at `src/theme.ts:174`. The review stylesheet declares more than twenty additional one-off sizes, including near duplicates side by side on one screen, for example `font-size:9px` at `client/surfaces/review/review.css:125`, `font-size:13px` with `line-height:1.32` at `client/surfaces/review/review.css:263`, and `font-size:12.5px;line-height:1.48` next to `font-size:12px` for the two diff modes at `client/surfaces/review/review.css:889`. A count of distinct `font-size` pixel values in that file gives 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 15.5, 16, 17, 18, 19, 23, 25, 26, 27, 30, 32 and 34px. One diff screen therefore carries far more than five sizes and several weights, which is the rule 4 smell test. The token names are also size names (`--text-md`) rather than role names, so a role is still three separate decisions for size, leading and weight.
- Fix: In `src/theme.ts` `sharedTokens()`, map the review sizes onto the existing token scale (add a role token only where the diff genuinely needs one, for example a diff-code role at the current 12.5px with its leading), regenerate `client/generated/theme.css` with `node scripts/build-theme-css.mjs`, then replace the one-off pixel sizes in `client/surfaces/review/review.css` with those tokens. Keep the deliberate compact density, remove the near duplicates (10, 10.5, 11, 11.5 and 12, 12.5, 13, 13.5 collapse to two steps each).
- Why: When the scale stops making decisions, hierarchy depends on which file a component lives in. The same kind of label reads at a different size in the rail, the diff head and the TSX surfaces, which slows scanning in the constant diff-review loop.
- Verified: yes (code count quoted above, and the mixed sizes are visible in `screens/stress-S4-diff-longline-file-1440x900-dark.png` and `screens/review-1440x900-dark.png`)
- Systemic: yes

### TYP-2: Explain and comment inputs stay below 16px on mobile
- Rule: 15 Inputs at 16px on mobile
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/explain/ExplainApp.tsx:77`, `client/surfaces/explain/ExplainApp.tsx:368`, `client/surfaces/explain/ExplainApp.tsx:386`, `client/surfaces/review/review.css:660`, `client/surfaces/review/review.css:1586`
- Evidence: The explain field base is `text-base` at `client/surfaces/explain/ExplainApp.tsx:77`, and `--text-base:13px` at `src/theme.ts:174`, so the intended size is 13px with no mobile step. Two fields shrink further, `font-mono text-sm` (11px token) at `client/surfaces/explain/ExplainApp.tsx:368` and `client/surfaces/explain/ExplainApp.tsx:386`. The review comment box is `font-size:12.5px` at `client/surfaces/review/review.css:660`. The existing coarse-pointer fix at `client/surfaces/review/review.css:1586` covers only `.ds-file-search input,.ds-storyfile-search input` and `.ds-field-note textarea,.ds-queue-edit textarea` at 16px, not `.ds-composer-ta`. The project already has the right idiom elsewhere: `text-lg sm:text-[13px]` in the folder browser filter and `text-lg sm:text-base` in the scope ref field, both 16px at small widths.
- Fix: Apply the same project idiom. Give the explain `FIELD` a 16px small-width size (`text-lg sm:text-base` in token terms, with the mono fields at `text-lg sm:text-sm`), and add `.ds-composer-ta` to the existing `@media (pointer:coarse),(max-width:640px)` block at `client/surfaces/review/review.css:1586` so it also reaches 16px. Fix mode should confirm which of the two rule 15 shapes the user wants (size up on mobile, or 16px with a transform) before changing the explain surface, since they differ visually.
- Why: iOS Safari zooms the whole page when a focused input is under 16px. The explain form and the comment composer are frequent surfaces, so the page would jump on focus for touch users.
- Verified: no (code defect is direct, but no iOS device or Safari capture exists in this run. Confirm on iOS Safari or a coarse-pointer emulation at 375px by focusing each field and checking for page zoom)
- Systemic: yes

### TYP-3: Weights and an italic are used that no loaded face provides
- Rule: 2 Load the faces the design uses
- Severity: MEDIUM
- Confidence: high
- Locations: `src/theme.ts:134`, `src/theme.ts:142`, `client/surfaces/picker/Hero.tsx:25`, `client/shared/shared.css:361`, `client/shared/shared.css:455`, `client/surfaces/review/review.css:345`
- Evidence: Loaded faces are IBM Plex Sans and Mono at 400, 500, 600, 700 and Space Grotesk at 500, 600, 700 only, `src/theme.ts:134` to `src/theme.ts:144`. The wordmark sets Space Grotesk at 400 with `font-display text-2xl leading-none font-normal` and a nested `font-normal` span at `client/surfaces/picker/Hero.tsx:25`, a weight that family does not ship here. Interface CSS asks for unloaded weights, `font-weight: 650` at `client/shared/shared.css:361` and `font-weight: 750` at `client/shared/shared.css:455`, with 550, 650, 800 and 900 also used across `client/surfaces/review/review.css` (for example the 650 opening title and the 900 copy check). No italic face is loaded for any family, yet `.ds-health-more` sets `font-style:italic` at `client/surfaces/review/review.css:345`. With static per-weight woff2 files the browser picks a neighbour or synthesizes the missing form, which smears at these small sizes. No `font-synthesis` guard is set anywhere.
- Fix: Bring usage onto loaded weights in the project idiom: wordmark `code` at Space Grotesk 500, 650 usages to 600 or 700 by role, 750 and 900 to 700, and drop the italic on `.ds-health-more` in favour of weight or colour emphasis (the pattern `.ds-md em` already uses at `client/surfaces/review/review.css:589`). Do not add faces unless the design wants them.
- Why: Synthesized bold and oblique forms look smeared and read heavier than intended, most visibly in the wordmark seen on every picker visit and in small rail labels.
- Verified: yes (face list and usages quoted above; the rendered wordmark weight in `screens/picker-375x812-dark.png` is the synthesized or nearest-face result, not a loaded 400)
- Systemic: yes

### TYP-4: Some truncated names have no reachable full value
- Rule: 12 Truncate without losing content
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/stories/StoryRow.tsx:157`, `client/surfaces/stories/StoryHistory.tsx:153`, `client/surfaces/picker/FolderBrowser.tsx:475`, `client/shared/nav.tsx:118`
- Evidence: The story title truncates with no tooltip or title, `min-w-0 truncate text-lg font-semibold` at `client/surfaces/stories/StoryRow.tsx:157`. The history version title does the same, `block truncate text-sm font-medium` at `client/surfaces/stories/StoryHistory.tsx:153`. A folder name truncates bare, `block min-w-0 truncate text-start text-sm` at `client/surfaces/picker/FolderBrowser.tsx:475`. The nav crumb truncates at `max-w-[42ch] truncate` at `client/shared/nav.tsx:118` and relies on the native `title` attribute, which the rule notes does not prove touch or keyboard access. The project already has the correct pattern: truncated repo names, paths and refs are wrapped in the shared `Tooltip` component in `client/surfaces/picker/RecentRepos.tsx:181`, `client/surfaces/change/ScopeCard.tsx:260` and `client/surfaces/change/RefPicker.tsx:450`. Runtime stress S1 and S2 confirm the well-built cases truncate cleanly with ellipsis and no overflow (`runtime.md` Scenarios), which makes these four the inconsistent remainder.
- Fix: Wrap each of the four truncated values in the same shared `Tooltip` with the full string as content, following the `RecentRepos` and `ScopeCard` examples, keeping the basename-preserving split where a path is shown. Replace the crumb native `title` with that tooltip or an expanded view.
- Why: A story title, a history version title and a folder name are how a user tells two similar items apart. When the distinguishing tail is cut with no way to read it, the user has to open the wrong item to find out.
- Verified: yes (code quoted above, truncation behaviour confirmed for the covered cases in `runtime.md` S1 and S2; the four locations above have no tooltip in code)
- Systemic: no

### TYP-5: Label text runs well below the 12px floor across the review surface
- Rule: 16 Size floors
- Severity: MEDIUM
- Confidence: medium
- Locations: `src/theme.ts:174`, `client/surfaces/review/review.css:125`, `client/surfaces/review/review.css:175`, `client/surfaces/review/review.css:1205`
- Evidence: The smallest token is `--text-xs:10px` at `src/theme.ts:174`, and kickers use it at 10px in the TSX surfaces. The review stylesheet goes lower and does so often: `font-size:9px` kicker at `client/surfaces/review/review.css:125`, `font-size:9.5px` section label at `client/surfaces/review/review.css:175`, and `font-size:8.5px` rail beats head at `client/surfaces/review/review.css:1205`. A count in that file finds 29 declarations at 8, 8.5, 9 or 9.5px, plus many more at 10 and 10.5px for badges, counts and annotation tags that carry real content such as file counts and unexplained-change flags. Rule 16 allows interface text down to about 13px for captions and rarely below 12px. Dense data density explains compact rows, but 8.5 to 9.5px uppercase labels are below that floor and are not purely decorative.
- Fix: Raise content-carrying labels to the `--text-xs` token (10px) at minimum and preferably the 11px step, keeping purely decorative markers (carets, triangles) small. Do it through the TYP-1 token pass so the floor lives in one place.
- Why: At 8.5 to 9.5px, uppercase mono labels lose legibility first on lower-density displays and at the 375px widths this app already reflows to, which hurts scanning of counts and flags in the rail.
- Verified: no (sizes are direct in code and visible in `screens/stress-S4-diff-longline-file-1440x900-dark.png`, but no legibility failure was measured at 200 percent text zoom. Confirm by reading the rail labels in the 320px and 375px captures at full size)
- Systemic: yes

### TYP-6: Two heading sizes break the descending order
- Rule: 6 Heading sizes descend with level
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/Hero.tsx:25`, `client/surfaces/picker/PickerApp.tsx:215`, `client/surfaces/review/review.css:443`
- Evidence: On the picker, the `h1` wordmark is `text-2xl` (26px) at weight normal, `client/surfaces/picker/Hero.tsx:25`, while the subordinate `h2` Repositories heading is also `text-2xl` but bold, `font-display text-2xl leading-[1.1] font-bold` at `client/surfaces/picker/PickerApp.tsx:215`, so the child visually outranks its parent. In the review page sections, `.ds-reviewpage-h` headings are `font-size:13px` at `client/surfaces/review/review.css:443` while the review body base is `font-size:14px` at `client/surfaces/review/review.css:83`, so those section headings are smaller than body text without being label-style overlines (they are sentence-case bold titles).
- Fix: Drop the picker `h2` one scale step (to the 20px token) or raise its distinction with spacing rather than weight, and set `.ds-reviewpage-h` to the 14px body size or above through the TYP-1 token pass, keeping weight to separate it.
- Why: A squint test on the picker reads the section title as the page title. In review sections, a heading smaller than the text under it is easy to skim past.
- Verified: yes (sizes quoted above, picker order visible in `screens/picker-375x812-dark.png`)
- Systemic: no

### TYP-7: Type sizes are pixels throughout, so a larger default font size cannot grow the text
- Rule: 20 Respect the user's text size
- Severity: LOW
- Confidence: medium
- Locations: `src/theme.ts:174`, `client/generated/theme.css:182`, `client/surfaces/review/review.css:889`
- Evidence: Every type token is in pixels, `--text-xs:10px` through `--text-numeral-lg:56px` at `src/theme.ts:174`, bridged unchanged into Tailwind at `client/generated/theme.css:182`, and the review stylesheet hardcodes pixel sizes throughout (for example `client/surfaces/review/review.css:889`). No `rem` font size exists in the reviewed styles. Page zoom still scales pixels, and the 320px captures in `runtime.md` reflow without overflow, but a browser default font-size increase or an overridden root size has nothing to act on.
- Fix: Convert the type tokens in `src/theme.ts` to `rem` (same numeric scale divided by 16) and regenerate the theme bridge, then let the review stylesheet consume those tokens under TYP-1 instead of pixel literals. Keep pixel values for borders and hairlines.
- Why: A reader who raises the default font size, a common low-vision setting, gets no change here, while the layout was built assuming it could grow.
- Verified: no (no capture in this run exercised a larger root font size, and `runtime.md` records that the 200 percent zoom captures did not change layout scale. Confirm by setting a 20px browser default font size and reloading the change and review pages)
- Systemic: yes

### TYP-8: Hashes and large counts miss numeral safeguards
- Rule: 11 Numerals that fit the job, and 23 Display numbers without changing their meaning
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/review/format.ts:14`, `client/surfaces/change/ChangeApp.tsx:173`, `client/surfaces/change/FileSummary.tsx:169`
- Evidence: No `slashed-zero` or `slashed_zero` appears anywhere in the reviewed code, yet short commit hashes that can mix 0 and O are produced by `ref.slice(0, 8)` at `client/surfaces/review/format.ts:14` and shown in mono in scope lines. Counts are rendered raw with no locale grouping, `String(files.length)` at `client/surfaces/change/ChangeApp.tsx:173` and the template at `client/surfaces/change/FileSummary.tsx:169`, and no `Intl.NumberFormat` exists in the client. The numeral tokens `--text-numeral:26px` and `--text-numeral-lg:56px` at `src/theme.ts:174` are defined but never used, while the metrics that do show numbers use Space Grotesk with `tabular-nums` (`client/surfaces/change/ChangeApp.tsx:57`), a display face whose tabular figures depend on a feature the static woff2 may not expose the same way IBM Plex Mono does. Zero and missing values are handled well and verified in S5 (`0`, `+0`, `-0`, binary and metadata placeholders), so this is polish, not a correctness gap.
- Fix: Add `slashed-zero` to the mono utility used for hashes and IDs, format counts at or above four digits with `Intl.NumberFormat` in the existing format helpers, and either use the numeral tokens for the ledger metrics or delete them so the scale has no dead roles.
- Why: A misread hash digit sends a reviewer to the wrong commit, and an ungrouped five-figure count is slower to read in the file ledger. Both only bite at the stress end, which is why this stays low.
- Verified: no (absence confirmed by search, and S5 in `runtime.md` verifies zero and small counts only. Confirm with a hash containing both 0 and O and a scope of 1,000-plus files, which S4 did not inject)
- Systemic: no

### TYP-9: Kicker tracking and two pixel line heights are one-off values
- Rule: 8 Letter spacing by size, and 7 Line height by role
- Severity: LOW
- Confidence: high
- Locations: `src/theme.ts:175`, `client/surfaces/picker/Hero.tsx:29`, `client/surfaces/progress/Milestones.tsx:49`, `client/surfaces/review/review.css:525`
- Evidence: The token tracking for kickers is `--tracking-kicker:.14em` at `src/theme.ts:175`, already wider than the roughly 0.05em small uppercase labels need, and surfaces override it inconsistently: `.22em` on the wordmark kicker at `client/surfaces/picker/Hero.tsx:29` and `0.05em` on progress milestones at `client/surfaces/progress/Milestones.tsx:49`, with 0.09em to 0.13em variants across the review stylesheet. Two line heights are in pixels rather than unitless, `line-height:30px` at `client/surfaces/review/review.css:525` and a 16px line height in the same file, so they cannot scale with their font size.
- Fix: Settle kicker tracking on the token (tune `--tracking-kicker` once in `src/theme.ts`, remove the `.22em` and `0.05em` overrides), and express the two pixel line heights as unitless values of the same ratio.
- Why: Tracking is size-specific. Three different kicker widths make the same mono label role look like three different components, and a pixel line height silently detaches from any future size change.
- Verified: yes (values quoted above, kicker width difference visible between `screens/review-1440x900-dark.png` and the picker captures)
- Systemic: no

## Recommendations
- Consider `text-box: trim-both cap alphabetic` as a progressive enhancement on pill buttons and badges (Chromium and Safari only today). It would sit display text optically centred in the many pill controls. Absence is not a finding under rule 22.
- Consider `font-optical-sizing: auto` if a variable IBM Plex build is ever adopted. With the current static woff2 faces there is nothing for it to drive, so it is not proposed as a fix now.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/review/review.css:1025` | `user-select:none` on diff line numbers and signs | A specific gutter surface where selection would pollute copied code, which rule 19 allows. Code text itself stays selectable. |
| `client/surfaces/change/ChangeApp.tsx:57` | `leading-none` on the ledger metrics | Single-line numerals that never wrap, so tight leading is permitted by rule 7. The same holds for the wordmark and stage numerals. |
| `client/surfaces/change/FileSummary.tsx:57` | Directory truncation in file rows | The basename stays fully visible as a non-shrinking sibling and the full path is on the row. Preserving the distinguishing suffix is what rule 12 asks for. The S1 capture shows it working. |
| `client/surfaces/review/review.css:292` | Intro title at 32px with `text-wrap:balance` and 1.16 leading | Matches rule 7 and 10 for a display heading, and the opening variant scales it deliberately. No orphan or tight-leading problem found. |
| `client/styles.css:48` | Selection tint with no explicit text colour | The tint is a light accent wash over the surface and ink stays inherited, so selected text remains legible in both themes. No contrast failure is in this lens to cite. |

## Handoffs
- A11Y: Heading level structure behind TYP-6 (which element is `h1`, `h2`, `h3`) at `client/surfaces/picker/PickerApp.tsx:215` and `client/surfaces/review/ReviewView.tsx:216`. This lens only judged the sizes.
- A11Y: Truncated values that rely on hover tooltips in TYP-4 also need keyboard and touch reachability checks at `client/surfaces/picker/RecentRepos.tsx:181` and `client/surfaces/change/ScopeCard.tsx:260`.
- COL: Contrast of the smallest labels in TYP-5 at `client/surfaces/review/review.css:125`, especially the 9px kicker colour on its surface.
- LAY: Horizontal overflow at 320 and 375px (9px and 64px recorded on the change page in `runtime.md`) and rail truncation layout in stress S1 and S4. This lens judged only the truncation mechanics.
- COPY: Plural and wording around the counts in TYP-8, and the missing-metadata phrasing. This lens judged only the numeric display.
- VIS: Wordmark lockup appearance once its weight is corrected under TYP-3 at `client/surfaces/picker/Hero.tsx:25`.
