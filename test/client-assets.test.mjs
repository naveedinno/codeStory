// The React surface bundles and stylesheet are served from dist/client. These
// guard the two things that silently break the whole UI: a CSP that forbids an
// external stylesheet, and a cache policy that pins an unhashed bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../dist/server.js';

async function withServer(run) {
  const repo = mkdtempSync(join(tmpdir(), 'codestory-client-assets-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // A throwaway home: the server reads and writes its global store there, and
  // a test must never reach the real one.
  const home = mkdtempSync(join(tmpdir(), 'ds-client-assets-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

test('the compiled stylesheet is served with Signal tokens and a revalidating cache', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/assets/client/app.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/css/);
    // Unhashed filename: caching it immutably would serve a stale bundle after
    // every rebuild, with no way for the user to tell.
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.match(await res.text(), /--accent:/);
  });
});

test('the page CSP permits the external stylesheet while still denying by default', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/assets/client/app.css`);
    const csp = res.headers.get('content-security-policy');
    // Without 'self' here the stylesheet is blocked and nothing renders.
    assert.match(csp, /style-src [^;]*'self'/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src [^;]*'self'/);
  });
});

test('the client asset route refuses anything but a flat known-extension filename', async () => {
  await withServer(async (base) => {
    for (const name of ['../server.js', '..%2Fserver.js', 'missing.js', 'app.css.bak', '.env', 'app.txt']) {
      const res = await fetch(`${base}/assets/client/${name}`);
      assert.equal(res.status, 404, `${name} should not be served`);
    }
    const traversal = await fetch(`${base}/assets/client/../../package.json`);
    assert.ok(traversal.status === 404 || traversal.status === 400);
  });
});

test('a built surface bundle is served as JavaScript', async (t) => {
  const bundles = ['picker', 'stories', 'change', 'review', 'progress']
    .filter((surface) => existsSync(new URL(`../dist/client/${surface}.js`, import.meta.url)));
  if (bundles.length === 0) {
    t.skip('no surface bundle built yet');
    return;
  }
  await withServer(async (base) => {
    for (const surface of bundles) {
      const res = await fetch(`${base}/assets/client/${surface}.js`);
      assert.equal(res.status, 200, surface);
      assert.match(res.headers.get('content-type'), /^text\/javascript/);
    }
  });
});
