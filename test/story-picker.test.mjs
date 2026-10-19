// Review history (the story picker), after the React rewrite.
//
// The old version of this file asserted on the HTML string `renderStoryPicker()`
// built by hand — including its inlined stylesheet. That string no longer
// exists: the route emits a shell plus a JSON payload, and the behaviour lives
// in `client/surfaces/stories/` and ships as `dist/client/stories.js`. The
// assertions moved into the same four layers `test/picker.test.mjs` established:
//
//   1. THE ROUTE      — a real server, real requests. What does the stories
//                       route serve, and does reaching it still close the story?
//   2. THE PAYLOAD    — the whole initial state, the `?evidence=refresh` split
//                       that decides how expensive this page is, and the
//                       escaping that stops a story title closing the script.
//   3. THE SOURCE     — the badge state machine and the accessibility /
//                       destructive-action contracts `surface-inventory.md` §2
//                       ranks as at-risk, asserted against the TSX that emits
//                       the DOM.
//   4. THE BUNDLE     — every user-facing string and endpoint survives the
//                       build, so layer 3 guards code that actually ships.
//
// What layers 3 and 4 cannot do is prove the DOM behaves. That was verified by
// driving the real page in Chrome (see the report accompanying this rewrite):
// the populated and empty states, both evidence modes, the delete confirmation
// including Escape and focus restore, and the theme menu were each observed in a
// real browser.
//
// The beUI adoption pass was driven the same way, and two of its results are
// only visible in a browser and so are recorded here: StatefulButton's baked-in
// `aria-live` reads back as `off` in the rendered DOM while this dialog's own
// `role="alert"` survives, and the scope chip's accessibility description is
// byte-identical to the one the `title` attribute used to produce — measured
// through Chrome's own accessibility tree, both ways, on the same live page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../dist/server.js';
import { recallStorySelection } from '../dist/story-selection.js';

const CLIENT = new URL('../client/', import.meta.url);
const readRaw = (relative) => readFileSync(new URL(relative, CLIENT), 'utf8');

// Source assertions must read code, not prose. A comment explaining why some
// API is forbidden otherwise trips the very guard that forbids it. Only
// whole-line comments are stripped, so a `//` inside a string literal is safe.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

const read = (relative) => stripComments(readRaw(relative));

const storiesApp = read('surfaces/stories/StoriesApp.tsx');
const storyRow = read('surfaces/stories/StoryRow.tsx');
const storyState = read('surfaces/stories/story-state.ts');
const removeDialog = read('surfaces/stories/RemoveStoryDialog.tsx');
const emptyHistory = read('surfaces/stories/EmptyHistory.tsx');
const format = read('surfaces/stories/format.ts');
const storiesSource = [storiesApp, storyRow, storyState, removeDialog, emptyHistory, format].join('\n');

test('review history gives the shared skip link a focusable main target', () => {
  assert.match(storiesApp, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
});

// Read a vendored beUI file as code. This surface now leans on three
// properties of the vendored components rather than re-implementing them —
// Button gating its press on reduced motion, ActionSwapText not animating on
// mount, StatefulButton carrying the live region quiet.ts exists to strip. A
// re-vendor that drops one of those is a silent behaviour change here, so the
// properties are asserted at the source rather than assumed.
const vendored = (relative) => stripComments(readRaw(`vendor/beui/${relative}`));

const PAYLOAD_BLOCK = /<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/;

function payloadOf(html) {
  const match = PAYLOAD_BLOCK.exec(html);
  assert.ok(match, 'the shell must embed exactly one __CODESTORY_DATA__ block');
  return JSON.parse(match[1]);
}

function repoWithChange() {
  const dir = mkdtempSync(join(tmpdir(), 'codestory-history-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  return dir;
}

/** Write a story file the app will load. `extra` overrides any top-level field. */
function writeStory(repo, id = 'story.json', extra = {}) {
  const dir = join(repo, '.codestory');
  mkdirSync(join(dir, 'stories'), { recursive: true });
  writeFileSync(
    join(dir, id),
    JSON.stringify({
      // Concept primers need version 2+; this story has one so the row can
      // report "N code stops + 1 primer".
      version: 3,
      title: 'Saved story',
      summary: 'What this change is for.',
      base: 'HEAD',
      steps: [
        {
          id: 'c1',
          order: 1,
          kind: 'concept',
          title: 'Why this change',
          body: '<p>Context first.</p>',
          preparesFor: ['s1'],
        },
        {
          id: 's1',
          order: 2,
          kind: 'changed',
          title: 'The edit',
          file: 'a.txt',
          range: [2, 2],
          why: 'Start at the changed line.',
        },
      ],
      ...extra,
    }),
  );
}

/** Boot a real server on a scratch HOME, opened on `repo`. */
async function withHistory(repo, run) {
  const home = mkdtempSync(join(tmpdir(), 'codestory-history-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const route = `/repo/${encodeURIComponent(repo.split('/').pop())}`;
    await run({
      base,
      home,
      route,
      async page(path = `${route}/stories`) {
        const response = await fetch(base + path, { redirect: 'manual' });
        return { response, html: await response.text() };
      },
    });
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────── 1. the route

test('review history serves a React shell, not a hand-built page', async () => {
  const repo = repoWithChange();
  try {
    await withHistory(repo, async ({ page }) => {
      const { response, html } = await page();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html/);

      assert.match(html, /<title>codeStory — [^<]* Review history<\/title>/);
      assert.match(html, /<body class="ds-map-bg" data-surface="stories">/, 'the dot field paints before React mounts');
      assert.match(html, /<link rel="stylesheet" href="\/assets\/client\/app\.css">/);
      assert.match(html, /<script type="module" blocking="render" data-ds-entry src="\/assets\/client\/stories\.js"><\/script>/);

      // The theme bootstrap must run before the stylesheet or a light-mode user
      // gets a dark flash on every navigation (dark is the no-script fallback).
      assert.ok(
        html.indexOf("var key='ds-theme'") < html.indexOf('<link rel="stylesheet"'),
        'resolves the theme before the stylesheet',
      );

      const executable = html.match(/<script(?![^>]*type="application\/json")[^>]*>/g) ?? [];
    // Three executable scripts now, not two: the theme bootstrap, the entry
    // module, and the tiny inline timer that releases the entry's
    // `blocking="render"` after ENTRY_RENDER_BLOCK_MS. See the note on
    // `entryBlockingRelease()` in src/shell.ts — the blocking is what stops a
    // navigation flashing an empty shell, and the timer is what stops it
    // holding a blank window on a slow boot.
      assert.equal(executable.length, 3, `expected the theme bootstrap, the module entry, and the blocking-release timer, got ${executable}`);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('every route that means "review history" reaches this surface', async () => {
  const repo = repoWithChange();
  try {
    await withHistory(repo, async ({ page, route }) => {
      for (const path of [route, `${route}/`, `${route}/stories`]) {
        const { response, html } = await page(path);
        assert.equal(response.status, 200, `${path} should render review history`);
        assert.match(html, /data-surface="stories"/, `${path} should render review history`);
      }
      // The un-prefixed `/stories` is a redirect into the repo-named route, not
      // a second copy of the page.
      const bare = await page('/stories');
      assert.equal(bare.response.status, 302);
      assert.equal(bare.response.headers.get('location'), `${route}/stories`);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('reaching review history is the explicit "close story" transition', async () => {
  const repo = repoWithChange();
  writeStory(repo);
  try {
    await withHistory(repo, async ({ base, home, route }) => {
      // Open the story, so the persisted resume target points at it.
      await fetch(`${base}${route}/review?story=story.json`);
      assert.equal(recallStorySelection(home, repo), 'story.json', 'the review route selected the story');

      await fetch(`${base}${route}/stories`);
      assert.equal(recallStorySelection(home, repo), null, 'reaching history closes the story');

      // And the session agrees: entering at `/` no longer jumps back into the
      // story the reviewer just closed.
      const entry = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(entry.headers.get('location'), `${route}/stories`);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────── 2. the payload

test('the payload carries projected stories, the route base, and the server clock', async () => {
  const repo = repoWithChange();
  writeStory(repo);
  const before = Date.now();
  try {
    await withHistory(repo, async ({ page, route }) => {
      const { html } = await page();
      const payload = payloadOf(html);

      assert.equal(payload.routeBase, route, 'every link on the page is built from this');
      assert.equal(payload.repoName, repo.split('/').pop());
      assert.ok(payload.now >= before && payload.now <= Date.now(), 'relative times use the server clock');

      assert.equal(payload.stories.length, 1);
      const story = payload.stories[0];
      assert.equal(story.id, 'story.json');
      assert.equal(story.title, 'Saved story');
      assert.equal(story.summary, 'What this change is for.');
      assert.equal(story.valid, true);
      assert.equal(story.steps, 2);
      assert.equal(story.primers, 1, 'concept steps are primers, not code stops');
      assert.equal(story.files, 1);
      assert.equal(typeof story.updatedAt, 'number');
      assert.ok(story.scope.label, 'the scope chip has something to say');

      // The absolute path a StorySummary carries must not reach the browser,
      // and neither should the fields the UI never reads.
      assert.ok(!('path' in story), 'the absolute story path stays on the server');
      assert.ok(!JSON.stringify(payload).includes(repo), 'no filesystem path anywhere in the payload');
      for (const dropped of ['mode', 'base', 'head', 'current']) {
        assert.ok(!(dropped in story), `${dropped} is not read by this surface`);
      }

      // Presentation stays client-side: raw values only.
      assert.ok(!JSON.stringify(payload).includes('min ago'), 'relative time is formatted in the component');
      assert.ok(
        !JSON.stringify(payload).includes('Open to inspect current review evidence'),
        'the badge and its detail are decided in the component',
      );
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the default projection stays metadata-only and ?evidence=refresh is what pays for the diff', async () => {
  const repo = repoWithChange();
  writeStory(repo);
  try {
    await withHistory(repo, async ({ page, route }) => {
      const cheap = payloadOf((await page(`${route}/stories`)).html);
      assert.equal(cheap.liveEvidence, false, 'reaching review history must not rebuild the diff');
      // What "did not rebuild the diff" looks like in the data: nothing was
      // measured, so every live count is zero. The repository has ONE
      // uncommitted added line, so these zeroes are only reachable by skipping
      // the pass — they are the evidence, not incidental.
      assert.equal(cheap.stories[0].additions, 0);
      assert.equal(cheap.stories[0].deletions, 0);
      assert.equal(cheap.stories[0].openComments, 0);

      const live = payloadOf((await page(`${route}/stories?evidence=refresh`)).html);
      assert.equal(live.liveEvidence, true, 'the explicit refresh is honoured');
      assert.equal(
        live.stories[0].additions,
        1,
        'the refresh actually read the working tree: one uncommitted added line',
      );
      assert.equal(live.stories[0].liveFiles, 1, 'and counted the files from the diff, not from the story');

      // Anything other than the exact opt-in is the cheap page.
      for (const query of ['?evidence=1', '?evidence=', '?refresh=1', '?evidence=REFRESH']) {
        const other = payloadOf((await page(`${route}/stories${query}`)).html);
        assert.equal(other.liveEvidence, false, `${query} must not trigger the expensive pass`);
      }
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('an unreadable story becomes a repairable row rather than an error page', async () => {
  const repo = repoWithChange();
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  writeFileSync(join(repo, '.codestory', 'story.json'), '{ not json');
  try {
    await withHistory(repo, async ({ page }) => {
      const { response, html } = await page();
      assert.equal(response.status, 200);
      const story = payloadOf(html).stories[0];
      assert.equal(story.valid, false);
      assert.ok(story.error, 'the parse failure travels so the row can explain itself');
      assert.equal(story.steps, 0);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a hostile story id cannot break out of the payload script element', async () => {
  // The authored title and summary are narrative fields, and `loadTour()`
  // refuses markup in them outright — so the untrusted string that CAN reach
  // this payload is the story id, which is a filename the user chose. It is
  // also what the row falls back to for its title and what goes into the
  // review link.
  const repo = repoWithChange();
  const hostile = 'x<!--<script>y';
  writeStory(repo, `stories/${hostile}.json`);
  try {
    await withHistory(repo, async ({ page }) => {
      const { html } = await page();
      assert.ok(!html.includes('<script>y'), 'the raw sequence must never appear in the document');
      assert.ok(!html.includes('<!--'), 'nor may a comment opener switch the tokenizer state');
      const story = payloadOf(html).stories[0];
      assert.equal(story.id, `stories/${hostile}.json`, 'and it still round-trips exactly');
      // The component builds `?story=` with encodeURIComponent, so the id never
      // has to be trusted as a URL either.
      assert.equal(
        encodeURIComponent(story.id),
        'stories%2Fx%3C!--%3Cscript%3Ey.json',
      );
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('deleting a story answers with a fresh list and clears the persisted selection', async () => {
  const repo = repoWithChange();
  writeStory(repo, 'story.json');
  writeStory(repo, 'stories/second.json', { title: 'Second story' });
  try {
    await withHistory(repo, async ({ base, route }) => {
      await fetch(`${base}${route}/review?story=story.json`);
      const response = await fetch(`${base}/api/stories`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'story.json' }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.removed, true);
      assert.deepEqual(body.stories.map((s) => s.id), ['stories/second.json']);

      const after = payloadOf((await (await fetch(`${base}${route}/stories`)).text())).stories;
      assert.deepEqual(after.map((s) => s.id), ['stories/second.json'], 'and the page agrees on reload');
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────── 3. at-risk behaviour, in source

test('the badge state machine keeps its order and its wording', () => {
  // First match wins, and the order is the behaviour. Assert the sequence of
  // guards rather than each branch in isolation: a reordering that swapped
  // "Saved" past the freshness checks would keep every string and still make a
  // metadata-only page invent findings.
  const order = ['!story.valid', '!liveEvidence', 'story.openComments', '"stale"', '"unverified"'];
  let cursor = -1;
  for (const guard of order) {
    const at = storyState.indexOf(guard);
    assert.ok(at > cursor, `${guard} must be tested after the guard before it`);
    cursor = at;
  }

  for (const [label, detail] of [
    ['Needs repair', 'Story file cannot be read'],
    ['Saved', 'Open to inspect current review evidence'],
    ['In review', 'waiting'],
    ['Story changed', 'Regenerate the story for the current diff'],
    ['Verify scope', 'Regenerate to establish a scope-aware baseline'],
    ['Current', 'Story matches its captured scope'],
  ]) {
    assert.ok(storyState.includes(`"${label}"`), `the ${label} label`);
    assert.ok(storyState.includes(detail), `the ${label} detail`);
  }
  // Drift wording counts files, and the side-file clause only appears when
  // there are side files.
  assert.match(storyState, /plural\(story\.inStoryDrift, "story file"\)\} changed/);
  assert.match(storyState, /` · \$\{plural\(story\.outsideStoryDrift, "file"\)\} outside the story also changed`/);
  assert.match(storyState, /Story current · \$\{plural\(story\.outsideStoryDrift, "file"\)\} outside the story changed/);
  // "Saved" is the one tone with no colour of its own — neutral on purpose.
  assert.match(storyState, /saved: "text-neutral-status-text bg-fill-2"/);
});

test('unverified evidence is never dressed up as measured evidence', () => {
  // The +A/−D fact exists only when something actually rebuilt the diff. A
  // metadata payload reports zeroes, and "+0 −0" would be a claim, not a blank.
  // A code story has no diff at all, so it never shows the fact either.
  assert.match(storyRow, /\{liveEvidence(?: && !code)? \? \(\s*<Fact>\s*<b[^>]*>\+\{story\.additions\}/);
  assert.match(storyRow, /−\{story\.deletions\}/);
  // The badge is gated on the same flag rather than on freshness alone.
  assert.match(storyRow, /storyState\(story, liveEvidence\)/);
  // The refresh is a URL, so the expensive view is linkable, bookmarkable, and
  // reversible with Back.
  assert.match(storiesApp, /href=\{`\$\{routeBase\}\/stories\?evidence=refresh`\}/);
  // The explanation moved from a `title` attribute onto beUI's Tooltip, which
  // also opens on keyboard focus. The wording is the contract, not the vehicle.
  assert.match(storiesApp, /content="Recompute live diff and drift evidence for every saved review"/);
  assert.ok(!/title="Recompute/.test(storiesApp), 'and does not also fire the native tooltip on top of it');
});

test('review history keeps its numbering, its facts, and its one Start review', () => {
  assert.match(storyRow, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(storyRow, /aria-hidden="true"/);
  // Code stops exclude primers and never go negative.
  assert.match(storyRow, /Math\.max\(0, story\.steps - story\.primers\)/);
  assert.match(storyRow, /\$\{plural\(story\.primers, "primer"\)\}/);
  assert.match(storyRow, /story\.liveFiles \|\| story\.files/);
  assert.match(storyRow, /story\.openComments === 1 \? "comment" : "comments"/);
  // Exactly one "Start review", and it lives with the page title rather than in
  // the empty state, so it exists whether or not there are stories.
  assert.equal((storiesSource.match(/>\s*Start review\s*</g) ?? []).length, 1);
  assert.ok(
    storiesApp.indexOf('Review history</h1>') < storiesApp.indexOf('Start review'),
    'groups the primary action with the page title',
  );
  assert.ok(!/Start review/.test(emptyHistory), 'the empty state does not grow a second entry point');
  // The status counts reviews, not notes.
  assert.match(storiesApp, /openNotes === 1 \? "review has" : "reviews have"/);
  assert.match(storiesApp, /aria-label="Review history status"/);
  // The heading is recomputed from the live list, so a delete renumbers it.
  assert.match(storiesApp, /\{stories\.length\} saved \{stories\.length === 1 \? "review" : "reviews"\}/);
});

test('a destructive delete still asks first, and asks accessibly', () => {
  // surface-inventory.md §2.7 allows the native confirm() or a real dialog. It
  // does not allow deleting optimistically, and a story file is not
  // recoverable from this app.
  assert.match(removeDialog, /role="dialog"\s+aria-modal="true"/);
  assert.match(removeDialog, /aria-labelledby="remove-story-title"/);
  assert.match(removeDialog, /aria-describedby="remove-story-body"/);
  assert.match(removeDialog, /Remove “\{story\?\.title \?\? ""\}” from this repo\?/);
  // The shared choreography — Escape, the focus trap, focus restore, inert
  // background and the exit hold all come from it rather than being reinvented.
  assert.match(removeDialog, /useModalChoreography\(\{/);
  assert.match(removeDialog, /className=\{cn\("ds-scrim", modal\.shown && "is-shown"\)\}/);
  assert.match(removeDialog, /hidden=\{!modal\.mounted\}/);
  // Focus lands on the non-destructive choice — and it waits for `is-shown`,
  // because `.ds-scrim` is `visibility: hidden` until then and `focus()` on a
  // `visibility: hidden` element is a silent no-op. Focusing any earlier
  // (from the hook's `onOpen`, say) leaves focus on <body> and makes the
  // reviewer Tab into a destructive dialog. Observed failing that way in
  // Chrome before this landed.
  assert.match(removeDialog, /if \(modal\.shown\) cancel\.current\?\.focus\(\);/);
  assert.match(removeDialog, /\}, \[modal\.shown\]\);/, 'and only when it becomes shown');
  // A failure reports in place instead of tearing the context down with an
  // alert(), and the confirm button comes back.
  assert.match(removeDialog, /role="alert"/);
  // The dialog has exactly one thing that may speak. beUI's StatefulButton
  // ships a second `aria-live` around its own label, so the subtree is quieted
  // after every render and the dialog's announcer is spared by name — the
  // `keep` escape hatch in client/shared/quiet.ts. Without it the surface would
  // strip its own alert along with the vendored one.
  assert.match(removeDialog, /useQuietSubtree\(dialog, \{ keep: "\[data-remove-error\]" \}\)/);
  assert.match(removeDialog, /data-remove-error\n/, 'and the announcer carries the hook the keep selector matches');
  assert.match(storiesApp, /setError\(failureMessage\(cause, "Could not remove story\."\)\)/);
  assert.ok(!/window\.(confirm|alert)\s*\(/.test(storiesSource), 'no blocking native dialogs');
  // The remove control is a sibling of the row link, and its handler is bound
  // to the button — never delegated from an ancestor resolving the target with
  // closest(), which is the WebKit nested-<svg> bug the recents list was fixed
  // for.
  assert.match(storyRow, /aria-label=\{`Remove \$\{title\}`\}/);
  assert.match(storyRow, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(storyRow, /onClick=\{\(\) => onRemove\(story\)\}/);
  assert.ok(!/(?:event|e)\.target\s*\.\s*closest\s*\(/.test(storiesSource), 'no delegated target resolution');
  // Wrapping the control in beUI's Tooltip must not move the handler off it:
  // the onClick has to sit on the element the reviewer presses, inside the
  // <Tooltip> rather than on it. Assert the nesting, not just the presence.
  const removeControl = storyRow.slice(storyRow.lastIndexOf('<Tooltip'), storyRow.lastIndexOf('</Tooltip>'));
  assert.match(
    removeControl,
    /<Button[\s\S]*onClick=\{\(\) => onRemove\(story\)\}/,
    'the tooltip wraps the button; the button owns the click',
  );
  // The confirm is a real state machine now, and "Removing…" is a state rather
  // than a ternary on a label. The dialog must not close itself on failure.
  assert.match(removeDialog, /state=\{busy \? "loading" : error \? "error" : "idle"\}/);
  assert.match(removeDialog, /loadingText="Removing…"/);
});

test('the vendored controls this surface leans on still behave the way it assumes', () => {
  // Three properties are load-bearing here and live in files this surface must
  // never edit, so they are checked at the source instead. A re-vendor that
  // drops one is a behaviour change on this page that nothing else would catch.
  const button = vendored('motion/button/base.tsx');
  assert.match(
    button,
    /whileTap=\{reduce \? undefined : \{ scale: pressScale \}\}/,
    'the press scale is skipped under prefers-reduced-motion — which is why the row no longer needs a CSS override for it',
  );
  const actionSwap = vendored('motion/action-swap.tsx');
  const swapText = actionSwap.slice(
    actionSwap.indexOf('export function ActionSwapText'),
    actionSwap.indexOf('export function ActionSwapIcon'),
  );
  assert.ok(swapText.includes('<AnimatePresence'), 'found ActionSwapText');
  assert.ok(
    !/<AnimatePresence(?![^>]*initial=\{false\})/.test(swapText),
    'ActionSwapText never animates on mount; it is chosen over a ticker precisely because every visit to this page is a fresh navigation',
  );
  const stateful = vendored('motion/button/stateful.tsx');
  assert.match(stateful, /aria-live="polite"/, 'StatefulButton is a live-region carrier, so the dialog must keep quieting it');
});

test('the delete response is not quietly adopted as the page state', () => {
  // DELETE /api/stories answers with listStories() — live evidence, and every
  // story's absolute path. Swallowing it would upgrade a metadata-only page to
  // live evidence and leak filesystem paths, as a side effect of an unrelated
  // delete. The row is dropped locally instead.
  assert.match(storiesApp, /setStories\(\(rows\) => rows\.filter\(\(row\) => row\.id !== story\.id\)\)/);
  assert.ok(!/data\??\.stories/.test(storiesApp), 'the response body is not read back into the list');
  // Emptying the list renders the empty state directly; the vanilla page needed
  // a full reload to get it.
  assert.match(storiesApp, /stories\.length \? \(/);
  assert.match(storiesApp, /<EmptyHistory \/>/);
  assert.ok(!/location\.reload\(\)/.test(storiesSource), 'no reload to reach a state React can render');
});

test('the nav bar keeps the way home and the way back to the change', () => {
  // These were asserted against `navBar()`'s markup in test/home-navigation and
  // test/change-route until this surface stopped rendering HTML. The bar itself
  // is `client/shared/nav.tsx`; what belongs here is which links this page
  // hands it.
  assert.match(storiesApp, /home="\/repos"/, 'the wordmark returns to the repository picker');
  assert.match(
    storiesApp,
    /crumbs=\{\[\{ label: repoName, href: `\$\{routeBase\}\/change` \}, \{ label: "Review history" \}\]\}/,
    'the repo crumb goes to the change page and the current segment is the current page',
  );
});

test('review history keeps its accessibility contracts', () => {
  assert.match(storiesApp, /aria-labelledby="saved-reviews-title"/);
  assert.match(storiesApp, /id="saved-reviews-title"/);
  // Both `title` attributes became beUI tooltips, which the card's
  // `overflow: hidden` makes worth the trade — the vendored one portals to
  // document.body instead of being clipped on three sides.
  assert.match(storyRow, /content=\{scope\.command\}/, 'the chip exposes the raw git command');
  assert.match(
    storyRow,
    /if \(!scope\.command\) return chip;/,
    'and a scope with no command opens no bubble at all, exactly as the attribute did',
  );
  assert.match(storyRow, /content="Remove review"/);
  assert.ok(!/\stitle=["{]/.test(storyRow), 'no native tooltip fires a second time on top of the styled one');
  // A tooltip only supplies `aria-describedby` while it is open, and the chip
  // is not focusable, so it only ever opens on hover. Measured in Chrome, the
  // `title` this replaced put the command on the chip's accessibility node
  // permanently — `aria-description` is what keeps that true, and unlike a
  // visually hidden span it stays out of the row link's name-from-contents.
  assert.match(storyRow, /aria-description=\{scope\.command \|\| undefined\}/);
  // The delete control keeps a real name of its own, so losing `title` there
  // costs a reader nothing.
  assert.match(storyRow, /aria-label=\{`Remove \$\{title\}`\}/);
  // The card clips its own overflow, so an outset focus ring would be cut off —
  // hence the inset half of the shared `--shadow-focus` pair, which carries a
  // solid --accent core the old `--accent-soft`-only wash did not (~1.24:1).
  assert.match(storyRow, /focus-visible:shadow-\[var\(--shadow-focus-inset\)\]/);
  assert.match(storyRow, /focus-within:border-accent-line/);
  assert.match(storyRow, /contrast-more:border-text/);
  assert.match(storiesApp, /className="ds-sr-only" role="status"/);
});

test('review history uses the shared spatial tier with no per-row stagger', () => {
  // These moved out of an inlined <style> into the shared reveal. The tier is
  // the same tier; what matters is that rows land together (the vanilla
  // `history-row-in` had no delay) and that reduced motion keeps it static —
  // which the shared stylesheet does by declaring the animation only inside
  // `prefers-reduced-motion: no-preference`.
  assert.match(storyRow, /"ds-reveal"/);
  assert.match(storiesApp, /ds-reveal relative isolate/);
  assert.ok(!/ds-reveal-\d/.test(storiesSource), 'no per-row entrance delay');
  const sharedCss = read('shared/shared.css');
  assert.match(sharedCss, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.ds-reveal \{/);
  assert.match(sharedCss, /animation: ds-reveal-up var\(--motion-duration-spatial\) var\(--motion-ease-out\) backwards;/);
  // Reduced motion also drops the row's own hover/press transitions.
  assert.match(storyRow, /motion-reduce:transition-none/);
  // The delete control's press used to be a CSS `:active` transform with a
  // `motion-reduce:active:transform-none` override beside it. It is beUI's
  // Button now, so the press is a Motion `whileTap` and the override would be
  // cancelling a rule that no longer exists. The reduced-motion guarantee did
  // not move — it went into the component, which is asserted directly in "the
  // vendored controls this surface leans on".
  assert.match(storyRow, /pressScale=\{0\.97\}/, 'and the press stays .97, not beUI\'s springier .93');
  assert.ok(
    !/active:scale-\[/.test(storyRow),
    'one press implementation, not a CSS transform racing an inline one',
  );
  // The header stays free of ornamental thread furniture.
  assert.ok(!/ThreadBackdrop|ds-atmosphere-thread/.test(storiesSource), 'no decorative thread in the history header');
  assert.ok(!/state-rail/.test(storiesSource), 'the status badge replaced the partial-edge status strip');
});

test('saved reviews reveal a glance preview without hiding information on touch', () => {
  assert.match(storyRow, /"story-glance inline-flex/);
  assert.match(storyRow, /<Eye[^>]*aria-hidden="true"/s);
  assert.match(storyRow, /story-glance-detail w-0 translate-x-1 overflow-hidden opacity-0/);
  assert.match(storyRow, /group-focus-visible:w-\[150px\]/);
  assert.match(storyRow, /\[@media_\(hover:hover\)_and_\(pointer:fine\)\]:group-hover:w-\[150px\]/);
  assert.match(storyRow, /max-\[760px\]:hidden/);
  assert.match(storyRow, /motion-reduce:transform-none motion-reduce:transition-none/);
});

test('review history has no keyboard map of its own', () => {
  // surface-inventory.md §2.3: none. Rows are anchors and buttons, so native
  // Tab/Enter/Space apply, and the only key handling is the shared theme menu
  // plus the shared modal's Escape and focus trap. A list-level arrow handler
  // or a Delete shortcut appearing here would be new behaviour, not a port.
  const keyHandlers = storiesSource.match(/onKeyDown|addEventListener\("keydown"/g) ?? [];
  assert.deepEqual(keyHandlers, [], 'no surface-level key handling');
});

test('review history touches no browser storage of its own', () => {
  const keys = new Set(
    [...storiesSource.matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\("([^"]+)"/g)].map((m) => m[1]),
  );
  assert.deepEqual([...keys], [], 'the theme hook owns the only key this page reaches');
  assert.ok(!/sessionStorage/.test(storiesSource), 'no sessionStorage anywhere in this app');
});

test('navigation stays real URLs — no client-side router is introduced', () => {
  assert.ok(
    !/(?:history|window\.history)\s*\.\s*(?:pushState|replaceState)\s*\(/.test(storiesSource),
    'there is no history API anywhere in this codebase',
  );
  // Opening a story has server-side consequences, so it must be a document
  // navigation the server sees — an anchor, not a click handler.
  assert.match(storyRow, /const href = `\$\{routeBase\}\/review\?story=\$\{encodeURIComponent\(story\.id\)\}`/);
  assert.match(storyRow, /<a\s+href=\{href\}/);
});

test('review history does not resurrect UI that was deliberately removed', () => {
  for (const gone of [
    /Round /,
    /review-path/,
    /Every session keeps the scope/,
    /Scope.*Read.*Resolve.*Decide/s,
    /Generate guided review/,
  ]) {
    assert.doesNotMatch(storiesSource, gone, `${gone} was removed on purpose`);
  }
});

// ─────────────────────────────────────────────────────────── 4. the bundle

test('the built bundle actually ships the review-history behaviour', (t) => {
  const dir = new URL('../dist/client/', import.meta.url);
  const bundle = new URL('stories.js', dir);
  if (!existsSync(bundle)) {
    t.skip('client bundle not built');
    return;
  }
  const js = readFileSync(bundle, 'utf8');
  // esbuild writes non-ASCII as \uXXXX escapes, so "Removing…" is not in the
  // file as the characters a reader sees. Decode before looking for prose, or
  // this layer silently stops covering every string with a curly quote, an
  // ellipsis or a minus sign in it — of which this surface has several.
  const prose = js.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  assert.ok(js.includes('/api/stories'), 'bundle calls the delete endpoint');
  assert.ok(js.includes('evidence=refresh'), 'bundle keeps the live-evidence refresh link');
  for (const text of [
    'Review history',
    'Resume a saved review when you need its scope or its notes.',
    'Start review',
    'Resume review',
    'No saved reviews',
    'Start from the current diff. A guided story will appear here when you save one.',
    'Needs repair',
    'Story file cannot be read',
    'Open to inspect current review evidence',
    'In review',
    'Story changed',
    'Regenerate the story for the current diff',
    'Verify scope',
    'Regenerate to establish a scope-aware baseline',
    'Story matches its captured scope',
    'No summary yet.',
    'This story file could not be read.',
    'Remove this story?',
    'from this repo?',
    'Could not remove story.',
    // The confirm's three states, which are a component contract now rather
    // than a ternary on a label.
    'Remove story',
    'Removing…',
    'Try again',
    'Refresh evidence',
    'code stops',
  ]) {
    assert.ok(prose.includes(text), `bundle should contain ${JSON.stringify(text)}`);
  }

  // Code splitting is on, so everything `client/shared/` owns — React, Motion,
  // the payload reader, the theme contract — lives in the hashed chunk this
  // entry imports, not in the entry itself. Assert against the entry plus what
  // it actually pulls in, or this layer starts failing for the wrong reason.
  const chunks = [...js.matchAll(/from\s*"\.\/(chunk-[A-Z0-9]+\.js)"/g)].map((m) => m[1]);
  assert.ok(chunks.length, 'the entry should share React and friends through a chunk');
  const graph = js + chunks.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  assert.ok(graph.includes('__CODESTORY_DATA__'), 'bundle reads the shell payload');
  assert.ok(graph.includes('ds-theme'), 'bundle carries the theme contract');
});
