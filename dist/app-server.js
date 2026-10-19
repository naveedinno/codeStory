// Internal development server entry point. Users open the codeStory desktop UI;
// this file only supports the app wrapper, local development, demos, and tests.
import { resolve } from 'node:path';
import { isGitRepo } from './git.js';
import { serve } from './server.js';
import { DEFAULT_PORT } from './config.js';
function parseArgs(argv) {
    const a = { dir: null, port: DEFAULT_PORT, open: true };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--dir')
            a.dir = resolve(argv[++i] ?? '.');
        else if (t === '--port')
            a.port = Number(argv[++i]) || DEFAULT_PORT;
        else if (t === '--no-open')
            a.open = false;
    }
    return a;
}
function main() {
    const a = parseArgs(process.argv.slice(2));
    const repo = a.dir && isGitRepo(a.dir) ? a.dir : null;
    serve({ repo, port: a.port, open: a.open });
}
main();
