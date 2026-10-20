# Copy lens recheck

Score: **4/4**. Remaining findings: **0 HIGH, 0 MEDIUM, 0 LOW**. All **18 original copy findings are fixed** in source. No new copy regression found in the reviewed final changes. This score is limited to the reviewed copy scope and evidence below.

## Evidence and limits

Read the copy lens instructions, audit brief, original copy report, and source/diff for all 18 original findings across the six surfaces, shared navigation, error page, and review engine. On this final pass, reread the three former remnants and surrounding changed reference-validation copy, then confirmed the other dispositions against current source.

Visually spot-checked the supplied captures `fixes/screens/404-1440-dark.png`, `explain-375-light.png`, and `change-invalid-ref-375.png` on this pass; earlier checks also covered `explain-1440-light.png` and `stories-375-dark.png`. The branded 404 gives a reason and repository action. Explain shows the agreed depth vocabulary and Review history destination. The invalid-ref capture shows that the typed unknown value remains in place, although the ref-list tooltip obscures part of its inline error and the screenshot predates the final inline wording below. Final inline error wording is therefore source evidence only.

Read `fixes/runtime-recheck.md` as supporting capture metadata: it records surface-specific browser titles and the unknown-ref/valid Git-expression results. These are the capture runner's results, not interactions independently executed by this reviewer. Its one-step fixture is explicitly excluded: the recorded page title is Choose review scope and it reports zero step nodes; the parent is replacing it. No copy claim depends on that fixture. I did not inspect every one of the supplied screenshots.

This reviewer did not operate a browser, recapture images, execute failure fixtures, test clipboard/queue actions, open dialogs or history versions, inject plural/count cases, or exercise transient loading states. Findings about those states are source checks, not runtime interaction claims. No translated-label claim is made because the app has no localization catalogue. Layout/clipping remain with the layout/type reviewers.

## Final remnant verification

- COPY-4: engine `:3111` now says `Calculating story coverage for the loaded diff…`; the former internal renderer term is removed.
- COPY-10: engine `:2405` and `:2956` now render `Try again`, agreeing with the ref list and shared lazy-error helper. Descriptive aria-labels such as `Retry loading hidden context` remain clear and do not conflict with the action label. The `Retry` argument at `:3284` is a data attribute value, not rendered wording.
- COPY-15: engine `:3716`, `:3721`, and `:3722` now use `The storyteller skill` / `Storyteller skills`, agreeing with picker and Explain. The manual installation recovery sentence also matches all three.
- Ref-validation follow-up: `ScopeCard.tsx:470–471` distinguishes `Could not check this ref. Check the repository, then try again.` from `No ref matches "{value}". Enter a valid branch, tag, or commit.` This names the failure and the next action without implying that only a capped suggestion list can supply a valid ref. The rejected input remains visible for correction. No additional copy finding.

## Original finding dispositions

| Finding | Disposition | Evidence |
|---|---|---|
| COPY-1 branded 404 | Fixed | `src/server.ts` routes page-like repository misses to `pageNotFound()` with `Page not found`, cause text, and `Go to your repositories`; 1440px dark screenshot confirms the words and recovery action. Asset/API misses retain plain responses. |
| COPY-2 comment noun | Fixed | `story-state.ts:48` says `open comment`; engine removal body at `:3467` says `queued comment`. Existing comment-kind names can stay distinct. Source only. |
| COPY-3 depth labels | Fixed | StoryView's DEPTHS now matches Explain's `Quick tour`, `Guided tour`, `Deep dive` and all three descriptions. Explain screenshot confirms that set; StoryView generator was source checked. |
| COPY-4 exclusion wording | Fixed | ReviewView/Sidebar exclusion headings, counts, previews, and StoryView generator intro use plain language. Engine pending coverage status now says `for the loaded diff`. Source only. |
| COPY-5 removal noun | Fixed | StoryRow tooltip reads `Remove story`; dialog heading is `Remove this story?` and action `Remove story`. Source only. |
| COPY-6 copy action | Fixed | Engine composer at `:3446` says `Copy comment`, paired with `Add to queue`; copy toast remains `Comment copied.`. Source only. |
| COPY-7 progress failure defaults | Fixed | `state.ts:444–455` identifies the run and supplies `Check that Claude or Codex is installed, then try again.`; stream-start fallback agrees. Server-supplied reasons retain precedence. The generic panel fallback is guarded by the model's explicit error state; no new blocker is established. Source only. |
| COPY-8 singular agreement | Fixed | ReviewApp `:132` chooses `differs`/`differ`; dynamic engine accessible-name update at `:3836` also chooses `version differs`/`versions differ`. Count-one follows from source; no injected runtime count. |
| COPY-9 lines unit | Fixed | ReviewView `:228–234` uses changed line/lines in both coverage statistics. Source only. |
| COPY-10 recovery vocabulary | Fixed | Ref list, shared lazy-error helper, diff-load error, and hidden-context error buttons all say `Try again`. Source only; those failure states were not operated. |
| COPY-11 empty search exits | Fixed | FolderBrowser `:452` names the filter and says to clear it; RefPicker `:452` names the query and suggests a branch, tag, or commit. Source only. |
| COPY-12 destinations | Fixed | Change and Explain navigation say `Review history`; shared wordmark accessible name is `Home — your repositories`. Explain/history screenshots agree with the visible destination wording. |
| COPY-13 page titles | Fixed | Server shell titles are surface names: `Pick a repository`, `Review history`, `Choose review scope`, `Explain code`. Source checked; `runtime-recheck.md` independently records the same rendered browser titles, though this reviewer did not operate the tabs. |
| COPY-14 sentence case | Fixed | Command palette uses `Open story`, `Open all files`, `Open review`; generator note says `unexplained`. Source only. |
| COPY-15 skill name/manual fix | Fixed | Picker, Explain, and engine readiness messages now use storyteller skill. Manual installation failure recovery text matches across all three. Source only. |
| COPY-16 version links | Fixed | StoryHistory `:199` says `Open this version`. Source only; history expansion not operated. |
| COPY-17 loading object | Fixed | Both FolderBrowser visible loading rows (`:431`, `:500`) say `Loading folders…`, matching spoken status. Source only. |
| COPY-18 error voice | Fixed | Ref list, progress title, code comparison, and change notice use the full `Could not`/`Cannot` forms. Server context/error heading also agrees. Source only. |

## Rejected candidates

- Mixed story/review nouns in broad history copy are not a fresh finding: the saved artifact is a story and the workflow is a review; the destructive action now consistently names its object.
- Earlier-version action labels remain identical across rows but `Open this version` now names the destination as requested. Adding every version name would be a different specificity choice, not proof the fix failed.
- Generated output and unrelated video-export work are not used as evidence for this copy verdict.
