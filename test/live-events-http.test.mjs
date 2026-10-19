import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { serve } from '../dist/server.js';

function repoFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-live-http-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# before\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'initial'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# after\n');
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  writeFileSync(join(repo, '.codestory', 'comments.json'), '[]\n');
  return repo;
}

/** A server on `repo` with a throwaway home, removed once the server closes. */
function serveRepo(repo) {
  const home = mkdtempSync(join(tmpdir(), 'ds-live-http-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  server.once('close', () => rmSync(home, { recursive: true, force: true }));
  return server;
}

function tokenFrom(html) {
  // The page facts travel in the shell's JSON payload now; React stamps them
  // onto <body> at mount, so the server response no longer carries them.
  const match = html.match(/"pageToken":"([^"]+)"/);
  assert.ok(match?.[1]);
  return match[1];
}

async function readUntil(reader, pattern, timeoutMs = 3000) {
  const decoder = new TextDecoder();
  let text = '';
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), timeoutMs);
  });
  const reading = (async () => {
    while (!pattern.test(text)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(text, pattern);
    return text;
  })();
  try {
    return await Promise.race([reading, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test('HTTP live stream authenticates leases, keeps two tabs valid, and emits file invalidations', async () => {
  const repo = repoFixture();
  const server = serveRepo(repo);
  await once(server, 'listening');
  const address = server.address();
  const base = `http://localhost:${address.port}`;
  const route = `/repo/${encodeURIComponent(basename(repo))}/diff`;
  const controller = new AbortController();

  try {
    const firstHtml = await (await fetch(`${base}${route}`)).text();
    const firstToken = tokenFrom(firstHtml);
    const secondHtml = await (await fetch(`${base}${route}`)).text();
    const secondToken = tokenFrom(secondHtml);
    assert.notEqual(firstToken, secondToken);

    const oldTabPanel = await fetch(`${base}/api/diff/file-panel?file=README.md&page=${encodeURIComponent(firstToken)}`);
    assert.equal(oldTabPanel.status, 200, 'opening a second tab must not invalidate the first lease');
    assert.equal((await fetch(`${base}/api/events?page=not-a-lease`)).status, 204);

    const stream = await fetch(`${base}/api/events?page=${encodeURIComponent(firstToken)}`, { signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const initialState = await readUntil(reader, /event: state/);
    assert.match(initialState, /"diffChanged":false/, 'a freshly rendered page must start current');

    writeFileSync(join(repo, '.codestory', 'comments.json'), `${JSON.stringify([{
      id: 'external', file: 'README.md', line: 1, type: 'question', severity: 'concern',
      body: 'Did this arrive live?', status: 'open', createdAt: new Date().toISOString(), turns: [],
    }], null, 2)}\n`);
    await readUntil(reader, /event: comments-changed/, 5000);
  } finally {
    controller.abort();
    await new Promise((resolve) => server.close(resolve));
    rmSync(repo, { recursive: true, force: true });
  }
});

test('graceful server.close() completes while a live stream is connected', async () => {
  const repo = repoFixture();
  const server = serveRepo(repo);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  const route = `/repo/${encodeURIComponent(basename(repo))}/diff`;
  const controller = new AbortController();
  try {
    const token = tokenFrom(await (await fetch(`${base}${route}`)).text());
    const stream = await fetch(`${base}/api/events?page=${encodeURIComponent(token)}`, { signal: controller.signal });
    const reader = stream.body.getReader();
    await readUntil(reader, /event: state/);

    const outcome = await Promise.race([
      new Promise((resolve) => server.close(() => resolve('closed'))),
      new Promise((resolve) => { setTimeout(() => resolve('hung'), 2000).unref(); }),
    ]);
    assert.equal(outcome, 'closed', 'close() must end live streams instead of waiting on them forever');
  } finally {
    controller.abort();
    try { server.close(() => {}); } catch { /* already closed */ }
    rmSync(repo, { recursive: true, force: true });
  }
});

test('lease-scoped review state and comment mutations tolerate a story mid-rewrite', async () => {
  const repo = repoFixture();
  writeFileSync(join(repo, '.codestory', 'story.json'), JSON.stringify({
    version: 1, title: 'Focused review', summary: 'Review the README change.', base: 'HEAD',
    storyScope: { includedFiles: ['README.md'] },
    steps: [{
      id: 'readme', order: 1, title: 'README behavior', file: 'README.md',
      range: [1, 1], kind: 'changed', why: 'Verify the visible documentation change.',
    }],
  }));
  const server = serveRepo(repo);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  try {
    const route = `/repo/${encodeURIComponent(basename(repo))}/review?story=${encodeURIComponent('story.json')}`;
    const page = encodeURIComponent(tokenFrom(await (await fetch(`${base}${route}`)).text()));

    // The agent rewrites the story in place; lease-scoped reads must fall back
    // to the real diff underneath instead of failing.
    writeFileSync(join(repo, '.codestory', 'story.json'), '{"version":1,"title":');

    const state = await fetch(`${base}/api/review-state?page=${page}`);
    assert.equal(state.status, 200, 'review state must tolerate a story mid-rewrite');
    const stateBody = await state.json();
    assert.equal(typeof stateBody.scopeKey, 'string', 'review state carries the scope identity');
    assert.equal(typeof stateBody.currentDiffHash, 'string', 'review state carries the diff fingerprint');
    assert.ok(stateBody.feedbackHealth && stateBody.feedbackHealth.status, 'review state carries feedback health');

    const created = await fetch(`${base}/api/comments?page=${page}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'README.md', line: 1, type: 'question', severity: 'concern', body: 'Still fine?' }),
    });
    assert.equal(created.status, 201, 'comments must save while the story is mid-rewrite');
    const comment = await created.json();

    const patched = await fetch(`${base}/api/comments/${encodeURIComponent(comment.id)}?page=${page}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'nit', body: 'Still fine after the rewrite?' }),
    });
    assert.equal(patched.status, 200, 'a persisted mutation must not be reported as failed');
    assert.deepEqual(await patched.json(), { ...comment, type: 'nit', body: 'Still fine after the rewrite?' });
  } finally {
    server.close(() => {});
    rmSync(repo, { recursive: true, force: true });
  }
});
