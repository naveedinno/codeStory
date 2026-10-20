# Picker and shared chrome completion

Status: implementation complete; consolidated rendered verification remains with the parent task.

## Findings covered

- A11Y-3, EXP-4: recent branch metadata shrinks/truncates; a focusable card tooltip reveals the full repository name, path and branch. Missing repository open actions are disabled and omitted from their context menu; only network/server failures offer an open retry.
- A11Y-4, A11Y-16: picker starts with the shared skip link and a focusable main target. Repositories is the h1; the brand wordmark is plain text.
- EXP-7: the most recent removal retains its undo payload and exposes a quiet Restore action after the toast is dismissed or replaced.
- A11Y-11, COPY-11, COPY-17, TYP-4: folder crumbs meet the 24px target floor; empty filtering gives a recovery sentence; loading rows name folders; folder-name tooltips, keyboard active-name detail and a focusable full-path tooltip retain long values.
- COPY-15: picker says storyteller skill and shares the exact clone/installer manual-recovery sentence with Explain.
- VIS-2, TYP-3: hero crop retains the middle thread section without its empty outer loops; Space Grotesk code uses loaded 500. Shared CSS uses loaded 600/700 instead of 650/750.
- VIS-7, VIS-10, A11Y-12: folder/editor icon strokes align at 2; decorative picker/shared glyphs are hidden; Add repository uses the 40px page-primary token.
- A11Y-5, A11Y-6, MOT-2: Theme Tab closes without preventing default; shared modal exit now matches 340ms CSS, retains zero reduced-motion hold, rejects close while optional canClose returns false, restores a connected trigger or stable background, and releases its trap during exit. The closing dialog becomes inert and aria-hidden.
- COL-5, A11Y-14: menu focus uses the strong shadow-focus token; scrim and folder list contain overscroll.
- MOT-6: shared anchored menus use retargetable transform/opacity/display transitions with allow-discrete and starting-style. Open is 200ms, close 150ms; closing menus are inert and aria-hidden immediately. Reduced motion stays instant; unsupported browsers retain the old entrance and immediate hidden close.
- TYP-4, COPY-12, LAY-3, LAY-7: breadcrumbs have accessible full-label tooltips, current breadcrumb is keyboard reachable, wordmark names its destination, nav/menus use logical insets and constrained shrinking, narrow bars can wrap, and touched nav spacing follows the scale.
- COL-7: forced colors preserves diff add/delete rails as solid/double CanvasText borders, gives active and untoured rows system outlines, and gives badges ButtonText/ButtonFace borders/text. Existing + and minus text cues and focus outlines remain. The stories worker supplied the ds-story-state hook.
- TYP-7: shared CSS menu text and owned picker/nav font utilities use rem-backed canonical tokens.
- Shared Tooltip follow-up: API is unchanged. Wrapper focus capture permits keyboard use regardless of pointer capability and preserves existing child handlers. Existing aria-describedby values are retained, tooltip content is exposed to accessibility APIs, Escape dismisses it, the pointer can reach the bubble, and timers clean up on unmount.

## Checks

- npm run typecheck:client: passed after concurrent ReviewApp unused-import work finished.
- git diff --check on owned picker/shared/styles/vendor files: passed.
- node --test test/picker.test.mjs test/recents.test.mjs test/motion-regressions.test.mjs: 37 passed, 2 failed at the first run. The failing source-string expectations name the old 210ms modal constant and old Story-generation skill copy; parent/test owner was notified to align them with these intentional fixes. Recents and all motion-regression tests passed.
- Source sweep found no remaining literal px font sizes in owned shared CSS/nav/picker font utilities.

## Limits

No build regenerated dist, no dependency changed, and no commit was created. Screenshots, long-name 320/375px reflow, menu reversal feel, reduced-motion runtime behavior, forced-colors rendering and actual assistive-technology behavior require the consolidated browser verification; this record makes source/check claims only.
