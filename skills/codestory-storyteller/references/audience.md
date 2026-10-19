# Writing for the audience

The prompt or `.codestory/preferences.json` names who the story is for:
`"audience": "newcomer"` (the default) or `"audience": "familiar"`. The
audience changes how much guidance each stop carries — never the coverage,
the schema, or the landing completeness the checker verifies.

## Newcomer (default)

Assume the reviewer remembers the requested outcome but not the app
internals. This is the skill's normal voice, unchanged:

- Complete landings: symbol in `<code>`, file or module on a camera change,
  callers by name, and when.
- Reviewer-map questions ("what is a single close?") answered where first
  needed: a clause in a landing, a `context` step, or a concept primer.
- Primer budgets from the Detail levels section apply in full.

## Familiar

The reviewer knows this codebase. Guidance that helps a newcomer costs them
attention, so compress it — but never skip it:

- Terse landings: symbol plus file. Name the caller only when it is
  surprising (an unexpected entry point, a new call edge this change adds).
  The `landing` field stays complete — the app shows it and the checker
  verifies it — while the spoken beat stays short.
- No "what is X" clauses for concepts the codebase already uses. If the
  change itself introduces the idea, the primer budget still applies; if the
  idea predates the change, one naming clause is enough ("the existing
  uncapped path").
- Each `why` limited to what a familiar reviewer would verify: the boundary,
  the invariant, the risk. No re-derivation of settled design.
- Hotspots and verification do not shrink: doubt is audience-independent.

When unsure whether the reader knows a concept, write the newcomer clause.
An unneeded sentence costs less than a stopped review.
