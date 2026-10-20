import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const RUN='/Users/naveed/Codes/blockchain/symmio/SmartDiffChecker/.better-ui-app/20261020-0812-full-app';
const OUT=join(RUN,'screens'); const ORIGIN='http://localhost:7777'; const REPO='codestory-demo-cap';
const LONG_BRANCH='feat/'+'x'.repeat(85);
const exe=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const browser=await chromium.launch({executablePath:exe,headless:true});
async function settled(p){await p.waitForLoadState('domcontentloaded').catch(()=>{});await p.waitForTimeout(500);}
// S4: open longline.ts in diff rail
{
  const c=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark'});
  await c.addInitScript(()=>{try{localStorage.setItem('ds-theme','dark')}catch{}});
  const p=await c.newPage();
  await p.goto(`${ORIGIN}/repo/${REPO}/diff?base=main&head=${encodeURIComponent(LONG_BRANCH)}`); await settled(p);
  try{ await p.getByText('longline.ts').first().click(); await p.waitForTimeout(700); console.log('clicked longline'); }catch(e){ console.log('longline click',e.message); }
  await p.screenshot({path:join(OUT,'stress-S4-diff-longline-file-1440x900-dark.png')});
  console.log('body has zzz', await p.evaluate(()=>document.body.innerText.includes('zzz')));
  await c.close();
}
// Progress: mount floating panel into a visible host appended to review page (atlas pattern, own panel)
{
  const c=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark'});
  await c.addInitScript(()=>{try{localStorage.setItem('ds-theme','dark')}catch{}});
  const p=await c.newPage();
  await p.goto(`${ORIGIN}/repo/${REPO}/review?story=story.json`); await settled(p);
  await p.addScriptTag({type:'module',url:'/assets/client/progress.js'});
  await p.waitForFunction(()=>typeof window.codeStoryProgress?.mount==='function',undefined,{timeout:5000});
  await p.evaluate(()=>{
    let host=document.getElementById('ds-agentpanel');
    if(!host){host=document.createElement('div');host.id='ds-agentpanel';host.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;width:520px;';document.body.appendChild(host);}
    const panel=window.codeStoryProgress.mount(host,{variant:'floating'}); window.__p=panel; panel.start();
    panel.handle({type:'run_started',workflow:'guided_review'});
    panel.handle({type:'context',agent:'codex',model:'fixture-model',repoName:'codestory-demo-cap',base:'main',head:'feat/spending-limit'});
    panel.handle({type:'phase',phase:'reading_changes'});
    panel.handle({type:'plan',items:[{text:'Read every changed file and recover the intent',status:'done'},{text:'Design a reading path across the spending-limit change',status:'active'},{text:'Write the story and verify each code anchor',status:'pending'}]});
    panel.handle({type:'file',label:'Reading changed files · 3 of 8 · src/limits.ts'});
    panel.handle({type:'activity',kind:'narration',label:'Fixture activity: the monthly cap moved into a ledger.'});
    panel.handle({type:'heartbeat',quietMs:9000});
  });
  await p.waitForTimeout(600);
  const has=await p.evaluate(()=>!!document.querySelector('[data-progress-panel]'));
  console.log('panel present',has);
  await p.screenshot({path:join(OUT,'progress-running-1440x900-dark.png')});
  // complete state
  await p.evaluate(()=>{window.__p.handle({type:'phase',phase:'validating_output'});window.__p.handle({type:'run_done',status:'complete',result:{storyWritten:true}});});
  await p.waitForTimeout(500);
  await p.screenshot({path:join(OUT,'progress-complete-1440x900-dark.png')});
  await c.close();
}
await browser.close(); console.log('fix done');
