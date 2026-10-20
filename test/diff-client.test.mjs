// The diff-surface client assets stay composed into the one page IIFE. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sharedTokens } from '../dist/theme.js';

// `DIFF_CSS`/`DIFF_JS` and `PAGE_CSS`/`PAGE_JS` were template strings inlined
// into every review document. They are files now — `review.css` and the ported
// `review-engine.js` — and the assertions below are unchanged, because the text
// is. The four names are kept as aliases so the diff of this file shows only
// what actually moved.
const DIFF_JS = readFileSync(new URL('../client/surfaces/review/engine/review-engine.js', import.meta.url), 'utf8');
const PAGE_JS = DIFF_JS;
const DIFF_CSS = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
const PAGE_CSS = DIFF_CSS;
const REVIEW_APP = readFileSync(new URL('../client/surfaces/review/ReviewApp.tsx', import.meta.url), 'utf8');
const RENDER_SRC = readFileSync(new URL('../src/render.ts', import.meta.url), 'utf8');

test('diff-assets exports the diff client functions', () => {
  assert.match(DIFF_JS, /function setMode\(/);
  assert.match(DIFF_JS, /function loadFull\(/);
  assert.match(DIFF_JS, /function updateChangeNav\(/);
  assert.match(DIFF_JS, /function handleChangeShortcut\(/);
});

test('the diff assets ship as one review stylesheet and one review engine', () => {
  // They used to be `DIFF_CSS`/`DIFF_JS` template strings spliced into
  // `PAGE_CSS`/`PAGE_JS`. Same composition, two files: the stylesheet is
  // imported by `client/styles.css`, and the diff functions are declarations
  // inside the engine's single exported entry point, which is what keeps them
  // in one closure with the page half.
  assert.match(DIFF_JS, /^\/\/ The review page's interaction engine\./);
  assert.match(DIFF_JS, /export function startReviewEngine\(options\)\{/);
  assert.ok(DIFF_JS.indexOf('function setMode(') > DIFF_JS.indexOf('export function startReviewEngine'));
  assert.match(DIFF_CSS, /^\/\* The review surface's stylesheet\./);
});

test('diff CSS moved out of page-assets core', () => {
  assert.match(DIFF_CSS, /\.ds-row\b/);
  assert.match(DIFF_CSS, /\.ds-hunkgap\b/);
  assert.match(DIFF_CSS, /\.ds-hunkgap-side\b/);
  assert.match(DIFF_CSS, /\.ds-modetoggle\b/);
});

test('diff headers and context gaps follow the resolved color theme', () => {
  assert.match(DIFF_CSS, /\.ds-diffhead\{[^}]*background:var\(--gutter-hi\)/);
  assert.match(DIFF_CSS, /\.ds-hunkgap\{[^}]*background:var\(--gutter\)/);
  assert.doesNotMatch(DIFF_CSS, /\.ds-diffhead\{[^}]*background:#[0-9a-f]+/i);
  assert.doesNotMatch(DIFF_CSS, /\.ds-hunkgap\{[^}]*background:#[0-9a-f]+/i);
});

test('diff file headers stay compact above the code', () => {
  assert.match(DIFF_CSS, /\.ds-diffhead-ctx\{[^}]*padding:5px 14px/);
  assert.match(DIFF_CSS, /\.ds-diffhead-side\{[^}]*padding:5px 14px/);
});

test('reviewed-file tracking is hash-bound, accessible, and wired through storage and the v key', () => {
  assert.match(DIFF_JS, /function toggleViewed\(/);
  assert.match(DIFF_JS, /function syncViewed\(/);
  assert.match(DIFF_JS, /function reviewHashForFile\(/);
  assert.match(DIFF_JS, /getAttribute\('data-review-hash'\)/);
  assert.match(DIFF_JS, /'ds-viewed:'/);
  assert.match(PAGE_JS, /data-viewed-toggle/);
  assert.match(DIFF_JS, /viewedFiles\[file\]===hash/);
  assert.match(DIFF_JS, /JSON\.stringify\(viewedFiles\)/);
  assert.match(DIFF_JS, /Array\.isArray\(stored\)/, 'legacy filename arrays migrate to current hashes');
  assert.match(DIFF_JS, /if\(typeof syncViewed==='function'\)syncViewed\(\)/, 'lazy panels refresh their reviewed control');
  assert.match(DIFF_JS, /setAttribute\('aria-pressed',on\?'true':'false'\)/);
  assert.match(DIFF_JS, /on\?' unreviewed':' reviewed'/);
  assert.match(DIFF_JS, /on\?'Reviewed':'Mark reviewed'/);
  assert.match(DIFF_JS, /formatReviewCount\(n\)\+' of '\+formatReviewCount\(total\)\+' reviewed'/);
  assert.match(PAGE_JS, /activeFileFilter==='reviewed'/);
  assert.match(PAGE_JS, /activeFileFilter==='unreviewed'/);
  assert.match(PAGE_JS, /e\.key==='v'\|\|e\.key==='V'/);
});

test('reviewed checks use a defined local contrast token in both color schemes', () => {
  assert.match(DIFF_CSS, /--ds-reviewed-check-fg:var\(--on-green,#00250c\)/);
  assert.match(DIFF_CSS, /color:var\(--ds-reviewed-check-fg\)/);
  assert.doesNotMatch(DIFF_CSS, /var\(--on-add\)/);
});

test('split mode is lazy-loaded and persisted', () => {
  assert.match(DIFF_JS, /function loadSplit\(/);
  assert.match(DIFF_JS, /'ds-files-mode'/);
  assert.match(DIFF_JS, /\/api\/diff\/split\?file=/);
  assert.match(PAGE_JS, /function applyFilesMode\(/);
});

test('all lazy diff requests reject non-ok responses and expose inline retry actions', () => {
  assert.match(DIFF_JS, /function diffResponseText\(r\)/);
  assert.match(DIFF_JS, /if\(!r\.ok\).*err\.status=r\.status/);
  assert.equal((DIFF_JS.match(/\.then\(diffResponseText\)/g) || []).length, 3);
  assert.match(DIFF_JS, /function showDiffLoadError\(/);
  assert.match(DIFF_JS, /note\.setAttribute\('role','alert'\)/);
  assert.match(DIFF_JS, /retry\.setAttribute\('data-mode',mode\)/);
  assert.match(DIFF_JS, /function showGapError\(/);
  assert.match(DIFF_JS, /retry\.setAttribute\('data-expand',mode\)/);
  assert.match(DIFF_JS, /Could not load hidden context/);
  assert.match(DIFF_JS, /if\(!wrap\|\|!wrap\.hasAttribute\('data-ctx-rows'\)\)throw new Error\('Unexpected context response'\)/);
});

test('every lazy evidence request carries the issued page lease and offers a safe reload on conflict', () => {
  assert.match(PAGE_JS, /function reviewPageUrl\(path\)/);
  assert.match(PAGE_JS, /data-review-page-token/);
  assert.match(PAGE_JS, /url\.searchParams\.set\('page',token\)/);
  assert.match(PAGE_JS, /err\.reloadRequired=r\.status===409/);
  assert.match(PAGE_JS, /data-review-reload/);
  assert.match(PAGE_JS, /location\.reload\(\)/);
  for (const endpoint of [
    '/api/review/step-panel?index=',
    '/api/diff/file-panel?file=',
    '/api/review/excluded-file?file=',
    '/api/fullfile?file=',
    '/api/diff/split?file=',
    '/api/diff/context?file=',
  ]) {
    assert.match(PAGE_JS, new RegExp(`reviewPageUrl\\('${endpoint.replace(/[?]/g, '\\?')}`));
  }
});

test('diff display modes expose their selected state to assistive technology', () => {
  assert.match(DIFF_JS, /b\.setAttribute\('aria-pressed',active\?'true':'false'\)/);
});

test('expand-context client is wired', () => {
  assert.match(DIFF_JS, /function expandGap\(/);
  assert.match(DIFF_JS, /\/api\/diff\/context\?file=/);
  assert.match(PAGE_JS, /data-expand/);
});

test('expanding a gap retires the enclosing-scope label above the hunk', () => {
  // The label stands in for the code hidden above a hunk. Once that code is on
  // screen the label is stale, and leaving it strands a declaration mid-body.
  assert.match(DIFF_JS, /pruneScopeRows\(holder\)/);
  const source = DIFF_JS.match(/ {2}function pruneScopeRows\([^]*?\n {2}}/)?.[0];
  assert.ok(source, 'pruneScopeRows is defined');
  const node = (cls, prev = null) => ({
    removed: false,
    previousElementSibling: prev,
    classList: { contains: (c) => c === cls },
    remove() { this.removed = true; },
  });
  const stale = node('ds-scoperow', node('ds-row'));
  const fronting = node('ds-scoperow', node('ds-hunkgap'));
  const head = node('ds-scoperow');
  const context = vm.createContext({ $all: () => [stale, fronting, head] });
  vm.runInContext(source, context);
  context.pruneScopeRows({});
  assert.equal(stale.removed, true, 'a label with revealed code above it goes');
  assert.equal(fronting.removed, false, 'a label still fronting a gap stays');
  assert.equal(head.removed, false, 'a label at the head of a column stays');
});

test('hunk expansion remains discoverable without hover on touch devices', () => {
  assert.match(DIFF_CSS, /@media \(hover:none\),\(pointer:coarse\)\{\.ds-hunkgap\.is-expandable \.ds-gapbtn\{opacity:1/);
  assert.match(DIFF_CSS, /\.ds-hunkgap\.is-expandable \.ds-gapbtn\{opacity:1\}/);
  assert.doesNotMatch(DIFF_CSS, /\.ds-gapdots/);
  // Split gaps are two column halves of one fixed height so the columns stay
  // paired through them; nothing straddles the divider any more.
  assert.match(DIFF_CSS, /\.ds-hunkgap-side\{[^}]*height:30px[^}]*overflow:hidden/);
  assert.match(DIFF_CSS, /\.ds-hunkgap-l\{justify-content:flex-end\}/);
  assert.match(DIFF_CSS, /\.ds-hunkgap-r\{justify-content:flex-start\}/);
  assert.doesNotMatch(DIFF_CSS, /ds-gap-mid|ds-gap-side/);
  assert.match(DIFF_JS, /data-gap-chunk/);
  assert.match(DIFF_JS, /from\+chunk-1/);
});

test('split divider and change rows have keyboard review foundations', () => {
  assert.match(DIFF_JS, /function prepareSplitDivider\(/);
  assert.match(DIFF_JS, /divider\.setAttribute\('role','separator'\)/);
  assert.match(DIFF_JS, /divider\.setAttribute\('aria-valuemin','0'\)/);
  assert.match(DIFF_JS, /divider\.setAttribute\('aria-valuemax','100'\)/);
  assert.match(DIFF_JS, /divider\.addEventListener\('keydown',handleSplitDividerKey\)/);
  assert.ok(DIFF_JS.includes("key!=='ArrowLeft'&&key!=='ArrowRight'&&key!=='Home'&&key!=='End'"));
  assert.match(DIFF_JS, /opts&&opts\.focus&&row\.focus/);
  assert.match(DIFF_JS, /nav\.setAttribute\('role','group'\);nav\.setAttribute\('aria-label','Change navigation'\)/);
  assert.match(DIFF_CSS, /\.ds-row\[data-review-row\]:focus-visible,\.ds-urow\[data-review-row\]:focus-visible/);
  assert.match(DIFF_CSS, /\.ds-celldiv\[role="separator"\]:focus-visible/);
});

test('review page consumes shared tokens and respects reduced motion', () => {
  // The tokens are no longer inlined ahead of the review CSS — every surface
  // gets them from the generated theme bridge — so the check is that the review
  // stylesheet USES them and defines none of its own palette.
  assert.match(sharedTokens(), /--app-bg:/);
  assert.match(PAGE_CSS, /var\(--app-bg\)|var\(--panel/);
  assert.match(DIFF_CSS, /prefers-reduced-motion/);
});

test('line wrapping is an accessible persisted option and defaults to off', () => {
  assert.doesNotMatch(REVIEW_APP, /data-line-wrap-toggle/);
  assert.match(RENDER_SRC, /function lineWrapToggle\(\)/);
  assert.equal((RENDER_SRC.match(/\$\{lineWrapToggle\(\)\}/g) || []).length, 2);
  assert.match(RENDER_SRC, /data-line-wrap-toggle/);
  assert.match(RENDER_SRC, /aria-pressed="false"/);
  assert.match(DIFF_JS, /function setLineWrap\(on,persist\)/);
  assert.match(DIFF_JS, /localStorage\.getItem\('ds-line-wrap'\)==='1'/);
  assert.match(DIFF_JS, /localStorage\.setItem\('ds-line-wrap',on\?'1':'0'\)/);
  assert.match(DIFF_JS, /classList\.toggle\('ds-line-wrap',on\)/);
  assert.ok((DIFF_JS.match(/setLineWrap\(document\.body\.classList\.contains\('ds-line-wrap'\),false\)/g) || []).length >= 2);
  assert.match(DIFF_CSS, /\.ds-code\{[^}]*white-space:pre;[^}]*overflow-wrap:normal/);
  assert.match(DIFF_CSS, /body\.ds-line-wrap \.ds-code\{white-space:pre-wrap;overflow-wrap:anywhere\}/);
  assert.match(DIFF_CSS, /\.ds-diffview-controls>\.ds-linewrap-toggle/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-linewrap-toggle/);
});

test('story diff actions stay together and split panes cannot paint through the divider', () => {
  // The file path labels the diff and opens it under All files; no separate
  // "Whole diff" button sits beside the display-mode controls.
  assert.match(
    RENDER_SRC,
    /<div class="ds-difftoolbar">\s*<button class="ds-diff-path" type="button" data-open-full-diff=/,
  );
  assert.match(RENDER_SRC, /<div class="ds-diffview-controls">\s*\$\{lineWrapToggle\(\)\}/);
  assert.doesNotMatch(RENDER_SRC, />Whole diff</);
  assert.match(
    DIFF_CSS,
    /\.ds-step\.is-code-step \.ds-difftoolbar\{[^}]*display:flex[^}]*justify-content:flex-end/,
  );
  assert.match(
    DIFF_CSS,
    /\[data-split-inner\]:not\(\[hidden\]\) \.ds-cell\{overflow:hidden;clip-path:inset\(0\)\}/,
  );
  assert.match(DIFF_CSS, /@container \(max-width:420px\)\{\.ds-step\.is-code-step \.ds-diff-path \.ds-dim\{display:none\}/);
  assert.match(DIFF_CSS, /@container \(max-width:340px\)\{\.ds-step\.is-code-step \.ds-diff-path\{display:none\}/);
  assert.match(DIFF_CSS, /@container \(max-width:340px\)\{\.ds-step\.is-code-step \.ds-linewrap-toggle \[data-line-wrap-label\]\{display:none\}/);
});

test('unwrapped diffs scroll horizontally without disturbing vertical row navigation', () => {
  assert.match(DIFF_CSS, /\.ds-diffscroll\{[^}]*min-width:0[^}]*overflow:auto/);
  assert.match(DIFF_CSS, /\.ds-diff\{[^}]*width:max-content[^}]*min-width:100%[^}]*max-width:none/);
  // The toolbar is sized from the measured scroller viewport, never a fixed
  // scrollbar deduction — that left a strip of code past the toolbar's right
  // edge whenever the diff was too short to need a vertical scrollbar.
  assert.match(DIFF_CSS, /\.ds-difftoolbar\{[^}]*inset-inline-start:0[^}]*width:var\(--ds-diffviewport-w,100cqw\)[^}]*max-width:var\(--ds-diffviewport-w,100cqw\)/);
  assert.doesNotMatch(DIFF_CSS, /\.ds-difftoolbar\{[^}]*100cqw - 11px/);
  // The step's tune menu opens over the sticky toolbar (9) and file head (10).
  assert.match(DIFF_CSS, /\.ds-story-tune-pop\{[^}]*z-index:11/);
  assert.match(DIFF_JS, /function measureViewport\(scroller\)/);
  assert.match(DIFF_JS, /--ds-diffviewport-w/);
  assert.match(DIFF_JS, /\$all\('\.ds-difftoolbar,\.ds-filepanel-head,\.ds-diffscroll'\)\.forEach\(function\(el\)\{stickyObserver\.observe\(el\);\}\);/);
  assert.match(DIFF_CSS, /\.ds-filepanel-body\{[^}]*width:max-content[^}]*min-width:100%/);
  assert.match(DIFF_CSS, /body\.ds-line-wrap \.ds-diffscroll\{overflow-x:hidden\}/);
  assert.match(DIFF_CSS, /body\.ds-line-wrap \.ds-diff\{width:100%;min-width:0;max-width:100%\}/);
  assert.match(DIFF_CSS, /body\.ds-line-wrap \.ds-filepanel-body\{width:100%;min-width:0\}/);
  assert.match(DIFF_JS, /function scrollReviewRowVertically\(row,opts\)/);
  assert.match(DIFF_JS, /scrollReviewRowVertically\(row,opts\)/);
  assert.doesNotMatch(DIFF_JS, /scrollIntoView/);
});

test('split panes resize independently of line length and scroll their code locally', () => {
  assert.match(DIFF_JS, /function syncSplitPaneLayout\(holder\)/);
  assert.match(DIFF_JS, /function ensureSplitPaneScrollbars\(holder\)/);
  assert.match(DIFF_JS, /Math\.max\(0,Math\.min\(100,pct\)\)/);
  assert.match(DIFF_JS, /if\(key==='Home'\)pct=0;else if\(key==='End'\)pct=100/);
  assert.match(DIFF_JS, /--ds-left-scroll/);
  assert.match(DIFF_JS, /--ds-right-scroll/);
  assert.match(DIFF_JS, /scroller\.setAttribute\('aria-keyshortcuts','ArrowLeft ArrowRight Home End'\)/);
  assert.match(DIFF_JS, /if\(e\.key==='Home'\)next=0;else if\(e\.key==='End'\)next=max/);
  assert.ok(
    (DIFF_JS.match(/syncSplitPaneLayout\(/g) || []).length >= 6,
    'initial, lazy, mode, context, keyboard, and resize paths must all resync pane layout',
  );
  assert.doesNotMatch(DIFF_JS, /Math\.max\(maxLeft\/ratio,maxRight\/\(1-ratio\)\)/);
  assert.match(
    DIFF_CSS,
    /\[data-split-inner\]:not\(\[hidden\]\) \.ds-cell\{overflow:hidden[^}]*\}/,
  );
  assert.match(DIFF_CSS, /\.ds-split-mode \[data-split-inner\]:not\(\[hidden\]\) \.ds-diffbody\{overflow-x:clip\}/);
  assert.match(DIFF_CSS, /\.ds-hunkgap-side\{[^}]*overflow:hidden/);
  assert.match(DIFF_CSS, /\.ds-diff\.ds-split-mode\{width:100%;min-width:0;max-width:100%\}/);
  assert.match(DIFF_CSS, /\.ds-filepanel\.ds-split-mode \.ds-filepanel-body\{width:100%;min-width:0\}/);
  assert.match(DIFF_CSS, /\.ds-split-scrollbars\{[^}]*display:flex/);
  // The pinned bars sit outside the isolated column grid, so no z-index lifts
  // an open composer above them; they unpin instead of covering the textarea.
  assert.match(DIFF_CSS, /\.ds-split-mode:has\(\.ds-composer\) \.ds-split-scrollbars\{position:relative\}/);
  assert.match(DIFF_CSS, /\.ds-pane-scroll-left\{flex-grow:var\(--ds-split,50\)/);
  assert.match(DIFF_CSS, /\.ds-pane-scroll-right\{flex-grow:calc\(100 - var\(--ds-split,50\)\)/);
  assert.match(DIFF_CSS, /\.ds-celldiv::after\{[^}]*inset-inline-start:-12px;inset-inline-end:-12px/);
});

test('split panes share native grid tracks without scroll-driven geometry', () => {
  assert.match(DIFF_CSS, /\.ds-diffbody-cols\{[^}]*display:grid;[^}]*isolation:isolate/);
  assert.match(DIFF_CSS, /\.ds-col\{[^}]*grid-template-rows:subgrid;grid-row:1\/-1/);
  assert.match(DIFF_CSS, /\.ds-col-l\{grid-column:1\}/);
  assert.match(DIFF_CSS, /\.ds-col-r\{grid-column:3\}/);
  assert.doesNotMatch(DIFF_CSS, /\.ds-col\{[^}]*will-change:transform/);
  assert.doesNotMatch(DIFF_JS, /function autoFillFlow|function watchFlowScroller|function shiftAnnotations/);
  assert.match(DIFF_JS, /function measureSplitFlow\(body\)/);
  assert.match(DIFF_JS, /it\.el\.style\.gridRow=String\(index\+1\)/);
  assert.match(DIFF_JS, /function flowTwin\(row\)/);
  assert.match(DIFF_JS, /insertFlowFragments\(gap,mirrorGap,leftFrag,rightFrag,mode\)/);
  assert.match(DIFF_JS, /flowCanonicalGap\(mirrorHalf\)/);
  assert.match(DIFF_JS, /ft=flowRowTop\(row\)/);
  assert.match(DIFF_JS, /ft=flowRowTop\(target\)/);
  assert.match(DIFF_CSS, /\.ds-step\.is-code-step\{position:relative;isolation:isolate;/);
});

test('compact file toolbars wrap identity and review controls onto separate rows', () => {
  assert.match(DIFF_CSS, /\.ds-filepanel-head\{--ds-filepanel-control-height:36px/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-changejump,\.ds-filepanel-head>\.ds-viewed-toggle,\.ds-filepanel-head>\.ds-linewrap-toggle,\.ds-filepanel-head>\.ds-modetoggle\{[^}]*height:var\(--ds-filepanel-control-height\)/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-changejump \.ds-changebtn\{width:36px;height:30px\}/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-modetoggle button\{height:30px/);
  assert.match(DIFF_CSS, /@media \(hover:none\),\(pointer:coarse\)\{[\s\S]*\.ds-filepanel-head\{--ds-filepanel-control-height:44px\}/);
  assert.match(DIFF_CSS, /@media \(max-width:720px\)[\s\S]*\.ds-filepanel-head\{flex-wrap:wrap/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head::after\{content:'';order:6;flex-basis:100%/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-linewrap-toggle\{order:9\}/);
  assert.match(DIFF_CSS, /\.ds-filepanel-head>\.ds-modetoggle\{order:10;margin-inline-start:auto\}/);
  assert.match(DIFF_CSS, /@media \(max-width:470px\)[\s\S]*\.ds-reviewchrome-main>\.ds-titlewrap\{display:none\}/);
});
