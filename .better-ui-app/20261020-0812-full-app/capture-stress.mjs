import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const RUN='/Users/naveed/Codes/blockchain/symmio/SmartDiffChecker/.better-ui-app/20261020-0812-full-app';
const OUT=join(RUN,'screens'); mkdirSync(OUT,{recursive:true});
const ORIGIN='http://localhost:7777'; const REPO='codestory-demo-cap';
const LONG_BRANCH='feat/'+'x'.repeat(85);
const LONG_REPO='/tmp/'+'very-long-repository-name-'.repeat(3);
const obs={captures:[],failed:[],notes:{}};
const exe=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const browser=await chromium.launch({executablePath:exe,headless:true});
async function settled(p){await p.waitForLoadState('domcontentloaded').catch(()=>{});await p.waitForFunction(()=>document.fonts?document.fonts.status==='loaded':true).catch(()=>{});await p.waitForTimeout(500);}
async function shot(p,file,screen,state,notes=''){try{await p.screenshot({path:join(OUT,file)});const i=await p.evaluate(()=>({t:document.title,txt:(document.body.innerText||'').trim().slice(0,160),ox:document.documentElement.scrollWidth-innerWidth}));obs.captures.push({file,screen,state,notes:notes+` title=${i.t} overflowX=${i.ox} text=${JSON.stringify(i.txt)}`});console.log('OK',file,i.t);}catch(e){obs.failed.push({file,reason:String(e.message||e)});console.log('FAIL',file,e.message);}}
async function ctx(vp={width:1440,height:900},theme='dark'){const c=await browser.newContext({viewport:vp,colorScheme:theme});await c.addInitScript(t=>{try{localStorage.setItem('ds-theme',t)}catch{}},theme);const p=await c.newPage();p.setDefaultTimeout(12000);return[c,p];}
// S1+S4: long branch / long path / long line on change + diff
{
  const [c,p]=await ctx();
  await p.goto(`${ORIGIN}/repo/${REPO}/change?base=main&head=${encodeURIComponent(LONG_BRANCH)}`); await settled(p);
  await shot(p,'stress-S1S4-change-longbranch-1440x900-dark.png','change','S1-long-branch+S4-files','long branch head, long path file, longline.ts in file list');
  await p.goto(`${ORIGIN}/repo/${REPO}/diff?base=main&head=${encodeURIComponent(LONG_BRANCH)}`); await settled(p);
  await shot(p,'stress-S4-diff-longline-1440x900-dark.png','diff','S4-long-diff-line','500+ char unbroken line in diff');
  const [c2,p2]=await ctx({width:375,height:812});
  await p2.goto(`${ORIGIN}/repo/${REPO}/change?base=main&head=${encodeURIComponent(LONG_BRANCH)}`); await settled(p2);
  await shot(p2,'stress-S1-change-longbranch-375x812-dark.png','change','S1-long-branch-mobile','long branch at 375px');
  await c.close(); await c2.close();
}
// S3: 1-step and 42-step stories + stories list
{
  const [c,p]=await ctx();
  await p.goto(`${ORIGIN}/repo/${REPO}/stories`); await settled(p);
  await shot(p,'stress-S3-stories-list-1440x900-dark.png','stories','S3-story-list','list incl. one/many fixtures if enumerated');
  obs.notes.storiesListText=await p.evaluate(()=>document.body.innerText.slice(0,1200));
  await p.goto(`${ORIGIN}/repo/${REPO}/review?story=story-one.json`); await settled(p);
  await shot(p,'stress-S3-review-1step-1440x900-dark.png','review','S3-one-step','review with 1-step story');
  await p.goto(`${ORIGIN}/repo/${REPO}/review?story=story-many.json`); await settled(p);
  await shot(p,'stress-S3-review-42step-1440x900-dark.png','review','S3-42-steps','review with 42-step story');
  obs.notes.manyStepText=await p.evaluate(()=>document.body.innerText.slice(0,600));
  await c.close();
}
// S2: long repo name in recents + non-git open attempt
{
  const [c,p]=await ctx();
  await p.goto(ORIGIN+'/repos'); await settled(p);
  obs.notes.longRepoOpen=await p.evaluate(async path=>{const r=await fetch('/api/repo/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});return {status:r.status,body:(await r.text()).slice(0,300)};}, LONG_REPO.replace(/\/$/,''));
  obs.notes.nonGitOpen=await p.evaluate(async path=>{const r=await fetch('/api/repo/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});return {status:r.status,body:(await r.text()).slice(0,300)};}, '/tmp/not-a-git-folder-xyz');
  await p.goto(ORIGIN+'/repos'); await settled(p);
  await shot(p,'stress-S2-picker-longrepo-1440x900-dark.png','picker','S2-long-repo-name','recents after opening 78-char repo name');
  const [c2,p2]=await ctx({width:375,height:812});
  await p2.goto(ORIGIN+'/repos'); await settled(p2);
  await shot(p2,'stress-S2-picker-longrepo-375x812-dark.png','picker','S2-long-repo-mobile','long repo name at 375px');
  await c.close(); await c2.close();
  // restore demo as open repo
  const [c3,p3]=await ctx(); await p3.goto(ORIGIN+'/repos');
  await p3.evaluate(async path=>{await fetch('/api/repo/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});},'/tmp/codestory-demo-cap');
  await c3.close();
}
// S5: counts / zero comments — review notes tab text + change empty already captured; record counts text
{
  const [c,p]=await ctx();
  await p.goto(`${ORIGIN}/repo/${REPO}/review?story=story.json`); await settled(p);
  obs.notes.s5reviewText=await p.evaluate(()=>document.body.innerText.slice(0,1500));
  try{ await p.locator('.ds-intro-start').click({timeout:4000}); await p.waitForTimeout(600);}catch{}
  await shot(p,'stress-S5-review-counts-1440x900-dark.png','review','S5-counts','counts/steps/comments as rendered in demo (8 steps)');
  await c.close();
}
// Motion interactions: theme menu rapid open/close + reverse, change panel toggle mid-transition, composer dismiss during entry
{
  const [c,p]=await ctx();
  await p.goto(ORIGIN+'/repos'); await settled(p);
  obs.notes.motion=[];
  try{
    const themeBtn=p.locator('button[aria-label*="theme" i], [data-theme-menu] button, button:has-text("Theme")').first();
    for(let i=0;i<4;i++){ await themeBtn.click({timeout:3000}); await p.waitForTimeout(60); }
    await p.waitForTimeout(400);
    obs.notes.motion.push('theme menu toggled 4x at 60ms intervals, settled without error');
    await shot(p,'motion-theme-rapid-toggle-1440x900-dark.png','picker','motion-rapid-toggle','after rapid theme-menu toggles');
    await p.keyboard.press('Escape');
  }catch(e){ obs.notes.motion.push('theme toggle failed: '+e.message); }
  await p.goto(`${ORIGIN}/repo/${REPO}/change?scope=uncommitted`); await settled(p);
  try{
    await p.locator('[data-open-panel="compare"]').click(); await p.waitForTimeout(60);
    await p.locator('[data-open-panel="commit"]').click(); await p.waitForTimeout(60);
    await shot(p,'motion-change-panel-reverse-1440x900-dark.png','change','motion-reverse-mid-transition','compare->commit switch 60ms after open (mid-transition capture)');
    await p.waitForTimeout(600);
    await shot(p,'motion-change-panel-settled-1440x900-dark.png','change','motion-settled','same panels after settle');
  }catch(e){ obs.notes.motion.push('change panel reverse failed: '+e.message); }
  await c.close();
}
writeFileSync(join(RUN,'observations-stress.json'),JSON.stringify(obs,null,2));
await browser.close(); console.log('DONE',obs.captures.length,obs.failed.length);
