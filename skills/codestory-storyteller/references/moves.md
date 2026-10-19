# Semantic logic moves

Part of the codestory-storyteller skill. Read when logic moved, was extracted or inlined, or a guard was added or removed.

### 5.4. Record semantic logic moves

Record a move whenever logic changed home: `moved` to another file,
`extracted` into a helper, `inlined` from one, or relocated more than about 40
lines within a file. Reviewers keep asking "how was it before, and where did
it go?", and a cross-file move lets the app pair the old and new code side by
side.

Every other annotation, and every `hidden` callout, must pass the restraint
filter. Before adding one ask: **could the reviewer learn this by reading the
two columns?** If yes, write no annotation. Do not annotate a guard whose
condition and body are both visible, a call that replaced inline code with
both sides on screen, a rename, or a reformat. Do annotate: a branch with **no
code to read** (an unwritten `else`, a silent skip); a destination in a file
that is **not one of the two panes**; an ordering or dependency consequence
**no line states**; a region whose extent the diff colouring does not show.

Never use `flow` when a named verb fits.

| Kind | Meaning | Disambiguation rule |
| --- | --- | --- |
| `moved` | Same logic, new home (may be cross-file) | No call remains at the old site |
| `extracted` | Logic became a named function + a call site | A call *replaces* it at the old site |
| `inlined` | A call was replaced by its body | — |
| `wrapped` | Lines are now guarded by a new condition | The branch structure *grew* a gate |
| `unwrapped` | A guard was removed from these lines | — |
| `condition-changed` | Same branch shape, different predicate | Only the test changed |
| `reordered` | Blocks swapped execution order | Nothing added or removed |
| `flow` | Freeform labeled connection | Only when no verb fits; `label` required |

Each move is `{ "id", "kind", "before", "after", "label"?, "hidden"? }` with
endpoints `{ "file", "range" }`. `before.range` uses old/pre-change line numbers; `after.range`
uses post-change numbers. One endpoint file matches the step's `file`; ids are
unique in the step; at most 6 moves per step.

`label`: plain text on the box border, at most 24 characters (`now gated`,
`moved out`); omit it when it would restate the visible diff. `hidden` is the only field that produces a callout:
`{ "as": "path"|"destination"|"consequence", "tag": ≤48 chars plain, "what": ≤120 chars inline HTML }`
for the one fact with no line to point at. `destination` is valid only for a
cross-file move.

Cross-file moves pair the panes automatically: when `after` is this step's
file, the reviewer sees source on the left and destination on the right. Set
`pairedView` only to choose between several cross-file moves; if two compete,
split them into separate steps. Use a `destination` callout only as a fallback for a genuinely
secondary third file.

```jsonc
"moves": [
  {
    "id": "silent-cross-path",
    "kind": "wrapped",
    "before": { "file": "contracts/core/libraries/LibSettlement.sol", "range": [251, 254] },
    "after": { "file": "contracts/core/libraries/LibSettlement.sol", "range": [244, 260] },
    "label": "now gated",
    "hidden": { "as": "path", "tag": "no else branch exists", "what": "cross-party settlement now <code>skips</code> this debit entirely" }
  }
]
```
