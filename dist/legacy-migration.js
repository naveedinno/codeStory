// The app was renamed from diffStory to codeStory, and both of its data folders
// moved with it: each repo's LEGACY_DATA_DIR became DATA_DIR, and so did the
// global store in the home directory. These one-way migrations carry the old
// data over. A copy already in the new folder always wins, and nothing that was
// not moved is ever deleted, so a second run, or a half-migrated folder, is safe.
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js';
/**
 * The home-store entries worth carrying over. The old folder can also hold
 * `src/`, a checkout an older install may still run from, so the home store is
 * copied entry by entry and the old folder is never changed.
 */
const HOME_ENTRIES = ['recents.json', 'settings.json', 'story-selection.json', 'verification'];
/** 'dir' for a real directory; a symlink is 'other', so it is never traversed. */
function entryKind(path) {
    try {
        return lstatSync(path).isDirectory() ? 'dir' : 'other';
    }
    catch {
        return null;
    }
}
/** Rename `from` over a missing `to`, merge two directories, or keep `from` on a conflict. */
function mergeMove(from, to, rel, result) {
    const target = entryKind(to);
    if (target === null) {
        try {
            renameSync(from, to);
            result.moved.push(rel);
        }
        catch {
            result.kept.push(rel);
        }
        return;
    }
    if (target !== 'dir' || entryKind(from) !== 'dir') {
        result.kept.push(rel);
        return;
    }
    let names;
    try {
        names = readdirSync(from);
    }
    catch {
        result.kept.push(rel);
        return;
    }
    for (const name of names)
        mergeMove(join(from, name), join(to, name), `${rel}/${name}`, result);
    try {
        // Removes the folder only when it is empty, so a kept file keeps its folder.
        rmdirSync(from);
    }
    catch {
        // Still holds a kept entry.
    }
}
/**
 * Give every .gitignore rule that names LEGACY_DATA_DIR a twin naming DATA_DIR,
 * appended once. Comments are not rules and are left alone.
 */
function mirrorGitignore(repo) {
    const path = join(repo, '.gitignore');
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return [];
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const present = new Set(lines.map((line) => line.trim()));
    const added = [];
    for (const line of lines) {
        const rule = line.trim();
        if (!rule || rule.startsWith('#') || !rule.includes(LEGACY_DATA_DIR))
            continue;
        const twin = rule.split(LEGACY_DATA_DIR).join(DATA_DIR);
        if (present.has(twin))
            continue;
        present.add(twin);
        added.push(twin);
    }
    if (!added.length)
        return [];
    const separator = text === '' || text.endsWith('\n') ? '' : eol;
    try {
        writeFileSync(path, text + separator + added.join(eol) + eol);
    }
    catch {
        return [];
    }
    return added;
}
/**
 * Merge-move `<repo>/LEGACY_DATA_DIR` into `<repo>/DATA_DIR` and mirror its
 * .gitignore rules. Call it before anything reads DATA_DIR for that repo.
 */
export function migrateLegacyDataDir(repo) {
    const result = { moved: [], kept: [], gitignore: [] };
    const legacy = join(repo, LEGACY_DATA_DIR);
    if (entryKind(legacy) === 'dir')
        mergeMove(legacy, join(repo, DATA_DIR), LEGACY_DATA_DIR, result);
    result.gitignore = mirrorGitignore(repo);
    return result;
}
/**
 * Copy the old global store's entries into `<home>/DATA_DIR` wherever the new
 * entry is missing. Copies, never moves: the old folder stays exactly as it was.
 * Returns the entry names copied.
 */
export function migrateLegacyHome(home) {
    const legacy = join(home, LEGACY_DATA_DIR);
    if (entryKind(legacy) !== 'dir')
        return [];
    const target = join(home, DATA_DIR);
    const copied = [];
    for (const name of HOME_ENTRIES) {
        const from = join(legacy, name);
        const to = join(target, name);
        if (entryKind(from) === null || entryKind(to) !== null)
            continue;
        try {
            mkdirSync(target, { recursive: true });
            cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
            copied.push(name);
        }
        catch {
            // A store that cannot be copied starts empty, as it would on a new machine.
        }
    }
    return copied;
}
