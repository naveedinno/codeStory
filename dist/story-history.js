// Automatic snapshots of story files so earlier walkthroughs survive
// regeneration and repair. The agent writes `.codestory/story.json` directly,
// so there is no server write path to hook: instead the app snapshots the
// story it observes on read paths (picker, review, post-generation finish).
// History therefore holds every version the app has seen; a version written
// and overwritten between two app reads is the only thing it can miss.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { dataDir } from './config.js';
import { loadTour } from './tour.js';
export const HISTORY_DIRNAME = 'history';
/** Snapshots kept per story; older ones are pruned on write. */
export const HISTORY_LIMIT = 20;
function historyDir(repo) {
    return join(dataDir(repo), HISTORY_DIRNAME);
}
/** True for story ids that address a snapshot rather than a live story. */
export function isHistoryStoryId(id) {
    return !!id && (id === HISTORY_DIRNAME || id.startsWith(`${HISTORY_DIRNAME}/`));
}
function slugForStoryId(storyId) {
    return storyId
        .toLowerCase()
        .replace(/\.json$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'story';
}
const SNAPSHOT_NAME = /^(.*)-[0-9]{8}T[0-9]{9}-[0-9a-f]{8}(?:-[0-9]+)?\.json$/;
/** Live story ids a snapshot slug can resolve against (mirrors stories.ts, cycle-free). */
function knownStoryIds(repo) {
    const ids = ['story.json', 'review-tour.json'].filter((name) => existsSync(join(dataDir(repo), name)));
    const dir = join(dataDir(repo), 'stories');
    if (!existsSync(dir))
        return ids;
    const walk = (current) => {
        for (const e of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, e.name);
            if (e.isDirectory()) {
                walk(path);
            }
            else if (e.isFile() && e.name.endsWith('.json')) {
                ids.push(`stories/${relative(dir, path)}`.split(sep).join('/'));
            }
        }
    };
    walk(dir);
    return ids;
}
/**
 * The live story a snapshot was taken from, or null when the snapshot name
 * matches nothing on disk. Slugs are lossy, so this resolves against known
 * story ids rather than reversing the slug.
 */
export function liveStoryIdForSnapshot(repo, name) {
    const match = SNAPSHOT_NAME.exec(name);
    if (!match)
        return null;
    const slug = match[1];
    for (const id of knownStoryIds(repo)) {
        if (slugForStoryId(id) === slug)
            return id;
    }
    return null;
}
function snapshotName(slug, sha, at) {
    // Millisecond stamps: generation and repair can snapshot twice within one
    // second, and name order is the history order.
    const stamp = at.toISOString().replace(/[-:]/g, '').replace('.', '').replace(/Z$/, '');
    return `${slug}-${stamp}-${sha.slice(0, 8)}.json`;
}
function shaOf(bytes) {
    return createHash('sha256').update(bytes, 'utf8').digest('hex');
}
function snapshotNamesFor(repo, slug) {
    const dir = historyDir(repo);
    if (!existsSync(dir))
        return [];
    const prefix = `${slug}-`;
    const names = readdirSync(dir)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
    // History order is write order. Stamps carry milliseconds, but two snapshots
    // can still land in the same millisecond, so mtime breaks the tie.
    const mtimes = new Map();
    for (const name of names) {
        try {
            mtimes.set(name, statSync(join(dir, name)).mtimeMs);
        }
        catch {
            mtimes.set(name, 0);
        }
    }
    return names.sort((a, b) => (mtimes.get(a) ?? 0) - (mtimes.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
}
/**
 * Snapshot the story file when its bytes differ from the newest snapshot.
 * Never throws: history must not break review when the disk is odd.
 */
export function snapshotStoryIfChanged(repo, storyId) {
    try {
        if (isHistoryStoryId(storyId))
            return null;
        const storyFile = join(dataDir(repo), storyId);
        if (!existsSync(storyFile))
            return null;
        const bytes = readFileSync(storyFile, 'utf8');
        const sha = shaOf(bytes);
        const slug = slugForStoryId(storyId);
        const dir = historyDir(repo);
        const existing = snapshotNamesFor(repo, slug);
        if (existing.length > 0) {
            const newest = readFileSync(join(dir, existing[existing.length - 1]), 'utf8');
            if (shaOf(newest) === sha)
                return null;
        }
        mkdirSync(dir, { recursive: true });
        const base = snapshotName(slug, sha, new Date());
        let name = base;
        for (let n = 2; existsSync(join(dir, name)); n++) {
            name = base.replace(/\.json$/, `-${n}.json`);
        }
        writeFileSync(join(dir, name), bytes, 'utf8');
        pruneSnapshots(repo, slug);
        return describeSnapshot(repo, storyId, name);
    }
    catch {
        return null;
    }
}
function pruneSnapshots(repo, slug) {
    const names = snapshotNamesFor(repo, slug);
    const overflow = names.slice(0, Math.max(0, names.length - HISTORY_LIMIT));
    for (const name of overflow) {
        try {
            unlinkSync(join(historyDir(repo), name));
        }
        catch {
            // A leftover snapshot is clutter, not a failure.
        }
    }
}
function describeSnapshot(repo, storyId, name) {
    const path = join(historyDir(repo), name);
    const takenAt = new Date(statSync(path).mtimeMs).toISOString();
    const id = `${HISTORY_DIRNAME}/${name}`;
    try {
        const tour = loadTour(path);
        return {
            id,
            name,
            storyId,
            takenAt,
            sha: shaOf(readFileSync(path, 'utf8')),
            updatedAt: statSync(path).mtimeMs,
            valid: true,
            title: tour.title,
            steps: tour.steps.length,
        };
    }
    catch {
        return {
            id,
            name,
            storyId,
            takenAt,
            sha: '',
            updatedAt: statSync(path).mtimeMs,
            valid: false,
            title: name.replace(/\.json$/, ''),
            steps: 0,
        };
    }
}
/** Newest-first snapshots for one story, each diffed against the live story. */
export function listStoryHistory(repo, storyId) {
    if (isHistoryStoryId(storyId))
        return [];
    const slug = slugForStoryId(storyId);
    const entries = snapshotNamesFor(repo, slug)
        .reverse()
        .map((name) => describeSnapshot(repo, storyId, name));
    let current = null;
    try {
        current = loadTour(join(dataDir(repo), storyId));
    }
    catch {
        current = null;
    }
    if (!current)
        return entries;
    return entries.map((entry) => {
        if (!entry.valid)
            return entry;
        try {
            const old = loadTour(join(historyDir(repo), entry.name));
            return { ...entry, diff: diffTours(old, current) };
        }
        catch {
            return entry;
        }
    });
}
function diffTours(oldTour, currentTour) {
    const oldIds = oldTour.steps.map((step) => step.id);
    const currentIds = new Set(currentTour.steps.map((step) => step.id));
    const oldSet = new Set(oldIds);
    return {
        titleChanged: oldTour.title !== currentTour.title,
        stepDelta: currentTour.steps.length - oldTour.steps.length,
        addedSteps: currentTour.steps.map((step) => step.id).filter((id) => !oldSet.has(id)),
        removedSteps: oldIds.filter((id) => !currentIds.has(id)),
    };
}
/**
 * Restore a snapshot over the live story file. The live bytes are snapshotted
 * first, so restore is undoable by restoring again. Returns false for unknown
 * ids instead of throwing, mirroring deleteStory.
 */
export function restoreStoryVersion(repo, storyId, name) {
    try {
        if (isHistoryStoryId(storyId))
            return false;
        if (!name.endsWith('.json') || name.includes('/') || name.includes('\\'))
            return false;
        const slug = slugForStoryId(storyId);
        if (!name.startsWith(`${slug}-`))
            return false;
        const snapshot = join(historyDir(repo), name);
        if (!existsSync(snapshot))
            return false;
        const bytes = readFileSync(snapshot, 'utf8');
        JSON.parse(bytes);
        snapshotStoryIfChanged(repo, storyId);
        writeFileSync(join(dataDir(repo), storyId), bytes, 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
/** Step ids that exist in both tours, for callers that diff history content. */
export function sharedStepIds(a, b) {
    const inB = new Set(b.steps.map((step) => step.id));
    return a.steps.map((step) => step.id).filter((id) => inB.has(id));
}
