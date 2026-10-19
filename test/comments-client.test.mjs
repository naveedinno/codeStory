// Browser contract for the queue-first review-comment system. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Formerly template strings in `src/page-assets.ts`; the review engine and its
// stylesheet are real client files now. Same text, same assertions.
const PAGE_JS = readFileSync(
  new URL("../client/surfaces/review/engine/review-engine.js", import.meta.url),
  "utf8",
);
const PAGE_CSS = readFileSync(
  new URL("../client/surfaces/review/review.css", import.meta.url),
  "utf8",
);

test("the generated browser client is valid JavaScript", () => {
  // It is an ES module now, so parse it as one. esbuild would also catch a
  // syntax error, but this fails in milliseconds instead of at build time.
  const body = PAGE_JS.slice(
    PAGE_JS.indexOf("export function startReviewEngine"),
  ).replace("export ", "");
  assert.doesNotThrow(() => new vm.Script(`(${body})`));
});

test("comment state is a canonical queue cache independent of lazy diff mounting", () => {
  assert.match(PAGE_JS, /function initialComments\(\)/);
  assert.match(PAGE_JS, /var allComments=initialComments\(\)/);
  assert.match(
    PAGE_JS,
    /function queuedComments\(\)\{return allComments\.filter/,
  );
  assert.match(PAGE_JS, /function mountCommentPins\(scope\)/);
  assert.match(PAGE_JS, /function syncCommentPins\(\)/);
  assert.match(PAGE_JS, /mountCommentPins\(fresh\)/);
  assert.match(PAGE_JS, /mountCommentPins\(panel\)/);
});

test("queued pins jump to Review → Comments and never open a conversation surface", () => {
  assert.match(PAGE_JS, /data-comment-launcher/);
  assert.match(PAGE_JS, /data-queued-comment-id/);
  assert.match(PAGE_JS, /function gotoQueuedComment\(id\)/);
  assert.match(PAGE_JS, /setReviewTab\('notes',false\)/);
  assert.doesNotMatch(
    PAGE_JS,
    /openCommentSurface|Review conversation|activeCommentSurface/,
  );
});

test("Go to code survives lazy loading and highlights the exact anchor row", () => {
  assert.match(PAGE_JS, /function commentRows\(c,scope\)/);
  assert.match(
    PAGE_JS,
    /!closest\(row,'\[hidden\]'\)&&row\.getClientRects\(\)\.length>0/,
  );
  assert.match(PAGE_JS, /return visible\|\|rows\[0\]\|\|null/);
  assert.match(PAGE_JS, /function gotoComment\(id\)/);
  assert.match(PAGE_JS, /function focusWhenMounted\(\)/);
  assert.match(
    PAGE_JS,
    /if\(\+\+attempt<50\)setTimeout\(focusWhenMounted,80\)/,
  );
  assert.match(PAGE_JS, /row\.classList\.add\('ds-comment-anchor-target'\)/);
});

test("the composer is compact, inline, and anchored to the selected side", () => {
  assert.match(PAGE_JS, /box\.setAttribute\('data-comment-side',side\)/);
  assert.match(
    PAGE_JS,
    /row\.parentNode\.insertBefore\(box,row\.nextSibling\)/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-composer\{width:min\(600px,calc\(100% - 24px\)\)/,
  );
  assert.match(PAGE_CSS, /\.ds-composer\[data-comment-side="left"\]/);
  assert.match(PAGE_JS, /function revealComposer\(box\)/);
  assert.match(PAGE_JS, /stickyHeight=sticky\.reduce/);
  assert.match(PAGE_JS, /scroller\.scrollTo\(\{top:top,behavior:'auto'\}\)/);
  assert.match(PAGE_JS, /ta\.focus\(\{preventScroll:true\}\)/);
  assert.match(PAGE_JS, /revealComposer\(box\)/);
  assert.doesNotMatch(PAGE_JS, /ds-composer-selection/);
  assert.doesNotMatch(PAGE_JS, /aria-modal.*New review comment/);
});

test("comment type is chosen inside the composer", () => {
  assert.match(PAGE_JS, /tabs\.setAttribute\('role','radiogroup'\)/);
  assert.match(PAGE_JS, /b\.setAttribute\('role','radio'\)/);
  assert.match(PAGE_JS, /function composerFlavorIcon\(type\)/);
  assert.match(PAGE_JS, /b\.appendChild\(composerFlavorIcon\(v\)\)/);
  assert.match(PAGE_JS, /span\.setAttribute\('aria-hidden','true'\)/);
  assert.match(PAGE_CSS, /\.ds-composer-type-icon svg\{[^}]*stroke-width:1\.6/);
  assert.match(PAGE_JS, /change:\{label:'Fix request'/);
  assert.match(PAGE_JS, /question:\{label:'Question'/);
  assert.match(PAGE_JS, /nit:\{label:'Note'/);
  assert.doesNotMatch(PAGE_JS, /severityForFlavor|ds-composer-severity/);
});

test("Copy is the primary default action and never persists", () => {
  const start = PAGE_JS.indexOf("function copyDraft()");
  const end = PAGE_JS.indexOf("add.type='button'", start);
  const copy = PAGE_JS.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(copy, /writeClipboard\(commentsToText\(\[payload\]\)/);
  assert.match(copy, /removeComposer\(box,false\)/);
  assert.doesNotMatch(copy, /fetch\(/);
  assert.match(PAGE_JS, /ds-btn ds-btn-solid ds-composer-copy','Copy'/);
  assert.match(PAGE_JS, /ds-ghost ds-composer-add','Add to queue'/);
});

test("Add to queue is the only composer action that writes", () => {
  const start = PAGE_JS.indexOf("function queue()");
  const end = PAGE_JS.indexOf("function copyDraft()", start);
  const queue = PAGE_JS.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(queue, /method:'POST'/);
  assert.match(queue, /body:JSON\.stringify\(payload\)/);
  assert.match(queue, /replaceComment\(c\)/);
  assert.match(queue, /syncCommentPins\(\)/);
  assert.match(queue, /Added to the review queue/);
});

test("exact selected code and line range are carried into copy and queue drafts", () => {
  assert.match(PAGE_JS, /selectedText=ctx\.selectedText\|\|''/);
  assert.match(
    PAGE_JS,
    /selectedText:selectedText,selection:ctx\.selection,status:'open'/,
  );
  assert.match(
    PAGE_JS,
    /startLine:startLine,endLine:endLine,startColumn:firstOffset\.start,endColumn:lastOffset\.end/,
  );
});

test("keyboard default copies; adding Shift queues", () => {
  assert.match(
    PAGE_JS,
    /Meta\+Enter Control\+Enter Meta\+Shift\+Enter Control\+Shift\+Enter/,
  );
  assert.match(PAGE_JS, /if\(e\.shiftKey\)queue\(\);else copyDraft\(\)/);
  assert.doesNotMatch(PAGE_JS, /ds-composer-hint/);
});

test("the selection context menu has one entry and C opens the same composer", () => {
  assert.match(PAGE_JS, /Comment selected code/);
  assert.match(PAGE_JS, /data-selection-comment/);
  assert.doesNotMatch(PAGE_JS, /data-selection-action/);
  assert.match(PAGE_JS, /e\.key==='c'\|\|e\.key==='C'/);
  // Both entries open the same composer with the same default type: a fix
  // request on a diff, a question on a code story.
  assert.match(PAGE_JS, /openComposer\(cctx\.anchorRow,defaultCommentFlavor\(\),cctx\)/);
  assert.match(PAGE_JS, /openComposer\(ctx\.anchorRow,defaultCommentFlavor\(\),ctx\)/);
  assert.match(PAGE_JS, /function defaultCommentFlavor\(\)\{return document\.body\.getAttribute\('data-story-subject'\)==='code'\?'question':'change';\}/);
});

test("selection stays constrained to one diff side", () => {
  assert.match(PAGE_JS, /data-comment-side/);
  assert.match(PAGE_JS, /if\(side&&s!==side\)return null/);
  assert.match(
    PAGE_CSS,
    /body\.ds-selecting-right \.ds-code\[data-comment-side="left"\]/,
  );
  assert.match(
    PAGE_CSS,
    /body\.ds-selecting-left \.ds-code\[data-comment-side="right"\]/,
  );
});

test("Review queue cards can be edited and removed", () => {
  assert.match(PAGE_JS, /function openQueuedCommentEditor\(card\)/);
  assert.match(PAGE_JS, /function saveQueuedComment\(card\)/);
  assert.match(PAGE_JS, /method:'PATCH'/);
  assert.match(PAGE_JS, /JSON\.stringify\(\{type:type,body:body\}\)/);
  assert.match(PAGE_JS, /function askRemoveQueuedComment\(id,btn\)/);
  assert.match(PAGE_JS, /function deleteQueuedComment\(id,box\)/);
  assert.match(PAGE_JS, /Remove this comment\?/);
  assert.doesNotMatch(PAGE_JS, /window\.confirm/);
  assert.match(PAGE_JS, /method:'DELETE'/);
});

test("refreshing comments re-renders the queue, pins, and file flags", () => {
  assert.match(PAGE_JS, /if\(Array\.isArray\(list\)\)allComments=list/);
  assert.match(
    PAGE_JS,
    /syncCommentPins\(\);syncFeedbackCards\(\);syncFileCommentFlags\(\);refreshCount\(\)/,
  );
  assert.match(
    PAGE_JS,
    /No queued comments\. Select code in the diff and press C\./,
  );
});

test("Copy all exports queued comments only, including exact code context", () => {
  assert.match(PAGE_JS, /function copyComments\(\)/);
  assert.match(
    PAGE_JS,
    /function queuedComments\(\)\{return allComments\.filter\((?:function\(c\)\{return c&&c\.status==='open';\}|\(c\)=> c&&c\.status==='open')\);\}/,
  );
  assert.match(PAGE_JS, /Code review comments from codeStory/);
  assert.match(PAGE_JS, /Selected code:/);
  assert.match(PAGE_JS, /Comment:/);
  assert.doesNotMatch(
    PAGE_JS,
    /commentTurnsToText|AI reply|paste them to your agent/,
  );
  assert.match(PAGE_JS, /function showCopySuccess\(count\)/);
  assert.match(PAGE_JS, /button\.classList\.add\('is-copied'\)/);
  assert.match(PAGE_JS, /label\.textContent='Copied'/);
  assert.match(PAGE_JS, /button\.classList\.remove\('is-copied'\)/);
  assert.match(PAGE_JS, /label\.textContent='Copy all'/);
  assert.match(PAGE_CSS, /\.ds-copy-action\.is-copied/);
  assert.match(PAGE_CSS, /\.ds-copy-action\.is-copied \.ds-copy-action-check\{opacity:1;transform:scale\(1\);filter:blur\(0\)\}/);
});

test("the review-comment feature contains no AI delivery or conversation machinery", () => {
  for (const forbidden of [
    "ADDRESS_API",
    "CODEX_TASK_API",
    "sendToAgent",
    "chooseAddressAgent",
    "Send to AI",
    "Ask agent",
    "Review conversation",
    "data-thread-send",
    "data-thread-ta",
    "data-address-all",
    "data-send-comment",
    "/message",
  ])
    assert.equal(PAGE_JS.includes(forbidden), false, forbidden);
});

test("file filters, resume state, and generic review dialogs remain local", () => {
  assert.match(PAGE_JS, /function applyFileFilters\(/);
  assert.match(PAGE_JS, /function restoreReviewPosition\(/);
  // The saved position is restored on load, so its key must name the story it was
  // saved in — scope alone is shared by every story over one base..head range.
  assert.match(
    PAGE_JS,
    /function reviewUiKey\(\)\{return 'ds-review-ui:'[\s\S]*?data-story-key/,
  );
  assert.match(PAGE_JS, /modalStack=\[\],modalBackgroundSnapshots=\[\]/);
  assert.match(PAGE_JS, /commandReturnFocus/);
  assert.match(PAGE_JS, /var modalRoot=topModalRoot\(\)/);
});

test("excluded-only scope truth and sidebar containment remain intact", () => {
  assert.match(
    PAGE_JS,
    /if\(progress&&!fileItems\.length&&excludedCount\)progress\.textContent=excludedCount\+/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-resume-review\{[^}]*min-width:0[^}]*overflow:hidden/,
  );
  assert.match(
    PAGE_CSS,
    /\.ds-resume-review \[data-resume-review-label\]\{[^}]*text-overflow:ellipsis/,
  );
});
