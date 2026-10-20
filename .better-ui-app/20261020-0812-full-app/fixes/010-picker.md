# 010: Fix picker surface
- Findings: A11Y-3, EXP-4, A11Y-4, A11Y-16, A11Y-11, A11Y-12 (picker part), COPY-11 (folder part), COPY-15 (picker part), COPY-17, VIS-2, VIS-10 (picker part), TYP-3 (wordmark part), TYP-4 (folder part), EXP-7, LAY-7 (picker part), VIS-7 (folder icon part)
- Severity: HIGH
- Wave: 2
- Owned files: client/surfaces/picker/PickerApp.tsx, client/surfaces/picker/RecentRepos.tsx, client/surfaces/picker/FolderBrowser.tsx, client/surfaces/picker/Hero.tsx, client/surfaces/picker/SkillBanner.tsx

## Problem
Read the findings with these IDs in lenses/accessibility.md, lenses/experience.md, lenses/copy.md, lenses/visual.md, lenses/typography.md under .better-ui-app/20261020-0812-full-app/. Key code: RecentRepos branch span cannot shrink (line ~112); missing rows still open and retry the same open; PickerApp main has no id and no SkipLink; Hero h1 is the wordmark; folder crumb targets ~21px; masthead thread loop encloses empty space; Add repository pill is 34px while page primaries settle at 40px (user choice: page primaries 40px).

## Target
1. RecentRepos: branch span gets min-w-0 max-w-full, icon flex-none, inner span min-w-0 truncate. For !row.isGit rows disable the open action and make Remove the primary row action; PickerApp: do not offer open retry for non-git failures (branch on error kind).
2. PickerApp: render SkipLink, main id="main-content" tabIndex={-1}; promote Repositories to h1, Hero wordmark becomes a plain span (keep classes/appearance). Visible StatusToast stays; after dismiss, keep a quiet Restore action for the most recent removal while undo payload is held (EXP-7).
3. FolderBrowser: crumb buttons get hit expansion to 24px (after:-inset-1 pattern already in file); empty filter text becomes `No folders match "{q}". Clear the filter to see every folder.`; visible loading rows read Loading folders…
4. Hero: shorten the thread backdrop so it passes behind the lockup and exits open (edit Hero usage or brand path prop available locally; do not edit client/shared/brand.tsx in this plan - if the path constant lives there, instead crop via viewBox/class in Hero). Wordmark weight: Space Grotesk 500 (font-medium) not 400.
5. SkillBanner: rename to "storyteller skill" wording and match the manual fix sentence used in Explain (see plan 015 target text: "Run scripts/install-skills.sh from a codeStory clone, or re-run the codeStory installer."). Pick that exact sentence in both plans.
6. All decorative Lucide icons in these files get aria-hidden="true". Folder icon strokeWidth 2. Add repository pill height -> h-[var(--control-h-lg)].
7. Wrap truncated folder names in the shared Tooltip pattern already used in RecentRepos.

## Boundaries
- Owned files only. Stop and report on mismatch. No dependencies.

## Verification
- Commands: npm run typecheck:client; node --test test/picker.test.mjs test/recents.test.mjs
- Look: ordinary recents plus long-name stress (runtime scenario S2).
- Done when: checks pass; overflow fix present in code.
