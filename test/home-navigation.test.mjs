import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { serve } from '../dist/server.js';
import { saveRecents } from '../dist/recents.js';

function storyRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-home-nav-repo-'));
  const git = (args) => execFileSync('git', args, { cwd: repo });
  git(['init', '-q']);
  git(['config', 'user.email', 't@e.st']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(['add', '.']);
  git(['commit', '-qm', 'initial']);
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  writeFileSync(join(repo, '.codestory', 'story.json'), JSON.stringify({
    version: 1,
    title: 'Home navigation fixture',
    summary: 'Exercises the real story-to-home route.',
    base: 'HEAD',
    steps: [{
      id: 'changed-line',
      order: 1,
      title: 'Changed line',
      file: 'a.txt',
      range: [2, 2],
      kind: 'changed',
      why: 'The story page provides the logo link under test.',
    }],
  }));
  return repo;
}

test('the logo returns from an open repository to home without waiting for repo inspection', async () => {
  const repo = storyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-home-nav-home-'));
  const bin = mkdtempSync(join(tmpdir(), 'ds-home-nav-bin-'));
  const realPath = process.env.PATH;
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gitWrapper = join(bin, 'git');
  const gitLog = join(bin, 'git.log');
  writeFileSync(
    gitWrapper,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog.replaceAll('"', '\\"')}"\nexec "${realGit.replaceAll('"', '\\"')}" "$@"\n`,
  );
  chmodSync(gitWrapper, 0o755);
  writeFileSync(gitLog, '');
  saveRecents(home, [{ path: repo, lastOpened: Date.now() }]);

  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;

  try {
    const reviewHistory = await (await fetch(
      `${origin}/repo/${encodeURIComponent(basename(repo))}/stories`,
    )).text();
    // Review history is a React surface: the nav bar (and its home-pointing
    // wordmark) is rendered by `client/shared/nav.tsx`, so what this route
    // guarantees is that the surface booted at all. That the wordmark points at
    // `/repos` is asserted in test/story-picker.test.mjs; what matters HERE is
    // the Git usage measured below.
    assert.match(reviewHistory, /data-surface="stories"/, 'review history is what the repo route serves');

    process.env.PATH = `${bin}:${realPath}`;
    const response = await fetch(`${origin}/repos`);
    const html = await response.text();
    const gitCommands = readFileSync(gitLog, 'utf8').split('\n').filter(Boolean);

    assert.equal(response.status, 200);
    assert.match(html, /data-surface="picker"/);
    // Home is a picker view, so following the logo must not inspect the open
    // repository at all. Judging that by the Git commands the navigation issued
    // — rather than by how long it took — keeps the test immune to machine load.
    assert.deepEqual(
      gitCommands,
      [],
      'logo-to-home navigation waited for repository inspection',
    );
  } finally {
    process.env.PATH = realPath;
    server.close();
    await once(server, 'close');
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('repository and story navigation do not synchronously repeat Git inspection', async () => {
  const repo = storyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-nav-matrix-home-'));
  const bin = mkdtempSync(join(tmpdir(), 'ds-nav-matrix-bin-'));
  const realPath = process.env.PATH;
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gitWrapper = join(bin, 'git');
  const gitLog = join(bin, 'git.log');
  writeFileSync(
    gitWrapper,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${gitLog.replaceAll('"', '\\"')}"\nexec "${realGit.replaceAll('"', '\\"')}" "$@"\n`,
  );
  chmodSync(gitWrapper, 0o755);
  saveRecents(home, [{ path: repo, lastOpened: Date.now() }]);

  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  const repoRoute = `/repo/${encodeURIComponent(basename(repo))}`;
  // `git diff` and `git status` are the working-tree inspection this test guards;
  // everything else the server shells out for (rev-parse, ls-files, hash-object)
  // is cheap bookkeeping.
  const inspects = /^(?:diff|status)\b/;
  const navigations = [];

  // Each navigation is judged by the Git commands it actually issued, read from
  // the shim's log, rather than by how long it took. Wall-clock thresholds are a
  // race: under load a legitimate navigation crosses them and the test misfires.
  async function navigate(name, path, init, expected, inspectionBudget) {
    writeFileSync(gitLog, '');
    const response = await fetch(`${origin}${path}`, init);
    const body = await response.text();
    const gitCommands = readFileSync(gitLog, 'utf8').split('\n').filter(Boolean);
    navigations.push({
      name,
      inspectionBudget,
      inspections: gitCommands.filter((command) => inspects.test(command)),
      gitCommands,
    });
    assert.equal(response.status, 200, `${name} returns a successful page`);
    assert.match(body, expected, `${name} reaches its destination`);
  }

  try {
    process.env.PATH = `${bin}:${realPath}`;
    // Review history, home, and reopening a repository are pure navigation: they
    // must reach their destination without inspecting the working tree at all.
    await navigate('close story', `${repoRoute}/stories`, undefined, /data-surface="stories"/, 0);
    // Rendering a story is the one navigation allowed to inspect, and only once
    // — a synchronous repeat would roughly double the commands it issues.
    await navigate('open story', `${repoRoute}/review?story=story.json`, undefined, /Home navigation fixture/, 8);
    await navigate('visit home', '/repos', undefined, /data-surface="picker"/, 0);
    await navigate(
      'open repository',
      '/api/repo/open',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: repo }),
      },
      /"route":"\/repo\//,
      0,
    );

    const repeated = navigations.filter(
      ({ inspections, inspectionBudget, gitCommands }) =>
        inspections.length > inspectionBudget || gitCommands.length > 20,
    );
    assert.deepEqual(
      repeated.map(({ name, inspections, inspectionBudget, gitCommands }) =>
        `${name} ran ${inspections.length} inspection command(s) of ${gitCommands.length} Git command(s), budget ${inspectionBudget}: ${inspections.join(' | ')}`),
      [],
      'navigation repeated Git inspection',
    );
  } finally {
    process.env.PATH = realPath;
    server.close();
    await once(server, 'close');
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('closing a story keeps the next repository entry on review history', async () => {
  const repo = storyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-close-story-home-'));
  const server = serve({ repo: null, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  const repoRoute = `/repo/${encodeURIComponent(basename(repo))}`;

  async function openRepository() {
    const response = await fetch(`${origin}/api/repo/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: repo }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  try {
    assert.equal((await openRepository()).route, `${repoRoute}/stories`);

    const review = await fetch(`${origin}${repoRoute}/review?story=story.json`);
    assert.equal(review.status, 200);
    assert.match(await review.text(), /Home navigation fixture/);

    const history = await fetch(`${origin}${repoRoute}/stories`);
    assert.equal(history.status, 200);
    assert.match(await history.text(), /data-surface="stories"/);

    const homeResponse = await fetch(`${origin}/repos`);
    assert.equal(homeResponse.status, 200);
    assert.match(await homeResponse.text(), /data-surface="picker"/);

    assert.equal(
      (await openRepository()).route,
      `${repoRoute}/stories`,
      'after the reviewer closes a story, opening its repository should return to review history',
    );
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('visiting home does not strand a review restored from browser history', async () => {
  const repo = storyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-browser-history-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`;
  const repoRoute = `/repo/${encodeURIComponent(basename(repo))}`;

  try {
    const review = await fetch(`${origin}${repoRoute}/review?story=story.json`);
    assert.equal(review.status, 200);
    const html = await review.text();
    const token = html.match(/"pageToken":"([^"]+)"/)?.[1];
    assert.ok(token, 'review page receives a lease for its lazy requests');

    const picker = await fetch(`${origin}/repos`);
    assert.equal(picker.status, 200);
    assert.match(await picker.text(), /data-surface="picker"/);

    const restoredPageState = await fetch(
      `${origin}/api/review-state?page=${encodeURIComponent(token)}`,
    );
    assert.equal(
      restoredPageState.status,
      200,
      'a review restored by browser Back should keep working after the picker was visited',
    );
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
