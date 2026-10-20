// Deterministic browser CI for the real app. Uses a throwaway repo, an isolated
// app home, and a fake local agent; never runs a real AI provider or editor.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../dist/server.js';
import { captureStorySnapshot } from '../dist/story-drift.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'codestory-browser-smoke-'));
const output = process.env.CODESTORY_SMOKE_OUT || join(scratch, 'screenshots');
mkdirSync(output, { recursive: true });
const bin = join(scratch, 'bin'); mkdirSync(bin);
const agentScript = join(scratch, 'fake-agent.mjs');
const control = join(scratch, 'agent-mode'); writeFileSync(control, 'good');
writeFileSync(agentScript, `import { readFileSync, writeFileSync } from 'node:fs';
const file = '.codestory/story.json'; const story = JSON.parse(readFileSync(file, 'utf8'));
if (readFileSync(${JSON.stringify(control)}, 'utf8') === 'bad') story.steps.find(s => s.id === 's6').title = 'Unrelated rewrite';
else story.steps.find(s => s.id === 's2').beats[1].text = 'It clamps the derived remaining budget to zero, then compares the amount with that nonnegative value; the equality boundary still needs review.';
writeFileSync(file, JSON.stringify(story, null, 2) + '\\n');
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Edit',input:{file_path:file}}]}}));
`);
writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${agentScript.replaceAll("'", "'\\''")}'\n`);
chmodSync(join(bin, 'claude'), 0o755);
const originalPath = process.env.PATH;
process.env.PATH = `${bin}:/usr/bin:/bin`;
const candidate = [process.env.CODESTORY_SMOKE_BROWSER, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
if (!candidate) throw new Error('Install Chromium with npx playwright-core install chromium, or set CODESTORY_SMOKE_BROWSER.');
const browser = await chromium.launch({ executablePath: candidate, headless: true });
let activePage;
try {
  for (const [name, viewport, reducedMotion] of [['desktop', {width:1440,height:960}, 'no-preference'], ['mobile-reduced-motion', {width:390,height:844}, 'reduce']]) {
    const repo = join(scratch, name), home = join(scratch, `${name}-home`);
    execFileSync(process.execPath, [join(root, 'examples/demo.mjs')], { cwd:root, env:{...process.env,CODESTORY_DEMO_NO_SERVE:'1',CODESTORY_DEMO_DIR:repo}, stdio:'pipe' });
    const storyPath = join(repo, '.codestory/story.json');
    const story = JSON.parse(readFileSync(storyPath, 'utf8'));
    delete story.head; delete story.evolution;
    story.storySnapshot = captureStorySnapshot({repo,base:'main',storyScope:{includedFiles:[...new Set(story.steps.filter(s=>s.kind!=='concept').map(s=>s.file))]}});
    writeFileSync(storyPath, JSON.stringify(story, null, 2)+'\n');
    const voiceModels=[
      {id:'kokoro',name:'Kokoro',detail:'Quick, clear English narration',ready:true,languages:['en'],voices:[{id:'af_heart',label:'Heart'},{id:'af_nicole',label:'Nicole'}]},
      {id:'pocket',name:'Pocket TTS',detail:'Conversational English voices',ready:true,languages:['en'],voices:[{id:'alba',label:'Alba'},{id:'marius',label:'Marius'}]},
      {id:'pocket-farsi',name:'Pocket TTS Farsi',ready:true,languages:['fa'],voices:[{id:'farsi_narrator',label:'Farsi narrator'}]},
    ];
    let narrator={ok:true,service:'aloud-speech-daemon',protocolVersion:2,engine:'kokoro',voice:'af_heart',rate:1,running:false,paused:false,state:{}};
    const server = serve({repo,homeOverride:home,port:0,open:false,openEditor:()=>true,aloud:{
      async status(){return narrator;},async models(){return voiceModels;},
      async configure(patch){narrator={...narrator,...patch,voice:patch.voice??(patch.engine?voiceModels.find(model=>model.id===patch.engine).voices[0].id:narrator.voice)};return narrator;},
      async prepare(){},async speak(){return {running:false};},async control(){return {running:false};}}});
    await once(server,'listening');
    const origin=`http://localhost:${server.address().port}`;
    const context=await browser.newContext({viewport,reducedMotion,colorScheme:'light'});
    const page=await context.newPage();page.setDefaultTimeout(12000);activePage=page;
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    // Capture clipboard writes in memory without depending on host permissions.
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__smokeClipboard=text;}}}));
    try {
      await page.goto(`${origin}/repo/${encodeURIComponent(basename(repo))}/review?story=story.json`);
      await page.locator('.ds-intro-start').waitFor();
      await page.getByRole('button',{name:'Export video',exact:true}).click();
      const exportDialog=page.getByRole('dialog',{name:'Export video',exact:true});
      await exportDialog.waitFor();
      await page.getByRole('combobox',{name:'Resolution',exact:true}).selectOption('720p');
      await page.getByRole('combobox',{name:'Reading speed',exact:true}).selectOption('1.25');
      const exportBounds=await exportDialog.boundingBox();
      assert.ok(exportBounds.x>=0&&exportBounds.y>=0&&exportBounds.x+exportBounds.width<=viewport.width&&exportBounds.y+exportBounds.height<=viewport.height);
      await page.screenshot({path:join(output,`${name}-video-export.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Export video',exact:true}).evaluate(node=>document.activeElement===node),true);
      await page.getByRole('button',{name:'Narration settings',exact:true}).click();
      const narrationModel=page.getByRole('combobox',{name:'Narration model',exact:true});
      const narrationVoice=page.getByRole('combobox',{name:'Narration voice',exact:true});
      await narrationModel.waitFor();
      assert.equal(await narrationModel.locator('option[value="pocket-farsi"]').evaluate(option=>option.disabled),true);
      const chooseNarrator=async(control,value)=>{
        await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/aloud/settings')&&response.request().method()==='PUT'),control.selectOption(value)]);
        await page.waitForFunction(()=>!document.querySelector('select[aria-label="Narration model"]').matches(':disabled'));
      };
      await chooseNarrator(narrationModel,'pocket');
      await chooseNarrator(narrationVoice,'marius');
      await chooseNarrator(page.getByRole('combobox',{name:'Narration playback speed',exact:true}),'1.25');
      assert.equal(narrator.engine,'pocket');assert.equal(narrator.voice,'marius');assert.equal(narrator.rate,1.25);
      const narratorBounds=await page.getByRole('dialog',{name:'Narration',exact:true}).boundingBox();
      assert.ok(narratorBounds.x>=0&&narratorBounds.y>=0&&narratorBounds.x+narratorBounds.width<=viewport.width&&narratorBounds.y+narratorBounds.height<=viewport.height);
      await page.screenshot({path:join(output,`${name}-narration.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Narration settings',exact:true}).evaluate(node=>document.activeElement===node),true);
      if(name==='desktop'){
        // A desktop rail preference must not make the hidden Story sidebar
        // inert the narration controls when the window is narrowed.
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('button',{name:'Narration settings',exact:true}).click();
        await narrationModel.waitFor();await page.keyboard.press('Escape');
        await page.setViewportSize(viewport);
      }
      assert.match(await page.locator('[data-story-health] > summary').innerText(),/No issues found/);
      assert.equal(await page.locator('[data-story-health]').getAttribute('open'),null);
      await page.locator('.ds-intro-notes > summary').click();
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('[data-run-verification="0"]').click();
      await page.getByText('Captured locally · Passed · Matches reviewed source',{exact:true}).waitFor();
      assert.match(await page.locator('.ds-verify-result').innerText(),/Not run/i,'authored claims are not overwritten by captured results');
      await page.locator('.ds-verification-receipt details > summary').click();
      await page.screenshot({path:join(output,`${name}-evidence.png`)});
      await page.locator('.ds-intro-start').click();
      const code=page.locator('.ds-step:not([hidden]) [data-comment-code][data-comment-side="right"]:visible').first();
      await code.waitFor();
      await code.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
      await page.keyboard.press('c');
      await page.locator('.ds-composer-ta').fill('Smoke review: inspect the exact selected boundary.');
      await page.getByRole('button',{name:'Add to queue',exact:true}).click();
      await page.locator('.ds-composer').waitFor({state:'detached'});
      const commentsBefore=readFileSync(join(repo,'.codestory/comments.json'),'utf8');
      assert.equal(JSON.parse(commentsBefore).length,3);
      // Exercise ARIA tab keyboard navigation rather than switching all tabs by script.
      await page.locator('#ds-tab-tour').focus();await page.keyboard.press('End');
      await page.locator('[data-review-tab-select="notes"]').click();
      await page.locator('[data-copy-comments]').click();
      await page.waitForFunction(()=>window.__smokeClipboard?.includes('Smoke review:'));
      assert.match(await page.evaluate(()=>window.__smokeClipboard),/Selected code:/);
      await page.locator('[data-review-tab-select="challenge"]').click();
      assert.match(await page.locator('.ds-challenge-target').first().innerText(),/Author-flagged doubt/);
      await page.screenshot({path:join(output,`${name}-challenge.png`)});
      // Inspect caller evidence, including its source link.
      await page.locator('#ds-tab-tour').click();
      await page.locator('[data-thread-node="3"]').click();
      await page.locator('.ds-step:not([hidden]) .ds-caller-evidence > summary').click();
      assert.match(await page.locator('.ds-step:not([hidden]) .ds-caller-evidence').innerText(),/Text match only/);
      await page.locator('.ds-step:not([hidden]) [data-caller-source]').first().click();
      // Change the real source, reload, and drive the production drift/refresh route.
      const limits=join(repo,'src/limits.ts');
      writeFileSync(limits,readFileSync(limits,'utf8').replace('MONTHLY_CAP - spent','Math.max(0, MONTHLY_CAP - spent)'));
      await page.waitForFunction(()=>document.body.getAttribute('data-live-diff-stale')==='1');
      assert.match(await page.locator('.ds-verification-receipt summary').textContent(),/Out of date or source changed/,'live source changes invalidate visible evidence without a reload');
      await page.goto(`${origin}/repo/${encodeURIComponent(basename(repo))}/review?story=story.json&view=tour&step=0`);
      await page.locator('[data-drift-open]').click();
      await page.locator('[data-drift-file]').first().click();
      await page.getByText('Math.max', {exact:false}).first().waitFor();
      await page.screenshot({path:join(output,`${name}-drift.png`)});
      const beforeRefresh=JSON.parse(readFileSync(storyPath,'utf8'));
      await page.locator('[data-drift-refresh]').click();
      await page.getByRole('button',{name:'Reload story',exact:true}).waitFor({timeout:20000});
      const afterRefresh=JSON.parse(readFileSync(storyPath,'utf8'));
      assert.deepEqual(afterRefresh.steps.map(s=>s.id),beforeRefresh.steps.map(s=>s.id));
      assert.deepEqual(afterRefresh.steps.find(s=>s.id==='s6'),beforeRefresh.steps.find(s=>s.id==='s6'));
      assert.equal(readFileSync(join(repo,'.codestory/comments.json'),'utf8'),commentsBefore);
      assert.notEqual(afterRefresh.storySnapshot.id,beforeRefresh.storySnapshot.id);
      await page.getByRole('button',{name:'Reload story',exact:true}).click();
      await page.getByText('Story current',{exact:true}).waitFor();
      await page.locator('.ds-intro-notes > summary').click();
      await page.getByText('Captured locally · Passed · Out of date or source changed',{exact:true}).waitFor();
      // Reject a second agent run that rewrites an unrelated step; retain baseline.
      writeFileSync(control,'bad');
      writeFileSync(limits,readFileSync(limits,'utf8').replace('Math.max(0, MONTHLY_CAP - spent)','Math.max(1, MONTHLY_CAP - spent)'));
      await page.reload();
      const beforeRejectedSource=readFileSync(storyPath,'utf8');
      const beforeRejected=JSON.parse(beforeRejectedSource);
      await page.locator('[data-drift-open]').click();await page.locator('[data-drift-refresh]').click();
      await page.getByText('The focused refresh was not accepted',{exact:true}).waitFor({timeout:20000});
      await page.waitForFunction(()=>!document.querySelector('[data-progress-panel] [data-progress-stop]:not([hidden])'));
      assert.deepEqual(JSON.parse(readFileSync(storyPath,'utf8')),beforeRejected);
      assert.equal(readFileSync(storyPath,'utf8'),beforeRejectedSource,'failed refresh restores the exact original bytes');
      assert.equal(readFileSync(join(repo,'.codestory/comments.json'),'utf8'),commentsBefore);
      writeFileSync(control,'good');
      assert.deepEqual(pageErrors,[],'no uncaught browser exceptions');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page-level horizontal overflow');
      await page.screenshot({path:join(output,`${name}-rejected-refresh.png`),fullPage:false});
      const warningStory=structuredClone(beforeRejected);delete warningStory.steps.find(step=>step.id==='s7').landing;
      writeFileSync(storyPath,JSON.stringify(warningStory,null,2)+'\n');
      await page.reload();
      await page.locator('[data-story-health] > summary').waitFor();
      assert.match(await page.locator('[data-story-health] > summary').innerText(),/0 errors.*1 warning/);
      assert.equal(await page.locator('[data-story-health]').getAttribute('open'),null,'prose warnings start compact');
      delete warningStory.steps[0].beats;
      writeFileSync(storyPath,JSON.stringify(warningStory,null,2)+'\n');
      await page.reload();
      await page.locator('[data-story-health][open]').waitFor();
      assert.match(await page.locator('[data-story-health] > summary').innerText(),/[1-9] errors?/,'blocking errors expand');

      console.log(`PASS ${name}: selection → queue → clipboard → challenge → caller source → receipt → drift → refresh → preservation rejection`);
    } catch(error) { await page.screenshot({path:join(output,`${name}-failure.png`)}).catch(()=>{}); throw error; } finally { await context.close(); await new Promise(resolve=>server.close(resolve)); }
  }
  console.log(`Browser evidence: ${output}`);
} catch(error) {
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  console.error(error);process.exitCode=1;
} finally {await browser.close();process.env.PATH=originalPath;rmSync(join(scratch,'bin'),{recursive:true,force:true});}
