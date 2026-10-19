// Where the server applies the diffStory → codeStory migrations: every way it
// opens a repo moves that repo's .diffstory/ into place before reading stories,
// startup copies the old app home, and leftover legacy data never shows up as a
// change under review. Only existing modules are imported here, so each test
// fails on behavior rather than on a missing export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { serve } from '../dist/server.js';
import { getDiff, reviewFileIndex } from '../dist/git.js';
import { recordRecent } from '../dist/recents.js';
import { codeStory, committedRepo, pageOf, shellPayload, withServer } from './helpers/code-story-fixture.mjs';

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A committed repo whose only story still lives under the legacy folder. */
function legacyRepo() {
  const repo = committedRepo();
  put(join(repo.dir, '.diffstory', 'stories', 'code-cap.json'), JSON.stringify(codeStory(repo.sha)));
  return repo;
}

async function withBareServer(home, fn) {
  const server = serve({ repo: null, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('a server booted on a repo migrates its legacy folder before reading stories', async () => {
  const { dir } = legacyRepo();
  try {
    await withServer(dir, async (base) => {
      assert.ok(existsSync(join(dir, '.codestory', 'stories', 'code-cap.json')), 'the story moved into .codestory/');
      assert.equal(existsSync(join(dir, '.diffstory')), false);
      const payload = await pageOf(base, dir, '/stories');
      assert.deepEqual(payload.stories.map((story) => story.id), ['stories/code-cap.json']);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opening a repo from the picker migrates its legacy folder first', async () => {
  const { dir } = legacyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-legacy-open-home-'));
  try {
    await withBareServer(home, async (base) => {
      const res = await fetch(`${base}/api/repo/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).hasTour, true, 'the picker sees the migrated story');
      assert.ok(existsSync(join(dir, '.codestory', 'stories', 'code-cap.json')));
      assert.equal(existsSync(join(dir, '.diffstory')), false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('reopening a remembered repo route migrates its legacy folder first', async () => {
  const { dir } = legacyRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-legacy-route-home-'));
  try {
    recordRecent(home, dir, Date.now());
    await withBareServer(home, async (base) => {
      const html = await (await fetch(`${base}/repo/${encodeURIComponent(basename(dir))}/stories`)).text();
      assert.ok(existsSync(join(dir, '.codestory', 'stories', 'code-cap.json')));
      assert.deepEqual(shellPayload(html).stories.map((story) => story.id), ['stories/code-cap.json']);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('server start copies the old app home, so recents survive the rename', async () => {
  const { dir } = committedRepo();
  const home = mkdtempSync(join(tmpdir(), 'ds-legacy-home-'));
  try {
    const recents = JSON.stringify([{ path: dir, lastOpened: Date.now(), name: basename(dir), isGit: true }]);
    put(join(home, '.diffstory', 'recents.json'), recents);
    await withBareServer(home, async (base) => {
      const picker = shellPayload(await (await fetch(`${base}/`)).text());
      assert.deepEqual(picker.recents.map((row) => row.path), [dir]);
    });
    assert.equal(readFileSync(join(home, '.codestory', 'recents.json'), 'utf8'), recents);
    assert.equal(readFileSync(join(home, '.diffstory', 'recents.json'), 'utf8'), recents, 'the old file is copied, not moved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('a legacy data folder never shows up as a change under review', () => {
  const { dir } = committedRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    // Shared mode commits story.json, so moving the folder deletes a tracked file.
    put(join(dir, '.diffstory', 'story.json'), '{"version":3}\n');
    git('add', '.diffstory/story.json');
    git('commit', '-qm', 'share the story');
    renameSync(join(dir, '.diffstory'), join(dir, '.codestory'));
    // A conflict a merge-move left behind is untracked legacy data.
    put(join(dir, '.diffstory', 'stories', 'kept.json'), '{}\n');
    const app = join(dir, 'app.ts');
    writeFileSync(app, readFileSync(app, 'utf8').replace('v5 = 5;', 'v5 = 50;'));

    const diff = getDiff(dir, 'HEAD');
    assert.match(diff, /^diff --git a\/app\.ts b\/app\.ts$/m);
    assert.doesNotMatch(diff, /\.(diffstory|codestory)\//);
    assert.deepEqual(reviewFileIndex(dir, 'HEAD').map((file) => file.path), ['app.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
