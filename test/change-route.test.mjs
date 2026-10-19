// Integration test: opening a repo lands on the current change; saved reviews remain explicit. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { serve } from '../dist/server.js';

function reviewPageToken(html) {
  // The page facts travel in the shell's JSON payload now; React stamps them
  // onto <body> at mount, so the server response no longer carries them.
  const match = html.match(/"pageToken":"([^"]+)"/);
  assert.ok(match?.[1], 'review page issues a lazy-evidence token');
  return match[1];
}

function repoWithChange() {
  const d = mkdtempSync(join(tmpdir(), 'ds-cr-'));
  const g = (a) => execFileSync('git', a, { cwd: d });
  g(['init', '-q']); g(['config', 'user.email', 't@e.st']); g(['config', 'user.name', 'T']);
  writeFileSync(join(d, 'a.txt'), 'one\n'); g(['add', '.']); g(['commit', '-qm', 'init']);
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\n'); // uncommitted change, no tour
  return d;
}

function repoWithCommittedHeadStory() {
  const d = mkdtempSync(join(tmpdir(), 'ds-cr-'));
  const g = (a) => execFileSync('git', a, { cwd: d });
  g(['init', '-q']); g(['config', 'user.email', 't@e.st']); g(['config', 'user.name', 'T']);
  writeFileSync(join(d, 'a.txt'), 'one\n'); g(['add', '.']); g(['commit', '-qm', 'init']);
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\n');
  writeStory(d);
  g(['add', '.']); g(['commit', '-qm', 'save story and change']);
  return d;
}

function repoWithHistoricalHeadStoryAndMovedWorkingTree() {
  const d = mkdtempSync(join(tmpdir(), 'ds-cr-'));
  const g = (a) => execFileSync('git', a, { cwd: d });
  g(['init', '-q']); g(['config', 'user.email', 't@e.st']); g(['config', 'user.name', 'T']);
  writeFileSync(join(d, 'a.txt'), 'base-one\n');
  g(['add', '.']); g(['commit', '-qm', 'base']);
  writeFileSync(join(d, 'a.txt'), 'head-one\nhead-two\n');
  g(['add', '.']); g(['commit', '-qm', 'head story target']);
  writeStory(d, {
    title: 'Historical story',
    summary: 'A story against an old head.',
    base: 'HEAD~1',
    head: 'HEAD',
    steps: [
      {
        id: 'context',
        order: 1,
        title: 'Context from the reviewed head',
        file: 'a.txt',
        range: [1, 1],
        kind: 'context',
        why: 'This line should come from the committed head side, not the live tree.',
      },
      {
        id: 'changed',
        order: 2,
        title: 'Changed line',
        file: 'a.txt',
        range: [2, 2],
        kind: 'changed',
        why: 'This is the added line in the historical head.',
      },
    ],
  });
  writeFileSync(join(d, 'a.txt'), 'live-one\nlive-two\n'); // current working tree moved on
  return d;
}

function writeStory(repo, body = {}, rel = 'story.json') {
  const path = join(repo, '.codestory', rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      title: 'Saved story',
      summary: 'A saved story for this repo',
      base: 'HEAD',
      steps: [
        {
          id: 's1',
          order: 1,
          title: 'Entry point',
          file: 'a.txt',
          range: [2, 2],
          kind: 'changed',
          why: 'Start at the changed line.',
        },
      ],
      ...body,
    }),
  );
}

async function boot() {
  const server = serve({ repo: null, port: 0, open: false });
  await once(server, 'listening');
  return { server, base: `http://localhost:${server.address().port}` };
}

async function bootRepo(repo) {
  const server = serve({ repo, port: 0, open: false });
  await once(server, 'listening');
  return { server, base: `http://localhost:${server.address().port}` };
}

function repoRoute(repo) {
  return `/repo/${encodeURIComponent(basename(repo))}`;
}

/**
 * The initial state a React surface boots from.
 *
 * The rewritten routes serve a shell plus one `application/json` block instead
 * of a finished document, so an integration assertion that used to look for a
 * rendered string looks for the value that produces it. Anything still
 * server-rendered (the review page) keeps its plain HTML assertions.
 */
function shellPayload(html) {
  const match = /<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'the shell must embed exactly one __CODESTORY_DATA__ block');
  return JSON.parse(match[1]);
}

test('opening a repo starts from review history and keeps the current change available', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  const { server, base } = await boot();
  try {
    const opened = await fetch(`${base}/api/repo/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }),
    });
    const route = repoRoute(repo);
    const state = await opened.json();
    assert.equal(state.route, `${route}/stories`, 'repo selection points to review history');
    const html = await (await fetch(`${base}${state.route}`)).text();
    const history = shellPayload(html);
    assert.deepEqual(history.stories, [], 'shows the empty review-history state');
    assert.equal(
      history.routeBase,
      route,
      'keeps a path back to the current change, on this repo\'s own named route',
    );
    assert.ok(!html.includes('Generate guided review'), 'does not jump straight to generation');

    const next = await (await fetch(`${base}${route}/change`)).text();
    assert.ok(!next.includes('Generate guided review'), 'the scope picker does not duplicate story generation');
    // The scope picker is a React surface: the route base it builds its
    // "Review N files" link from, and the changed file it lists, both travel in
    // the payload rather than in server-rendered markup.
    const scope = shellPayload(next);
    assert.equal(scope.routeBase, route, 'the scope picker links to the review viewer under its own repo route');
    assert.deepEqual(
      scope.files.map((file) => file.path),
      ['a.txt'],
      'the scope picker shows the changed file',
    );

    const diff = await (await fetch(`${base}${route}/diff`)).text();
    assert.ok(diff.includes('data-surface="review"'), '/diff renders the real review page');
    const diffPayload = shellPayload(diff);
    assert.equal(diffPayload.storyless, true, 'with no story');
    assert.deepEqual(diffPayload.files.map((file) => file.file), ['a.txt'], '/diff shows the changed file');

    const again = await (await fetch(`${base}${route}/stories`)).text();
    assert.ok(again.includes('data-surface="stories"'), 'explicit sessions route still returns to the chooser');
    assert.ok(!again.includes("Couldn't build the review"), 'is not the error page');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('starting with a repo lands on history and lists the primary story', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  writeStory(repo);
  const { server, base } = await bootRepo(repo);
  try {
    const route = repoRoute(repo);
    const entry = await fetch(`${base}/`);
    assert.equal(entry.url, `${base}${route}/stories`);
    const html = await entry.text();
    assert.ok(html.includes('data-surface="stories"'), 'starts with the saved review overview');
    const history = shellPayload(html);
    assert.equal(history.stories[0].title, 'Saved story', 'lists the primary saved story');
    assert.equal(history.stories[0].id, 'story.json', 'and the review link is built from its id');
    assert.equal(history.routeBase, route, 'on this repo\'s own named route');
    // The badge and the "Refresh evidence" link are rendered client-side now,
    // so the load-bearing half of that pair is the flag they are driven from.
    assert.equal(
      history.liveEvidence,
      false,
      'history renders authored metadata without blocking on live Git evidence',
    );

    const refreshed = shellPayload(await (await fetch(`${base}${route}/stories?evidence=refresh`)).text());
    assert.equal(
      refreshed.liveEvidence,
      true,
      'explicit refresh replaces metadata-only state with live evidence',
    );
    assert.ok(
      refreshed.stories[0].additions > 0,
      'and the expensive pass actually ran — the metadata projection cannot see the working tree',
    );

    // The picker is a React surface now: the route serves a shell plus a JSON
    // payload, so the old markup assertions (`Add repository`, `#quickAddBtn`)
    // no longer describe anything. The intent is unchanged — switching repo
    // must land on the picker, and that picker must be able to open a folder.
    const picker = await (await fetch(`${base}/repos`)).text();
    assert.ok(picker.includes('data-surface="picker"'), 'switch repo returns to the app picker');
    assert.ok(picker.includes('/assets/client/picker.js'), 'the picker surface boots its own bundle');
    const payload = JSON.parse(
      picker.match(/<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/)[1],
    );
    assert.ok(Array.isArray(payload.recents), 'the picker is handed its recents list');
    assert.ok(typeof payload.home === 'string' && payload.home, 'repo picker can open another folder');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('review history is the repo entry and lists named stories without a primary story', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  writeStory(repo, { title: 'Named saved story', summary: 'A named saved story for this repo' }, 'stories/native.json');
  const { server, base } = await bootRepo(repo);
  try {
    const route = repoRoute(repo);
    const entry = await fetch(`${base}/`);
    assert.equal(entry.url, `${base}${route}/stories`);
    const html = await entry.text();
    const history = shellPayload(html);
    assert.equal(history.stories[0].title, 'Named saved story', 'lists the named saved story');
    // The row builds `?story=` with encodeURIComponent, so the id travels raw
    // and the nested path survives the round trip.
    assert.equal(history.stories[0].id, 'stories/native.json');
    assert.equal(encodeURIComponent(history.stories[0].id), 'stories%2Fnative.json');
    assert.equal(history.routeBase, route, 'named story has its own repo-named review route');
    assert.equal(history.stories.length, 1, 'does not show the empty story state');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('a committed story generated against HEAD still opens the committed diff', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithCommittedHeadStory();
  const { server, base } = await bootRepo(repo);
  try {
    const review = await (await fetch(`${base}${repoRoute(repo)}/review?story=story.json`)).text();
    const story = shellPayload(review);
    assert.ok(story.steps.some((step) => step.title.text.includes('Entry point')), 'opens the selected story');
    // The diff itself is lazy now, so the committed row is proved by asking for
    // it the way the page does rather than by grepping the initial document.
    const panel = await (await fetch(
      // Panel indexes are 1-based; panel 0 is the Overview.
      `${base}/api/review/step-panel?index=1&page=${encodeURIComponent(story.pageToken)}`,
    )).text();
    assert.ok(panel.includes('ds-row-add'), 'shows the committed added line');
    assert.ok(!panel.includes('no diff for this range'), 'does not fall back to current-file context');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('a historical committed story reads context and full-file content from its head ref', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithHistoricalHeadStoryAndMovedWorkingTree();
  const { server, base } = await bootRepo(repo);
  try {
    const route = repoRoute(repo);
    const review = await (await fetch(`${base}${route}/review?story=story.json`)).text();
    assert.ok(review.includes('Historical story'), 'opens the selected story');

    const token = reviewPageToken(review);
    const context = await (await fetch(
      `${base}/api/review/step-panel?index=1&page=${encodeURIComponent(token)}`,
    )).text();
    assert.ok(context.includes('head-one'), 'lazy context step reads the story head side');
    assert.ok(!context.includes('live-one'), 'lazy context step does not read the live working tree');

    const full = await (await fetch(`${base}/api/fullfile?file=a.txt&page=${encodeURIComponent(token)}`)).text();
    assert.ok(full.includes('head-two'), 'full-file view reads the story head side');
    assert.ok(!full.includes('live-two'), 'full-file view does not read the live working tree');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('opening a repo with a saved story lets the user select it', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  writeStory(repo);
  const { server, base } = await boot();
  try {
    await fetch(`${base}/api/repo/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }),
    });
    const route = repoRoute(repo);
    const chooserHtml = await (await fetch(`${base}${route}/stories`)).text();
    assert.ok(chooserHtml.includes('data-surface="stories"'), 'shows review-session selection');
    const chooser = shellPayload(chooserHtml);
    assert.equal(chooser.stories[0].title, 'Saved story', 'lists the saved story');
    assert.equal(chooser.stories[0].scope.label, 'Working tree vs HEAD', 'explains the diff scope');
    assert.equal(chooser.stories[0].scope.command, 'git diff HEAD --', 'shows the underlying diff command');
    assert.equal(chooser.stories[0].id, 'story.json', 'saved story has its own repo-named review route');
    assert.equal(chooser.routeBase, route);

    const review = await (await fetch(`${base}${route}/review?story=story.json`)).text();
    const opened = shellPayload(review);
    assert.ok(opened.steps.some((step) => step.title.text.includes('Entry point')), 'opens the selected story');
    // The close-story link is React markup now; what the route owns is the base
    // every link on the page is built from.
    assert.equal(opened.routeBase, route, 'close-story affordance returns to the repo-named chooser route');
    assert.ok(!review.includes('data-surface="stories"'), 'does not stay on the chooser');

    const chooserAgain = await (await fetch(`${base}${route}/stories`)).text();
    assert.ok(chooserAgain.includes('data-surface="stories"'), 'review route does not consume the chooser route');
    assert.equal(shellPayload(chooserAgain).stories.length, 1, 'and the story is still listed');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('story picker can remove a saved story', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  writeStory(repo);
  const { server, base } = await boot();
  try {
    await fetch(`${base}/api/repo/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }),
    });
    const route = repoRoute(repo);
    const removed = await fetch(`${base}/api/stories`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'story.json' }),
    });
    assert.equal(removed.status, 200);
    const body = await removed.json();
    assert.equal(body.ok, true);
    assert.equal(body.removed, true);

    const chooser = shellPayload(await (await fetch(`${base}${route}/stories`)).text());
    assert.deepEqual(chooser.stories, [], 'returns to the empty review-history state');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('a malformed selected story shows the scope picker with a notice, not the raw error page', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  writeFileSync(join(repo, '.codestory', 'story.json'), '{"bogus":true}'); // invalid tour
  const { server, base } = await boot();
  try {
    await fetch(`${base}/api/repo/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }),
    });
    const route = repoRoute(repo);
    const chooser = await (await fetch(`${base}${route}/stories`)).text();
    assert.ok(chooser.includes('story.json'), 'lists the bad story');
    const html = await (await fetch(`${base}${route}/review?story=story.json`)).text();
    // The fall-through the change surface exists to absorb: a broken story must
    // land on the scope picker carrying an explanation, never on the raw error
    // page and never silently. The message itself is the parse failure.
    assert.match(html, /data-surface="change"/, 'a broken story falls through to the scope picker');
    const fallback = shellPayload(html);
    assert.ok(fallback.notice, 'shows a notice about the bad review');
    assert.equal(typeof fallback.notice, 'string');
    assert.equal(fallback.routeBase, route, 'points into the review workspace for this repo');
    assert.ok(!html.includes("Couldn't build the review"), 'is not the raw error page');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('legacy story query routes still work for old bookmarks', async () => {
  const realHome = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'ds-home-'));
  process.env.HOME = tmpHome;
  const repo = repoWithChange();
  writeStory(repo);
  const { server, base } = await boot();
  try {
    await fetch(`${base}/api/repo/open`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }),
    });
    const changeResponse = await fetch(`${base}/?story=new`);
    assert.ok(changeResponse.url.endsWith(`${repoRoute(repo)}/change`), 'old new-story query redirects to the repo-named change route');
    const change = await changeResponse.text();
    assert.match(change, /data-surface="change"/, 'old new-story query opens the scope picker');

    const reviewResponse = await fetch(`${base}/?story=story.json`);
    assert.ok(reviewResponse.url.endsWith(`${repoRoute(repo)}/review?story=story.json`), 'old story query redirects to the repo-named review route');
    const review = await reviewResponse.text();
    assert.ok(review.includes('Entry point'), 'old story query opens the selected story');
  } finally {
    server.close();
    process.env.HOME = realHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});
