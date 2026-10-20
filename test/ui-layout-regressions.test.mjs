import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// `src/page-assets.ts` held the review page's CSS and its client JS in one
// file, and the assertions below read both out of one `source`. Both moved into
// `client/surfaces/review/` unchanged — the stylesheet verbatim, the engine as
// a module — so `source` is the pair, concatenated, and every regex here still
// means what it meant.
const reviewCss = readFileSync(
  new URL("../client/surfaces/review/review.css", import.meta.url),
  "utf8",
);
const engineJs = readFileSync(
  new URL("../client/surfaces/review/engine/review-engine.js", import.meta.url),
  "utf8",
);
const source = `${reviewCss}\n${engineJs}`;

function driftHarness(compact) {
  const driftClient =
    source
      .match(
        / {2}function invalidateDriftRequest\(\)\{[\s\S]*?\n {2}\}\n {2}function fileMatchesFilter/,
      )?.[0]
      .replace(/\n {2}function fileMatchesFilter$/, "") ?? "";
  assert.ok(driftClient, "drift request client should be extractable");

  const classList = (initial = []) => {
    const values = new Set(initial);
    return {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      toggle(name, force) {
        if (force) values.add(name);
        else values.delete(name);
      },
      contains: (name) => values.has(name),
    };
  };
  const document = { activeElement: null };
  const button = (file, active = false) => {
    const attributes = new Map([
      ["data-drift-file", file],
      ["data-drift-label", file],
      ["aria-pressed", active ? "true" : "false"],
    ]);
    return {
      classList: classList(active ? ["is-active"] : []),
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
      focus() {
        document.activeElement = this;
      },
    };
  };
  let compactMode = compact;
  const buttons = [button("A.sol", true), button("B.sol")];
  const preview = { innerHTML: "" };
  const label = { textContent: "" };
  const back = {
    focus() {
      document.activeElement = this;
    },
  };
  const drawer = {
    hidden: false,
    classList: classList(),
    getAttribute: (name) =>
      name === "data-drift-observation" ? "observation-1" : null,
  };
  const requests = [];
  const context = {
    AbortController,
    driftDrawer: drawer,
    driftRequestAbort: null,
    driftRequestToken: 0,
    driftLayoutMode: compact ? "unified" : "split",
    compactScreen: () => compactMode,
    document,
    encodeURIComponent,
    reviewPageUrl: (url) => url,
    reviewLazyText: (response) => response.html,
    reviewLazyMessage: () => "failed",
    reviewLazyAction: () => "",
    hideDrawerRoot: (root) => {
      root.hidden = true;
    },
    setDriftExpanded: () => {},
    fetch: (url, options) =>
      new Promise((resolve, reject) =>
        requests.push({ url, options, resolve, reject }),
      ),
    $: (selector) => {
      if (selector === "[data-drift-preview]") return preview;
      if (selector === "[data-drift-selected-path]") return label;
      if (selector === "[data-drift-back]") return back;
      if (selector === ".ds-drift-file.is-active")
        return (
          buttons.find((item) => item.classList.contains("is-active")) ?? null
        );
      return null;
    },
    $all: (selector) => (selector === "[data-drift-file]" ? buttons : []),
  };
  vm.runInNewContext(
    `${driftClient}\nthis.loadDriftFile=loadDriftFile;this.closeDriftDrawer=closeDriftDrawer;this.showDriftList=showDriftList;this.syncDriftLayout=syncDriftLayout;`,
    context,
  );
  return {
    ...context,
    buttons,
    preview,
    label,
    back,
    drawer,
    requests,
    setCompact(value) {
      compactMode = value;
    },
  };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test("desktop story stages reclaim redundant side-navigation gutters", () => {
  assert.match(
    source,
    // The stage fills the frame it sits in; body's padding is the only gutter,
    // so an inset here would just misalign it against the chrome above.
    /#ds-view-tour>:not\(\.ds-dock\):not\(\.ds-filmthread\):not\(\[hidden\]\)\{[^}]*width:100%;max-width:none;margin:0/,
  );
  assert.doesNotMatch(source, /ds-step-ghost|ds-ghost-prev|ds-ghost-next/);
});

test("concept steps use a plain full-stage canvas instead of an inner card", () => {
  assert.match(
    source,
    /\.ds-concept-scroll\{[^}]*flex:1;min-height:0;display:flex;[^}]*overflow-y:auto/,
  );
  assert.match(
    source,
    /\.ds-concept-document\{[^}]*flex:1;width:100%;min-height:100%;margin:0[^}]*border:0;border-radius:0;background:transparent;box-shadow:none/,
  );
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-document\{[^}]*width:100%/,
  );
  assert.doesNotMatch(
    source,
    /\.ds-step\[data-scene-layout="concept-(?:document|diagram)"\] \.ds-concept-document\{[^}]*width:min\(100%,/,
  );
  assert.doesNotMatch(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-document\{[^}]*(?:border-color|box-shadow):/,
  );
  assert.doesNotMatch(source, /ds-concept-next|Next in code/);
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-document\{[^}]*grid-template-columns:fit-content\(720px\) minmax\(0,1fr\);grid-template-rows:minmax\(0,1fr\);grid-template-areas:"copy diagram";align-items:center[^}]*height:100%;min-height:100%/,
  );
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-copy\{grid-area:copy;align-self:center;min-width:360px\}/,
  );
  // A landscape diagram's frame takes its height from the drawing's aspect
  // ratio, so a wide diagram is not letterboxed inside a tall empty box.
  assert.match(
    source,
    /\.ds-concept-diagram\[data-render-state="ready"\]:not\(\.is-portrait\):not\(\.is-fullscreen-active\) \.ds-concept-diagram-output\{flex:0 1 auto;height:min\(calc\(\(100cqw - 48px\) \/ var\(--ds-diagram-aspect,1\.6\) \+ 48px\),calc\(var\(--ds-diagram-height,9999px\) \* 1\.25 \+ 48px\)\)/,
  );
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-diagram\{[^}]*align-self:stretch;display:flex[^}]*min-height:0[^}]*flex-direction:column/,
  );
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-diagram-output svg\{width:100%;height:100%;max-width:none!important;max-height:100%\}/,
  );
  assert.match(
    source,
    /\.ds-concept-diagram\.is-portrait:not\(\.is-fullscreen-active\) \.ds-concept-diagram-output\{[^}]*overflow:auto;scrollbar-gutter:stable/,
  );
  assert.match(
    source,
    /\.ds-concept-diagram\.is-portrait:not\(\.is-fullscreen-active\) \.ds-concept-diagram-output>svg\{flex:none;width:min\(76%,680px\);height:auto;max-height:none;margin-inline:auto\}/,
  );
  assert.match(
    source,
    /@media \(max-width:980px\)\{[\s\S]*?\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-document\{[^}]*height:auto;min-height:100%[\s\S]*?\.ds-concept-diagram-output\{[^}]*height:min\(58vh,520px\);min-height:300px;overflow:hidden[\s\S]*?\.ds-concept-diagram-output svg\{width:100%;height:100%;max-width:none!important;max-height:100%\}/,
  );
  assert.match(
    source,
    /@media \(max-width:620px\)\{[\s\S]*?\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-diagram-output\{height:min\(52vh,420px\);min-height:240px/,
  );
  assert.match(source, /\.ds-concept-diagram\.is-portrait:not\(\.is-fullscreen-active\) \.ds-concept-diagram-output>svg\{width:360px;min-width:360px\}/);
  assert.doesNotMatch(source, /grid-template-areas:"heading diagram"/);
});

test("spacious concept scenes fit their content typography to real stage capacity", () => {
  assert.match(
    source,
    /\.ds-concept-title\{[^}]*font-size:var\(--ds-concept-title-size,1.875rem\)/,
  );
  assert.match(
    source,
    /\.ds-step\[data-scene-layout="concept-diagram"\] \.ds-concept-body\{[^}]*font-size:var\(--ds-concept-body-size,0.875rem\)/,
  );
  assert.match(source, /function fitConceptTypography\(panel\)/);
  assert.match(source, /targetHeight=availableHeight\*\.92/);
  assert.match(source, /targetHeight-baseHeight<Math\.max\(40,targetHeight\*\.06\)/);
  assert.match(source, /for\(var pass=0;pass<7;pass\+\+\)/);
  assert.match(source, /window\.innerWidth<=980/);
  assert.match(source, /new ResizeObserver\(function\(\)\{scheduleConceptTypographyFit/);
  assert.match(source, /watchConceptTypographyFit\(stepPanels\[i\]\)/);
  assert.match(source, /scheduleConceptTypographyFit\(stepPanels&&stepPanels\[active\]\)/);
});

test("the reading dock keeps its active sentence and step numerals comfortably legible", () => {
  assert.match(
    source,
    /\.ds-beatdock-note\{[^}]*font-size:var\(--text-lg\)[^}]*line-height:1\.45/,
  );
  assert.match(source, /\.ds-beatdock-count b\{[^}]*font-size:var\(--text-base\)/);
  assert.match(
    source,
    /\.ds-filmnode-num\{[^}]*width:36px[^}]*height:36px[^}]*font-size:var\(--text-xl\)/,
  );
  assert.match(source, /\.ds-dock-transport\{[^}]*min-height:66px/);
});

test("a code step draws exactly one frame around the diff", () => {
  // DIFF_CSS is part of the review stylesheet now.
  const diffSource = reviewCss;
  // The island keeps its border; the card inside it gives one up, so the two
  // concentric rounded frames collapse into one.
  assert.match(
    source,
    /#ds-view-tour>:not\(\.ds-dock\):not\(\.ds-filmthread\):not\(\[hidden\]\)\{[^}]*border:1px solid var\(--line-soft\)/,
  );
  assert.match(
    diffSource,
    /\.ds-step\.is-code-step \.ds-diff\{border:0;border-radius:0;box-shadow:none\}/,
  );
  // Nothing may reintroduce a ring on the card either — the one frame is the island's.
  assert.doesNotMatch(
    diffSource,
    /\.ds-step\.is-(story|voice)-active[^{]*\.ds-diff\{/,
  );
  // The one frame stays neutral in every state. Reading-here and speaking-now tint
  // the focus rows and the dock; a coloured edge on a window-wide island is noise.
  assert.doesNotMatch(
    source,
    /#ds-view-tour>\.ds-step\.is-(story|voice)-active[^{]*\{[^}]*(border-color|box-shadow):/,
  );
  // Full-bleed: no side gutter between the island edge and the code.
  assert.match(
    source,
    /\.ds-step\.is-code-step>\.ds-diffscroll\{[^}]*padding:0;--ds-scrollpad-t:0px/,
  );
  assert.doesNotMatch(
    source,
    /\.ds-step\.is-code-step>\.ds-diffscroll\{[^}]*padding:\d+px [1-9]/,
  );
});

test("compact review surfaces are width-contained while code and film navigation stay usable", () => {
  assert.match(source, /html,body\{[^}]*width:100%;max-width:100%/);
  assert.match(source, /\.ds-layout\{[^}]*min-width:0/);
  assert.match(source, /\.ds-reviewchrome\{height:56px;width:100%;min-width:0/);
  assert.match(
    source,
    /\.ds-reviewchrome-main\{[^}]*width:100%;min-width:0;max-width:100%/,
  );
  assert.match(
    source,
    /\.ds-reviewchrome-island>\.ds-reviewchrome-rail\{display:none;position:fixed/,
    "the compact rail must outrank the shared positioned-child rule instead of pushing header utilities off canvas",
  );
  // The thread is a row inside the dock island now, so the island is what has to
  // stay inside the viewport; the thread only has to refuse to push it wider.
  assert.match(source, /\.ds-dock\{[^}]*width:100%;min-width:0;max-width:100%/);
  assert.match(source, /\.ds-filmthread\{[^}]*min-width:0/);
  // Phone drops body's gutter, so the islands go edge to edge. They have to give
  // up their radius with it — a 16px corner riding the screen edge reads as a
  // rendering fault — and none of them may re-add a width inset of its own.
  assert.match(source, /body\{padding:0;gap:0\}/);
  assert.match(
    source,
    /body :is\(#ds-view-tour>:not\(\.ds-dock\):not\(\.ds-filmthread\):not\(\[hidden\]\),\.ds-dock,\.ds-filmthread\.is-storyless\)\{border-radius:0\}/,
  );
  assert.doesNotMatch(source, /calc\(100% - 16px\)/);
  assert.match(source, /\.ds-filmthread-allfiles\{height:44px;padding:0 9px\}/);
  assert.match(source, /\.ds-filmthread\.is-overview\{display:none\}/);
  assert.doesNotMatch(source, /\.ds-stage-num|\.ds-step-pos/);
});

test("queued comments use stable file groups without lifecycle filters", () => {
  assert.match(
    source,
    /\.ds-feedback-list\{display:grid;grid-template-columns:minmax\(0,1fr\)/,
  );
  assert.match(source, /\.ds-feedback-group\{display:grid;gap:8px\}/);
  assert.match(
    source,
    /\.ds-feedback-group-head\{display:flex;align-items:center;justify-content:space-between/,
  );
  assert.doesNotMatch(
    source,
    /ds-feedback-filters|filterFeedback|activeFeedbackFilter/,
  );
});

test("mobile story drift switches from the file list to one lazy detail and back", () => {
  assert.match(
    source,
    /\.ds-drawer-root\.is-detail \.ds-drift-list\{display:none\}/,
  );
  assert.match(
    source,
    /\.ds-drawer-root\.is-detail \.ds-drift-detail\{display:flex\}/,
  );
  assert.match(source, /driftDrawer\.classList\.add\('is-detail'\)/);
  assert.match(source, /driftDrawer\.classList\.remove\('is-detail'\)/);
  assert.doesNotMatch(
    source,
    /\.ds-drift-drawer\.is-detail \.ds-drift-(?:list|detail)/,
  );
  const open = source.match(/function openDriftDrawer\(\)\{[^\n]+/)?.[0] ?? "";
  assert.match(open, /classList\.remove\('is-detail'\)/);
  assert.doesNotMatch(
    open,
    /loadDriftFile/,
    "opening the list must not eagerly request the first patch",
  );
});

test("rapid since-story selections cannot paint an older file under the active label", async () => {
  const harness = driftHarness(true);

  harness.loadDriftFile(harness.buttons[0]);
  assert.equal(
    harness.requests.length,
    1,
    "a normal selection makes one lazy request",
  );
  assert.match(harness.requests[0].url, /[?&]layout=unified(?:&|$)/);

  harness.loadDriftFile(harness.buttons[1]);
  assert.equal(harness.requests.length, 2);
  assert.equal(
    harness.requests[0].options.signal.aborted,
    true,
    "selecting B aborts A",
  );

  harness.requests[1].resolve({ html: "<p>patch B</p>" });
  await flushPromises();
  assert.equal(harness.label.textContent, "B.sol");
  assert.equal(harness.preview.innerHTML, "<p>patch B</p>");

  harness.requests[0].resolve({ html: "<p>patch A arrived late</p>" });
  await flushPromises();
  assert.equal(harness.label.textContent, "B.sol");
  assert.equal(
    harness.preview.innerHTML,
    "<p>patch B</p>",
    "A cannot overwrite B after resolving late",
  );

  harness.loadDriftFile(harness.buttons[1]);
  assert.equal(
    harness.requests.length,
    2,
    "the active layout reuses its cached response",
  );
});

test("since-story close and back invalidate work while desktop requests split layout", async () => {
  const harness = driftHarness(false);
  harness.loadDriftFile(harness.buttons[0]);
  assert.match(harness.requests[0].url, /[?&]layout=split(?:&|$)/);

  harness.closeDriftDrawer();
  assert.equal(harness.requests[0].options.signal.aborted, true);
  harness.requests[0].resolve({ html: "<p>closed patch</p>" });
  await flushPromises();
  assert.notEqual(harness.preview.innerHTML, "<p>closed patch</p>");

  assert.match(
    source,
    /\[data-drift-back\]'\);if\(b&&driftDrawer\)\{showDriftList\(\)/,
  );
  assert.match(
    source,
    /requestToken!==driftRequestToken\|\|\$\('\.ds-drift-file\.is-active',driftDrawer\)!==button/,
  );
  assert.match(source, /button\._dsDriftLayout===layout/);
});

test("since-story resize swaps renderers and focus follows the visible mobile surface", async () => {
  const harness = driftHarness(true);
  harness.loadDriftFile(harness.buttons[0]);
  assert.equal(
    harness.document.activeElement,
    harness.back,
    "mobile detail moves focus out of the hidden list",
  );
  assert.match(harness.requests[0].url, /[?&]layout=unified(?:&|$)/);

  harness.setCompact(false);
  harness.syncDriftLayout();
  assert.equal(
    harness.requests[0].options.signal.aborted,
    true,
    "crossing the breakpoint invalidates the old renderer",
  );
  assert.equal(harness.requests.length, 2);
  assert.match(harness.requests[1].url, /[?&]layout=split(?:&|$)/);
  assert.equal(
    harness.document.activeElement,
    harness.buttons[0],
    "desktop focus returns to the now-visible file row",
  );

  harness.requests[1].resolve({ html: "<p>desktop split</p>" });
  await flushPromises();
  assert.equal(harness.preview.innerHTML, "<p>desktop split</p>");

  harness.setCompact(true);
  harness.syncDriftLayout();
  assert.equal(harness.requests.length, 3);
  assert.match(harness.requests[2].url, /[?&]layout=unified(?:&|$)/);
  assert.equal(harness.document.activeElement, harness.back);
  harness.showDriftList();
  assert.equal(
    harness.document.activeElement,
    harness.buttons[0],
    "Back returns focus to the selected visible row",
  );
  assert.equal(harness.drawer.classList.contains("is-detail"), false);
});

test("review dialogs and the inline composer expose complete focus and radio semantics", () => {
  assert.match(source, /var firstCommand=\$\('\[data-command\]',commandRoot\)/);
  assert.match(source, /if\(firstCommand\)firstCommand\.focus\(\)/);
  assert.match(source, /function syncComposerRadioGroup\(group,selected\)/);
  assert.match(source, /choice\.tabIndex=active\?0:-1/);
  assert.match(
    source,
    /tabs\.addEventListener\('keydown',(function\(e\)\{moveComposerRadio\(tabs,'\.ds-composer-tab',e\);\}|\(e\)=> \{moveComposerRadio\(tabs,'\.ds-composer-tab',e\);\})\)/,
  );
  assert.match(source, /box\.setAttribute\('role','region'\)/);
  assert.match(source, /row\.parentNode\.insertBefore\(box,row\.nextSibling\)/);
  assert.doesNotMatch(source, /activateModal\(box,composerReturnFocus\)/);
  assert.doesNotMatch(source, /severity\.addEventListener/);
  assert.match(source, /ta\.setAttribute\('aria-label','Review comment'\)/);
  assert.match(
    source,
    /ta\.setAttribute\('aria-label','Edit review comment'\)/,
  );
  assert.doesNotMatch(source, /Reply to '\+BRAND|data-thread-ta/);
  assert.doesNotMatch(source, /ds-playstep/);
});

test("cover support stays visually quiet beside the compact walkthrough action", () => {
  const freshnessRule =
    source.match(/\.ds-intro-freshness\{([^}]*)\}/)?.[1] ?? "";
  const notesSummaryRule =
    source.match(/\.ds-intro-notes>summary\{([^}]*)\}/)?.[1] ?? "";
  assert.match(freshnessRule, /display:flex/);
  assert.doesNotMatch(freshnessRule, /border:|background:/);
  assert.match(notesSummaryRule, /display:inline-flex/);
  assert.match(notesSummaryRule, /color:var\(--muted\)/);
  assert.doesNotMatch(notesSummaryRule, /border:|background:/);
  assert.doesNotMatch(
    source,
    /\.ds-freshness-callout|\.ds-intro-disclosure|\.ds-intro-meta/,
  );
  assert.match(source, /\.ds-intro-start\{[^}]*background:var\(--accent\)/);
  assert.match(
    source,
    /\.ds-intro-actions \.ds-intro-start\{[^}]*display:inline-flex/,
  );
  const startRules = [
    ...source.matchAll(/\.ds-intro-actions \.ds-intro-start\{([^}]*)\}/g),
  ].map((match) => match[1]);
  assert.equal(
    startRules.some((rule) => /(?:^|;)width:100%(?:;|$)/.test(rule)),
    false,
  );
});

test("split columns clamp their rows to the column width", () => {
  // Each column is a grid; an auto column track grows to the widest unwrapped
  // line, so Before rows spill under the gutter and into After.
  assert.match(
    reviewCss,
    /\.ds-col\{[^}]*grid-template-columns:minmax\(0,1fr\)/,
  );
});
