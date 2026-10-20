# 011: Fix stories surface
- Findings: COPY-2, COPY-5, EXP-5, EXP-8, A11Y-6 (dialog part), A11Y-13, TYP-4 (stories part), COPY-16, LAY-6 (stories part), VIS-3 (story hover part), A11Y-12 (stories part)
- Severity: MEDIUM
- Wave: 2
- Owned files: client/surfaces/stories/StoriesApp.tsx, client/surfaces/stories/StoryRow.tsx, client/surfaces/stories/StoryHistory.tsx, client/surfaces/stories/RemoveStoryDialog.tsx, client/surfaces/stories/story-state.ts

## Problem
Read these IDs in lenses/copy.md, lenses/experience.md, lenses/accessibility.md, lenses/typography.md, lenses/layout.md, lenses/visual.md. One queued item is called note and comment; row tooltip says Remove review while dialog says Remove story; history load error has no retry; removal success is sr-only; dialog buttons disable under focus; hidden file input has aria-hidden while focusable; history link text is bare Open; stories header pairs hairline with 22px gaps.

## Target
1. Use "comment" as the noun everywhere in these files (badge detail counted form, header counts, row fact, queue remove confirmation in engine is plan 014; here fix story-state/StoriesApp/StoryRow strings). Keep Note only as composer kind label (not in these files).
2. StoryRow tooltip -> "Remove story".
3. StoryHistory: extract load into a callback; error branch gains a Try again ghost button re-running it. Earlier-version link text -> "Open this version".
4. StoriesApp: visible polite StatusToast-style confirmation for removal (reuse local pattern, keep sr-only status too). Move file input aria-hidden off (keep ds-sr-only + tabIndex -1).
5. RemoveStoryDialog: while busy keep the focused button focusable (drop disabled on the focused control, use aria-disabled styling) or move focus to the dialog heading at busy start; implement the simpler of the two that typechecks.
6. Truncated story/version titles wrapped in shared Tooltip with full string.
7. StoriesApp header: drop border-b, keep spacing (LAY-6). StoryRow hover shadow -> token shadow var(--shadow) family only if trivially swappable, else leave and report.
8. Decorative Lucide icons aria-hidden="true".

## Boundaries
- Owned files only. Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client; node --test test/story-picker.test.mjs
- Done when: checks pass.
