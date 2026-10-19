// Shared data shapes for codeStory.
//
// Two authored artifacts flow through the system:
//   - the *story* (story.json) — written by the AI, describes the reading order.
//   - the *comments* (comments.json) — written by the reviewer (via the server),
//     read back by the AI to close the loop.
// Everything else (diffs, snippets, coverage) is derived at render time.
export function isCodeStep(step) {
    return step.kind !== 'concept';
}
export function isPageConcept(step) {
    return step.kind === 'concept' && typeof step.page === 'string';
}
/**
 * Every changed span a code step claims for the coverage gate. `ranges` exists so
 * one step can honestly claim scattered edits (a rename across twenty call sites)
 * instead of forcing one step per hunk; without it, `range` alone is the claim.
 */
export function claimedRanges(step) {
    return step.ranges?.length ? step.ranges : [step.range];
}
