# Accessibility findings
Scope inspected: Final independent, read-only change review of all six client surfaces, shared Tooltip, modal, menu and navigation primitives, review engine/CSS, canonical theme tokens, and server-emitted HTML. Quick mode covers HIGH and MEDIUM regressions and every original accessibility finding. Re-read the final picker skip target, success-toast guard, Tooltip focus retention and viewport clamp, full-file-path trigger, ref validation, narrow review chrome and diagram focus rules. Read `fixes/runtime-recheck.md` and directly inspected its long-repository/branch, invalid-ref, 320px review, forced-colors review, root-font stress, long-basename, 320px Explain, 320px history and 320px 404 captures. Implementation result notes were not treated as proof.
Not inspected: End-to-end keyboard focus destinations for skip, theme Tab, busy removal and focus restoration; focused panel/filmstrip captures; full-value tooltips actually open; native file-dialog return; real screen-reader output; actual 200 percent browser zoom; physical-device scroll, browser chrome and software keyboard behavior. The root-font capture is text-size stress only. Progress milestone states have source coverage but no fresh rendered fixture in runtime-recheck.md. Timed reload pause/resume has source coverage but no observed interaction in that runtime report. Contrast ratios belong to COL, motion behavior to MOT.
Score: 4/4, no remaining HIGH or MEDIUM regression found in the inspected scope. All original IDs have source replacements; runtime verification is limited to the specific evidence below.

## Findings

None at HIGH or MEDIUM severity in this final round.

## Original ID dispositions

“Resolved in source” confirms an equivalent replacement in the current code. It does not claim browser or assistive-technology verification.

| Original ID | Disposition | Current evidence and remaining proof |
|---|---|---|
| A11Y-1 | Resolved in source | `client/surfaces/review/review.css:464` now gives `.ds-reviewpanel:focus-visible` `box-shadow:var(--shadow-focus)`. The forced-colors override at `:1604` supplies a system outline. A browser focus capture and COL measurement remain. |
| A11Y-2 | Resolved in source | `client/surfaces/review/StoryHealth.tsx:86` renders visible `Error: ` or `Warning: ` before each message and hides the redundant dot. Real screen-reader output remains unverified. |
| A11Y-3 | Resolved in source; narrow layout verified | `client/surfaces/picker/RecentRepos.tsx:112` supplies `min-w-0 max-w-full`; the branch text at `:114` truncates. The row tooltip at `:145` includes the full branch through its focusable button. `fixes/screens/stress-long-repo-branch-375.png` visibly contains the branch and runtime reports zero page overflow. The open tooltip and actual browser zoom remain unverified. |
| A11Y-4 | Resolved in final source | `client/surfaces/picker/PickerApp.tsx:217` renders SkipLink. The main id is now `picker-main` at `:219`; the link's `main-content` target is the focusable Repositories h1 after Hero at `:228`. Sequential content therefore begins after the menus. Actual Enter/Tab interaction remains unverified. |
| A11Y-5 | Resolved in source | `client/shared/theme-menu.tsx:94` handles Tab with `close(false)` and permits default traversal; hidden menus are also inert. Confirm the next focus destination in a browser. |
| A11Y-6 | Resolved in source | `client/surfaces/stories/RemoveStoryDialog.tsx:80` moves focus to the dialog while buttons are busy. `client/shared/use-modal.ts:170` checks containment before restoring and has a stable background fallback. `client/surfaces/stories/StoriesApp.tsx:69` schedules focus on a surviving heading after success. Busy, failure, success and final-row focus require interaction evidence. The new toast scope issue is separately resolved below as A11Y-18. |
| A11Y-7 | Resolved in source | `client/surfaces/review/Sidebar.tsx:338` includes unexplained/regenerated states in the initial name. `client/surfaces/review/engine/review-engine.js:2933` synchronizes the full file path, explicit reviewed/not reviewed state, unexplained flag and regeneration title. Verify names before and after toggling reviewed state in the browser accessibility tree. |
| A11Y-8 | Resolved in source; unknown-ref and valid-expression behavior verified | `client/surfaces/change/ScopeCard.tsx:424` associates `aria-invalid` and field-specific errors; `:463` requests committed validation; `:803` renders an inline alert retained by quiet-subtree at `:550`. `client/surfaces/change/RefPicker.tsx:228` uses `/api/refs/resolve` for committed Enter/blur, while typing uses bounded suggestions. The server delegates to Git resolution at `src/server.ts:1142`, avoiding rejection of valid refs absent from suggestions. `fixes/runtime-recheck.md` records unknown-ref `aria-invalid="true"` and navigation to commit `HEAD~1`; `fixes/screens/change-invalid-ref-375.png` shows the field and error text. Full error text is partially covered while the listbox remains open, so blur-state and screen-reader output are not verified. The source tests at `test/app-server.test.mjs:870` cover HEAD, HEAD~1, tag and full SHA versus invalid values; this review inspected those assertions and did not rerun them. |
| A11Y-9 | Resolved in source | `client/surfaces/review/engine/review-engine.js:141` tracks remaining time and pauses the timer; `:4367` binds hover/focus pause and resume. `client/surfaces/review/ReviewApp.tsx:605` describes the pause. Observed timing and focus behavior remain unverified. |
| A11Y-10 | Resolved in source | `client/surfaces/review/review.css:1274` adds the project focus shadow to the film node independently of magnification. Rendered visibility and contrast remain browser/COL checks. |
| A11Y-11 | Resolved in source | `client/surfaces/picker/FolderBrowser.tsx:347` adds `min-h-6 min-w-6`, a 24px floor at the default root size. Rendered target measurement remains unverified. |
| A11Y-12 | Resolved in inspected call sites | The original Plus, Trash2, Folder/Chevron and FileSummary arrow call sites now pass `aria-hidden="true"`, including `client/surfaces/picker/PickerApp.tsx:245`, `client/surfaces/picker/RecentRepos.tsx:189`, `client/surfaces/stories/StoryRow.tsx:302`, and the Review action arrow in `client/surfaces/change/FileSummary.tsx`. This is not a claim that every vendored SVG was audited in every browser. |
| A11Y-13 | Resolved in source | `client/surfaces/stories/StoriesApp.tsx:222` retains a real visually hidden file input without `aria-hidden`, and gives it `aria-label="Import story bundle"`. Native file-picker return remains unverified. |
| A11Y-14 | Resolved in source | `client/shared/shared.css:158` contains scrim overscroll; the actual scrolling folder list also has `overscroll-contain` at `client/surfaces/picker/FolderBrowser.tsx:426`. Physical trackpad/touch boundary behavior remains unverified. |
| A11Y-15 | Resolved in source | `client/surfaces/explain/ExplainApp.tsx:327` computes a nearby blocker explanation and `:544` associates the submit button with the persistent `explainSubmitHelp` element at `:554`. Missing-writer/no-commit rendering remains a fixture check. |
| A11Y-16 | Resolved in source | `client/surfaces/picker/Hero.tsx:25` uses a plain span for the wordmark; `client/surfaces/picker/PickerApp.tsx:228` makes Repositories the h1. A browser heading-list inspection remains unverified. |
| A11Y-17 | Resolved in source | `client/surfaces/progress/Milestones.tsx:47` exposes `aria-current="step"`; `:72` provides Done, In progress, Stopped at, Failed and To do prefixes without adding another live region. Read running/failed/stopped fixtures with assistive technology to verify the result. |

## Follow-up finding disposition

| ID or check | Disposition | Final evidence |
|---|---|---|
| A11Y-18, toast above next removal modal | Resolved in source | `client/surfaces/stories/StoriesApp.tsx:322` now renders the visual toast only for `status && !target`. It cannot coexist with a queued removal target. The persistent polite status region remains inside the background wrapper. A two-removal interaction was not recorded in runtime-recheck.md. |
| Tooltip loses focused content on pointer leave | Resolved in source | `client/vendor/beui/motion/tooltip.tsx:189` exits the leave handler while the anchor contains focus. Keyboard activation still bypasses hover capability at `:165`; Escape dismisses at `:204`. Combined pointer/keyboard interaction remains unverified. |
| Long tooltip placement | Mitigated in source | `client/vendor/beui/motion/tooltip.tsx:147` measures and clamps the bubble to the viewport, then repositions after opening at `:202`. The content width and unbroken strings are constrained at `:267`. No open-tooltip screenshot was supplied, so clipping with extreme height is not verified. |
| Long file path accessibility | Resolved in source; ordinary narrow layout verified | `client/surfaces/change/FileSummary.tsx:56` wraps the full path in Tooltip; its trigger is keyboard focusable and click focuses it at `:57`. Children retain the full path in the DOM. `fixes/screens/stress-long-basename-375.png` contains the truncated row without page overflow. The open tooltip remains unverified. |
| Review close control at 320px | Verified for captured fixture | `client/surfaces/review/review.css:1668` lets the action island shrink, with only the tab strip scrolling. The 320px review captures show Close inside the viewport; runtime reports x=275, width=44, inside=true in both themes. |
| Light diagram focus outline | Resolved in source | `client/surfaces/review/review.css:1635` applies the decorative light outline only with `:not(:focus-visible)`, preserving the focused outline. A focused diagram screenshot remains unverified. |

## Runtime evidence limits

- The current runtime report shows real picker, history, scope, review, Explain and 404 documents in light and dark themes at 1440, 375 and 320px, with zero reported document overflow. This supersedes the earlier false-404 capture set. It does not establish that every menu, dialog or data state reflows.
- Directly inspected forced-colors review content remains visible with system borders and controls. That screenshot is not focused on a review panel, diff status, film node or diagram, so it does not verify those focus indicators or every non-color cue.
- The 200-percent-root-font review capture shows enlarged, readable content in the main scrolling region. It is not native browser zoom and does not prove WCAG zoom coverage.
- No browser keyboard transcript or accessibility-tree dump accompanies this runtime report. Source-backed labels, errors, focus restoration and live announcements therefore remain source-level conclusions.

## Recommendations
- None within this quick recheck.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/ScopeCard.tsx:637` | Closed scope fields remain available to Tab | The panels pair `aria-hidden` with `inert`; the pointer path is disabled during exit too. |
| `client/surfaces/change/ScopeCard.tsx:424` | The Input overrides the new invalid association | The Input spreads `rest` after its default ARIA attributes at `client/vendor/beui/motion/input.tsx:156`, so the supplied error association wins. |
| `client/vendor/beui/motion/tooltip.tsx:224` | Tooltip erases a child's existing description or event handler | It concatenates existing `aria-describedby`, and focus/pointer listeners live on the wrapper rather than replacing the child's handlers. |
| `client/surfaces/review/VideoExport.tsx:153` | Video export modal lacks a keyboard focus scope | It uses native `dialog.showModal()` at `:60`, labelled by its heading, and restores focus explicitly. Native dialog runtime behavior remains unverified. |
| `client/surfaces/change/RefPicker.tsx:228` | Error handling rejects valid refs outside suggestions | Committed values now resolve on the server through Git; only passive typing uses suggestion membership. Runtime confirms navigation for HEAD~1. |

## Handoffs
- COL: Final rendered panel/film-node/diagram focus contrast remains with the color reviewer. The forced-colors screenshot confirms the general content state, not every focused control.
- Runtime owner: Source replacements and the listed narrow captures support closing the original findings in this scope. Keep the untested focus flows, progress states, open tooltips, native browser zoom, real screen reader and physical-device behavior explicitly unverified.
