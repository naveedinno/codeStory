# Changelog

All notable changes to codeStory are tracked here.

## Unreleased

- Narration now uses Lino's speech engine; the Aloud app is no longer needed.
  codeStory starts a private copy of the engine bundled in `Lino.app` on the
  first play (random loopback port, one-time secret) and stops it on exit, so
  Lino itself does not have to be open. Voices and the per-model narrator are
  shared with Lino; if Lino last read another language, narration switches to
  Kokoro. `CODESTORY_LINO_APP` points at a Lino build outside `/Applications`
  and `~/Applications`.
- When Lino is unavailable, narration falls back to the browser's built-in
  voice, with a one-time note on the first play.

- Renamed diffStory to codeStory, now that the app explains code with no diff
  too: the npm package is `@naveedinno/codestory`, the Claude Code plugin is
  `codestory@codestory`, the skill is `codestory-storyteller`, the Zed extension
  is `codestory` (tool `start_codestory`), and the macOS app is `codeStory.app`
  (`local.codestory.desktop`). Nothing saved is lost:
  - Opening a repository moves its `.diffstory/` folder into `.codestory/`.
    Where both hold the same file, the `.codestory/` copy wins and the old file
    stays where it was; every `.gitignore` rule naming `.diffstory` gains a
    `.codestory` twin. Leftover `.diffstory/` files never show up as changes.
  - The first launch copies `recents.json`, `settings.json`,
    `story-selection.json`, and `verification/` from `~/.diffstory/` into
    `~/.codestory/`. The old folder is never changed, `src/` included.
  - The bundled checker reads `.diffstory/` while a repository has no
    `.codestory/` yet, and still never writes.
  - **Update skills** and `scripts/install-skills.sh` replace an installed
    `diffstory-storyteller` copy, as they did for `review-tour`, and the skill
    still answers requests for a diffStory.
  - `DIFFSTORY_CODEX_BINARY` and `DIFFSTORY_PROJECT_PATH` still work; the
    `CODESTORY_` name wins when both are set.
  - Story bundles now download as `.codestory.json`; older `.diffstory.json`
    bundles still import.
  - `scripts/install-macos-app.sh` installs `codeStory.app` and removes the old
    `diffStory.app` once the new one is in place. The desktop window's zoom and
    size start fresh, since they live with the app.
- Code stories: explain existing code with no diff. **Explain code** (from
  Review history or the scope picker) takes a question, optional starting
  paths, and the ref to explain, and the agent writes a guided, read-aloud
  walkthrough pinned to that commit under `.codestory/stories/code-*.json`.
  The reader frames it as code (no coverage, no change language), flags when
  the files it visits change in the working tree, and offers a rewrite at the
  current code. The checker verifies every file, line, and landing at the
  pinned commit, and the storyteller skill gains `references/code-stories.md`.
- Tightened the storyteller skill's explanation craft: a ranked repair order
  for over-long beats, a ban on impact/risk language without a `verification`
  measurement (mark it unknown or hotspot it instead), a bounded checker loop,
  a question plus avoid-when line on every change-type and surface playbook,
  and a still-frame rule requiring concept pages to teach with no fact living
  only in motion, hover, or a transient state.
- Story format v4: concept steps can be free HTML pages (JavaScript and CDN
  libraries allowed) rendered in a sandboxed frame, with no cap on how many or
  where they sit.
- Concept pages are offline by default: a page opts into network access with
  `"network": true` on its step, and opted-in pages carry a Network badge.
- Story bundles for team handoff: export a story as a `.codestory.json`
  download and import it under `.codestory/stories/` from Review history.
- `storyScope.regenerated` declares generator outputs (ABIs, lockfiles) once
  with their command instead of narrating them as steps; coverage treats them
  as explained and the file list shows one row per generator.
- Step `weight` (`must`/`skim`): the rail collapses skim runs, and a
  must-read-only mode skips them in keyboard order and narration.
- Story health row in the Overview: contract errors, lint findings grouped by
  rule, and runtime diagram failures, each with step jump and agent repair.
- Cross-file sweep steps: one tagged step names a glob for a repeated
  mechanical pattern, coverage claims every matched file, and the checker
  verifies each matched file carries the same structural edit.
- Old-side beat highlights: beats about removed code point `oldHighlights` at
  deleted OLD-side line numbers, which glow the red rows and speak as
  "deleted lines N"; the checker verifies they hit real deletions.
- Story health sections cap at ten rows with an overflow count, so large
  stories keep a light Overview; a perf smoke test pins the 300-step review
  page inside a 5s budget.
- History snapshots no longer dirty the tree for scope selection: the
  committed-story fallback and auto scope ignore `.codestory/history/`, so a
  clean tree with snapshots still opens its committed diff.
- Tightened the story step header: the step title now leads its own line with
  the step number, kind, and call flow demoted to quiet reference marks at the
  end of the same row, instead of sitting in a band of filled chips above it.
  Story diff heads no longer spell out an unrenamed path twice, and the step
  toolbar dropped controls it never showed. Together this returns about 30px of
  vertical space per step and puts the title first in reading order.
- Paired deleted and added lines onto single side-by-side rows in the Split and
  full-file views, with word-level change marks on both sides of each pair, so a
  rewritten statement reads as one before/after row instead of two separate
  blocks.
- Marked absent-side regions in split panes with a quiet hatch so added or
  removed blocks read as "did not exist here" instead of blank space.
- Added a sticky enclosing-scope label to each split hunk so long functions stay
  oriented while scrolling.
- Decluttered the split header, which now shows paths only for renames, added
  +N −M change stats to each file panel, and gave the expand-context controls
  readable labels.
- Added restrained diff annotations to guided stories: measured region boxes and
  gutter arrows draw on split panes, while invisible paths, destinations, and
  consequences render as accessible in-flow callouts.
- Added live review synchronization: agent replies, review-state changes, story
  updates, and working-tree diff drift now reach an open review page over a
  server-sent event stream instead of requiring manual reloads. Reviews stay
  live across bfcache restores, tolerate a story rewrite mid-review, and never
  report a persisted comment change as failed.
- Added interleaved concept primers so generated stories can teach new terms and
  mental models before the code that uses them, with optional local Mermaid
  diagrams and no effect on diff coverage.
- Keep clone-and-run setup easy for new users.
- Keep optional integrations clearly separated from the core app.

## 0.1.0

- Added the local browser review app for git diffs.
- Added guided story review files under `.diffstory/story.json`.
- Added selected-text comments and agent handoff for Claude/Codex.
- Added optional local read-aloud support, including optional Kokoro AI voice
  setup.
- Added npm packaging metadata, bundled skills, brand assets, and public launch
  docs.
