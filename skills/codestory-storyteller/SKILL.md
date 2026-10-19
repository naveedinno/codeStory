---
name: codestory-storyteller
description: Use only when the user explicitly asks for a codeStory (or a diffStory, the app's name before its rename), a story, or a guided walkthrough of code changes ("make a diff story", "write the story for this"), or a code story that explains existing code with no diff ("explain this codebase as a story", "walk me through how X works"), or when a prompt says "Use the codestory-storyteller skill" (formerly diffstory-storyteller). Never on your own initiative, not after finishing code changes and not before a commit or push. Produces .codestory/story.json (or scoped stories under .codestory/stories/): a context-first, read-aloud reading path through the diff that opens with recovered intent and drives exact viewport and highlight beats.
---

# Writing a codeStory

You just changed code. The reviewer has to understand it, distrust it in the
right places, and get through it without reading a raw alphabetical diff. You
write the story file — order and narrative only, never copied code. codeStory
renders the real git diff and reads the story aloud while it glows the lines
each sentence is about.

Assume the reviewer remembers the requested outcome but not the app internals:
module ownership, the existing call path, state flow, why nearby unchanged code
matters. Rebuild the smallest useful mental model, then move their eyes through
the evidence with `viewport`, `highlights`, and `beats`. Coverage is the trust
floor; restored context is the product.

The story is heard as much as read. Every sentence must work for a listener who
cannot glance back: name what is on screen, say who reaches it, then say what
changed and what that now guarantees.

Write a story only when the user (or a prompt) explicitly asks for one. Never
write or offer one on your own initiative after making changes. To explain
existing code with no diff, write a code story: read
`references/code-stories.md` first; it replaces steps 1-3 and the coverage rules.

codeStory is UI-only. Never install, invoke, or recommend a `codestory` CLI. The
one command you run is the checker script that ships inside this skill folder
(see "Check, then hand back"); then tell the user to open or refresh the app.

## The loop

0. Read standing preferences (`.codestory/preferences.json`).
1. Recover the why: the problem, the designed flow, the evidence.
2. Get the change set and its ledger (`check-story.mjs --ledger`).
3. Reconstruct the app path around every change.
4. Make a reviewer map, including the newcomer's questions.
5. Choose the arc (`references/change-types.md`) and plan the reading path.
6. Storyboard each stop and write its beats (`references/camera-and-coverage.md`, `references/moves.md`).
7. Re-read `references/schema.md`, then write the JSON.
8. Run the checker until it says READY; keep the story fresh after later edits.

## Non-Negotiable Contract

- Write one `.codestory/story.json` by default. Split into scoped files under
  `.codestory/stories/` only when the diff passes every test in
  `references/splitting.md`. Never write both for the same change.
- Diff exactly the requested scope. If the prompt gives a base/head or selected
  story files, use exactly those and persist the same `storyScope` object.
- Open with an `intent` block whose `goal` cites real `sources`; use
  `["code-derived"]` when no evidence exists.
- Every changed hunk is claimed by a `changed` or `new-file` step; `context`
  and `concept` steps never claim coverage.
- Do not reproduce code. codeStory pulls it from git.
- Stories longer than 10 steps give every step a concise `chapter`, reused
  across 3-7 consecutive steps (never more than 9). A chapter is named for the
  concept its beats keep using, never for a directory, and a chapter name never
  comes back after another chapter.
- Top-level `hotspots` (at most 3) anchor your honest doubts to code steps;
  `verification` lists what you ran and what you could not; `intent.nonGoals`
  lists deliberate omissions your evidence supports. Never invent any of them.
- The file format (`"version": 4`, `storyArc`, `evolution`, `base`/`head`,
  deleted files, `range`/`ranges`/`viewport`/`highlights`) is the File
  contract in `references/schema.md`, and the checker enforces it.

## Where to write the story

codeStory reads, in order: `.codestory/story.json` (default), the legacy
`.codestory/review-tour.json` (never write it), and `.codestory/stories/<slug>.json`
(scoped stories the reviewer picks between). If the prompt names a path or
selected files, obey it. Any doubt about splitting: one story.

## Detail levels

The prompt asks for `"mode": "brief"`, `"mode": "guided"`, or
`"mode": "detailed"`. When neither the request nor the preferences name one,
use guided; "detailed", "line by line", and "audit" mean detailed. Write the
field in every story file.

### Brief mode

Shortest useful story that still covers every changed hunk: one compact stop
per meaningful change cluster, one short first-person sentence per `why`.
Rebuild context inside the changed step's viewport; spend a context step only
when the entry point or dependency contract lives elsewhere.

### Balanced mode

The default for `"mode": "guided"`: one stop per review decision, grouped by
runtime/control/data flow, with the context bridges the task needs. The
reviewer should know where to read, what changed, and where to slow down.

### Line-by-line mode

For `"mode": "detailed"`, correctness review, or audit-style requests. The
reviewer is checking whether the code is exactly what it should be.

- Every guard, branch, state write, external call, emitted event, and
  assertion gets its own beat or step. Cover all meaningful code paths: happy
  path, guards, error paths, fallbacks, persistence, cleanup, external calls,
  UI states, tests.
- Trace the inbound trigger and outbound consumer, including unchanged boundary
  code when it controls correctness. Teach the domain terms the code relies on
  before they are needed. Skip trivial syntax, imports, and plumbing.
- "Line-by-line" describes *granularity*, never *phrasing*: narrower highlights
  and more stops. It does not license narrating line numbers. Name the method,
  guard, or assertion in words; let the highlight supply the address.

## Workflow

### 0. Read standing preferences

If `.codestory/preferences.json` exists, read it first and follow it unless
this request says otherwise:

```json
{ "defaultMode": "detailed", "includeGlobs": ["**/*.sol"], "excludeGlobs": [], "notes": "Solidity only; tests are reviewed separately.", "audience": "familiar" }
```

`defaultMode` applies when the request names no mode. `includeGlobs` and
`excludeGlobs` set the story's scope: files outside it get no steps, and
`storyScope` lists the included and excluded changed files. `audience`
(`newcomer` or `familiar`) sets who the story is written for; read
`references/audience.md` when it says `familiar`. When the user states the same
preference twice ("only Solidity", "make it detailed"), offer to save it there.
The file is local like the rest of `.codestory/`; never commit it.

### 1. Recover the why

The story opens with an `intent` block: the goal, the flow designed to achieve
it, and where that knowledge came from. Recover it before reading the diff.

- You usually made this change in this session: the goal is the task you were
  given; cite `"sources": ["conversation"]`. Otherwise mine motivating evidence
  and cite it; `references/intent.md` has the evidence rules, including when to
  ask the user up to 2 short questions and what never counts as evidence.

Open the goal on the problem, not on the diff: who or what was hurt, blocked,
or at risk before this change, in one concrete sentence. "We wanted to use
OpenZeppelin 5.6.1" restates the diff; say what the old state made impossible
or risky.

```jsonc
"intent": {
  "goal": "One market's funding spike could drain every account, because settlement applied the raw rate with no ceiling.",
  "design": "settleFunding() now clamps through one shared _capRate() helper that reads each market's cap before any balance moves.",
  "sources": ["conversation"],
  "nonGoals": ["Deliberately does not change settlement ordering; only the rate input is clamped."]
}
```

Record deliberate omissions in `intent.nonGoals` ("Deliberately does not …")
only with the same evidence (`references/intent.md`).

### 2. Get the change set and its ledger

Run the exact diff the prompt specifies. Otherwise
`git diff $(git merge-base HEAD <default-branch>)`, or `git diff HEAD` off a
branch. For fixed ranges, `git diff <base>..<head> --`. Then list every changed
range you must claim, with its enclosing function:

```bash
node <this skill's folder>/scripts/check-story.mjs --ledger [--base <ref>] [--head <ref>]
```

That list is your coverage ledger (details in `references/camera-and-coverage.md`).

### 2.5. Inspect the frozen first-parent progression

When the prompt includes a frozen first-parent manifest, group it into
`evolution` phases as described in `references/intent.md`; otherwise omit
`evolution`.

### 3. Reconstruct the app path

The diff shows what moved; the surrounding source shows where it lives.

- Read the complete post-change function, component, contract, schema stanza,
  or test around every changed hunk.
- Trace one hop each way: the inbound trigger, caller, route, event, or UI
  action; the outbound consumer, state write, render, return, boundary, or
  assertion. Read one or two real callers. Search real symbols; never infer a
  path from filenames.
- Read base-side code when old behavior or a deletion matters: you will need
  to say in one clause what the old code did.

Privately write the path as
`entry -> existing owner -> changed decision -> downstream effect -> proof/risk`,
with the exact source span for every link and whether it fits in a changed
step's viewport or needs a `context` step. `intent.design` names the existing
app path, where this diff attaches, and the new outcome.

### 4. Make a reviewer map before JSON

Privately identify: the behavior this change is really about; the first
requirement-backed place to inspect; the flow from there through helpers,
state, UI, side effects, boundaries; the invariants, edge cases, and risks; the
tests that pin each behavior; and the minimum unchanged code the reviewer must
see to know who calls the change, what enters it, and what consumes the result.

List up to three terms, roles, or states a newcomer would ask about ("what is
a single close?", "what is an uncapped amount?"). Teach each where it is first
needed: one clause in a landing when a sentence is enough, a `context` step
when the answer is code in another file, a concept page when it is a model
that lands better shown than told (`references/primers.md`). Unexplained
domain terms are the most common reason a reviewer stops and asks.

The reviewer is auditing AI-authored code and needs a falsifiable mental model
fast. The story should help them distrust the right places.

### 5. Narrative arc

Write the story as intent -> flow -> implementation, not a list of touched files.
Pick `storyArc.changeType` and `shape`, then read that change type's entry in
`references/change-types.md`: each kind of change has its own opening, order,
and evidence. Write `readingPath` as the real review stages, e.g.
`failure trigger -> trust boundary -> fix -> proof`, and check that titles and
beats follow it.

- Arc: the problem from step 1, then the runtime shape — "To make that work, we
  designed the flow so X reaches Y, Y asks Z, and Z returns P." — then the
  chain: "To implement that flow, I first changed Y in Z, then wired U into P,
  then pinned it with tests." Each step continues that arc.
- Thread rule: each code step's first beat picks up what the previous stop
  established ("Now that the cap is stored, this is `readCap()`, which …").
  After a concept page, apply its mental model directly to the code so the
  steps read as one continuous story.
- Landing rule: the first beat of EVERY code step lands the listener before it
  says anything about the change, the way a colleague would orient you: "this
  is function x, in file z, that y calls when w." Name the symbol the camera is
  on in `<code>`; the file or module it lives in whenever the camera changed
  files; who reaches it, by name (the calling function, route handler, test, or
  component; for an external entry point, the role that calls it and the check
  that gates it), never a vague population ("every review page", "the app");
  and when. That beat's highlight is the signature or call site. Only then the
  change. "This is `_capRate()` in `RateMath.sol`, the helper `settleFunding()`
  calls once per market right after it picks the market config; here we add
  the inclusive ceiling check." If the camera stayed inside the same function,
  one clause is enough ("Still in `_capRate()`, one branch down: …"), but it is
  never skipped. A landing is a clause, not a paragraph, but a complete one:
  never bolt a landing sentence onto an existing beat, and never pad it with
  "Look at lines …".
- Landing field: record the same facts in the step's `landing` so the app can
  show them and the checker can verify them:
  `"landing": { "symbol": "_capRate()", "calledBy": ["settleFunding()"], "when": "once per market" }`.
  For an external entry point with no calling function, name the role and the
  check that gates it: `"role": { "who": "relayer", "gate": "onlyRole(RELAYER_ROLE)" }`.
  The checker rejects a caller that no file in the repository mentions
  together with the symbol, so a vague caller cannot pass.
- Chapter-seam rule: the FIRST step of every new `chapter` must open by naming the seam
  — what the previous chapter settled and why this one starts — in the same
  sentence as its landing, in a spoken beat, not only in `why`. "That closes
  the numeral redesign; this is `renderRail()`, a second, independent fix to the
  storyless path." This is the single most common place a story loses its thread.
- Branch rule: some diffs carry two or three genuinely independent concerns.
  Do not fake a thread between them. Name the concerns in the `summary` ("two
  independent changes: X, then Y"), finish one before starting the next, and
  open each new concern by announcing the switch.
  An unsignalled jump between concerns is the most common way a story loses the reviewer.
- Long-tail caution: late in a long chapter, beats drift into captions that
  describe their own lines, or into the same sentence pasted into every step.
  Rewrite them to connect ("same handler family as above, but this one also
  writes state"). Never merge unrelated decisions to shorten the rail; one
  verified repeated mechanical pattern in one file may instead become a tagged
  sweep whose top-level `ranges` lists every span while one local `range`,
  viewport, and beat show a representative instance (across files, one glob in
  `files` — see the sweeps section of `references/schema.md`). This is a
  coverage-preserving tool for the repetitive tail, not a general instruction to make stories shorter.
- Order test: if sorting your planned steps by filename would not change how
  the story reads, it is not a story yet.
- Do not invent user intent. A technical refactor gets a technical goal.

Before your first story in a session, read `references/examples.md`: the same
small diff told as a changelog and as a story, and beats before and after.

### 6. Plan the reading path

Make a scratch plan, one row per stop:

```text
step | role | file:range | kind | leads to | reason this stop exists
```

Plan by code logic, not filenames:

- The first code stop is the behavioral entry point a developer recognizes,
  even when it is unchanged and needs a `context` step. Do not start with imports, icons,
  styling, generated output, or tests unless one of those is the feature.
- Put the riskiest stop in the first third of the story, right after the
  minimum context it needs: reviewers find far more problems in what they read
  first. Most hotspots should point there.
- Follow runtime/control/data flow across files; dive into a helper and return
  to the caller when that helps. Put definitions before repeated uses, and keep
  one direction (caller-first or callee-first) consistent; `readingPath` says which.
- When two parts must be compared — old vs new contract, interface vs
  implementation, test vs code under test — show both in one beat or a paired
  view, not in two sequential beats.
- Core behavior before glue, adapters, docs, generated files, and snapshots.
  A test sits immediately after the behavior it pins, in the same chapter — not
  in a tail at the end and not in an alternating "proof" chapter.
- Group substantive hunks into one stop only when they carry one review
  decision and share one viewport. Far apart, or separate decisions in one
  file: separate stops. The only scattered grouping is one repeated mechanical
  pattern in one file, as a tagged sweep. A step is one steady camera shot over one
  method, struct, test case, or doc section, never a teleport between
  far-apart highlight islands.
- Context steps are welcome whenever the caller, contract, storage, or config
  a judgment depends on lives in another file or a distant section; title them
  for the contract they show. Put a concept page wherever its model helps
  most, first and last included; a page teaches a model the code needs, never
  a glossary.
- A small change may be one context-rich changed step. No fixed stop count.

### 7. Storyboard each stop

Every code step is one steady camera shot. Read
`references/camera-and-coverage.md` for the viewport, highlight, `range`, and
top-level `ranges` contracts before choosing any line numbers.

When logic changed home — `moved` to another file, `extracted` into a helper,
`inlined`, or relocated more than about 40 lines within a file — record it in
the step's `moves` (`references/moves.md`). Reviewers keep asking "how was it
before, and where did it go?"; a move answers on screen.

### 8. Write the beats

Beat contract:

- Every code step has `beats`: ordered narration units, each with its own
  `text` and non-empty `highlights`. Each beat is a separate speech unit so the
  voice and the glow move together. Concept pages use `page` and `narration`
  instead.
- Use one beat per highlighted code part. Guided and brief: at most three beats;
  detailed: up to five. More review points mean another stop, not a longer beat.
  Do not put one big speech over several highlight groups.
- The first beat is the landing beat (Landing rule, step 5). A previous context
  step or concept page does not excuse it. Later beats point at the changed
  decision and its consequence.

#### Beat prose: the layer that most often goes flat

A beat is spoken while its lines glow. The listener can see the code, so words
spent on *what the lines say* are dead air. Spend them on what they cannot
see: whose code this is, why this line, why now, what it makes possible next.

0. **Land the listener first.** Name where they are — the function or rule,
   the file it lives in, who calls it by name, and when — before the change.
1. **No line-number narration.** Never open with "Line 742 …", "Lines 30-34
   add …", or "Look at lines …". A line number is an address, not a landing; the
   glow already points there. When the glow alone is ambiguous, one short
   pointer after the landing is fine ("down at line 120, the second call"), at
   most once per step.
2. **One beat, one decision.** A semicolon or "and also" joining separate
   decisions means two beats, or two steps. Aim for 12-30 spoken words (a
   landing beat usually needs 20-40); over 45 is two beats.

   Repair order for an over-long beat: split the beat; then split the step;
   then shorten the wording. Never drop the landing clause or the consequence
   clause to fit — deleting meaning is not a shortening repair.
3. **End on the consequence.** What the code now guarantees, prevents, unlocks,
   or hands to the next stop. Put the new information at the end of the
   sentence, where the voice lands.
4. **Say what changed in behavior, not in values.** When behavior changed, one
   clause says what the old code did: "before, the raw rate went straight to
   settlement; now it passes `_capRate()` first." Never narrate a value
   transition: no `650 → 600`, no "changes X from A to B". The diff already
   renders both sides in colour. If the old value matters, say what depended on
   it — "nothing reads the old weight, so no consumer breaks."
5. **Write for the ear.** Name the referent: after any camera move, say the
   symbol again instead of "it", "this", or "here". Name the symbol again.
   Introduce a thing once ("a new helper, `_capRate()`") and use the same name
   after, never a synonym. Keep sentences short, no parentheticals, present
   tense; say identifiers in `<code>` so the voice reads them cleanly.
6. **Answer the reviewer's two questions where the choice is visible:** why
   this and not the obvious alternative, and what breaks without it. One
   clause: "rather than a shared scroller, because …"; "without this guard, a
   zero claim advances the flow." Not on every step — where a reviewer would ask.
7. **One concrete trace per logic change.** Walk one realistic input through
   the changed decision: "a withdrawal of 8k against 10k of profit and a 2k
   floor now stops at the floor." Concrete beats abstract ("improves safety").
8. **Vary the frame; keep it warm.** Plain, spoken, first or second person. Do
   not open beat after beat with the same words — the checker flags a frame
   that opens a quarter of the beats — and never paste one sentence into
   several steps. Interest comes from stakes and examples, not jokes.

This applies to *every* beat, including skim ones. A sweep beat is allowed to be short; it is not allowed to be empty.
"Same rename as above; nothing reads the old field" is fine. "`.ds-back`
font-weight 650 → 600" is not. Worked BAD/GOOD beats are in `references/examples.md`.

### 9. Write one code step per code stop

Each code step has `file` + `range` (local anchor and, without `ranges`, the
coverage claim), optional top-level `ranges`, `viewport`, `highlights`,
`beats`, `kind` (`changed`, `new-file`, `context`), `title`, `chapter` when the
story exceeds 10 steps, `why`, optional `moves`, and optional `calls`/`returnsTo`.

Titles are purpose labels that work without the body: "Entry point rejects
over-cap orders before placement", "Funding nonce guard blocks stale PartyB
updates", "Regression test pins the skipped-update path". Not "Update
OrderService", "Add helper", "Tests", and never a counter ("… · 3").

A stop earns its place by naming the failure its evidence rules out. Before
keeping a step, state in one sentence the bug that would still be there if this
code were wrong — a path, an input, or a number, not a property the diff
obviously has. That sentence is the step's `why`. `why` is the fallback when
narration is off; never paste the beats into it.

```text
Beat 1: Start here: this is `placeOrder()` in the API layer, what the client's POST reaches before anything is persisted.
Beat 2: I reject over-cap requests before placement, because the old flow only noticed the limit after state had already moved.
Beat 3: That keeps the helper in the next step focused on the cap math instead of cleanup.
```

Concept pages have their own fileless shape (`references/primers.md`).
`calls: ["calleeStep"]` on a caller and `returnsTo: "callerStep"` on its callee
mark real conceptual jumps only, and the `why` names the handoff.

### 10. Declare your doubts (hotspots) and what you ran

The story answers "where do I read?"; `hotspots` answer "where should I distrust this?".
You just wrote the change — you know where you were least sure. Say so: 1-3
entries, each anchoring a doubt to the step that shows its evidence.

```jsonc
"hotspots": [
  { "step": "s2", "reason": "I matched the inclusive boundary to the docs but never exercised the exact-cap case." }
],
"verification": [
  { "check": "forge test --match-contract Funding", "result": "passed" },
  { "check": "Fork test against the deployed Core", "result": "not-run", "detail": "No archive RPC was available." }
]
```

- Honest reasons only: a boundary you guessed at, a path you never ran, an
  invariant you reasoned about but did not test, an API you followed by
  example, math you derived but did not execute. Ask: what would a smart
  reviewer get wrong here? Add the check that would settle it ("check that X
  holds when Y").
- Rank by real doubt, not importance; the line you would re-read at 2am.
  Zero hotspots only when you would stake the review on every step — rare.
- Never a summary, severity label, chore, or decoration. "This is complex" is
  noise; name the specific thing you did not verify.
- Each `step` is the id of a `changed` or `new-file` step; the reason must make
  sense next to the highlighted code.
- Environment gaps — a device you did not have, a fork you could not run, a
  suite you skipped — are not hotspots. List them in `verification` with
  `"result": "not-run"`. `verification` holds only what really happened; never
  claim a pass you did not see.

## Story file shape

Immediately before writing JSON, even if you read it earlier in this session,
read `references/schema.md`: the exact schema with a valid example, the HTML
rules for every field, and the concept-step shape. Long sessions get
compacted, and the schema is the first thing lost. Narrative fields are
restricted HTML, not Markdown.

## Hard quality gates

Coverage is necessary, not sufficient. Build the coverage ledger
(`references/camera-and-coverage.md`) before writing, and run the truth,
narrative, and camera audits (`references/audits.md`) before handing back.

## Check, then hand back

Run the checker that ships in this skill folder, from the repository root. It
applies the app's own validators, the coverage gate against the real diff, and
the prose lints:

```bash
node <this skill's folder>/scripts/check-story.mjs
```

`<this skill's folder>` is the directory this SKILL.md was loaded from, for
example `~/.claude/skills/codestory-storyteller` or
`~/.codex/skills/codestory-storyteller`. It checks `.codestory/story.json`, or
every `.codestory/stories/*.json` when there is no single story.

- Fix every ERROR. Fix every WARNING too, unless you can say in one sentence
  why the rule does not apply to that step.
- Re-run until it prints `RESULT: READY`, within this bound: if a failure
  survives two focused repairs, re-read the violated contract section before
  the third attempt; after one evidence-based retry past that, report the
  concrete gap instead of iterating.
- If a clean story is impossible, report the blocker instead of pretending it
  is ready.
- If `node` is unavailable, do the schema spot-check in `references/schema.md`
  by hand and say the checker could not run.

Keep the story fresh. If you change code after writing a story in this
session, re-run the checker before replying; when a step went stale or a change
is unexplained, repair the story in the same turn and say so.

Then tell the user: "Story ready — open the diff in the codeStory app to
review." If you wrote several scoped stories, name them and point at the app's
story picker.

## Don't

- Don't write or offer a story the user did not explicitly ask for.
- Don't organize by filename, package, or hunk order, or bury core behavior
  behind docs, tests, generated files, or cleanup.
- Don't restate the diff with "adds", "updates", "modifies", "changes" unless
  the sentence also names the consequence or review risk.
- Don't paste one sentence into several steps or number copies of a step; a
  repeated edit is one sweep step.
- Don't add concept pages as a glossary or hotspots as decoration ("this is complex").
- Don't make unsupported confidence claims ("this is safe", "tests cover it")
  without the exact condition or evidence, and don't keep a stop whose evidence
  cannot be wrong.
- Don't open a beat on the change, on "Line 742 …", or with a bare "it"; land
  the listener first.
- Don't list a non-goal you cannot back with intent evidence; an accidental gap
  belongs in a hotspot reason, not in `nonGoals`.

The craft rules here are grounded in `docs/research/` in the codeStory
repository (walkthrough products, explanation guidance, comprehension research,
and the 2026-09 corpus audit).
