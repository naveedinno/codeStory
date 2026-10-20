# 003: Fix shared chrome behaviour
- Findings: A11Y-5, MOT-2, A11Y-6 (use-modal part), TYP-4 (nav crumb part), COPY-12 (nav label part), VIS-7 (editor-menu part)
- Severity: MEDIUM
- Wave: 1
- Owned files: client/shared/nav.tsx, client/shared/theme-menu.tsx, client/shared/editor-menu.tsx, client/shared/use-modal.ts

## Problem
Read A11Y-5, A11Y-6, MOT-2, COPY-12 in the lens files under .better-ui-app/20261020-0812-full-app/lenses/. ThemeMenu does not close on Tab (EditorMenu does at its Tab branch); MODAL_CLOSE_MS is 210 while the sheet slide is 340ms; use-modal restore calls focus() with no document.contains guard; nav wordmark aria-label "Home" differs from its title; nav crumb truncation relies on native title.

## Target
1. theme-menu.tsx: add Tab branch calling close(false) without preventDefault, mirroring editor-menu.
2. use-modal.ts: MODAL_CLOSE_MS 210 -> 340 (keep prefersReducedMotion ? 0 branch); guard restore with document.contains(restore) and fall back to focusing the dialog root.
3. nav.tsx: wordmark aria-label -> "Home — your repositories". Wrap truncated crumb text in the shared Tooltip used elsewhere if already imported in this file's idiom; otherwise keep title but add the full label via Tooltip component from the beUI vendor path used in RecentRepos. Do not break crumb layout.
4. editor-menu.tsx: set Code2 strokeWidth to 2 (VIS-7 pairing).

## Repo conventions
Follow existing patterns in the same files. Focus restore exemplar: review engine checks document.contains.

## Boundaries
- Owned files only. Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client
- Done when: typecheck passes.
