// Code stories through the app server: generation requests, the finish gate,
// and the pages that read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { finishStoryGeneration, prepareCodeStoryOutput, serve } from '../dist/server.js';

/** A repo on `main` with a 30-line app.ts committed. */
function committedRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-code-server-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const lines = Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
  writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { dir, lines, sha: git('rev-parse', 'HEAD').trim() };
}

function codeStory(sha, over = {}) {
  return {
    version: 4,
    subject: 'code',
    head: sha,
    mode: 'guided',
    title: 'How the funding rate is capped',
    summary: 'One helper caps the rate before settlement.',
    intent: {
      goal: 'You want to know how a rate above the market cap is stopped.',
      design: 'Settlement calls <code>capRate()</code>, which clamps the rate at the cap.',
      sources: ['code-derived'],
    },
    storyArc: { shape: 'entry-implementation', readingPath: 'helper -> cap' },
    steps: [{
      id: 's1', order: 1, kind: 'context', title: 'capRate() clamps the rate at the cap',
      file: 'app.ts', range: [10, 10], viewport: [5, 15], highlights: [[10, 10]],
      why: 'Rules out a rate above the cap reaching settlement.',
      beats: [{ text: 'This is <code>capRate()</code>, the helper settlement calls per market; it clamps the rate at the cap.', highlights: [[10, 10]] }],
    }],
    ...over,
  };
}

function writeCodeStory(dir, story, name = 'code-cap.json') {
  mkdirSync(join(dir, '.codestory', 'stories'), { recursive: true });
  const path = join(dir, '.codestory', 'stories', name);
  writeFileSync(path, JSON.stringify(story));
  return path;
}

async function boot(repo) {
  const home = mkdtempSync(join(tmpdir(), 'ds-code-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  server.once('close', () => rmSync(home, { recursive: true, force: true }));
  await once(server, 'listening');
  return { server, base: `http://localhost:${server.address().port}` };
}

async function withServer(repo, fn) {
  const app = await boot(repo);
  try {
    await fn(app.base);
  } finally {
    app.server.close();
    await once(app.server, 'close');
  }
}

/**
 * POST a request the server must refuse before any agent runs. A 2xx means a
 * real agent run started, so the request is aborted at once (which stops the
 * run) and the test fails, instead of waiting out a live agent.
 */
async function postRefusal(url, body) {
  const controller = new AbortController();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (res.ok) {
    controller.abort();
    assert.fail(`expected ${url} to refuse the request, but it started an agent run`);
  }
  return { status: res.status, body: await res.json() };
}

test('code story generation refuses a ref that is not a commit', async () => {
  const { dir } = committedRepo();
  try {
    await withServer(dir, async (base) => {
      const { status, body } = await postRefusal(`${base}/api/generate/code`, { ref: 'no-such-branch', question: 'How is the rate capped?' });
      assert.equal(status, 400);
      assert.equal(body.label, 'Invalid code story request');
      assert.match(body.detail, /"no-such-branch" is not a commit in this repository/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code story generation refuses focus paths missing at the commit', async () => {
  const { dir, sha } = committedRepo();
  try {
    await withServer(dir, async (base) => {
      const { status, body } = await postRefusal(`${base}/api/generate/code`, { paths: ['app.ts', 'src/missing.ts'] });
      assert.equal(status, 400);
      assert.equal(body.detail, `src/missing.ts does not exist at ${sha.slice(0, 7)}.`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code story generation refuses to rewrite something that is not a code story', async () => {
  const { dir } = committedRepo();
  try {
    await withServer(dir, async (base) => {
      const { status, body } = await postRefusal(`${base}/api/generate/code`, { storyId: 'story.json' });
      assert.equal(status, 400);
      assert.equal(body.detail, 'That code story could not be found.');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prepareCodeStoryOutput stamps the pinned commit and the request', () => {
  const { dir, sha } = committedRepo();
  try {
    const path = writeCodeStory(dir, { version: 3, title: 'Agent output', summary: '', steps: [] });
    prepareCodeStoryOutput(path, { commit: sha, ref: 'main', question: 'How is the rate capped?', paths: ['app.ts'] });
    const stamped = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(stamped.version, 4);
    assert.equal(stamped.subject, 'code');
    assert.equal(stamped.head, sha);
    assert.equal(stamped.base, sha);
    assert.deepEqual(stamped.codeScope, { ref: 'main', question: 'How is the rate capped?', paths: ['app.ts'] });
    assert.equal(stamped.title, 'Agent output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finishing a code story rejects steps missing at its commit', () => {
  const { dir, sha } = committedRepo();
  try {
    const story = codeStory(sha);
    story.steps[0].file = 'missing.ts';
    const path = writeCodeStory(dir, story);
    const session = { repo: dir, chooseStory: true };
    const out = finishStoryGeneration({ ok: true, output: '' }, path, session, null, {
      validateModern: true,
      requireStoryArc: true,
      codeStory: true,
    });
    assert.equal(out.status, 'failed');
    assert.ok(
      out.events.some((event) => /missing\.ts does not exist at [0-9a-f]{7}/.test(event.technicalDetail ?? '')),
      JSON.stringify(out.events),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a finished code story reports its story id and becomes the selected story', () => {
  const { dir, sha } = committedRepo();
  try {
    const path = writeCodeStory(dir, codeStory(sha));
    const session = { repo: dir, chooseStory: true };
    const out = finishStoryGeneration({ ok: true, output: '' }, path, session, null, {
      validateModern: true,
      requireStoryArc: true,
      codeStory: true,
    });
    assert.equal(out.status, 'complete', JSON.stringify(out.events));
    assert.deepEqual(out.result, { storyWritten: true, storyValid: true, storyId: 'stories/code-cap.json' });
    assert.equal(session.selectedStory, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the review page reads a code story at its pinned commit ----

const shellPayload = (html) => JSON.parse(html.match(/id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/)[1]);
const routeBase = (dir) => `/repo/${encodeURIComponent(basename(dir))}`;
const pageOf = async (base, dir, path) => shellPayload(await (await fetch(`${base}${routeBase(dir)}${path}`)).text());

test('a code story opens at its pinned commit even with a diff scope in the URL', async () => {
  const { dir, sha, lines } = committedRepo();
  try {
    // The code moves on twice: a later commit and an uncommitted edit both touch app.ts.
    lines[9] = 'export const v10 = 1000;';
    writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
    execFileSync('git', ['commit', '-qam', 'later'], { cwd: dir });
    lines[24] = 'export const v25 = 2500;';
    writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
    writeCodeStory(dir, codeStory(sha));
    await withServer(dir, async (base) => {
      const payload = await pageOf(base, dir, '/review?story=stories/code-cap.json&scope=uncommitted');
      assert.equal(payload.subject, 'code');
      assert.equal(payload.headRef, sha);
      assert.equal(payload.baseRef, sha);
      assert.equal(payload.filesChanged, 0);
      assert.ok(payload.files.length > 0);
      assert.ok(payload.files.every((file) => file.kind === 'context'), JSON.stringify(payload.files));
      // The step itself renders the pinned commit's line, not HEAD's or the working tree's.
      const panel = await (
        await fetch(`${base}/api/review/step-panel?index=1&page=${encodeURIComponent(payload.pageToken)}`)
      ).text();
      assert.match(panel, /v10 = 10;/);
      assert.doesNotMatch(panel, /v10 = 1000/);
      // The panel names what the code is: the story's commit, not "context" for a change.
      assert.match(panel, new RegExp(`as committed at ${sha.slice(0, 7)}`));
      assert.doesNotMatch(panel, /shown so the change makes sense/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code story payloads label code steps and hide coverage', async () => {
  const { dir, sha } = committedRepo();
  try {
    writeCodeStory(dir, codeStory(sha, { codeScope: { ref: 'main', question: 'How is the rate capped?' } }));
    await withServer(dir, async (base) => {
      const payload = await pageOf(base, dir, '/review?story=stories/code-cap.json');
      assert.equal(payload.steps[0].kindLabel, 'Code');
      assert.equal(payload.files[0].kindLabel, 'Code');
      assert.equal(payload.chrome.showTrustPill, false);
      assert.equal(payload.storyFreshness, 'current');
      assert.equal(payload.story.arc.changeTypeLabel, 'Code story');
      assert.deepEqual(payload.code, {
        commit: sha,
        shortCommit: sha.slice(0, 7),
        ref: 'main',
        label: `main @ ${sha.slice(0, 7)}`,
        storyId: 'stories/code-cap.json',
        question: 'How is the rate capped?',
        paths: [],
        drift: { state: 'current', files: [] },
      });
      const diffPage = await pageOf(base, dir, '/diff');
      assert.equal(diffPage.subject, 'diff');
      assert.equal(diffPage.code, undefined);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the review page reports visited files that changed since the commit', async () => {
  const { dir, sha, lines } = committedRepo();
  try {
    writeCodeStory(dir, codeStory(sha));
    writeFileSync(join(dir, 'app.ts'), lines.slice(1).join('\n') + '\n');
    await withServer(dir, async (base) => {
      const payload = await pageOf(base, dir, '/review?story=stories/code-cap.json');
      assert.deepEqual(payload.code.drift, { state: 'changed', files: ['app.ts'] });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the Explain code page ----

test('the explain page carries the branch, head commit, and defaults', async () => {
  const { dir, sha, lines } = committedRepo();
  try {
    // A saved code story is an untracked app file, not an uncommitted change.
    writeCodeStory(dir, codeStory(sha));
    await withServer(dir, async (base) => {
      const html = await (await fetch(`${base}${routeBase(dir)}/explain`)).text();
      assert.match(html, /data-surface="explain"/);
      const payload = shellPayload(html);
      assert.equal(payload.branch, 'main');
      assert.equal(payload.headCommit, sha);
      assert.equal(payload.headSubject, `${sha.slice(0, 7)} base`);
      assert.equal(payload.dirty, false);
      assert.deepEqual(payload.defaults, { mode: 'guided', audience: 'newcomer' });
      assert.equal(payload.prefill, undefined);
      writeFileSync(join(dir, 'app.ts'), [...lines, '// edit'].join('\n') + '\n');
      assert.equal((await pageOf(base, dir, '/explain')).dirty, true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the explain page pre-fills a rewrite from a code story', async () => {
  const { dir, sha } = committedRepo();
  try {
    writeCodeStory(dir, codeStory(sha, { codeScope: { ref: 'main', question: 'How is the rate capped?', paths: ['app.ts'] } }));
    await withServer(dir, async (base) => {
      const payload = await pageOf(base, dir, '/explain?story=stories/code-cap.json');
      assert.deepEqual(payload.prefill, {
        storyId: 'stories/code-cap.json',
        title: 'How the funding rate is capped',
        question: 'How is the rate capped?',
        paths: ['app.ts'],
        ref: 'main',
        mode: 'guided',
      });
      const unknown = await pageOf(base, dir, '/explain?story=stories/nope.json');
      assert.equal(unknown.prefill, undefined);
      assert.equal(unknown.notice, 'That code story could not be found, so this starts a new one.');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repairing a code story refuses explain, which only fits a diff', async () => {
  const { dir, sha } = committedRepo();
  try {
    writeCodeStory(dir, codeStory(sha));
    await withServer(dir, async (base) => {
      await pageOf(base, dir, '/review?story=stories/code-cap.json');
      const { status, body } = await postRefusal(`${base}/api/story/repair`, { action: 'explain', file: 'app.ts', line: 10 });
      assert.equal(status, 400);
      assert.equal(body.detail, 'A code story has no uncovered change to explain. Rewrite, shorten, or split a step instead.');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code story generation refuses a ref too long to keep, before any run', async () => {
  const { dir } = committedRepo();
  try {
    await withServer(dir, async (base) => {
      const { status, body } = await postRefusal(`${base}/api/generate/code`, { ref: 'HEAD' + '~0'.repeat(100) });
      assert.equal(status, 400);
      assert.equal(body.detail, 'Keep the ref under 200 characters.');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a question with generics survives the finish gate', () => {
  const { dir, sha } = committedRepo();
  try {
    const path = writeCodeStory(dir, codeStory(sha));
    prepareCodeStoryOutput(path, { commit: sha, ref: 'main', question: 'How is Map<K, V> used in settle()?', paths: [] });
    const out = finishStoryGeneration({ ok: true, output: '' }, path, { repo: dir, chooseStory: true }, null, {
      validateModern: true,
      requireStoryArc: true,
      codeStory: true,
    });
    assert.equal(out.status, 'complete', JSON.stringify(out.events));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a story whose commit is missing says so instead of blaming its files', async () => {
  const { dir } = committedRepo();
  try {
    writeCodeStory(dir, codeStory('f'.repeat(40)));
    await withServer(dir, async (base) => {
      const payload = await pageOf(base, dir, '/review?story=stories/code-cap.json');
      assert.deepEqual(payload.code.drift, { state: 'missing-commit', files: [] });
      assert.ok(
        payload.health.findings.some((f) => /head fffffff is not a commit in this repository/.test(f.message)),
        JSON.stringify(payload.health),
      );
      assert.ok(payload.health.errors >= 1);
      const panel = await (
        await fetch(`${base}/api/review/step-panel?index=1&page=${encodeURIComponent(payload.pageToken)}`)
      ).text();
      assert.match(panel, /not readable at fffffff: that commit is not in this repository/);
      assert.doesNotMatch(panel, /file not found/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- failed runs leave the reader with the story they had ----

const BROKEN = JSON.stringify({ version: 4, subject: 'code', title: 'broken output', summary: '', steps: [] });

test('a failed rewrite restores the story the reader had', async () => {
  const { runToEnd, withFakeWriter } = await import('./helpers/code-story-fixture.mjs');
  const { dir, sha } = committedRepo();
  try {
    const path = writeCodeStory(dir, codeStory(sha));
    const before = readFileSync(path, 'utf8');
    await withFakeWriter(BROKEN, () =>
      withServer(dir, async (base) => {
        const done = await runToEnd(`${base}/api/generate/code`, { storyId: 'stories/code-cap.json', agent: 'claude' });
        assert.equal(done.status, 'failed', JSON.stringify(done));
      }),
    );
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed new code story leaves no broken story behind', async () => {
  const { runToEnd, withFakeWriter } = await import('./helpers/code-story-fixture.mjs');
  const { dir } = committedRepo();
  try {
    await withFakeWriter(BROKEN, () =>
      withServer(dir, async (base) => {
        const done = await runToEnd(`${base}/api/generate/code`, { question: 'How is the rate capped?', agent: 'claude' });
        assert.equal(done.status, 'failed', JSON.stringify(done));
      }),
    );
    assert.equal(existsSync(join(dir, '.codestory', 'stories', 'code-how-is-the-rate-capped.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed code story repair restores the story the reader had', async () => {
  const { runToEnd, withFakeWriter } = await import('./helpers/code-story-fixture.mjs');
  const { dir, sha } = committedRepo();
  try {
    const path = writeCodeStory(dir, codeStory(sha));
    const before = readFileSync(path, 'utf8');
    await withFakeWriter(BROKEN, () =>
      withServer(dir, async (base) => {
        await pageOf(base, dir, '/review?story=stories/code-cap.json');
        const done = await runToEnd(`${base}/api/story/repair`, { action: 'rewrite', stepId: 's1', agent: 'claude' });
        assert.equal(done.status, 'failed', JSON.stringify(done));
      }),
    );
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new code story can be asked for while a history snapshot is open', async () => {
  const { dir, sha } = committedRepo();
  try {
    const snapshot = 'code-cap-20261019T000000-abcdef12.json';
    mkdirSync(join(dir, '.codestory', 'history'), { recursive: true });
    writeFileSync(join(dir, '.codestory', 'history', snapshot), JSON.stringify(codeStory(sha)));
    await withServer(dir, async (base) => {
      await pageOf(base, dir, `/review?story=history/${snapshot}`);
      // A new story writes a fresh file and mutates nothing the snapshot froze.
      const { status, body } = await postRefusal(`${base}/api/generate/code`, { ref: 'no-such-branch' });
      assert.equal(status, 400, JSON.stringify(body));
      assert.match(body.detail, /is not a commit in this repository/);
      // A rewrite still names its live story explicitly and refuses snapshots.
      const rewrite = await postRefusal(`${base}/api/generate/code`, { storyId: `history/${snapshot}` });
      assert.equal(rewrite.status, 400);
      assert.equal(rewrite.body.detail, 'That code story could not be found.');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
