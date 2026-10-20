import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AloudUnavailableError, createAloudReader, } from './aloud-client.js';
// Lino owns narration now: it ships Aloud's speech engine, the voice models
// under ~/Library/Application Support/Aloud, and the setup that downloads them.
// Lino keeps its own engine private. The supported session entry point gives
// codeStory an isolated player, private bearer token, and session-only settings.
// The embedded launcher below remains a fallback for older Lino installations.
const ENGINE_DIR = 'Contents/Resources/ReadAloud/engine';
const NODE_PATH = 'Contents/Helpers/node';
const STARTUP_TIMEOUT_MS = 20_000;
const STDERR_TAIL_BYTES = 4096;
// Lino's English-capable models, from modelLanguages in its
// Resources/ReadAloud/language-routing.mjs. Narration is English, but the
// engine starts on whichever model Lino last used, which can be Persian.
const ENGLISH_ENGINES = new Set(['kokoro', 'pocket', 'voxcpm']);
const DEFAULT_ENGLISH_ENGINE = 'kokoro';
// Runs inside Lino's bundled Node. argv carries only module paths; the secret
// is generated here and travels back over the private stdout pipe. Closing
// stdin — including when codeStory dies — stops playback and exits.
const LAUNCHER = `
console.log = (...args) => console.error(...args);
process.env.PYTHONDONTWRITEBYTECODE = '1';
const { randomBytes } = await import('node:crypto');
const { runSpeechDaemon } = await import(process.argv[1]);
const { kokoroEnvironmentReady } = await import(process.argv[2]);
const secret = randomBytes(32).toString('base64url');
const server = await runSpeechDaemon({ port: 0, secret, signals: false });
const port = server.address().port;
process.stdout.write(JSON.stringify({ port, secret, ready: kokoroEnvironmentReady() }) + '\\n');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await fetch('http://127.0.0.1:' + port + '/stop', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
  server.close();
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 250).unref();
}
process.stdin.on('end', close);
process.stdin.on('error', close);
process.stdin.resume();
process.on('SIGTERM', close);
process.on('SIGINT', close);
`;
/**
 * Lino is missing, has no English voice, or its engine would not start. The
 * review page answers this one by reading with the browser's own voice.
 */
export class LinoUnavailableError extends AloudUnavailableError {
    fallback = 'browser';
}
export function linoAppCandidates(home = homedir(), env = process.env) {
    return [
        env.CODESTORY_LINO_APP,
        '/Applications/Lino.app',
        join(home, 'Applications', 'Lino.app'),
    ].filter((path) => !!path);
}
export function findLinoApp(candidates) {
    for (const path of candidates) {
        const node = join(path, NODE_PATH);
        const engineDir = join(path, ENGINE_DIR);
        if (existsSync(node) && existsSync(join(engineDir, 'daemon.js'))) {
            const session = join(path, 'Contents/Resources/ReadAloud/session.mjs');
            return { engineDir, node, path, ...(existsSync(session) ? { session } : {}) };
        }
    }
    return null;
}
/**
 * A narration reader backed by Lino's speech engine. The engine starts on the
 * first request, not with the server, and restarts if it exits. Nothing is
 * spawned for a review that never touches narration.
 */
export function createLinoReader(options = {}) {
    const candidates = options.appPaths ?? linoAppCandidates(options.home);
    let engine = null;
    let disposed = false;
    const endpoint = async () => {
        if (disposed)
            throw new AloudUnavailableError('Narration has stopped because codeStory is closing.');
        if (!engine) {
            const starting = startEngine(candidates);
            engine = starting;
            starting.then(({ child }) => child.once('exit', () => { if (engine === starting)
                engine = null; }), () => { if (engine === starting)
                engine = null; });
        }
        return (await engine).endpoint;
    };
    const reader = createAloudReader(endpoint);
    return {
        ...reader,
        dispose() {
            disposed = true;
            const current = engine;
            engine = null;
            void current?.then(({ child }) => stopEngine(child), () => { });
        },
    };
}
async function startEngine(candidates) {
    const app = findLinoApp(candidates);
    if (!app) {
        throw new LinoUnavailableError('Narration needs Lino. Install Lino in Applications, then download a voice in Settings → Read Aloud.');
    }
    const child = spawn(app.node, app.session ? [app.session, '--language', 'en'] : [
        '--input-type=module',
        '-e',
        LAUNCHER,
        pathToFileURL(join(app.engineDir, 'daemon.js')).href,
        pathToFileURL(join(app.engineDir, 'system-health.js')).href,
    ], {
        cwd: app.engineDir,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let handshake;
    try {
        handshake = await readHandshake(child);
    }
    catch (error) {
        stopEngine(child);
        throw error;
    }
    if (!handshake.ready) {
        stopEngine(child);
        throw new LinoUnavailableError('Lino has no English voice yet. Download one in Lino → Settings → Read Aloud, then try again.');
    }
    // The engine must not keep a finished codeStory process alive; closing our
    // end of stdin on exit is what tells it to stop.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream?.unref?.();
    }
    const endpoint = { secret: handshake.secret, url: `http://127.0.0.1:${handshake.port}` };
    try {
        await preferEnglishEngine(endpoint);
    }
    catch (error) {
        stopEngine(child);
        throw error instanceof LinoUnavailableError
            ? error
            : new LinoUnavailableError("Lino's speech engine did not answer while starting.");
    }
    return { child, endpoint };
}
function readHandshake(child) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const fail = (message) => {
            cleanup();
            const detail = stderr.trim().split('\n').pop();
            reject(new LinoUnavailableError(detail ? `${message} ${detail}` : message));
        };
        const onStdout = (chunk) => {
            stdout += chunk.toString('utf8');
            const newline = stdout.indexOf('\n');
            if (newline < 0)
                return;
            cleanup();
            try {
                const parsed = JSON.parse(stdout.slice(0, newline));
                if (typeof parsed.port !== 'number' || typeof parsed.secret !== 'string')
                    throw new Error('bad handshake');
                resolve({ port: parsed.port, ready: parsed.ready === true, secret: parsed.secret });
            }
            catch {
                reject(new LinoUnavailableError("Lino's speech engine sent an unexpected startup message."));
            }
        };
        const onStderr = (chunk) => {
            stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
        };
        const onExit = () => fail("Lino's speech engine stopped while starting.");
        const onError = (error) => fail(`Lino's speech engine could not start: ${error.message}.`);
        const timer = setTimeout(() => fail("Lino's speech engine took too long to start."), STARTUP_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timer);
            child.stdout?.off('data', onStdout);
            child.off('exit', onExit);
            child.off('error', onError);
        }
        child.stdout?.on('data', onStdout);
        // Keep draining stderr for the engine's whole life so a chatty Python worker
        // can never fill the pipe and stall it.
        child.stderr?.on('data', onStderr);
        child.once('exit', onExit);
        child.once('error', onError);
    });
}
async function preferEnglishEngine(endpoint) {
    const headers = { Authorization: `Bearer ${endpoint.secret}`, 'Content-Type': 'application/json' };
    const status = await fetch(`${endpoint.url}/status`, { headers, signal: AbortSignal.timeout(10_000) })
        .then((response) => response.json());
    if (typeof status.engine === 'string' && ENGLISH_ENGINES.has(status.engine))
        return;
    // /settings restores the narrator last chosen for that model, so this lands
    // on the reviewer's own Kokoro voice rather than a default.
    const switched = await fetch(`${endpoint.url}/settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ engine: DEFAULT_ENGLISH_ENGINE }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!switched.ok)
        throw new LinoUnavailableError("Lino's speech engine could not switch to an English voice.");
}
function stopEngine(child) {
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    child.stdin?.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
}
