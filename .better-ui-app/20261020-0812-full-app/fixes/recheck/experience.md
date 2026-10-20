# Experience findings
Scope inspected: Final independent, read-only recheck of original EXP-1 through EXP-8, the first recheck's EXP-9, and HIGH/MEDIUM regressions in the current source diff. Traced picker open/remove/restore, scope/ref selection and authoritative ref resolution, Explain draft and generation recovery, story deletion/import/history restore, progress state changes, review feedback and shared Tooltip. Read the Experience rulebook, brief, original findings, current fixes/runtime-recheck.md, and the other reviewers' relevant handoffs. Directly inspected fixes/screens/404-375-dark.png, stress-long-repo-branch-375.png, change-invalid-ref-375.png, and explain-restored-draft.png. Read the valid/invalid resolver integration assertions in test/app-server.test.mjs. Rules 1 through 11 checked through source, runtime scenario results or the listed stills.
Not inspected: Injected history failure/retry, held scope navigation, dismissed picker undo, story-removal success and follow-up modal still lack fresh interaction evidence in the inspected runtime report. No long-running writer was invoked, so successful draft clearing remains source-evidenced. Explain question restoration is captured; paths/ref restoration and switching among different story contexts are not separate verified scenarios. The report records 43 nodes for the 42-step fixture; detailed navigation and collection-boundary behavior were not observed by this reviewer. The 100-plus-file, stale and offline scenarios remain uncovered. Resolver tests were read, not run by this reviewer. Physical-device, screen-reader, animation timing and native browser zoom claims are outside this pass.
Score: 4/4, no actionable Experience finding remains in the inspected source; runtime limits are listed above.

## Findings

None remaining. EXP-9 was corrected during recheck; its resolution is recorded below.

## Original ID dispositions

“Resolved in source” means the original mechanism has an equivalent replacement. It does not assert the missing interaction evidence passed.

| Original ID | Disposition | Current evidence and remaining proof |
|---|---|---|
| EXP-1 | Resolved in source and inspected error still | `src/server.ts:695` and `:1553` render `pageNotFound()` for page-like repo routes with HTTP 404. `:4651` provides branded navigation, a heading, an explanation and a repository link. fixes/screens/404-375-dark.png visibly contains these recovery controls. The recovery link was not clicked in this pass. |
| EXP-2 | Resolved in source; question round-trip verified by capture workflow | `client/surfaces/explain/ExplainApp.tsx:107` keys session storage by repo route, `:159` restores a matching story context, `:181` saves question/paths/ref, and `:209` clears after a successful saved-story result. Failure and cancellation keep the fields. The current runtime report's Explain draft round trip restores "How is the monthly cap checked?", visible in explain-restored-draft.png. Successful writer completion and paths/ref round-trips remain unverified. Drafts for different story contexts still share one repo key; no multi-context retention claim is made. |
| EXP-3 | Resolved in source and reported invalid-ref scenario | `client/surfaces/change/ScopeCard.tsx:423` associates field errors; blur and Enter commit with delay zero, which `:463` passes as authoritative validation. `:473` keeps unmatched text while setting an inline error. The current runtime report records value `unknown-ui-ref-for-recheck` with `aria-invalid=true`; change-invalid-ref-375.png shows the field retained and an inline error. The error's full association is source-evidenced. The separate validity issue EXP-9 is now resolved. |
| EXP-4 | Resolved in source | `client/surfaces/picker/RecentRepos.tsx:167` disables missing repository cards, and its context menu omits Open for them at `:276`. `client/surfaces/picker/PickerApp.tsx:145` offers retry only for network/server failure, so a rejected path no longer invites a guaranteed repeat. A missing-row interaction fixture remains unverified. |
| EXP-5 | Resolved in source | `client/surfaces/stories/StoryHistory.tsx:51` extracts load, and `:149` renders Try again wired to that callback in the error state. Restore failure is separate at `:109`, preserving the loaded history and a row-level retry. Injected failures and successful retry remain unverified. |
| EXP-6 | Resolved in source | `client/surfaces/change/ScopeCard.tsx:320` sets busy before document navigation, `:556` exposes the busy card, `:630` renders Loading review scope, and fields/segments are disabled while busy. A held route is needed to establish observed acknowledgement and paint timing. |
| EXP-7 | Resolved in source, including styling follow-up | `client/surfaces/picker/PickerApp.tsx:168` retains the most recent undo independently from status; `:187` restores from it; `:260` renders a footer Restore after the toast is dismissed or replaced. The icon-only row remove button at `client/surfaces/picker/RecentRepos.tsx:253` now uses `text-danger-text` at rest, retaining danger text on hover and through the focus state. The context-menu removal action also has danger treatment. Dismiss-then-Restore remains an unverified interaction. |
| EXP-8 | Resolved in source | `client/surfaces/stories/StoriesApp.tsx:95` sets the removal status and `:322` renders it visibly with a dismiss control, alongside the existing single announcement region. The toast now checks `!target`, so it is suppressed during the next removal modal. Success/removal interaction still needs capture. |

## Resolved during recheck

| ID | Disposition | Current evidence and limits |
|---|---|---|
| EXP-9 | Resolved in source; Git-expression navigation reported by capture workflow | `client/surfaces/change/RefPicker.tsx:228` accepts a committed flag. Enter/blur use the new `/api/refs/resolve` request at `:234`, while automatic typing retains suggestion matching. `src/server.ts:1142` calls the existing `resolveCommit`, whose `src/git.ts:1079` implementation applies safe-ref checks and `rev-parse --verify --end-of-options ref^{commit}`. `test/app-server.test.mjs:870` asserts valid HEAD, HEAD~1, tag and full SHA, then unknown/unsafe/empty rejection. These tests were read rather than run in this pass. The runtime report's valid Git expression scenario records navigation to `change?scope=commit&commit=HEAD~1`. Merge-commit entry and each compare slot lack a separate browser scenario, but no longer depend on suggestion membership in the source. |

## Recommendations
- None within this regression recheck.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/stories/StoriesApp.tsx:322` | Previous story-removal toast remains interactive above the next modal | The current source now uses `status && !target`; the earlier A11Y handoff described an intermediate revision. Runtime verification still belongs to A11Y. |
| `client/vendor/beui/motion/tooltip.tsx:175` | Pointer departure always hides a tooltip while its trigger remains focused | Current `leave` checks whether the anchor contains `document.activeElement`. The original handoff was corrected during this recheck. |
| `client/surfaces/picker/PickerApp.tsx:260` | Dismissing the removal toast loses the restore path | The new heldUndo footer outlives the status message and calls restoreRepo. |
| `client/surfaces/change/ScopeCard.tsx:320` | Scope navigation still has no feedback | Busy state, visible loading text and disabled fields are present. Missing held-load capture limits verification rather than proving the state is absent. |
| `client/surfaces/change/RefPicker.tsx:232` | Tags, full SHAs and Git expressions remain rejected solely for missing from suggestions | Committed input now uses server-side commit resolution. Only automatic typing remains suggestion-based. |

## Handoffs
- A11Y/LAY: The current runtime report records the review close control inside the 320px viewport in both themes, at x=275 and width=44, with zero document overflow. This replaces the earlier clipped-control evidence. Detailed keyboard reachability remains the owning lens's claim.
- Runtime owner: The remaining interaction coverage gaps are explicit under Not inspected. Source, static captures, scenario logs and tests read without execution are different evidence boundaries.
