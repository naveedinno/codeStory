# Motion recheck

Mode: quick regression review, with dispositions for every original finding, including LOW craft findings. Source read-only. Reviewed the original brief and motion findings, Motion lens rules, mobile-web Motion section, final relevant source and `fixes/runtime-recheck.md`.

Score: **4/4 for the inspected scope**. Remaining findings: **0 HIGH, 0 MEDIUM, 0 LOW**. Original findings: **7 addressed in source**. This is a source and recorded-scenario disposition; motion smoothness, reversal feel and coordination remain **Not verified** until the main agent's normal-speed/slowed interaction recordings are available and reviewed. A high source-review score does not verify those gaps.

## Original dispositions

| ID | Status | Final evidence | Runtime boundary |
|---|---|---|---|
| MOT-1 | Addressed | `client/surfaces/review/review.css:1644`–1646 explicitly disable transitions on all six reported carets under reduced motion. Open-state rotations remain, preserving static disclosure state. `fixes/runtime-recheck.md` reports actual reduced-motion media and two rendered caret transition durations of `0s`. | The two measured carets have runtime support; all six selectors have source support. Do not claim all six were individually exercised. |
| MOT-2 | Addressed | `client/shared/use-modal.ts:38` sets `MODAL_CLOSE_MS = 340`, matching the spatial duration at `src/theme.ts:181`. `client/shared/shared.css:162` now delays scrim visibility hiding by the same spatial tier. Reduced motion retains the zero-delay/no-transition path, and reopening still cancels pending close. | Dismiss-during-entry/reopen feel still needs a recording. Scrim/sheet opacity intentionally complete at the faster UI tier; the visibility and hidden lifecycle no longer truncate the spatial transition. |
| MOT-3 | Addressed | `client/surfaces/review/review.css:1638`–1642 give step transitions the 150ms fast tier in both View Transition and fallback paths. `client/surfaces/review/engine/review-engine.js:674`–678 set and clear `data-ds-enter-kind` and derive the fallback timeout from the same duration. Reduced motion still bypasses workspace animation. | Normal-speed rapid stepping and slowed reversal replay remain unverified. The shared fade keyframes retain a very small scale change (0.3%); this is not an established feel issue. |
| MOT-4 | Addressed | `client/surfaces/review/review.css:902` uses the 250ms progress tier for the line and dashed trace; head/tag timing is 100ms delay + 150ms duration, also ending at 250ms. Reduced motion disables animation and :1646 renders the finished annotation immediately. | Keyframes still restart, but the selected original fix explicitly allowed shortening the sequence, which is now implemented. Rapid annotated stepping has not been judged from a recording here. |
| MOT-5 | Addressed | `client/surfaces/review/review.css:1528` no longer transitions width and uses shared motion curves for remaining properties. Active/loading/paused widths now snap. | No performance or perceived-feel claim from source. |
| MOT-6 | Addressed | `client/shared/shared.css:532`–571 adds 200ms entry/150ms exit transitions and `@starting-style` for theme/editor menus on supported browsers, with inert/aria-hidden on closed React menus. `client/surfaces/review/review.css:1658`–1664 adds details transition rules for story tuning, file filters and the new File menu. Both `.ds-filefilter-menu[open] .ds-filefilters` and `.ds-review-file-menu[open]>[role=menu]` now explicitly receive `animation:none` at the same specificity as their earlier keyframe entrances. Their open-state transitions and starting styles win by source order. Moving child transitions and keyframes are suppressed under reduced motion. | The previous review's specificity and missing-File-menu gaps are closed. Slowed rapid-toggle recordings and target-browser `::details-content` support remain runtime coverage gaps. Explicit older-browser keyframe fallback is accepted graceful degradation. |
| MOT-7 | Addressed | The reported resizer, tab, caret, step-card and intro action durations use canonical tiers/curves. `client/surfaces/review/review.css:809` now gives both toast opacity and transform legs `var(--motion-ease-out)`; the previously reported bare easing is gone. | Token consolidation is directly verifiable from source; no motion-feel claim is required for this disposition. |

## Findings

None established in the inspected final source. No HIGH/MEDIUM regression or remaining original LOW craft defect was found.

## Other review outcomes

- The milestone recommendation was adopted: `client/surfaces/progress/Milestones.tsx:63` uses `--motion-duration-progress` (250ms) with reduced-motion suppression retained.
- The light-theme `.ds-tab::after` transform transition was considered as a reduced-motion omission, then rejected for actual review chrome because `client/surfaces/review/review.css:1493` hides that pseudo-element.
- Parent-reported new interaction recordings are in progress. This report does not imply they were watched before they exist.

## Verification limits

`fixes/runtime-recheck.md` records desktop Chromium emulation, no page errors, actual reduced-motion media and the two `0s` caret measurements. The screenshots show settled state; they cannot establish smoothness, interruption feel or timing coordination.

Not verified by this lens: normal-speed/slowed recordings of modal interruption, rapid workspace/fallback navigation, repeated annotated steps and rapid menu reversal; browser-support coverage for `::details-content`; frame rate or jank under load; split-divider dragging; physical-device touch cancellation; mobile browser behavior. No hardware or frame-rate claim is made. The app is desktop-first and does not claim installed mobile mode.
