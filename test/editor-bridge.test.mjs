import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

// The Cmd/Ctrl-click bridge lives in the ported review engine now.
const PAGE_JS = readFileSync(new URL('../client/surfaces/review/engine/review-engine.js', import.meta.url), 'utf8');
const PAGE_CSS = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
import {
  editorNavigationTarget,
  serve,
  vscodeLaunchArgs,
  vscodeNavigationTarget,
  vscodeNavigationUrl,
  zedLaunchArgs,
} from '../dist/server.js';

test('VS Code launch opens the reviewed repo and exact source location together', () => {
  const target = vscodeNavigationTarget('/tmp/review repo', 'src/order flow.ts', 42, 17);
  assert.deepEqual(target, {
    repo: '/tmp/review repo',
    path: '/tmp/review repo/src/order flow.ts',
    line: 42,
    column: 17,
  });
  assert.deepEqual(vscodeLaunchArgs(target), [
    '--reuse-window',
    '/tmp/review repo',
    '--goto',
    '/tmp/review repo/src/order flow.ts:42:17',
  ]);

  const value = vscodeNavigationUrl('/tmp/review repo', 'src/order flow.ts', 42, 17);
  assert.equal(value, 'vscode://file/tmp/review%20repo/src/order%20flow.ts:42:17');
  const url = new URL(value);
  assert.equal(url.protocol, 'vscode:');
  assert.equal(url.host, 'file');
});

test('VS Code bridge URL rejects absolute and escaping review paths', () => {
  assert.equal(vscodeNavigationUrl('/tmp/repo', '/etc/passwd', 1, 1), null);
  assert.equal(vscodeNavigationUrl('/tmp/repo', '../secret.ts', 1, 1), null);
  assert.equal(vscodeNavigationUrl('/tmp/repo', 'src/a.ts', 0, 1), null);
  assert.equal(vscodeNavigationUrl('/tmp/repo', 'src/a.ts', 1, 0), null);
});

test('Zed launch opens the reviewed workspace and exact source location together', () => {
  const target = editorNavigationTarget('/tmp/review repo', 'src/order flow.ts', 42, 17);
  assert.deepEqual(zedLaunchArgs(target), [
    '/tmp/review repo',
    '/tmp/review repo/src/order flow.ts:42:17',
  ]);
});

test('source editor settings API reads and persists either supported editor', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codestory-editor-settings-home-'));
  mkdirSync(join(home, '.codestory'), { recursive: true });
  writeFileSync(join(home, '.codestory', 'settings.json'), '{"futureSetting":"kept","editor":"zed"}\n');
  const server = serve({ repo: null, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const current = await fetch(`${base}/api/settings/editor`);
    assert.equal(current.status, 200);
    assert.deepEqual(await current.json(), { editor: 'zed', label: 'Zed' });

    const invalid = await fetch(`${base}/api/settings/editor`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editor: 'vim' }),
    });
    assert.equal(invalid.status, 400);

    const updated = await fetch(`${base}/api/settings/editor`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editor: 'vscode' }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ok: true, editor: 'vscode', label: 'VS Code' });
    assert.deepEqual(
      JSON.parse(readFileSync(join(home, '.codestory', 'settings.json'), 'utf8')),
      { futureSetting: 'kept', version: 1, editor: 'vscode' },
    );
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('review assets expose modifier-click navigation without taking ordinary clicks', () => {
  assert.match(PAGE_CSS, /\[data-vscode-symbol\][^{]*\{[^}]*cursor:alias/);
  assert.match(PAGE_JS, /b=closest\(t,'\[data-vscode-symbol\]'\);if\(b&&\(e\.metaKey\|\|e\.ctrlKey\)\)/);
  assert.match(PAGE_JS, /fetch\(reviewPageUrl\('\/api\/editor\/open'\)/);
});

test('leased editor endpoint dispatches only reviewed files to the bridge', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'codestory-editor-bridge-'));
  const home = mkdtempSync(join(tmpdir(), 'codestory-editor-home-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'order.ts'), 'export function executeOrder() { return 1; }\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  writeFileSync(join(repo, 'order.ts'), 'export function executeOrder() { return 2; }\n');

  mkdirSync(join(home, '.codestory'), { recursive: true });
  writeFileSync(join(home, '.codestory', 'settings.json'), '{"version":1,"editor":"zed"}\n');
  const opened = [];
  const server = serve({
    repo,
    port: 0,
    open: false,
    homeOverride: home,
    openEditor: (target, editor) => { opened.push({ target, editor }); return true; },
  });
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const review = await fetch(`${base}/repo/${encodeURIComponent(basename(repo))}/diff`);
    assert.equal(review.status, 200);
    const html = await review.text();
    // The page facts travel in the shell's JSON payload now; `<body>` gets them
    // from React at mount, so the server response no longer carries them as
    // attributes.
    const payload = JSON.parse(
      html.match(/<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/)[1],
    );
    const token = payload.pageToken;
    assert.ok(token);

    const response = await fetch(`${base}/api/editor/open?page=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'order.ts', line: 1, column: 17 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, editor: 'zed', label: 'Zed' });
    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0], {
      editor: 'zed',
      target: {
        repo,
        path: join(repo, 'order.ts'),
        line: 1,
        column: 17,
      },
    });

    const rejected = await fetch(`${base}/api/editor/open?page=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: '../outside.ts', line: 1, column: 1 }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(opened.length, 1);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
