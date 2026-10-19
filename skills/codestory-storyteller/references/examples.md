# Worked examples

Part of the codestory-storyteller skill. Read once per session, before your first story.

### 3.6. What good looks like: the same diff, told twice

One small diff: `settleFunding()` in `Funding.sol` gains a clamp, a new
`_capRate()` helper lands in `RateMath.sol`, and `RateMath.t.sol` gets a test.

**The changelog (do not write this).** File order, diff-restating beats:

```text
1. "Update Funding.sol"       — why: "Adds a cap check to settleFunding()."
2. "Add RateMath.sol helper"  — why: "Adds a _capRate() helper for clamping."
3. "Add tests"                — why: "Adds tests for the new helper."
```

Every hunk covered, every gate passed, and the reviewer learned nothing the diff
did not already say. The real hinge — can an unclamped rate still reach
balances? — is never named.

**The story (write this).** Same three stops, ordered by the runtime path, each
beat picking up what the previous stop established:

```text
1. "Entry: settleFunding() clamps before balances move"
   beat: "Start here: this is settleFunding(), the path the keeper hits each
          epoch, and the old code handed the raw rate straight to settlement."
   beat: "Now the rate passes through _capRate() first — the review hinge is
          that this happens before any balance mutation."
2. "Helper: _capRate() owns the inclusive boundary"
   beat: "This is _capRate(), where settleFunding() just sent us; the cap is
          inclusive, so rate == cap must pass."
3. "Proof: the boundary test pins rate == cap"
   beat: "Final proof: testCapIsInclusive drives settleFunding() at the exact
          cap and fails if the boundary flips to exclusive — it guards the
          hinge from step 2."
```

The difference is not length or polish: each stop exists because of the
previous one, each first beat says whose code this is, and
each beat names the failure its evidence rules out.

## Beats before and after

```text
BAD  (one beat, three decisions, pure inventory)
  "Line 742 makes .ds-main transparent; line 747 anchors ghost cards to
   calc(50% - 440px - 66px) instead of a fixed 6px; line 751 gives the active
   step a background, border, and radius."
```

```text
GOOD  (three beats, each one decision ending in its consequence)
  beat 1: "This is `.ds-main`, the page surface every review step is laid
           on. It goes transparent first — without this the step below would
           be a card sitting on another card, and the island edge would never
           read as an edge."
  beat 2: "Now the step gets its own surface and radius, so it floats as the
           bounded 880px island the mockup asks for."
  beat 3: "The ghosts have to follow that new edge, so they anchor off the
           island's half-width rather than the viewport — this is the number
           to check, since it assumes a 66px gutter clears them."
```

Same lines, same coverage. The first beat says whose code this is before
anything moves, each beat hands off to the next, and the last aims attention at
the thing most likely to be wrong.

```text
BAD  (a landing bolted onto an old beat, 50 words, line numbers as filler)
  "We are starting in relayBatch. The relayer calls this function. This is the
   entrance to the execution flow. Look at lines 17 through 22. The batch now
   carries wallet ids. Keep that routing decision in mind as we read the new
   walletIds argument."
```

```text
GOOD  (one complete landing clause, then the change and what it unlocks)
  "This is `relayBatch()` in `BatchRelay.sol`, what the relayer calls under
   `RELAYER_ROLE` once per signed batch; it now takes `walletIds`, so one
   signature can move funds for several wallets."
```

```text
BAD  (a label, not a landing: no caller, a vague population)
  "This is review-state.ts, the module every review page reaches for before
   rendering."
```

```text
GOOD  (symbol, file, caller by name, when)
  "This is `reviewStateSummary()` in `review-state.ts`, the helper
   `renderReview()` and `diffScreen()` call on every page load to bind the
   page, story, and notes to one exact diff."
```

The listener should be able to say, after the first beat and without looking:
which function I am in, which file, who calls it, and when.

```text
BAD  (the same sentence pasted into many steps)
  s12: "Now that the previous boundary is visible, inspect this decision."
  s13: "Now that the previous boundary is visible, inspect this decision."
```

A repeated edit is one sweep step that narrates one instance and claims the
rest with top-level `ranges`. Distinct decisions each get a sentence about
their own evidence.

## Passages worth imitating

Adapted from real stories; the shape is the lesson.

- **Intent that opens on the problem:** "A trader holding large unrealized
  profit could withdraw real collateral down to the floor recorded when each
  position opened, leaving an open position backed only by paper gains; on a
  reversal, the counterparty absorbs the gap."
- **Seam and landing in one sentence:** "That closes the wrapper: from here
  `msg.sender` is the operator and we are inside the execution layer. This is
  where the change starts: one decision, taken once per batch, opens either the
  transaction-scoped context or the deployed setter sequence."
- **The road not taken:** "The floor rides in the same signed struct as the
  profit figure by design: splitting them across two signatures would let a
  caller pair a fresh profit with a stale floor and walk straight back into the
  bug."
- **A consequence, not a caption:** "With zero stopped before
  `_claimUnlocked()`, a rounded-down flow cannot be advanced merely by asking to
  claim nothing." And the next concern's seam: "That settles the zero-claim
  path; the second concern starts here, where the setter now names both states
  that consume a user's cap slot."
- **A hotspot that names the doubt:** "The archive decoder is hand-packed:
  every field needs an offset and a shift that agree with the encoder, and a
  mismatch does not revert — it rebuilds a plausible but wrong record. I traced
  all seventeen offsets by hand, but no test proves it, and the narrow tail is
  where an off-by-one would hide."
- **A sweep beat that still connects:** "Settlement is one of the operations
  that legitimately bumps the counter, so seeing it read the value under the
  new name here is the consistency check worth making."

## A test stop

For tests:

```text
Beat 1: Final proof: `test_rejects_over_cap_order` drives `placeOrder()` the way the client does and pins the failure mode from the entry point.
Beat 2: It fails if an over-cap order can reach placement again, so it guards the behavior above.
```

Attention cues (`Start here`, `Pause here`, `Skim this`, `Check this
invariant`, `Final proof`) help scanning when they feel natural. The story's
last beat says what is now guaranteed, not a recap.
