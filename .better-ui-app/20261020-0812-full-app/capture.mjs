// Capture agent script — writes only screens/ + observations.json in run folder.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN = '/Users/naveed/Codes/blockchain/symmio/SmartDiffChecker/.better-ui-app/20261020-0812-full-app';
const OUT = join(RUN, 'screens'); mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:7777';
const DEMO = '/tmp/codestory-demo-cap';
const REPO = 'codestory-demo-cap';
const obs = { captures: [], failed: [], consoleErrors: {}, notes: {} };
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });

async function settled(page) {
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForFunction(() => document.fonts ? document.fonts.status === 'loaded' : true).catch(()=>{});
  await page.waitForTimeout(450);
}
async function shot(page, name, screen, viewport, theme, state, notes='') {
  const file = `${name}.png`;
  try {
    await page.screenshot({ path: join(OUT, file) });
    const info = await page.evaluate(() => ({ title: document.title, text: (document.body.innerText||'').trim().slice(0,120), sw: document.documentElement.scrollWidth, iw: innerWidth, err: !!document.querySelector('.ds-differror') }));
    obs.captures.push({ file, screen, viewport, theme, state, notes: notes + ` | title=${info.title} overflowX=${info.sw - info.iw}px differror=${info.err}` });
    console.log('OK', file, info.title);
  } catch (e) { obs.failed.push({ file, reason: String(e.message||e) }); console.log('FAIL', file, e.message); }
}
async function ctx(viewport, theme, reduced='no-preference') {
  const c = await browser.newContext({ viewport, colorScheme: theme, reducedMotion: reduced });
  await c.addInitScript(t => { try { localStorage.setItem('ds-theme', t); } catch {} }, theme);
  const p = await c.newPage(); p.setDefaultTimeout(12000);
  const errs=[]; p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  p.__errs = errs;
  return [c, p];
}
// open demo repo
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN + '/repos'); await settled(p);
  await p.evaluate(async path => { await fetch('/api/repo/open', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})}); }, DEMO);
  obs.notes.repoOpen = await p.evaluate(async () => (await fetch('/api/repos/recent').then(r=>r.json()).catch(()=>[])).slice(0,3));
  await c.close();
}
const routes = [
  ['picker', '/repos', 'picker'],
  ['stories', `/repo/${REPO}/stories`, 'stories'],
  ['change', `/repo/${REPO}/change?base=main&head=feat%2Fspending-limit`, 'change'],
  ['review', `/repo/${REPO}/review?story=story.json`, 'review'],
  ['explain', `/repo/${REPO}/explain`, 'explain'],
  ['diff', `/repo/${REPO}/diff?base=main&head=feat%2Fspending-limit`, 'diff'],
];
const viewports = [['375x812',{width:375,height:812}],['768x1024',{width:768,height:1024}],['1440x900',{width:1440,height:900}]];
for (const [screen, route, slug] of routes) {
  for (const [vname, vp] of viewports) {
    for (const theme of ['dark','light']) {
      const [c,p] = await ctx(vp, theme);
      try { await p.goto(ORIGIN+route); await settled(p); await shot(p, `${slug}-${vname}-${theme}`, screen, vname, theme, 'loaded'); }
      catch(e){ obs.failed.push({file:`${slug}-${vname}-${theme}.png`, reason:String(e.message||e)}); }
      obs.consoleErrors[`${slug}-${vname}-${theme}`] = p.__errs.slice(0,5);
      await c.close();
    }
  }
}
// 320px + 200% zoom (pageScaleFactor 2 at 720 css width -> effective 360, plus 320 direct)
for (const [screen, route, slug] of [['picker','/repos','picker'],['review',`/repo/${REPO}/review?story=story.json`,'review'],['change',`/repo/${REPO}/change?base=main&head=feat%2Fspending-limit`,'change']]) {
  const [c,p] = await ctx({width:320,height:700}, 'dark');
  try { await p.goto(ORIGIN+route); await settled(p); await shot(p, `${slug}-320-dark`, screen, '320x700', 'dark', 'reflow-320'); } catch(e){ obs.failed.push({file:`${slug}-320`,reason:String(e.message||e)}); }
  await c.close();
  // 200% zoom via CDP scale
  const [c2,p2] = await ctx({width:1440,height:900}, 'dark');
  try {
    const s = await c2.newCDPSession(p2); await s.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await p2.goto(ORIGIN+route); await settled(p2); await shot(p2, `${slug}-zoom200-dark`, screen, '1440x900@200%', 'dark', 'zoom200');
  } catch(e){ obs.failed.push({file:`${slug}-zoom200`,reason:String(e.message||e)}); }
  await c2.close();
}
// Reduced motion + empty/error/loading cheap states
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark', 'reduce');
  await p.goto(ORIGIN+`/repo/${REPO}/review?story=story.json`); await settled(p);
  await shot(p, 'review-1440x900-dark-reduced-motion', 'review', '1440x900', 'dark', 'reduced-motion');
  obs.notes.reducedMotionAnimations = await p.evaluate(() => ({ mq: matchMedia('(prefers-reduced-motion: reduce)').matches }));
  await c.close();
}
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN+`/repo/${REPO}/change?scope=uncommitted`); await settled(p);
  await shot(p, 'change-empty-1440x900-dark', 'change', '1440x900', 'dark', 'empty-working-tree');
  await p.goto(ORIGIN+'/repo/nonexistent-repo-xyz/stories'); await settled(p);
  await shot(p, 'stories-badrepo-1440x900-dark', 'stories', '1440x900', 'dark', 'error-bad-repo-route');
  await p.goto(ORIGIN+`/repo/${REPO}/review?story=does-not-exist.json`); await settled(p);
  await shot(p, 'review-missing-story-1440x900-dark', 'review', '1440x900', 'dark', 'error-missing-story');
  await c.close();
}
// Folder browser modal (picker)
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN+'/repos'); await settled(p);
  // click first add/open folder button by text heuristics
  const btn = p.getByRole('button').filter({hasText:/open|browse|add|choose/i}).first();
  try { await btn.click({timeout:4000}); await p.waitForTimeout(600); } catch(e){ obs.notes.pickerModal = 'button not found: '+e.message; }
  await shot(p, 'picker-modal-1440x900-dark', 'picker', '1440x900', 'dark', 'folder-browser-modal');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  obs.notes.pickerModalAfterEscape = await p.evaluate(()=>document.body.innerText.slice(0,80));
  await c.close();
}
// Ref picker open on change
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN+`/repo/${REPO}/change?base=main&head=feat%2Fspending-limit`); await settled(p);
  try { await p.locator('[data-open-panel="compare"], button:has-text("Compare")').first().click({timeout:4000}); await p.waitForTimeout(500); } catch(e){ obs.notes.refPicker='click failed '+e.message; }
  await shot(p, 'change-refpicker-1440x900-dark', 'change', '1440x900', 'dark', 'ref-picker-open-attempt');
  await c.close();
}
// Review interactions: start walkthrough, step nav, All files tab
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN+`/repo/${REPO}/review?story=story.json`); await settled(p);
  try { await p.locator('.ds-intro-start').click({timeout:5000}); await p.waitForTimeout(800); } catch(e){ obs.notes.reviewStart='no intro start: '+e.message; }
  await shot(p, 'review-step-1440x900-dark', 'review', '1440x900', 'dark', 'walkthrough-step-after-start');
  // keyboard step nav
  try { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500); await shot(p, 'review-step-next-1440x900-dark', 'review', '1440x900', 'dark', 'after-ArrowRight'); } catch(e){}
  // rapid nav (motion scenario: repeat transition)
  try { for(let i=0;i<6;i++) await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); await shot(p, 'review-rapid-nav-1440x900-dark', 'review', '1440x900', 'dark', 'rapid-ArrowRight-x6'); } catch(e){}
  // All files / tabs if present
  try { await p.locator('[data-review-tab-select="files"], #ds-tab-files, button:has-text("All files")').first().click({timeout:4000}); await p.waitForTimeout(600); await shot(p, 'review-allfiles-1440x900-dark', 'review', '1440x900', 'dark', 'all-files-tab'); } catch(e){ obs.notes.allFiles='tab click failed '+e.message; }
  await c.close();
}
// Progress panel via shipped bridge (same pattern as scripts/capture-ui-atlas.mjs)
{
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  try {
    await p.goto(ORIGIN+`/repo/${REPO}/diff?base=main&head=feat%2Fspending-limit`); await settled(p);
    await p.addScriptTag({type:'module', url:'/assets/client/progress.js'});
    await p.waitForFunction(()=>typeof window.codeStoryProgress?.mount==='function', undefined, {timeout:5000});
    await p.evaluate(()=>{
      const wrap=document.querySelector('.ds-step.is-intro .ds-introwrap')||document.body;
      let host=document.getElementById('ds-storystage'); if(!host){host=document.createElement('div');host.id='ds-storystage';wrap.prepend(host);}
      const panel=window.codeStoryProgress.mount(host,{variant:'stage'}); panel.start();
      panel.handle({type:'run_started',workflow:'guided_review'});
      panel.handle({type:'context',agent:'codex',model:'fixture',repoName:'codestory-demo-cap',base:'main',head:'feat/spending-limit'});
      panel.handle({type:'phase',phase:'reading_changes'});
      panel.handle({type:'plan',items:[{text:'Read every changed file',status:'done'},{text:'Design reading path',status:'active'},{text:'Write story',status:'pending'}]});
      panel.handle({type:'activity',kind:'narration',label:'Fixture activity for capture.'});
    });
    await p.waitForTimeout(500);
    await shot(p, 'progress-running-1440x900-dark', 'progress', '1440x900', 'dark', 'running-fixture-events');
  } catch(e){ obs.failed.push({file:'progress-running-1440x900-dark.png', reason:String(e.message||e)}); obs.notes.progress=String(e.message||e); }
  await c.close();
}
// Keyboard Tab order — picker and review
async function tabOrder(route, label, max=25) {
  const [c,p] = await ctx({width:1440,height:900}, 'dark');
  await p.goto(ORIGIN+route); await settled(p);
  const stops=[];
  for(let i=0;i<max;i++){
    await p.keyboard.press('Tab');
    const s = await p.evaluate(()=>{
      const el=document.activeElement; if(!el||el===document.body) return {tag:'BODY',text:''};
      const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
      return {tag:el.tagName, role:el.getAttribute('role')||'', text:(el.innerText||el.getAttribute('aria-label')||el.value||'').trim().slice(0,60), visibleFocus: cs.outlineStyle!=='none'||cs.boxShadow!=='none', rect:`${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`};
    });
    stops.push(s);
    if(i===2) await shot(p, `${label}-tab-focus-1440x900-dark`, label, '1440x900', 'dark', `tab-stop-${i+1}-focused`);
  }
  obs.notes[`tabOrder-${label}`]=stops;
  // shift-tab back check + escape trap check on picker
  await c.close();
}
await tabOrder('/repos','picker');
await tabOrder(`/repo/${REPO}/review?story=story.json`,'review');

writeFileSync(join(RUN,'observations.json'), JSON.stringify(obs,null,2));
await browser.close();
console.log('DONE captures', obs.captures.length, 'failed', obs.failed.length);
