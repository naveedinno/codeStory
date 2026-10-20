// Unit tests for the shared diff-row renderer. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const DIFF_CSS = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
import { renderUnifiedRow, renderSplitRow, renderSplitHalves, renderSplitGapHalves, SplitColumns, renderHunkGap, rowAttrs, targetAttrs, untouredRuns, wholeUntoured, plainRows } from '../dist/diff-render.js';
import { renderSplitHunks } from '../dist/render.js';

/** Exercise the split header through its only public entry point. */
function renderHeadForTest(opts) {
  return renderSplitHunks([[{ type: 'ctx', content: 'x', oldNo: 1, newNo: 1 }]], {
    ...opts,
    hunkRanges: [[1, 1]],
    canExpand: false,
  });
}

function cssRuleBody(css, selector) {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `missing ${selector} rule`);
  const bodyStart = start + selector.length + 1;
  return css.slice(bodyStart, css.indexOf('}', bodyStart));
}

test('unified add row carries anchors, sign, and tint class', () => {
  const html = renderUnifiedRow(
    { type: 'add', no: 3, content: 'const x = 1;' },
    { side: 'right', file: 'a.ts', line: 3 },
  );
  assert.match(html, /^<div class="ds-urow ds-row-add" data-file="a\.ts" data-line="3" data-side="right"/);
  assert.match(html, /data-review-row role="group" tabindex="-1"/);
  assert.match(html, /aria-label="Added after line 3 in a\.ts: const x = 1;"/);
  assert.match(html, /<span class="ds-no">3<\/span>/);
  assert.match(html, /<span class="ds-sign ds-sign-add">\+<\/span>/);
  assert.match(html, /data-comment-file="a\.ts" data-comment-line="3"/);
  assert.match(html, /data-vscode-symbol data-vscode-column="7"[^>]*>x<\/span>/);
});

test('unified untoured row is flagged UNEXPLAINED', () => {
  const html = renderUnifiedRow({ type: 'add', no: 1, content: 'x', untoured: true });
  assert.match(html, /is-untoured/);
  assert.match(html, /UNEXPLAINED/);
});

test('unified del row carries the minus sign and an old-side anchor', () => {
  const html = renderUnifiedRow(
    { type: 'del', no: 7, content: 'gone();' },
    { side: 'left', file: 'a.ts', line: 7 },
  );
  assert.match(html, /^<div class="ds-urow ds-row-del" data-file="a\.ts" data-line="7" data-side="left"/);
  assert.match(html, /aria-label="Deleted before line 7 in a\.ts: gone\(\);"/);
  assert.match(html, /<span class="ds-sign ds-sign-del">−<\/span>/);
  assert.match(html, /data-comment-side="left" data-comment-file="a\.ts" data-comment-line="7"/);
  assert.doesNotMatch(html, /data-vscode-symbol/);
});

test('split ctx row renders one half per column, each describing its own side', () => {
  const { left, right } = renderSplitHalves(
    { type: 'ctx', oldNo: 4, newNo: 5, content: 'same' },
    {
      ri: 7,
      leftTarget: { side: 'left', file: 'a.ts', line: 4 },
      rightTarget: { side: 'right', file: 'a.ts', line: 5 },
    },
  );
  assert.match(left, /^<div class="ds-row ds-row-ctx" data-ri="7" data-file="a\.ts" data-line="4" data-side="left"/);
  assert.match(left, /aria-label="Context before line 4 in a\.ts: same"/);
  assert.match(left, /ds-cell-l/);
  assert.doesNotMatch(left, /ds-cell-r|ds-celldiv/);
  assert.match(right, /^<div class="ds-row ds-row-ctx" data-ri="7" data-file="a\.ts" data-line="5" data-side="right"/);
  assert.match(right, /aria-label="Context after line 5 in a\.ts: same"/);
  assert.match(right, /ds-cell-r/);
  assert.doesNotMatch(right, /ds-cell-l|ds-celldiv/);
});

test('split add row has no left half at all — the columns flow independently', () => {
  const { left, right } = renderSplitHalves(
    { type: 'add', newNo: 9, content: 'added' },
    { rightTarget: { side: 'right', file: 'b.ts', line: 9 } },
  );
  assert.equal(left, '');
  assert.match(right, /^<div class="ds-row ds-row-add"/);
  assert.match(right, /ds-cell-add/);
  assert.doesNotMatch(right, /ds-cell-empty/);
});

test('split del row has no right half', () => {
  const { left, right } = renderSplitHalves(
    { type: 'del', oldNo: 9, content: 'gone' },
    { leftTarget: { side: 'left', file: 'b.ts', line: 9 } },
  );
  assert.equal(right, '');
  assert.match(left, /^<div class="ds-row ds-row-del"/);
  assert.match(left, /ds-cell-del/);
});

test('two-cell rows are refused from the single-cell renderer', () => {
  assert.throws(() => renderSplitRow({ type: 'ctx', oldNo: 1, newNo: 1, content: 'x' }), /SplitColumns/);
});

test('SplitColumns numbers logical rows once across both columns and emits the divider', () => {
  const cols = new SplitColumns();
  cols.row({ type: 'ctx', oldNo: 1, newNo: 1, content: 'a' });
  cols.row({ type: 'add', newNo: 2, content: 'b' });
  cols.row({ type: 'del', oldNo: 2, content: 'c' });
  cols.gap();
  cols.right('<div class="ds-scoperow"><code>fn</code></div>');
  const html = cols.html();
  assert.equal(cols.count, 4);
  assert.match(html, /^<div class="ds-diffbody ds-diffbody-cols"><div class="ds-col ds-col-l">/);
  assert.match(html, /<span class="ds-celldiv" aria-hidden="true"><svg class="ds-bands" aria-hidden="true" focusable="false"><\/svg><\/span><div class="ds-col ds-col-r">/);
  const leftCol = html.slice(html.indexOf('ds-col-l'), html.indexOf('ds-celldiv'));
  const rightCol = html.slice(html.indexOf('ds-col-r'));
  assert.deepEqual([...leftCol.matchAll(/data-ri="(\d+)"/g)].map((m) => m[1]), ['0', '2', '3']);
  assert.deepEqual([...rightCol.matchAll(/data-ri="(\d+)"/g)].map((m) => m[1]), ['0', '1', '3']);
  assert.match(rightCol, /ds-scoperow/);
  assert.doesNotMatch(leftCol, /ds-scoperow/);
  assert.doesNotMatch(html, /ds-cell-empty/);
  const sides = cols.sides();
  assert.match(sides.left, /^<div class="ds-row ds-row-ctx" data-ri="0"/);
  assert.match(sides.right, /^<div class="ds-row ds-row-ctx" data-ri="0"/);
  assert.doesNotMatch(sides.left + sides.right, /ds-col|ds-celldiv/);
});

test('single-cell mode (context/new-file steps) renders one cell', () => {
  const html = renderSplitRow(
    { type: 'add', newNo: 1, content: 'new' },
    { rightTarget: { side: 'right', file: 'c.ts', line: 1 }, single: true },
  );
  assert.match(html, /ds-cell-single/);
  assert.doesNotMatch(html, /ds-celldiv/);
});

test('focus index is emitted on both halves only when set', () => {
  const withFocus = renderSplitHalves({ type: 'ctx', oldNo: 1, newNo: 1, content: 'x' }, { focusIndex: 2 });
  const without = renderSplitHalves({ type: 'ctx', oldNo: 1, newNo: 1, content: 'x' }, { focusIndex: null });
  assert.match(withFocus.left, /data-step-focus="2"/);
  assert.match(withFocus.right, /data-step-focus="2"/);
  assert.doesNotMatch(without.left + without.right, /data-step-focus/);
});

test('split rows emit only authored semantic move endpoint tokens', () => {
  const withMove = renderSplitHalves(
    { type: 'ctx', oldNo: 4, newNo: 5, content: 'same' },
    { moveTokens: ['guard:before', 'guard:after'] },
  );
  const withoutMove = renderSplitHalves({ type: 'ctx', oldNo: 4, newNo: 5, content: 'same' });
  assert.match(withMove.left, /data-move="guard:before guard:after"/);
  assert.match(withMove.right, /data-move="guard:before guard:after"/);
  assert.doesNotMatch(withoutMove.left + withoutMove.right, /data-move=/);
});

test('semantic diff text uses dedicated accessible ink tokens in every diff mode', () => {
  assert.match(cssRuleBody(DIFF_CSS, '.ds-diffhead-label.ds-green'), /color:var\(--diff-add-text\)/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-sign-add'), /color:var\(--diff-add-text\)/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-sign-del'), /color:var\(--diff-del-text\)/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-code-add'), /color:var\(--diff-add-text\)/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-code-del'), /color:var\(--diff-del-text\)/);
});

test('story focus keeps every code row readable without partial-edge rails', () => {
  assert.doesNotMatch(DIFF_CSS, /\.ds-step\.is-code-step\.is-story-active[^{]*\{[^}]*opacity:/);

  const splitFocus = cssRuleBody(DIFF_CSS, '.ds-row.is-story-focus');
  assert.match(splitFocus, /box-shadow:none/);
  assert.doesNotMatch(splitFocus, /inset [1-9][^;]* 0 0/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-row.is-story-focus .ds-cell:not(.ds-cell-empty)'), /background-image:none/);

  const unifiedFocus = cssRuleBody(DIFF_CSS, '.ds-urow.is-story-focus');
  assert.match(unifiedFocus, /box-shadow:none/);
  assert.doesNotMatch(unifiedFocus, /inset [1-9][^;]* 0 0/);
  assert.match(unifiedFocus, /background-image:none/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-row.is-story-focus .ds-no'), /background:var\(--accent-soft\)/, 'focus stays in the gutter without washing out changed words');
});

test('split placeholders stay visually empty while reading focus remains quiet', () => {
  const emptyCell = cssRuleBody(DIFF_CSS, '.ds-cell-empty');
  assert.match(emptyCell, /repeating-linear-gradient/);
  assert.match(emptyCell, /var\(--line\)/);

  assert.doesNotMatch(DIFF_CSS, /\.ds-(?:u?row)\.is-voice-focus::before/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-row.is-voice-focus'), /box-shadow:none/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-urow.is-voice-focus'), /box-shadow:none/);
});

test('review status cues avoid cropped one-edge borders', () => {
  assert.match(cssRuleBody(DIFF_CSS, '.ds-cell-untoured'), /inset 0 0 0 1px/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-urow.is-untoured'), /inset 0 0 0 1px/);
  assert.doesNotMatch(cssRuleBody(DIFF_CSS, '.ds-urow.is-untoured'), /border-left/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-row.is-change-jump,.ds-urow.is-change-jump'), /inset 0 0 0 1px/);
});

test('bare hunk gap names the skipped content without decorative dots', () => {
  assert.equal(renderHunkGap(), '<div class="ds-hunkgap"><span class="ds-gaplabel">Skipped lines</span></div>');
});

test('split hunk gap is two halves: the right one canonical with every control, the left an inert mirror', () => {
  const { left, right } = renderSplitGapHalves({ file: 'a.ts', from: 10, to: 30 }, {}, 4);
  assert.match(right, /^<div class="ds-hunkgap is-expandable ds-hunkgap-side ds-hunkgap-r" data-ri="4" data-gap data-gap-file="a\.ts" data-gap-from="10" data-gap-to="30" data-gap-chunk="5">/);
  assert.match(right, /<button type="button" class="ds-gapbtn" data-expand="all"[^>]*aria-label="Show all hidden lines"[^>]*>Show all</);
  assert.match(right, /aria-label="Show 5 lines above"[^>]*>↑ 5 lines</);
  assert.match(right, /data-expand="down"[^]*data-expand="all"[^]*data-expand="up"/, 'same order as the unified gap');
  assert.equal(left, '<div class="ds-hunkgap is-expandable ds-hunkgap-side ds-hunkgap-l" data-ri="4" data-gap-mirror></div>');
  assert.doesNotMatch(left + right, /⋯|ds-gapdots|ds-gap-mid|ds-gap-side/);
});

test('bare split hunk gap keeps both halves for pairing and carries no expand data', () => {
  const { left, right } = renderSplitGapHalves(undefined, {}, 2);
  assert.equal(left, '<div class="ds-hunkgap ds-hunkgap-side ds-hunkgap-l" data-ri="2" data-gap-mirror><span class="ds-gaplabel">Skipped lines</span></div>');
  assert.equal(right, '<div class="ds-hunkgap ds-hunkgap-side ds-hunkgap-r" data-ri="2"><span class="ds-gaplabel">Skipped lines</span></div>');
  assert.doesNotMatch(left + right, /data-gap[ =]|⋯/);
});

test('split viewport edge exposes only the adjacent five-line direction', () => {
  const before = renderSplitGapHalves({ file: 'a.ts', from: 1, to: 30 }, { edge: 'before' });
  assert.match(before.right, /data-expand="up"/);
  assert.doesNotMatch(before.left + before.right, /data-expand="down"/);

  const after = renderSplitGapHalves({ file: 'a.ts', from: 50, to: 'eof' }, { edge: 'after' });
  assert.match(after.right, /data-expand="down"/);
  assert.doesNotMatch(after.left, /data-expand/, 'the controls never switch columns');
  assert.doesNotMatch(after.left + after.right, /data-expand="up"/);
});

test('attrs helpers escape file paths', () => {
  assert.match(rowAttrs({ side: 'right', file: 'a"b.ts', line: 1 }), /data-file="a&quot;b\.ts"/);
  assert.match(targetAttrs({ side: 'left', file: '<x>.ts', line: 2 }), /data-comment-file="&lt;x&gt;\.ts"/);
});

test('review-row accessible names escape code and file content', () => {
  const html = renderUnifiedRow(
    { type: 'add', no: 1, content: 'if (a < b) return "yes";' },
    { side: 'right', file: 'src/a&b.ts', line: 1 },
  );
  assert.match(html, /aria-label="Added after line 1 in src\/a&amp;b\.ts: if \(a &lt; b\) return &quot;yes&quot;;"/);
});

test('interactive hunk gap carries range data and expand buttons', () => {
  const html = renderHunkGap({ file: 'a.ts', from: 10, to: 30 });
  assert.match(html, /data-gap /);
  assert.match(html, /data-gap-file="a\.ts"/);
  assert.match(html, /data-gap-from="10"/);
  assert.match(html, /data-gap-to="30"/);
  assert.match(html, /data-expand="down"/);
  assert.match(html, /data-expand="all"/);
  assert.match(html, /data-expand="up"/);
  assert.match(html, /data-gap-chunk="20"/);
  assert.match(html, /aria-label="Show 20 lines below"/);
  assert.match(html, /aria-label="Show all hidden lines"/);
  assert.match(html, /aria-label="Show 20 lines above"/);
  assert.match(html, /aria-label="Show all hidden lines"[^>]*>Show all</);
  assert.doesNotMatch(html, /⋯|ds-gapdots/);
});

test('eof gap omits the up button', () => {
  const html = renderHunkGap({ file: 'a.ts', from: 50, to: 'eof' });
  assert.match(html, /data-gap-to="eof"/);
  assert.doesNotMatch(html, /data-expand="up"/);
});

test('split head omits duplicate paths for a plain modification', () => {
  const html = renderHeadForTest({ file: 'a/b.sol', oldFile: 'a/b.sol', newFile: false });
  assert.match(html, /Before/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /ds-diffhead-path/);
});

test('split head keeps both paths for a rename', () => {
  const html = renderHeadForTest({ file: 'a/new.sol', oldFile: 'a/old.sol', newFile: false });
  assert.match(html, /ds-diffhead-path">a\/old\.sol/);
  assert.match(html, /ds-diffhead-path">a\/new\.sol/);
});

test('a new file renders as one column with a new-file head, not an empty pane', () => {
  const html = renderSplitHunks([[{ type: 'add', content: 'x', newNo: 1 }, { type: 'add', content: 'y', newNo: 2 }]], {
    file: 'a/new.sol', newFile: true, hunkRanges: [[1, 2]], canExpand: false, scopes: ['contract A'],
  });
  assert.match(html, /^<div class="ds-diffhead ds-diffhead-ctx">/);
  assert.match(html, /ds-diffhead-label ds-green">New file<\/span><span class="ds-diffhead-path">a\/new\.sol/);
  assert.doesNotMatch(html, /Did not exist|ds-col-|ds-celldiv|Before/);
  assert.match(html, /<div class="ds-diffbody"><div class="ds-scoperow">/);
  assert.equal((html.match(/ds-cell-single/g) || []).length, 2);
});

test('a file the story never visits renders plain rows: the flag belongs on the file', () => {
  const rows = [
    { type: 'add', content: 'a', newNo: 1, untoured: true },
    { type: 'ctx', content: 'b', oldNo: 1, newNo: 2 },
    { type: 'add', content: 'c', newNo: 3, untoured: true },
  ];
  assert.equal(wholeUntoured(rows), true);
  assert.equal(wholeUntoured([...rows, { type: 'add', content: 'd', newNo: 4 }]), false);
  assert.equal(wholeUntoured([{ type: 'ctx', content: 'x', oldNo: 1, newNo: 1 }]), false);
  assert.deepEqual(plainRows(rows).map((r) => !!r.untoured), [false, false, false]);
  const html = renderSplitHunks([rows], { file: 'a.ts', newFile: false, hunkRanges: [[1, 3]], canExpand: false });
  assert.doesNotMatch(html, /ds-untoured-tag|ds-cell-untoured/);
  assert.equal((html.match(/ds-cell-add/g) || []).length, 2);
  // A partially covered file keeps its per-run tags.
  const mixed = renderSplitHunks([[...rows, { type: 'add', content: 'd', newNo: 4 }]], { file: 'a.ts', newFile: false, hunkRanges: [[1, 4]], canExpand: false });
  assert.equal((mixed.match(/ds-untoured-tag/g) || []).length, 2);
});

test('unified rows collapse unexplained runs the same way', () => {
  const runs = untouredRuns([
    { type: 'add', no: 1, content: 'a', untoured: true },
    { type: 'add', no: 2, content: 'b', untoured: true },
  ]);
  assert.deepEqual([...runs.values()], [2]);
  assert.match(renderUnifiedRow({ type: 'add', no: 1, content: 'a', untoured: true }, undefined, undefined, 2), /UNEXPLAINED ×2/);
  assert.doesNotMatch(renderUnifiedRow({ type: 'add', no: 2, content: 'b', untoured: true }, undefined, undefined, null), /ds-untoured-tag/);
  assert.match(renderUnifiedRow({ type: 'add', no: 2, content: 'b', untoured: true }, undefined, undefined, null), /is-untoured/);
});

test('consecutive unexplained rows carry one tag with the run length', () => {
  const rows = [
    { type: 'add', content: 'a', newNo: 1, untoured: true },
    { type: 'add', content: 'b', newNo: 2, untoured: true },
    { type: 'add', content: 'c', newNo: 3, untoured: true },
    { type: 'ctx', content: 'd', oldNo: 1, newNo: 4 },
    { type: 'add', content: 'e', newNo: 5, untoured: true },
    { type: 'add', content: 'f', newNo: 6 },
  ];
  const runs = untouredRuns(rows);
  assert.deepEqual([...runs.values()], [3, 1]);
  assert.ok(runs.has(rows[0]) && runs.has(rows[4]));
  const html = renderSplitHunks([rows], { file: 'a.ts', newFile: true, hunkRanges: [[1, 6]], canExpand: false });
  assert.equal((html.match(/ds-untoured-tag/g) || []).length, 2);
  assert.match(html, /title="3 unexplained lines">UNEXPLAINED ×3</);
  assert.match(html, /ds-untoured-tag">UNEXPLAINED<\/span>/);
  assert.equal((html.match(/ds-cell-untoured/g) || []).length, 4);
  const cols = new SplitColumns();
  const colRuns = untouredRuns(rows);
  rows.forEach((row) => cols.row(row, { rightTarget: { side: 'right', file: 'a.ts', line: row.newNo }, untouredTag: colRuns.get(row) ?? null }));
  assert.equal((cols.html().match(/ds-untoured-tag/g) || []).length, 2);
});

test('hunk gap buttons carry readable labels', () => {
  const { left, right } = renderSplitGapHalves({ file: 'a.ts', from: 10, to: 40 });
  assert.match(right, />↑ 5 lines</);
  assert.match(right, />↓ 5 lines</);
  assert.match(right, />Show all</);
  assert.doesNotMatch(left, /ds-gapbtn/);
});

test('a merged change pair renders as two halves with one navigation unit on the right', () => {
  const row = {
    type: 'ctx', changePair: true, paired: true,
    oldNo: 154, newNo: 158,
    content: 'new;', leftContent: 'old;', rightContent: 'new;', comment: true,
  };
  const { left, right } = renderSplitHalves(row, {
    leftTarget: { side: 'left', file: 'a.sol', line: 154 },
    rightTarget: { side: 'right', file: 'a.sol', line: 158 },
  });
  assert.match(right, /class="ds-row ds-row-ctx ds-row-pair"/);
  assert.match(left, /class="ds-row ds-row-ctx ds-row-pair-l"/);
  assert.doesNotMatch(left, /ds-row-pair"/);
  assert.match(left, /ds-cell-del ds-cell-paired/);
  assert.match(right, /ds-cell-add ds-cell-paired/);
  assert.match(right, /aria-label="Changed after line 158/);
  assert.match(left, /aria-label="Changed before line 154/);
  assert.match(left, /data-comment-side="left" [^>]*data-comment-line="154"/);
  assert.match(right, /data-comment-side="right" [^>]*data-comment-line="158"/);
  assert.match(left, /<span class="ds-no">154<\/span>/);
  assert.match(right, /<span class="ds-no">158<\/span>/);
});

test('a merged change pair can still carry the unexplained flag', () => {
  const row = {
    type: 'ctx', changePair: true, paired: true, untoured: true,
    oldNo: 3, newNo: 3,
    content: 'new;', leftContent: 'old;', rightContent: 'new;', comment: true,
  };
  const { right } = renderSplitHalves(row, {
    leftTarget: { side: 'left', file: 'a.sol', line: 3 },
    rightTarget: { side: 'right', file: 'a.sol', line: 3 },
  });
  assert.match(right, /UNEXPLAINED/);
});

test('split hunks head the AFTER column with a scope row when a label exists', () => {
  const block = [[{ type: 'ctx', content: 'x', oldNo: 5, newNo: 5 }]];
  const html = renderSplitHunks(block, {
    file: 'a.sol', oldFile: 'a.sol', newFile: false,
    hunkRanges: [[5, 5]], canExpand: false,
    scopes: ['function fillCloseRequest('],
  });
  const rightCol = html.slice(html.indexOf('ds-col-r'));
  assert.match(rightCol, /^ds-col-r"><div class="ds-scoperow"><code>function fillCloseRequest\(<\/code><\/div><div class="ds-row/);
  assert.doesNotMatch(html.slice(0, html.indexOf('ds-col-r')), /ds-scoperow/);
  assert.doesNotMatch(html, /ds-hunk"/);
});

test('a hunk without a scope label gets no scope row', () => {
  const block = [[{ type: 'ctx', content: 'x', oldNo: 5, newNo: 5 }]];
  const html = renderSplitHunks(block, {
    file: 'a.sol', oldFile: 'a.sol', newFile: false,
    hunkRanges: [[5, 5]], canExpand: false,
  });
  assert.match(html, /ds-diffbody-cols/);
  assert.doesNotMatch(html, /ds-scoperow/);
});

test('scope labels are escaped like any other untrusted source text', () => {
  const block = [[{ type: 'ctx', content: 'x', oldNo: 5, newNo: 5 }]];
  const html = renderSplitHunks(block, {
    file: 'a.sol', oldFile: 'a.sol', newFile: false,
    hunkRanges: [[5, 5]], canExpand: false,
    scopes: ['function f(a < b) "x"'],
  });
  assert.match(html, /<code>function f\(a &lt; b\) &quot;x&quot;<\/code>/);
});

test('the sticky scope row clears the split head it sits under', () => {
  assert.match(cssRuleBody(DIFF_CSS, '.ds-scoperow'), /position:sticky/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-scoperow'), /--ds-diffhead-h/);
  assert.match(cssRuleBody(DIFF_CSS, '.ds-diffhead'), /--ds-diffhead-h/);
});

test('gap buttons never wrap their label', () => {
  // The middle control is absolutely centered inside a zero-width slot, so any
  // multi-word label wraps unless this is pinned. "All" survived by being one
  // word; "Show all" did not.
  // Anchored to the standalone rule: cssRuleBody's indexOf would match inside
  // the earlier `.ds-gap-side-l>.ds-gapbtn{...}` descendant rule instead.
  assert.match(DIFF_CSS, /^\.ds-gapbtn\{[^}]*white-space:nowrap/m);
});
