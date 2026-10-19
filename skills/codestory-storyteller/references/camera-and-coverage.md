# Camera and coverage contracts

Part of the codestory-storyteller skill. Read before choosing `range`, `ranges`, `viewport`, or `highlights`, and before the final coverage pass.

### 5. Storyboard the camera

Treat every code step as a guided camera: one local shot that fits without
scrolling, and one beat per exact pointing gesture whose highlighted lines
visibly prove its sentence. A changed step usually moves orientation -> change ->
consequence: the existing signature/caller/route, then the exact changed
decision, then the nearby call, state write, return, or assertion.
Context beats may and should highlight unchanged lines; say they are existing context.

Viewport contract:

- `viewport` is what the reviewer sees. Choose it from the requirement and the
  code shape, not from the tiny hunk: the whole method, struct, schema block,
  config stanza, or test case when that makes the requirement understandable.
  It must answer "where am I?" before the highlights ask for judgment.
- Target 20-30 lines. Guided and brief steps stay within 40 lines; detailed steps stay within 60.
  When the local `range` itself exceeds the cap, the viewport may fit the full
  range plus at most 12 context lines — for one large changed region, not
  padding. Split larger functions into overlapping shots. `[0, 0]` is the
  whole-file-deletion exception.
- Keep the window local. Two distant changed blocks are two steps. Avoid
  whole-file viewports unless the file is genuinely new and small.

Highlighted-line contract:

- `highlights` are the lines the story is currently talking about; codeStory
  glows them while reading. Every range stays inside `viewport`.
- One highlight per field, write, guard, call, or assertion; a few nearby ranges
  when the sentence moves across small related sections. Each beat highlight is
  normally 1-8 lines and never more than 12 — a broad glow is not a pointer.
- If the highlights would force scrolling or leave the current method, split
  the step. Top-level `highlights` equals the union of the beat highlights: one
  camera plan, not two.

Coverage anchor contract — **`range` anchors; optional top-level `ranges` claim; `highlights` point. These
are three separate jobs.**

- `range` is the tight local anchor the viewport frames: post-change lines,
  overlapping real changed code, inside `viewport`. When `ranges` is absent it
  is also the complete coverage claim, so it spans the full changed region the
  step claims, not only the interesting lines. At least one beat highlight
  overlaps it.
- Top-level `ranges` is purely a coverage list for one mechanical edit repeated
  across scattered spans in one file. List every full span; `range` sits inside
  one entry; the others may be far outside `viewport`. Keep `range` tight around one representative instance,
  not the bounding box of `ranges`. Unrelated behavior or separate decisions get separate
  steps; `ranges` never licenses joining them.
- Deletion-heavy hunks with surviving code: anchor to the post-change line
  where the deletion happened plus the smallest code that explains it.
  Whole-file deletion: `[0, 0]` for `range`, `viewport`, and `highlights`.

Focus pointer contract (legacy `"focus": {"ranges": [[start, end]]}`, still
read for old stories; new stories use `highlights`):

- `focus.ranges` must use post-change line numbers and stay inside that step's
  `viewport`, or `range` for legacy stories.
- The focus can be one or two lines when that is what the sentence is talking
  about; point to the exact guard, call, assertion, state write, or branch, not the whole displayed section.
- Never confuse legacy `focus.ranges`, a pointer, with top-level coverage `ranges`.

`viewport` is the review window. `highlights` are what the narrator is pointing
at. `range` is the local anchor and fallback claim. Top-level `ranges` is the
complete coverage claim when present.

### Coverage ledger

Before writing the file, build a private ledger from the exact diff: file,
changed hunk, semantic purpose, planned step id (plus story id when splitting;
every hunk in exactly one story, union covers the diff). Every changed hunk is
claimed by a `changed` or `new-file` step; context and concept steps never
count.

**Count the hunks before you plan the steps.** Run
`git diff <base> -- <paths> | grep -c '^@@'` and write the number down. Each
step's effective claim is top-level `ranges` when present, otherwise `range`.
The count is a ledger check, not a target step count: Substantive changes still need enough local steps to explain every
decision. Scattered substantive decisions need separate steps; top-level
`ranges` is the single exception, for repeated mechanical spans in one file.

**Mechanical sweeps** — the same edit repeated across many places (a removed
field, a renamed symbol, an import dropped from twenty callers) — are where
coverage goes wrong. Use one or a few steps tagged `skim`, `sweep`, or
`mechanical` (only those may carry top-level `ranges`), each one pattern in one
file. Sweep steps must not become diff narration:

- Keep `range` tight around one representative instance and inside `viewport`;
  list every full changed span in `ranges`. `range` is not their bounding box.
- Point the single beat at ONE local instance — normally the first useful
  occurrence, 1-8 lines. Do not highlight every span or widen the viewport.
- The beat says what the edit is and why it is safe to skim — "same attribute
  rename as above; nothing here reads the old value" — never a restatement of the changed lines.
- Give every sweep step the same `chapter` so the rail shows one skimmable block.
- Split a sweep only when the pattern, safety argument, or file changes. An
  instance carrying a substantive decision gets its own normal step.

A sweep step is shorter, never structurally lighter: it carries `id`, `order`,
`title`, `kind`, `file`, `range`, complete `ranges`, `viewport`, `highlights`,
`why`, `tags`, and one beat with `text` and `highlights`. Never rename a field
to save room — beats use `text`, never `body`.

```json
{
  "id": "s12",
  "order": 12,
  "title": "Removed controls leave no stale selectors",
  "kind": "changed",
  "file": "src/page-assets.ts",
  "range": [731, 742],
  "ranges": [[731, 742], [78, 78], [900, 902]],
  "viewport": [728, 760],
  "highlights": [[734, 736]],
  "why": "These spans repeat the same dead-control selector cleanup, so one local instance is enough to verify the pattern.",
  "beats": [
    { "text": "Skim this representative selector removal; every other claimed span repeats the same dead-control cleanup.", "highlights": [[734, 736]] }
  ],
  "tags": ["skim", "sweep"]
}
```

When narrative elegance and coverage conflict, coverage wins. Concept pages
never replace a changed step in the ledger. Generated or oversized files the
prompt excludes get no steps; with `storyScope.includedFiles`, the ledger
covers only those files and `storyScope.excludedFiles` are outside this story.

Files a command regenerates (exported ABIs, committed build output, lockfiles
a package manager rewrote) are not review decisions — never narrate them as
steps. Declare them once in `storyScope.regenerated` as
`{ "files": [<glob patterns>], "by": "<the command>" }`, e.g.
`{ "files": ["abis/*.json"], "by": "npx hardhat export-abi" }`. Coverage treats
matched files as explained, and the all-files view shows one row per generator
with its command. Only claim files the command actually produces; the reviewer
sees the command and can rerun it.

### Range and viewport audit

- Read the post-change file with line numbers before choosing `range`,
  `ranges`, `viewport`, `highlights`.
- Every `changed`/`new-file` `range` overlaps real changed code, stays inside
  `viewport`, and has at least one beat highlight overlapping it. With
  `ranges`, every entry is a full claimed changed span and one contains `range`;
  the others may sit outside `viewport` and must not widen it.
- Other top-level `ranges` entries may sit outside `viewport`. Do not widen
  `range` or `viewport` into their bounding box or move highlights between them.
- `context` ranges are unchanged code and never satisfy coverage.
- `viewport` includes enough surrounding code that a reviewer who just read the
  requirement knows where the highlighted lines live; `highlights` stay inside
  it; both stay on one nearby section.
- Non-deletion viewports stay within the mode cap, except a larger local
  `range` may use its own length plus at most 12 context lines. Individual beat
  highlight ranges are at most 12 lines. Top-level `highlights` match the union
  of beat highlights.
- Use `newPath` for renamed files.
