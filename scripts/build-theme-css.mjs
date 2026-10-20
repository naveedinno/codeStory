// Generates client/generated/theme.css — the bridge between codeStory's Signal /
// Thread-Ledger design tokens (src/theme.ts) and Tailwind v4's CSS-first @theme.
//
// One source of truth: every Signal value below is *parsed out of src/theme.ts*
// at build time, never hand-copied. src/theme.ts stays the canonical token table
// and this script is a pure derivation of it. If a token this script maps ever
// disappears from src/theme.ts the build fails loudly rather than silently
// emitting a stale value.
//
// The emitted file has four parts:
//   1. @font-face — verbatim from src/theme.ts (self-hosted woff2 at /assets/fonts).
//   2. The runtime token layer — the :root and :root[data-theme="light"] blocks
//      verbatim. This is what actually switches light/dark at runtime.
//   3. beUI geometry/motion additions that Signal does not define.
//   4. An @theme block whose entries alias the runtime vars, so Tailwind
//      utilities (bg-surface, text-accent, rounded-lg, ease-out, …) resolve to
//      Signal values and follow the theme switch for free.
//
// Light/dark mechanism (matches src/theme.ts exactly): the inline bootstrap in
// themeBootstrapScript() sets data-theme="light"|"dark" on <html> before first
// paint. Dark is the unattributed default; light is :root[data-theme="light"].

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themeSource = resolve(root, 'src/theme.ts');
const outFile = resolve(root, 'client/generated/theme.css');

/* ------------------------------------------------------------------ parsing */

/**
 * Evaluate src/theme.ts without depending on `tsc` having run. esbuild is
 * already a devDependency and theme.ts has no imports, so a bare transform is
 * enough — and this keeps the generator usable standalone, before dist/ exists.
 */
async function loadThemeModule() {
  const ts = await readFile(themeSource, 'utf8');
  const { code } = await transform(ts, { loader: 'ts', format: 'esm', target: 'es2022' });
  const scratch = resolve(tmpdir(), `codestory-theme-${process.pid}-${Date.now()}.mjs`);
  await writeFile(scratch, code, 'utf8');
  try {
    return await import(pathToFileURL(scratch).href);
  } finally {
    // Best-effort cleanup; a stray temp file must never fail the build.
    const { rm } = await import('node:fs/promises');
    await rm(scratch, { force: true }).catch(() => {});
  }
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Extract one `<selector>{ … }` rule, braces balanced, selector matched exactly. */
function extractRule(css, selector) {
  const open = css.indexOf(`${selector}{`);
  if (open === -1) throw new Error(`build-theme-css: could not find "${selector}{" in src/theme.ts`);
  let depth = 0;
  for (let i = open + selector.length; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error(`build-theme-css: unbalanced braces after "${selector}" in src/theme.ts`);
}

/** Parse `--name:value` declarations out of a rule body into a Map. */
function parseDeclarations(rule) {
  const body = stripComments(rule).slice(rule.indexOf('{') + 1, -1);
  const out = new Map();
  for (const chunk of body.split(';')) {
    const decl = chunk.trim();
    if (!decl.startsWith('--')) continue;
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    out.set(decl.slice(2, colon).trim(), decl.slice(colon + 1).trim());
  }
  return out;
}

/* ------------------------------------------------------- token mapping table */

// Signal colors bridged into Tailwind's --color-* namespace. Each becomes
// bg-<name> / text-<name> / border-<name> / fill-<name> and follows light/dark
// because the @theme entry is `var(--<name>)`, not a frozen literal.
const COLOR_TOKENS = [
  'bg', 'surface', 'surface-2', 'surface-3',
  'text', 'text-2', 'text-3',
  'line', 'line-soft',
  'fill-1', 'fill-2', 'fill-3',
  'accent', 'accent-hi', 'accent-solid-hover', 'on-accent', 'accent-soft', 'accent-line', 'accent-glow',
  'accent-text',
  'add', 'diff-add-text', 'add-soft', 'add-bg',
  'del', 'diff-del-text', 'danger-text', 'del-soft', 'del-bg',
  'amber', 'amber-text', 'amber-soft', 'on-amber',
  'neutral-status-text', 'add-emphasis-bg', 'del-emphasis-bg',
  'numeral', 'numeral-dim', 'thread', 'thread-dim', 'map-dot',
  'gutter', 'scrim', 'scroll',
  'tk-k', 'tk-t', 'tk-f', 'tk-s', 'tk-n', 'tk-c',
];

// Friendlier names for the four tokens whose literal name reads badly as a
// utility (`text-text-2`, `bg-bg`). Both spellings resolve to the same var.
const COLOR_ALIASES = [
  ['canvas', 'bg'],
  ['panel', 'surface'],
  ['fg', 'text'],
  ['fg-muted', 'text-2'],
  ['fg-subtle', 'text-3'],
  ['border', 'line'],
  ['border-soft', 'line-soft'],
];

// shadcn-compatible names (vendor-only), pointed at Signal values. First-party
// surfaces must use --color-text, --color-surface, --color-bg and
// --color-accent; the names below exist only for the vendored beUI tree.
//
// The vendored beUI tree (client/vendor/beui) is written against shadcn's
// variable names. Without these entries `text-foreground`, `bg-card`,
// `bg-primary`, `text-destructive` and `ring-ring` are undefined theme keys, and
// Tailwind v4 emits *nothing* for an undefined key. Mostly that only means a
// component renders unstyled — but several pair those utilities with
// `outline-none` (`motion/bouncy-accordion`'s trigger, `motion/context-menu`'s
// items), so the silent failure mode is a component with no focus indication at
// all. Supplying the names is what makes a vendored component keyboard-safe by
// default instead of only after a call site remembers to repaint it.
//
// `accent` is deliberately absent. shadcn means a quiet hover fill by it, Signal
// means signal blue, and --color-accent is already bound to Signal's — with ~20
// live call sites across client/surfaces relying on that (`bg-accent`,
// `text-accent`, `bg-accent-soft`, `hover:bg-accent-hi`). Re-pointing it to a
// grey would repaint every one of them, so the Signal meaning wins and the
// collision is left standing. `accent-foreground` IS mapped, because that makes
// `bg-accent text-accent-foreground` resolve to blue-with-legible-ink, which is
// exactly the pairing those call sites already hand-write as
// `bg-accent text-on-accent`.
//
// --on-accent is the ink that sits on a saturated fill, and it inverts with the
// theme (#06121c dark / #ffffff light) on the same axis as --accent and --del.
// That is why it serves as the foreground for primary AND destructive: both
// fills are light-on-dark in the dark theme and dark-on-light in the light one.
const SHADCN_ALIASES = [
  ['foreground', 'text'],
  ['background', 'bg'],
  ['card', 'surface'],
  ['card-foreground', 'text'],
  ['popover', 'surface-2'],
  ['popover-foreground', 'text'],
  ['primary', 'accent'],
  ['primary-foreground', 'on-accent'],
  ['secondary', 'fill-2'],
  ['secondary-foreground', 'text'],
  ['muted', 'fill-1'],
  ['muted-foreground', 'text-2'],
  ['accent-foreground', 'on-accent'],
  ['destructive', 'del'],
  ['destructive-foreground', 'on-accent'],
  ['input', 'line'],
  ['ring', 'accent-line'],
];

// Tokens inlined as literals rather than var() references: their Tailwind
// namespace uses the *same* custom-property name as src/theme.ts does
// (--font-sans, --text-lg, --tracking-tight, --leading-tight …), so a var()
// reference would be self-referential. They are theme-invariant anyway.
const FONT_TOKENS = ['sans', 'mono', 'display'];
const TEXT_SIZE_TOKENS = ['xs', 'sm', 'md', 'base', 'lg', 'xl', '2xl', 'numeral', 'numeral-lg'];
const TRACKING_TOKENS = ['kicker', 'tight', 'numeral'];
const LEADING_TOKENS = ['tight', 'body'];

/* -------------------------------------------------------------- css emission */

function must(map, name) {
  const value = map.get(name);
  if (value === undefined) {
    throw new Error(
      `build-theme-css: src/theme.ts no longer defines --${name}. ` +
        'Update the mapping table in scripts/build-theme-css.mjs.',
    );
  }
  return value;
}

function themeBlock(dark) {
  const lines = [];
  const push = (name, value) => lines.push(`  ${name}: ${value};`);
  const section = (label) => lines.push('', `  /* ${label} */`);

  section('color — Signal ink + signal blue, resolved per theme at runtime');
  for (const token of COLOR_TOKENS) {
    must(dark, token);
    push(`--color-${token}`, `var(--${token})`);
  }
  for (const [alias, token] of COLOR_ALIASES) {
    must(dark, token);
    push(`--color-${alias}`, `var(--${token})`);
  }

  section('color — shadcn names (vendor-only for the vendored beUI tree) on Signal values; first-party: --color-text, --color-surface, --color-bg, --color-accent');
  for (const [alias, token] of SHADCN_ALIASES) {
    must(dark, token);
    push(`--color-${alias}`, `var(--${token})`);
  }

  section('type — IBM Plex Sans / Mono + Space Grotesk');
  for (const token of FONT_TOKENS) push(`--font-${token}`, must(dark, `font-${token}`));
  for (const token of TEXT_SIZE_TOKENS) push(`--text-${token}`, must(dark, `text-${token}`));
  for (const token of TRACKING_TOKENS) push(`--tracking-${token}`, must(dark, `tracking-${token}`));
  for (const token of LEADING_TOKENS) push(`--leading-${token}`, must(dark, `leading-${token}`));

  section('spacing — 4px base, matching Signal --sp-1..--sp-10');
  push('--spacing', must(dark, 'sp-1'));

  section('radius — beUI naming over Signal geometry');
  push('--radius-xs', '4px');
  push('--radius-sm', must(dark, 'radius-sm'));
  push('--radius-md', must(dark, 'radius'));
  push('--radius-lg', must(dark, 'radius-lg'));
  push('--radius-xl', must(dark, 'radius-island'));
  push('--radius-2xl', '32px');
  push('--radius-full', must(dark, 'radius-pill'));

  section('shadow — beUI elevation scale, tinted per theme');
  push('--shadow-2xs', '0 1px 1px var(--shadow-penumbra)');
  push('--shadow-xs', '0 1px 2px var(--shadow-penumbra)');
  push('--shadow-sm', '0 1px 2px var(--shadow-umbra), 0 2px 6px var(--shadow-penumbra)');
  push('--shadow-md', '0 2px 4px var(--shadow-umbra), 0 6px 16px var(--shadow-penumbra)');
  push('--shadow-lg', '0 4px 10px var(--shadow-umbra), 0 14px 34px var(--shadow-penumbra)');
  push('--shadow-xl', '0 8px 18px var(--shadow-umbra), 0 26px 60px var(--shadow-penumbra)');
  push('--shadow-signal', 'var(--shadow)');
  // The focus ring is the one shadow that is not decoration — WCAG 1.4.11 wants
  // 3:1 against what surrounds it. `0 0 0 3px var(--accent-soft)` alone was the
  // whole indicator app-wide, and --accent-soft is a 10–12% wash: composited it
  // measures ~1.24:1 on --surface. Keyboard focus was, in practice, invisible.
  //
  // So the ring is now two rings: a solid 2px --accent core that carries the
  // contrast (7.9:1 dark, 4.3:1 light) and the original soft wash pushed out to
  // 5px, which keeps the Signal glow the surfaces were designed around.
  push('--shadow-focus', '0 0 0 2px var(--accent), 0 0 0 5px var(--accent-soft)');
  // Same ring for controls that must draw it inside their own box (full-bleed
  // rows, where an outer ring would be clipped by the scroll container).
  push('--shadow-focus-inset', 'inset 0 0 0 2px var(--accent), inset 0 0 0 5px var(--accent-soft)');

  section('easing — Signal motion curves + beUI extras');
  push('--ease-out', must(dark, 'motion-ease-out'));
  push('--ease-in-out', must(dark, 'motion-ease-in-out'));
  push('--ease-drawer', must(dark, 'motion-ease-drawer'));
  push('--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)');
  push('--ease-snappy', 'cubic-bezier(0.2, 0, 0, 1)');

  section('layout');
  push('--container-rail', must(dark, 'rail-width'));

  return `@theme static {${lines.join('\n')}\n}`;
}

export async function buildThemeCss({ quiet = false } = {}) {
  const theme = await loadThemeModule();
  if (typeof theme.sharedTokens !== 'function') {
    throw new Error('build-theme-css: src/theme.ts no longer exports sharedTokens()');
  }
  const tokensCss = theme.sharedTokens();

  const fontFaces = tokensCss.match(/@font-face\{[^}]*\}/g) ?? [];
  if (fontFaces.length === 0) {
    throw new Error('build-theme-css: no @font-face rules found in sharedTokens()');
  }

  const darkRule = extractRule(tokensCss, ':root');
  const lightRule = extractRule(tokensCss, ':root[data-theme="light"]');
  const contrastRule = tokensCss.includes('@media (prefers-contrast: more)')
    ? extractRule(tokensCss, '@media (prefers-contrast: more)')
    : '';
  const dark = parseDeclarations(darkRule);
  const light = parseDeclarations(lightRule);

  const css = `/* GENERATED FILE — do not edit by hand.
 * Source of truth: src/theme.ts (sharedTokens()).
 * Regenerate: node scripts/build-theme-css.mjs
 *
 * Light/dark: the inline bootstrap from themeBootstrapScript() sets
 * data-theme="light" | "dark" on <html> before first paint (preference in
 * localStorage under "ds-theme"; "system" resolves via prefers-color-scheme).
 * Dark is the unattributed default; light is :root[data-theme="light"].
 */

/* 1. Self-hosted Signal type, served same-origin from /assets/fonts. */
${fontFaces.join('\n')}

/* 2. Runtime token layer — verbatim from src/theme.ts. This is the layer that
 *    actually switches with data-theme; everything below only aliases it. */
${darkRule}
${lightRule}
${contrastRule}

/* 3. beUI elevation tints. Signal defines a single --shadow per theme; beUI's
 *    scale needs a two-stop tint, so derive one per theme. */
:root{--shadow-umbra:rgba(0,0,0,.42);--shadow-penumbra:rgba(0,0,0,.3)}
:root[data-theme="light"]{--shadow-umbra:rgba(15,22,32,.12);--shadow-penumbra:rgba(15,22,32,.08)}

/* 4. Tailwind variants matching the data-theme mechanism above. Dark is
 *    "anything not explicitly light" so the no-JS fallback stays dark. */
@custom-variant dark (&:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *));
@custom-variant light (&:where(:root[data-theme="light"], :root[data-theme="light"] *));

/* 5. Tailwind theme — Signal color + type, beUI geometry + motion. */
${themeBlock(dark, light)}
`;

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, css, 'utf8');
  if (!quiet) {
    console.log(
      `theme bridge -> client/generated/theme.css ` +
        `(${dark.size} dark tokens, ${light.size} light overrides, ${fontFaces.length} @font-face, ` +
        `${(Buffer.byteLength(css) / 1024).toFixed(1)} kB)`,
    );
  }
  return outFile;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await buildThemeCss();
