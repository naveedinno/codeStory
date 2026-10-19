import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { DATA_DIR, LEGACY_STORY_FILENAME, STORY_FILENAME, dataDir } from './config.js';
import { HISTORY_DIRNAME, snapshotStoryIfChanged } from './story-history.js';
import { loadTour } from './tour.js';
import { getDiff, resolveBase } from './git.js';
import { parseUnifiedDiff } from './diff.js';
import { loadComments } from './comments.js';
import { isCodeStep } from './types.js';
import { inspectStoryDrift } from './story-drift.js';
import { codeStoryDrift, codeStoryFiles, codeStoryScope } from './code-story.js';
import { isCodeStory } from './tour.js';
import { commentsForStory } from './comments.js';
const NAMED_STORIES_DIR = 'stories';
/** Stories saved for a repo, in the order the app should present them. */
export function listStories(repo) {
    return storyIds(repo)
        .map((id) => storySummary(repo, id, true))
        .filter((s) => s !== null)
        .sort(newestStoryFirst);
}
/** Story cards for navigation. Authored metadata remains exact, while live
 * diff/drift evidence waits until the story itself is opened. */
export function listStoryMetadata(repo) {
    return storyIds(repo)
        .map((id) => storySummary(repo, id, false))
        .filter((s) => s !== null)
        .sort(newestStoryFirst);
}
function newestStoryFirst(a, b) {
    return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}
/** Resolve a story id from listStories() back to a real path, or null if it is not known. */
export function storyPathForId(repo, id) {
    const primary = id === STORY_FILENAME || id === LEGACY_STORY_FILENAME;
    const named = id.startsWith(`${NAMED_STORIES_DIR}/`) && id.endsWith('.json');
    // History snapshots resolve so an old version opens read-only in review;
    // they never appear in listStories() and every mutation route rejects them.
    const history = id.startsWith(`${HISTORY_DIRNAME}/`) && id.endsWith('.json');
    if (!primary && !named && !history)
        return null;
    if (id.includes('\\'))
        return null;
    const path = join(dataDir(repo), id);
    const rel = relative(dataDir(repo), path).split(sep).join('/');
    if (rel !== id || !existsSync(path))
        return null;
    return path;
}
/**
 * The listStories() id for a story path — the inverse of storyPathForId, but a pure
 * path relation rather than a directory scan, so it is cheap enough to call per request.
 * Returns null for anything outside `.codestory`, which keeps a stray path from being
 * written into comments as if it were a story id.
 */
export function storyIdForPath(repo, path) {
    const rel = relative(dataDir(repo), path);
    if (!rel || isAbsolute(rel) || rel.split(sep)[0] === '..')
        return null;
    return rel.split(sep).join('/');
}
/** Delete a known story file by id. Unknown ids are ignored so callers cannot escape `.codestory`. */
export function deleteStory(repo, id) {
    const path = storyPathForId(repo, id);
    if (!path)
        return false;
    unlinkSync(path);
    return true;
}
/** True when the repo has at least one primary, legacy, or named story file. */
export function hasStories(repo) {
    const dir = dataDir(repo);
    return existsSync(join(dir, STORY_FILENAME))
        || existsSync(join(dir, LEGACY_STORY_FILENAME))
        || namedStoryIds(repo).length > 0;
}
function storyIds(repo) {
    return [
        STORY_FILENAME,
        LEGACY_STORY_FILENAME,
        ...namedStoryIds(repo).sort((a, b) => a.localeCompare(b)),
    ];
}
function namedStoryIds(repo) {
    const dir = join(dataDir(repo), NAMED_STORIES_DIR);
    if (!existsSync(dir))
        return [];
    const ids = [];
    const walk = (current) => {
        for (const e of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, e.name);
            if (e.isDirectory()) {
                walk(path);
            }
            else if (e.isFile() && e.name.endsWith('.json')) {
                ids.push(join(NAMED_STORIES_DIR, relative(dir, path)).split(sep).join('/'));
            }
        }
    };
    walk(dir);
    return ids;
}
function storySummary(repo, id, liveEvidence) {
    const path = join(repo, DATA_DIR, id);
    if (!existsSync(path))
        return null;
    const updatedAt = statSync(path).mtimeMs;
    // The agent writes story files directly, so the picker snapshots whatever it
    // observes. History holds every version the app has seen.
    snapshotStoryIfChanged(repo, id);
    try {
        const story = loadTour(path);
        const code = isCodeStory(story);
        const session = code
            ? codeStorySession(repo, id, story, liveEvidence)
            : liveEvidence
                ? storySession(repo, story.base, story.head, story.diffFingerprint, story.storySnapshot, snapshotBindingForStory(repo, story))
                : {
                    freshness: 'unverified',
                    inStoryDrift: 0,
                    outsideStoryDrift: 0,
                    liveFiles: new Set(story.steps.filter(isCodeStep).map((step) => step.file)).size,
                    additions: 0,
                    deletions: 0,
                    openComments: 0,
                };
        return {
            id,
            path,
            title: story.title,
            summary: story.summary,
            mode: story.mode ?? 'guided',
            subject: code ? 'code' : 'diff',
            base: story.base,
            head: story.head,
            scope: code ? codeScopeView(story) : storyScope(story.base, story.head),
            updatedAt,
            valid: true,
            steps: story.steps.length,
            primers: story.steps.filter((step) => step.kind === 'concept').length,
            files: new Set(story.steps.filter(isCodeStep).map((step) => step.file)).size,
            current: session.freshness === 'current',
            liveEvidence,
            ...session,
        };
    }
    catch (e) {
        return {
            id,
            path,
            title: basename(id, '.json'),
            summary: '',
            mode: 'guided',
            subject: 'diff',
            scope: {
                label: 'Unknown diff scope',
                description: 'Fix the story JSON before codeStory can read what this story covers.',
                command: '',
            },
            updatedAt,
            valid: false,
            error: e.message,
            steps: 0,
            primers: 0,
            files: 0,
            current: false,
            freshness: 'unverified',
            inStoryDrift: 0,
            outsideStoryDrift: 0,
            liveFiles: 0,
            additions: 0,
            deletions: 0,
            openComments: 0,
            liveEvidence,
        };
    }
}
/**
 * A code story's live facts. Its commit never moves, so freshness is whether
 * the files it visits still match that commit in the working tree; there is
 * no diff to count, and its comments are its own.
 */
function codeStorySession(repo, id, story, liveEvidence) {
    const liveFiles = codeStoryFiles(story).length;
    const quiet = { inStoryDrift: 0, outsideStoryDrift: 0, liveFiles, additions: 0, deletions: 0, openComments: 0 };
    if (!liveEvidence)
        return { freshness: 'unverified', ...quiet };
    const drift = codeStoryDrift(repo, story);
    let openComments = 0;
    try {
        openComments = commentsForStory(loadComments(repo), id).filter((comment) => comment.status === 'open').length;
    }
    catch {
        openComments = 0;
    }
    return {
        ...quiet,
        freshness: drift.state === 'changed' ? 'stale' : drift.state === 'current' ? 'current' : 'unverified',
        inStoryDrift: drift.files.length,
        openComments,
    };
}
function codeScopeView(story) {
    const { label, command } = codeStoryScope(story);
    return {
        label,
        description: `The code at commit ${story.head ?? ''}, explained as committed. Uncommitted edits are not part of it.`,
        command,
    };
}
/** Stable identity for the exact diff a story was written against. */
export function diffFingerprint(diff) {
    return createHash('sha256').update(diff).digest('hex');
}
function storySession(repo, base, head, expected, snapshot, snapshotBinding) {
    const empty = {
        freshness: 'unverified',
        inStoryDrift: 0,
        outsideStoryDrift: 0,
        liveFiles: 0,
        additions: 0,
        deletions: 0,
        openComments: 0,
    };
    try {
        const resolvedBase = resolveBase(repo, base);
        const diff = getDiff(repo, resolvedBase, head);
        const files = parseUnifiedDiff(diff);
        const comments = loadComments(repo);
        const drift = snapshot ? inspectStoryDrift({ repo, snapshot, expected: snapshotBinding }) : undefined;
        let additions = 0;
        let deletions = 0;
        for (const file of files) {
            for (const hunk of file.hunks) {
                for (const line of hunk.lines) {
                    if (line.type === 'add')
                        additions++;
                    if (line.type === 'del')
                        deletions++;
                }
            }
        }
        return {
            freshness: drift
                ? drift.storyFreshness
                : expected
                    ? (diffFingerprint(diff) === expected ? 'current' : 'unverified')
                    : 'unverified',
            inStoryDrift: drift?.inScopeCount ?? 0,
            outsideStoryDrift: drift?.outsideScopeCount ?? 0,
            liveFiles: files.length,
            additions,
            deletions,
            openComments: comments.filter((comment) => comment.status === 'open').length,
        };
    }
    catch {
        return empty;
    }
}
function snapshotScopeForStory(story) {
    const includedFiles = story.storyScope?.includedFiles
        ?? story.steps.filter(isCodeStep).map((step) => step.file);
    return { includedFiles: [...new Set(includedFiles)].sort((a, b) => a.localeCompare(b)) };
}
function snapshotBindingForStory(repo, story) {
    const base = resolveBase(repo, story.base);
    return {
        base,
        ...(story.head ? { head: story.head } : {}),
        storyScope: snapshotScopeForStory(story),
    };
}
function storyScope(base, head) {
    if (base && head) {
        return {
            label: `${shortRef(base)}..${shortRef(head)}`,
            description: `Commits reachable from ${head} after ${base}; this does not include uncommitted working-tree edits.`,
            command: `git diff ${base}..${head} --`,
        };
    }
    if (base) {
        return {
            label: base === 'HEAD' ? 'Working tree vs HEAD' : `Working tree vs ${shortRef(base)}`,
            description: base === 'HEAD'
                ? 'Tracked changes in the current working tree compared with the latest commit.'
                : `Tracked changes in the current working tree compared with ${base}.`,
            command: `git diff ${base} --`,
        };
    }
    return {
        label: 'Default app scope',
        description: 'Uses the app default base when opened, usually branch vs default branch or working tree vs HEAD.',
        command: 'git diff <resolved-base> --',
    };
}
function shortRef(ref) {
    return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}
