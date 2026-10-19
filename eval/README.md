# Story eval harness

Makes storyteller prompt/skill changes measurable. Four frozen `base..head`
ranges from this repo's own history (immutable, so every run sees identical
diffs) are turned into stories by the real production prompt, then scored two
ways:

- **Mechanical** (free, objective): the app's own validators
  (`validateTour`, `validateGeneratedTour`) and the coverage gate — validation
  errors, unclaimed changed-range segments, step/viewport stats, hotspot and
  non-goal counts.
- **LLM judge**: a rubric distilled from the skill's audits — narrative order,
  thread continuity, question falsifiability, beat pointing, intent grounding,
  hotspot honesty. Scored 1–5 with one-line rationale per dimension.

## Running

```bash
npm run build
node scripts/eval-stories.mjs all --label baseline          # full run, 4 cases
node scripts/eval-stories.mjs all --label exp-new-skill     # after a skill edit
node scripts/eval-stories.mjs generate --case bugfix-review-ui --label quick
node scripts/eval-stories.mjs judge --label quick           # re-judge without regenerating
node scripts/eval-stories.mjs all --label exp1 --parallel 2 # recommended stable throughput
node scripts/eval-stories.mjs compare --a baseline --b after   # blind A/B per case
```

`compare` asks the judge which of two stories for the same case helps a
reviewer more. It asks twice, with the order swapped, and counts a vote only
when both orders agree, because LLM judges favor position and length (Zheng
et al. 2023). It spends two judge runs per case.

Flags: `--label <name>` (result folder, default `baseline`), `--model <m>`
(generator, default `sonnet`), `--judge-model <m>` (default `sonnet`),
`--case <id>` (repeatable), `--parallel <n>` (default 1),
`--runner <claude|muse>` (which agent CLI spends the runs, default `claude`).

**`--parallel <n>`** runs *n* generations at once. Per-case progress is then
prefixed `[case-id]` and the live tool stream is suppressed, since interleaving
several agents shreds the output; a single-lane run streams everything. A
sequential four-case run takes 40–90 minutes. Use `--parallel 2` for the frozen
suite: the thinking-heavy bugfix case timed out repeatedly at three or four
lanes but completed at two. Higher concurrency is available for lighter custom
cases, but it is not a reliable shortcut for comparable benchmark runs. Judging
always stays sequential: it is fast, and ordered output is easier to read.

**`--timeout <minutes>`** caps each generation (default 40, `0` disables). These
runs are thinking-bound, not I/O-bound — a cap that is too tight kills healthy
agents mid-write rather than catching stuck ones. Prefer raising it over
lowering it, and give a slow case its own `timeoutMinutes` in `cases.json`.

Requires the `claude` CLI on PATH. Generation streams the agent's real progress
live — phase markers, tool calls, and a heartbeat during long thinking gaps — so
a multi-minute run never looks like a hang. The full stream is always written to
each case's `generate.log`.

**The installed skill is what gets measured.** The agent loads
`~/.claude/skills/codestory-storyteller/SKILL.md`, not this repo's copy, so the
harness refuses to run when the two differ — a stale install silently scores the
old skill and makes every label comparison a lie. After editing the skill:

```bash
sh scripts/install-skills.sh --claude
```

**Your working tree is never touched.** Every generation runs in its own
detached git worktree under `.eval-worktrees/`, so each case gets a private
`.codestory/story.json` and the live repo is left alone. You can keep editing,
and `npm test` stays green, while a run is in flight. Worktrees are removed on
completion, on error, and on Ctrl-C.

## Reading results

`eval/results/<label>/report.md` holds the score table and per-case rationale;
each case folder keeps the exact `prompt.txt`, `story.json`, and raw logs.
Compare labels before/after a prompt or skill change — a change is real when
the mean moves consistently across cases, not when one case wiggles. The judge
is calibrated to be stingy: 3 is adequate, 5 is rare. Judge scores drift with
judge model choice, so compare runs that used the same `--judge-model`.

## Current `ranges` teaching experiment (2026-07-22)

The product gap exposed by iter3/iter4 is now implemented. A code step may carry
an optional top-level `ranges` field alongside `range`:

- `range` is the tight local camera anchor and the fallback coverage claim when
  `ranges` is absent. It stays inside `viewport` and identifies the evidence the
  step actually frames.
- `ranges` is the complete multi-span coverage claim. It may include scattered
  changed spans elsewhere in the file; entries other than the local anchor may
  sit outside `viewport` because they claim coverage rather than drive the
  camera.
- Generated stories may use `ranges` only on a step tagged `skim`, `sweep`, or
  `mechanical`; the type and runtime schemas forbid it on context steps.
- `range` is not the bounding box of `ranges`. When `ranges` is present, the
  local `range` is contained in one claimed span so a mechanical sweep cannot
  license one enormous camera shot.
- An over-cap claim counts only when it lies wholly inside one contiguous
  changed range. This keeps a giant bounding box over distant edits from gaming
  either coverage or the camera exception.
- Top-level `ranges` is distinct from legacy `focus.ranges`: `focus.ranges`
  points the read-aloud/highlight camera and does not claim diff coverage.

The current experiment teaches the storyteller to use `ranges` for scattered
mechanical work. Success means fewer mechanical tail steps **without increasing
uncovered changes or validation errors**; a shorter story that loses the trust
floor is still a regression. A separate ChatGPT-agent before/after run is a
same-model comparison over the same frozen cases, intended to isolate the
effect of teaching this contract.

### ChatGPT-agent result

The before and after stories were written fresh by the same ChatGPT agents over
the same immutable ref pairs. Two additional agents then judged each pair blind
as A/B; mechanical scores below were recomputed independently with the app's own
validators and coverage engine.

| case | changed clusters | steps | after `ranges` steps (entries) | basic / strict / uncovered / stale | blind mean | preference |
|---|---:|---:|---:|---:|---:|---:|
| bugfix-review-ui | 28 | 21 -> 16 | 2 (10) | 0 / 0 / 0 / 0 in both | 4.67 -> 4.75 | after, 2/2 |
| small-feature-walkthrough-stage | 6 | 4 -> 4 | 0 (0) | 0 / 0 / 0 / 0 in both | 4.67 -> 3.83 | before, 2/2 |
| refactor-one-shot-notes | 124 | 61 -> 47 | 11 (45) | 0 / 0 / 0 / 0 in both | 3.92 -> 4.92 | after, 2/2 |
| medium-feature-rail-numerals | 60 | 24 -> 8 | 2 (56) | 0 / 0 / 0 / 0 in both | 4.00 -> 4.58 | after, 2/2 |
| **total / mean** | **218** | **110 -> 75** | **15 (111)** | **all zero in both** | **4.31 -> 4.52** | **after in 3/4 cases** |

The three cases with a real scattered mechanical tail improved unanimously:
their blind mean rose from 4.19 to 4.75 while step count fell and all 212 of
their changed clusters stayed covered. The six-cluster small case had no valid
use for `ranges`, stayed at four steps, and both judges preferred its baseline
because the fresh after-story weakened hotspot honesty. That is useful negative
evidence: the new contract helps the shape it targets; it is not a general
narrative-quality lever. Across the full suite, mechanical-tagged stops fell
from 64 to 18 and questions from 110 to 56 without weakening any gate.

Artifacts live under `eval/results/chatgpt-current`,
`eval/results/chatgpt-ranges`, and
`eval/results/chatgpt-paired-judges` (all intentionally ignored eval output).

## Adding a case

Append to `cases.json` with an immutable ref pair (a merged commit, `X^..X`),
a mode, and the standard `excludePaths`. Prefer diverse change shapes: bugfix,
small feature, deletion-heavy refactor, multi-file feature. A case may set
`timeoutMinutes` to override the global cap when it is known to be slow.

A case may live in another local repository: set `"repo"` (absolute or
`~/…`) and `"optional": true`. The harness clones it with
`git clone --shared --no-checkout` into `.eval-worktrees/<id>` and detaches at
`head`; it never writes to that repository. Cases whose repo is missing on
this machine are skipped with a notice. Since 2026-09, in-repo worktrees are
also detached at the case `head` (previously `HEAD`), so what the agent reads
on disk is the post-change code; results from before that change are not
comparable.

## Real-world corpus

`node scripts/story-corpus-report.mjs` lints every codeStory story under the
given roots (default `~/Codes`) and prints a Markdown report: basic validity,
generation-contract errors, and lint findings by rule. There is no coverage
check — a story's diff has usually moved on since it was written. Pass
`--since <date>` to show only stories written after a skill change, e.g. to
check whether the next stories written in real repos pass the checker.

## What the first runs found (2026-07-20)

Kept because each finding cost a real agent run to discover, and each one is a
trap the next skill edit can fall into again.

**Coverage and narrative quality are in DIRECT structural conflict — measured.**
The same case, same diff, same judge, two runs that differ only in step count:

| | steps | thread_continuity | judge mean | uncovered | validation errors |
|---|---|---|---|---|---|
| iter3 | 60 | 3 | 3.67 | **0** | **0** |
| iter4 | 35 | **4** | **4.00** | 17 | 69 |

Merging steps bought a full point of thread continuity and a better mean, and
cost 17 unexplained hunks plus a story the app rejected outright. Under the
single-range contract measured in these runs, this was not a prompting failure
to be fixed with better wording: a step claimed exactly ONE `range`, so covering
a scattered diff *required* many steps, and many steps read as disconnected
captions. Every rule that tightened the narrative reduced coverage, and vice
versa.

The historical diagnosis was schema, not prose: let a step claim multiple
ranges. Then a 35-step story with connected beats could still claim all 89
hunks, and mechanical coverage would not require a rhetorical `question` on
every tail stop. That product contract now exists as the optional top-level
`ranges` field described above. The iter4 row remains the measured warning: one
attempt that told the agent to "fold the stop into its neighbour" produced
exactly that broken result when only `range` could claim coverage.

**Narrative quality and coverage are independent axes.** The deletion-heavy
refactor scored 4.33/5 on narrative — the judge called the ordering "non-trivial"
and the questions "specific enough to be answered wrong" — while claiming only
3 of 89 changed hunks. A story can read beautifully and still fail the one thing
a reviewer cannot check for themselves. Always read the mechanical columns next
to the judge's mean; neither predicts the other.

**Coverage collapsed on large diffs under the old single-range contract, for a
structural reason.** A step's `range` claimed exactly one location, so "group
related hunks into one stop" silently abandoned the trust floor whenever the
related hunks were scattered. The skill then compensated by telling the agent
to count hunks first and write `skim`-tagged sweep steps. The current experiment
tests whether top-level `ranges` can preserve those claims with fewer mechanical
tail stops.

**Schema compliance degrades under many-step load.** When the coverage rule made
stories 2-4x longer, two independent runs produced the same corruption: dropped
top-level `title`/`summary`, dropped step `order`, and beats written as `body`
without `highlights`. More steps means more chances to drift, and the app rejects
the whole story over one malformed beat. Whenever a change makes stories longer,
re-check the mechanical columns before trusting the judge's score.

**Mode wording leaks into prose.** "Explain ranges almost line-by-line" in
detailed mode produced beats that opened with "Line 742 …" in 8 of 12 cases.
Mode instructions describe *granularity*; say so explicitly or they get read as
licence for phrasing.

**`intent_grounding` is capped by the eval design, not the skill.** The frozen
cases are historical commits with no PR body, ticket, or design doc, so the only
citable evidence is the commit under review — and the judge (correctly) marks
that down as circular. In real use the agent has just made the change and cites
`["conversation"]`, which is far stronger. Read this dimension as a floor, not a
verdict, and do not tune the skill to chase it.

**Infrastructure failures look exactly like quality regressions.** A run that
exhausts the CLI's API retry chain exits non-zero after tens of minutes with a
plausible-looking log. The harness now labels that case explicitly; if you see a
generation fail, check for that label before concluding a prompt change broke
something.

**One case is thinking-bound, not stuck.** `bugfix-review-ui` exceeded 45 minutes
twice: its log shows ~1,600 `thinking_tokens` events against only 26 tool calls
(subtle a11y and CSS-specificity reasoning over minified 2,000-character lines).
It is not skill bloat — total instruction load fell when the prompt was slimmed.
Before blaming a timeout on a hang, count thinking events in `generate.log`.
