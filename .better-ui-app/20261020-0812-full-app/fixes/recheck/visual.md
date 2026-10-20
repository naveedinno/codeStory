# Visual findings
Scope inspected: quick HIGH/MEDIUM regression review of the current working tree, plus dispositions for original VIS-1 through VIS-10. Read the visual lens, mobile-web visual section, brief, original visual findings, repair briefs and results, canonical tokens, DESIGN_MEMORY, shared chrome, picker, stories, change, explain, progress and review CSS. Inspected legitimate fixes/screens captures: picker-1440-light, stories-1440-light, stories-375-light, change-1440-dark/light, explain-1440-dark/light, review-1440-dark/light. Refreshed stories-1440-light, change-1440-dark and explain-1440-dark after the final grouping and endpoint-radius fixes. Source files were read-only.
Not inspected: actual hover/focus/pressed/disabled touch interactions, rendered progress overlay and ref popover after repairs, rendered Mermaid primer/fullscreen, all-files/code-step after repairs, or RTL (no shipped RTL locale). The final scope track/segment and explain choice-radius changes postdate the inspected screenshots, so those last nested-radius dispositions are source-supported. Review-320, forced-colors and root-font evidence remains owned by the orchestrator and layout/accessibility reviewers while fixtures are refreshed. No physical-device or deployment claim. The empty picker fixture cannot verify populated repository-card edges.
Score: 4/4 for the quick HIGH/MEDIUM pass. No remaining or introduced HIGH/MEDIUM visual findings after the orchestrator corrected the grouping gaps identified during this recheck. Original target dispositions and runtime limits follow.

## Findings

No remaining HIGH or MEDIUM visual findings. No LOW findings added in this quick pass.

## Original finding dispositions

| ID | Disposition | Evidence and remaining scope |
|---|---|---|
| VIS-1 | Fixed | `ScopeCard.tsx:555`, `FileSummary.tsx:99` and `:175`, `ExplainApp.tsx:387`, `StoryRow.tsx:108` and `RecentRepos.tsx:167` now use border-line-soft. The refreshed stories-1440-light capture shows the full outer boundary grouping title, action and footer. A populated repository fixture remains source-only. |
| VIS-2 | Fixed | `Hero.tsx:15` clips the backdrop with `[clip-path:inset(35%_0_30%_0)]`. `picker-1440-light.png` shows a short open thread exiting behind the lockup, with no enclosing empty pill. Small-view hide remains. |
| VIS-3 | Main original targets fixed, source coverage limited | `RefPicker.tsx:448`, `ProgressPanel.tsx:95`, review.css composer at `:646` and command palette at `:822` use var(--shadow). Dock `:1253` and storyless filmthread `:1270` have box-shadow:none. StoryRow hover `:225` now uses the canonical recipe. The beUI bridge retains its compatibility shadow scale. Additional pre-existing literal recipes remain in narration settings `review.css:1501`, live banner `:1538` and video export `:1625`; these are not a new repair regression, and those overlays lack fresh captures. The claim that every overlay now uses one recipe would be too broad. |
| VIS-4 | Fixed in source; final nested track captures pending | Scope island p16 derives track and slots as `calc(var(--radius-island)-16px)` = 10px at `ScopeCard.tsx:106` and `:185`; track inset4 derives segments at 6px (`:113`). Explain p20 derives fields and track at 6px (`ExplainApp.tsx:77`, `:89`), and choice tiles at max(0px,26px-24px) = 2px (`:83`). Refreshed change capture confirms endpoint slots10, but scope track/segment and explain choice final changes postdate the inspected images. No new HIGH/MEDIUM visual regression from those source changes. |
| VIS-5 | Fixed | DESIGN_MEMORY's Surfaces and Layout sections now record islands 26px, controls 8/12/18 and derived nested radii, matching `src/theme.ts:179`. No contradictory 16px-island rule remains in the inspected design guidance. |
| VIS-6 | Original target mappings fixed | Feedback alert `review.css:161`, storygen `:343`, choice `:372`, search `:387`, tab `:1175` and diagram `:1307` now use tokens. The followup also maps 6/11/13px surface radii, including `.ds-why` at `:542`, `.ds-trust-stat` at `:780`, and coarse-pointer beat buttons at `:1284`, onto the shared scale. Remaining literal 8/12/18 values match the documented scale; tiny marker and keycap radii are separate micro geometry. No new HIGH/MEDIUM surface mismatch observed. |
| VIS-7 | Original specified pairings fixed | Folder glyphs `RecentRepos.tsx:189`, Code2 `editor-menu.tsx:24`, GitBranch/GitCommit in ScopeCard and primary arrows use 2px. Reviewed chip `FileSummary.tsx:105` uses 1.5px. DESIGN_MEMORY records weight-matched icons and the retained 16px rail convention. New/current icons use currentColor; no duplicate per-state icon asset scheme was introduced. No global claim that every glyph has been normalized. |
| VIS-8 | Fixed in source | FileSummary primary `:192` uses ps15/pe13; Explain submit `:546` uses ps16/pe14. The walkthrough's final rules use 2px less inset at the arrow: opening `review.css:1366` has 20px start/18px end; default `:1369` has 18/16; narrow `:1434` has 16/14. The final geometry delta is source-supported; screenshots do not measure a 2px optical effect. |
| VIS-9 | Fixed in source, runtime unverified | `review.css:1307` has a flat panel3 background, no shadow, token radius and neutral white 10% inward outline. Light outline override is pure black 10% at `:1635`. No legitimate post-fix Mermaid capture is available, so diagram framing and fullscreen clipping remain source-supported only. |
| VIS-10 | Fixed | FileSummary `:192` and PickerApp `:243` now use control-h-lg, matching story and explain page primaries. DESIGN_MEMORY documents 40px page primaries and 34px bar/card actions. Actual change and picker desktop captures show matching primary height. The walkthrough's larger narrative start action is a separate role and was not an original location. |

## Recommendations

None.

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| Hero.tsx:35 | Background-colored shadow around masthead controls violates flat elevation | The zero-blur, zero-offset spread masks the thread behind chrome. It is a background plate, not a depth shadow. |
| DESIGN_MEMORY; review and scope kickers | Tracked uppercase kickers and structural numerals look templated | These are explicit Signal / Thread-Ledger choices, retained appropriately. |
| ExplainApp.tsx:77 | Every 18px field must become 6px because the island has p20 | The first field is vertically separated from the island corner by its label; later fields are independent surfaces. The concentric test should follow actual corner-adjacent nesting. |
| review.css:1495 | Selected segmented tab has a small local shadow | It marks the selected control inside a recessed track, not elevation of an entire in-flow island. No new visible inconsistency found in valid review captures. |

## Handoffs

- LAY: review 320px header and corrected fixture captures remain owned by the orchestrator. This report does not use the superseded evidence for a new visual finding.
- A11Y: the light diagram neutral-outline rule at `review.css:1635` has higher specificity than the focused outline at `:1307`. Scope the neutral rule to the unfocused state or retain the focus color with a later selector. Sent to the orchestrator during recheck; no rendered Mermaid focus evidence available.
- Capture: a populated light picker, current progress/ref overlays, code step/all-files, and Mermaid primer in both themes would close the named visual coverage limits. Do not treat their absence as proof of a rendered defect.
- MOT: touch pressed/focus/disabled and hover transitions were source-inspected only; no interaction smoothness claim is made here.
