// Which story the reviewer last opened in each repo, so restarting the app resumes
// the story they were reading instead of the first one in the list.
//
// This lives in the global ~/.codestory/ store, never in the repo's own .codestory/.
// The selection is a personal UI preference: a per-repo file would dirty git status,
// and under the 'shared' gitignore mode — where only comments.json is ignored — it
// would be committed and travel with the PR.
//
// The pure reducers (rememberSelection / forgetSelection) are unit-tested; the FS
// wrappers take `home` so tests can point at a temp dir, matching recents.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './config.js';
const DEFAULT_CAP = 40;
/** Path to the global selection file under a given home directory. */
export function storySelectionFile(home) {
    return join(home, DATA_DIR, 'story-selection.json');
}
/** Pure: record `repo`'s selection, pruning the oldest entries past `cap`. */
export function rememberSelection(selections, repo, story, now, cap = DEFAULT_CAP) {
    const next = { ...selections, [repo]: { story, at: now } };
    const paths = Object.keys(next);
    if (paths.length <= cap)
        return next;
    const keep = paths.sort((a, b) => next[b].at - next[a].at).slice(0, cap);
    return Object.fromEntries(keep.map((p) => [p, next[p]]));
}
/** Pure: drop `repo`'s selection. */
export function forgetSelection(selections, repo) {
    const { [repo]: _dropped, ...rest } = selections;
    return rest;
}
/** Read the selections; tolerate a missing or corrupt file by returning {}. */
export function loadStorySelections(home) {
    const file = storySelectionFile(home);
    if (!existsSync(file))
        return {};
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const repos = parsed.repos;
        if (!repos || typeof repos !== 'object' || Array.isArray(repos))
            return {};
        const out = {};
        for (const [repo, value] of Object.entries(repos)) {
            if (!value || typeof value !== 'object')
                continue;
            const { story, at } = value;
            if (typeof story !== 'string' || !story)
                continue;
            out[repo] = { story, at: typeof at === 'number' ? at : 0 };
        }
        return out;
    }
    catch {
        return {};
    }
}
/** Write the selections, creating ~/.codestory/ if needed. Never throws on a read-only home. */
export function saveStorySelections(home, selections) {
    const file = storySelectionFile(home);
    try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ version: 1, repos: selections }, null, 2) + '\n', 'utf8');
    }
    catch {
        // A remembered selection is a convenience; losing it must never break the review.
    }
}
/** The story id this repo was last reviewing, or null when nothing is remembered. */
export function recallStorySelection(home, repo) {
    return loadStorySelections(home)[repo]?.story ?? null;
}
/** Persist `repo`'s selection; `null` forgets it. */
export function recordStorySelection(home, repo, story, now) {
    const current = loadStorySelections(home);
    const next = story === null
        ? forgetSelection(current, repo)
        : rememberSelection(current, repo, story, now);
    saveStorySelections(home, next);
}
