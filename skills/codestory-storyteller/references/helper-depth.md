# Important helpers: overview, decision, consequence

Part of the codestory-storyteller skill. Apply to both code stories and diff
stories when a helper contains a decision the reader needs to understand.

## Spend depth where behavior depends on it

Give the reader a general pass through the enclosing function first. Then
open the helpers that own authorization, money movement, replay protection,
timelocks, state transitions, external calls, or surprising branches. Naming
a responsibility ("checks the route", "validates the signature") is not an
explanation of that decision. Read the actual helper and its consumers.

For each important helper, the normal reading path must teach:

1. What enters it and why the caller needs this decision here.
2. The meaningful branches: what passes, what rejects, and which rule decides.
3. Why the rule exists, supported by source or tests. Label an inference;
   never invent a security rationale.
4. What returns or changes, and the exact caller behavior it controls next.

Use separate local stops for separate decisions, retaining the existing beat
and viewport limits. Return to a caller stop that demonstrates the consequence
when the result changes later execution. Include a concrete accepted/rejected
case when it clarifies a subtle boundary. Do not recursively tour mechanical
helpers, getters, syntax, or every leaf of a call graph.

Core explanations belong in ordinary `beats[].text` and their real-source
highlights. They must be heard in normal playback and video exports, without
requiring a click, hover, or expandable note. Supporting detail may be `skim`;
the important decision stays `must` (the default).

## Keep caller and helper visible together

On a helper's code step in version 4, use `callSite` to keep the actual call
visible beside the helper. This works across files and within one file:

```json
"callSite": {
  "step": "execute-overview",
  "range": [432, 432],
  "viewport": [425, 439]
}
```

- `step` is an earlier **code** step, never this step or a concept.
- `range` identifies the actual invocation in that caller's file (1-12 lines).
- Optional `viewport` crops the caller; absent means its existing viewport.
  Both spans must stay inside the caller step's viewport, and `range` must
  stay inside this optional crop. Expand the earlier caller stop if necessary.
- If `returnsTo` is also supplied, it must equal `callSite.step`. The return
  button restores the caller's previous beat and scroll position when visited.
- The helper's `file`, `range`, `viewport`, and highlights still describe only
  the helper. Caller context never claims extra diff coverage and never
  substitutes for the helper's own beats.
- Both panes read the same story revision. This is an author-selected source
  relationship, not a runtime trace or proof of reachability. Inspect the
  cited invocation rather than inferring it from similar names.
- Use `callSite` for invocation context. `moves` / `pairedView` describe
  before/after code relationships and are not substitutes for this field.

For the gateway example, explain `_requireRelayable()`'s common checks and
wallet, self-call, and external-target branches, then return to the use of
`timelocked` in `_executeCall()`. Distinguish classification from later
approver-policy and schedule-readiness checks. Do not compress the whole
helper into "checks the route and determines whether a timelock is needed."

## Before finishing

Read the story as a listener: after the overview names an important helper,
could the reader explain its decision and the consequence without opening an
editor? If not, add the missing local explanation. Check every call-site crop
against the actual source at the story's revision, then run the bundled checker.
