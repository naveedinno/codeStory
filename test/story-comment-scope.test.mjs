// Integration test: feedback and the saved reading position are scoped to the story
// they belong to, and the chosen story survives a restart. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { serve } from '../dist/server.js';
import { loadComments } from '../dist/comments.js';
import { recallStorySelection } from '../dist/story-selection.js';

function writeStory(repo, rel, title, file, includedFiles) {
  const path = join(repo, '.codestory', rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      title,
      summary: `${title} summary`,
      base: 'HEAD',
      ...(includedFiles ? { storyScope: { includedFiles } } : {}),
      steps: [
        {
          id: 's1',
          order: 1,
          title: `Entry point in ${file}`,
          file,
          range: [2, 2],
          kind: 'changed',
          why: 'The added line.',
        },
      ],
    }),
  );
}

/** A repo with an uncommitted change in two files and one scoped story per file. */
function repoWithTwoScopedStories() {
  const d = mkdtempSync(join(tmpdir(), 'ds-scope-'));
  const g = (a) => execFileSync('git', a, { cwd: d });
  g(['init', '-q']);
  g(['config', 'user.email', 't@e.st']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(d, 'a.txt'), 'one\n');
  writeFileSync(join(d, 'b.txt'), 'one\n');
  g(['add', '.']);
  g(['commit', '-qm', 'init']);
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(d, 'b.txt'), 'one\ntwo\n');
  writeStory(d, 'stories/alpha.json', 'Alpha concern', 'a.txt', ['a.txt']);
  writeStory(d, 'stories/beta.json', 'Beta concern', 'b.txt', ['b.txt']);
  return d;
}

async function boot(repo, home) {
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  return { server, base: `http://localhost:${server.address().port}` };
}

const route = (repo) => `/repo/${encodeURIComponent(basename(repo))}`;

async function selectStory(base, repo, id) {
  const res = await fetch(`${base}${route(repo)}/review?story=${encodeURIComponent(id)}`);
  assert.equal(res.status, 200);
  await res.text();
}

async function postComment(base, file, body) {
  const res = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, line: 2, type: 'change', body }),
  });
  assert.equal(res.status, 201, `posting "${body}" should succeed`);
  return res.json();
}

async function listComments(base) {
  const res = await fetch(`${base}/api/comments`);
  assert.equal(res.status, 200);
  return res.json();
}

test('each story in one review scope keeps its own saved reading position', async () => {
  const repo = repoWithTwoScopedStories();
  const home = mkdtempSync(join(tmpdir(), 'ds-scope-home-'));
  const { server, base } = await boot(repo, home);
  const openStory = async (id) => {
    const res = await fetch(`${base}${route(repo)}/review?story=${encodeURIComponent(id)}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const payload = JSON.parse(html.match(/id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/)[1]);
    return {
      // Both halves of the reading-position key, straight out of the payload.
      scope: payload.reviewScope,
      story: payload.storyKey,
    };
  };
  try {
    const alpha = await openStory('stories/alpha.json');
    const beta = await openStory('stories/beta.json');

    // Both stories describe the same working tree, so scope alone cannot tell them apart.
    assert.equal(alpha.scope, beta.scope, 'both stories review the same base..head scope');
    assert.ok(alpha.story, 'the page names the story its reading position belongs to');
    assert.notEqual(
      alpha.story,
      beta.story,
      'a step saved while reading one story must not restore into the other',
    );

    // Reopening the same story must land in the same slot, or resuming never works.
    assert.deepEqual(await openStory('stories/alpha.json'), alpha);

    // Regenerating a story rewrites its steps: step 3 is no longer the same step.
    writeStory(repo, 'stories/alpha.json', 'Alpha concern, retold', 'a.txt', ['a.txt']);
    const retold = await openStory('stories/alpha.json');
    assert.equal(retold.scope, alpha.scope);
    assert.notEqual(retold.story, alpha.story, 'a rewritten story starts from its own beginning');
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('feedback filed on one story is invisible to the other', async () => {
  const repo = repoWithTwoScopedStories();
  const home = mkdtempSync(join(tmpdir(), 'ds-scope-home-'));
  const { server, base } = await boot(repo, home);
  try {
    await selectStory(base, repo, 'stories/alpha.json');
    const onAlpha = await postComment(base, 'a.txt', 'alpha feedback');
    assert.equal(onAlpha.story, 'stories/alpha.json', 'the server tags the comment with the active story');

    assert.deepEqual((await listComments(base)).map((c) => c.body), ['alpha feedback']);

    await selectStory(base, repo, 'stories/beta.json');
    assert.deepEqual((await listComments(base)).map((c) => c.body), [], 'beta does not see alpha feedback');

    const onBeta = await postComment(base, 'b.txt', 'beta feedback');
    assert.equal(onBeta.story, 'stories/beta.json');
    assert.deepEqual((await listComments(base)).map((c) => c.body), ['beta feedback']);

    await selectStory(base, repo, 'stories/alpha.json');
    assert.deepEqual((await listComments(base)).map((c) => c.body), ['alpha feedback']);

    // Both live in one comments.json — the split is a read-time scope, not separate files.
    assert.deepEqual(loadComments(repo).map((c) => c.story), ['stories/alpha.json', 'stories/beta.json']);
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('comments written before stories were separable stay visible in every story', async () => {
  const repo = repoWithTwoScopedStories();
  const home = mkdtempSync(join(tmpdir(), 'ds-scope-home-'));
  // Exactly what a pre-multi-story repo has on disk.
  writeFileSync(
    join(repo, '.codestory', 'comments.json'),
    JSON.stringify([
      { id: 'c_legacy', file: 'a.txt', line: 2, type: 'change', body: 'legacy feedback', status: 'open', createdAt: 'x' },
    ]),
  );
  const { server, base } = await boot(repo, home);
  try {
    await selectStory(base, repo, 'stories/alpha.json');
    assert.deepEqual((await listComments(base)).map((c) => c.body), ['legacy feedback']);

    await selectStory(base, repo, 'stories/beta.json');
    assert.deepEqual(
      (await listComments(base)).map((c) => c.body),
      ['legacy feedback'],
      'untagged feedback belongs to every story',
    );

    // And it is never rewritten on disk to achieve that.
    const onDisk = JSON.parse(readFileSync(join(repo, '.codestory', 'comments.json'), 'utf8'));
    assert.ok(!('story' in onDisk[0]), 'the existing comment file is left exactly as it was');
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('opening a repo shows story history even when a prior story is remembered', async () => {
  const repo = repoWithTwoScopedStories();
  const home = mkdtempSync(join(tmpdir(), 'ds-scope-home-'));
  const first = await boot(repo, home);
  try {
    await selectStory(first.base, repo, 'stories/beta.json');
    assert.equal(recallStorySelection(home, repo), 'stories/beta.json');
  } finally {
    first.server.close();
  }

  // A fresh server process, same home: choosing the repository still opens its
  // history. The remembered story must never bypass the explicit story list.
  const second = await boot(null, home);
  try {
    const opened = await fetch(`${second.base}/api/repo/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: repo }),
    });
    assert.equal(opened.status, 200);
    const openedState = await opened.json();
    assert.equal(openedState.route, `${route(repo)}/stories`);

    const history = await fetch(`${second.base}${openedState.route}`);
    assert.equal(history.status, 200);
    assert.match(await history.text(), /data-surface="stories"/);

    await selectStory(second.base, repo, 'stories/beta.json');
    const posted = await postComment(second.base, 'b.txt', 'after restart');
    assert.equal(posted.story, 'stories/beta.json', 'an explicitly opened story owns new feedback');
  } finally {
    second.server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
