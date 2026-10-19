// The Desktop app can bundle a newer Codex runtime than the user's PATH, so use
// that runtime when reading the live story-generation model catalog.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const MAC_DESKTOP_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex';
export function codexTaskBinary() {
    // DIFFSTORY_CODEX_BINARY is the same setting under its name from before the
    // codeStory rename, so a shell profile that still sets it keeps working.
    const configured = process.env.CODESTORY_CODEX_BINARY?.trim() || process.env.DIFFSTORY_CODEX_BINARY?.trim();
    if (configured)
        return configured;
    return existsSync(MAC_DESKTOP_CODEX) ? MAC_DESKTOP_CODEX : 'codex';
}
function appServerRequest(binary, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (error, result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (error)
                reject(error);
            else
                resolve(result);
        };
        const send = (message) => child.stdin?.write(`${JSON.stringify(message)}\n`);
        const handle = (message) => {
            if (message?.id === 1) {
                send({ method: 'initialized' });
                send({
                    id: 2,
                    method,
                    params,
                });
                return;
            }
            if (message?.id !== 2)
                return;
            if (message.error) {
                finish(new Error(String(message.error.message ?? `Codex request ${method} failed.`)));
                return;
            }
            finish(undefined, message.result);
        };
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
            const lines = stdout.split('\n');
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    handle(JSON.parse(line));
                }
                catch {
                    // Ignore non-protocol noise; app-server warnings normally use stderr.
                }
            }
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 20_000)
                stderr = stderr.slice(-20_000);
        });
        child.on('error', (error) => finish(error));
        child.on('close', (code) => {
            if (!settled)
                finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}.`));
        });
        const timer = setTimeout(() => finish(new Error(`Timed out during Codex request ${method}.`)), timeoutMs);
        send({
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: { name: 'codestory', title: 'codeStory', version: '0.1.0' },
                capabilities: { experimentalApi: true },
            },
        });
    });
}
function normalizeCatalogModel(value) {
    if (!value || typeof value !== 'object')
        return null;
    const raw = value;
    if (typeof raw.model !== 'string' || !raw.model.trim())
        return null;
    return {
        model: raw.model.trim(),
        displayName: typeof raw.displayName === 'string' && raw.displayName.trim()
            ? raw.displayName.trim()
            : raw.model.trim(),
        hidden: raw.hidden === true,
        isDefault: raw.isDefault === true,
    };
}
/** Convert Codex's live model catalog into the two honest story-quality choices. */
export function codexStoryModelChoices(value) {
    const raw = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && Array.isArray(value.data)
            ? value.data
            : [];
    const visible = raw
        .map(normalizeCatalogModel)
        .filter((model) => !!model && !model.hidden);
    const best = visible.find((model) => model.isDefault) ?? visible[0];
    if (!best)
        return [];
    const choices = [{
            label: 'Best quality',
            model: best.model,
            description: `${best.displayName} · recommended by your Codex app`,
        }];
    const mini = visible.find((model) => model.model !== best.model && /(?:^|[-_.])mini(?:$|[-_.])/i.test(model.model));
    if (mini) {
        choices.push({
            label: 'Lower cost',
            model: mini.model,
            description: `${mini.displayName} · smaller model available in your Codex app`,
        });
    }
    return choices;
}
/** Read story model choices from the same Codex runtime codeStory will execute. */
export async function listCodexStoryModels(options = {}) {
    const result = await appServerRequest(options.binary ?? codexTaskBinary(), 'model/list', { includeHidden: false, limit: 100 }, options.timeoutMs ?? 8000);
    return codexStoryModelChoices(result);
}
