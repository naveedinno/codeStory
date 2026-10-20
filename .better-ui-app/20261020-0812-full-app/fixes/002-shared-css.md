# 002: Fix shared stylesheet focus, scrim, weights and menu exits
- Findings: COL-5, A11Y-14, TYP-3 (shared.css part), MOT-6 (shared part), COL-7 (shared part)
- Severity: MEDIUM
- Wave: 1
- Owned files: client/shared/shared.css, client/styles.css

## Problem
Read COL-5, A11Y-14, MOT-6 in lenses/color.md, lenses/accessibility.md, lenses/motion.md. Theme/editor focus rings use only accent-soft (~1.2:1); .ds-scrim lacks overscroll-behavior; font-weight 650/750 unloaded; menus animate in with keyframes and vanish with no exit.

## Target
1. Replace soft-only focus box-shadows on theme/editor toggles with box-shadow: var(--shadow-focus).
2. Add overscroll-behavior: contain to .ds-scrim.
3. Change font-weight 650 -> 600 and 750 -> 700 (loaded weights only).
4. Add a short exit: on menu close keep it simple and safe - add transition-based fade using existing tokens only if the existing hidden toggling supports it without JS changes; if not achievable in CSS alone, leave entrances and record that in your reply (do not invent JS here, JS lives in plan 003).
5. In client/styles.css keep the forced-colors focus rule; no other change there in this plan.

## Repo conventions
shared.css header: only keyframes, pseudo-elements and asserted timings belong here; values must stay comparable with test/motion-regressions.test.mjs. Check that test after editing; update its expectations only where a value above intentionally changed.

## Boundaries
- Owned files only. Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client; node --test test/motion-regressions.test.mjs (if present in test/)
- Done when: checks pass or failures are reported with exact output.
