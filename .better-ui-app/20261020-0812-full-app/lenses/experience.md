# Experience findings
Scope inspected: picker → scope → read → resolve flows across picker, stories, change, review (Story/All-files/Review + comment queue), progress panel, explain; states (loading, empty, error, success, disabled, first run, stale); destructive actions (remove repo, remove story, remove queued comment, restore version); toasts and live regions; recovery paths. Sources: client surfaces, shared api/nav, progress state machine, review engine, src/server.ts routing; runtime.md and listed screens.
Not inspected: ref-picker listbox open state (runtime.md Not captured; code path in RefPicker.tsx checked, open behaviour not runtime-verified), full-page loading state (no hold fixture; reasoned from SSR plus navigation code), 1-step vs 42-step story rendering and 100+ file scope (fixtures not enumerated per runtime.md S3/S4), comment composer open/dismiss and split-divider drag (covered by project browser-smoke, not repeated), progress failed/stopped/blocked pixels (code in state.ts checked; only running/complete captured), offline behaviour (local server; EventSource 204 path in code only), Explain invalid-ref run to completion (no agent invoked).
Score: 2/4, one dead-end error route blocks an otherwise well-covered state model; most surfaces ship explicit empty, error and recovery states.

## Findings

### EXP-1: A bad repository route dead-ends on a bare plain-text page
- Rule: 1 Every data surface has its states; 6 Wayfinding
- Severity: HIGH (Trigger: none; lens HIGH: a flow leaves the user stuck, with no error state, chrome or way forward)
- Confidence: high
- Locations: `src/server.ts:1480`, `src/server.ts:432`
- Evidence: fallthrough returns plain text with no shell: `res.statusCode = 404; res.end("Not found");` and `parseRepoRoute` returns null when `if (!repo) return null;`, so `/repo/<unknown>/stories` never reaches a surface. Runtime: screens/stories-badrepo-1440x900-dark.png shows a plain-text Not found page with no app chrome (runtime.md Error state scenario). The sibling failure is handled well for contrast: `reviewScreen` falls back to the scope page with a notice (`src/server.ts:1604`: `return changeScreen(session, params, "That story could not be found.");`, rendered at `client/surfaces/change/ChangeApp.tsx:181`).
- Fix: in src/server.ts, route an unmatched `/repo/...` path to the existing shell instead of the bare fallthrough: render `pickerStub(home)` (or `errorPage(...)` plus a Home link) with a 404 status and a notice naming that the repository could not be found, reusing the `changeScreen(..., notice)` recovery idiom; keep bare Not found only for asset routes.
- Why: Rule 1 requires an error state that says what failed and how to recover, and Rule 6 requires no dead ends. A mistyped, bookmarked or stale repo URL currently strands the user outside the app with no way forward but editing the URL.
- Verified: yes (screens/stories-badrepo-1440x900-dark.png; src/server.ts:1480)
- Systemic: no

### EXP-2: Explain form input is lost on navigation, with no guard or persistence
- Rule: 5 Forms validate at the right moment; 10 Agency and forgiveness
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/explain/ExplainApp.tsx:130`, `client/surfaces/explain/ExplainApp.tsx:284`
- Evidence: the form holds typed work in state only: `const [question, setQuestion] = useState(prefill?.question ?? "");` with `paths` and `ref` likewise, and no `beforeunload`, storage or dirty guard exists anywhere in the surface (only mousedown listeners in shared menus match). The chrome offers exits that discard it: `<Nav ... right={<a className={navActionClass} href={routeBase + "/stories"}>History</a>}`. The review composer shows the app already knows this pattern: `client/surfaces/review/engine/review-engine.js:3388` persists drafts to localStorage and line 4292 adds a `beforeunload` guard.
- Fix: persist `question`, `paths` and `ref` per repo (sessionStorage keyed by routeBase, restored on mount, cleared on successful submit), or add a `beforeunload` plus in-app leave guard while any field differs from its initial value, mirroring the composer draft idiom in review-engine.js.
- Why: Rule 5 requires typed input to survive navigation and unsaved changes to ask first. A long question typed on Explain vanishes on one History or breadcrumb click, which is the data-loss shape this lens treats as a flow defect even without a server write.
- Verified: no (code-evidenced; would verify by typing in Explain, clicking History, and returning to find the fields empty)
- Systemic: no

### EXP-3: An unknown ref typed in the scope picker is silently ignored
- Rule: 5 Forms validate at the right moment; 3 Every action gets feedback
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/change/ScopeCard.tsx:442`, `client/surfaces/change/ScopeCard.tsx:416`
- Evidence: navigation only fires on an exact cached match: `return picker.rows.some((row) => row.value === current ...)` in `isCachedRef`, and blur commits through the same gate: `if (value !== focusValue.current[kind]) { ... commit(value, 0); }`. A misspelled branch therefore produces no navigation, no inline error and no status text; the only signal is `No matching refs` inside the open listbox at `client/surfaces/change/RefPicker.tsx:424`, which is gone once the field blurs.
- Fix: when a field blurs (or Enter is pressed) with non-empty text that is not a cached ref and not a sentinel, render an inline message under the slot in the existing amber or danger idiom (for example the ChangeApp notice band at ChangeApp.tsx:181) naming that the ref was not found, and keep the typed text in place so it can be corrected.
- Why: Rule 5 requires errors to appear at blur and clear as the user fixes them; Rule 3 requires every action to acknowledge. Silence after typing a ref reads as a broken control, and the user cannot tell a typo from a slow load.
- Verified: no (code-evidenced; would verify by typing a nonexistent branch in Compare any refs, blurring, and observing no message)
- Systemic: no

### EXP-4: Clicking a Missing recent repository runs a doomed open and offers a retry that must fail again
- Rule: 1 Every data surface has its states; 10 Agency and forgiveness
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/picker/RecentRepos.tsx:145`, `client/surfaces/picker/PickerApp.tsx:140`
- Evidence: the card stays fully actionable when the folder is gone: `<Button ... onClick={() => onOpen(row.path)}` with only `!row.isGit && "opacity-[.68]"` and a Missing badge distinguishing it. Failure then offers the same action again: `retry: { kind: "open", path }` in PickerApp.tsx, rendered as Try again in the status toast. Runtime scenario S2 confirms the API answer: non-git open returns HTTP 400 Not a Git repository.
- Fix: for `!row.isGit` rows, disable the open action (or make the card action Remove instead) and keep the row's affordance the removal control that already exists beside it; keep Try again only for network and transient failures, branching on `ApiError.kind` from client/shared/api.ts.
- Why: the app already knows this open cannot succeed. Sending the user into a guaranteed error, then offering to repeat it, wastes a step and teaches them the retry control cannot be trusted.
- Verified: yes (runtime.md scenario S2; RecentRepos.tsx:145, PickerApp.tsx:140)
- Systemic: no

### EXP-5: Story history load failure has no retry affordance
- Rule: 1 Every data surface has its states
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/stories/StoryHistory.tsx:135`
- Evidence: the error branch renders text only: `<p className="m-0 py-2 text-sm text-danger-text" role="alert">{error}</p>` with no button. The sibling surface does this correctly: `client/surfaces/picker/FolderBrowser.tsx:428` renders a Try again Button that re-runs `browse(lastPath.current)`. Recovery here requires collapsing and re-expanding the disclosure, which is not discoverable from the error itself.
- Fix: add a ghost Try again button beside the error in StoryHistory.tsx that re-runs the same `requestJson` fetch (extract the load into a callback shared by `toggle` and the retry), matching the FolderBrowser.tsx:428 idiom.
- Why: Rule 1 requires an error state to say how to recover, with a retry when a retry can help. A transient server failure currently leaves a dead disclosure until the user guesses the toggle trick.
- Verified: no (code-evidenced; would verify by failing GET /api/stories/history and confirming no retry control renders)
- Systemic: no

### EXP-6: Scope changes are full navigations with no loading feedback
- Rule: 3 Every action gets feedback; 7 Perceived speed
- Severity: MEDIUM
- Confidence: medium
- Locations: `client/surfaces/change/ScopeCard.tsx:310`, `client/surfaces/change/ChangeApp.tsx:125`
- Evidence: choosing a ref navigates the whole document with no busy state: `if (url !== window.location.pathname + window.location.search) window.location.href = url;` in `scheduleNavTo`. Pages are server-rendered from an embedded payload (`payload: ChangePayload` in ChangeApp), and `summarizeChange` runs server-side per navigation, so a large repo leaves the old scope on screen (or a blank load) with no spinner, skeleton or disabled control. Runtime.md lists the loading state as not verified with no cheap hold point.
- Fix: set a busy state on the scope card before assigning `window.location.href` (disable the segments and show the existing Loader idiom used by ReloadButton at ScopeCard.tsx:769 in the card header), so the click acknowledges within 100ms while the server builds the next scope.
- Why: Rules 3 and 7 require acknowledgement within about 100ms and a loading state that says something is happening. On the app's central picker → scope → read flow, the primary action currently gives no visible response until the next page arrives.
- Verified: no (loading state not captured per runtime.md; would verify by throttling the change route and choosing a ref)
- Systemic: yes

### EXP-7: Picker remove relies on a single dismissible toast as its only undo path
- Rule: 4 Destructive actions are safe
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/PickerApp.tsx:51`, `client/surfaces/picker/RecentRepos.tsx:245`
- Evidence: removal is immediate (`requestJson ... method: "DELETE"` in PickerApp `removeRepo`) and recovery exists only as the toast action: the StatusToast renders Undo or Try again from `status.undo || status.retry`, next to a Dismiss button (`aria-label="Dismiss message"`). Dismissing, or removing a second repo (which replaces the status), destroys the only handle to `/api/repos/recent/restore`. The row control itself is visually neutral until hover: `hover:bg-del-soft hover:text-danger-text` on a transparent ghost button.
- Fix: keep the immediate-remove plus undo pattern, but re-offer restore for the most recent removal in the empty or list footer after the toast closes (for example a quiet Restore <name> action while an undo payload is held in state), and give the row remove control its danger tint at rest on focus-visible as it already does on hover.
- Why: Rule 4 prefers undo to confirmation, which this surface gets right; the remaining gap is that the undo is one stray click or one second removal away from being unrecoverable, and the destructive control is not distinct until hovered.
- Verified: no (code-evidenced; would verify by removing a repo, dismissing the toast, and confirming no restore path remains)
- Systemic: no

### EXP-8: A successful story removal gives sighted users no visible confirmation
- Rule: 3 Every action gets feedback; 8 Consistency and familiarity
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/stories/StoriesApp.tsx:305`, `client/surfaces/picker/PickerApp.tsx:51`
- Evidence: success is announced only to assistive technology: `<p className="ds-sr-only" role="status">{status}</p>` after `setStatus("Removed ...")`. The picker solves the same moment visibly with its StatusToast. Here the sighted confirmation is only the row animating out, which is easy to miss when the removed row was off-screen or the list is long.
- Fix: reuse the picker StatusToast pattern (visible polite status with Dismiss) on StoriesApp for the removed message, keeping the sr-only status as the announcement channel or consolidating onto the toast's live region.
- Why: Rule 3 requires meaningful actions to confirm what happened; Rule 8 requires the same moment to behave the same way across surfaces. Two delete flows in one app should not split into visible-plus-undo on one surface and silent on the other.
- Verified: yes (StoriesApp.tsx:305; screens/stories-1440x900-dark.png shows no toast region)
- Systemic: no

## Recommendations
- Add a stale-data note where live evidence is known to be a metadata projection: StoriesApp already withholds +A −D and drift facts until `?evidence=refresh`; a quiet last-checked line beside Refresh evidence would close Rule 1's stale branch without changing behaviour. Evidence limits: freshness values exist in the payload (`freshness: 'unverified'` per src/server.ts storyChooser); no stale capture was taken.
- Consider optimistic scope summary while a ref navigation is in flight (keep the previous FileSummary at reduced opacity until the new page lands) if EXP-6's busy state proves insufficient on large repos. Evidence limits: no timing measurements were taken; treat as a follow-up measurement, not a defect.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/stories/RemoveStoryDialog.tsx:119` | Remove story lacks undo | It has the correct irreversible treatment instead: confirmation naming scope (story file deleted, code and comments stay), Cancel focused first, distinct del-soft destructive button, error kept inside the dialog with Try again. No finding. |
| `client/surfaces/review/engine/review-engine.js:3410` (`askRemoveQueuedComment`) | Queued-comment removal is unguarded | It opens an inline confirmation naming the file and line, stating This cannot be undone, focuses Cancel, uses a distinct ds-danger action, and reports failure inline with role=alert. Meets Rule 4 for an irreversible action. |
| `client/surfaces/stories/StoryHistory.tsx:69` (`restore`) | Restore runs with no confirmation | The file header documents that the server snapshots live bytes first, so restore is reversible by construction; Rule 4 prefers no confirmation for reversible actions. No finding. |
| `client/surfaces/picker/PickerApp.tsx:149` (`removeRepo`) | Remove repo is a HIGH unguarded destructive action | It completes immediately with a persistent (no auto-dismiss timer) undo toast calling `/api/repos/recent/restore`, so the HIGH trigger (no confirmation, no undo and no distinct treatment) does not apply; the residual fragility is EXP-7 at LOW. |
| `client/surfaces/change/FileSummary.tsx:94` | Empty scope lacks guidance | EmptyState explains where changes will appear and offers two next actions (Reload, Review history), and ChangeApp.tsx:181 covers the missing-story notice with a way forward. Meets Rule 1. |

## Handoffs
- COPY: error and empty-state wording quality in ChangeApp notice, StoryHistory error and Explain writer errors (existence and recovery owned here; wording owned by COPY).
- A11Y: announcement mechanics for the picker StatusToast, stories sr-only status, progress single live region and review toast role switching (when errors appear owned here; announcement and association owned by A11Y).
- MOT: animation of panel, listbox, toast and row-exit state changes, including the 210 ms modal exit hold (state existence owned here; motion owned by MOT).
