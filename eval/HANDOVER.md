# Story-quality work — handover

The top-level `ranges` experiment is complete. The product contract, prompt,
and storyteller skill now all understand multi-span coverage claims, and the
preserved same-model ChatGPT before/after artifacts show the intended result:
the three cases with real mechanical sweeps became substantially shorter while
retaining perfect mechanical trust. The no-sweep control stayed at four steps
and both blind judges preferred its before story, so this is evidence for the
specific sweep mechanism, not a claim that every story became better.

Read this file with [GOAL.md](GOAL.md) and [README.md](README.md). This handover
records the completed experiment, how it works, and what remains uncertain.

## Handoff snapshot (2026-07-22)

- Current branch/head at verification time: `main` at `d0d0f48`.
- The final current working-tree suite passed **539/539** with
  `node --test test/*.test.mjs` in an environment allowed to bind loopback.
  The earlier implementation and pre-audit checkpoints passed **529/529** and
  **535/535** respectively; the audit hardening added four regressions. Keep the
  timing explicit; none of these counts is a failed or contradictory run.
- The focused storyteller/ranges suite passed **134/134**:
  `node --test test/agent.test.mjs test/coverage.test.mjs test/eval-cases.test.mjs test/tour.test.mjs`.
- Production prompt lengths are **3,920** characters for `brief`, **3,924** for
  `guided`, and **3,932** for `detailed`, measured from `dist/agent.js` with
  `storyPrompt('main', undefined, mode)`.
- All eight preserved before/after stories were re-scored after the final audit
  hardening. They still cover **218/218** changed ranges with zero basic, strict,
  stale-pointer, or uncovered errors.
- The repository storyteller skill and both installed copies currently match
  byte-for-byte. All three had SHA-256
  `c428c76e7640439b429b3dee7c5227b7d6e4695f5f6fed659e23866a37a3922a`:
  `skills/codestory-storyteller/SKILL.md`,
  `~/.agents/skills/codestory-storyteller/SKILL.md`, and
  `~/.claude/skills/codestory-storyteller/SKILL.md`.
- The checkout is heavily dirty and contains unrelated work. `eval/HANDOVER.md`
  itself is untracked at this snapshot, while the experiment's source, generated
  `dist/`, docs, harness, and tests overlap a much larger set of edits and
  deletions. Do not bulk-stage, reset, clean, or commit from this handover.
  Inspect `git status --short`, identify ownership file by file, and keep `src/`
  and its generated `dist/` counterpart together if a scoped commit is later
  authorized.

## What was implemented

The contract has three layers and they now agree:

1. **Schema and semantics.** `CodeTourStep` in `src/types.ts` is a discriminated
   union: changed/new-file steps may carry
   `ranges?: Array<[number, number]>`, while context steps declare
   `ranges?: never`. `claimedRanges(step)` returns the list when present and
   falls back to `[step.range]`, preserving old stories.
2. **Trust gates.** `src/coverage.ts` counts every effective claimed span for
   coverage and checks both the local camera and every claim for staleness. An
   over-cap claim is credible only when one contiguous changed range contains
   it, so a giant bounding box over distant changes cannot manufacture coverage.
   `src/tour.ts` validates a non-empty list, requires the local `range` anchor
   inside one entry, accepts remote entries outside the viewport, keeps the
   `[0, 0]` deletion sentinel coherent, applies the direct 40/60-line cap to
   context cameras, requires generated multi-range steps to be tagged
   `skim`/`sweep`/`mechanical`, and reports malformed tags/highlights without
   throwing. Concept steps reject code-only fields through their existing schema
   gate. The corresponding compiled files live under `dist/`.
3. **Generation teaching.** `src/agent.ts` pins the exact field names, the
   effective coverage rule, and the narrow exception for one repeated mechanical
   pattern in one file. `skills/codestory-storyteller/SKILL.md` teaches the full
   workflow: one representative local camera and beat, every repeated full span
   in top-level `ranges`, a shared skim/sweep chapter, and no merging of separate
   decisions merely to shorten the story. Long-story schema checks and the final
   coverage pass remain explicit because those are where real runs drifted.

The key design invariant is deliberate:

- `range` is the tight local camera anchor. It stays in `viewport` and must be
  contained in one top-level `ranges` entry.
- Top-level `ranges` is the complete coverage claim for that step. Remote entries
  may be outside `viewport`; they must not be collapsed into one giant bounding
  box.
- `highlights` and each beat's highlights point at the representative evidence
  visible in the camera.
- Legacy `focus.ranges` is only a pointing/camera alias. It never claims
  coverage and is not interchangeable with top-level `ranges`.
- Without top-level `ranges`, the old contract is unchanged: `range` is both
  anchor and complete claim.
- A local camera is checked independently from remote claims. One valid sweep
  entry cannot hide a stale `range` anchor.
- Claims wider than the mode cap are trusted only when the diff proves the
  entire span is one contiguous change; distant changes must stay separate.

The focused tests that lock this down are in `test/agent.test.mjs`,
`test/coverage.test.mjs`, and `test/tour.test.mjs`. They cover prompt wording,
skill wording, fallback behavior, scattered claims, partial claims, stale remote
claims and local cameras, oversized bounding boxes, viewport independence,
anchor containment, generated sweep tags, context caps/rejection, malformed
JSON, deletion sentinels, and the distinction from `focus.ranges`.
`test/eval-cases.test.mjs` locks the frozen case shape and production-prompt
construction.

## Completed ChatGPT before/after experiment

The frozen inputs are the four immutable `base..head` ranges in
`eval/cases.json`. The completed comparison is recorded as a same-model ChatGPT
run on both sides of the same cases:

- Before teaching: `eval/results/chatgpt-current/<case>/story.json`
- After teaching: `eval/results/chatgpt-ranges/<case>/story.json`
- Blind pairwise judgments: `eval/results/chatgpt-paired-judges/*.json`

Mechanical scoring was rerun from the current app validators, coverage engine,
and exact git diffs. “Clusters” below means the changed ranges returned by
`changedRanges`, not merely raw `@@` hunk headers.

| frozen case | mode | clusters | steps before → after | after `ranges` steps / entries | basic / strict / stale / uncovered, before and after | blind preference |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `bugfix-review-ui` (`4d6f30c^..4d6f30c`) | guided | 28 | 21 → 16 | 2 / 10 | 0 / 0 / 0 / 0 | after, 2/2 |
| `small-feature-walkthrough-stage` (`abf82f4^..abf82f4`) | brief | 6 | 4 → 4 | 0 / 0 | 0 / 0 / 0 / 0 | **before, 2/2** |
| `refactor-one-shot-notes` (`45d4f55^..45d4f55`) | guided | 124 | 61 → 47 | 11 / 45 | 0 / 0 / 0 / 0 | after, 2/2 |
| `medium-feature-rail-numerals` (`d7c3deb^..d7c3deb`) | detailed | 60 | 24 → 8 | 2 / 56 | 0 / 0 / 0 / 0 | after, 2/2 |
| **Total** |  | **218** | **110 → 75** | **15 / 111** | **0 / 0 / 0 / 0** | after 6/6 on sweep cases; before 2/2 on control |

Every one of the **218** changed clusters is fully covered in both conditions.
Both conditions also have zero basic validation errors, zero strict generated-
profile errors, zero stale pointers, and zero uncovered segments. The after run
uses 35 fewer stops while making all remote coverage explicit; it did not buy
brevity by dropping trust.

The paired files and their case coverage are:

- `judge-bugfix.json` and `judge-crosscheck-three.json` — bugfix.
- `judge-refactor-one.json` and `judge-refactor-two.json` — refactor.
- `judge-small-medium.json` and `judge-crosscheck-three.json` — medium feature.
- `judge-small-medium.json` and `judge-crosscheck-three.json` — small control.

Do not assume `A` is always before or always after. The side assignment varies
by case/file; unique step ids and step counts identify the story being judged.
Both judgments prefer the taught story on each sweep-eligible case. Both prefer
the old story on the small case, where neither story uses `ranges`.

### What the result establishes

- Top-level `ranges` solved the measured structural conflict on these frozen
  diffs: repeated mechanical edits can be compressed without widening the
  camera, losing schema validity, or leaving changes unexplained.
- The largest gain is where the repeated tail dominates: the medium feature fell
  from 24 to 8 steps while two sweep steps explicitly claimed 56 spans.
- The no-sweep control is important negative evidence. The broader prompt/skill
  revision is not a universal quality win, and stochastic generation remains a
  plausible explanation for some prose differences when the new field is unused.

### What it does not establish

- This is one generated story per condition over four repository-local cases,
  not a statistically powered benchmark or proof across arbitrary diffs.
- `GOAL.md` is not formally closed by these pairwise files. The targeted ranges
  hypothesis passed, but the custom consolidated comparison at
  `eval/results/chatgpt-paired-judges/report.md` is not a normal harness report,
  and the no-sweep after story missed the per-case quality gate and lost both
  head-to-head judgments.
- The preserved ChatGPT folders contain stories only: no generation prompt,
  raw log, model build, seed, duration, or source snapshot. The paired judge
  JSONs likewise do not preserve the exact blind-judge prompt/model metadata.
  They are strong outcome artifacts but not enough to reproduce the exact run
  byte for byte.
- Remote `ranges` claims are intentionally coverage-only. The reviewer sees one
  representative camera shot; this experiment did not add a UI for browsing
  every remote claimed span from the sweep step.

## Historical Claude iter3 — separate evidence

Keep `eval/results/iter3/report.md`; it was the prior high-water mark and records
expensive lessons. It is **not directly comparable** to the ChatGPT paired
experiment above: iter3 used Sonnet for generation and judging, an earlier
prompt/skill/schema state, and a different scoring protocol.

Within its own Claude run, iter3 generated 4/4 stories. Across the four cases it
had one validation error total, an overall judge mean of 3.67, and a mean
`hotspot_honesty` score of 4.75. Its deletion-heavy refactor story used 60 steps
and left zero of that case's 89 raw hunks uncovered; across the whole suite the
report still recorded eight uncovered items (1 small + 7 medium). Preserve those
qualifiers when citing it. Iter4 remains the paired warning in
`eval/results/iter4/report.md`: prose-driven compression improved some judge
scores while producing validation and coverage failures under the old
single-range contract.

## Hard-won traps

1. **Shorter is not success by itself.** Always read basic validation, strict
   validation, stale pointers, and uncovered segments next to step count and
   judge preference. Iter4 showed that a nicer narrative can be unusable.
2. **Do not make `range` the bounding box of `ranges`.** That would turn
   scattered lines such as 78 and 900 into an enormous camera license and undo
   the local-shot contract. Keep one tight anchor and remote coverage claims.
   Coverage now rejects an over-cap claim unless one contiguous changed range
   contains it, and stale-pointer checks inspect the anchor separately.
3. **Do not confuse top-level `ranges` with `focus.ranges`.** The latter points;
   only the former claims. Tests deliberately protect this distinction.
4. **Claims must cover complete changed clusters, not merely touch a hunk.** The
   coverage pass re-reads every +/- line because one hunk can contain several
   separated changed clusters or partially claimed spans.
5. **Sweep consolidation is intentionally narrow.** One repeated mechanical
   pattern, one file, one representative camera. Substantive decisions, different
   patterns, or different files still need separate local explanations.
6. **Long stories lose schema one field at a time.** Real runs dropped `why`,
   `order`, top-level `title`/`summary`, or renamed beat `text` to `body`/`prose`.
   Keep exact field names and the final every-step schema check in the production
   prompt; skill prose alone was not reliable enough.
7. **Where a rule lives predicts compliance.** Mechanical invariants belong in
   validators and exact prompt contracts; the skill should own judgment and
   workflow. The finished-JSON verification pass was more reliable than adding
   another paragraph of advice.
8. **A stale installed skill invalidates a run.** The Claude harness checks
   `~/.claude/skills/codestory-storyteller/SKILL.md`, because that is the copy it
   actually loads. Reinstall after any skill edit and never change the installed
   copy while parallel generations are running.
9. **Loopback denial is an environment failure.** Several tests create local
   HTTP servers. A restricted sandbox can fail those while the same full suite
   passes in a loopback-capable run; do not diagnose prompt or ranges regressions
   from the sandbox failure alone.
10. **Use two generation lanes.** The thinking-heavy bugfix and refactor cases
    have 90-minute case overrides. Three or four lanes previously caused
    timeouts; `--parallel 2 --timeout 90` is the stable default.
11. **Judge scores and mechanical trust are independent, and model eras do not
    mix.** Compare the ChatGPT pair within itself and Claude iter3 within itself.
    Do not blend their numeric means into one trend line.
12. **The evidence directories are ignored.** `.gitignore` excludes
    `eval/results/`. `git clean`, a fresh clone, or a careless cleanup can erase
    the before/after and judge artifacts. Preserve them deliberately if they
    need to survive beyond this checkout.

## Re-run and verification commands

### Build and tests

```bash
npm run build
node --test test/agent.test.mjs test/coverage.test.mjs test/eval-cases.test.mjs test/tour.test.mjs
node --test test/*.test.mjs
```

The final command needs permission to bind loopback. Test totals may grow as
unrelated work lands; record the date and command instead of silently replacing
the 529 implementation checkpoint or this handoff's 535 rerun.

Check prompt size without regenerating anything:

```bash
node --input-type=module -e "import {storyPrompt} from './dist/agent.js'; for (const mode of ['brief','guided','detailed']) console.log(mode, storyPrompt('main', undefined, mode).length)"
```

Install both supported local copies, then verify exact equality:

```bash
sh scripts/install-skills.sh --claude
cmp skills/codestory-storyteller/SKILL.md ~/.agents/skills/codestory-storyteller/SKILL.md
cmp skills/codestory-storyteller/SKILL.md ~/.claude/skills/codestory-storyteller/SKILL.md
```

### Re-score the preserved ChatGPT stories mechanically

This reads the frozen refs and artifacts; it does not call an LLM or mutate the
stories:

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseUnifiedDiff} from './dist/diff.js';
import {validateTour, validateGeneratedTour} from './dist/tour.js';
import {computeCoverage, stalePointers} from './dist/coverage.js';
const cases = JSON.parse(readFileSync('eval/cases.json', 'utf8')).cases;
for (const label of ['chatgpt-current', 'chatgpt-ranges']) {
  for (const c of cases) {
    const story = JSON.parse(readFileSync('eval/results/' + label + '/' + c.id + '/story.json', 'utf8'));
    const diff = execFileSync('git', ['diff', c.base + '..' + c.head, '--',
      ...c.excludePaths.map((p) => ':(exclude)' + p)], {encoding: 'utf8', maxBuffer: 64e6});
    const files = parseUnifiedDiff(diff);
    const coverage = computeCoverage(story, files);
    const rangeSteps = story.steps.filter((s) => Array.isArray(s.ranges));
    console.log(label, c.id, {
      steps: story.steps.length,
      clusters: coverage.totalChangedRanges,
      covered: coverage.fullyClaimedChangedRanges,
      basic: validateTour(story).length,
      strict: validateGeneratedTour(story).length,
      stale: stalePointers(story, files).length,
      uncovered: coverage.uncovered.length,
      rangeSteps: rangeSteps.length,
      rangeEntries: rangeSteps.reduce((n, s) => n + s.ranges.length, 0),
    });
  }
}"
```

### Run a fresh scripted Claude evaluation

The repository harness is a Claude CLI harness, not the preserved ChatGPT
pairwise protocol:

```bash
npm run build
sh scripts/install-skills.sh --claude
node scripts/eval-stories.mjs all --label ranges-rerun --parallel 2 --timeout 90
```

It creates isolated worktrees, records prompts/logs/stories/judges under
`eval/results/ranges-rerun/`, and leaves the live working tree alone. Generation
is billed and can take 60–90 minutes. If one case exhausts API retries, treat it
as infrastructure and rerun that case rather than as a quality regression.

There is no committed one-command reproduction for the exact ChatGPT blind
pair. For a new same-model experiment, first preserve the exact before and after
prompt text, skill hash/copy, source revision, generator model/build, raw logs,
and randomized A/B mapping; then run two blind judges per case and mechanically
score both sides. Do not overwrite `chatgpt-current`, `chatgpt-ranges`, or
`chatgpt-paired-judges` unless intentionally replacing the historical evidence.

## Honest next work

1. Decide whether the ignored ChatGPT stories and paired judgments should be
   promoted into a durable, metadata-complete fixture or archived elsewhere.
   Their current location is valuable but fragile.
2. If stronger confidence is needed, repeat the same-model comparison across
   multiple seeds and additional sweep/no-sweep cases. Preserve all inputs and
   judge mappings this time. The small control deserves special attention.
3. Decide whether the review UI should expose remote sweep claims. Coverage is
   correct today, but only the representative local span is framed for a human.
4. Re-evaluate the broader `GOAL.md` exit criteria with one report-producing run
   on a single frozen source/skill version. Do not substitute pairwise preference
   for the report's per-case score and minimum-dimension gates.
5. Before any commit, separate this experiment from unrelated picker, audio,
   macOS, VS Code extension, generated bundle, and test work already present in
   the dirty checkout. No commit or push is implied by this handover.
