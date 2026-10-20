# 012: Fix change surface
- Findings: LAY-1 (ChangeApp part), EXP-3 (+A11Y-8), EXP-6, COPY-10 (refs part), COPY-11 (ref part), COPY-12 (change label part), VIS-1 (change part), VIS-4 (change part), VIS-8 (FileSummary part), VIS-10 (change part), LAY-3 (change part), LAY-4, LAY-5, LAY-7 (change part)
- Severity: HIGH
- Wave: 2
- Owned files: client/surfaces/change/ChangeApp.tsx, client/surfaces/change/ScopeCard.tsx, client/surfaces/change/RefPicker.tsx, client/surfaces/change/FileSummary.tsx, client/surfaces/change/refs.ts

## Problem
Read these IDs in lenses/layout.md, lenses/experience.md, lenses/copy.md, lenses/visual.md. Nav right slot overflows (fix: collapse History label under 560px, mirroring Reload label treatment); unknown ref silently ignored; scope navigation has no busy feedback; editor stacks at 700px while summary tightens at 600px and both read viewport; basename cannot shrink; islands use border-transparent; segment radii not concentric (18px track p-1 -> inner 14px); primary pill 34px (user choice: page primaries 40px); Retry vs Try again; physical border-l/text-right in these files.

## Target
1. ChangeApp: History link text -> "Review history", hide its text under 560px (icon/label collapse idiom already used for Reload). Metric divider border-l -> border-s.
2. ScopeCard/RefPicker: on blur or Enter with non-empty unmatched text, show inline error under the slot, set aria-invalid="true" and aria-describedby to it, keep typed text. Listbox empty text -> `No refs match "{q}". Try a branch name, tag, or commit.`
3. ScopeCard scheduleNavTo: set busy state (disable segments, show existing Loader idiom) before location assignment.
4. Align ref grid breaks: stack summary at the same step as editors; prefer @container on the ScopeCard section converting the 700/600 viewport variants to container variants (Tailwind v4 @max-[...]:). If container conversion fails typecheck/build, fall back to one shared 700px viewport break and report that.
5. FileSummary: basename span -> min-w-0 flex-[0_1_auto] truncate; text-right -> text-end; Review files pill -> h-[var(--control-h-lg)] and trailing-icon padding ps-[15px] pe-[13px]; card padding px-[15px] py-[9px] -> px-4 py-2.
6. Islands in ScopeCard/FileSummary: border-transparent -> border-line-soft (keep contrast-more). Segment inner radius -> calc(var(--radius-lg) - 4px) via arbitrary value rounded-[calc(var(--radius-lg)-4px)].
7. refs.ts recovery label Retry -> Try again.

## Boundaries
- Owned files only. Stop and report on mismatch.

## Verification
- Commands: npm run typecheck:client; node --test test/change-page.test.mjs test/change-route.test.mjs
- Look: 375px change capture scenario; long basename case.
- Done when: checks pass.
