// The vendored beUI tree is an allowlist, not a dumping ground.
//
// It started at 74 files during the React rewrite, was pruned to 6 once it was
// clear what the app used, and was re-vendored broadly when beUI was adopted
// across the surfaces. The allowlist survives all three states for the same
// reason: adding a component should be a deliberate act that fails a test until
// someone writes the file down, because that is the moment to look at what the
// component actually does.
//
// The thing to look at is live regions. A `aria-live` / `role="status"` /
// `role="log"` / `role="alert"` baked into a component is actively harmful in a
// diff reviewer — a live region on a diff viewport announces the whole body on
// every lazy load, context expansion and split<->unified toggle. Twenty of the
// vendored components carry one, which is fine as long as the adopting surface
// knows and wraps it. So instead of banning live regions outright, the map
// below records exactly which files carry which marker, and the test asserts
// that measurement is still true *in both directions*: a carrier that loses its
// live region fails, and — the one that matters — a previously-safe component
// that gains one in a vendor update fails loudly instead of shipping silently.
//
// `client/vendor/beui/README.md` carries the same table with the reasoning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const VENDOR = fileURLToPath(new URL('../client/vendor/beui/', import.meta.url));
const CLIENT = fileURLToPath(new URL('../client/', import.meta.url));

/**
 * Every file in the vendored tree: the components adopted from beUI, their
 * transitive in-repo imports, and the three codeStory-local files that stand in
 * for dependencies we refuse (`lib/use-theme.ts` for next-themes,
 * `lib/use-smooth-scroll.ts` for lenis). Keep sorted.
 */
const ALLOWED = [
  'agents/agent-activity/activity-row.tsx',
  'agents/agent-activity/index.tsx',
  'agents/agent-activity/types.ts',
  'agents/agent-code.tsx',
  'agents/agent-disclosure.tsx',
  'agents/ai-sidebar.tsx',
  'agents/approval-card/index.tsx',
  'agents/approval-card/types.ts',
  'agents/chat-app.tsx',
  'agents/citations.tsx',
  'agents/code-block.tsx',
  'agents/file-diff.tsx',
  'agents/loading-states/agent-progress.tsx',
  'agents/loading-states/index.ts',
  'agents/loading-states/reasoning-text.tsx',
  'agents/loading-states/thinking-shimmer.tsx',
  'agents/message-bubble.tsx',
  'agents/message-context.tsx',
  'agents/message-scroller.tsx',
  'agents/message.tsx',
  'agents/prompt-input.tsx',
  'agents/streaming-response.tsx',
  'agents/todo-list.tsx',
  'agents/tool-approval.tsx',
  'agents/tool-result.tsx',
  'lib/ease.ts',
  'lib/favicon.ts',
  'lib/hooks/use-hover-capable.ts',
  'lib/hooks/use-slider.ts',
  'lib/text-shimmer.ts',
  'lib/use-smooth-scroll.ts',
  'lib/use-theme.ts',
  'lib/utils.ts',
  'motion/action-swap-blur.tsx',
  'motion/action-swap-cascade.tsx',
  'motion/action-swap-roll.tsx',
  'motion/action-swap.tsx',
  'motion/animated-badge.tsx',
  'motion/animated-number.tsx',
  'motion/animated-sidebar.tsx',
  'motion/animated-toast-stack.tsx',
  'motion/attachment-upload.tsx',
  'motion/bottom-sheet.tsx',
  'motion/bouncy-accordion.tsx',
  'motion/button/base.tsx',
  'motion/button/index.tsx',
  'motion/button/magnetic.tsx',
  'motion/button/stateful.tsx',
  'motion/center-morph-modal.tsx',
  'motion/checkbox.tsx',
  'motion/command-palette.tsx',
  'motion/context-menu.tsx',
  'motion/dock.tsx',
  'motion/drawer.tsx',
  'motion/dynamic-island.tsx',
  'motion/expandable-tabs.tsx',
  'motion/expanding-arrow-button.tsx',
  'motion/feedback-widget.tsx',
  'motion/file-upload.tsx',
  'motion/hold-action-button.tsx',
  'motion/input.tsx',
  'motion/loader.tsx',
  'motion/magnetic.tsx',
  'motion/marquee.tsx',
  'motion/morphing-modal.tsx',
  'motion/morphing-tabs.tsx',
  'motion/notification-stack.tsx',
  'motion/number-ticker.tsx',
  'motion/otp-input.tsx',
  'motion/overflow-actions.tsx',
  'motion/popover-morph.tsx',
  'motion/popover-position.ts',
  'motion/popover.tsx',
  'motion/preview-rail.tsx',
  'motion/pull-to-refresh.tsx',
  'motion/radio.tsx',
  'motion/range-slider.tsx',
  'motion/scroll-progress.tsx',
  'motion/scroll-reveal.tsx',
  'motion/scroll-to.tsx',
  'motion/select-morph.tsx',
  'motion/select.tsx',
  'motion/shared-layout-bg.tsx',
  'motion/slide-action-button.tsx',
  'motion/swap.tsx',
  'motion/swap/constants.ts',
  'motion/swap/controls.tsx',
  'motion/swap/data.ts',
  'motion/swap/field.tsx',
  'motion/swap/quote-row.tsx',
  'motion/swap/token-badges.tsx',
  'motion/swap/token-picker.tsx',
  'motion/swap/types.ts',
  'motion/swap/utils.ts',
  'motion/swipeable-list.tsx',
  'motion/switch.tsx',
  'motion/table/editable-cell.tsx',
  'motion/table/index.tsx',
  'motion/table/row-handle.tsx',
  'motion/table/skeleton-rows.tsx',
  'motion/table/table-header.tsx',
  'motion/table/table-menu.tsx',
  'motion/table/types.ts',
  'motion/table/use-column-reorder.ts',
  'motion/table/use-column-resize.ts',
  'motion/table/use-column-sort.ts',
  'motion/table/use-row-selection.ts',
  'motion/table/utils.ts',
  'motion/tabs.tsx',
  'motion/text-reveal.tsx',
  'motion/text-shimmer.tsx',
  'motion/theme-toggle.tsx',
  'motion/tooltip.tsx',
];

/**
 * Measured at the pinned commit: every vendored file that ships its own live
 * region, and the exact markers it ships. Files absent from this map carry
 * none, and the test enforces that too.
 *
 * A `{…}` marker is a conditional — the component only announces when a prop
 * turns it on, so it is safe to adopt with that prop left unset.
 *
 * This is an adoption checklist, not a rejection log: a surface adopting one of
 * these owns the decision to wrap it and strip the region. Never edit a
 * vendored file to remove one — the next vendor update would silently undo it,
 * and this test is what makes that visible.
 */
const LIVE_REGION_COMPONENTS = {
  'agents/agent-activity/index.tsx': ['role="status"'],
  'agents/ai-sidebar.tsx': ['aria-live="polite"'],
  'agents/code-block.tsx': ['aria-live={…}', 'role={… "log"}'],
  'agents/file-diff.tsx': ['aria-live="polite"'],
  'agents/loading-states/agent-progress.tsx': ['role="status"'],
  'agents/loading-states/reasoning-text.tsx': ['aria-live="polite"', 'role="status"'],
  'agents/message-scroller.tsx': ['aria-live="polite"', 'role="log"'],
  'agents/streaming-response.tsx': ['aria-live={…}'],
  'agents/todo-list.tsx': ['aria-live="polite"'],
  'agents/tool-result.tsx': ['aria-live="polite"', 'role="log"'],
  'motion/animated-toast-stack.tsx': ['aria-live="polite"'],
  'motion/attachment-upload.tsx': ['role="status"'],
  'motion/button/stateful.tsx': ['aria-live="polite"'],
  'motion/dynamic-island.tsx': ['aria-live="polite"', 'role="status"'],
  'motion/feedback-widget.tsx': ['role="alert"'],
  'motion/input.tsx': ['role="alert"'],
  'motion/loader.tsx': ['role="status"'],
  'motion/otp-input.tsx': ['aria-live="polite"'],
  'motion/pull-to-refresh.tsx': ['aria-live="polite"'],
  'motion/slide-action-button.tsx': ['aria-live="polite"'],
};

/**
 * The markers above, normalised so a formatting change does not read as a
 * behaviour change. The last two patterns catch the dynamic form
 * (`role={streaming ? "log" : undefined}`), which a literal-string grep misses
 * — that is exactly how a live region sneaks past a reviewer.
 */
const MARKER_PATTERNS = [
  [/aria-live="([a-z]+)"/g, (m) => `aria-live="${m[1]}"`],
  [/aria-live=\{/g, () => 'aria-live={…}'],
  [/role="(status|log|alert)"/g, (m) => `role="${m[1]}"`],
  [/role=\{[^}]*"(status|log|alert)"/g, (m) => `role={… "${m[1]}"}`],
];

function liveRegionMarkers(src) {
  const found = new Set();
  for (const [pattern, format] of MARKER_PATTERNS) {
    for (const match of src.matchAll(pattern)) found.add(format(match));
  }
  return [...found].sort();
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(relative(VENDOR, full));
  }
  return out.sort();
}

function appSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...appSources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Read a source file as code, with whole-line comments removed.
 *
 * Scanning raw text for import specifiers means prose can masquerade as code:
 * a comment that names `client/vendor/beui/…` while explaining a rule gets read
 * as an import of it, and an apostrophe anywhere in the sentence closes the
 * quote for the matcher. That has now caused three false failures in this repo,
 * so source assertions read code. `test/picker.test.mjs` carries the same
 * helper for the same reason.
 */
function readCode(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

test('the vendored tree holds exactly the allowlisted components', () => {
  assert.deepEqual(
    sourceFiles(VENDOR),
    ALLOWED,
    'vendored beUI files drifted from the allowlist — see client/vendor/beui/README.md before adding one',
  );
});

test('any surface adopting a live-region carrier also quiets it', () => {
  // The whole point of measuring LIVE_REGION_COMPONENTS is that adoption acts
  // on it. A surface may import `agents/todo-list` — but if it does, it must
  // also pull in `useQuietSubtree` from client/shared/quiet.ts, which strips
  // the baked-in aria-live in a layout effect after every render.
  //
  // Two carriers are exempt because their region is conditional on a prop that
  // defaults off; the check below still fails if such a file ever passes it.
  const CONDITIONAL = new Set(['agents/code-block.tsx', 'agents/streaming-response.tsx']);
  const CONDITIONAL_PROPS = { 'agents/code-block.tsx': 'streaming', 'agents/streaming-response.tsx': 'announce' };

  const carriers = Object.keys(LIVE_REGION_COMPONENTS);
  const unquieted = [];
  for (const file of appSources(CLIENT)) {
    const src = readCode(file);
    if (src.includes('useQuietSubtree')) continue;
    for (const carrier of carriers) {
      const spec = carrier.replace(/\.tsx?$/, '');
      if (!src.includes(`vendor/beui/${spec}`)) continue;
      const rel = relative(CLIENT, file);
      if (CONDITIONAL.has(carrier)) {
        // Safe unadorned — but only while the enabling prop stays unset.
        const prop = CONDITIONAL_PROPS[carrier];
        if (new RegExp(`\\b${prop}\\b`).test(src)) {
          unquieted.push(`${rel} passes \`${prop}\` to beui/${spec}, which turns its live region on`);
        }
        continue;
      }
      unquieted.push(`${rel} adopts beui/${spec} without useQuietSubtree`);
    }
  }
  assert.deepEqual(
    unquieted,
    [],
    'a vendored component with a baked-in live region reached a surface unquieted — see client/shared/quiet.ts',
  );
});

test('nothing imports a beUI module that is not vendored', () => {
  const missing = [];
  for (const file of appSources(CLIENT)) {
    const src = readCode(file);
    for (const match of src.matchAll(/["']([^"']*vendor\/beui\/[^"']+)["']/g)) {
      const spec = match[1].replace(/.*vendor\/beui\//, '');
      const resolved = ALLOWED.find((a) => a === spec || a.replace(/\.tsx?$/, '') === spec);
      if (!resolved) missing.push(`${relative(CLIENT, file)} imports beui/${spec}`);
    }
  }
  assert.deepEqual(missing, [], 'an import points at a beUI module that is no longer vendored');
});

test('no vendored file imports a module the tree does not contain', () => {
  // The vendored subtree has to be self-contained: every relative import must
  // land on another allowlisted file. This is what catches a component pulled in
  // without its dependencies, and it is also the guard on the two local
  // stand-ins — if someone re-vendors `motion/smooth-scroll.tsx` over the lenis
  // seam, or points a component back at `next-themes`, that shows up here.
  const dangling = [];
  for (const file of ALLOWED) {
    const src = readFileSync(join(VENDOR, file), 'utf8');
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    for (const match of src.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
      const spec = join(dir, match[1]);
      const hit = ALLOWED.some(
        (a) => a === spec || a.replace(/\.tsx?$/, '') === spec || a.replace(/\/index\.tsx?$/, '') === spec,
      );
      if (!hit) dangling.push(`${file} imports ${match[1]}`);
    }
  }
  assert.deepEqual(dangling, [], 'a vendored file imports something outside the vendored tree');
});

test('the measured live regions are exactly what the README records', () => {
  // Both directions. A carrier losing its region is worth knowing about; a
  // previously-safe component gaining one in a vendor update is the failure
  // this test exists for, because that is the one nobody would go looking for.
  const measured = {};
  for (const file of sourceFiles(VENDOR)) {
    const markers = liveRegionMarkers(readFileSync(join(VENDOR, file), 'utf8'));
    if (markers.length) measured[file] = markers;
  }
  assert.deepEqual(
    measured,
    LIVE_REGION_COMPONENTS,
    'the live regions in the vendored tree changed — update the map here and the table in client/vendor/beui/README.md, and check whether any adopting surface now needs a wrapper',
  );
});

test('the excluded dependencies stay excluded', () => {
  // shiki, lenis and next-themes are refused on purpose (README modifications
  // 2-4). Each has a seam in the tree standing in for it; this asserts nobody
  // quietly re-added the real thing while re-vendoring.
  const banned = [];
  for (const file of ALLOWED) {
    const src = readFileSync(join(VENDOR, file), 'utf8');
    for (const match of src.matchAll(/from\s+["'](shiki|lenis|next-themes|next\/[a-z]+|@vercel\/[a-z-]+)[^"']*["']/g)) {
      banned.push(`${file} imports ${match[1]}`);
    }
  }
  assert.deepEqual(banned, [], 'a vendored file imports a dependency this repo deliberately refuses');
});

test('every vendored file records where it came from', () => {
  const unattributed = ALLOWED.filter((file) => {
    const first = readFileSync(join(VENDOR, file), 'utf8').split('\n', 1)[0];
    return !/^\/\/ (Vendored|Adapted) from starc007\/ui-components/.test(first)
      && !/^\/\/ codeStory-local/.test(first);
  });
  assert.deepEqual(unattributed, [], 'a vendored file is missing its provenance header');
});

test('the provenance record survives, including the live-region audit', () => {
  const readme = readFileSync(join(VENDOR, 'README.md'), 'utf8');
  assert.match(readme, /b3966e2604a8e43537a7b78fa3103a6fd72d1388/, 'the pinned upstream commit');
  assert.match(readme, /on the diff viewport/);
  assert.match(readme, /test\/vendor-beui\.test\.mjs/, 'points at this allowlist');
  for (const file of Object.keys(LIVE_REGION_COMPONENTS)) {
    assert.ok(readme.includes(file), `README's live-region table is missing ${file}`);
  }
  assert.ok(readFileSync(join(VENDOR, 'LICENSE'), 'utf8').includes('MIT'), 'upstream MIT notice is kept');
});
