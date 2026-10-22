// Builds the React client: one esbuild bundle per surface plus the Tailwind v4
// stylesheet. Output lands in dist/client/ and is served from /assets/client/*.
//
// Run as part of `npm run build` (after tsc and the browser-asset step), or on
// its own with `node scripts/build-client.mjs`.

import { readFile, readdir, mkdir, stat, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { buildThemeCss } from './build-theme-css.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = resolve(root, 'client');
const outdir = resolve(root, 'dist/client');

/** One React root per page the server serves. */
const SURFACES = ['picker', 'stories', 'change', 'review', 'progress', 'explain'];

const exists = (path) => stat(path).then(() => true, () => false);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

async function report(label, path) {
  const bytes = await readFile(path);
  console.log(`  ${label.padEnd(22)} ${kb(bytes.length).padStart(10)}  (${kb(gzipSync(bytes).length)} gzip)`);
  return bytes.length;
}

async function bundleSurfaces() {
  const entries = [];
  for (const surface of SURFACES) {
    const entry = resolve(clientDir, `entry/${surface}.tsx`);
    if (await exists(entry)) entries.push({ surface, entry });
    else console.log(`  skipping "${surface}" — no ${relative(root, entry)} yet`);
  }
  if (entries.length === 0) {
    console.log('  no surface entries present; only the stylesheet was built');
    return 0;
  }

  // Chunk filenames carry a content hash, so yesterday's chunks would otherwise
  // pile up in local builds and npm packages.
  for (const file of await readdir(outdir).catch(() => [])) {
    if (file.startsWith('chunk-')) await rm(resolve(outdir, file), { force: true });
  }

  await build({
    entryPoints: Object.fromEntries(entries.map(({ surface, entry }) => [surface, entry])),
    outdir,
    bundle: true,
    // React and Motion are ~85% of every surface bundle. Splitting hoists them
    // into a shared chunk so moving between surfaces re-fetches only that
    // surface's own code, instead of a fresh copy of React each time.
    splitting: true,
    chunkNames: 'chunk-[hash]',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    sourcemap: true,
    legalComments: 'eof',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });

  let total = 0;
  for (const { surface } of entries) total += await report(`${surface}.js`, resolve(outdir, `${surface}.js`));
  // Shared chunks are hashed, so name them explicitly rather than guessing.
  for (const file of (await readdir(outdir)).sort()) {
    if (file.startsWith('chunk-') && file.endsWith('.js')) total += await report(file, resolve(outdir, file));
  }
  return total;
}

async function buildStylesheet() {
  const cli = resolve(root, 'node_modules/@tailwindcss/cli/dist/index.mjs');
  if (!(await exists(cli))) throw new Error('build-client: @tailwindcss/cli is not installed — run npm install');

  const args = [cli, '--input', resolve(clientDir, 'styles.css'), '--output', resolve(outdir, 'app.css'), '--minify'];
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`build-client: tailwindcss exited with code ${code}`)),
    );
  });
  return report('app.css', resolve(outdir, 'app.css'));
}

await mkdir(outdir, { recursive: true });
await buildThemeCss();
console.log('client bundles -> dist/client');
const scripts = await bundleSurfaces();
const styles = await buildStylesheet();
console.log(`  ${'total'.padEnd(22)} ${kb(scripts + styles).padStart(10)}`);
