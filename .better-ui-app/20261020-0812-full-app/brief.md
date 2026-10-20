# Brief: codeStory (2026-10-20)
Mode: full. Lenses: accessibility, layout, typography, color, copy, visual, motion, experience (eight core; dataviz checked and not triggered — see Charts). Scope: whole app — all six React surfaces plus shared chrome and the server-rendered diff engine styles. Excluded: macOS native shell (Tauri-less wrapper, not web UI), Zed extension, eval harness, `dist/` build output (generated from `client/` + `src/`), and `src/*.ts` server logic except where it emits markup/CSS.

## Platform
web: React 19 + esbuild client at `client/` (one entry per surface), served by Node `src/server.ts` on `http://localhost:7777/`; `package.json` declares React 19.2.8, Tailwind CSS v4.3.3 (`@tailwindcss/cli`), `motion` 11.18.2, `lucide-react`, `@tanstack/react-virtual`. No Android Compose.

## Mobile web targets
Desktop-first local tool (macOS desktop app + local web server for development). No PWA manifest, no installed-mode target found. Responsive behaviour exists (compact rail, 480px thread-layer hide, virtualized lists) but phones/tablets are not a stated support target. Browser/OS versions: unknown. Treat mobile web as secondary; `platforms/mobile-web.md` applies only where a surface already claims small-viewport behaviour. Unknowns marked, not inferred.

## Data boundaries
Rendered user data: git repo paths, branch/ref names, commit hashes, file paths, diff hunks, AI story narration, comment text, timestamps, counts (files changed, lines, story steps). Sources: git CLI output via `src/git.ts`, story JSON via `src/stories.ts` / `src/payloads.ts`, API JSON in `client/shared/api.ts`. Representative fields and stress scenarios selected (full mode, one per distinct boundary, not repeated per screen):
- S1 long file path / branch name (unbroken string, 80+ chars) in rail and scope card — owner LAY/TYP.
- S2 very long repo name + missing/non-git folder in recents — owner EXP/VIS.
- S3 story with 1 step vs 40+ steps, empty story list, zero comments — owner EXP/LAY.
- S4 long diff line (500+ chars, no spaces) and huge file count in All files — owner LAY/TYP.
- S5 timestamp/count edge: 0, 1, large counts; missing story metadata — owner COPY/TYP.
Injection points: demo repo (`npm run demo`, `examples/demo.mjs`), API mocks not present; otherwise code-path inspection. No secrets inspected.

## Stack
Styling: Tailwind CSS v4 (utility-first in TSX) + canonical CSS custom properties; one non-utility stylesheet `client/surfaces/review/review.css` (~1,605 lines) for server-rendered diff rows. Components: hand-rolled primitives in `client/shared/` + vendored beUI under `client/vendor/beui/` (shadcn-style names bridged to Signal tokens). Icons: Lucide (`lucide-react`) plus inline stroke SVGs in `src/theme.ts` and surface files (1.5 stroke per DESIGN_MEMORY). Fonts: self-hosted woff2 (IBM Plex Sans 400/500/600/700, IBM Plex Mono 400–700, Space Grotesk 500–700) via `@font-face` in `src/theme.ts` `sharedTokens()`, `font-display: swap`. Motion: `motion` library + CSS tokens; `client/shared/motion.ts` helpers. i18n: none found (single locale, no RTL catalogue); theming via `data-theme` on `<html>` (`light`/`dark`/`system` from `localStorage` key `ds-theme`, bootstrap in `src/theme.ts` `themeBootstrapScript()`), dark is default.

## Tokens
Color, type, spacing, radius and motion tokens live in `src/theme.ts` `sharedTokens()` (source of truth), generated to `client/generated/theme.css` by `scripts/build-theme-css.mjs` — never edit the generated file. Cross-surface keyframes/scrim/thread atmosphere in `client/shared/shared.css`. Client entry stylesheet `client/styles.css` (Tailwind v4 entry, `@source` scoped to `client/**`). Page-local aliases (`--app-*`, picker/story-picker vars) alias one-directionally onto canonical tokens per DESIGN_MEMORY.

## Conventions read
`DESIGN_MEMORY.md` (Signal / Thread-Ledger direction, token and a11y rules), `DESIGN_PLAN.md` (Beat Navigator), `CONTRIBUTING.md` (checks, demo), `README.md` (flows), `client/shared/shared.css` header, `client/surfaces/review/review.css` header. No `CLAUDE.md`/`AGENTS.md` at repo root (`.claude/` holds plugin config, not UI conventions).

## Surfaces in scope
- Workspace picker — `client/entry/picker.tsx` → `client/surfaces/picker/PickerApp.tsx` (+ `Hero`, `RecentRepos`, `FolderBrowser`, `SkillBanner`)
- Review history / story picker — `client/entry/stories.tsx` → `client/surfaces/stories/StoriesApp.tsx` (+ `StoryHistory`, `StoryRow`, `EmptyHistory`, `RemoveStoryDialog`)
- Change scope — `client/entry/change.tsx` → `client/surfaces/change/ChangeApp.tsx` (+ `ScopeCard`, `RefPicker`, `FileSummary`)
- Review (diff + story) — `client/entry/review.tsx` → `client/surfaces/review/ReviewApp.tsx`, `ReviewView.tsx`, `StoryView.tsx`, `Sidebar.tsx`, `StoryHealth.tsx`, styles `client/surfaces/review/review.css`; engine JS in `client/surfaces/review/engine/`
- Progress — `client/entry/progress.tsx` → `client/surfaces/progress/ProgressPanel.tsx` (+ `Milestones`, `PlanList`, `ActivityText`, `Elapsed`)
- Explain code — `client/entry/explain.tsx` → `client/surfaces/explain/ExplainApp.tsx`
- Shared chrome — `client/shared/nav.tsx`, `brand.tsx`, `theme-menu.tsx`, `editor-menu.tsx`, `use-modal.ts`, `mount.tsx`

## Shared primitives
No single Button/Input component library; primitives are per-surface TSX + beUI vendor. Highest-leverage shared files by role:
- `client/shared/nav.tsx` — top chrome on every surface (imported by all six entries via mount).
- `client/shared/theme-menu.tsx` + `client/shared/theme.ts` — theme control on every surface.
- `client/shared/brand.tsx` — wordmark/thread mark.
- `client/shared/shared.css` — keyframes, scrim, sheet, focus and thread atmosphere shared by all surfaces.
- `client/styles.css` — base layer (focus-visible ring, scrollbar, selection) for all surfaces.
- `src/theme.ts` `sharedTokens()` — canonical tokens consumed by every surface (generated bridge).
Importer counts are architectural (every surface imports nav/theme/shared.css), so a defect in any of these is systemic by construction.

## Frequency map
constant: diff text selection and scrolling, step/beat navigation (arrow keys, prev/next), sidebar file/step selection while reviewing (100+ per session assumed — core loop).
frequent: tab/view switches (All files ↔ Story), theme toggle, repo switching, comment composer open/close (tens per session).
occasional: dialogs/menus (theme menu, editor menu, remove-story dialog), scope/ref picking, copy/queue actions (a few per session).
rare: first-run empty states, onboarding hero, skill banner, error/recovery states (once in a while).
Estimates are assumptions from the product shape (no analytics in repo); do not promote to HIGH on frequency alone.

## Personality
Instrument-grade, calm, precise, developer-native. Sentence case, mono kickers, one signal-blue accent, no hype or emoji (per DESIGN_MEMORY brand tone).

## Checks available
`npm run check` (build + `tsc -p client/tsconfig.json` + `node --test test/*.test.mjs`), `npm run typecheck:client`, `npm run test:browser` (Playwright smoke via `scripts/browser-smoke.mjs`), `npm run ui:atlas` (screenshot atlas via `scripts/capture-ui-atlas.mjs`). No axe / eslint-plugin-jsx-a11y / dedicated a11y test tooling found; a11y is asserted by targeted render tests (e.g. `test/render-page.test.mjs` contrast checks).

## Runtime
Can render: `npm run build && node dist/app-server.js` (or `npm run dev`) serves `http://localhost:7777/`; `npm run demo` creates a throwaway repo with a saved story for the full loop. Capture via the host preview / Playwright (`playwright-core` present). Desktop-class evidence expected; no physical device coverage.

## Charts
No chart library (recharts/chart.js/d3/visx/echarts) and no dashboard/sparkline/stat-tile surface found. Mermaid diagrams render inside concept primers (`mermaid` dep) and story health labels exist (`client/surfaces/review/StoryHealth.tsx`), but these are document diagrams and status lists, not data-viz surfaces. Data viz lens does not run; diagram legibility, if relevant, is handed to VIS/TYP.
