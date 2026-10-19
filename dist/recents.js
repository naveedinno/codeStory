// A small global store of recently-opened repos, kept at ~/.codestory/recents.json
// (distinct from each repo's local .codestory/ data dir). The pure `addRecent`
// reducer is unit-tested; the FS wrappers take `home` so tests can use a temp dir.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DATA_DIR } from './config.js';
const DEFAULT_CAP = 12;
/** Path to the global recents file under a given home directory. */
export function recentsFile(home) {
    return join(home, DATA_DIR, 'recents.json');
}
/** Pure: put `path` at the front with `now`, drop any prior copy, cap the length. */
export function addRecent(list, path, now, cap = DEFAULT_CAP, snapshot) {
    const previous = list.find((e) => e.path === path);
    const rest = list.filter((e) => e.path !== path);
    const next = snapshot
        ? { ...snapshot, lastOpened: now }
        : { ...previous, path, lastOpened: now };
    return [next, ...rest].slice(0, cap);
}
/** Pure: remove one path from the recent repositories list. */
export function removeRecent(list, path) {
    return list.filter((e) => e.path !== path);
}
/** Pure: restore an exact entry near its former position, without duplicating it. */
export function restoreRecentAt(list, entry, index, cap = DEFAULT_CAP) {
    const next = removeRecent(list, entry.path);
    const target = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, next.length));
    next.splice(target, 0, entry);
    return next.slice(0, cap);
}
/** Read the recents list; tolerate a missing or corrupt file by returning []. */
export function loadRecents(home) {
    const file = recentsFile(home);
    if (!existsSync(file))
        return [];
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
/** Write the recents list, creating ~/.codestory/ if needed. */
export function saveRecents(home, list) {
    const file = recentsFile(home);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}
/** Load, push `path` to the front, persist, and return the new list. */
export function recordRecent(home, path, now, snapshot) {
    const next = addRecent(loadRecents(home), path, now, DEFAULT_CAP, snapshot);
    saveRecents(home, next);
    return next;
}
/** Load, remove `path`, persist, and return the new list. */
export function forgetRecent(home, path) {
    const next = removeRecent(loadRecents(home), path);
    saveRecents(home, next);
    return next;
}
/** Restore a removed entry at its former position and persist the result. */
export function restoreRecent(home, entry, index) {
    const next = restoreRecentAt(loadRecents(home), entry, index);
    saveRecents(home, next);
    return next;
}
