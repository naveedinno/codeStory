# 016: Amend design memory and guard the fixed pairs
- Findings: VIS-5, TYP-8, COPY-18, LAY-7 (doc/token naming part), VIS-7 (doc part)
- Severity: LOW
- Wave: 2 (after 001 lands; run last)
- Owned files: DESIGN_MEMORY.md, client/surfaces/review/format.ts, client/surfaces/change/format.ts, test/theme.test.mjs (only if 001 did not already extend it)

## Problem
DESIGN_MEMORY documents 16px islands and 6/9/12 controls while shipped tokens are 26px islands and 8/12/18 controls. User choice: keep shipped geometry, fix the document. Hashes lack slashed-zero; counts lack locale grouping. Error voice mixes Could not with contractions (surface strings live in plans 010-015; here only grep and list any remaining contractions in owned scope - do not edit other plans' files).

## Target
1. DESIGN_MEMORY.md: record --radius-island 26px, controls 8/12/18, page primaries at --control-h-lg (40px) and bar/card actions at --control-h (34px), icon stroke rule weight-matched (semibold-adjacent Lucide 2, small rail glyphs 1.25) replacing the 1.5 note.
2. format.ts helpers: add slashed-zero utility class usage where hashes render (font-mono slashed-zero via Tailwind arbitrary [font-variant-numeric:slashed-zero] only if already idiomatic; otherwise export a HASH_CLASS constant), and Intl.NumberFormat grouping for counts >= 10000 in the existing helpers without changing small-count output.
3. If test/theme.test.mjs lacks emphasis-pair assertions after plan 001, add them.

## Boundaries
- Owned files only. Run after wave 1. Stop and report on mismatch.

## Verification
- Commands: node --test test/theme.test.mjs; npm run typecheck:client
- Done when: checks pass.
