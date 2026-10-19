#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.CODESTORY_UI_ATLAS_OUT?.trim() || join(ROOT, 'docs', 'ui-atlas');
const SHOTS = join(OUT, 'screenshots');
const FIXTURE = mkdtempSync(join(tmpdir(), 'codestory-atlas-fixture-'));
const HOME = mkdtempSync(join(tmpdir(), 'codestory-atlas-home-'));
const STORY = join(FIXTURE, '.codestory', 'story.json');
const STORY_HOLD = join(FIXTURE, '.codestory', 'story.atlas-hold.json');
const viewports = { desktop: { width: 1440, height: 960 }, diagramWide: { width: 1896, height: 857 }, reported: { width: 868, height: 569 }, tablet: { width: 920, height: 820 }, mobile: { width: 390, height: 844 } };
// The panel root is a `data-progress-panel` element after the React rewrite;
// `.ds-pp` was a class name that no longer exists.
const PANEL = '#ds-agentpanel [data-progress-panel], #ds-storystage [data-progress-panel]';

// [category, title, description, state, theme, viewport, route, surface?]
// `surface` names the behaviour the capture has to drive; `state` names the file.
// Every non-review surface is captured at all three viewports plus a
// counter-theme desktop frame, so the pre-React baseline covers layout *and*
// palette for each page rather than desktop-dark only.
const definitions = [
  ['pages','Repository picker','Recent local workspaces and the app front door.','picker-recent','dark','desktop','/repos'],
  ['pages','Repository picker — tablet','Recent workspaces at the tablet width.','picker-recent-tablet','dark','tablet','/repos','picker-recent'],
  ['pages','Repository picker — mobile','Recent workspaces with the icon-only add button and overlaid remove control.','picker-recent-mobile','dark','mobile','/repos','picker-recent'],
  ['pages','Repository removal — undo','A removed workspace stays recoverable in the same visible status surface.','picker-remove-undo','dark','desktop','/repos'],
  ['pages','Repository picker — light','Recent workspaces in the light palette.','picker-recent-light','light','desktop','/repos','picker-recent'],
  ['pages','Repository picker — empty','The no-repositories-yet state before anything has been opened.','picker-empty','dark','desktop','/repos','picker-empty'],
  ['pages','Repository picker — empty, mobile','The no-repositories-yet state on a phone viewport.','picker-empty-mobile','dark','mobile','/repos','picker-empty'],
  ['pages','Folder browser modal','The repository chooser sheet open over the inert picker.','picker-modal','dark','desktop','/repos','picker-modal'],
  ['pages','Folder browser modal — tablet','The repository chooser sheet at the tablet width.','picker-modal-tablet','dark','tablet','/repos','picker-modal'],
  ['pages','Folder browser modal — mobile','The repository chooser sheet on a phone viewport.','picker-modal-mobile','dark','mobile','/repos','picker-modal'],
  ['pages','Folder browser modal — light','The repository chooser sheet in the light palette.','picker-modal-light','light','desktop','/repos','picker-modal'],
  ['pages','Review history','Saved review, scope health, and queued-comment status.','history-populated','dark','desktop','/repo/codestory-atlas-fixture/stories'],
  ['pages','Review history — glance preview','The saved-review action expands on precise hover to preview scope before navigation.','history-glance','dark','desktop','/repo/codestory-atlas-fixture/stories'],
  ['pages','Review history — tablet','Saved reviews at the tablet width.','history-populated-tablet','dark','tablet','/repo/codestory-atlas-fixture/stories','history-populated'],
  ['pages','Review history — mobile','Saved reviews with the stacked row footer on a phone viewport.','history-populated-mobile','dark','mobile','/repo/codestory-atlas-fixture/stories','history-populated'],
  ['pages','Review history — light','Saved reviews in the light palette.','history-populated-light','light','desktop','/repo/codestory-atlas-fixture/stories','history-populated'],
  ['pages','Review history — empty','The no-saved-reviews state with the header Start review still present.','history-empty','dark','desktop','/repo/codestory-atlas-fixture/stories','history-empty'],
  ['pages','Review history — empty, mobile','The no-saved-reviews state on a phone viewport.','history-empty-mobile','dark','mobile','/repo/codestory-atlas-fixture/stories','history-empty'],
  // An explicit base/head is what actually populates this page. Plain `/change`
  // resolves to the (clean) uncommitted scope, which is why the pre-existing
  // `change-populated` frame was a duplicate of `change-empty` in light theme.
  ['pages','Choose review scope','Branch comparison and changed-file inventory.','change-populated','light','desktop','/repo/codestory-atlas-fixture/change?base=main&head=feat%2Fspending-limit'],
  ['pages','Choose review scope — tablet','Scope selection below the metrics-ledger breakpoint.','change-populated-tablet','light','tablet','/repo/codestory-atlas-fixture/change?base=main&head=feat%2Fspending-limit','change-populated'],
  ['pages','Choose review scope — mobile','Scope selection with the icon-only segment tiles on a phone viewport.','change-populated-mobile','light','mobile','/repo/codestory-atlas-fixture/change?base=main&head=feat%2Fspending-limit','change-populated'],
  ['pages','Choose review scope — dark','Scope selection in the dark palette.','change-populated-dark','dark','desktop','/repo/codestory-atlas-fixture/change?base=main&head=feat%2Fspending-limit','change-populated'],
  ['pages','Empty working tree','The honest no-change state for the uncommitted scope.','change-empty','dark','desktop','/repo/codestory-atlas-fixture/change?scope=uncommitted'],
  ['pages','Empty working tree — tablet','The no-change state at the tablet width.','change-empty-tablet','dark','tablet','/repo/codestory-atlas-fixture/change?scope=uncommitted','change-empty'],
  ['pages','Empty working tree — mobile','The no-change state on a phone viewport.','change-empty-mobile','dark','mobile','/repo/codestory-atlas-fixture/change?scope=uncommitted','change-empty'],
  ['pages','Empty working tree — light','The no-change state in the light palette.','change-empty-light','light','desktop','/repo/codestory-atlas-fixture/change?scope=uncommitted','change-empty'],
  ['pages','Ref picker open','The compare panel open with the anchored git-reference listbox.','change-refpicker','dark','desktop','/repo/codestory-atlas-fixture/change','change-refpicker'],
  ['pages','Ref picker open — tablet','The anchored reference listbox at the tablet width.','change-refpicker-tablet','dark','tablet','/repo/codestory-atlas-fixture/change','change-refpicker'],
  ['pages','Ref picker open — mobile','The anchored reference listbox on a phone viewport, where compare rows stack.','change-refpicker-mobile','dark','mobile','/repo/codestory-atlas-fixture/change','change-refpicker'],
  ['pages','Raw diff','Story-free inspection of the exact selected change.','raw-diff','dark','desktop','/repo/codestory-atlas-fixture/diff?base=main&head=feat%2Fspending-limit'],
  ['pages','Raw diff — tablet','Story-free diff inspection at the tablet width.','raw-diff-tablet','dark','tablet','/repo/codestory-atlas-fixture/diff?base=main&head=feat%2Fspending-limit','raw-diff'],
  ['pages','Raw diff — mobile','Story-free diff inspection on a phone viewport.','raw-diff-mobile','dark','mobile','/repo/codestory-atlas-fixture/diff?base=main&head=feat%2Fspending-limit','raw-diff'],
  ['pages','Raw diff — light','Story-free diff inspection in the light palette.','raw-diff-light','light','desktop','/repo/codestory-atlas-fixture/diff?base=main&head=feat%2Fspending-limit','raw-diff'],
  ['review','Guided review overview','Intent, reading path, scope, and walkthrough entry.','overview','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Guided review overview — mobile','The same reading path remains quiet above the walkthrough action on a phone viewport.','overview-mobile','dark','mobile','/repo/codestory-atlas-fixture/review','overview'],
  ['review','Commit evolution — open','The native disclosure shows frozen first-parent phases without competing with the walkthrough.','evolution-open','dark','desktop','/repo/codestory-atlas-fixture/review','evolution-open'],
  ['review','Commit evolution — open, mobile','Commit phases stay readable and full-width on a phone viewport.','evolution-open-mobile','dark','mobile','/repo/codestory-atlas-fixture/review','evolution-open'],
  ['review','Narration control — active','The narration action expands into its pause and waveform state while speech is audible.','narration-active','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Logic-move walkthrough','Focused code with a local semantic move, narrative beats, and filmstrip.','code-step','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Logic-move walkthrough — proximity dock','Pointer proximity magnifies the target stop and its neighbours without changing review order.','code-step-dock','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Focused code walkthrough','A deliberately quiet code scene without semantic-move annotation ink.','code-focus','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Paired-code walkthrough','A cross-file relationship presented as a before-and-after scene.','paired-code','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Concept primer with diagram','A mental model composed as copy and diagram rather than a long document.','concept-step','light','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Tall concept diagram','A portrait flowchart remains bounded by the wide desktop stage instead of stretching the scene.','concept-tall','dark','diagramWide','/repo/codestory-atlas-fixture/review','concept-tall'],
  ['review','Tall concept diagram — tablet','The same portrait flowchart uses a bounded canvas in the stacked tablet layout.','concept-tall-tablet','dark','tablet','/repo/codestory-atlas-fixture/review','concept-tall'],
  ['review','Tall concept diagram — mobile','The same portrait flowchart uses a bounded canvas in the stacked mobile layout.','concept-tall-mobile','dark','mobile','/repo/codestory-atlas-fixture/review','concept-tall'],
  ['review','Concept primer with diagram — tablet entry','The DOM-order concept stack opens at its thesis at the tablet breakpoint.','concept-step-tablet','dark','tablet','/repo/codestory-atlas-fixture/review','concept-step'],
  ['review','Concept primer with diagram — tablet evidence','The same tablet scene scrolled to prove its diagram, caption, and next action remain reachable.','concept-step-tablet-evidence','dark','tablet','/repo/codestory-atlas-fixture/review','concept-step-evidence'],
  ['review','Concept primer with diagram — mobile entry','The DOM-order concept stack opens at its thesis on a phone viewport.','concept-step-mobile','light','mobile','/repo/codestory-atlas-fixture/review','concept-step'],
  ['review','Concept primer with diagram — mobile evidence','The same phone scene scrolled to prove its diagram, caption, and next action remain reachable.','concept-step-mobile-evidence','light','mobile','/repo/codestory-atlas-fixture/review','concept-step-evidence'],
  ['review','Concept document','A document-led primer when the story has no diagram to compose beside it.','concept-document','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','All files — unified','Complete file inventory in the primary unified-diff mode.','files-unified','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','All files — split','Side-by-side review with the resizable before/after divider.','files-split','light','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Source editor chooser','The anchored source-editor chooser clears the sticky diff controls beneath it.','editor-menu-open','dark','reported','/repo/codestory-atlas-fixture/review'],
  ['review','Review page','Coverage, queued comments, challenge checks, and saved reviews — as a page.','review-menu','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Review comments','Queued comments grouped by file with code anchors, editing, removal, and Copy all.','comment-queue','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Review comments — copied','Copy all confirms completion in the action itself before returning to its resting label.','comment-copy-success','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Inline comment','A compact selected-code composer with Copy as the default and Queue as persistence.','comment-composer','dark','desktop','/repo/codestory-atlas-fixture/review'],
  ['review','Comment anchor','A queued comment traced back to highlighted code without opening a modal.','comment-anchor','light','desktop','/repo/codestory-atlas-fixture/review'],
  ['communication','Agent working','Floating progress panel mid-run: milestones, plan, activity, and the stop control.','pp-running','dark','desktop','/repo/codestory-atlas-fixture/review','pp-running'],
  ['communication','Agent working — tablet','The floating progress panel at the tablet width.','pp-running-tablet','dark','tablet','/repo/codestory-atlas-fixture/review','pp-running'],
  ['communication','Agent working — mobile','The progress panel below its 520px head-grid breakpoint.','pp-running-mobile','dark','mobile','/repo/codestory-atlas-fixture/review','pp-running'],
  ['communication','Agent working — light host','The panel stays dark on a light page; only its ink lifts.','pp-running-light','light','desktop','/repo/codestory-atlas-fixture/review','pp-running'],
  ['communication','Agent working — panel detail','The running panel captured at element scale.','pp-detail-running','dark','desktop','/repo/codestory-atlas-fixture/review','pp-detail-running'],
  ['communication','Agent complete','Terminal success: every milestone done, Close replaces Stop.','pp-complete','dark','desktop','/repo/codestory-atlas-fixture/review','pp-complete'],
  ['communication','Agent stopped','User-cancelled run with an explicit terminal status.','pp-stopped','dark','desktop','/repo/codestory-atlas-fixture/review','pp-stopped'],
  ['communication','Agent failure','Actionable failure summary with technical details kept collapsed.','pp-failed','dark','desktop','/repo/codestory-atlas-fixture/review','pp-failed'],
  ['communication','Agent failure — panel detail','The failed panel captured at element scale.','pp-detail-failed','dark','desktop','/repo/codestory-atlas-fixture/review','pp-detail-failed'],
  ['communication','Agent cannot start','The pre-stream blocked state, before any run events arrive.','pp-blocked','dark','desktop','/repo/codestory-atlas-fixture/review','pp-blocked'],
  // The storyless intro that hosts the stage variant lives on the diff route
  // with no story file present, not on /review.
  ['communication','Agent working — stage variant','The same panel node re-parented into the storyless intro as the stage variant.','pp-stage','dark','desktop','/repo/codestory-atlas-fixture/diff?base=main&head=feat%2Fspending-limit','pp-stage'],
  ['responsive','Tablet review','The review workspace at the rail-collapse breakpoint.','tablet-review','dark','tablet','/repo/codestory-atlas-fixture/review'],
  ['responsive','Mobile focused-code walkthrough','Compact chrome and a quiet code-focus scene on a phone viewport.','mobile-step','light','mobile','/repo/codestory-atlas-fixture/review','code-focus-mobile'],
  ['responsive','Mobile inline comment','The code-anchored composer in the mobile review flow.','mobile-comment-composer','dark','mobile','/repo/codestory-atlas-fixture/review'],
  ['responsive','Mobile comments','The comment queue as a full-height mobile workspace.','mobile-comments','dark','mobile','/repo/codestory-atlas-fixture/review']
].map(([category,title,description,state,theme,viewport,route,surface])=>({category,title,description,state,theme,viewport,route,surface:surface||state}))
  .filter((definition)=>{const selected=process.env.CODESTORY_UI_ATLAS_STATES?.split(',').map((state)=>state.trim()).filter(Boolean);return !selected?.length||selected.includes(definition.state);});

// A surface is only "covered" if the frame actually contains it. Each entry is
// a selector that must exist and have a non-zero box before the shutter fires,
// so a blank body or a server error page fails the run instead of shipping as
// coverage.
const evidence = {
  // Attribute, not a class: under Tailwind the class list is styling and churns,
  // so the React surfaces expose deliberate `data-*` hooks for this script.
  'picker-recent':'[data-repo-card]',
  'picker-remove-undo':'[data-picker-status] button',
  'picker-empty':'[data-recents-empty]',
  'picker-modal':'.ds-scrim.is-shown .ds-sheet',
  'history-populated':'#storyList .story-row',
  'history-glance':'#storyList .story-row .story-glance-detail',
  'history-empty':'main .empty',
  'change-populated':'.file-card .frow',
  'change-empty':'.file-card .empty-title',
  'change-refpicker':'#refPicker .refpick-row',
  'raw-diff':'.ds-filedetail',
  'overview':'#ds-view-tour [data-scene-layout="opening"]',
  'evolution-open':'.ds-intro-evolution[open] .ds-evolution-copy',
  'narration-active':'.ds-readaloud.is-active.is-audible .ds-readaloud-wave',
  'code-step':'#ds-view-tour [data-scene-layout="logic-move"]:not([hidden])',
  'code-step-dock':'.ds-filmnode[style*="--ds-dock-scale"]',
  'comment-copy-success':'[data-copy-comments].is-copied',
  'code-focus':'#ds-view-tour [data-scene-layout="code-focus"]:not([hidden])',
  'paired-code':'#ds-view-tour [data-scene-layout="paired-code"]:not([hidden])',
  'concept-step':'#ds-view-tour [data-scene-layout="concept-diagram"]:not([hidden])',
  'concept-tall':'#ds-view-tour [data-scene-layout="concept-diagram"]:not([hidden]) [data-concept-diagram][data-render-state="ready"]',
  'concept-step-evidence':'#ds-view-tour [data-scene-layout="concept-diagram"]:not([hidden]) [data-concept-diagram][data-render-state="ready"]',
  'concept-document':'#ds-view-tour [data-scene-layout="concept-document"]:not([hidden])',
  'code-focus-mobile':'#ds-view-tour [data-scene-layout="code-focus"]:not([hidden])',
  'editor-menu-open':'.ds-editor-menu:not([hidden])',
  // The React panel replaced the `ds-pp-*` class names with Tailwind utilities
  // and a deliberate `data-pp-*` hook set. `is-finished` became `data-state`.
  'pp-running':'[data-progress-panel][data-state="running"] [data-pp-plan] [data-pp-step-now]',
  'pp-detail-running':'[data-progress-panel][data-state="running"] [data-pp-plan] [data-pp-step-now]',
  'pp-complete':'[data-progress-panel][data-state="complete"] [data-pp-live][data-tone="done"]',
  'pp-stopped':'[data-progress-panel][data-state="stopped"] [data-pp-live][data-tone="error"]',
  'pp-failed':'[data-progress-panel][data-state="failed"] [data-pp-error]',
  'pp-detail-failed':'[data-progress-panel][data-state="failed"] [data-pp-error]',
  'pp-blocked':'[data-progress-panel][data-state="blocked"] [data-pp-error]',
  'pp-stage':'#ds-storystage [data-progress-panel][data-variant="stage"]'
};

// A frame that quietly contains a load error looks like coverage and is worse
// than no frame at all. So an unexpected `.ds-differror` fails the run, and the
// surfaces that are *known* to be broken right now are listed here, recorded in
// the manifest as `degraded`, and shouted about on stdout. Delete an entry the
// moment its bug is fixed — the run then tells you the note is stale.
const knownDegraded = {};

function browserExecutable(){
  const configured=process.env.CODESTORY_ATLAS_BROWSER?.trim();
  const choices=[configured,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/usr/bin/google-chrome','/usr/bin/chromium'];
  return choices.find((path)=>Boolean(path)&&existsSync(path));
}
async function freePort(){return await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(()=>resolve(a.port));});});}
function fakeCodex(path){
  writeFileSync(path,`#!/usr/bin/env node
let input='';
if(process.argv[2]==='app-server'){
 process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;let lines=input.split('\\n');input=lines.pop();for(const line of lines){if(!line.trim())continue;let m;try{m=JSON.parse(line)}catch{continue}if(m.id===1)console.log(JSON.stringify({id:1,result:{}}));if(m.id===2&&m.method==='model/list')console.log(JSON.stringify({id:2,result:{data:[{model:'gpt-5.6-codex',displayName:'GPT-5.6 Codex',hidden:false,isDefault:true}]}}));}});return;
}
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Generating the review story.'}}));setTimeout(()=>process.exit(0),150);
`);
  chmodSync(path,0o755);
}
// The folder-browser modal lists the server's HOME. A bare temp dir renders the
// "No subfolders here." branch, which hides the row layout the modal exists for,
// so give it a small deterministic tree with one git repo in it.
function seedBrowsableHome(){
  for(const name of ['notes-archive','Projects','Sandbox'])mkdirSync(join(HOME,name),{recursive:true});
  mkdirSync(join(HOME,'workbench-demo','.git'),{recursive:true});
}
function waitReady(url,child){return new Promise((resolve,reject)=>{let tries=0;const tick=async()=>{if(child.exitCode!==null)return reject(new Error('codeStory server exited before capture.'));try{const r=await fetch(url);if(r.ok)return resolve();}catch{}if(++tries>100)return reject(new Error('Timed out waiting for codeStory.'));setTimeout(tick,100);};tick();});}
function setStoryForSurface(surface){
  if(surface==='history-empty'||surface==='pp-stage'){
    if(existsSync(STORY)){copyFileSync(STORY,STORY_HOLD);rmSync(STORY);}
    return;
  }
  if(existsSync(STORY_HOLD))copyFileSync(STORY_HOLD,STORY);
  if(surface==='concept-tall'){
    const story=JSON.parse(readFileSync(STORY,'utf8'));
    const concept=story.steps.find((step)=>step.kind==='concept');
    if(!concept?.diagram)throw new Error('The atlas fixture has no concept diagram to project as a tall flowchart.');
    concept.title='How the moving liquidation boundary is planned';
    concept.body='<p>The execution path is shared. A zero-rate calculation finds the legacy amount, applies the quantity ceiling, then checks whether the remaining quote is still valid.</p>';
    concept.diagram.source='flowchart TB\n  Start[Read ordered quote batch] --> Rate{Quote rate is zero?}\n  Rate -->|yes| Legacy[Calculate zero-rate amount]\n  Rate -->|no| Requested[Use requested close amount]\n  Legacy --> Ceiling[Apply maxQuantity ceiling]\n  Requested --> Ceiling\n  Ceiling --> Valid{Remaining quote value valid?}\n  Valid -->|yes| Keep[Keep quote in liquidation plan]\n  Valid -->|no| Stop[Stop at the ordered boundary]\n  Keep --> Update[Update remaining capacity]\n  Update --> More{More quotes?}\n  More -->|yes| Start\n  More -->|no| Return[Return deterministic close vector]';
    concept.diagram.caption='Each quote is capped and validated before the ordered plan advances.';
    writeFileSync(STORY,`${JSON.stringify(story,null,2)}\n`);
  }
  if(surface==='concept-document'){
    const story=JSON.parse(readFileSync(STORY,'utf8'));
    const concept=story.steps.find((step)=>step.kind==='concept');
    if(!concept)throw new Error('The atlas fixture has no concept step to project as a document scene.');
    delete concept.diagram;
    writeFileSync(STORY,`${JSON.stringify(story,null,2)}\n`);
  }
}
function themeInit(theme){return `(function(){try{localStorage.clear();localStorage.setItem('ds-theme','${theme}');localStorage.setItem('ds-sidebar-collapsed','0')}catch(e){}})()`;}
async function settled(page){await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>document.fonts?document.fonts.status==='loaded':true);await page.waitForTimeout(280);}
async function click(page,selector){const target=page.locator(selector).first();await target.waitFor({state:'attached'});if(await target.isVisible())await target.click();else await target.evaluate((element)=>element.click());await page.waitForTimeout(240);}
async function gotoStoryStep(page,index){
  const target=page.locator(`[data-thread-node="${index}"]`).first();
  await target.waitFor({state:'attached'});
  await target.evaluate((element)=>element.click());
  await page.waitForTimeout(240);
}
async function openFixtureRepo(page,origin,route){
  await page.evaluate(async(path)=>{await fetch('/api/repo/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});},FIXTURE);
  await page.goto(origin+route);await settled(page);
}
async function forgetAllRecents(page){
  await page.evaluate(async()=>{
    const list=await fetch('/api/repos/recent').then(r=>r.json()).catch(()=>[]);
    for(const entry of Array.isArray(list)?list:[]){
      if(!entry||!entry.path)continue;
      await fetch('/api/repos/recent',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({path:entry.path})});
    }
  });
}
/**
 * Drive the real ProgressPanel with real ProgressEvent-shaped fixtures.
 * There is no AI agent on PATH during a capture, so the run itself is synthetic
 * — but every pixel is produced by the shipped panel code reacting to the exact
 * event union `src/progress.ts` defines and the server streams as NDJSON.
 */
/**
 * Load the panel's imperative bridge.
 *
 * The review page imports the component from the barrel, not the bundle entry,
 * so `window.codeStoryProgress` is not present until we ask for it. The entry
 * publishes it on load precisely so a non-React driver like this one can mount
 * a panel and step it through fixture events.
 */
async function ensureProgressBridge(page){
  await page.addScriptTag({type:'module',url:'/assets/client/progress.js'});
  await page.waitForFunction(()=>typeof window.codeStoryProgress?.mount==='function',undefined,{timeout:5000});
}

async function progressState(page,kind){
  await ensureProgressBridge(page);
  await page.evaluate((terminal)=>{
    // Mount our own panel rather than reaching into one the review engine owns:
    // two drivers on one panel is not a state the app can ever be in.
    const host=document.querySelector('#ds-storystage')||document.querySelector('#ds-agentpanel');
    if(!host)throw new Error('No progress panel host (#ds-storystage / #ds-agentpanel) on this page.');
    window.__atlasPanel?.unmount();
    const variant=host.id==='ds-storystage'?'stage':'floating';
    const panel=window.codeStoryProgress.mount(host,{variant});
    window.__atlasPanel=panel;
    panel.start();
    if(terminal==='blocked'){
      panel.blocked({label:'No story agent available',detail:'codeStory could not find Claude Code or Codex on this machine. Install one, then start the review again.',technicalDetail:'looked for: claude, codex; PATH had neither'});
      return;
    }
    panel.handle({type:'run_started',workflow:'guided_review'});
    panel.handle({type:'context',agent:'codex',model:'gpt-5.6-codex',repoName:'codestory-atlas-fixture',base:'main',head:'feat/spending-limit'});
    panel.handle({type:'phase',phase:'reading_changes'});
    panel.handle({type:'plan',items:[
      {text:'Read every changed file and recover the intent',status:'done'},
      {text:'Design a reading path across the spending-limit change',status:'active'},
      {text:'Write the story and verify each code anchor',status:'pending'}
    ]});
    panel.handle({type:'file',label:'Reading changed files · 3 of 8 · src/limits.ts'});
    panel.handle({type:'activity',kind:'narration',label:'The monthly cap moved from a per-request guard into a ledger, so the story has to open with why that boundary changed.'});
    panel.handle({type:'text',data:'reading src/limits.ts\nreading src/api.ts\n'});
    panel.handle({type:'heartbeat',quietMs:9000});
    if(terminal==='complete'){
      panel.handle({type:'phase',phase:'designing_path'});
      panel.handle({type:'phase',phase:'writing_output'});
      panel.handle({type:'phase',phase:'validating_output'});
      panel.handle({type:'run_done',status:'complete',result:{storyWritten:true}});
    }else if(terminal==='stopped'){
      panel.handle({type:'run_done',status:'stopped',result:{}});
    }else if(terminal==='failed'){
      panel.handle({type:'error',label:'The agent stopped before finishing',detail:'No story file was written. Try again, or switch to another agent from review settings.',technicalDetail:'codex exited with code 1 after 42s\nlast line: unable to open src/limits.ts'});
      panel.handle({type:'run_done',status:'failed',result:{}});
    }
  },kind);
  await page.waitForTimeout(200);
}
// The stage variant used to be a re-parent of one singleton node. After the
// React rewrite it is a prop: render the panel inside the story stage with
// variant="stage" instead of moving a node between hosts. All this has to do is
// create the stage host in the right place; progressState() mounts into it and
// picks the variant from the host it lands in.
async function mountPanelInStage(page){
  await page.evaluate(()=>{
    const wrap=document.querySelector('.ds-step.is-intro .ds-introwrap');
    if(!wrap)throw new Error('The storyless intro is not on this page, so the stage variant cannot be mounted.');
    if(!document.getElementById('ds-storystage')){
      const mount=document.createElement('div');
      mount.id='ds-storystage';
      wrap.insertBefore(mount,wrap.querySelector('.ds-storygen-card')||null);
    }
  });
}
async function assertRendered(page,def){
  const selector=evidence[def.surface];
  const failure=await page.evaluate(()=>{const node=document.querySelector('.ds-differror');return node?(node.innerText||'').replace(/\s+/g,' ').trim():'';});
  const expected=knownDegraded[def.surface];
  if(failure&&!expected)throw new Error(`${def.state} rendered a load error, which would ship as fake coverage: ${failure}`);
  if(!failure&&expected)console.warn(`  note: ${def.state} rendered cleanly although its surface is in knownDegraded — either the bug is fixed (drop the entry) or this viewport does not take the broken path.`);
  if(failure)console.warn(`  DEGRADED ${def.state}: ${failure}`);
  const result=await page.evaluate((sel)=>{
    const title=document.title||'';
    const heading=document.querySelector('h1')?.textContent||'';
    if(/—\s*error$/.test(title)||/Couldn't build the review/.test(heading))return {ok:false,reason:`server error page: ${heading.trim()||title}`};
    if((document.body.innerText||'').trim().length<40)return {ok:false,reason:'page body is effectively blank'};
    if(!sel)return {ok:true,reason:''};
    const nodes=Array.from(document.querySelectorAll(sel));
    if(!nodes.length)return {ok:false,reason:`no element matches ${sel}`};
    // Several surfaces keep off-screen duplicates (collapsed file panels, the
    // parked floating panel). One laid-out match is enough to prove the surface
    // is really on the frame.
    if(!nodes.some((node)=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;}))return {ok:false,reason:`all ${nodes.length} matches for ${sel} have a zero box`};
    return {ok:true,reason:''};
  },selector);
  if(!result.ok)throw new Error(`${def.state} did not render its surface: ${result.reason}`);
  if(def.surface==='concept-tall'){
    const geometry=await page.evaluate(()=>{
      const panel=document.querySelector('.ds-step:not([hidden])'),scroller=panel?.querySelector('.ds-concept-scroll'),figure=panel?.querySelector('.ds-concept-diagram'),output=panel?.querySelector('.ds-concept-diagram-output'),svg=output?.querySelector(':scope>svg');
      if(!scroller||!figure||!output||!svg)return {valid:false,reason:'concept scroller, figure, output, or SVG is missing'};
      const compact=innerWidth<=980,mobile=innerWidth<=620,overflowX=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth;
      const outputHeight=output.getBoundingClientRect().height,svgHeight=svg.getBoundingClientRect().height;
      if(overflowX>1)return {valid:false,reason:`page has ${Math.round(overflowX)}px horizontal overflow`};
      if(!compact&&scroller.scrollHeight>scroller.clientHeight+1)return {valid:false,reason:`desktop scene scrolls ${scroller.scrollHeight-scroller.clientHeight}px vertically`};
      const compactLimit=mobile?422:522;
      if(compact&&outputHeight>compactLimit)return {valid:false,reason:`compact diagram is ${Math.round(outputHeight)}px tall (limit ${compactLimit}px)`};
      if(!figure.classList.contains('is-portrait'))return {valid:false,reason:'tall flowchart was not classified as portrait'};
      if(svgHeight<=outputHeight+1||output.scrollHeight<=output.clientHeight+1)return {valid:false,reason:`portrait SVG ${Math.round(svgHeight)}px was fitted into the ${Math.round(outputHeight)}px canvas instead of remaining readable and internally scrollable`};
      return {valid:true,reason:`canvas ${Math.round(outputHeight)}px; SVG ${Math.round(svgHeight)}px; scene ${scroller.clientWidth}x${scroller.clientHeight}; canvas scroll ${output.scrollWidth}x${output.scrollHeight}`};
    });
    if(!geometry.valid)throw new Error(`${def.state} did not keep its tall diagram bounded: ${geometry.reason}`);
    console.log(`  verified ${def.state}: ${geometry.reason}`);
  }
  return failure?(expected||failure):'';
}
async function assertReviewPageVisible(page){
  const result=await page.evaluate(()=>{
    const view=document.querySelector('#ds-view-review');
    if(!view||view.hidden)return {visible:false,reason:'review view is missing or hidden'};
    const evidence=document.querySelector('[data-trust-evidence]');
    const rect=view.getBoundingClientRect();
    return {visible:rect.width>0&&rect.height>0&&!!evidence,reason:`review view ${Math.round(rect.width)}x${Math.round(rect.height)}; evidence ${evidence?'present':'missing'}`};
  });
  if(!result.visible)throw new Error(`Review page did not render: ${result.reason}`);
}
// The stage used to be flanked by `[data-ghost-prev]` / `[data-ghost-next]`
// buttons. Neither attribute exists anywhere in `src/` any more (nor at HEAD),
// so the old `expectSideControls` branch could only ever fail. The balance and
// width checks are the part that still describes shipped layout.
async function assertReviewStageGeometry(page){
  const result=await page.evaluate(()=>{
    // The filmstrip is `.ds-dock` since the review-page rework; the old
    // `.ds-filmthread` node is gone, which silently turned this whole check
    // into a guaranteed failure (a zero-box `thread` put the bottom gap at
    // -882px). Same intent, current selector.
    const chrome=document.querySelector('[data-review-chrome]'),stage=document.querySelector('#ds-view-tour>:not(.ds-dock):not(.ds-step-ghost):not([hidden])'),thread=document.querySelector('.ds-dock');
    if(!chrome||!stage||!thread)return {valid:false,reason:'review chrome, active stage, or filmstrip is missing'};
    const chromeRect=chrome.getBoundingClientRect(),stageRect=stage.getBoundingClientRect(),threadRect=thread.getBoundingClientRect();
    const topGap=stageRect.top-chromeRect.bottom,bottomGap=threadRect.top-stageRect.bottom,widthShare=stageRect.width/innerWidth;
    const chromeVisible=chromeRect.top>=0&&chromeRect.bottom<=innerHeight;
    const valid=chromeVisible&&Math.abs(topGap-bottomGap)<=2&&widthShare>=.7;
    return {valid,reason:`chrome ${chromeVisible?'visible':'clipped'}, top gap ${Math.round(topGap)}px, bottom gap ${Math.round(bottomGap)}px, stage ${Math.round(widthShare*100)}% of viewport`};
  });
  if(!result.valid)throw new Error(`Review stage geometry is unbalanced: ${result.reason}`);
}

async function waitForStoryStep(page,index,layout){
  await page.waitForFunction(({step,scene})=>{
    const panel=document.querySelector(`.ds-step[data-step-panel="${step}"]:not([hidden])`);
    return !!panel&&!panel.hasAttribute('data-step-lazy')&&panel.getAttribute('data-scene-layout')===scene&&!/Loading this review step/i.test(panel.textContent||'');
  },{step:index,scene:layout},{timeout:15000});
}

async function sceneDockRect(page){
  return page.evaluate(()=>{const dock=document.querySelector('.ds-dock');if(!dock)throw new Error('Story dock is missing.');const rect=dock.getBoundingClientRect();return {top:Math.round(rect.top),height:Math.round(rect.height)};});
}

async function assertStoryInteractionReplay(browser,origin){
  setStoryForSurface('overview');
  const route=`/repo/${encodeURIComponent(basename(FIXTURE))}/review?story=story.json`;
  const context=await browser.newContext({viewport:viewports.desktop,colorScheme:'dark',reducedMotion:'no-preference'});
  const page=await context.newPage();
  const stepFetches=new Map();
  page.on('request',(request)=>{const url=new URL(request.url());if(url.pathname!=='/api/review/step-panel')return;const index=url.searchParams.get('index')||'?';stepFetches.set(index,(stepFetches.get(index)||0)+1);});
  await page.addInitScript(()=>{
    window.__atlasSceneAnimations=[];
    const original=Element.prototype.animate;
    Element.prototype.animate=function(keyframes,options){
      if(this.closest?.('[data-scene-layout]'))window.__atlasSceneAnimations.push({className:typeof this.className==='string'?this.className:'',keyframes,options});
      return original.call(this,keyframes,options);
    };
  });
  try{
    await page.goto(origin+route,{waitUntil:'domcontentloaded'});await settled(page);
    await page.keyboard.press('Tab');
    const firstFocus=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim(),href:document.activeElement?.getAttribute?.('href')}));
    if(firstFocus.text!=='Skip to content'||firstFocus.href!=='#main-content')throw new Error(`Skip link was not first in the review tab order: ${JSON.stringify(firstFocus)}`);
    await page.keyboard.press('Enter');
    const skipTarget=await page.evaluate(()=>({id:document.activeElement?.id,hash:location.hash}));
    if(skipTarget.id!=='main-content'||skipTarget.hash!=='#main-content')throw new Error(`Skip link did not focus the main landmark: ${JSON.stringify(skipTarget)}`);
    await gotoStoryStep(page,1);await waitForStoryStep(page,1,'logic-move');
    const logicDock=await sceneDockRect(page);

    await gotoStoryStep(page,2);await waitForStoryStep(page,2,'concept-diagram');
    const conceptEntryScroll=await page.locator('.ds-step:not([hidden]) .ds-concept-scroll').evaluate((scroller)=>scroller.scrollTop);
    if(conceptEntryScroll!==0)throw new Error(`Concept scene opened at scrollTop ${conceptEntryScroll} instead of its thesis.`);
    await page.waitForFunction(()=>window.__atlasSceneAnimations.length>=4,undefined,{timeout:5000});
    const firstEntrance=await page.evaluate(()=>window.__atlasSceneAnimations.slice());
    const forbidden=firstEntrance.filter((entry)=>/ds-(?:diff|row|urow)/.test(entry.className));
    if(forbidden.length)throw new Error(`Concept entrance touched live code: ${forbidden.map((entry)=>entry.className).join(', ')}`);
    if(firstEntrance.some((entry)=>!JSON.stringify(entry.keyframes).includes('translateY(6px)')))throw new Error('A concept entrance used motion outside the opacity/6px contract.');
    const firstEntranceCount=firstEntrance.length;

    await gotoStoryStep(page,1);await waitForStoryStep(page,1,'logic-move');
    await gotoStoryStep(page,2);await waitForStoryStep(page,2,'concept-diagram');
    await page.waitForTimeout(80);
    const revisitCount=await page.evaluate(()=>window.__atlasSceneAnimations.length);
    if(revisitCount!==firstEntranceCount)throw new Error(`Concept entrance replayed on revisit (${firstEntranceCount} -> ${revisitCount}).`);

    // Exercise the content-aware branch directly: a short primer on this same
    // desktop canvas should spend the newly empty space on type, then release
    // the fit when the scene crosses into the compact stacked layout.
    await page.evaluate(()=>{const body=document.querySelector('.ds-step:not([hidden]) .ds-concept-body');if(!body)throw new Error('Concept body is missing.');body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'A short mental model should read at presentation scale when the stage has room.'}));window.dispatchEvent(new Event('resize'));});
    await page.waitForFunction(()=>Number(document.querySelector('.ds-step:not([hidden]) .ds-concept-copy')?.getAttribute('data-concept-type-scale')||0)>1.2);
    const spaciousType=await page.evaluate(()=>{const panel=document.querySelector('.ds-step:not([hidden])'),copy=panel?.querySelector('.ds-concept-copy'),body=panel?.querySelector('.ds-concept-body'),scroller=panel?.querySelector('.ds-concept-scroll');return {scale:Number(copy?.getAttribute('data-concept-type-scale')||0),bodySize:Number(getComputedStyle(body).fontSize.replace('px','')),scrollHeight:scroller?.scrollHeight||0,clientHeight:scroller?.clientHeight||0};});
    if(spaciousType.bodySize<=14||spaciousType.scrollHeight>spaciousType.clientHeight+1)throw new Error(`Spacious concept typography did not fit cleanly: ${JSON.stringify(spaciousType)}`);
    await page.setViewportSize(viewports.tablet);
    await page.waitForFunction(()=>!document.querySelector('.ds-step:not([hidden]) .ds-concept-copy')?.hasAttribute('data-concept-type-scale'));
    const compactBodySize=await page.locator('.ds-step:not([hidden]) .ds-concept-body').evaluate((body)=>Number(getComputedStyle(body).fontSize.replace('px','')));
    if(compactBodySize!==14)throw new Error(`Compact concept typography retained a desktop fit: ${compactBodySize}px`);
    await page.setViewportSize(viewports.desktop);await page.waitForTimeout(80);

    await gotoStoryStep(page,3);await waitForStoryStep(page,3,'paired-code');
    const pairedDock=await sceneDockRect(page);
    await gotoStoryStep(page,8);await waitForStoryStep(page,8,'code-focus');
    const focusDock=await sceneDockRect(page);
    if([pairedDock,focusDock].some((rect)=>Math.abs(rect.top-logicDock.top)>1||Math.abs(rect.height-logicDock.height)>1))throw new Error(`Dock geometry moved between code scenes: ${JSON.stringify({logicDock,pairedDock,focusDock})}`);

    await gotoStoryStep(page,1);await waitForStoryStep(page,1,'logic-move');
    for(const mode of ['diff','split','full']){
      await click(page,`.ds-step:not([hidden]) [data-mode="${mode}"]`);
      const active=await page.locator(`.ds-step:not([hidden]) [data-mode="${mode}"]`).first().getAttribute('class');
      if(!active?.includes('is-active'))throw new Error(`Code mode ${mode} did not become active.`);
    }

    await gotoStoryStep(page,3);await waitForStoryStep(page,3,'paired-code');
    for(let i=0;i<8;i++){await page.keyboard.press('j');await page.keyboard.press('k');}
    await page.keyboard.press('j');await page.waitForTimeout(500);
    const rapid=await page.evaluate(()=>{const panel=document.querySelector('.ds-step:not([hidden])'),node=document.querySelector('[data-thread-node].is-active');return {panel:Number(panel?.getAttribute('data-step-panel')),node:Number(node?.getAttribute('data-thread-node'))};});
    if(rapid.panel!==4||rapid.node!==4)throw new Error(`Rapid navigation desynchronized scene and filmstrip: ${JSON.stringify(rapid)}`);
    for(const [index,count] of stepFetches){if(count>1)throw new Error(`Lazy step ${index} fetched ${count} times during interaction replay.`);}
  }finally{await context.close();}

  const reduced=await browser.newContext({viewport:viewports.desktop,colorScheme:'dark',reducedMotion:'reduce'});
  const reducedPage=await reduced.newPage();
  await reducedPage.addInitScript(()=>{window.__atlasSceneAnimations=[];const original=Element.prototype.animate;Element.prototype.animate=function(keyframes,options){if(this.closest?.('[data-scene-layout]'))window.__atlasSceneAnimations.push({keyframes,options});return original.call(this,keyframes,options);};});
  try{
    await reducedPage.goto(origin+route,{waitUntil:'domcontentloaded'});await settled(reducedPage);
    await gotoStoryStep(reducedPage,2);await waitForStoryStep(reducedPage,2,'concept-diagram');
    const reducedCount=await reducedPage.evaluate(()=>window.__atlasSceneAnimations.length);
    if(reducedCount)throw new Error(`Reduced motion still ran ${reducedCount} scene entrance animation(s).`);
  }finally{await reduced.close();}
  console.log('verified story-scene interaction replay (lazy fetches, modes, dock, rapid navigation, motion)');
}

async function assertChangeMotionReplay(browser,origin){
  const route=`/repo/${encodeURIComponent(basename(FIXTURE))}/change?scope=uncommitted`;
  const context=await browser.newContext({viewport:viewports.desktop,colorScheme:'dark',reducedMotion:'no-preference'});
  const page=await context.newPage();
  const panelState=()=>page.evaluate(()=>{
    const read=(id)=>{const node=document.getElementById(id);if(!node)throw new Error(`${id} is missing`);const style=getComputedStyle(node),rect=node.getBoundingClientRect();return {height:rect.height,opacity:Number(style.opacity),hidden:node.hidden,inert:node.inert,ariaHidden:node.getAttribute('aria-hidden')};};
    return {commit:read('commitPanel'),compare:read('comparePanel')};
  });
  try{
    await page.goto(origin+route,{waitUntil:'domcontentloaded'});await settled(page);
    const resting=await panelState();
    if(resting.compare.height>1||!resting.compare.inert)throw new Error(`Closed compare editor is still interactive: ${JSON.stringify(resting.compare)}`);

    await page.locator('[data-open-panel="compare"]').click();
    await page.waitForTimeout(70);
    const opening=await panelState();
    if(opening.compare.height<=1||opening.compare.opacity<=0)throw new Error(`Compare editor did not unfold from its trigger: ${JSON.stringify(opening.compare)}`);

    await page.locator('[data-open-panel="commit"]').click();
    await page.waitForTimeout(70);
    const interrupted=await panelState();
    if(interrupted.commit.height<=1||interrupted.compare.height<=1)throw new Error(`Panel switch did not retarget through the live presentation: ${JSON.stringify(interrupted)}`);
    await page.waitForTimeout(360);
    const settledPanels=await panelState();
    if(settledPanels.commit.height<60||settledPanels.commit.inert||settledPanels.compare.height>1||!settledPanels.compare.inert)throw new Error(`Panel switch did not settle on the commit editor: ${JSON.stringify(settledPanels)}`);

    await page.locator('#commitRef').focus();
    await page.waitForTimeout(70);
    const pickerOpening=await page.locator('#refPicker').evaluate((node)=>{const style=getComputedStyle(node);return {hidden:node.hidden,opacity:Number(style.opacity),placement:node.dataset.placement,origin:style.transformOrigin};});
    if(pickerOpening.hidden||pickerOpening.opacity<=0||!pickerOpening.placement)throw new Error(`Ref picker did not materialize from its field: ${JSON.stringify(pickerOpening)}`);
    await page.waitForTimeout(240);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    const pickerClosing=await page.locator('#refPicker').evaluate((node)=>({hidden:node.hidden,inert:node.inert,ariaHidden:node.getAttribute('aria-hidden'),opacity:Number(getComputedStyle(node).opacity)}));
    if(pickerClosing.hidden||!pickerClosing.inert||pickerClosing.ariaHidden!=='true'||pickerClosing.opacity>=1)throw new Error(`Ref picker did not retrace its exit while becoming inert: ${JSON.stringify(pickerClosing)}`);
    await page.waitForTimeout(220);
    if(!(await page.locator('#refPicker').evaluate((node)=>node.hidden)))throw new Error('Ref picker stayed laid out after its exit finished.');
  }finally{await context.close();}

  const reduced=await browser.newContext({viewport:viewports.desktop,colorScheme:'dark',reducedMotion:'reduce'});
  const reducedPage=await reduced.newPage();
  try{
    await reducedPage.goto(origin+route,{waitUntil:'domcontentloaded'});await settled(reducedPage);
    await reducedPage.locator('[data-open-panel="compare"]').click();
    await reducedPage.waitForTimeout(30);
    const reducedPanel=await reducedPage.locator('#comparePanel').evaluate((node)=>({height:node.getBoundingClientRect().height,opacity:Number(getComputedStyle(node).opacity)}));
    if(reducedPanel.height<60||reducedPanel.opacity!==1)throw new Error(`Reduced motion left the compare editor between states: ${JSON.stringify(reducedPanel)}`);
  }finally{await reduced.close();}
  console.log('verified change-page motion replay (open, midpoint, interruption, exit, reduced motion)');
}

async function main(){
  const executable=browserExecutable();if(!executable)throw new Error('Install Google Chrome or Microsoft Edge, or set CODESTORY_ATLAS_BROWSER.');
  mkdirSync(SHOTS,{recursive:true});for(const old of definitions)rmSync(join(SHOTS,`${old.category}-${old.state}.png`),{force:true});
  execFileSync(process.execPath,[join(ROOT,'examples','demo.mjs')],{cwd:ROOT,env:{...process.env,CODESTORY_DEMO_DIR:FIXTURE,CODESTORY_DEMO_NO_SERVE:'1'},stdio:'pipe'});copyFileSync(STORY,STORY_HOLD);
  seedBrowsableHome();
  const fake=join(HOME,'codex-atlas');fakeCodex(fake);const port=await freePort();const origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,[join(ROOT,'dist','app-server.js'),'--dir',FIXTURE,'--port',String(port),'--no-open'],{cwd:ROOT,env:{...process.env,HOME,CODESTORY_CODEX_BINARY:fake},stdio:['ignore','pipe','pipe']});
  let serverLog='';server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);
  let browser;
  try{
    await waitReady(origin,server);browser=await chromium.launch({headless:true,executablePath:executable,args:['--font-render-hinting=none']});const context=await browser.newContext({viewport:viewports.desktop,colorScheme:'dark',reducedMotion:'reduce'});const page=await context.newPage();
    const shots=[];
    for(const def of definitions){
      setStoryForSurface(def.surface);
      await page.setViewportSize(viewports[def.viewport]);await page.addInitScript(themeInit(def.theme));
      // Only the progress panel reads prefers-color-scheme; every other surface
      // is driven by ds-theme, so the emulation stays dark for them.
      const motionEvidence=['history-glance','narration-active','code-step-dock','comment-copy-success','change-refpicker'].includes(def.surface);
      await page.emulateMedia({colorScheme:def.surface.startsWith('pp-')&&def.theme==='light'?'light':'dark',reducedMotion:motionEvidence?'no-preference':'reduce'});
      let runtimeRoute=def.route.replace('/repo/codestory-atlas-fixture',`/repo/${encodeURIComponent(basename(FIXTURE))}`);
      if(runtimeRoute.endsWith('/review'))runtimeRoute+='?story=story.json';
      await page.goto(origin+runtimeRoute,{waitUntil:'domcontentloaded'});await settled(page);
      if(def.surface==='picker-recent'){
        await openFixtureRepo(page,origin,'/repos');
      }else if(def.surface==='picker-remove-undo'){
        await openFixtureRepo(page,origin,'/repos');
        await click(page,'button[aria-label^="Remove "]');
        await page.waitForFunction(()=>document.querySelector('[data-picker-status] button')?.textContent?.trim()==='Undo');
      }else if(def.surface==='picker-empty'){
        await forgetAllRecents(page);await page.goto(origin+'/repos');await settled(page);
      }else if(def.surface==='picker-modal'){
        await openFixtureRepo(page,origin,'/repos');
        await click(page,'#quickAddBtn');
        await page.waitForFunction(()=>{const scrim=document.querySelector('.ds-scrim');const list=document.querySelector('#fslist');return !!scrim&&!scrim.hidden&&scrim.classList.contains('is-shown')&&!!list&&!/Loading…/.test(list.textContent||'');},undefined,{timeout:5000});
        await page.waitForTimeout(240);
      }else if(def.surface==='history-populated'||def.surface==='history-empty'||def.surface==='history-glance'){
        await openFixtureRepo(page,origin,runtimeRoute);
        if(def.surface==='history-glance'){
          await page.locator('#storyList .row-main').first().hover();
          await page.waitForFunction(()=>{const detail=document.querySelector('.story-glance-detail');return !!detail&&parseFloat(getComputedStyle(detail).opacity)>.95;});
        }
      }else if(def.surface==='change-refpicker'){
        await click(page,'[data-open-panel="compare"]');
        await page.locator('#cmpBase').focus();
        await page.waitForFunction(()=>{const picker=document.querySelector('#refPicker');return !!picker&&!picker.hidden&&!!picker.querySelector('.refpick-row');},undefined,{timeout:5000});
        await page.waitForTimeout(240);
      }else if(def.surface==='raw-diff'){
        await page.waitForFunction(()=>{const panel=document.querySelector('.ds-filepanel:not([hidden])');if(!panel)return false;if(panel.querySelector('.ds-differror'))return true;return Array.from(panel.querySelectorAll('[data-comment-code]')).some((node)=>node.getBoundingClientRect().height>0);},undefined,{timeout:15000});
        await page.waitForTimeout(240);
      }else if(def.surface==='narration-active'){
        await page.evaluate(()=>{
          const button=document.querySelector('[data-readaloud]');if(!button)throw new Error('The narration control is missing.');
          button.classList.add('is-active','is-audible');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','Pause narration');
          const label=button.querySelector('[data-readaloud-label]'),icon=button.querySelector('.ds-readaloud-ico');if(label)label.textContent='Pause';if(icon){icon.classList.remove('is-play');icon.classList.add('is-pause');}
        });
        await page.waitForTimeout(180);
      }else if(def.surface==='evolution-open'){
        await click(page,'.ds-intro-evolution > summary');
      }else if(def.surface==='code-step'){
        await gotoStoryStep(page,1);
      }else if(def.surface==='code-step-dock'){
        await gotoStoryStep(page,1);await waitForStoryStep(page,1,'logic-move');
        const target=page.locator('[data-thread-node="4"]').first();
        const box=await target.boundingBox();if(!box)throw new Error('The proximity-dock target is not visible.');
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(180);
      }else if(def.surface==='code-focus'||def.surface==='code-focus-mobile'){
        await gotoStoryStep(page,8);
      }else if(def.surface==='paired-code'){
        await gotoStoryStep(page,3);
      }else if(def.surface==='concept-step'||def.surface==='concept-step-evidence'||def.surface==='concept-document'||def.surface==='concept-tall'){
        await gotoStoryStep(page,1);await gotoStoryStep(page,2);
        if(def.surface!=='concept-document')await page.waitForFunction(()=>{const diagram=document.querySelector('.ds-step:not([hidden]) [data-concept-diagram]');return !!diagram&&['ready','error'].includes(diagram.getAttribute('data-render-state'));});
        if(def.surface==='concept-step-evidence')await page.evaluate(()=>{const diagram=document.querySelector('.ds-step:not([hidden]) [data-concept-diagram]'),scroller=diagram?.closest('.ds-concept-scroll');if(!diagram||!scroller)throw new Error('Concept diagram or its scroller is missing.');const dr=diagram.getBoundingClientRect(),sr=scroller.getBoundingClientRect();scroller.scrollTop+=dr.top-sr.top-18;});
      }else if(def.surface==='files-unified'||def.surface==='files-split'){
        await click(page,'#ds-tab-files');if(def.surface==='files-split'){await click(page,'.ds-filepanel:not([hidden]) [data-mode="split"]');await page.waitForFunction(()=>document.querySelector('.ds-filepanel:not([hidden]) [data-split-inner]')?.getAttribute('aria-busy')==='false');}
      }else if(def.surface==='editor-menu-open'){
        await gotoStoryStep(page,1);
        await waitForStoryStep(page,1,'logic-move');
        await click(page,'.ds-editor-toggle');
        await page.waitForSelector('.ds-editor-menu:not([hidden])',{state:'visible',timeout:5000});
      }else if(def.surface==='review-menu'){
        await click(page,'#ds-tab-review');await assertReviewPageVisible(page);
      }else if(def.surface==='comment-queue'||def.surface==='mobile-comments'||def.surface==='comment-copy-success'){
        await click(page,'#ds-tab-review');await click(page,'[data-review-tab-select="notes"]');
        if(def.surface==='comment-copy-success'){
          await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.resolve()}}));
          await click(page,'[data-copy-comments]');
          await page.waitForSelector('[data-copy-comments].is-copied',{state:'attached',timeout:5000});
        }
      }else if(def.surface==='comment-composer'||def.surface==='mobile-comment-composer'){
        await click(page,'[data-goto-step="1"]');
        // The step's diff body is lazily loaded, so a fixed 240ms after the
        // click is not enough to have a selectable row on screen.
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ds-step:not([hidden]) [data-comment-code][data-comment-side="right"]')).some((node)=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;}),undefined,{timeout:15000});
        await page.evaluate(()=>{const code=Array.from(document.querySelectorAll('.ds-step:not([hidden]) [data-comment-code][data-comment-side="right"]')).find(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;});if(!code)throw new Error('No visible selectable code row found.');const range=document.createRange();range.selectNodeContents(code);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
        await page.keyboard.press('c');
        await page.waitForSelector('.ds-composer',{state:'attached',timeout:5000});
        await page.waitForFunction(()=>{const node=document.querySelector('.ds-composer'),scroller=node?.closest('.ds-diffscroll, .ds-filedetail');if(!node||!scroller)return false;const rect=node.getBoundingClientRect(),sr=scroller.getBoundingClientRect(),card=node.closest('.ds-diff'),sticky=card?Array.from(card.querySelectorAll('.ds-difftoolbar,.ds-diffhead')).filter(part=>getComputedStyle(part).position==='sticky'):[],top=sr.top+sticky.reduce((sum,part)=>sum+part.getBoundingClientRect().height,0);return rect.top>=top-1&&rect.bottom<=sr.bottom+1;},undefined,{timeout:5000});
        const composer=await page.evaluate(()=>{const node=document.querySelector('.ds-composer'),style=getComputedStyle(node),rect=node.getBoundingClientRect();return {position:style.position,width:rect.width,height:rect.height,inline:node.parentElement?.classList.contains('ds-diffbody'),modal:node.getAttribute('aria-modal')};});
        if(composer.position==='fixed'||!composer.inline||composer.modal||!composer.width||!composer.height)throw new Error(`Comment composer is not inline and visible: ${JSON.stringify(composer)}`);
      }else if(def.surface==='comment-anchor'){
        await click(page,'#ds-tab-review');await click(page,'[data-review-tab-select="notes"]');await click(page,'[data-goto-comment]');await page.waitForFunction(()=>!!document.querySelector('.ds-comment-anchor-target'),undefined,{timeout:5000});
      }else if(def.surface==='pp-stage'){
        // The diff route opens on the Files view, so the storyless intro that
        // hosts the stage variant is present but not on screen.
        await click(page,'#ds-tab-tour');
        await mountPanelInStage(page);await progressState(page,'running');
        await page.evaluate(()=>document.getElementById('ds-storystage')?.scrollIntoView({block:'center'}));await page.waitForTimeout(240);
      }else if(def.surface.startsWith('pp-')){
        await progressState(page,def.surface.replace('pp-detail-','').replace('pp-',''));
      }
      await page.waitForFunction(()=>!/Loading (?:the split view|this review step)/i.test(document.body.innerText));
      if(def.viewport==='desktop'&&['overview','code-step','code-step-dock','code-focus','paired-code'].includes(def.surface))await assertReviewStageGeometry(page);
      const degraded=await assertRendered(page,def);
      const file=`screenshots/${def.category}-${def.state}.png`,target=join(OUT,file);
      let size;
      if(def.surface.startsWith('pp-detail-')){
        const element=page.locator(PANEL).first();
        await element.screenshot({path:target});
        const box=await element.boundingBox();
        size={width:Math.round(box.width),height:Math.round(box.height)};
      }else{
        await page.screenshot({path:target,fullPage:false});
        size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
      }
      if(!existsSync(target))throw new Error(`${def.state} produced no file at ${file}`);
      const bytes=readFileSync(target).length;
      if(bytes<2000)throw new Error(`${def.state} produced a suspiciously small ${bytes}-byte PNG`);
      const route=def.route.endsWith('/review')?`${def.route}?story=story.json`:def.route;
      shots.push({category:def.category,title:def.title,description:def.description,state:def.state,theme:def.theme,viewport:def.viewport,surface:def.surface,route,file,width:size.width,height:size.height,...(degraded?{degraded}:{})});
      console.log(`captured ${file} (${size.width}x${size.height}, ${bytes} bytes)`);
    }
    await assertChangeMotionReplay(browser,origin);
    await assertStoryInteractionReplay(browser,origin);
    const source=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();const dirty=execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim();const manifest={version:1,generatedAt:new Date().toISOString(),source:`commit ${source}${dirty?' + working tree':''} · deterministic demo`,shots};const json=JSON.stringify(manifest,null,2)+'\n';writeFileSync(join(OUT,'manifest.json'),json);writeFileSync(join(OUT,'manifest.js'),`window.CODESTORY_UI_ATLAS=${JSON.stringify(manifest)};\n`);console.log(`\nUI atlas: ${relative(ROOT,OUT)}/index.html (${shots.length} frames)`);
    const degradedShots=shots.filter((shot)=>shot.degraded);
    if(degradedShots.length)console.log(`\n${degradedShots.length} frame(s) captured a degraded surface:\n${degradedShots.map((shot)=>`  ${shot.state} — ${shot.degraded}`).join('\n')}`);
  }catch(error){throw new Error(`${error.message}\n${serverLog.trim()}`);}finally{if(browser)await browser.close();server.kill('SIGTERM');rmSync(FIXTURE,{recursive:true,force:true});rmSync(HOME,{recursive:true,force:true});}
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
