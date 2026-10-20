// The change / scope picker, after the React rewrite.
//
// The old version of this file asserted on the ~40 KB HTML string that
// `renderChangePage()` built by hand, and on the page script it inlined. Neither
// exists any more: the route emits a shell plus a JSON payload, and the
// behaviour lives in `client/surfaces/change/` and ships as
// `dist/client/change.js`. So the assertions moved, in the same four layers the
// repo picker's rewrite established (see the header of test/picker.test.mjs):
//
//   1. THE ROUTE      — a real server, real requests. What HTML does the change
//                       route serve, including on the review-failure path that
//                       lands here?
//   2. THE PAYLOAD    — the whole initial state: the resolved scope, the file
//                       projection, the failure notice, and the escaping that
//                       stops a branch name from closing the script element.
//   3. THE SOURCE     — the choreography and keyboard invariants that
//                       `docs/superpowers/specs/surface-inventory.md` §3 ranks
//                       as at-risk, asserted against the TypeScript that emits
//                       the DOM rather than against emitted JS text.
//   4. THE BUNDLE     — every user-facing string and endpoint survives the
//                       build, so layer 3 is guarding code that actually ships.
//
// What layers 3 and 4 cannot do is prove the DOM behaves. That was verified by
// driving the real page in Chrome (see the report accompanying this rewrite):
// the populated inventory, the empty state, BOTH review-failure paths, all four
// combobox shortcuts including the clamp at each end, the reopen-without-moving
// rule, live filtering, anchored placement, panel disclosure without navigation,
// theme switching, and desktop/tablet/mobile layout were each observed in a real
// browser with a clean console. If this surface grows a regression the source
// text cannot catch, that browser run is what should become a test file — not a
// weaker string match here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../dist/server.js';

const CLIENT = new URL('../client/', import.meta.url);
const readRaw = (relative) => readFileSync(new URL(relative, CLIENT), 'utf8');

// Source assertions must read code, not prose. A comment explaining why some
// API is forbidden otherwise trips the very guard that forbids it. Only
// whole-line comments are stripped, so a `//` inside a string literal (a URL,
// say) is left alone.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

const read = (relative) => stripComments(readRaw(relative));

const changeApp = read('surfaces/change/ChangeApp.tsx');
const scopeCard = read('surfaces/change/ScopeCard.tsx');
const refPicker = read('surfaces/change/RefPicker.tsx');
const refs = read('surfaces/change/refs.ts');
const fileSummary = read('surfaces/change/FileSummary.tsx');
const format = read('surfaces/change/format.ts');
const nav = read('shared/nav.tsx');
const changeSource = [changeApp, scopeCard, refPicker, refs, fileSummary, format].join('\n');

test('persistent navigation offers a first-focus skip link to the main landmark', () => {
  assert.match(nav, /href=\{`#\$\{targetId\}`\}/);
  assert.match(nav, />\s*Skip to content\s*<\/a>/);
  assert.match(nav, /<SkipLink \/>/);
  assert.match(changeApp, /<main\s+id="main-content"\s+tabIndex=\{-1\}/);
});

const PAYLOAD_BLOCK = /<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/;

/**
 * A repository with a real two-branch history, so the compare scope resolves to
 * something a user would recognise instead of to `HEAD`.
 *
 * `main` has one file; `feature` adds a second and rewrites the first. The
 * working tree is left clean, so `?scope=uncommitted` is the honest empty state.
 */
function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'codestory-change-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'kept.ts'), 'export const kept = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, 'kept.ts'), 'export const kept = 2;\nexport const extra = 3;\n');
  writeFileSync(join(dir, 'added.ts'), 'export const added = 1;\n');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'bundle.js'), 'console.log(1);\n');
  writeFileSync(join(dir, 'package-lock.json'), '{}\n');
  git('add', '.');
  git('commit', '-qm', 'feature work');
  return dir;
}

async function withRepo(run) {
  const repo = fixtureRepo();
  const home = mkdtempSync(join(tmpdir(), 'codestory-change-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const route = `/repo/${encodeURIComponent(basename(repo))}`;
    await run({
      repo,
      origin,
      route,
      async page(path = `${route}/change`) {
        const response = await fetch(origin + path, { redirect: 'manual' });
        return { response, html: await response.text() };
      },
      payloadOf(html) {
        const match = PAYLOAD_BLOCK.exec(html);
        assert.ok(match, 'the shell must embed exactly one __CODESTORY_DATA__ block');
        return JSON.parse(match[1]);
      },
    });
  } finally {
    server.close();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────── 1. the route

test('the change route serves a React shell, not a hand-built page', async () => {
  await withRepo(async ({ page }) => {
    const { response, html } = await page();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);

    assert.match(html, /<title>codeStory — Choose review scope<\/title>/);
    assert.match(html, /<body class="ds-map-bg" data-surface="change">/, 'the dot field paints before React mounts');
    assert.match(html, /<link rel="stylesheet" href="\/assets\/client\/app\.css">/);
    assert.match(html, /<script type="module" blocking="render" data-ds-entry src="\/assets\/client\/change\.js"><\/script>/);
    assert.match(html, /<meta name="theme-color" content="#0a0c0f" data-ds-theme-color>/);

    // The theme bootstrap must run before the stylesheet or a light-mode user
    // gets a dark flash on every scope navigation — and every scope change on
    // this surface IS a navigation, so it would flash constantly.
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
    assert.equal(executable.length, 3, `expected exactly the theme bootstrap, the module entry, and the blocking-release timer, got ${executable}`);
  });
});

test('a scope change cannot paint an empty shell between the two pages', async () => {
  // The reported bug: "the page flickers sometimes when changing options".
  //
  // Every scope change here is a full navigation to a shell that renders
  // client-side, so between the old page and the new one there is a window
  // where the document exists and React has not committed. Measured on this
  // machine with a frame-by-frame screencast, the browser's first paint and
  // React's first commit landed within ~5 ms of each other and the race went
  // either way run to run — when paint won, one frame of bare ink page with the
  // boot dots on it reached the screen. Hence "sometimes".
  //
  // Three mechanisms close it, and all three are load-bearing:
  //
  //   1. the entry is `blocking="render"`, so the document may not paint until
  //      the module has executed;
  //   2. `mountSurface` wraps the first `render()` in `flushSync`, so React's
  //      initial commit happens INSIDE that execution. Without this the module
  //      finishes, rendering unblocks, and React commits a tick later — which
  //      measured 2/3 flashes, i.e. barely better than nothing;
  //   3. an inline timer releases the blocking after ENTRY_RENDER_BLOCK_MS, so
  //      a slow boot falls back to the boot placeholder instead of holding a
  //      blank window. Unbounded, an 8x-CPU cold boot showed a flat untextured
  //      rectangle for 4.4 s.
  //
  // What this test cannot do is prove the timing, which is the whole bug. That
  // was verified in Chrome across nine runs of a screencast harness, before
  // (3/3 flashed) and after (0/3). This guards the mechanisms that produced it.
  await withRepo(async ({ page }) => {
    const { html } = await page();
    assert.match(html, /<script type="module" blocking="render" data-ds-entry src=/);
    assert.match(html, /script\[data-ds-entry\]\[blocking\]/, 'the release timer targets the entry');
    assert.match(html, /removeAttribute\('blocking'\)/);
    // Bounded, and AT OR ABOVE the placeholder's 240ms reveal — see the note on
    // ENTRY_RENDER_BLOCK_MS. Below it, giving up paints a bare page while the
    // dots are still waiting on their delay, so the wait gets no explanation.
    // Deliberately NOT scaled to the slowest surface's first commit: review and
    // raw diff commit around 300ms and still never flash, because a setTimeout
    // cannot fire mid-module-evaluation. Raising it past the reveal only
    // lengthens the cold-start hold.
    const budget = /},(\d+)\);<\/script>/.exec(html);
    assert.ok(budget, 'the release is on a timer');
    assert.ok(Number(budget[1]) >= 240, `release budget ${budget?.[1]}ms must be >= the 240ms placeholder reveal`);
    assert.ok(Number(budget[1]) <= 1000, `release budget ${budget?.[1]}ms would read as a hang on a cold start`);
    // The blocking must sit AFTER the stylesheet: the sheet is render-blocking
    // too, and the entry has to be discoverable as early as possible.
    assert.ok(
      html.indexOf('<link rel="stylesheet"') < html.indexOf('blocking="render"'),
      'the stylesheet is still requested first',
    );
  });

  // The synchronous first commit, at the one seam that decides it.
  const mount = readRaw('shared/mount.tsx');
  assert.match(mount, /flushSync\(\(\) => \{\s*createRoot\(container\)\.render\(tree\);\s*\}\);/);
  assert.match(mount, /import \{ flushSync \} from "react-dom";/);
});

test('the boot placeholder stays invisible for its whole delay', () => {
  // `animation-fill-mode: backwards` applies the FIRST KEYFRAME during the
  // delay, and the first keyframe of `ds-boot-pulse` is `opacity:.18`. So while
  // the shell claimed the dots were hidden until 240 ms, they in fact painted
  // from the very first frame — caught on screencast 125 ms into a navigation.
  // Without a fill mode the base `opacity:0` holds, which is what was intended.
  const shell = readFileSync(new URL('../src/shell.ts', import.meta.url), 'utf8');
  assert.match(shell, /animation:ds-boot-pulse [^']*240ms infinite\}/);
  assert.ok(!/240ms infinite backwards/.test(shell), 'backwards would reveal the dots during the delay');
  assert.match(shell, /\.ds-boot-dot\{[^']*opacity:0\}/, 'and the resting state is genuinely invisible');
});

test('every entry point that means "choose a scope" reaches this surface', async () => {
  await withRepo(async ({ page, route }) => {
    for (const path of [`${route}/change`, `${route}/change?scope=uncommitted`, `${route}/change?base=main&head=feature`]) {
      const { response, html } = await page(path);
      assert.equal(response.status, 200, `${path} should render the scope picker`);
      assert.match(html, /data-surface="change"/, `${path} should render the scope picker`);
    }
    // The bare route and the legacy new-story query both redirect into the
    // repo-named change route rather than rendering a second copy of it.
    for (const path of ['/change?scope=uncommitted', '/?story=new']) {
      const { response } = await page(path);
      assert.equal(response.status, 302, `${path} redirects rather than rendering`);
      assert.ok(response.headers.get('location')?.startsWith(`${route}/change`), response.headers.get('location'));
    }
  });
});

test('a story that will not load lands here with an explanation, not on the error page', async () => {
  // The reason this surface exists twice over. `reviewScreen()` falls through to
  // `changeScreen(…, notice)` and the notice is the ONLY thing that tells the
  // reviewer why they are looking at a scope picker instead of their review.
  await withRepo(async ({ repo, page, payloadOf, route }) => {
    mkdirSync(join(repo, '.codestory'), { recursive: true });
    writeFileSync(join(repo, '.codestory', 'story.json'), '{"bogus":true}');

    const { response, html } = await page(`${route}/review?story=story.json`);
    assert.equal(response.status, 200);
    assert.match(html, /data-surface="change"/, 'a broken story falls through to the scope picker');
    assert.ok(!html.includes("Couldn't build the review"), 'and never to the raw error page');

    const payload = payloadOf(html);
    assert.ok(payload.notice, 'the payload carries the explanation');
    assert.match(payload.notice, /is not a valid story/, payload.notice);
    assert.match(payload.notice, /steps must be a non-empty array/, 'including what specifically is wrong');
    // The scope picker still has to be usable — the fallthrough is a working
    // page, not a stub with an error on it.
    assert.equal(payload.routeBase, route);
    assert.ok(Array.isArray(payload.files));
    assert.ok(payload.scopeLabel);
  });
});

test('a healthy scope carries no notice at all', async () => {
  await withRepo(async ({ page, payloadOf }) => {
    const { html } = await page();
    assert.equal(payloadOf(html).notice, undefined, 'the amber banner is for failures only');
  });
});

// ─────────────────────────────────────────────────────────── 2. the payload

test('the payload carries the RESOLVED scope, not the raw query', async () => {
  await withRepo(async ({ page, payloadOf, route, repo }) => {
    const compare = payloadOf((await page(`${route}/change?base=main&head=feature`)).html);
    assert.equal(compare.active, 'compare');
    assert.equal(compare.base, 'main');
    assert.equal(compare.head, 'feature');
    assert.equal(compare.scopeLabel, 'main → feature');
    assert.equal(compare.repoName, basename(repo));
    assert.equal(compare.routeBase, route);

    const uncommitted = payloadOf((await page(`${route}/change?scope=uncommitted`)).html);
    assert.equal(uncommitted.active, 'uncommitted');
    assert.equal(uncommitted.base, 'HEAD', 'uncommitted resolves to a concrete ref, not to the absent override');
    assert.equal(uncommitted.head, undefined, 'and stops at the working tree');
    assert.equal(uncommitted.scopeLabel, 'Uncommitted changes');

    const commit = payloadOf((await page(`${route}/change?scope=commit&commit=HEAD`)).html);
    assert.equal(commit.active, 'commit');
    assert.equal(commit.head, 'HEAD');
    assert.notEqual(commit.base, 'HEAD', 'a single commit resolves its base to the parent');
    assert.equal(commit.scopeLabel, 'Latest commit');
  });
});

test('the payload lists changed files as raw counts, and generated output is not filtered out server-side', async () => {
  await withRepo(async ({ page, payloadOf, route }) => {
    const payload = payloadOf((await page(`${route}/change?base=main&head=feature`)).html);
    const byPath = Object.fromEntries(payload.files.map((file) => [file.path, file]));

    assert.deepEqual(Object.keys(byPath).sort(), ['added.ts', 'dist/bundle.js', 'kept.ts', 'package-lock.json']);
    assert.deepEqual(byPath['kept.ts'], { path: 'kept.ts', added: 2, removed: 1 });

    // The generated/primary split is a reading decision and happens in the
    // component; the payload stays a faithful list of what git reported, so the
    // +/− ledger and the "Review N files" count still see everything.
    assert.ok(byPath['dist/bundle.js'], 'build output travels');
    assert.ok(byPath['package-lock.json'], 'lockfiles travel');

    // Presentation stays client-side.
    const text = JSON.stringify(payload);
    assert.ok(!text.includes('review file'), 'the file/files wording is formatted in the component');
    assert.ok(!text.includes('totalChanged'), 'a second copy of files.length cannot disagree with files.length');
    assert.ok(!text.includes('hasChanges'), 'nor can a second copy of files.length > 0');
  });
});

test('an empty working tree is a state, not an error', async () => {
  await withRepo(async ({ page, payloadOf, route }) => {
    const { response, html } = await page(`${route}/change?scope=uncommitted`);
    assert.equal(response.status, 200, 'a clean tree is a 200');
    const payload = payloadOf(html);
    assert.deepEqual(payload.files, [], 'with nothing to review');
    assert.equal(payload.notice, undefined, 'and nothing has gone wrong');
    assert.equal(payload.active, 'uncommitted');
  });
});

test('a hostile ref cannot break out of the payload script element', async () => {
  const hostile = '</script><img src=x onerror=alert(1)>';
  await withRepo(async ({ page, payloadOf, route }) => {
    // `resolveScope` builds its label out of the ref the user typed, so a
    // crafted ?base= is the shortest path from a URL to the document.
    const { html } = await page(`${route}/change?base=${encodeURIComponent(hostile)}&head=${encodeURIComponent('<!--')}`);
    assert.ok(!html.includes('</script><img'), 'the raw sequence must never appear in the document');
    assert.ok(!html.includes('<!--'), 'nor may a comment opener switch the tokenizer state');
    const payload = payloadOf(html);
    assert.equal(payload.base, hostile, 'and it still round-trips exactly');
    assert.equal(payload.head, '<!--');
  });
});

// ─────────────────────────────────────────── 3. at-risk choreography, in source

test('the ref combobox keeps all four of its keyboard shortcuts', () => {
  // ArrowDown / ArrowUp, CLAMPED. The repo picker's folder list wraps; this one
  // must not. Both are inventoried that way on purpose.
  assert.match(refPicker, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp" \|\| event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(refPicker, /move\(index \+ \(event\.key === "ArrowDown" \? 1 : -1\)\)/);
  assert.match(refPicker, /setOverride\(Math\.max\(0, Math\.min\(next, rows\.length - 1\)\)\)/, 'clamps at both ends');
  assert.ok(
    !/%\s*rows\.length/.test(refPicker),
    'a modulo would turn the clamp into the repo picker’s wrapping behaviour',
  );
  // Home / End.
  assert.match(refPicker, /if \(event\.key === "Home"\) move\(0\);/);
  assert.match(refPicker, /else if \(event\.key === "End"\) move\(rows\.length - 1\);/);
  // An arrow against a closed listbox opens it and stops there.
  assert.match(refPicker, /if \(!owns\) \{\s*open\(kind, queries\[kind\]\);\s*return;\s*\}/);
  // Enter activates the active option, which navigates.
  assert.match(refPicker, /event\.key === "Enter" && owns && rows\[index\]\?\.value/);
  assert.match(refPicker, /choose\(rows\[index\]\.value\)/);
  // Escape closes, and stops any document-level handler double-handling it.
  assert.match(refPicker, /event\.key === "Escape" && owns/);
  assert.match(refPicker, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*close\(\);/);
  // Every arrow/Home/End path suppresses the browser's own caret movement.
  assert.ok((refPicker.match(/event\.preventDefault\(\)/g) ?? []).length >= 4);
  // Hover moves the active descendant WITHOUT scrolling; keys scroll.
  assert.match(refPicker, /scrollNext\.current = true;/);
  assert.match(refPicker, /onHover: \(position: number\) => \{\s*scrollNext\.current = false;/);
  assert.match(refPicker, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test('the ref combobox keeps its combobox/listbox accessibility contract', () => {
  // Three fields, one listbox, and no <datalist> anywhere.
  assert.match(refPicker, /role: "combobox"/);
  assert.match(refPicker, /"aria-autocomplete": "list"/);
  assert.match(refPicker, /"aria-haspopup": "listbox"/);
  assert.match(refPicker, /"aria-controls": "refPicker"/);
  assert.match(refPicker, /"aria-expanded": owns/);
  assert.match(refPicker, /"aria-activedescendant": owns && index >= 0 \? `ref-option-\$\{id\}-\$\{index\}` : undefined/);
  assert.match(refPicker, /id="refPicker"\s+role="listbox"\s+aria-label="Available Git references"/);
  assert.match(refPicker, /role="option"/);
  assert.match(refPicker, /aria-selected=\{position === index\}/);
  assert.match(refPicker, /tabIndex=\{-1\}/, 'options stay out of the tab ring');
  assert.ok(!/<datalist/.test(changeSource), 'the native datalist menu is not what this is');
  // Three fields exist, each with the id the picker addresses it by.
  for (const field of ['"commit", "commitRef"', '"base", "cmpBase"', '"head", "cmpHead"']) {
    assert.ok(scopeCard.includes(field), `wires ${field}`);
  }
  // The disclosure buttons stay in sync too.
  assert.match(scopeCard, /aria-controls="commitPanel"\s+aria-expanded=\{openPanel === "commit"\}/);
  assert.match(scopeCard, /aria-controls="comparePanel"\s+aria-expanded=\{openPanel === "compare"\}/);
});

test('the option list is different for each field, and says so while it loads', () => {
  assert.match(refs, /if \(!data\) return \[option\("", "Loading refs…", "reading local Git refs", ""\)\];/);
  assert.match(refs, /if \(kind === "commit"\) return \[option\("HEAD", "HEAD", "current HEAD", "head"\)\]\.concat\(commitOptions\(data\)\)/);
  assert.match(refs, /option\(WORKTREE, WORKTREE_LABEL, "HEAD plus uncommitted edits", "worktree"\)/);
  // The compare SOURCE gets branches then commits and no worktree pseudo-row:
  // you cannot diff *from* an uncommitted tree.
  assert.match(refs, /return branchOptions\(data\)\.concat\(commitOptions\(data\)\);/);
  // The filter reads value + label + meta + kind, so a commit subject matches.
  assert.match(refs, /`\$\{row\.value\} \$\{row\.label\} \$\{row\.meta\} \$\{row\.kind\}`\.toLowerCase\(\)/);
  assert.match(refs, /if \(!row\.value\) return true;/, 'the loading row is never filtered away');
  // The active row on (re)build matches the field, or the worktree row, or 0.
  assert.match(refs, /row\.value === current \|\| \(row\.value === WORKTREE && worktree\)/);
  assert.match(refs, /return found < 0 \? 0 : found;/);
  // Bare-string branches from older builds are still normalised.
  assert.match(refs, /typeof raw === "string" \? \{ name: raw, kind: "branch" \} : raw/);
});

test('the anchored listbox keeps its placement arithmetic', () => {
  // Every constant here is load-bearing: the width floor, the viewport margins,
  // the 7px offset, the flip-above rule and its own clamp.
  assert.match(refs, /Math\.min\(Math\.max\(260, Math\.round\(rect\.width\)\), Math\.max\(220, window\.innerWidth - 24\)\)/);
  assert.match(refs, /Math\.min\(Math\.max\(12, Math\.round\(rect\.left\)\), Math\.max\(12, window\.innerWidth - width - 12\)\)/);
  assert.match(refs, /Math\.max\(140, Math\.min\(260, window\.innerHeight - 24\)\)/);
  assert.match(refs, /let top = rect\.bottom \+ 7;/);
  assert.match(refs, /top = rect\.top - 7 - height;/);
  assert.match(refs, /if \(top < 12\) top = Math\.max\(12, window\.innerHeight - height - 12\);/);
  assert.match(refs, /picker\.dataset\.placement = placement;/);
  assert.match(refs, /picker\.style\.transformOrigin = placement === "top" \? "50% 100%" : "50% 0%";/);
  // And it stays anchored while the page moves under it. `scroll` is captured.
  assert.match(refPicker, /window\.addEventListener\("scroll", reposition, true\)/);
  assert.match(refPicker, /window\.addEventListener\("resize", reposition\)/);
  // Placement writes styles directly. A setState per scroll frame is how an
  // anchored popover starts lagging behind its anchor.
  assert.match(refs, /picker\.style\.left = `\$\{left\}px`;/);
});

test('a press inside the listbox never steals focus from the field', () => {
  // Without this the field blurs mid-click, the listbox closes, and the click
  // lands on nothing.
  assert.match(refPicker, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  // Focus leaving for the listbox is not a dismissal; anything else is, once
  // the browser has settled on a new active element.
  assert.match(refPicker, /if \(next && listbox\.current\?\.contains\(next\)\) return;/);
  assert.match(refPicker, /if \(inputs\.current\[kind\] === focused\) return;/);
  // A press anywhere else closes, unless it is the listbox or the owning field.
  assert.match(refPicker, /document\.addEventListener\("mousedown", onDown\)/);
  assert.match(refPicker, /if \(target === inputs\.current\[active\]\) return;/);
});

test('the refs request happens once, and its failure is silent and retryable', () => {
  assert.match(refPicker, /fetch\("\/api\/refs"\)/);
  assert.match(refPicker, /if \(cachedRefs\) return Promise\.resolve\(cachedRefs\);/);
  assert.match(refPicker, /if \(inflightRefs\) return inflightRefs;/);
  assert.match(refPicker, /\.catch\(\(\) => \{\s*inflightRefs = null;\s*return null;\s*\}\)/, 'a failure clears the in-flight promise so the next interaction retries');
  // Opening a panel loads refs, and so does arriving with one already open.
  assert.match(scopeCard, /const showPanel = \(panel: Panel\) => \{\s*if \(navTimer\.current\) window\.clearTimeout\(navTimer\.current\);\s*validationVersion\.current\+\+;\s*setOpenPanel\(panel\);\s*ensureRefs\(\);/);
  assert.match(scopeCard, /if \(openPanel\) ensureRefs\(\);/);
});

test('selection comes from the URL and disclosure does not', () => {
  // At-risk: opening a panel must never look like choosing a scope. The first
  // argument to segmentClass is the payload's `active`; the second is local
  // disclosure state, and they are never conflated.
  assert.match(scopeCard, /segmentClass\(active === "uncommitted", false\)/);
  assert.match(scopeCard, /segmentClass\(active === "commit", openPanel === "commit"\)/);
  assert.match(scopeCard, /segmentClass\(active === "compare", openPanel === "compare"\)/);
  assert.match(scopeCard, /segmentClass\(active === "branch", openPanel === "branch"\)/);
  assert.match(scopeCard, /function segmentClass\(selected: boolean, open: boolean\)/);
  assert.match(scopeCard, /selected\s*\?\s*"border-accent-line bg-accent-soft/, 'selected wins over open');
  assert.equal(
    (scopeCard.match(/text-sm leading-\[1\.3\] @max-\[600px\]:hidden/g) ?? []).length,
    4,
    'scope descriptions inherit the segment state color instead of pinning muted ink over the selected tint',
  );
  assert.match(scopeCard, /aria-current=\{active === "uncommitted" \? "true" : undefined\}/);
  // Only the disclosure buttons open panels; the uncommitted segment is a link.
  assert.match(scopeCard, /href=\{`\$\{routeBase\}\/change\?scope=uncommitted`\}/);
  // …but "never look like choosing a scope" is not "never look like anything".
  // `open` used to be `bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]`,
  // which against --fill-1 is under a percent of luminance in either theme, so
  // an open editor under a DIFFERENT lit segment read as a bug rather than as
  // two states. It now takes the same accent border as `selected` and none of
  // the fill: filled beats outlined, and both beat nothing.
  assert.match(scopeCard, /open\s*\n?\s*\?\s*"border-accent-line text-text"/);
  assert.ok(
    !/color-mix\(in_srgb,var\(--accent\)_8%/.test(scopeCard),
    'the invisible open tint does not come back',
  );
});

test('the four scope segments stay four across, in one track', () => {
  // The card is inside a `max-w-[960px]` main, where four segments fit down to
  // roughly 600px — below which they shorten to a single centred label on a
  // 2×2 grid. The old `max-[1080px]:grid-cols-2` (from the three-segment days)
  // orphaned a segment beside several hundred px of dead space on most laptop
  // windows; only the phone width may fold the track.
  assert.match(scopeCard, /const SEGMENT_TRACK = cn\(\s*\n?\s*"grid grid-cols-4 /);
  assert.ok(!/max-\[(?!600px\])[0-9]+px\]:grid-cols-2/.test(scopeCard), 'only the phone width folds the segments');
  assert.match(scopeCard, /className=\{SEGMENT_TRACK\}/);
  // The track owns the fill and the hairline; the segments are transparent
  // compartments in it, which is what makes three controls read as one choice.
  assert.match(scopeCard, /const SEGMENT_TRACK = cn\(\s*\n?\s*"[^"]*bg-fill-1/);
  assert.match(scopeCard, /const SEGMENT_BASE = cn\(\s*\n?\s*"[^"]*border-transparent bg-transparent/);
});

test('an endpoint of the diff is one tile whether it is being edited or resolved', () => {
  // The compare editor and the resolved summary describe the same two refs. They
  // are the same `SLOT` geometry with two tones — neutral while you type, accent
  // once it has resolved — so replacing one with the other is a tone change
  // rather than a layout change. They also share the grid, to the pixel.
  assert.match(scopeCard, /const SLOT = cn\(/);
  assert.match(scopeCard, /const SLOT_EDIT = cn\(SLOT, /);
  assert.match(scopeCard, /const SLOT_DONE = cn\(SLOT, /);
  assert.equal(
    (scopeCard.match(/grid-cols-\[minmax\(0,1fr\)_32px_minmax\(0,1fr\)\]/g) ?? []).length,
    3,
    'the compare editor, the branch editor and the split summary use one grid',
  );
  // Neither tile draws a border around a border any more.
  assert.ok(
    !/rounded-\[var\(--radius-lg\)\] border border-line-soft bg-fill-1 p-\[13px\]/.test(scopeCard),
    'the commit panel is a slot, not a panel wrapping a field',
  );
});

test('the scope summary and the compare editor never show the same two refs at once', () => {
  assert.match(scopeCard, /const showSplitSummary = inCompare && openPanel !== "compare";/);
  assert.match(scopeCard, /aria-label="Selected comparison"/);
  assert.match(scopeCard, /aria-label=\{`Source: \$\{baseValue\}`\}/);
  assert.match(scopeCard, /aria-label=\{`Target: \$\{headValue\}`\}/);
  assert.match(scopeCard, /aria-label="Selected review scope"/);
  assert.match(scopeCard, /active === "compare"\s*\?\s*"Selected comparison"\s*:\s*active === "commit"\s*\?\s*"Selected commit"\s*:\s*active === "branch"\s*\?\s*"Selected branch"\s*:\s*"Selected scope"/);
  // The compare editor prefills only in compare mode: other scopes resolve base
  // to bookkeeping values that would read as a chosen rev.
  assert.match(scopeCard, /useState\(inCompare \? base : ""\)/);
  assert.match(scopeCard, /const targetIsWorktree = !inCompare \|\| !head;/);
});

test('scope changes are real URLs, debounced, and never loop', () => {
  // The same-URL guard. Without it the page recomputes the URL it is already on
  // and navigates to itself forever.
  assert.match(scopeCard, /if \(url === window\.location\.pathname \+ window\.location\.search\) return;\s*setBusy\(true\);\s*window\.setTimeout\(\(\) => \{ window\.location\.href = url; \}, 0\);/);
  assert.match(scopeCard, /if \(delay > 0\) navTimer\.current = window\.setTimeout\(go, delay\);\s*else go\(\);/);
  assert.match(scopeCard, /if \(navTimer\.current\) window\.clearTimeout\(navTimer\.current\);/);
  // Typing waits 700ms; choosing a row or leaving an edited field does not.
  assert.match(scopeCard, /commit\(next, 700\)/);
  assert.match(scopeCard, /scheduleNavTo\(commitUrl\(value\), 0\)/);
  assert.match(scopeCard, /picker\.validateRef\(kind, value, delay === 0\)\.then/);
  assert.match(scopeCard, /if \(version !== validationVersion\.current\) return;/);
  assert.match(scopeCard, /"aria-invalid": errors\[kind\] \? true : undefined/);
  assert.match(scopeCard, /"aria-describedby": errors\[kind\] \? `\$\{id\}Error` : undefined/);
  // The two URL shapes.
  assert.match(scopeCard, /\$\{routeBase\}\/change\?scope=commit&commit=\$\{encodeURIComponent\(value\.trim\(\) \|\| "HEAD"\)\}/);
  assert.match(scopeCard, /if \(!source\) return "";/, 'no base means no navigation at all');
  assert.match(scopeCard, /worktree \|\| nextHead\.trim\(\) === WORKTREE_LABEL \? "" : nextHead\.trim\(\)/);
  assert.match(scopeCard, /\$\{target \? `&head=\$\{encodeURIComponent\(target\)\}` : ""\}/, 'the working tree is the absence of &head');
  // And the review link repeats the resolved scope so /diff diffs the same pair.
  assert.match(changeApp, /const diffHref = `\$\{routeBase\}\/diff\$\{scopeQuery\(base, head\)\}`;/);
  assert.match(format, /parts\.push\(`base=\$\{encodeURIComponent\(base\)\}`\)/);
});

test('navigation stays real URLs — no client-side router is introduced', () => {
  // Comments mentioning the API by name are fine; a call to it is not.
  assert.ok(
    !/(?:history|window\.history)\s*\.\s*(?:pushState|replaceState)\s*\(/.test(changeSource),
    'there is no history API anywhere in this codebase',
  );
  assert.match(scopeCard, /window\.location\.href = url;/);
});

test('the change page touches no browser storage of its own', () => {
  const keys = new Set(
    [...changeSource.matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\("([^"]+)"/g)].map((m) => m[1]),
  );
  assert.deepEqual([...keys], [], 'the theme hook owns the only key this surface reaches');
  assert.ok(!/sessionStorage/.test(changeSource), 'no sessionStorage anywhere in this app');
});

test('the change page opens no live connection and embeds no progress panel', () => {
  assert.ok(!/EventSource/.test(changeSource), 'freshness here is manual: Reload or a scope navigation');
  for (const gone of [/ds-pp-plan/, /ProgressPanel/, /run_done/, /\/api\/generate/, /\/api\/story\/repair/]) {
    assert.doesNotMatch(changeSource, gone, `${gone} belongs to the review page`);
  }
  // The only endpoint this surface calls.
  const endpoints = [...changeSource.matchAll(/fetch\("(\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(endpoints, ['/api/refs']);
});

test('the surface does not animate its own arrival', () => {
  // At-risk #8, and the single most important motion decision here: every scope
  // change is a full navigation, so a page-level entrance replays on every ref
  // change and reads as broken.
  assert.ok(!/ds-reveal/.test(changeSource), 'no page or section entrance');
  assert.ok(!/AnimatedNumber|NumberTicker|animated-number|number-ticker/.test(changeSource), 'the ledger does not count up on every arrival');
  assert.ok(!/layoutId|layout=/.test(changeSource), 'the segments do not animate between selections');
  assert.ok(!/ds-scope-thread|ds-thread-layer/.test(changeSource), 'no decorative thread on this surface');
  // The one entrance that IS wanted, with the vanilla timing and Signal easing.
  assert.match(refPicker, /import \{ EASE_SIGNAL_OUT \} from "\.\.\/\.\.\/shared\/motion";/);
  assert.match(refPicker, /clipPath: "inset\(0px 0px 100% round 10px\)"/);
  assert.match(refPicker, /open\s*\? \{ duration: 0\.24, ease: EASE_SIGNAL_OUT \}/);
  assert.match(refPicker, /: \{ duration: 0\.16, ease: EASE_SIGNAL_OUT \}/);
  assert.match(refPicker, /onAnimationComplete=\{\(\) => \{\s*if \(!open\) setPresent\(false\);/);
  assert.match(refPicker, /const reduce = useReducedMotion\(\);/, 'and it steps instead of animating under reduced motion');
  assert.match(scopeCard, /height: open \? "auto" : 0/);
  assert.match(scopeCard, /aria-hidden=\{openPanel !== "commit"\}\s+inert=\{openPanel !== "commit"\}/);
  assert.match(scopeCard, /aria-hidden=\{openPanel !== "compare"\}\s+inert=\{openPanel !== "compare"\}/);
  // Press feedback keeps the vanilla scale and drops under reduced motion.
  // This used to be `/active:scale-\[\.985\]|max-\[600px\]/`, which the second
  // alternative satisfied on every version of this file — including the one
  // where the segments listed `transform` in their transition and then never
  // changed a transform, so there was no press feedback at all. The scale now
  // comes from Motion's gesture, which gates itself on `useReducedMotion()`.
  assert.match(scopeCard, /motion-reduce:transition-none motion-reduce:active:transform-none/);
  assert.match(scopeCard, /const SEGMENT_PRESS = 0\.985;/);
  assert.equal(
    (scopeCard.match(/pressScale=\{SEGMENT_PRESS\}/g) ?? []).length,
    4,
    'all four segments press, not just the three that are buttons',
  );
  // And none of them lifts on hover: three tiles side by side scaling up 2% is
  // the "lurch" the repo picker's full-width card rejected, at three times over.
  assert.equal((scopeCard.match(/whileHover=\{undefined\}/g) ?? []).length, 5);
});

test('the beUI segments do not inherit beUI geometry', () => {
  // `SIZE_CLASS` pins `h-10` on every Button variant, and tailwind-merge treats
  // `h` and `min-h` as different groups — without `h-auto` the 64px scope tile
  // silently becomes a 40px pill. Its base class also centres content, which on
  // a `flex-col` tile centres both labels away from the left edge.
  assert.match(scopeCard, /const SEGMENT_BASE = cn\(\s*\n?\s*"flex h-auto min-h-16 [^"]*items-stretch justify-start/);
  // The vendored colour classes name variables this app does not define, so the
  // segment supplies its own — including the focus ring, because the component
  // ships `focus-visible` styling that resolves to nothing.
  // `--shadow-focus` rather than a spelled-out ring: the app-wide indicator was
  // a bare `0 0 0 3px var(--accent-soft)` wash measuring ~1.24:1, so it is now a
  // solid --accent core plus that wash, defined once in the theme bridge.
  assert.match(scopeCard, /focus-visible:outline-none focus-visible:shadow-\[var\(--shadow-focus\)\]/);
});

test('the vendored ref field keeps a focus ring, drawn on the slot that labels it', () => {
  // The field is borderless now: the slot around it is the box, so a ring on
  // the `<input>` wrapper would be a second box inside the first. The ring
  // moved to the slot and hangs off `focus-within`, which stays lit while a
  // listbox row is being hovered — the same reason the old ring hung off the
  // component's `data-state="focused"` rather than off `:focus`.
  assert.match(scopeCard, /focus-within:border-accent-line focus-within:shadow-\[var\(--shadow-focus\)\]/);
  // And the component's own focus decoration is cancelled rather than left to
  // paint under it. NOTE: `--color-ring` DOES resolve in this bridge (it is
  // `--accent-line`, client/generated/theme.css), so beUI's `ring-2
  // ring-ring/40` is not the no-op an earlier version of this comment claimed —
  // without `ring-0` it draws. `border-foreground/40` resolves too.
  assert.match(scopeCard, /field: "[^"]*\bring-0\b/);
  assert.match(scopeCard, /field: "[^"]*\bborder-transparent\b/);
  assert.ok(!/ring-ring|border-foreground/.test(scopeCard), 'and none of it is re-spelled by hand');
  // Refs are data, and data is mono here (DESIGN_MEMORY.md). The placeholder is
  // prose about refs, so it stays sans.
  assert.match(scopeCard, /input: cn\(\s*\n?\s*"[^"]*font-mono/);
  assert.match(scopeCard, /placeholder:font-sans/);
  // All three fields are the same field.
  assert.equal((scopeCard.match(/classNames=\{FIELD_CLASSNAMES\}/g) ?? []).length, 5);
  // The picker's `value` still arrives as a string, because that is what the
  // component hands back — the old handler read `event.target.value` and this
  // one must not silently start committing `[object Object]`.
  assert.match(scopeCard, /onChange: \(next: string\) => \{\s*setErrors\(\(current\) => \(\{ \.\.\.current, \[kind\]: undefined \}\)\);\s*picker\.open\(kind, next\);\s*commit\(next, 700\);/);
});

test('adopted live-region carriers stay quiet while committed ref errors remain audible', () => {
  // `Input` bakes in a `role="alert"` and `Loader` a `role="status"`. Committed
  // ref errors are explicitly preserved; repeated loaders stay quiet. Importing
  // the hook is not the same as covering the node, so assert the ref each hook
  // is given actually wraps the carrier: the card element for the fields, the
  // listbox element for its spinner, and a `display: contents` box for the
  // reload control, which lives in the nav rather than in the card.
  assert.match(scopeCard, /vendor\/beui\/motion\/input/);
  assert.match(scopeCard, /vendor\/beui\/motion\/loader/);
  assert.match(scopeCard, /const card = useRef<HTMLElement>\(null\);\s*useQuietSubtree\(card, \{ keep: "\[data-ref-error\]" \}\);/);
  assert.match(scopeCard, /<section\s*\n?\s*ref=\{card\}/);
  assert.match(scopeCard, /data-ref-error="" role="alert"/);
  assert.match(scopeCard, /const root = useRef<HTMLSpanElement>\(null\);\s*useQuietSubtree\(root\);/);
  assert.match(scopeCard, /<span ref=\{root\} className="contents">/);
  assert.match(refPicker, /useQuietSubtree\(ref\);/);
  // The listbox spinner replaces the kind tag on the placeholder row only — a
  // spinner on a real ref would claim work that is not happening.
  assert.match(refPicker, /\{row\.value \? row\.kind : <Loader variant="spinner" size=\{13\} label="" /);
});

test('the file inventory keeps its reading order, its generated split, and its counts', () => {
  // Generated output is partitioned out of the primary list but still counted.
  assert.match(format, /\/\^\(dist\|build\|coverage\|out\|target\)\\\//);
  assert.match(format, /package-lock\\\.json\|yarn\\\.lock\|pnpm-lock\\\.yaml/);
  assert.match(fileSummary, /const primary = files\.filter\(\(file\) => !generatedOutput\(file\.path\)\);/);
  assert.match(fileSummary, /const generated = files\.filter\(\(file\) => generatedOutput\(file\.path\)\);/);
  assert.match(fileSummary, /<b className="font-display font-bold text-text tabular-nums">\{formatCount\(primary\.length\)\}<\/b> review/);
  assert.match(fileSummary, /const reviewCount = `\$\{formatCount\(files\.length\)\} \$\{plural\(files\.length, "file", "files"\)\}`;/, 'the CTA counts every file, generated output included');
  assert.match(format, /acc\.added \+ \(file\.added \?\? 0\)/, 'so does the ledger');
  // The CTA spells out the verb for assistive technology.
  assert.match(fileSummary, /aria-label=\{`Review \$\{reviewCount\}`\}/);
  // Binary files get a hatch and a word, never a fake +0/−0.
  assert.match(fileSummary, /binary \/ metadata/);
  assert.match(fileSummary, /const binary = file\.added === null \|\| file\.removed === null;/);
  // The atlas's evidence selectors for this surface.
  assert.match(fileSummary, /className="file-card min-w-0"/);
  assert.match(fileSummary, /"frow flex items-center/);
  assert.match(fileSummary, /className="empty-title/);
  // Generated output is still a disclosure, still collapsed, still counted.
  assert.match(fileSummary, /<details id="generated"/);
  assert.match(fileSummary, /<span>Generated output<\/span>/);
  assert.match(fileSummary, /\{formatCount\(generated\.length\)\} \{plural\(generated\.length, "file", "files"\)\}/);
  assert.ok(!/<details[^>]*open/.test(fileSummary), 'and it does not arrive open');
  // The native disclosure stays flush with the file list: no rounding, no
  // island. (The vendored accordion it replaced needed a rounded-none!
  // override for the 28px radius it animated onto its row.)
  assert.match(fileSummary, /<details id="generated" className="group border-t border-line-soft bg-fill-1">/);
});

test('the scope picker declines the vendored components that would change what it means', () => {
  // Each of these was considered and rejected on behaviour, not on taste; the
  // reasons are written down at the site that would have used them. An import
  // is what would undo that, so an import is what this guards.
  for (const declined of [
    'motion/table',
    'motion/tabs',
    'motion/morphing-tabs',
    'motion/expandable-tabs',
    'motion/select',
    'motion/select-morph',
    'motion/popover',
    'motion/number-ticker',
    'motion/animated-number',
    'motion/scroll-reveal',
    'motion/text-reveal',
    'agents/file-diff',
  ]) {
    assert.ok(!changeSource.includes(`vendor/beui/${declined}`), `${declined} was declined on purpose`);
  }
  // The reasoning survives in prose, which the stripped source cannot see — so
  // read the raw files for it and fail if a rewrite quietly drops the record.
  const prose = ['ScopeCard.tsx', 'RefPicker.tsx', 'FileSummary.tsx', 'ChangeApp.tsx']
    .map((file) => readRaw(`surfaces/change/${file}`))
    .join('\n');
  assert.match(prose, /role="tablist"/, 'why the segments are not tabs');
  assert.match(prose, /the only key any of the three binds is Escape/, 'why the combobox is not a Select');
  assert.match(prose, /motion\/table\//, 'why the inventory is not a data grid');
});

test('the empty working tree keeps its honest, non-error copy', () => {
  // The tick used to be a `✓` glyph in the copy; it is now the badge's own
  // Check icon. Same tone, same words, same success colour — assert all three
  // rather than the string that happens to hold them.
  assert.match(fileSummary, /status="success"/);
  assert.match(fileSummary, /icon=\{<Check /);
  // `--add` is the rail-and-fill hue; `--diff-add-text` is the same semantic
  // green tuned to carry AA as small ink on a pale `--add-soft` badge (it is
  // `var(--add)` in dark, so only light theme moves). Either spelling satisfies
  // this assertion — what it is guarding is the tone, not the token name. The
  // one thing that must never appear here is a `del` colour.
  assert.match(fileSummary, /bg-add-soft[^"]*text-(add|diff-add-text)\b/, 'the clean tree reads as success, never as an error');
  assert.doesNotMatch(fileSummary, /bg-add-soft[^"]*text-(del|diff-del-text)\b/, 'and never as a failure');
  assert.match(fileSummary, /working tree clean/);
  assert.match(fileSummary, /Nothing to review/);
  assert.match(fileSummary, /Pick another scope above, or make a change\. When your agent writes code, the changes appear here\./);
  assert.match(fileSummary, /^\s*Reload$/m);
  assert.match(fileSummary, /Review history →/);
  assert.doesNotMatch(fileSummary, /Nothing to review for /, 'does not repeat long refs in the empty-state headline');
});

test('the failure notice keeps its wording and its way forward', () => {
  assert.match(changeApp, /That review could not be loaded\./);
  assert.match(changeApp, /Start the review below,\s*\n?\s*then generate a fresh story from the Story tab\./);
  assert.match(changeApp, /\{notice\}/, 'and the server’s own reason, verbatim');
  assert.match(changeApp, /border-amber bg-amber-soft/);
  assert.ok(
    changeApp.indexOf('{notice ?') < changeApp.indexOf('<ScopeCard'),
    'renders above the scope controls, not below the fold',
  );
});

test('the session header keeps the heading primary and the workflow stepper secondary', () => {
  assert.match(changeApp, /Review session/);
  assert.match(changeApp, /Choose what to review/);
  assert.match(changeApp, /Set the exact Git scope, confirm the changed files, then start with the real diff\./);
  // Four stages, three connectors, stage 01 current, numerals not badges.
  assert.match(changeApp, /\["01", "Scope"\],\s*\n\s*\["02", "Read"\],\s*\n\s*\["03", "Resolve"\],\s*\n\s*\["04", "Decide"\],/);
  assert.match(changeApp, /\{index > 0 \? \(/, 'the connector is skipped before the first stage, which is what makes it three');
  assert.match(changeApp, /aria-current=\{active \? "step" : undefined\}/);
  assert.match(changeApp, /role="list"\s*\n?\s*aria-label="Review workflow"/);
  assert.match(changeApp, /font-display text-sm leading-none font-bold tracking-\[var\(--tracking-numeral\)\]/, 'Space Grotesk numerals, not circled badges');
  // The ledger is supporting detail and steps aside below 980px.
  assert.match(changeApp, /aria-label="Current scope summary"/);
  assert.match(changeApp, /max-\[980px\]:hidden/);
});

test('the nav keeps the wordmark, the breadcrumb, and the two page actions', () => {
  assert.match(changeApp, /crumbs=\{\[\{ label: repoName, href: `\$\{routeBase\}\/change` \}, \{ label: "Scope" \}\]\}/);
  assert.match(changeApp, /href=\{`\$\{routeBase\}\/stories`\}/);
  assert.match(changeApp, />\s*Review history\s*</);
  assert.match(scopeCard, /aria-label="Reload current scope"/);
  // The reload hint used to be a `title`, which is a permanent accessible
  // DESCRIPTION. A tooltip only supplies `aria-describedby` while its bubble is
  // open, so the description has to be restored explicitly or it exists for
  // exactly as long as the pointer hovers.
  assert.match(scopeCard, /const RELOAD_HINT = "Re-read the working tree and rebuild the diff";/);
  assert.match(scopeCard, /<Tooltip content=\{RELOAD_HINT\}/);
  assert.match(scopeCard, /aria-description=\{RELOAD_HINT\}/, 'the hover-only bubble is not the whole story');
  assert.match(scopeCard, /max-\[480px\]:hidden">Reload<\/span>/, 'the reload label goes away on a phone, the icon does not');
  // The shared bar itself.
  assert.match(nav, /title="Home — your repositories"\s*\n?\s*aria-label="Home — your repositories"/);
  assert.match(nav, /<nav aria-label="Breadcrumb"/);
  assert.match(nav, /aria-current="page"/);
  assert.match(nav, /max-\[560px\]:hidden/, 'the wordmark gives way to the mark on a phone');
  assert.match(nav, /<ThemeMenu \/>/, 'one theme control, before the page slot');
});

test('the change page does not resurrect UI that was deliberately removed', () => {
  for (const gone of [
    /Generate guided review/,
    /storyMode/,
    /Current branch/,
    /Branch commits/,
    /Cross-branch commits/,
    /cmpBaseRef/,
    /cmpHeadRef/,
    /Review commit/,
    /Compare refs</,
    /data-picker="side-commit"/,
    /Review sessions/,
    /Each side takes anything git does/,
    /agentSel|modelSel/,
    /scope-command/,
  ]) {
    assert.doesNotMatch(changeSource, gone, `${gone} was removed on purpose`);
  }
  // Source/Target, never From/To.
  assert.match(scopeCard, /Source <i/);
  assert.match(scopeCard, /Target <i/);
  assert.ok(!/>From</.test(scopeCard) && !/>To</.test(scopeCard), 'labels the sides by meaning, not position');
});

// ─────────────────────────────────────────────────────────── 4. the bundle

test('the built bundle actually ships the change behaviour', (t) => {
  const dir = new URL('../dist/client/', import.meta.url);
  const entry = new URL('change.js', dir);
  if (!existsSync(entry)) {
    t.skip('client bundle not built');
    return;
  }
  // Code splitting hoists whatever two surfaces share into a `chunk-*.js`, so
  // the question "did this string survive the build" is about the entry AND the
  // chunks it pulls in — asserting on the entry alone would start failing the
  // day another surface happens to use the same helper.
  //
  // esbuild emits an ASCII bundle, so every non-ASCII character in a user-facing
  // string ("Loading refs…", "Parent → selected commit", the curly apostrophe in
  // the failure notice) ships as a `\uXXXX` escape. Decode those before
  // searching, or half the strings worth guarding would silently never match.
  const js = readdirSync(dir)
    .filter((file) => file === 'change.js' || (file.startsWith('chunk-') && file.endsWith('.js')))
    .map((file) => readFileSync(new URL(file, dir), 'utf8'))
    .join('\n')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

  assert.ok(js.includes('/api/refs'), 'bundle calls /api/refs');
  for (const text of [
    'Choose what to review',
    'Review session',
    'Uncommitted',
    'Working tree vs HEAD',
    'Single commit',
    'Parent → selected commit',
    'Whole branch',
    'Fork point → branch tip',
    'Use the current branch',
    'Auto-detect',
    'Compare any refs',
    'Source → target, any branch or commit',
    'HEAD or a commit SHA',
    'branch, tag, or commit',
    'Shows that commit against its first parent',
    'Available Git references',
    'Loading refs…',
    'No refs match',
    'Try a branch name, tag, or commit.',
    'HEAD plus uncommitted edits',
    'Working tree',
    'Selected comparison',
    'Selected review scope',
    'Nothing to review',
    'working tree clean',
    'Pick another scope above',
    'Review history →',
    'Generated output',
    'binary / metadata',
    'Try again',
    'Reload current scope',
    'Review workflow',
    // The failure branch a user only ever sees when something has gone wrong is
    // the easiest string on the surface to lose and the hardest to notice.
    'That review could not be loaded.',
    'Start the review below, then generate a fresh story from the Story tab.',
  ]) {
    assert.ok(js.includes(text), `bundle should contain ${JSON.stringify(text)}`);
  }
  assert.ok(js.includes('__CODESTORY_DATA__'), 'bundle reads the shell payload');
  assert.ok(js.includes('ds-theme'), 'bundle carries the theme contract');
  assert.ok(!js.includes('pushState'), 'and introduces no client-side router');
});
