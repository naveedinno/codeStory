// The server-side HTML shell for the React surfaces.
//
// Every diffStory page used to be a complete, self-contained document: ~300 KB
// of hand-written markup with all CSS and JS inlined from `page-assets.ts`.
// This module replaces that with the smallest document that can boot a React
// bundle without a flash of the wrong theme:
//
//   1. `<meta charset>` / viewport / color-scheme / theme-color
//   2. the inline theme bootstrap (must run before first paint — see below)
//   3. the brand favicon + mask-icon links
//   4. `<link rel="stylesheet" href="/assets/client/app.css">`
//   5. `<div id="root">` (optionally holding a boot placeholder)
//   6. `<script type="application/json" id="__DIFFSTORY_DATA__">` — the view-model
//   7. `<script type="module" src="/assets/client/<surface>.js">`
//
// Ordering is load-bearing, not cosmetic:
//
// - The theme bootstrap stays INLINE and stays in `<head>`, ahead of the
//   stylesheet. It reads the `ds-theme` localStorage preference and stamps
//   `data-theme` / `data-theme-mode` / `color-scheme` on `<html>` before the
//   first paint. Move it to an external file (or below the stylesheet) and a
//   light-mode user gets a dark flash on every navigation, because the CSS in
//   `theme.ts` declares dark as the no-script fallback.
// - The stylesheet is render-blocking, which is what we want: it means the boot
//   placeholder and the first React paint both land with tokens already
//   resolved.
// - The module script is deferred by definition, so it never blocks the
//   placeholder.
//
// This module renders markup only. It does not read the repository, the
// session, or the filesystem — callers hand it a fully built, serializable
// payload. That keeps it trivially testable and keeps the "what does this
// surface need?" question answerable by reading one route handler.
import { APP_BRAND } from './config.js';
import { BRAND_HEAD_LINKS } from './brand.js';
import { themeBootstrapScript } from './theme.js';

/**
 * The six React surfaces.
 *
 * `progress` is the odd one out: today it is a panel embedded in the review
 * page (`render.ts` mounts `progressPanelMarkup('floating')`), not a route of
 * its own. It is named here because it ships as its own bundle entry and its
 * own payload shape, so the review shell can lazily boot it — and so a future
 * standalone progress route needs no change to this union. See
 * `docs/superpowers/specs/server-shell-contract.md`.
 */
export type ShellSurface = 'picker' | 'stories' | 'change' | 'review' | 'progress' | 'explain';

/** The element id the client reads its bootstrap payload from. */
export const SHELL_PAYLOAD_ID = '__DIFFSTORY_DATA__';

/** Where the client build publishes its bundles. Served by the `/assets/*` family. */
export const CLIENT_ASSET_BASE = '/assets/client';

/** Stylesheet emitted by the Tailwind step of `scripts/build-client.mjs`. */
export const CLIENT_STYLESHEET_HREF = `${CLIENT_ASSET_BASE}/app.css`;

/** Bundle entry point for a surface. One esbuild entry per surface. */
export function clientEntryHref(surface: ShellSurface): string {
  return `${CLIENT_ASSET_BASE}/${surface}.js`;
}

/**
 * How long the entry module is allowed to hold up the first paint.
 *
 * Matched to the boot placeholder's own 240 ms reveal, and that is the whole
 * argument: the release is the moment we give up and let the shell paint, so if
 * it lands before the dots are due the user gets a bare page with nothing on it
 * to explain the wait. Landing exactly on the reveal means whenever the shell
 * does appear, the placeholder is already due to appear with it.
 *
 * It is NOT tuned to the slowest surface's first commit, which is the obvious
 * theory and is wrong. Measured warm, the review and raw-diff surfaces commit
 * around 300 ms — well past this budget — yet neither paints an empty shell at
 * 200 ms, 240 ms or 400 ms. The reason is that a `setTimeout` cannot fire while
 * the main thread is synchronously evaluating a 346 kB module: on a CPU-bound
 * boot the release callback does not get to run until after the module (and so
 * after the `flushSync` commit inside it), which makes it a no-op exactly when
 * it would have hurt. The bound therefore protects the NETWORK-bound case,
 * where the thread is idle waiting on bytes and the timer really does fire —
 * which is the case that produced the 4.4 s blank rectangle below.
 *
 * Raising it buys nothing measurable and lengthens the one case that does pay:
 * a cold start, where there is no previous page to hold and the browser shows
 * its own `color-scheme` background for the duration. On a navigation the held
 * frame is the page the user was already looking at, which beats an empty one.
 */
export const ENTRY_RENDER_BLOCK_MS = 240;

/**
 * Release the entry script's render-blocking after `ENTRY_RENDER_BLOCK_MS`.
 *
 * `blocking="render"` on the entry is what stops a scope change from flashing
 * an empty shell: every scope change on the change surface is a full
 * navigation, and without it the browser paints the placeholder in the ~5 ms
 * window between the stylesheet landing and React's first commit. Measured on
 * this machine that race went either way run to run, which is exactly the
 * "sometimes" in the bug report.
 *
 * Unbounded, though, it trades that for something worse. Throttled to 8x CPU on
 * a cold tab the entry takes ~4.4 s, and a render-blocked document shows a flat
 * untextured rectangle for every one of those seconds — no dot field, no boot
 * placeholder, nothing. That is the precise failure `bootPlaceholder()` exists
 * to prevent, so the blocking has to be bounded rather than absolute.
 *
 * Removing the attribute takes the element out of the document's render-blocking
 * set, so the pending paint goes through immediately. Firing after the module
 * has already run is a no-op.
 */
function entryBlockingRelease(): string {
  return (
    '<script>' +
    `setTimeout(function(){var s=document.querySelector('script[data-ds-entry][blocking]');` +
    `if(s)s.removeAttribute('blocking');},${ENTRY_RENDER_BLOCK_MS});` +
    '</script>'
  );
}

export interface ShellInput<TPayload> {
  /** Which React entry point boots, and which bundle is requested. */
  surface: ShellSurface;
  /**
   * Page-specific half of the `<title>`. Rendered as `diffStory — {title}`.
   * Plain text; it is HTML-escaped here, so pass the raw string.
   */
  title: string;
  /**
   * The view-model. Serialized into the `application/json` block and escaped so
   * that no value inside it — file path, diff line, comment body, branch name,
   * story title — can terminate the script element. Must be JSON-serializable;
   * `undefined` serializes as `null`.
   */
  payload: TPayload;
  /**
   * Classes for `<body>`. Only for styling that must exist before React mounts
   * (the `ds-map-bg` dot field is the real case). React owns everything else.
   */
  bodyClass?: string;
  /**
   * What sits inside `#root` until React's first commit.
   *
   * - `'brand'` (default) — a shared, surface-agnostic placeholder that fades in
   *   only after ~240 ms, so a fast boot never flashes a spinner and a slow one
   *   never shows an empty page. See the note on `bootPlaceholder()`.
   * - `'none'` — an empty `#root`.
   * - `{ html }` — surface-authored markup, already escaped by the caller.
   */
  skeleton?: 'brand' | 'none' | { html: string };
  /** Document language. Defaults to `en`, matching every current page. */
  lang?: string;
}

/**
 * Serialize a value for embedding in `<script type="application/json">`.
 *
 * This is the same technique `render.ts`'s private `jsonForDataScript()` already
 * uses for `#ds-initial-comments` and the move-annotation blocks; it is lifted
 * here (rather than imported) because `render.ts` is being deleted and this
 * becomes the one remaining copy.
 *
 * Why escaping `<` and `>` is sufficient, and why it is also necessary:
 *
 * - An HTML tokenizer inside a `<script>` element is in "script data" state. It
 *   does not decode entities, so `&amp;` would arrive at `JSON.parse` literally
 *   — we cannot use HTML escaping here. What it *does* do is watch for `</`
 *   (closes the element early) and for `<!--` (switches to script-data-escaped
 *   state, which then swallows a later `</script>` and leaves the document
 *   truncated). Both start with `<`.
 * - A six-character `<` sequence is a legal JSON escape for `<`, so
 *   replacing every `<` in the serialized text neutralizes `</script>`, `<!--`,
 *   `<script`, and `<!DOCTYPE` in one move, and `JSON.parse` restores the
 *   original characters exactly.
 * - `>` and `&` are escaped too. Neither is strictly required inside a script
 *   element, but escaping them means the same string is also safe if it is ever
 *   moved into an HTML comment, an attribute, or an XHTML/`CDATA` context.
 * - U+2028 / U+2029 are valid in JSON strings but are line terminators in
 *   pre-ES2019 JavaScript source. Escaping them keeps the text safe to paste
 *   into a `JSON.parse('...')` literal.
 * - Lone surrogates need no special handling: `JSON.stringify` has been
 *   well-formed since ES2019 (Node 12+) and emits them as `\udXXX` escapes
 *   rather than raw code units, so the output is always valid UTF-8 and
 *   round-trips through `JSON.parse` byte-for-byte.
 *
 * The one thing this does NOT do is validate that the payload is
 * JSON-serializable. `JSON.stringify` throws on cycles and on BigInt; a route
 * that hands us either has a bug worth surfacing loudly.
 */
export function serializeShellPayload(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  // `JSON.stringify` returns undefined for `undefined`, functions, and symbols.
  // An empty script body would make the client's JSON.parse throw at boot.
  if (json === undefined) return 'null';
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** HTML-escape text destined for element content or a double-quoted attribute. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The shared boot placeholder.
 *
 * Recommendation (see the contract doc for the full argument): ship this, not a
 * per-surface skeleton. A localhost bundle parses fast enough that a real
 * skeleton would mostly be a flash, and five hand-maintained skeletons would
 * drift from five React layouts within a week. What a delayed brand mark buys
 * is the slow case only — a cold macOS-app launch, a large review page — where
 * an empty white/ink rectangle reads as "broken".
 *
 * The 240 ms `animation-delay` is the whole trick: the element is invisible
 * until then, so a boot that beats the delay shows nothing at all.
 * `prefers-reduced-motion` gets a plain opacity step instead of the pulse.
 *
 * That only became true when the `backwards` fill was removed. `backwards`
 * applies the FIRST KEYFRAME during the delay, and the first keyframe of
 * `ds-boot-pulse` is `opacity:.18` — so for its entire life this placeholder
 * did the opposite of what this note claimed, painting three grey dots from the
 * very first frame instead of staying hidden. It was visible 125 ms into a
 * navigation, caught frame-by-frame in a screencast. With no fill mode the base
 * `opacity:0` holds through the delay, which is what was always intended.
 *
 * React's `createRoot(...).render()` replaces the container's existing children
 * on its first commit, so no client-side teardown is required.
 */
function bootPlaceholder(): string {
  return (
    '<div class="ds-boot" role="status" aria-live="polite">' +
    '<span class="ds-boot-dot" aria-hidden="true"></span>' +
    '<span class="ds-boot-dot" aria-hidden="true"></span>' +
    '<span class="ds-boot-dot" aria-hidden="true"></span>' +
    '<span class="ds-sr-only">Loading</span>' +
    '</div>'
  );
}

/**
 * Styles for the boot placeholder, inlined because they must apply even if the
 * client stylesheet is slow or missing. Token names come from `theme.ts` and
 * carry literal fallbacks so the placeholder still renders if `app.css` fails.
 */
function bootPlaceholderStyles(): string {
  return (
    '<style>' +
    '.ds-boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:7px;pointer-events:none}' +
    '.ds-boot-dot{width:7px;height:7px;border-radius:999px;background:var(--text-3,#b1b9c6);opacity:0}' +
    '.ds-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '@media (prefers-reduced-motion:no-preference){' +
    '.ds-boot-dot{animation:ds-boot-pulse 1.1s var(--motion-ease-in-out,cubic-bezier(.77,0,.175,1)) 240ms infinite}' +
    '.ds-boot-dot:nth-child(2){animation-delay:380ms}' +
    '.ds-boot-dot:nth-child(3){animation-delay:520ms}' +
    '@keyframes ds-boot-pulse{0%,100%{opacity:.18}50%{opacity:.8}}}' +
    '@media (prefers-reduced-motion:reduce){' +
    '.ds-boot-dot{animation:ds-boot-appear 1ms linear 240ms forwards}' +
    '@keyframes ds-boot-appear{to{opacity:.5}}}' +
    '</style>'
  );
}

function skeletonHtml(skeleton: ShellInput<unknown>['skeleton']): { root: string; styles: string } {
  if (skeleton === 'none') return { root: '', styles: '' };
  if (skeleton && typeof skeleton === 'object') return { root: skeleton.html, styles: '' };
  return { root: bootPlaceholder(), styles: bootPlaceholderStyles() };
}

/**
 * Render the shell document for one surface.
 *
 * The generic parameter is the surface's payload interface — see
 * `docs/superpowers/specs/server-shell-contract.md` for the five shapes. Route
 * handlers should annotate it explicitly, e.g.
 * `renderShell<ReviewPayload>({ surface: 'review', ... })`, so that a payload
 * that drifts from the contract fails at `tsc` rather than in the browser.
 */
export function renderShell<TPayload>(input: ShellInput<TPayload>): string {
  const { root, styles } = skeletonHtml(input.skeleton);
  const bodyClass = input.bodyClass ? ` class="${esc(input.bodyClass)}"` : '';

  return `<!doctype html>
<html lang="${esc(input.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0a0c0f" data-ds-theme-color>
${themeBootstrapScript()}
${BRAND_HEAD_LINKS}
<title>${esc(APP_BRAND)} — ${esc(input.title)}</title>
<link rel="stylesheet" href="${CLIENT_STYLESHEET_HREF}">
<script type="module" blocking="render" data-ds-entry src="${clientEntryHref(input.surface)}"></script>
${entryBlockingRelease()}${styles ? `\n${styles}` : ''}
</head>
<body${bodyClass} data-surface="${esc(input.surface)}">
<div id="root">${root}</div>
<script type="application/json" id="${SHELL_PAYLOAD_ID}">${serializeShellPayload(input.payload)}</script>
</body>
</html>`;
}
