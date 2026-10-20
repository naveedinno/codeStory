import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sharedTokens } from "../dist/theme.js";

// The review page's CSS and JS are client files now, not template strings. The
// motion contract they carry is unchanged, so the assertions are too.
const DIFF_JS = readFileSync(
  new URL("../client/surfaces/review/engine/review-engine.js", import.meta.url),
  "utf8",
);
const PAGE_JS = DIFF_JS;
const DIFF_CSS = readFileSync(
  new URL("../client/surfaces/review/review.css", import.meta.url),
  "utf8",
);
const PAGE_CSS = DIFF_CSS;

function ruleBody(css, selector) {
  const start = css.indexOf(selector + "{");
  assert.notEqual(start, -1, `missing ${selector} rule`);
  const bodyStart = start + selector.length + 1;
  return css.slice(bodyStart, css.indexOf("}", bodyStart));
}

test("shared motion primitives expose the exact dashboard timing scale", () => {
  const css = sharedTokens();
  assert.match(css, /--motion-ease-out:cubic-bezier\(0\.23,1,0\.32,1\)/);
  assert.match(css, /--motion-ease-in-out:cubic-bezier\(0\.77,0,0\.175,1\)/);
  assert.match(css, /--motion-ease-drawer:cubic-bezier\(0\.32,0\.72,0,1\)/);
  assert.match(css, /--motion-duration-press:120ms/);
  assert.match(css, /--motion-duration-fast:150ms/);
  assert.match(css, /--motion-duration-ui:200ms/);
  assert.match(css, /--motion-duration-progress:250ms/);
  assert.match(css, /--motion-duration-spatial:340ms/);
  assert.match(PAGE_CSS, /var\(--motion-duration-fast\)/);
});

test("workspace handoffs are interruptible and scoped to the changing surface", () => {
  assert.match(
    PAGE_JS,
    /function runWorkspaceTransition\(kind,direction,update\)/,
  );
  assert.match(
    PAGE_JS,
    /if\(prefersReducedMotion\(\)\)\{update\(\);return null;\}/,
  );
  assert.match(
    PAGE_JS,
    /if\(typeof document\.startViewTransition!=='function'\)return runWorkspaceFallback/,
  );
  assert.match(PAGE_JS, /workspaceTransition\.skipTransition\(\)/);
  assert.match(PAGE_JS, /document\.startViewTransition\(update\)/);
  assert.match(
    PAGE_JS,
    /Promise\.resolve\(workspaceTransition\.ready\)\.catch\((?:function\(\)\{\}|\(\)=> \{\})\)/,
  );
  assert.match(
    PAGE_JS,
    /function runWorkspaceFallback\(kind,direction,update\)/,
  );
  assert.match(
    PAGE_JS,
    /workspaceFallbackTimer\)clearTimeout\(workspaceFallbackTimer\)/,
  );
  assert.match(PAGE_JS, /surface\.classList\.add\('is-workspace-entering'\)/);
  assert.match(
    PAGE_CSS,
    /\.is-workspace-entering\[data-ds-enter-direction="1"\]/,
  );
  assert.match(PAGE_JS, /runWorkspaceTransition\('view'/);
  assert.match(PAGE_JS, /runWorkspaceTransition\('file'/);
  assert.match(PAGE_JS, /runWorkspaceTransition\('step'/);
  assert.match(DIFF_JS, /runWorkspaceTransition\('mode',0,update\)/);
  assert.match(PAGE_CSS, /view-transition-name:ds-workspace-surface/);
  assert.match(PAGE_CSS, /::view-transition-old\(ds-workspace-surface\)/);
  assert.match(PAGE_CSS, /::view-transition-new\(ds-workspace-surface\)/);
  assert.doesNotMatch(PAGE_CSS, /ds-review-(?:chrome|layout)-in[^}]*\sboth/);
});

test("concept scenes get one interruptible first-visit entrance without moving code", () => {
  assert.match(PAGE_JS, /var sceneEntered=\{0:true\},sceneAnimations=\[\],sceneEntranceToken=0/);
  assert.match(PAGE_JS, /function cancelSceneEntrance\(\)/);
  assert.match(PAGE_JS, /sceneAnimations\.forEach\(function\(animation\)\{try\{animation\.cancel\(\);\}catch\(e\)\{\}\}\)/);
  assert.match(PAGE_JS, /function conceptSceneNeedsEntrance\(panel,index\)/);
  assert.match(PAGE_JS, /panel\.hasAttribute\('data-step-lazy'\)/);
  assert.match(PAGE_JS, /layout==='concept-document'\|\|layout==='concept-diagram'/);

  const start = PAGE_JS.indexOf("function animateConceptScene");
  const end = PAGE_JS.indexOf("function syncSidebarOverlay", start);
  assert.ok(start >= 0 && end > start, "the concept entrance helper stays beside workspace transitions");
  const entrance = PAGE_JS.slice(start, end);
  assert.match(entrance, /prefersReducedMotion\(\)/);
  assert.match(entrance, /translateY\(6px\)/);
  assert.match(entrance, /position\*40/);
  assert.match(entrance, /--motion-duration-ui/);
  assert.match(entrance, /--motion-ease-out/);
  assert.doesNotMatch(entrance, /\.ds-(?:row|urow|diffscroll|diff)(?:['",.]|\b)/);

  assert.match(PAGE_JS, /cancelSceneEntrance\(\);\s*var entrancePanel=/);
  assert.match(PAGE_JS, /if\(revealConcept\)\{[\s\S]*?skipTransition[\s\S]*?update\(\);animateConceptScene/);
  assert.match(PAGE_CSS, /ds-concept-diagram-in var\(--motion-duration-ui\) var\(--motion-ease-out\)/);
  assert.match(PAGE_CSS, /\.ds-concept-diagram-output svg\{animation:none!important\}/);
});

test("change navigation uses one stable marker without keyframes or cleanup timers", () => {
  assert.match(
    DIFF_CSS,
    /\.ds-row\.is-change-jump,\.ds-urow\.is-change-jump\{box-shadow:inset 0 0 0 1px var\(--accent-blue\)\}/,
  );
  assert.doesNotMatch(DIFF_CSS, /dsChangeJump/);
  assert.match(
    DIFF_JS,
    /\$all\('\.ds-row-add,\.ds-row-del,\.ds-row-pair',holder\)\.forEach\((?:function\(r\)\{r\.classList\.remove\('is-change-jump'\);r\.removeAttribute\('aria-current'\);\}|\(r\)=> \{r\.classList\.remove\('is-change-jump'\);r\.removeAttribute\('aria-current'\);\})\)/,
  );
  assert.doesNotMatch(DIFF_JS, /setTimeout\([^\n]*is-change-jump|1300/);
});

test("focus scrolling cancels stale work and honors reduced motion", () => {
  assert.match(PAGE_JS, /focusScrollTimer=0,focusScrollFrame=0/);
  assert.match(PAGE_JS, /function cancelFocusScroll\(\)/);
  assert.match(PAGE_JS, /cancelAnimationFrame\(focusScrollFrame\)/);
  assert.match(PAGE_JS, /document\.documentElement\.contains\(target\)/);
  assert.match(
    PAGE_JS,
    /var rendered=rows\.filter\((?:function\(row\)\{return !closest\(row,'\[hidden\]'\)&&row\.getClientRects\(\)\.length>0;\}|\(row\)=> !closest\(row,'\[hidden\]'\)&&row\.getClientRects\(\)\.length>0)\)/,
    "beat centering excludes the hidden unified or split copy",
  );
  assert.match(
    PAGE_JS,
    /var candidates=rendered\.length\?rendered:rows,target=candidates\[Math\.floor\(\(candidates\.length-1\)\/2\)\]/,
    "beat centering chooses its midpoint from rendered rows",
  );
  assert.match(
    PAGE_JS,
    /behavior:instant\|\|prefersReducedMotion\(\)\?'auto':'smooth'/,
  );
  assert.match(
    DIFF_JS,
    /behavior:\(opts&&opts\.instant\)\|\|prefersReducedMotion\(\)\?'auto':'smooth'/,
  );
});

test("resize gestures batch frame writes and scope layout variables", () => {
  assert.match(PAGE_JS, /sidebarResizeFrame=requestAnimationFrame/);
  assert.match(PAGE_JS, /splitResizeFrame=requestAnimationFrame/);
  assert.match(PAGE_JS, /cancelAnimationFrame\(sidebarResizeFrame\)/);
  assert.match(PAGE_JS, /cancelAnimationFrame\(splitResizeFrame\)/);
  assert.match(
    PAGE_JS,
    /document\.body\.style\.setProperty\('--ds-rail-width'/,
  );
  assert.match(PAGE_JS, /splitHolder\.style\.setProperty\('--ds-split'/);
  assert.doesNotMatch(
    PAGE_JS,
    /document\.documentElement\.style\.setProperty\('--ds-(?:rail-width|split)'/,
  );
  assert.match(PAGE_JS, /localStorage\.setItem\('ds-sidebar-width'/);
  assert.match(PAGE_JS, /localStorage\.setItem\('ds-split'/);
  assert.doesNotMatch(PAGE_CSS, /\.ds-rail\{[^}]*transition:[^}]*width/);
});

test("read aloud focus is static and routine playback state stays in the controls", () => {
  assert.doesNotMatch(DIFF_CSS, /dsVoiceFocus/);
  assert.doesNotMatch(
    ruleBody(DIFF_CSS, ".ds-row.is-voice-focus"),
    /animation|filter/,
  );
  assert.doesNotMatch(
    ruleBody(DIFF_CSS, ".ds-urow.is-voice-focus"),
    /animation|filter/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-readaloud\.is-speaking \.ds-readaloud-ico\{animation:none;box-shadow:0 0 0 3px var\(--accent-soft\)\}/,
  );
  // Both transport glyphs are static masked SVG tinted by currentColor — shapes,
  // never animation. Pause is pinned by the two properties that made the old
  // border-drawn version read as a single blob at 21px: square ends, and a gap
  // narrower than the bars themselves.
  assert.match(
    PAGE_CSS,
    /\.ds-readaloud-ico\.is-play::before,\.ds-readaloud-ico\.is-pause::before\{content:"";display:block;width:10px;height:10px;background:currentColor/,
  );
  const pauseGlyph =
    /\.ds-readaloud-ico\.is-pause::before\{(--ds-transport-glyph[^}]*)\}/.exec(
      PAGE_CSS,
    );
  assert.ok(
    pauseGlyph,
    "missing .ds-readaloud-ico.is-pause::before glyph rule",
  );
  assert.doesNotMatch(pauseGlyph[1], /animation/);
  const bars = [
    ...pauseGlyph[1].matchAll(
      /<rect x='([\d.]+)'[^>]*width='([\d.]+)'[^>]*rx='([\d.]+)'/g,
    ),
  ].map((m) => ({ x: Number(m[1]), width: Number(m[2]), rx: Number(m[3]) }));
  assert.equal(bars.length, 2, "pause draws exactly two bars");
  assert.ok(
    bars.every((bar) => bar.rx > 0),
    "pause bars have rounded ends",
  );
  assert.ok(
    bars[1].x - (bars[0].x + bars[0].width) > bars[0].width,
    "gap between pause bars is wider than a bar",
  );
  assert.match(
    PAGE_CSS,
    /\.ds-narration-stop span\{width:9px;height:9px;border-radius:2px;background:currentColor/,
  );
  assert.doesNotMatch(
    PAGE_CSS,
    /ds-narration-status|ds-narration-track|ds-narration-dot/,
  );
  assert.doesNotMatch(PAGE_CSS, /ds-aloud-active \.ds-live-banner/);
  assert.match(PAGE_CSS, /\.ds-narration-stop::after\{content:"Stop"\}/);
  // The transport rides in the bottom island now, so the compact Stop has to hang
  // above the play button — below it is off the bottom of the viewport.
  assert.match(
    PAGE_CSS,
    /\.ds-narration-stop\{position:absolute;z-index:13;bottom:calc\(100% \+ 14px\);inset-inline-start:0;width:62px;height:32px/,
  );
  assert.doesNotMatch(PAGE_CSS, /ds-playstep/);
  assert.match(
    PAGE_JS,
    /document\.body\.classList\.toggle\('ds-aloud-active',playing\)/,
  );
  assert.doesNotMatch(PAGE_JS, /Voice paused|Voice resumed/);
  assert.match(PAGE_CSS, /\.ds-readaloud\.is-loading/);
  assert.match(PAGE_CSS, /\.ds-readaloud\.is-active \.ds-readaloud-wave\{width:20px;opacity:\.82;transform:none\}/);
  assert.match(PAGE_CSS, /\.ds-readaloud\.is-audible \.ds-readaloud-wave>span\{animation:ds-waveform/);
  assert.match(PAGE_CSS, /\.ds-readaloud-ico\.is-play::before,\.ds-readaloud-ico\.is-pause::before\{animation:ds-transport-morph/);
  assert.match(PAGE_JS, /classList\.toggle\('is-audible',speaking&&!loading\)/);
});

test("review navigation and logic annotations use semantic motion, not decoration", () => {
  // The dock is a pointer-proximity field: neighbouring stops respond with a
  // smooth falloff while the review order remains fixed and keyboard focus has
  // an equivalent enlarged state.
  assert.match(PAGE_JS, /distance=Math\.abs\(filmPointerX-/);
  assert.match(PAGE_JS, /1-distance\/132/);
  assert.match(PAGE_JS, /1\+\.36\*influence/);
  assert.match(PAGE_JS, /-8\*influence/);
  assert.match(PAGE_CSS, /\.ds-filmnode:focus-visible\{--ds-dock-scale:1\.36;--ds-dock-lift:-8px\}/);
  assert.match(
    PAGE_CSS,
    /\.ds-filmnode:is\(:hover,:focus-visible\) \.ds-filmnode-num\{[^}]*border-color:transparent;background:transparent;box-shadow:none/,
  );

  // Logic-move overlays draw once when their step becomes active. Resize
  // observers may repaint geometry, but must not replay the explanation.
  assert.match(PAGE_JS, /pathLength:1/);
  assert.match(PAGE_JS, /trace=!prefersReducedMotion\(\)&&panel\.getAttribute\('data-annot-traced'\)!=='1'/);
  assert.match(PAGE_JS, /panel\.setAttribute\('data-annot-traced','1'\)/);
  assert.match(PAGE_CSS, /@keyframes ds-circuit-trace\{to\{stroke-dashoffset:0\}\}/);
});

test("reduced motion keeps status feedback but removes movement and pulses", () => {
  assert.match(PAGE_JS, /function prefersReducedMotion\(\)/);
  assert.match(
    PAGE_CSS,
    /\.ds-toast\{animation:none!important;transform:translateX\(-50%\);transition:opacity var\(--motion-duration-ui\) var\(--motion-ease-out\)\}/,
  );
  assert.match(PAGE_CSS, /\.ds-readhead-fill\{transition:none!important\}/);
  assert.match(PAGE_CSS, /\.ds-readaloud\.is-loading \.ds-readaloud-ico,\.ds-readaloud-ico::before,\.ds-readaloud-wave>span,\.ds-composer,\.ds-annot \*\{animation:none!important\}/);
  assert.match(PAGE_CSS, /\.ds-copy-action,\.ds-copy-action-icon>span\{transition:none!important\}/);
  assert.doesNotMatch(PAGE_CSS, /ds-voice-card/);
  assert.match(PAGE_CSS, /\.ds-live-banner\{transition:none!important\}/);
  assert.match(
    DIFF_CSS,
    /\.ds-row\.is-voice-focus[^}]*animation:none!important;filter:none!important/,
  );
  // The progress panel's own reduced-motion contract moved with it into
  // `client/surfaces/progress/` and is asserted by test/progress-ui.test.mjs
  // against the component, not against a stylesheet string.
});

test("drawers share an interruptible spatial lifecycle", () => {
  assert.match(
    PAGE_CSS,
    /\.ds-drawer-scrim\{[^}]*opacity:0;transition:opacity var\(--motion-duration-ui\) var\(--motion-ease-out\)/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-drawer\{[^}]*transform:translateX\(100%\);transition:transform var\(--motion-duration-progress\) var\(--motion-ease-drawer\)/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-drawer-root\.is-open \.ds-drawer\{transform:translateX\(0\)\}/,
  );
  assert.match(PAGE_JS, /function showDrawerRoot\(root\)/);
  assert.match(PAGE_JS, /function hideDrawerRoot\(root\)/);
  assert.match(PAGE_JS, /clearTimeout\(root\._dsHideTimer\)/);
  assert.match(PAGE_JS, /root\.classList\.add\('is-open'\)/);
  assert.match(PAGE_JS, /root\.classList\.remove\('is-open'\)/);
  assert.match(PAGE_JS, /prefersReducedMotion\(\)\?200:250/);
});

test("reading progress uses a composited scale and comment surfaces are instant", () => {
  const fill = ruleBody(PAGE_CSS, ".ds-readhead-fill");
  assert.match(fill, /width:100%/);
  assert.match(fill, /transform:scaleX\(0\)/);
  assert.match(fill, /transform-origin:left center/);
  assert.match(
    fill,
    /transition:transform var\(--motion-duration-progress\) var\(--motion-ease-in-out\)/,
  );
  assert.match(PAGE_JS, /pf\.style\.transform='scaleX\('\+ratio\+'\)'/);
  assert.doesNotMatch(
    PAGE_JS,
    /ds-progress-fill[^\n]*style\.width|pf\.style\.width/,
  );
  assert.doesNotMatch(
    ruleBody(PAGE_CSS, ".ds-composer"),
    /animation|transition/,
  );
  assert.doesNotMatch(
    ruleBody(PAGE_CSS, ".ds-feedback-card"),
    /animation|transition/,
  );
});
