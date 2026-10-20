# 001: Fix canonical color and type tokens
- Findings: COL-2, COL-6, COL-9 (doc part), TYP-7, TYP-8 (token part)
- Severity: HIGH
- Wave: 1
- Owned files: src/theme.ts, scripts/build-theme-css.mjs, test/theme.test.mjs

## Problem
Read the COL-2, COL-6, TYP-7 findings verbatim in .better-ui-app/20261020-0812-full-app/lenses/color.md and lenses/typography.md. Light theme never redefines --add-emphasis-bg/--del-emphasis-bg so syntax ink fails on emphasis tints in both themes; no prefers-contrast block exists in sharedTokens(); type tokens are px so a larger root font size cannot grow text.

## Target
1. In sharedTokens() light block add lighter --add-emphasis-bg/--del-emphasis-bg and tune dark emphasis (lower alpha or darken) so every --tk-* and --text measures >=4.5:1 on both emphasis composites in both themes. Keep hues, change lightness/alpha only. Verify with the contrastRatio helper pattern in test/theme.test.mjs:44.
2. Add one @media (prefers-contrast: more) block in sharedTokens() widening --text/--text-2/--line and moving accent/add/amber inks to darkest steps.
3. Convert --text-* size tokens from px to rem (value/16, e.g. 10px -> .625rem, 13px -> .8125rem, 56px -> 3.5rem). Leave spacing, radii, borders in px.
4. In scripts/build-theme-css.mjs mark shadcn alias names vendor-only in the section comment and name --color-text/--color-surface/--color-bg/--color-accent as first-party. No rename of emitted vars.
5. Extend test/theme.test.mjs: assert tk pairs on emphasis composites >=4.5 both themes, and assert type tokens are rem. Update any existing assertion that pinned px token strings to the new rem values.

## Repo conventions
Tokens live only in src/theme.ts sharedTokens(); client/generated/theme.css is generated, never hand-edit. Regenerate with node scripts/build-theme-css.mjs.

## Steps
Edit, regenerate, run node --test test/theme.test.mjs, iterate ratios until green.

## Boundaries
- Edit only owned files. No dependencies. If code differs from Problem, stop and report.

## Verification
- Commands: node scripts/build-theme-css.mjs; node --test test/theme.test.mjs
- Done when: theme tests pass with the new emphasis and rem assertions.
