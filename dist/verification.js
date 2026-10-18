import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-json.js';
import { resolveCommit, reviewChangeFingerprint, reviewFileIndex } from './git.js';
function storePath(home, repo) {
    return join(home, '.diffstory', 'verification', `${createHash('sha256').update(repo).digest('hex')}.json`);
}
export function loadVerificationReceipts(home, repo) {
    try {
        const rows = JSON.parse(readFileSync(storePath(home, repo), 'utf8'));
        if (!Array.isArray(rows))
            return [];
        return rows.filter((r) => r && typeof r.id === 'string' &&
            typeof r.check === 'string' && typeof r.output === 'string' && r.output.length <= 65536 &&
            typeof r.workspace === 'string' && typeof r.revision === 'string' &&
            typeof r.fingerprint === 'string' && typeof r.sourceStable === 'boolean' &&
            typeof r.startedAt === 'string' && typeof r.finishedAt === 'string' &&
            (r.result === 'passed' || r.result === 'failed') &&
            (r.exitCode === null || Number.isInteger(r.exitCode))).slice(-40);
    }
    catch {
        return [];
    }
}
export function verificationWorkspace(repo, base) {
    return reviewChangeFingerprint(repo, base);
}
export function canRunVerification(repo, head) {
    // Commands execute the checkout. Never present a run on another checkout as
    // proof of a historical/fixed-ref review.
    return !head || (!!resolveCommit(repo, head) && reviewFileIndex(repo, head).length === 0);
}
export async function captureVerification(input) {
    if (!input.check.trim() || input.check.length > 120)
        throw new Error('Invalid check command.');
    if (!canRunVerification(input.repo, input.head))
        throw new Error('The checkout differs from the reviewed revision. Open that revision in a clean checkout before running this check.');
    const workspace = verificationWorkspace(input.repo, input.base);
    const reviewed = input.head ? reviewChangeFingerprint(input.repo, input.base, input.head) : workspace;
    if (reviewed !== input.fingerprint)
        throw new Error('The review changed before the check could start. Reload and confirm the command again.');
    const revision = resolveCommit(input.repo, 'HEAD') ?? 'unborn';
    const reviewedHead = input.head ? resolveCommit(input.repo, input.head) : undefined;
    const startedAt = new Date().toISOString();
    const captured = await new Promise((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', input.check], { cwd: input.repo, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        let output = '';
        let truncated = false;
        let timedOut = false;
        const append = (chunk) => {
            const text = chunk.toString('utf8');
            const room = 65536 - output.length;
            if (text.length > room)
                truncated = true;
            if (room > 0)
                output += text.slice(0, room);
        };
        const stop = () => { if (child.pid) {
            try {
                process.kill(-child.pid, 'SIGKILL');
            }
            catch { /* already exited */ }
        } };
        const timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutMs ?? 120000);
        const abort = () => stop();
        input.signal?.addEventListener('abort', abort, { once: true });
        if (input.signal?.aborted)
            stop();
        const cleanup = () => { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.once('error', (error) => { cleanup(); reject(error); });
        child.once('close', (exitCode) => { cleanup(); resolve({ exitCode, output, truncated, timedOut }); });
    });
    let sourceStable = false;
    try {
        sourceStable = workspace === verificationWorkspace(input.repo, input.base) &&
            input.fingerprint === reviewChangeFingerprint(input.repo, input.base, input.head) &&
            revision === (resolveCommit(input.repo, 'HEAD') ?? 'unborn') &&
            (!input.head || (reviewedHead === resolveCommit(input.repo, input.head) && canRunVerification(input.repo, input.head)));
    }
    catch { /* unavailable source identity cannot establish a current receipt */ }
    const receipt = {
        id: randomUUID(), check: input.check, startedAt, finishedAt: new Date().toISOString(),
        ...captured, result: captured.exitCode === 0 && !captured.timedOut && !input.signal?.aborted ? 'passed' : 'failed',
        fingerprint: input.fingerprint, workspace, revision, sourceStable,
    };
    writeJsonAtomic(storePath(input.home, input.repo), [...loadVerificationReceipts(input.home, input.repo), receipt].slice(-40));
    return receipt;
}
