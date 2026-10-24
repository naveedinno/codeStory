# Code stories: explaining code with no diff

Part of the codestory-storyteller skill. Read when the user asks to understand
existing code ("explain this codebase", "walk me through how X works", "make a
code story for the settlement flow") rather than to review a change.

A code story is a codeStory with no diff. It explains the code at one commit so
a reader can follow it: how a request travels, where a value lives, why a guard
exists. The reader, camera, beats, landings, and concept pages work exactly as
in a diff story. What changes is the job. There is no change to justify and no
coverage to claim; the reader is learning, not auditing.

From SKILL.md, steps 4-10 still apply (map, arc, plan, storyboard, beats, steps,
hotspots), with the adjustments below. Steps 1-3 and every coverage rule are
replaced by this file.

## When it is a code story

- The user wants to understand code, not to review a change. If they want both
  ("explain this module, then review my change to it"), write two stories.
- "Explain the codebase" with no question is a tour: what the system is for,
  its main parts and how they connect, then one representative path through them.
- Never write one on your own initiative, any more than a diff story.

## The loop

0. Read `.codestory/preferences.json` if it exists. `defaultMode` and `audience`
   apply. `includeGlobs` and `excludeGlobs` limit which files code steps may
   show, unless the request names other paths.
1. **Pin the commit.** `git rev-parse HEAD`, or the ref the user named, is the
   story's `head`. Run `git status --porcelain`: read any tracked file that
   differs from the commit with `git show <commit>:<path>`, never from disk.
   Every line number in the story is a line at that commit.
2. **Frame the question.** Privately, in one sentence: what will the reader be
   able to answer at the end? That is `intent.goal`. Then the short answer, in
   one or two sentences: `intent.design`. If you cannot state the short answer
   yet, you have not read enough code.
3. **Map the code.** Find the entry point a person would recognize (a public
   function, route, handler, command, contract entry, or test) and trace the
   path the question follows, one hop each way: who calls it, and what it calls.
   Search real symbols; never infer a path from file names. Note the three to
   seven parts the answer needs and how they relate, the terms a newcomer would
   ask about, and the test that pins the behavior.
4. **Choose the arc** and plan the reading path (below).
5. **Storyboard** each stop with the camera rules in
   `references/camera-and-coverage.md`. The coverage half of that file does not
   apply; `range` is simply the tight anchor of what the stop explains.
6. **Write the JSON** to the file contract below, then run the checker on that
   file until it prints READY.

## Arc shapes

`storyArc` carries `shape` and `readingPath`, and no `changeType`.

| `shape` | Use when | A typical `readingPath` |
| --- | --- | --- |
| `entry-implementation` | a question about what happens when something is called | entry -> guard -> core -> state -> test |
| `lifecycle` | one thing moves through states: an order, a position, a request | created -> locked -> opened -> closed |
| `data-flow` | a value is produced, transformed, stored, and read | source -> transform -> store -> read |
| `map-then-path` | a tour of a codebase or a subsystem | map -> part A -> part B -> one path through them |
| `core-supporting` | one central abstraction with helpers around it | core -> its helpers -> where it is used |
| `rule-instances` | one rule or pattern applied in many places | the rule -> instance -> instance |
| `cause-effect` | what a trigger sets off | trigger -> effect -> downstream effect |

Write `readingPath` as the real stages in story order, with ASCII ` -> `, at
most 200 characters, and check that the step titles follow it.

## Plan the reading path

- **Open with orientation.** For a tour, a concept page that maps the parts and
  how they connect; a diagram earns its place here. For a question, the entry
  point the reader would recognize, landed precisely.
- **Follow the order the code runs**, the way the question travels. Put
  definitions before their uses, keep one direction (caller first or callee
  first), and let `readingPath` say which.
- **Group by the idea a stop teaches, not by file.** A step is one steady camera
  shot over one function, struct, rule, or test.
- **Put the hardest idea in the first third**, right after the minimum context
  it needs. Hotspots mostly point there.
- **Close with proof:** the test that pins the behavior, or the call site that
  uses it, and a last beat that ties back to the question.
- **Budget:** brief 4-8 stops, guided 8-14, detailed as many as the path needs,
  each still one camera shot. A focused tour of the right code beats a
  scattered tour of everything. Stories over 10 steps need chapters (SKILL.md).
- **Never tour files.** "This file contains..." is a listing, not a story. Each
  stop depends on the one before it.

## Beats for explanation

Read `references/helper-depth.md`. After orientation, open the important
helpers the overview introduced, explain their meaningful branches, and follow
their returned values or state effects back into the caller. These are normal
narrated stops. Use `callSite` on helper steps to preserve the invocation on
screen while the helper's own source and beats advance.

Every beat rule in SKILL.md holds: land the listener first, one decision per
beat, end on the consequence, never narrate line numbers, write for the ear.

What changes is what follows the landing. A beat explains, in the reader's
terms, what the highlighted code does; how, only where the mechanism is not
plain from the lines; why it is built this way (the constraint, the invariant,
the failure it prevents); and, where it bites, what a smart reader would get
wrong.

There is no "before". Never write change language: no "adds", "updated",
"this change", "no longer", "used to". Say what the code guarantees. ("Now in
`X.sol`" is a camera move, not a change, and stays welcome.)

- Weak: "This function updates the balances."
- Strong: "Now in `LibQuote.sol`, `openPositionInternal()` is the helper
  `openPosition()` hands the fill to; it debits PartyA's locked margin before
  PartyB is credited, so a revert undoes both."

## Intent and hotspots

- `goal`: what the reader will understand, phrased as their need. "You want to
  know how a quote becomes an open position, and which checks can refuse it."
- `design`: the short answer: the path this story walks and what it shows.
- `sources`: what you read for the answer: `code-derived`, a README or doc by
  path, or `conversation` when the user explained something.
- `nonGoals`: what the story deliberately leaves out ("Liquidation is its own
  story"), so the reader does not wait for it.
- `hotspots` (at most three, each on a code step): where the code is subtle or
  surprising, or where your explanation is least certain ("I inferred the
  rounding direction from the tests; no comment states it"). Never decoration.
- `verification` is optional: what you ran to confirm the explanation, such as a
  test you executed to watch the behavior. Never claim a run you did not see.

## File contract

The checker enforces each line of this.

- Write `.codestory/stories/code-<slug>.json` unless the prompt names a path.
  Never write `.codestory/story.json`; that file belongs to the change under
  review.
- `"version": 4`, `"subject": "code"`, and `"head"`: the full 40-character
  commit id. Omit `base` (it always equals `head`), and never write
  `storyScope` or `evolution`. When the app asked for the story, it owns
  `codeScope`; do not write it.
- Every code step is `"kind": "context"` with `file`, `range`, `viewport`,
  `highlights`, `why`, `beats`, and a `landing`. Never use `changed`,
  `new-file`, `ranges`, `files`, `moves`, or `oldHighlights`: there is no diff
  and no old side.
- Concept steps are pages (`page` plus `narration`), as in
  `references/primers.md`, placed wherever they teach the code best.
- Camera and beat limits are the ones in `references/schema.md`.

A small story the app accepts as written:

```json
{
  "version": 4,
  "subject": "code",
  "head": "3f1c9a8e5b7d2c4f6a8b0c1d2e3f4a5b6c7d8e9f",
  "mode": "guided",
  "title": "How a locked quote becomes an open position",
  "summary": "We start where PartyB fills a quote it locked, follow the balance moves, and end where the fill hands back.",
  "intent": {
    "goal": "You want to know how a quote becomes an open position, and which checks can refuse it.",
    "design": "<code>openPosition()</code> checks that the caller still holds the lock, then <code>openPositionInternal()</code> moves both parties' balances in one call.",
    "sources": ["code-derived"],
    "nonGoals": ["Liquidation and closing are their own stories."]
  },
  "storyArc": { "shape": "entry-implementation", "readingPath": "lifecycle map -> entry and lock check -> balance moves" },
  "hotspots": [
    { "step": "balances", "reason": "Both balance moves share one call; I traced the order but found no test that reverts between them." }
  ],
  "steps": [
    {
      "id": "map",
      "order": 1,
      "kind": "concept",
      "title": "A quote's lifecycle",
      "page": "<!doctype html><html><body><ol><li>Sent by PartyA</li><li>Locked by one PartyB</li><li>Opened into a position</li></ol></body></html>",
      "narration": "A quote is sent by PartyA, locked by one PartyB, then opened into a position. This story follows that last step.",
      "preparesFor": ["entry"]
    },
    {
      "id": "entry",
      "order": 2,
      "kind": "context",
      "title": "openPosition() is where PartyB fills a quote it locked",
      "file": "contracts/facets/PartyB/PartyBFacet.sol",
      "range": [48, 52],
      "viewport": [44, 70],
      "highlights": [[48, 52]],
      "landing": { "symbol": "openPosition()", "role": { "who": "PartyB", "gate": "onlyPartyBOfQuote" } },
      "why": "Without this gate, any PartyB could fill a quote another PartyB locked.",
      "beats": [
        {
          "text": "This is <code>openPosition()</code> in <code>PartyBFacet.sol</code>, what PartyB calls once a quote it locked is ready to fill; the modifier refuses every other caller.",
          "highlights": [[48, 52]]
        }
      ],
      "calls": ["balances"]
    },
    {
      "id": "balances",
      "order": 3,
      "kind": "context",
      "title": "Both balances move in one call",
      "file": "contracts/libraries/LibQuote.sol",
      "range": [120, 131],
      "viewport": [112, 140],
      "highlights": [[120, 124], [128, 131]],
      "landing": { "symbol": "openPositionInternal()", "calledBy": ["openPosition()"] },
      "why": "If either move could happen alone, a position would open with one side unfunded.",
      "beats": [
        {
          "text": "Now in <code>LibQuote.sol</code>, <code>openPositionInternal()</code> is the helper <code>openPosition()</code> hands the fill to; it debits PartyA's locked margin first.",
          "highlights": [[120, 124]]
        },
        {
          "text": "It credits PartyB in the same call, so a revert anywhere undoes both and no position opens half funded.",
          "highlights": [[128, 131]]
        }
      ],
      "returnsTo": "entry"
    }
  ]
}
```

## Check, then hand back

Run the checker on the story file, from the repository root:

```bash
node <this skill's folder>/scripts/check-story.mjs .codestory/stories/code-<slug>.json
```

It applies the app's own validators, proves every file and line exists at
`head`, verifies landings, and runs the prose lints. Its `code-at-commit`
warning means a file you showed differs from the commit in the working tree:
confirm your line numbers came from `git show`, not from disk. Fix every ERROR,
fix or justify every WARNING, and rerun until it prints `RESULT: READY`.

Then tell the user: "Code story ready — open Review history in the codeStory
app to read it."
