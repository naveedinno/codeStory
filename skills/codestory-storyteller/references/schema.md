# Story file schema and narrative markup

Part of the codestory-storyteller skill. Read immediately before writing or editing story JSON.

## File contract

The checker enforces every line of this; knowing it saves a rewrite.

- Every story under `.codestory/stories/` carries a top-level `storyScope` with
  `includedFiles`, and every code step's `file` appears in it. The app rejects
  the story otherwise. The one exception is a code story (`"subject": "code"`):
  it explains code at one pinned `head`, has no `storyScope`, and follows the
  contract in `references/code-stories.md` instead of this file's diff rules.
- Newly generated stories use `"version": 4`. Older versions stay readable; do
  not rewrite an existing story just to modernize its number. A `page` concept
  needs version 4, so raise an older story to 4 when you add one.
- Every newly generated story carries `storyArc` with `changeType`, `shape`, and
  a plain-text `readingPath` naming the real review stages in story order with
  ASCII ` -> ` separators.
- Add `evolution` only when the prompt supplies an eligible frozen first-parent
  manifest. Author `phases`, `firstCommit`, `lastCommit`, optional
  `relatedSteps`; never author server-owned `baseSha` or `headSha`.
- Set `base` to the ref you diffed against; set `head` only for fixed
  `base..head` stories.
- Never use "deleted" as a step kind. For deleted files, use kind "changed" and
  anchor the range at the post-change deletion location.
- For a whole deleted file, use `range`, `viewport`, and `highlights` of `[0, 0]`.
  Do not invent line 1 for a file that no longer exists.
- A beat about removed code points `oldHighlights` at the deleted OLD-side
  line numbers (read them from the base side: `git show <base>:<file>`). A
  beat needs `highlights`, `oldHighlights`, or both; old-side ranges glow the
  red deleted rows, and the checker verifies they hit real deletions. Never
  narrate "around line N" for a deletion again — point at it.
- `range`: post-change, 1-based inclusive lines; the tight local camera anchor.
  When top-level `ranges` is absent, `range` is also the step's complete
  coverage claim.
- Optional top-level `ranges`: the complete list of post-change spans a
  `changed`/`new-file` step claims. Only for one repeated mechanical pattern in
  one file. `range` must be contained in one entry; other entries may sit
  outside `viewport`; `range` is never their bounding box.
- `viewport`: post-change lines the diff viewer shows. `highlights`: post-change
  ranges inside `viewport`; the lines the story is currently talking about.
  Full contracts: `references/camera-and-coverage.md`.
- `context` steps show unchanged code that helps judge a changed path; they
  never claim coverage and never carry `ranges`. `concept` steps are fileless
  pages (`page` + `narration`); same rule. Their full shape is in
  `references/primers.md`.
- Optional `landing` on code steps (never on concept steps): `symbol`
  (required), `calledBy` (1-3 names) or `role` (`who`, optional `gate`), and
  optional `when`; plain text, each at most 80 characters (`role.who` 40). The
  checker verifies that each caller shares a file with the symbol and that a
  gate is written in the step's file. The app shows it under the step title.
- Optional `callSite` on a version 4 helper code step: `{"step":"caller-id",
  "range":[start,end],"viewport":[start,end]}`. `step` names an earlier code
  step; `range` is the actual call (at most 12 lines). Optional `viewport`
  crops that caller. Both spans stay inside the caller's viewport; range stays
  inside the crop. If `returnsTo` is present, it equals `callSite.step`.
  The app shows caller and helper together at the same revision; caller context
  adds no coverage. See `references/helper-depth.md` for narrative obligations.

#### Narrative fields are HTML

Story prose is restricted HTML, not Markdown: `**bold**` renders literally.

| Field | You may write |
| --- | --- |
| concept `body` (legacy) | block HTML: `<p> <h2>-<h4> <ul> <ol> <li> <blockquote> <pre> <hr> <table> <caption> <thead> <tbody> <tr> <th> <td> <dl> <dt> <dd>`, plus the inline set |
| `why`, `beats[].text`, `summary`, `intent.goal`, `intent.design`, `intent.nonGoals[]`, `hotspots[].reason`, `moves[].hidden.what` | inline only: `<code> <kbd> <strong> <em> <sup> <sub> <span> <br>` |
| concept `page` | any complete HTML document; never sanitized; runs sandboxed and offline unless the step sets `"network": true` |
| concept `narration` | plain text, no tags |
| every `title`, `moves[].label`, `moves[].hidden.tag`, `storyScope.reviewerNote`, `landing.*` | plain text — no tags at all |

Allowed attributes: `class` on `<span> <code> <td> <th>` (one of `ds-bit`,
`ds-slot`, `ds-flag`, `ds-val`, `ds-warn`), `scope` on `<th>`,
`colspan`/`rowspan` (1-20), `data-lang` on `<pre>`. No links, images, SVG,
`id`, or `style`. Writing about a tag? Escape it: `&lt;script&gt;`. These
rules cover the prose fields only; a concept `page` is its own document.

**Every `<table>` needs a `<caption>`; a table without one is dropped.** The
caption is what the read-aloud voice speaks *in place of* the table, so write
it as the sentence you would say if the table were not there. Use a table only
when a bit layout, encoding map, or state transition is clearer as a grid.

Legacy concept steps (a `body` instead of a `page`) may carry a Mermaid
`diagram`. Keep it intact when repairing; if you must edit it, the legacy rules
still hold. It earns its place only when it materially clarifies three or more
actors/components, a real branch, or a state transition: `flowchart`, `sequenceDiagram`, or `stateDiagram-v2`; a caption is required.
No links, URLs, `click`/`href` directives, init/config directives, HTML, images, or custom styling directives.

## Schema

```jsonc
{
  "version": 4,
  "mode": "guided",
  "title": "Short title for the whole change — plain text, no tags",
  "summary": "1-3 short sentences: how the steps walk the implementation and where to slow down. The goal and designed flow live in intent, not here. Inline tags only, e.g. <code>settleFunding()</code>.",
  "intent": {
    "goal": "We wanted keepers to settle funding without one market's spike draining balances.",
    "design": "settleFunding() clamps through one shared _capRate() helper that reads each market's cap.",
    "sources": ["commit 41af8b7", "PR #12 body"],
    "nonGoals": ["Deliberately does not change settlement ordering; only the rate input is clamped."]
  },
  "storyArc": {
    "changeType": "bug-fix",
    "shape": "cause-effect",
    "readingPath": "failure trigger -> trust boundary -> fix -> proof"
  },
  "evolution": {
    "baseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "phases": [
      { "title": "Introduce the boundary", "summary": "The first commits place the guard at the shared decision point.", "firstCommit": "41af8b7", "lastCommit": "78c0d12", "relatedSteps": ["s1", "s2"] }
    ]
  },
  "hotspots": [
    { "step": "s2", "reason": "I matched the inclusive boundary to the docs but never exercised the exact-cap case." }
  ],
  "storyScope": {
    "includedFiles": ["contracts/Funding.sol", "contracts/lib/RateMath.sol"],
    "excludedFiles": ["test/Funding.t.sol"],
    "reviewerNote": "Pay extra attention to the cap guard.",
    "regenerated": [{ "files": ["abis/*.json"], "by": "npx hardhat export-abi" }]
  },
  "base": "main",
  "head": "feature-branch",
  "steps": [
    {
      "id": "s1",
      "order": 1,
      "title": "Entry point: settleFunding() clamps before settlement",
      "file": "contracts/Funding.sol",
      "range": [128, 132],
      "viewport": [120, 145],
      "highlights": [[120, 126], [128, 136]],
      "kind": "changed",
      "why": "Start here: the keeper reaches settleFunding() each epoch. I clamp the rate before settlement hands off to the math helper because the old path let over-cap values travel too far. Check that this happens before any balance mutation.",
      "beats": [
        { "text": "Start here: this is <code>settleFunding()</code>, the entry the keeper calls each epoch to settle one market.", "highlights": [[120, 126]] },
        { "text": "I clamp the rate before settlement hands off to the math helper, so over-cap values stop before balance mutation.", "highlights": [[128, 132]] },
        { "text": "The existing settlement call below still receives one chosen rate; check that the balance mutation stays after the clamp.", "highlights": [[133, 136]] }
      ],
      "landing": { "symbol": "settleFunding()", "role": { "who": "keeper" }, "when": "once per epoch" },
      "calls": ["s2"],
      "moves": [
        { "id": "extract-cap", "kind": "extracted", "before": { "file": "contracts/Funding.sol", "range": [129, 131] }, "after": { "file": "contracts/lib/RateMath.sol", "range": [40, 52] }, "label": "moved out" }
      ],
      "tags": ["entrypoint", "core"]
    },
    {
      "id": "concept-cap-model",
      "order": 2,
      "title": "How the per-market cap clamps a rate",
      "kind": "concept",
      "page": "<!doctype html><html><head><style>body{margin:0;padding:24px;font:14px system-ui;color:var(--ds-text)}output{display:block;margin-top:12px;color:var(--ds-accent)}</style></head><body><label>Proposed rate, bps <input type=\"range\" id=\"r\" min=\"0\" max=\"300\" value=\"80\"></label><output id=\"o\"></output><script>var r=document.getElementById('r'),o=document.getElementById('o'),cap=200;function f(){var v=+r.value;o.textContent=v>cap?'settles at the cap: '+cap+' bps (asked '+v+')':'settles unchanged: '+v+' bps'}r.oninput=f;f()</script></body></html>",
      "narration": "Drag the proposed rate. Up to this market's cap of 200 basis points it settles unchanged; past the cap it settles at exactly 200, which is the inclusive check the helper in step 3 owns.",
      "preparesFor": ["s2"],
      "tags": ["mental-model"]
    },
    {
      "id": "s2",
      "order": 3,
      "title": "Helper: _capRate() owns the boundary rule",
      "file": "contracts/lib/RateMath.sol",
      "range": [40, 58],
      "viewport": [40, 58],
      "highlights": [[40, 44], [48, 52]],
      "kind": "new-file",
      "why": "Pause here: settleFunding() lands here after choosing the market cap. I keep the helper small so both callers use the same inclusive boundary; the review focus is the require that makes the unchecked math safe.",
      "beats": [
        { "text": "Pause here: this is <code>_capRate()</code>, where <code>settleFunding()</code> lands right after choosing the market cap.", "highlights": [[40, 44]] },
        { "text": "The require is the review hinge because it makes the later unchecked math safe.", "highlights": [[48, 52]] }
      ],
      "landing": { "symbol": "_capRate()", "calledBy": ["settleFunding()"], "when": "once per market" },
      "calls": ["s3"],
      "returnsTo": "s1"
    },
    {
      "id": "s3",
      "order": 4,
      "title": "Existing marketConfig contract supplies the per-market cap",
      "file": "contracts/storage/MarketConfig.sol",
      "range": [88, 94],
      "viewport": [88, 94],
      "highlights": [[88, 94]],
      "kind": "context",
      "why": "Unchanged context: this is the storage contract _capRate() depends on.",
      "beats": [
        { "text": "Unchanged, but essential: this is the per-market config field <code>_capRate()</code> reads its cap from.", "highlights": [[88, 94]] }
      ],
      "returnsTo": "s2"
    }
  ]
}
```

Use `"mode": "brief"` for the shortest useful story and `"mode": "detailed"`
for the line-by-line correctness story. Omit `head` for working tree vs base.

## Attention weight

Every step may carry `"weight": "must"` (the default) or `"weight": "skim"`.
Mark a stop `skim` when a reviewer who trusts the surrounding must-read stops
can skip it without losing the thread: repeated instances past the first,
mechanical glue, already-familiar context. The rail collapses consecutive skim
stops into one disclosure, and a must-read-only walkthrough skips them in
keyboard order and narration. Weight never affects coverage — a skim stop
still claims and explains its ranges. Never mark the entry point, the
riskiest stop, or a hotspot's step as skim.

## Schema spot-check

Schema spot-check, especially on long stories. Long stories are where authors
drift into an abbreviated shape, and the app rejects the whole story over it.
Confirm, in order: top level has `title` and `summary`; every step has `id`,
`order` (a number — never omit it), `title`, `kind`; every code step has
`file`, `range`, `viewport`, `highlights`, `why`, `beats`; every new concept
step has `page` and `narration` and none of those code fields; a step with
`ranges` is a tagged changed/new-file sweep listing every full span and
containing `range`; a step with `files` names exactly one glob, carries a
skim/sweep/mechanical tag, and its own `file` matches the glob; every beat
has `text` (never `body`) and non-empty `highlights`. Those five — top-level
`title`, top-level `summary`, step `order`, beat `text`, beat `highlights` —
are the ones real stories lose first.

## Cross-file sweeps

One verified repeated mechanical pattern across files — the same import
rewritten in thirty files, the same key renamed in every locale file — is one
tagged sweep step with `"files": ["<one glob>"]`, e.g.
`"files": ["src/i18n/*.json"]`. The step's own `file`, `range`, viewport, and
beats show one representative instance; coverage claims every matched changed
file, and the checker verifies each matched file carries the same structural
edit — same hunks, same shape, values allowed to differ. Only the identical
edit qualifies: if two matched files changed differently, narrow the glob or
write separate steps. Never use a sweep to compress distinct decisions; it is
a coverage-preserving tool for the repetitive tail, not a general instruction
to make stories shorter.
