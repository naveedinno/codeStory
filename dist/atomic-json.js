import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname } from 'node:path';
/** Atomically replace one local JSON artifact, skipping byte-identical writes. */
export function writeJsonAtomic(path, value) {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    return writeTextAtomic(path, next);
}
/** The same atomic replacement, preserving an exact saved artifact on rollback. */
export function writeTextAtomic(path, next) {
    if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('JSON target must be a regular file.');
        }
        if (readFileSync(path, 'utf8') === next)
            return false;
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, next, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
    }
    finally {
        rmSync(temporary, { force: true });
    }
    return true;
}
