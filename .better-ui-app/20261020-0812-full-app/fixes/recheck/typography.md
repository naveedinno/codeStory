# Typography findings
Scope inspected: quick HIGH/MEDIUM regression recheck of all six React surfaces, shared navigation and Tooltip, canonical and generated type tokens, review CSS and concept typography fitter. Read the Typography rulebook (rules 1–23), mobile-web Typography checks, original brief and original TYP-1–9 findings. Reviewed the current diff and live source. Runtime stills inspected directly: fixes/screens/stress-long-basename-375.png, review-1440-dark.png, review-375-dark.png, review-320-dark.png, picker-375-dark.png, explain-375-dark.png, stories-375-light.png. Source read-only.
Not inspected: physical-device iOS focus zoom, default-font stress, 200% browser text zoom, real mixed-direction content and actual concept-step font fitting. The first root-font-200pct capture rendered Page not found and does not verify review typography; a corrected capture run is pending. Desktop-emulated mobile screenshots cannot prove physical Safari behavior.
Score: 4/4 for the inspected scope, no unresolved typography finding in the final source. Corrected root-font and open-tooltip runtime checks remain unavailable until recapture. This score does not verify those coverage gaps.

## Findings

None unresolved at HIGH/MEDIUM in the current source.

The recheck initially found TYP-10 (MEDIUM), a changed-file basename truncation regression at `client/surfaces/change/FileSummary.tsx:55`–60. The stress-long-basename-375 still directly showed the distinguishing tail clipped. This was corrected during recheck: the path now has the shared Tooltip, a `tabIndex={0}` trigger, full `aria-label`, inset focus ring, and click-to-focus for touch. The source mechanism is addressed. A screenshot of the open tooltip or an observed focus/tap interaction is still needed to verify its rendered recovery behavior.

## Original dispositions

| ID | Disposition | Current evidence and limits |
|---|---|---|
| TYP-1 | Addressed in source | `client/surfaces/review/review.css` maps ordinary sizes onto the shared tokens. Concept presentation roles retain intentional rem sizes and their own hierarchy; this is a separate presentation use, not repeated near-duplicate rail-label sizing. Density and readable hierarchy still require captures. |
| TYP-2 | Addressed in source | `client/surfaces/explain/ExplainApp.tsx:77` has `max-sm:text-lg` and coarse-pointer `text-lg`, including the two mono overrides. `client/surfaces/review/review.css:1648` gives `.ds-composer-ta` `1rem` on small/coarse input environments. At the standard 16px root these resolve to 16px. Physical iOS focus zoom remains unverified. |
| TYP-3 | Addressed in current source | Faces remain woff2 with Sans/Mono 400/500/600/700 and Space Grotesk 500/600/700. Hero uses loaded 500/700. Unsupported weights were normalized. The initially retained `.ds-health-more` italic was changed to `font-style:normal` at `client/surfaces/review/review.css:342` during recheck. No browser rendering claim follows from the source change. |
| TYP-4 | Original four addressed in source; discovered FileSummary regression also corrected in source | StoryRow wraps its focusable row anchor in Tooltip. StoryHistory's title trigger has `tabIndex={0}`. Nav crumbs use Tooltip, and the current crumb is focusable. FolderBrowser's keyboard navigation/filter sets `showActiveName` and renders the full name below the filter at `client/surfaces/picker/FolderBrowser.tsx:413`; this expanded view supplies the keyboard alternative even though the row's nested tooltip span is not focusable. Shared Tooltip permits keyboard focus independently of hover capability and handles Escape. Touch recovery for every tooltip is still unverified. |
| TYP-5 | Selected compact-floor fix addressed in source | The 8–9.5px content labels were raised onto `--text-xs` (0.625rem, normally 10px). This meets the approved compact-scale target, rather than proving a general 12px floor or measured legibility. The lens allows deliberate dense-interface exceptions; no HIGH/MEDIUM unreadability claim can be established from a token value alone. Inspect the rail at normal size and text enlargement. |
| TYP-6 | Addressed in current source | Picker's wordmark is now a brand span and Repositories is its page h1, so the original child-heading comparison no longer applies. Review section headings now use `var(--text-lg)` (normally 16px) at `client/surfaces/review/review.css:440`. The picker375 still shows a clear page title and subordinate empty-state heading. |
| TYP-7 | Addressed in final source, runtime growth unverified | `src/theme.ts:174` defines rem text tokens. The concept fitter in `client/surfaces/review/engine/review-engine.js:758`–766 emits rem and searches only scales >=1, retaining the user's baseline rather than shrinking below it to fit. Final TSX grep finds no arbitrary font-size px remaining in client/shared or the surfaces. Opening-title clamp bounds now use exact rem equivalents at `client/surfaces/review/review.css:1363` and :1423. Late-added `.ds-challenge-reason` / `.ds-health-location` use `var(--text-sm)` at :1608–1609. The first root-font capture was Page not found, so app-wide default-font growth remains unverified pending recapture. |
| TYP-8 | Selected numeral policy addressed in source | `client/surfaces/change/format.ts:10` and `client/surfaces/review/format.ts:9` use Intl.NumberFormat above the approved 10,000 threshold; small counts retain their exact values and signs. Callers in the file inventory and review use the helper. `client/surfaces/review/review.css:1654` applies slashed-zero to scope refs/hashes/blame titles. The original suggestion to use or delete otherwise unused numeral roles is optional cleanup, with no newly established HIGH/MEDIUM defect. A hash fixture containing O is invalid because hexadecimal IDs contain no O; it should not be demanded as a stress test. |
| TYP-9 | Addressed in current source | Shared kicker tracking is now `.05em`; milestone and Hero tracking consume it. The original fixed-pixel line heights no longer remain in review.css. Rule 8 does not require every decorative label or non-kicker role to share identical tracking. FolderBrowser's fixed34px input line box belongs to its fixed-height control and was not measured at larger text sizes; that separate stress condition remains unverified. |

## Recommendations
- None beyond the selected fixes. Keep the project's chosen families and compact review density.

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/picker/FolderBrowser.tsx:478` | The nested name Tooltip cannot receive the parent option's keyboard focus | Keyboard navigation and filtering explicitly render the full active name below the filter, satisfying a separate expanded-view route. |
| `client/surfaces/review/engine/review-engine.js:769` | Concept fit cancels user text enlargement | Its rem baseline follows the root, the fitter never shrinks below scale 1, and narrow layouts clear the fit. Runtime may still expose layout problems but the old px mechanism is replaced. |
| `client/surfaces/review/review.css:342` | Missing italic face | The latest current source is `font-style:normal`; the earlier observed residual no longer holds. |
| `client/surfaces/review/review.css:1022` | Unselectable diff gutter | The specific line-number/sign gutter avoids contaminating copied source. Code text remains selectable. |
| `src/theme.ts:174` | Compact 10px token alone proves unreadability | Dense interface exceptions and the selected approved target require actual reading evidence. No screenshot yet establishes unreadable type. |

## Handoffs
- LAY/A11Y: Verify the corrected changed-file full-value recovery path by keyboard and tap at `client/surfaces/change/FileSummary.tsx:55`–62. The source now provides a reachable trigger; the open bubble has not been observed.
- LAY: The initial runtime report records 40px overflow on review320 in both themes. The supplied still shows chrome partly outside the viewport. This is shared-chrome layout evidence, with no additional typography cause established.
- Runtime: rerun root-font and forced-colors captures on a real review route after restoring the selected fixture repository. A 200% root-font override tests rem behavior, not browser zoom or physical iOS focus zoom.
