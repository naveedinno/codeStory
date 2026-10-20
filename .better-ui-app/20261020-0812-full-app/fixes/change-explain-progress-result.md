# Change, Explain, progress and server completion record

Completed source targets from plans 012 and 015, preserving the pre-existing video/audio changes in `src/server.ts` and making no dependency or test edits.

## Findings addressed

- EXP-3 / A11Y-8: all five scope ref inputs preserve unmatched text and report committed invalid values through an inline alert, `aria-invalid` and `aria-describedby`. Validation reads the full cached ref set rather than the previous filtered result. Validation and navigation are superseded by newer input. Enter accepts a suggestion only after an explicit highlight; otherwise it validates the typed text. A failed ref fetch gets its own verification error.
- EXP-6: all scope navigation controls show a busy spinner/message and disable further scope editing before navigation.
- LAY-1: Review history gets a real decorative History icon and collapses its label under 560px; the previous partial fix had hidden the only link content.
- LAY-3 / LAY-4 / LAY-5 / LAY-7: logical dividers/alignment, shrinkable basenames, scale spacing, and ScopeCard/ProgressPanel container queries. Editors and summary share the 700px container stack; progress header uses 520px panel width.
- VIS-1 / VIS-3 / VIS-4 / VIS-7 / VIS-8 / VIS-10 / COL-10: structural island borders, shared overlay/focus shadow tokens, 14px segment radii inside 18px tracks, weight-matched icons, trailing-icon optical padding, 40px page primaries and progress on-accent ink token.
- COPY-10 / COPY-11 / COPY-12 / COPY-13 / COPY-15 / COPY-18: Try again vocabulary, query-aware ref empty state/recovery, Review history label, surface-only document titles, consistent storyteller-skill update recovery and non-contracted failure voice.
- EXP-2 / A11Y-15 / TYP-2: Explain question/paths/ref restore from validated session storage scoped by repo route and rewrite identity; drafts clear after a saved successful generation, and remain available after failures. Submit describes its persistent nearby blocker/help line. All three fields use 16px on small/coarse input environments with desktop sizes preserved elsewhere.
- A11Y-17 / TYP-9: milestone accessible current/state text and tokenized kicker tracking; milestone fill uses the new 250ms progress tier token. Progress and ref option kickers also use the shared tracking token.
- EXP-1 / COPY-1: missing repository document routes return a 404 page with shared theme/bootstrap/fonts/styles, brand/repository navigation, Page not found heading, explanation and Go to your repositories action. Missing asset/API paths remain plain 404s, including asset-like paths under /repo/.
- A11Y-12: decorative icons in this owned scope carry `aria-hidden`.
- TYP-8 integration: ChangeApp and FileSummary use the peer-owned `formatCount` helper for count and line-count displays; approved grouping threshold is 10000.
- COPY-3: Explain's Quick tour / Guided tour / Deep dive titles and canonical descriptions already matched the plan; left intact for the review owner to mirror.

## Verification

- `npm run typecheck:client`: passes on the final source state. Earlier runs caught a transient unused `formatCount` import in concurrently edited ReviewApp; it is now resolved.
- `npx tsc --noEmit`: passes.
- Isolated Tailwind compilation: `npx @tailwindcss/cli -i client/styles.css -o /tmp/codestory-change-proof.css --minify` passes without touching build/dist. Generated CSS includes 700px/600px/520px container variants, coarse-pointer field sizing and valid concentric radius calc.
- Ephemeral esbuild/import checks of the progress state machine pass for actionable default errors and preservation of supplied server label/detail.
- `git diff --check` over all owned files: passes.

## Integration checks still required

The parent owns build outputs and browser integration. No build/dist files, dependencies or tests were changed by this worker. After the parent builds, run the plan's change-page/change-route/progress/progress-ui/app-server tests, and capture narrow change/long-basename/invalid-ref, Explain restore/blocker/touch input, narrow progress and 404 pages. No rendered screenshot, keyboard accessibility tree or physical iOS zoom claim is made here.

The 14px segment-in-18px-track fix follows the concrete plans. The raw VIS-4 suggestion about reducing every island child radius was not expanded beyond those approved targets.

## Integration follow-up: authorized test contracts

Parent expanded ownership to three tests after the first complete check. Updated their intentional source/bundle contracts without removing assertions:

- `test/change-page.test.mjs`: require the busy-before-navigation same-URL guard, container breakpoint, ref validation/version/ARIA wiring, and the explicit ref-error alert exception; keep the original debounce, URL, quiet-spinner, inventory and navigation checks. Count assertions now require the formatter. Source and built strings now require Review history, Try again, specific ref-search recovery and non-contracted failure copy.
- `test/progress-ui.test.mjs`: require server-label precedence and the actionable default label/detail, and check the new non-contracted copy in built chunks.
- `test/app-server.test.mjs`: the formerly failing line215 was the stale repository route, not the valid saved-route restoration. Valid restoration still requires200. Stale routes now require404 at the original URL, a themed recovery document and the repositories action. Added plain404 checks for API/assets including a resource-like /repo/ path. Updated the unreadable-context expectation to Could not read; the remaining context-row assertions are intact.

`node --test test/change-page.test.mjs test/progress-ui.test.mjs test/app-server.test.mjs`: **74 passed, 0 failed, 0 skipped** (12.48s), using the parent's built outputs. `git diff --check` on those tests passes. No build was run by this worker. This section supersedes the earlier statement that this worker changed no tests.
