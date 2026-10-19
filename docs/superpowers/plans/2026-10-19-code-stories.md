# Code Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let diffStory explain existing code with no diff: a story pinned to one commit, written from the app's new Explain code page or by any agent through the storyteller skill, read in the existing reader.

**Architecture:** A code story is a v4 `Tour` with `subject: "code"` and `base === head === <commit>`, made only of `context` and `concept` steps. Pinning base to head gives every diff path an empty diff, so coverage, file indexes, and rendering need no special cases. The new work is a validator branch, a small evidence/drift module, a code-story prompt and endpoint, code-aware copy in the reader and history list, an Explain code surface, and the skill's craft reference.

**Tech Stack:** TypeScript on Node 20 built-ins (server), React 19 + Tailwind v4 surfaces bundled by esbuild (client), `node:test` against `dist/`.

**Spec:** `docs/superpowers/specs/2026-10-19-code-stories-design.md`

## Global Constraints

- Diff stories do not change: `storyPrompt()` output, diff validation, coverage, and existing tests stay byte-identical in behavior.
- A code story never writes `.diffstory/story.json`; app-written code stories go to `.diffstory/stories/code-<slug>.json`.
- `head` is a full 40-hex commit id; `base`, when present, equals `head`.
- Code shapes: `entry-implementation`, `lifecycle`, `data-flow`, `map-then-path`, `core-supporting`, `rule-instances`, `cause-effect`. Code arcs carry no `changeType`.
- `codeScope.question` ≤ 4000 chars, `codeScope.ref` ≤ 200 chars, `codeScope.paths` ≤ 50 entries; all plain text.
- Camera and beat limits are the existing ones (viewport ≤ 40 lines brief/guided, ≤ 60 detailed; ≤ 3/5 beats; highlights ≤ 12 lines, ≤ 10 apart).
- Live progress reuses `runWorkflow` + the shared `ProgressPanel` (memory: honest progress only, no bespoke consoles).
- `dist/` is committed: rebuild it in the main checkout with every `src/`/`client/` change.
- No commits unless the user asks; checkpoints below are full test runs.

## Review Focus

1. A session that already holds a diff scope (`?scope=uncommitted`, a compare) opening a code story must still render the pinned commit, not the session's diff. Pinned in Task 6.
2. The working tree differs from the commit in a file the story visits: the checker warns (not errors), the agent is told to read with `git show`, and the reader says the code moved on. Pinned in Tasks 2, 3, 6.
3. Two code stories with the same question must not overwrite each other: slugs get `-2`, `-3`. Pinned in Task 2.
4. A code story imported from another repo (its commit missing here) must fail with a readable error, not a git stack trace. Pinned in Task 2.
5. Step repair on a code story must write back to the story's own file and never ask for diff coverage. Pinned in Task 9.

---

### Task 1: Code-story schema and validation

**Files:**
- Modify: `src/types.ts` (Tour, StoryArc, new types)
- Modify: `src/tour.ts` (validateTour branch, validateStoryArc, validateGeneratedTour message, loadTour)
- Create: `test/code-story.test.mjs`

**Interfaces:**
- Produces (`src/types.ts`): `type StorySubject = 'diff' | 'code'`; `type CodeStoryShape = 'entry-implementation' | 'lifecycle' | 'data-flow' | 'map-then-path' | 'core-supporting' | 'rule-instances' | 'cause-effect'`; `interface CodeScope { ref?: string; question?: string; paths?: string[] }`; `Tour.subject?: StorySubject`; `Tour.codeScope?: CodeScope`; `StoryArc.changeType?: StoryChangeType` (still required for diff stories by the validator); `StoryArc.shape: StoryNarrativeShape | CodeStoryShape`.
- Produces (`src/tour.ts`): `export const CODE_STORY_SHAPES: CodeStoryShape[]`; `export function isCodeStory(tour: unknown): boolean`; `export function normalizeCodeStoryRefs(obj: unknown): void` (sets `base = head` when subject is code and base is absent); `loadTour()` calls it before validating.

- [ ] **Step 1: Write the failing tests** in `test/code-story.test.mjs` with a `codeStory(over)` fixture (v4, `subject: 'code'`, 40-hex `head`, guided, intent with design+sources, `storyArc: { shape: 'entry-implementation', readingPath: 'entry -> core' }`, one context step with viewport/highlights/beats/landing, one page concept):
  - `a code story of context and concept steps validates` → `validateTour(codeStory())` and `validateNewGeneratedStory(codeStory())` both `deepEqual []`.
  - `code stories refuse changed and new-file steps` → kind `changed` yields an error matching `/steps\[0\]\.kind "changed" is not allowed in a code story/`.
  - `code stories pin a full commit and base must equal it` → no head: `/head must be the full 40-character commit id/`; `base: 'main'`: `/base must equal head in a code story/`.
  - `code stories need version 4 and carry no storyScope or evolution` → three distinct errors.
  - `code arcs use code shapes and no changeType` → `changeType` present: `/storyArc\.changeType does not apply to a code story/`; `shape: 'before-after'`: `/storyArc\.shape must be one of entry-implementation, lifecycle/`; a diff story with `shape: 'lifecycle'` is still rejected.
  - `codeScope stays plain text with safe paths` → `paths: ['../x']`: `/codeScope\.paths\[0\] must be a safe repository-relative path/`; a 4001-char question errors; 51 paths error.
  - `subject must be diff or code` → `subject: 'docs'` errors.
  - `loadTour fills a code story base from its head` → written file without base loads with `base === head`.
- [ ] **Step 2: Run** `npm run build && node --test test/code-story.test.mjs` — expect failures (unknown fields accepted, kinds not refused).
- [ ] **Step 3: Implement** the types and the validator branch. Code-story rules run inside `validateTour` when `subject === 'code'`; `validateStoryArc` takes the subject; `validateGeneratedTour`'s design message becomes "intent.design must give the short answer: the path this story walks and what it shows" for code stories only.
- [ ] **Step 4: Run** the same command — PASS; then `node --test test/tour.test.mjs` — PASS unchanged.

### Task 2: Code-story evidence and drift module

**Files:**
- Create: `src/code-story.ts`
- Test: `test/code-story.test.mjs`

**Interfaces:**
- Consumes: `isCodeStory`, `Tour`, `isCodeStep`, `resolveCommit`, `readWholeFile`.
- Produces:
  - `codeStoryFiles(tour: Tour): string[]` — sorted unique code-step files.
  - `changedSinceCommit(repo: string, commit: string, files: string[]): string[] | null` — visited tracked files whose working-tree content differs from `commit` (deletions included), via `git diff --name-only <commit> -- <files>`; `null` when git fails.
  - `verifyCodeStoryEvidence(repo: string, tour: Tour): { errors: string[]; worktreeDrift: string[] }` — head is a commit here; every code step file exists at head; `range`, `viewport`, step and beat highlights end within the file's line count.
  - `interface CodeStoryDrift { state: 'current' | 'changed' | 'unverified'; files: string[] }` and `codeStoryDrift(repo: string, tour: Tour): CodeStoryDrift`.
  - `codeStoryScope(tour: Tour): { label: string; command: string }` — `main @ 1a2b3c4` (or the short id alone when no distinct ref), command `git show <full id>`.
  - `codeStorySlug(input: { question?: string; paths?: string[] }): string` and `codeStoryOutputPath(repo: string, slug: string): string`.

- [ ] **Step 1: Write the failing tests** (temp repo: `app.ts` of 30 lines committed on `main`):
  - `code story evidence passes when every file and line exists at the commit` → `{ errors: [], worktreeDrift: [] }`.
  - `code story evidence names a missing file and a range past the end` → errors match `/missing\.ts does not exist at [0-9a-f]{7}/` and `/runs past the end of app\.ts \(30 lines at [0-9a-f]{7}\)/`.
  - `a commit missing from this repository is a readable error` → `/head [0-9a-f]{7} is not a commit in this repository/`.
  - `uncommitted edits to a visited file are drift, not errors` → `worktreeDrift` `deepEqual ['app.ts']`.
  - `drift stays current until a visited file changes` → `current`; edit `app.ts` → `{ state: 'changed', files: ['app.ts'] }`; editing an unvisited file keeps `current`.
  - `slugs come from the question and stay unique` → `'How does settlement work?'` → `code-how-does-settlement-work`; empty → `code-codebase-tour`; `paths: ['contracts/facets']` → `code-contracts-facets`; slug capped at 48 chars; an existing file yields `…-2.json`.
  - `the scope label reads ref at short commit` → `main @ <7>`, and the bare short id when `ref` is absent or equals the commit.
- [ ] **Step 2: Run** `npm run build && node --test test/code-story.test.mjs` — FAIL (module missing).
- [ ] **Step 3: Implement** `src/code-story.ts` with the signatures above. Line counts come from `readWholeFile(repo, file, head)`.
- [ ] **Step 4: Run** — PASS.

### Task 3: The bundled checker understands code stories

**Files:**
- Modify: `src/story-check.ts`, `src/story-check-cli.ts` (help text)
- Test: `test/story-check.test.mjs`

**Interfaces:**
- Consumes: `normalizeCodeStoryRefs`, `isCodeStory`, `verifyCodeStoryEvidence`, `codeStoryScope`.
- Produces: `StoryCheckReport.subject: 'diff' | 'code'`. Code stories skip the diff, coverage, sweep, and old-highlight checks and the `.diffstory/stories/` storyScope rule; `worktreeDrift` becomes warning findings with rule `code-at-commit` and fix "Take line numbers from `git show <short>:<file>`, not the working tree"; `formatReport` prints `Code: <label>` instead of `Diff: …`.

- [ ] **Step 1: Write the failing tests** (run the bundled checker like the existing tests):
  - `the checker passes a code story under .diffstory/stories without a storyScope` → exit 0; output contains `Code: main @` and `RESULT: READY`.
  - `the checker flags a code step that runs past its file at the pinned commit` → exit 1; `/runs past the end of app\.ts/`.
  - `the checker warns when a visited file has uncommitted edits` → output contains `[code-at-commit]`.
- [ ] **Step 2: Run** `npm run build && node --test test/story-check.test.mjs` — the three new tests FAIL.
- [ ] **Step 3: Implement** the branch in `runStoryCheck` and the label in `formatReport`; update `HELP` to say a code story is checked by passing its path.
- [ ] **Step 4: Run** — PASS (old tests unchanged).

### Task 4: Code-story prompt and progress vocabulary

**Files:**
- Modify: `src/agent.ts`, `src/progress.ts`, `client/surfaces/progress/state.ts`
- Test: `test/agent.test.mjs`, `test/progress.test.mjs`

**Interfaces:**
- Produces:
  - `interface CodeStoryPromptInput { commit: string; ref?: string; question?: string; paths?: string[]; mode?: unknown; audience?: StoryAudience; storyFile: string; worktreeDiffers: string[] }` and `codeStoryPrompt(input): string`.
  - `Workflow` gains `'code_story'`. `NOTE_MARKERS` gains `framing the question → recovering_why` and `mapping the code → designing_path`, each emitting its own label.
  - Client `WORK/DONE/FAIL/MILESTONES` entries for `code_story`: "Writing your code story" / "Code story ready" / "Generation failed"; milestones Preparing, Framing the question, Mapping the code, Writing the story, Checking the result, Ready.
- [ ] **Step 1: Write the failing tests:**
  - `the code story prompt pins the commit, file, and code contract` → includes the full commit, `"subject"` to `"code"`, the story file, `There is no diff`, the checker command ending in the story file, the four `>>` markers; excludes `Coverage pass`.
  - `the code story prompt carries the question and paths verbatim and names files to read from git` → question and each path appear; with `worktreeDiffers: ['a.ts']` the prompt says to read `git show <commit>:a.ts`.
  - `an empty question asks for a tour of the codebase`.
  - `code-story markers advance phases with their own labels` → `parseAgentNoteLine('>> Framing the question')` is `{ type: 'phase', phase: 'recovering_why', label: 'Framing the question' }`.
- [ ] **Step 2: Run** `npm run build && node --test test/agent.test.mjs test/progress.test.mjs` — new tests FAIL.
- [ ] **Step 3: Implement.** The prompt shares the field-name, prose, and hard-limit contracts with `storyPrompt` through small shared helpers, but `storyPrompt` output must not change by a byte.
- [ ] **Step 4: Run** — PASS, including every existing `storyPrompt` assertion.

### Task 5: `POST /api/generate/code`

**Files:**
- Modify: `src/server.ts`
- Create: `test/code-story-server.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - Request `{ question?, paths?: string[] | string, ref?, mode?, audience?, agent?, model?, codex…, storyId? }`. Validation runs before agent preflight: ref must resolve to a commit (default: current branch, else `HEAD`); each path must exist at that commit; `storyId` (rewrite) must name an existing code story under `stories/`.
  - `export function prepareCodeStoryOutput(storyPath: string, facts: { commit: string; ref?: string; question?: string; paths: string[] }): void` — stamps `subject`, `head`, `base`, `codeScope` in one atomic write.
  - `StoryFinishPolicy.codeStory?: boolean` — adds `verifyCodeStoryEvidence(...).errors` to the finish gate. Successful finishes return `result.storyId`.
  - Workflow `code_story`, titled "Writing a quick code tour" / "Writing a guided code tour" / "Writing a deep code walkthrough"; no story-snapshot baseline for code stories.
- [ ] **Step 1: Write the failing tests:**
  - `code story generation refuses a ref that is not a commit` → 400, detail `/not a commit/`.
  - `code story generation refuses focus paths missing at the commit` → 400, detail names the path.
  - `prepareCodeStoryOutput stamps the pinned commit and the request` → file gains `subject: 'code'`, `head`, `base`, `codeScope` deep-equal to the facts.
  - `finishing a code story rejects steps missing at its commit` → `finishStoryGeneration(..., { validateModern: true, requireStoryArc: true, codeStory: true })` returns `status: 'failed'` with an error event mentioning `does not exist at`.
- [ ] **Step 2: Run** `npm run build && node --test test/code-story-server.test.mjs` — FAIL.
- [ ] **Step 3: Implement** the route and handler beside `runGenerate`.
- [ ] **Step 4: Run** — PASS. **Checkpoint:** `npm test` all green.

### Task 6: The review page pins and projects code stories

**Files:**
- Modify: `src/server.ts` (scope resolution, renderReview), `src/render.ts`, `src/view-model.ts`, `src/payloads.ts`
- Test: `test/code-story-server.test.mjs`

**Interfaces:**
- Produces:
  - `ReviewPayload.subject: 'diff' | 'code'`; `ReviewPayload.code?: ReviewCodeView` with `{ commit: string; shortCommit: string; ref?: string; label: string; question?: string; paths: string[]; drift: CodeStoryDrift }`.
  - `ReviewShellInput.codeDrift?: CodeStoryDrift`; `BuildReviewModelOptions.subject?: StorySubject`.
  - Code stories: context kind label `Code`; arc `changeType: 'code'`, label `Code story`; shape labels `Lifecycle`, `Data flow`, `Map, then one path`; `chrome.showTrustPill` false; freshness `current`; scope overrides from the URL or session ignored.
- [ ] **Step 1: Write the failing tests** (open a repo through `/api/repo/open`, write a code story, read the payload from the page):
  - `a code story opens at its pinned commit even with a diff scope in the URL` → `/review?story=stories/code-x.json&scope=uncommitted` with a dirty tree → `payload.headRef` is the commit, `payload.subject === 'code'`, every file row is `kind: 'context'`.
  - `code story payloads label code steps and hide coverage` → `steps[0].kindLabel === 'Code'`, `chrome.showTrustPill === false`, `story.arc.changeTypeLabel === 'Code story'`.
  - `the review page reports visited files that changed since the commit` → after editing `app.ts`, `payload.code.drift` deep-equals `{ state: 'changed', files: ['app.ts'] }`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** One helper, `pinnedStoryRefs(session, tour)`, answers base/head everywhere the server now writes `session.base ?? tour.base`; `reviewScreen` skips `applyScope` for code stories.
- [ ] **Step 4: Run** — PASS; `node --test test/review-page.test.mjs test/view-model.test.mjs test/app-server.test.mjs` unchanged.

### Task 7: Reader copy and layout for code stories

**Files:**
- Modify: `client/surfaces/review/StoryView.tsx`, `ReviewView.tsx`, `ReviewApp.tsx`, `Sidebar.tsx`
- Test: `test/review-page.test.mjs` (follow its existing render pattern)

**Interfaces:** Consumes `payload.subject` and `payload.code`.

- [ ] **Step 1: Write the failing tests:**
  - `a code story overview names its commit and drops change language` → contains `The story of this code`, `Explains`, the short commit; does not contain `The story of this change` or `Working tree vs`.
  - `a drifted code story offers a rewrite at the current code` → link to `/explain?story=` with the story id.
  - `a code story review page opens on comments without coverage or challenge` → `data-review-tab="notes"`; no `data-review-tab-select="coverage"` or `"challenge"`.
  - `the code story files tab is called Files`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Notes labels: hotspots "Read these closely", non-goals "Not covered here"; the all-files button reads "Files in this story". Engine untouched unless a null check is missing.
- [ ] **Step 4: Run** tests and `npm run typecheck:client` — PASS.

### Task 8: Explain code page

**Files:**
- Create: `client/entry/explain.tsx`, `client/surfaces/explain/ExplainApp.tsx`
- Modify: `src/payloads.ts` (`ExplainPayload`), `src/shell.ts` (surface `explain`), `scripts/build-client.mjs` (`SURFACES`), `src/server.ts` (`GET /repo/<n>/explain`), `client/surfaces/stories/StoriesApp.tsx` (an "Explain code" action), `client/surfaces/change/ChangeApp.tsx` (nav link), `client/surfaces/review/ReviewView.tsx` (Actions link on code stories)
- Test: `test/code-story-server.test.mjs`

**Interfaces:**
- Produces `ExplainPayload { repoName; routeBase; branch: string | null; headCommit: string | null; headSubject: string; dirty: boolean; defaults: { mode: StoryMode; audience: StoryAudience }; prefill?: { storyId: string; title: string; question?: string; paths: string[]; ref?: string; mode?: StoryMode }; notice?: string }`.
- The form posts to `/api/generate/code` via `runProgress()` + `useProgressRun()` + `<ProgressPanel/>` and navigates to `<routeBase>/review?story=<storyId>` on a complete run. Writers come from `GET /api/agents`; Codex quality choices from `GET /api/codex/models`; stale skills offer `POST /api/skills/update`.
- [ ] **Step 1: Write the failing tests:**
  - `the explain page carries the branch, head commit, and defaults` → surface `explain`, `payload.branch === 'main'`, `payload.headCommit` 40-hex, `payload.dirty === false`.
  - `the explain page pre-fills a rewrite from a code story` → `?story=stories/code-x.json` gives `prefill.question` and `prefill.paths`; an unknown id gives `notice`.
  - `review history offers Explain code` → stories page markup links `/explain`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the route and the surface.
- [ ] **Step 4: Run** tests, `npm run build`, `npm run typecheck:client` — PASS.

### Task 9: Step repair for code stories

**Files:**
- Modify: `src/agent.ts` (`storyRepairPrompt`), `src/server.ts` (`runStoryRepair`)
- Test: `test/agent.test.mjs`, `test/code-story-server.test.mjs`

**Interfaces:** `storyRepairPrompt` input gains `storyFile?: string` and `codeCommit?: string`. With `codeCommit`, the prompt names the commit, writes back to `storyFile`, preserves `subject`/`head`/`base`/`codeScope`, and drops diff and coverage language. The server refuses `explain` on a code story, targets writes ending in the story's own path, re-stamps code facts, and finishes with the `codeStory` policy.

- [ ] **Step 1: Write the failing tests:**
  - `code story repair prompts write back to the story file at its commit` → includes the file and commit; excludes `full-diff coverage` and `.diffstory/story.json`.
  - `repairing a code story refuses explain` → 400.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 10: Code stories in Review history

**Files:**
- Modify: `src/stories.ts`, `src/payloads.ts` (`StoryRowView.subject`), `src/server.ts` (`storyChooser`), `client/surfaces/stories/StoryRow.tsx`, `client/surfaces/stories/story-state.ts`
- Test: `test/stories.test.mjs`

**Interfaces:** `StorySummary.subject: StorySubject`; code summaries take scope from `codeStoryScope`, count visited files, and with live evidence take freshness from `codeStoryDrift` (`changed` → `stale`, `inStoryDrift` = changed count).

- [ ] **Step 1: Write the failing test** `listStories reports a code story's subject, scope, and drift` → `subject: 'code'`, `scope.label` starts with `main @`, `freshness: 'current'`; after editing a visited file, `freshness: 'stale'`, `inStoryDrift: 1`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, including row copy ("Code story" fact, "Read story" pill, "Code changed" badge). **Step 4: Run** — PASS.

### Task 11: The storyteller skill learns code stories

**Files:**
- Create: `skills/diffstory-storyteller/references/code-stories.md`
- Modify: `skills/diffstory-storyteller/SKILL.md` (description and a Code stories section), `skills/diffstory-storyteller/references/schema.md` (code-story file contract)
- Test: the skill-text helpers' existing tests, plus one assertion that SKILL.md routes code-story requests to the reference and the checker command takes the story path.

- [ ] **Step 1: Write the failing assertion.** **Step 2: Run** — FAIL.
- [ ] **Step 3: Write the reference:** when to write one, pinning the commit, the loop (frame the question, map, plan the path, storyboard, write, check), the arc shapes, beats for explanation, hotspots as "read closely", the file contract with an example.
- [ ] **Step 4: Run** `npm test` — PASS; the bundled checker rebuilds with the build.

### Task 12: Docs, build, and verification

- [ ] Add a "Code stories" section to `README.md`, a subject note to `docs/story-schema.md`, and a `CHANGELOG.md` entry.
- [ ] `npm run check` — all green.
- [ ] Run the app on a real repo, generate or hand-write a code story, and look at the Explain page, the reader, and the history row in light and dark.
- [ ] Fresh reviewer pass over the whole change; fix what it confirms.
