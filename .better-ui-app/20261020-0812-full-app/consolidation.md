# Consolidation (2026-10-20)

Raw findings in: 87 (A11Y 17, COL 10, COPY 18, EXP 8, LAY 8, MOT 7, TYP 9, VIS 10).
Every cited location was re-opened. All HIGH citations verified against current code and runtime.md captures.

## Merged (root cause kept once)
- COPY-1 -> EXP-1: same bare `Not found` fallthrough in src/server.ts (verified at src/server.ts:1540 in current numbering; lens cited 1480). EXP owns error-state existence and next step; COPY wording folded into the fix.
- LAY-2 -> A11Y-3: same RecentRepos branch span overflow (verified RecentRepos.tsx:110-114, runtime S2 overflowX=320). A11Y owns 320px clipping under trigger 5; LAY fix folded in.
- A11Y-8 -> EXP-3: same silent unknown-ref failure. EXP owns when the error appears; the aria-invalid/aria-describedby part of the A11Y fix folded into EXP-3.

## Dropped
- None. Weakest claims (MOT-3, MOT-4) stay as MEDIUM with Verified: no and a named confirmation step, per report rules for code-supported candidates.

## Handoffs routed
- LAY -> A11Y 320px change/review overflow: covered by LAY-1 (kept HIGH, trigger noted) and A11Y-3.
- COL -> A11Y focus pairs: COL-5 kept by COL (pair owner), A11Y-1 kept separately (missing indicator, different root).
- All other handoffs confirmed inside the owning lens file or noted in the report appendix.

## Line drift
- src/server.ts 404 fallthrough: lens 1480, current 1540. Report cites the verified line.

Distinct findings after merges: 84 (10 HIGH, 33 MEDIUM, 41 LOW). Main table holds 30 (all 10 HIGH plus 20 MEDIUM); the rest are in the appendix. All eight trigger HIGHs are in the main table.
