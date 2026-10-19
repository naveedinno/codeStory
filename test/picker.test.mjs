// The repository picker, after the React rewrite.
//
// The old version of this file asserted on a 30 KB HTML string that
// `renderPicker()` built by hand. That string no longer exists: the route emits
// a shell plus a JSON payload, and the behaviour lives in `client/surfaces/picker/`
// and ships as `dist/client/picker.js`. So the assertions moved, in four layers:
//
//   1. THE ROUTE      — a real server, real requests. What HTML does the picker
//                       route actually serve, on every route that reaches it?
//   2. THE PAYLOAD    — the whole initial state, including the escaping that
//                       stops a repository name from closing the script element.
//   3. THE SOURCE     — the choreography and keyboard invariants that
//                       `docs/superpowers/specs/surface-inventory.md` ranks as
//                       at-risk. These were previously asserted against emitted
//                       JS text; they are now asserted against the TypeScript
//                       that emits it, which is the same kind of guard.
//   4. THE BUNDLE     — every user-facing string and endpoint survives the
//                       build, so layer 3 is guarding code that actually ships.
//
// What layers 3 and 4 cannot do is prove the DOM behaves. That is verified by
// driving the real page in Chrome (see the report accompanying this rewrite):
// all four modal shortcuts, wrapping arrow navigation, the focus trap, focus
// restore, the inert background, theme switching, and the close timing were
// each observed in a real browser. If this surface grows a regression the source
// text cannot catch, that browser run is what should become a test file — not a
// weaker string match here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../dist/server.js';

const CLIENT = new URL('../client/', import.meta.url);
const readRaw = (relative) => readFileSync(new URL(relative, CLIENT), 'utf8');

// Source assertions must read code, not prose. A comment explaining why some
// API is forbidden otherwise trips the very guard that forbids it — which is
// exactly how the WebKit `closest()` note below first broke this file. Only
// whole-line comments are stripped, so a `//` inside a string literal (a URL,
// say) is left alone.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');

const read = (relative) => stripComments(readRaw(relative));

const useModal = read('shared/use-modal.ts');
const folderBrowser = read('surfaces/picker/FolderBrowser.tsx');
const pickerApp = read('surfaces/picker/PickerApp.tsx');
const recentRepos = read('surfaces/picker/RecentRepos.tsx');
const skillBanner = read('surfaces/picker/SkillBanner.tsx');
const themeMenu = read('shared/theme-menu.tsx');
const sharedCss = read('shared/shared.css');
const pickerSource = [useModal, folderBrowser, pickerApp, recentRepos, skillBanner, themeMenu].join('\n');

const PAYLOAD_BLOCK = /<script type="application\/json" id="__CODESTORY_DATA__">([\s\S]*?)<\/script>/;

/** Boot a real server against a scratch HOME so the recents store is ours. */
async function withPicker(recents, run) {
  const home = mkdtempSync(join(tmpdir(), 'codestory-picker-home-'));
  mkdirSync(join(home, '.codestory'), { recursive: true });
  writeFileSync(join(home, '.codestory', 'recents.json'), JSON.stringify(recents));
  const server = serve({ port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await run({
      base,
      home,
      async page(path = '/repos') {
        const response = await fetch(base + path, { redirect: 'manual' });
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
    rmSync(home, { recursive: true, force: true });
  }
}

function gitRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `codestory-picker-${name}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

// ─────────────────────────────────────────────────────────── 1. the route

test('the picker route serves a React shell, not a hand-built page', async () => {
  await withPicker([], async ({ page }) => {
    const { response, html } = await page('/repos');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);

    assert.match(html, /<title>codeStory — Pick a repository<\/title>/);
    assert.match(html, /<body class="ds-map-bg" data-surface="picker">/, 'the dot field paints before React mounts');
    assert.match(html, /<link rel="stylesheet" href="\/assets\/client\/app\.css">/);
    assert.match(html, /<script type="module" blocking="render" data-ds-entry src="\/assets\/client\/picker\.js"><\/script>/);
    assert.match(html, /<meta name="theme-color" content="#0a0c0f" data-ds-theme-color>/);

    // The theme bootstrap must run before the stylesheet or a light-mode user
    // gets a dark flash on every navigation (dark is the no-script fallback).
    assert.ok(
      html.indexOf("var key='ds-theme'") < html.indexOf('<link rel="stylesheet"'),
      'resolves the theme before the stylesheet',
    );

    // One inline script (theme) + one JSON data block + one module entry is the
    // whole script budget for a shell. Anything else belongs in the bundle.
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

test('every no-repo entry point renders the picker rather than an error', async () => {
  await withPicker([], async ({ page }) => {
    for (const path of ['/', '/repos', '/change', '/review', '/stories']) {
      const { response, html } = await page(path);
      assert.equal(response.status, 200, `${path} should render the picker`);
      assert.match(html, /data-surface="picker"/, `${path} should render the picker`);
    }
  });
});

// ─────────────────────────────────────────────────────────── 2. the payload

test('the payload carries raw recents, the home prefix, and the server clock', async () => {
  const repo = gitRepo('live');
  const before = Date.now();
  try {
    await withPicker(
      [
        { path: repo, name: 'live', lastOpened: 1_700_000_000_000, isGit: true, hasTour: false, currentBranch: 'main', changedFiles: 3 },
        { path: '/definitely/not/here', name: 'gone', lastOpened: 1_699_000_000_000, isGit: true, hasTour: true, currentBranch: 'trunk', changedFiles: 9 },
      ],
      async ({ page, payloadOf, home }) => {
        const { html } = await page('/repos');
        const payload = payloadOf(html);

        assert.equal(payload.home, home, 'the client needs home to render ~/… paths');
        assert.ok(payload.now >= before && payload.now <= Date.now(), 'relative times use the server clock, not the browser clock');

        assert.equal(payload.recents.length, 2);
        assert.deepEqual(payload.recents[0], {
          path: repo,
          name: 'live',
          isGit: true,
          hasTour: false,
          currentBranch: 'main',
          changedFiles: 3,
          lastOpened: 1_700_000_000_000,
        });

        // The one freshness check this route is allowed to do. Re-inspecting
        // every remembered repository here is what made Home slow before, so
        // the stored snapshot is trusted for everything except "is it still on
        // disk" — note `currentBranch` and `changedFiles` survive verbatim even
        // though the path is gone, which is only possible without a git call.
        assert.equal(payload.recents[1].isGit, false, 'a vanished path is flagged missing');
        assert.equal(payload.recents[1].currentBranch, 'trunk', 'the route does not re-inspect the repository');
        assert.equal(payload.recents[1].changedFiles, 9);

        // Presentation stays client-side: raw values only.
        assert.equal(typeof payload.recents[0].lastOpened, 'number');
        assert.ok(!JSON.stringify(payload).includes('min ago'), 'relative time is formatted in the component');
        assert.ok(!JSON.stringify(payload).includes('~/'), 'home-relative paths are formatted in the component');
      },
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a hostile repository name cannot break out of the payload script element', async () => {
  const hostile = '</script><img src=x onerror=alert(1)>';
  await withPicker(
    [{ path: `/tmp/${hostile}`, name: hostile, lastOpened: 1, isGit: true, hasTour: false, currentBranch: '<!--', changedFiles: 0 }],
    async ({ page, payloadOf }) => {
      const { html } = await page('/repos');
      assert.ok(!html.includes('</script><img'), 'the raw sequence must never appear in the document');
      assert.ok(!html.includes('<!--'), 'nor may a comment opener switch the tokenizer state');
      const payload = payloadOf(html);
      assert.equal(payload.recents[0].name, hostile, 'and it still round-trips exactly');
      assert.equal(payload.recents[0].currentBranch, '<!--');
    },
  );
});

test('removing a recent returns a restorable snapshot and restoring rebuilds the list', async () => {
  await withPicker(
    [
      { path: '/one', name: 'one', lastOpened: 2, isGit: false, hasTour: false, currentBranch: null, changedFiles: 0 },
      { path: '/two', name: 'two', lastOpened: 1, isGit: false, hasTour: false, currentBranch: null, changedFiles: 0 },
    ],
    async ({ base }) => {
      const response = await fetch(`${base}/api/repos/recent`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/one' }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.removed, true);
      assert.deepEqual(body.undo, {
        entry: { path: '/one', name: 'one', lastOpened: 2, isGit: false, hasTour: false, currentBranch: null, changedFiles: 0 },
        index: 0,
      });
      assert.deepEqual(
        body.recents.map((row) => row.path),
        ['/two'],
        'the DELETE response is the same RecentRow projection the payload uses',
      );

      const restoreResponse = await fetch(`${base}/api/repos/recent/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ undo: body.undo }),
      });
      assert.equal(restoreResponse.status, 200);
      const restored = await restoreResponse.json();
      assert.deepEqual(
        restored.recents.map((row) => row.path),
        ['/one', '/two'],
        'undo returns the repository to its original position',
      );
    },
  );
});

// ─────────────────────────────────────────── 3. at-risk choreography, in source

test('the sheet takes focus once shown, never from onOpen', () => {
  // `onOpen` runs in the "opening" phase, while the scrim is still
  // visibility:hidden — and focus() on a hidden element is a silent no-op. The
  // bug this guards hid behind the /api/fs response: browse() re-focused on
  // success, so it only stranded focus on <body> when that call was slow or
  // failed. Verified in Chrome by stalling /api/fs; without the effect below,
  // document.activeElement stays BODY and the reviewer has to Tab into the sheet.
  const onOpenBody = /onOpen:\s*\(\)\s*=>\s*\{([\s\S]*?)\n {4}\},/.exec(folderBrowser)?.[1] ?? '';
  assert.ok(onOpenBody, 'FolderBrowser still passes an onOpen callback');
  assert.ok(!/\.focus\(\)/.test(onOpenBody), 'onOpen must not focus — the scrim is not visible yet');
  assert.match(
    folderBrowser,
    /useEffect\(\(\) => \{\s*if \(modal\.shown\) search\.current\?\.focus\(\);\s*\}, \[modal\.shown\]\);/,
    'focus is taken from an effect gated on modal.shown',
  );
});

test('the modal keeps its open/close choreography', () => {
  // At-risk #5. Four separate load-bearing details, each of which a stock
  // <Dialog> would silently replace.

  // (a) the rAF between un-hiding and adding the class — without it the browser
  //     has no "before" style and the sheet snaps in with no transition.
  assert.match(useModal, /requestAnimationFrame\(\(\) => \{\s*setPhase\(\(current\) => \(current === "opening" \? "open" : current\)\);/);
  assert.match(folderBrowser, /className=\{cn\("ds-scrim", modal\.shown && "is-shown"\)\}/);
  assert.match(folderBrowser, /hidden=\{!modal\.mounted\}/);

  // (b) the 210ms hold (0ms under reduced motion) before re-applying `hidden`,
  //     and the guard that a reopen cancels the hide.
  assert.match(useModal, /export const MODAL_CLOSE_MS = 210;/);
  assert.match(useModal, /prefersReducedMotion\(\) \? 0 : MODAL_CLOSE_MS/);
  assert.match(useModal, /setPhase\(\(current\) => \(current === "closing" \? "closed" : current\)\)/);
  assert.match(useModal, /\(prefers-reduced-motion: reduce\)/);

  // (c) re-entrancy guards on both entry points.
  assert.match(useModal, /if \(phaseRef\.current !== "closed" && phaseRef\.current !== "closing"\) return;/);
  assert.match(useModal, /if \(phaseRef\.current === "closed" \|\| phaseRef\.current === "closing"\) return;/);
  assert.match(useModal, /clearTimeout\(closeTimer\.current\)/);

  // (d) inert AND aria-hidden, together, on the background.
  assert.match(useModal, /behind\.setAttribute\("inert", ""\);\s*behind\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(useModal, /behind\.removeAttribute\("inert"\);\s*behind\.removeAttribute\("aria-hidden"\);/);

  // Focus restores to whatever opened the sheet.
  assert.match(useModal, /const restore = trigger\.current;\s*trigger\.current = null;\s*restore\?\.focus\?\.\(\);/);
});

test('the modal focus trap keeps listbox options out of the tab ring', () => {
  assert.match(useModal, /'button:not\(\[disabled\]\),input:not\(\[disabled\]\),\[href\],\[tabindex\]:not\(\[tabindex="-1"\]\)'/);
  assert.match(useModal, /node\.getAttribute\("tabindex"\) !== "-1"/);
  // Repair on top of the vanilla selector: Motion stamps tabindex="0" onto a
  // disabled <motion.button>, which would otherwise re-admit the sheet's
  // disabled primary action and let Tab fall out of the dialog entirely.
  assert.match(useModal, /!\(node as HTMLButtonElement \| HTMLInputElement\)\.disabled/);
  assert.match(useModal, /!node\.hidden/);
  assert.match(useModal, /node\.getAttribute\("aria-hidden"\) !== "true"/);
  // Wrapping in both directions, and recapture when focus has escaped.
  assert.match(useModal, /event\.shiftKey && \(active === first \|\| !root\.contains\(active\)\)/);
  assert.match(useModal, /!event\.shiftKey && \(active === last \|\| !root\.contains\(active\)\)/);
  // An empty focusable set parks focus on the dialog rather than losing it.
  assert.match(useModal, /if \(!items\.length\) \{\s*event\.preventDefault\(\);\s*root\.focus\(\);/);
  // Options are rendered outside the ring in the first place.
  assert.match(folderBrowser, /role="option"\s+tabIndex=\{-1\}/);
});

test('the folder browser keeps all four of its keyboard shortcuts', () => {
  // ArrowDown / ArrowUp, WRAPPING. (The change page's ref picker clamps — the
  // two are deliberately different; do not "unify" them.)
  assert.match(folderBrowser, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(folderBrowser, /\(activeIndex \+ delta \+ filtered\.length\) % filtered\.length/);
  assert.match(folderBrowser, /activeIndex < 0 \? \(delta > 0 \? 0 : filtered\.length - 1\)/);
  // Home / End.
  assert.match(folderBrowser, /event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(folderBrowser, /select\(event\.key === "Home" \? 0 : filtered\.length - 1, true\)/);
  // Enter activates the active option.
  assert.match(folderBrowser, /event\.key === "Enter" && activeIndex >= 0 && filtered\[activeIndex\]/);
  assert.match(folderBrowser, /if \(entry\.isGit\) onOpenRepo\(entry\.path\);\s*else browse\(entry\.path\);/);
  // Escape closes, and stops the document-level handler double-closing.
  assert.match(folderBrowser, /event\.key === "Escape"/);
  assert.match(folderBrowser, /event\.stopPropagation\(\);\s*modal\.close\(\);/);
  // Every arrow/Home/End path suppresses the browser's own caret movement.
  assert.equal((folderBrowser.match(/event\.preventDefault\(\)/g) ?? []).length >= 4, true);
  // Hover moves the active descendant WITHOUT scrolling; keys scroll.
  assert.match(folderBrowser, /onMouseEnter=\{\(\) => select\(index, false\)\}/);
  assert.match(folderBrowser, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test('the folder browser keeps its combobox/listbox accessibility contract', () => {
  assert.match(folderBrowser, /role="dialog"\s+aria-modal="true"\s+aria-label="Choose a repository folder"\s+tabIndex=\{-1\}/);
  assert.match(folderBrowser, /role="combobox"/);
  assert.match(folderBrowser, /aria-autocomplete="list"/);
  assert.match(folderBrowser, /aria-haspopup="listbox"/);
  assert.match(folderBrowser, /aria-controls="fslist"/);
  assert.match(folderBrowser, /aria-label="Filter folders in this location"/);
  assert.match(folderBrowser, /aria-activedescendant=\{activeIndex >= 0 \? `fs-entry-\$\{activeIndex\}` : undefined\}/);
  assert.match(folderBrowser, /id="fslist"\s+role="listbox"\s+aria-label="Folders in this location"/);
  assert.match(folderBrowser, /aria-selected=\{index === activeIndex\}/);
  assert.match(folderBrowser, /aria-current="location"/, 'the current breadcrumb segment is not a link');
  assert.match(folderBrowser, /className="ds-sr-only" role="status" aria-live="polite"/);
  // The clear control leaves the tab ring as well as the layout when empty.
  //
  // CHANGED with the beUI adoption. It used to be `hidden={!hasFilter}` plus a
  // `hasFilter ? "grid" : "hidden"` class, because a `grid` utility would
  // out-cascade Preflight's `[hidden]` rule. The control now lives in the
  // vendored Input's `rightIcon` slot, and that slot styles descendant buttons
  // with `[&_button]:grid` — specificity (0,1,1), which beats BOTH `[hidden]`
  // and a `hidden` utility, so a hidden-but-present button would have been
  // un-hidden by the component. Not rendering it is the stronger guarantee
  // anyway: out of the layout, the tab ring and the accessibility tree at once.
  // The assertions below fail if it comes back unconditionally.
  assert.match(folderBrowser, /rightIcon=\{\s*hasFilter \? \(/, 'the clear control renders only when there is a filter');
  assert.match(folderBrowser, /aria-label="Clear folder filter"/);
  assert.match(folderBrowser, /\) : null\s*\}/, 'and nothing at all otherwise — not a hidden button in the tab ring');
  // The combobox reports collapsed as soon as closing starts, not 210ms later.
  assert.match(folderBrowser, /const expanded = modal\.phase === "opening" \|\| modal\.phase === "open";/);
});

test('the folder sheet stays on its own choreography rather than a library dialog', () => {
  // At-risk #5 again, from the other direction. `use-modal.ts` implements six
  // things: the rAF, the 210ms hold, re-entrancy guards, inert + aria-hidden on
  // the background, the tabindex!=='-1' focus trap, and focus restore. Every
  // beUI overlay implements roughly one of them, so adopting one here would read
  // as an upgrade and be a regression. This is the guard on that decision.
  assert.match(folderBrowser, /useModalChoreography\(\{/);
  for (const overlay of ['bottom-sheet', 'drawer', 'center-morph-modal', 'morphing-modal', 'command-palette']) {
    assert.ok(
      !pickerSource.includes(`vendor/beui/motion/${overlay}`),
      `${overlay} would replace the modal choreography this surface is test-locked on`,
    );
  }
  // Options are plain <button>s on purpose: Motion's press gesture writes
  // tabindex onto motion.button (see the repair in use-modal.ts), and
  // tabindex="-1" here is the only thing keeping the folder list out of the
  // dialog's tab ring. The option block must not become a beUI <Button>.
  const option = /<button\s+key=\{entry\.path\}[\s\S]*?<\/button>/.exec(folderBrowser)?.[0] ?? '';
  assert.ok(option, 'the folder rows are still rendered by a literal <button>');
  assert.match(option, /role="option"/);
  assert.match(option, /tabIndex=\{-1\}/);
});

test('every live-region carrier this surface adopts is quieted at the wrapper', () => {
  // `motion/input` bakes in role="alert" and `motion/loader` role="status" —
  // both listed in client/vendor/beui/README.md. Never edit the vendored file;
  // strip it in a layout effect instead. Proven in Chrome by reading aria-live
  // and role back out of the rendered sheet (see the accompanying report).
  assert.match(folderBrowser, /import \{ useQuietSubtree \} from "\.\.\/\.\.\/shared\/quiet";/);
  assert.match(
    folderBrowser,
    /useQuietSubtree\(sheet, \{ keep: "\.ds-sr-only" \}\);/,
    'the sheet is quieted, but the surface keeps its own single announcer',
  );
  assert.match(recentRepos, /import \{ useQuietSubtree \} from "\.\.\/\.\.\/shared\/quiet";/);
  assert.match(recentRepos, /useQuietSubtree\(root\);/);
  // And the picker's own stable status region is deliberately NOT inside either
  // quieted subtree — it is the one thing on this surface that must announce.
  assert.match(pickerApp, /role="status"\s+aria-live="polite"\s+aria-atomic="true"/);
  assert.match(pickerApp, /data-picker-status/);
  assert.ok(!/useQuietSubtree/.test(pickerApp), 'PickerApp owns the announcer, so it quiets nothing');
});

test('the picker keeps its status wording, ordering, and recoverable visible feedback', () => {
  // Repository selection comes before optional setup recovery.
  assert.ok(
    pickerApp.indexOf('<RecentRepos') < pickerApp.indexOf('<SkillBanner'),
    'places repository selection before optional setup recovery',
  );
  // The three skill branches, in order, verbatim.
  assert.match(skillBanner, /if \(skills\.legacyInstalled\) return legacyText\(skills\.legacyNames\);\s*if \(skills\.current\) return null;/);
  assert.match(skillBanner, / renamed to codestory-storyteller\. Update skills to remove the retired /);
  assert.match(skillBanner, /Story-generation skill is installed but does not match this app/);
  assert.match(skillBanner, /Story-generation skill was not found in ~\/\.agents, ~\/\.claude, or ~\/\.codex/);
  assert.match(skillBanner, /Could not update skills\. Run scripts\/install-skills\.sh/);
  assert.match(skillBanner, /role="status" aria-live="polite" aria-atomic="true"/);
  // The install branch shimmers its own sentence, because it is the only state
  // here with no other progress signal. Two constraints on that:
  //  - it is movement, so reduced motion opts out;
  //  - the keyframes <style> stays OUTSIDE the region. `motion/text-shimmer.tsx`
  //    renders it as a sibling of the shimmering text, and with the text inside
  //    a role="status" aria-atomic="true" region that put a stylesheet into the
  //    region's own content — read back in Chrome as "@keyframes beui-text-…".
  assert.match(skillBanner, /const shimmering = Boolean\(override\?\.busy\) && !reduce;/);
  assert.ok(
    skillBanner.indexOf('<style>{TEXT_SHIMMER_KEYFRAMES}</style>') <
      skillBanner.indexOf('role="status" aria-live="polite" aria-atomic="true"'),
    'the shimmer keyframes are emitted outside the announced region',
  );
  assert.ok(
    !/vendor\/beui\/motion\/text-shimmer/.test(skillBanner),
    'the component would put its <style> back inside the region — the primitives are adopted instead',
  );
  // Feedback is visible and announced from one stable carrier. Removal remains
  // recoverable until the user dismisses or completes the undo.
  assert.match(pickerApp, /data-picker-status/);
  assert.match(pickerApp, /Removed \$\{row\?\.name \?\? "repository"\} from recent repositories\./);
  assert.match(pickerApp, /Restored \$\{undo\.name\} to recent repositories\./);
  assert.match(pickerApp, /actionLabel \?\? "Undo"/);
  assert.match(pickerApp, /Opening repository…/);
  assert.match(pickerApp, /Could not open that path\./);
  assert.match(pickerApp, /Could not reach the server\./);
  // The open-route fallback when the server declines to name one.
  assert.match(pickerApp, /data\?\.route \|\| fallbackRepoRoute\(path\)/);
  assert.match(read('surfaces/picker/format.ts'), /"\/repo\/" \+ encodeURIComponent\(name\) \+ "\/stories"/);
});

test('the recents list keeps its numbering, its one status pill, and its per-row remove action', () => {
  // Continuous ordinals across the available → missing split.
  assert.match(recentRepos, /missing\.map\(\(row, i\) => rowFor\(row, available\.length \+ i\)\)/);
  assert.match(recentRepos, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  // Pluralisation of the unavailable count, recomputed from the live list.
  // The count renders statically (no load animation) and both halves still
  // have to read the live array — a stale prop, or a plural fixed at render,
  // is exactly the bug the original assertion was guarding.
  assert.match(recentRepos, /\{missing\.length\} unavailable/);
  assert.match(recentRepos, /\{plural\(missing\.length, "repository", "repositories"\)\}/);
  // The disclosure is a native <details> again: the bouncy accordion overshot
  // the product's calm motion. What must survive is that the missing rows are
  // its content and nothing else moved into it.
  assert.match(recentRepos, /<details className="group/);
  assert.ok(!/<BouncyAccordion/.test(recentRepos), 'the bouncy disclosure was replaced, not doubled up');
  // Per-row actions hang off the row wrapper, never off the card button:
  // ContextMenuTrigger clones aria-haspopup="menu" + aria-expanded onto its
  // child, and on the card those would describe a button that actually
  // navigates. On a plain <div> they are ignored, which is the point.
  assert.match(recentRepos, /<ContextMenuTrigger>\s*<div/);
  assert.match(recentRepos, /<ContextMenuItem className=\{cn\(MENU_ITEM, "text-text"\)\} onSelect=\{\(\) => onOpen\(row\.path\)\}>/);
  assert.match(recentRepos, /onSelect=\{\(\) => onRemove\(row\.path\)\}/);
  // Exactly one status pill exists. Tour status was removed on purpose.
  assert.match(recentRepos, /Missing\s*<\/AnimatedBadge>/);
  assert.ok(!/hasTour \?/.test(recentRepos), 'tour status is an internal concept and stays off this surface');
  // Removal is bound per button, never delegated from an ancestor row.
  assert.match(recentRepos, /aria-label=\{`Remove \$\{row\.name\} from recent repositories`\}/);
  assert.match(recentRepos, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(recentRepos, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*onRemove\(row\.path\);/);
  // The handler must live on the <button>, not on an ancestor resolving the
  // target with closest() — that is the WebKit bug this row was fixed for.
  assert.ok(
    !/(?:event|e)\.target\s*\.\s*closest\s*\(/.test(recentRepos),
    'does not depend on a nested WebKit event target',
  );
  // Row spacing is the container's job, not the row's. ContextMenu wraps every
  // row in a `display:contents` provider, and a margin on a box that generates
  // no box is dropped — `space-y-*` here would silently collapse the stack.
  assert.ok(!/space-y-/.test(recentRepos), 'sibling margins do not survive a display:contents wrapper');
  // And both stacks name the track explicitly. An implicit `auto` track is
  // floored at the item's min-content width; below 480px a row's min-content
  // beats the viewport, the track grew, and the absolutely-positioned remove
  // control went off screen. Every row container here has to be shrinkable.
  assert.equal(
    (recentRepos.match(/grid grid-cols-\[minmax\(0,1fr\)\] gap-2/g) ?? []).length,
    2,
    'both the top-level stack and the disclosure stack use a shrinkable track',
  );
  assert.ok(!/className="grid gap-2/.test(recentRepos), 'an auto track overflows the viewport at 390px');
  // The empty state, rebuilt whenever the list empties out.
  assert.match(recentRepos, /No repositories yet/);
  assert.match(recentRepos, /it reads the working tree directly, nothing is uploaded/);
  // The compact remove control keeps its hit-slop.
  assert.match(recentRepos, /max-\[480px\]:after:-inset-\[5px\]/);
  assert.match(recentRepos, /max-\[480px\]:h-\[34px\] max-\[480px\]:w-\[34px\]/);
  // The mobile icon-only add action keeps its accessible name.
  assert.match(pickerApp, /aria-label="Add repository"/);
  assert.match(pickerApp, /max-\[760px\]:hidden">Add repository<\/span>/);
});

test('picker motion connects the page and folder sheet without overriding reduced motion', () => {
  // These moved out of an inlined <style> and into the one shared stylesheet,
  // but the values are the same values.
  assert.match(sharedCss, /animation: ds-thread-pulse 11s linear 2s infinite backwards;/);
  assert.match(sharedCss, /animation: ds-reveal-up var\(--motion-duration-spatial\) var\(--motion-ease-out\) backwards;/);
  assert.match(sharedCss, /\.ds-scrim\.is-shown \.ds-sheet \{\s*transform: none;\s*opacity: 1;\s*\}/);
  assert.match(sharedCss, /transition:\s*opacity var\(--motion-duration-ui\) ease,\s*visibility 0s linear var\(--motion-duration-ui\);/);
  assert.match(sharedCss, /transform: translateY\(12px\) scale\(0\.975\);/);
  // The reduced-motion branch removes the transitions and lands the sheet.
  assert.match(sharedCss, /\.ds-scrim,\s*\.ds-sheet \{\s*transition: none;\s*\}/);
  assert.match(sharedCss, /\(prefers-reduced-motion: reduce\) \{\s*\.ds-atmosphere-thread \.thread-pulse \{\s*display: none;/);
  // The entrance is opt-in per section, never a page-level replay.
  assert.match(pickerApp, /ds-reveal ds-reveal-2/);
});

test('the picker touches ds-theme and nothing else in browser storage', () => {
  const keys = new Set(
    [...pickerSource.matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\("([^"]+)"/g)].map((m) => m[1]),
  );
  assert.deepEqual([...keys], [], 'the picker itself writes no storage — the theme hook owns the only key');
  assert.ok(!/sessionStorage/.test(pickerSource), 'no sessionStorage anywhere in this app');
  const themeHook = read('vendor/beui/lib/use-theme.ts');
  assert.match(themeHook, /const STORAGE_KEY = "ds-theme";/);
  assert.match(themeHook, /if \(next === "system"\) window\.localStorage\.removeItem\(STORAGE_KEY\)/, 'System is stored as the absence of the key');
});

test('navigation stays real URLs — no client-side router is introduced', () => {
  // Comments mentioning the API by name are fine; a call to it is not.
  assert.ok(
    !/(?:history|window\.history)\s*\.\s*(?:pushState|replaceState)\s*\(/.test(pickerSource),
    'there is no history API anywhere in this codebase',
  );
  assert.match(pickerApp, /window\.location\.href = /);
});

test('the picker does not resurrect UI that was deliberately removed', () => {
  // Ported `doesNotMatch` guards. Each one names copy or a control that was
  // taken out after user feedback; the guard is what stops it coming back.
  for (const gone of [
    /Open a repository to review its current change/,
    /Choose the exact change/,
    /Approve only when the thread is clear/,
    /Paste a repository path/,
    /Recent repositories keep branch/,
    /Your repositories/,
    /colophon/,
    /Reads your working tree locally/,
    /nothing leaves this machine/,
    /herostats/,
  ]) {
    assert.doesNotMatch(pickerSource, gone, `${gone} was removed on purpose`);
  }
});

// ─────────────────────────────────────────────────────────── 4. the bundle

test('the built bundle actually ships the picker behaviour', (t) => {
  const dir = new URL('../dist/client/', import.meta.url);
  const bundle = new URL('picker.js', dir);
  if (!existsSync(bundle)) {
    t.skip('client bundle not built');
    return;
  }
  const js = readFileSync(bundle, 'utf8');
  // Endpoints. If one of these disappears the surface is silently inert.
  for (const endpoint of ['/api/fs', '/api/repo/open', '/api/repos/recent', '/api/repos/recent/restore', '/api/agents', '/api/skills/update']) {
    assert.ok(js.includes(endpoint), `bundle should call ${endpoint}`);
  }
  // User-facing strings, including every branch a user only sees when something
  // has gone wrong — the ones easiest to lose and hardest to notice.
  for (const text of [
    'Choose a repository folder',
    'Filter folders in this location',
    'Folders in this location',
    'Could not read that folder.',
    'No subfolders here.',
    'No folders match',
    'Open this folder',
    'Not a Git repo',
    'No repositories yet',
    'from recent repositories.',
    'Undo',
    'Try again',
    'Could not open that path.',
    'Could not reach the server.',
    ' renamed to codestory-storyteller. Update skills to remove the retired ',
    'Add repository',
    'unavailable ',
    // The per-row context menu, which has no other entry point in the DOM.
    'Open repository',
    'Actions for ',
  ]) {
    assert.ok(js.includes(text), `bundle should contain ${JSON.stringify(text)}`);
  }
  // Everything above is picker-only code and stays in the picker's own entry.
  // The payload reader and the theme contract are `client/shared/`, so once a
  // second surface entry exists esbuild hoists them into a shared chunk — this
  // layer has to follow the import graph or it starts failing for a reason that
  // has nothing to do with the picker.
  const chunks = [...js.matchAll(/from\s*"\.\/(chunk-[A-Z0-9]+\.js)"/g)].map((m) => m[1]);
  const graph = js + chunks.map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  assert.ok(graph.includes('__CODESTORY_DATA__'), 'bundle reads the shell payload');
  assert.ok(graph.includes('ds-theme'), 'bundle carries the theme contract');
});
