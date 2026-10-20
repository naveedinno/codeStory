# Stories, review TSX and design-document fix result

Completed the remaining targets in plans 011, 013 and 016 while retaining the earlier partial fixes. Source changes stay within the assigned files. No build, generated dist update, dependency change, test edit or commit was performed.

## Findings and changes

- COPY-2, COPY-5, COPY-16: saved review copy consistently says comments; the remove trigger says Remove story; snapshot links say Open this version. The counted state detail remains `N open comments waiting`. The internal header variable is now `reviewsWithComments`, accurately naming that it counts reviews with comments.
- EXP-5: failed history GET exposes Try again through the shared load callback. A failed restore POST now stays with its version row and its Try again repeats that POST, rather than disguising a history reload as a restore retry. Restore controls retain focus while busy using aria-disabled plus the existing handler guard.
- EXP-8, A11Y-6: successful removal shows a dismissible confirmation and announces it through one persistent polite status region. Busy removal focuses the dialog; shared canClose prevents Escape dismissal while busy. After success, the modal close callback schedules focus on the saved reviews heading, or the page heading when the list empties, after shared focus restoration.
- A11Y-13: hidden import input has no aria-hidden, remains outside sequential focus, and has an explicit accessible name.
- TYP-4: the existing row anchor is now the full-title and scope-command tooltip trigger, so keyboard focus reaches the tooltip without adding an invalid tab stop inside the anchor. Version titles have their own focusable, visibly outlined tooltip trigger. The shared owner supplies keyboard-safe tooltip behavior.
- A11Y-2: health findings keep visible Error or Warning text alongside the decorative dot.
- A11Y-7: initial file labels include full path, unexplained count and regenerated-by state. Reviewed state is owned by syncViewed; the parent updated it to retain both unexplained and regenerated labels.
- COPY-3, COPY-4, COPY-8, COPY-9, COPY-14, COPY-18: depth titles and descriptions match Explain exactly; excluded-file copy describes what is available without DOM, bounded-renderer or lazy terminology; singular divergent versions use differs; both coverage metrics count changed lines; command labels use sentence case; unexplained is lowercase in prose; Cannot compare replaces the contraction.
- A11Y-9: reload-toast wording now says Reloading soon and explains hover/focus pause, matching the parent engine pause/resume behavior.
- A11Y-12, VIS-7: decorative icons remain hidden; semibold-adjacent icon strokes are 2. Added `ds-story-state` to the saved-state badge for the shared forced-colors treatment (COL-7).
- LAY-6, LAY-7: stories header uses spacing without a separator; touched story row, facts, history, dialog and header spacing use 4px-scale steps. Page primary remains 40px and compact actions remain the existing 34px control role. No motion timing or animation behavior was added.
- VIS-3: the saved review glance hover uses the canonical shadow token.
- VIS-5, TYP-8, VIS-7: DESIGN_MEMORY records 26px islands, 8/12/18 controls, 40px page primaries versus 34px bar/card actions, scale spacing and weight-matched icon strokes. It references the tracking token rather than stale .14em and records the numeric conventions.
- TYP-8: review/format.ts and change/format.ts export formatCount using Intl.NumberFormat for absolute values >=10000, preserving smaller output. Review initial count, coverage, drift, line totals, tree and generator facts call it; the change-surface owner imports it in its file ledger. Hash display uses the parent shared slashed-zero rule rather than introducing an unused helper constant.
- TYP-6: the stories page h1/h2 retain descending sizes. Review CSS heading hierarchy is handled by the parent CSS owner.

## Verification

- `npm run typecheck:client`: passed after all source edits.
- `git diff --check` for all owned files: passed.
- In-memory TypeScript transpilation and direct execution of both formatCount helpers: 14 assertions passed for 0, 1, 999, 9999, 10000, 123456 and -10000.
- Depth labels/descriptions read against the current Explain implementation: exact matches.
- Owned-scope search: no remaining contracted failure strings, open-note noun, Remove review trigger, lazy/bounded-renderer or diff-DOM product copy.
- `node --test test/story-picker.test.mjs`: 20 passed, 4 failed against deliberately changed source/copy contracts. No dist build was run.

## Existing test expectations for the parent to update

- Shell browser title: expect `codeStory — Review history`, without the repository prefix.
- Review-count source assertion: openNotes is now reviewsWithComments.
- Scope tooltip: instead of `content={scope.command}` and `if (!scope.command) return chip`, assert the existing row anchor is wrapped by a Tooltip whose content is the title plus optional command. Preserve the aria-description on the scope chip and no-nested-interactive-content guarantee.
- Removal tooltip: Remove review is now Remove story.
- Bundle/heading introduction: its notes is now its comments. Parent should rebuild once before bundle assertions.
- Shared owner's independently reported picker tests: MODAL_CLOSE_MS expectation is 340, and Story-generation skill wording is now storyteller skill.

## Evidence limits and integration notes

This subtask verified source, typechecking and helper behavior. It did not run browser interactions, assistive technology, screenshot review or touch hardware. The parent owns rendered verification, engine dynamic count formatting, shared Tooltip and modal behavior, review CSS, token-pair tests and test-contract updates. Existing unrelated VideoExport and video/audio work was not edited.
