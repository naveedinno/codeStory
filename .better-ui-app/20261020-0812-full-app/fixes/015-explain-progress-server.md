# 015: Fix explain, progress and server error surface
- Findings: EXP-1, COPY-13, EXP-2, A11Y-15, A11Y-17, TYP-2 (explain part), COPY-3 (explain part), COPY-7, COPY-15 (explain part), COL-10, VIS-3 (progress part), VIS-4 (explain part), VIS-8 (explain part), VIS-10 (explain part)
- Severity: HIGH
- Wave: 2
- Owned files: client/surfaces/explain/ExplainApp.tsx, client/surfaces/progress/ProgressPanel.tsx, client/surfaces/progress/state.ts, client/surfaces/progress/run-progress.ts, client/surfaces/progress/Milestones.tsx, src/server.ts

## Problem
Read these IDs in lenses/experience.md, lenses/copy.md, lenses/accessibility.md, lenses/typography.md, lenses/visual.md, lenses/color.md. Bad repo route ends at bare Not found in src/server.ts; page titles run repo into surface; Explain loses typed input; disabled submit unexplained; milestones hide current state; depth names must match StoryView fix (Quick tour, Guided tour, Deep dive - already the Explain set, so only confirm and align descriptions); progress failure defaults lack cause; skill called storyteller here vs Story-generation in picker (standard sentence for both: "Run scripts/install-skills.sh from a codeStory clone, or re-run the codeStory installer."); progress primary spells #06121c literally; progress shadow is a one-off 0.5 recipe.

## Target
1. src/server.ts: unmatched page-like /repo/... GET routes return the existing errorPage/picker shell idiom with 404, heading "Page not found", line "That repository or page could not be found.", action "Go to your repositories" -> /repos. Keep bare Not found for asset/API routes. Page titles: surface name alone (Review history, Explain code).
2. ExplainApp: persist question/paths/ref in sessionStorage keyed by repo route, restore on mount, clear on successful submit. Submit gets aria-describedby to a persistent blocker line beside it. Fields: 16px on small/coarse only - use text-lg sm: size idiom matching FolderBrowser (16px small, desktop size at sm:). Explain titles already Quick/Guided/Deep - keep, align one-line descriptions with StoryView wording after plan 013 (use the same description strings you find in ExplainApp as canonical). Skill name -> "storyteller skill" + standard sentence above. Segment inner radius calc(var(--radius-lg) - 4px); submit pill h-[var(--control-h-lg)], trailing padding ps-4 pe-[14px].
3. Progress: state/run-progress defaults -> label "Could not start the run." detail "Check that Claude or Codex is installed, then try again." (server labels still win). Milestones: aria-current="step" on active + sr-only state prefix per PlanList pattern; segment fill duration -> 250ms tier. ProgressPanel primary text-[#06121c] -> text-[var(--on-accent)]; floating shadow -> shadow-[var(--shadow)]; focus rings -> var(--shadow-focus).

## Boundaries
- Owned files only. Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client; npm run build; node --test test/progress.test.mjs test/progress-ui.test.mjs test/app-server.test.mjs
- Done when: results reported exactly.
