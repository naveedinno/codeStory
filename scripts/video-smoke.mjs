// Encode and decode real local videos through the public API. No AI or live
// repository is involved. Requires the same browser/FFmpeg tools as export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { serve } from '../dist/server.js';
import { videoCapabilities, videoRequirements, videoScenes } from '../dist/video-export.js';
import { findLinoApp, linoAppCandidates } from '../dist/lino-engine.js';
import { loadTour } from '../dist/tour.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=mkdtempSync(join(tmpdir(),'codestory-video-smoke-'));
const repo=join(scratch,'repo'),home=join(scratch,'home');
const output=process.env.CODESTORY_VIDEO_SMOKE_OUT||join(scratch,'artifacts');mkdirSync(output,{recursive:true});
const requirements=videoRequirements();assert.equal(requirements.available,true,requirements.missing.join(' '));
const withLino=process.env.CODESTORY_VIDEO_SMOKE_LINO==='1';
const linoModels=process.env.CODESTORY_VIDEO_SMOKE_LINO_MODELS?.split(',').map(value=>value.trim()).filter(Boolean) ?? [undefined];
if(withLino){
  assert.equal(requirements.lino,true,'Install Lino before running its video smoke check.');
  // Keep codeStory preferences in the temporary home while using the real app.
  process.env.CODESTORY_LINO_APP=findLinoApp(linoAppCandidates()).path;
}
const tools=videoCapabilities();
execFileSync(process.execPath,[join(root,'examples/demo.mjs')],{cwd:root,env:{...process.env,CODESTORY_DEMO_NO_SERVE:'1',CODESTORY_DEMO_DIR:repo},stdio:'pipe'});
const storyPath=join(repo,'.codestory/story.json');
const story=JSON.parse(readFileSync(storyPath,'utf8'));
const code=story.steps.find(step=>step.id==='s2');code.order=3;code.title='Check the spending budget';
delete code.calls;delete code.returnsTo;
code.beats=code.beats.slice(0,2);code.beats[0].text='Read the remaining budget.';code.beats[1].text='The amount < remaining check also rejects equality.';
story.version=4;story.title='Spending limits';story.summary='Follow the budget check.';delete story.evolution;delete story.hotspots;
story.steps=[
  {id:'primer',order:1,kind:'concept',title:'Request flow',body:'The request reaches the shared policy.',diagram:{type:'mermaid',source:'flowchart LR\n Request --> Policy',caption:'A shared budget gate.'},preparesFor:['s2']},
  {id:'page',order:2,kind:'concept',title:'Budget model',narration:'Accepted orders consume the remaining budget.',page:'<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#16392e;color:#fff;font:36px sans-serif"><div id="ready">Budget → Check → Order</div><script>document.body.dataset.ready="yes"</script></body></html>',preparesFor:['s2']},
  code,
];
writeFileSync(storyPath,JSON.stringify(story,null,2));
loadTour(storyPath);
const comments=readFileSync(join(repo,'.codestory/comments.json'),'utf8');
const server=serve({repo,homeOverride:home,port:0,open:false});await once(server,'listening');
const origin=`http://localhost:${server.address().port}`;
const browser=await chromium.launch({executablePath:tools.browser,headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light'});
  const page=await context.newPage();page.setDefaultTimeout(180000);
  await page.goto(`${origin}/repo/${basename(repo)}/review?story=story.json`);
  await page.getByRole('button',{name:'File menu',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Export video',exact:true}).count(),0,'export lives only in the File menu');
  const token=await page.locator('body').getAttribute('data-review-page-token');
  const expectedScenes=videoScenes(await page.locator('#__CODESTORY_DATA__').evaluate(node=>JSON.parse(node.textContent)));
  const url=path=>`${origin}/api/video-export${path}?page=${token}`;
  const create=async options=>{
    const response=await fetch(url(''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options)});
    const job=await response.json();assert.equal(response.status,202,JSON.stringify(job));return job;
  };
  // Cancelling an actual renderer also exercises Chromium/encoder teardown.
  const cancelled=await create({resolution:'720p',narration:false,speed:1.5,theme:'light'});
  const foreign=await fetch(`${origin}/api/video-export/${cancelled.id}?page=foreign`);assert.equal(foreign.status,404);
  const premature=await fetch(url(`/${cancelled.id}/file`));assert.equal(premature.status,409);
  const stopped=await fetch(url(`/${cancelled.id}`),{method:'DELETE'});assert.equal((await stopped.json()).state,'cancelled');
  for(const [resolution,narration,theme,narrationEngine,linoModel] of [['720p',false,'light'],['1080p',requirements.narration,'dark'],...(withLino?linoModels.map(model=>['720p',true,'light','lino',model]):[])]) {
    const variant=narrationEngine==='lino'?`${resolution}-lino${linoModel?`-${linoModel}`:''}`:resolution;
    let job;
    if(resolution==='720p') {
      await page.getByRole('button',{name:'File menu',exact:true}).click();
      await page.getByRole('menuitem',{name:'Export video…',exact:true}).click();
      const fresh=page.getByRole('button',{name:'New export',exact:true});if(await fresh.count())await fresh.click();
      await page.getByRole('combobox',{name:'Resolution',exact:true}).selectOption('720p');
      await page.getByRole('combobox',{name:'Reading speed',exact:true}).selectOption('1.5');
      await page.getByRole('combobox',{name:'Narration',exact:true}).selectOption(narrationEngine??'none');
      if(narrationEngine==='lino'){
        await page.getByRole('combobox',{name:'Voice model',exact:true}).waitFor();
        const catalog=await(await fetch(`${origin}/api/aloud/settings`)).json();
        const model=linoModel ? catalog.models.find(model=>model.id===linoModel&&model.ready&&model.languages.includes('en'))
          : catalog.models.find(model=>model.ready&&model.languages.includes('en')&&model.id!==catalog.status.engine)
            ?? catalog.models.find(model=>model.ready&&model.languages.includes('en'));
        assert.ok(model,`Requested English voice model is ready: ${linoModel??'any downloaded model'}`);
        const voice=model.voices.at(-1).id;
        await page.getByRole('combobox',{name:'Voice model',exact:true}).selectOption(model.id);
        await page.getByRole('combobox',{name:'Voice',exact:true}).selectOption(voice);
        await page.screenshot({path:join(output,'export-lino.png')});
        const after=await(await fetch(`${origin}/api/aloud/status`)).json();
        assert.equal(after.engine,catalog.status.engine);assert.equal(after.voice,catalog.status.voice);
      }
      const created=page.waitForResponse(response=>response.url().includes('/api/video-export?')&&response.request().method()==='POST');
      await page.getByRole('button',{name:'Create video',exact:true}).click();
      const response=await created;job=await response.json();assert.equal(response.status(),202,JSON.stringify(job));
      if(narrationEngine==='lino'){
        const selection=response.request().postDataJSON().lino;
        assert.equal(selection.engine,await page.getByRole('combobox',{name:'Voice model',exact:true}).inputValue());
        assert.equal(selection.voice,await page.getByRole('combobox',{name:'Voice',exact:true}).inputValue());
      }
      await page.getByRole('button',{name:'Close video export',exact:true}).click();
      await page.getByRole('button',{name:'File menu',exact:true}).click();
      await page.getByRole('menuitem',{name:'Video export progress…',exact:true}).click();
    } else job=await create({resolution,narration,narrationEngine,speed:1.5,theme});
    const deadline=Date.now()+180000;let state;const progressSamples=[];
    do {
      state=await(await fetch(url(`/${job.id}`))).json();
      progressSamples.push({state:state.state,stageProgress:state.stageProgress,estimatedRemainingMs:state.estimatedRemainingMs});
      if(state.estimatedRemainingMs!==null)assert.ok(Number.isFinite(state.estimatedRemainingMs)&&state.estimatedRemainingMs>0);
      if(state.stageProgress!==null)assert.ok(state.stageProgress>=0&&state.stageProgress<=1);
      if(!['rendering','encoding'].includes(state.state))break;
      await delay(500);
    } while(Date.now()<deadline);
    assert.equal(state.state,'ready',JSON.stringify(state));
    assert.equal(state.estimatedRemainingMs,null);
    writeFileSync(join(output,`${variant}-progress.json`),JSON.stringify(progressSamples,null,2));
    assert.ok(progressSamples.some(sample=>sample.state==='rendering'&&sample.estimatedRemainingMs>0),'real passage generation exposes a measured ETA');
    const response=await fetch(url(`/${job.id}/file`));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');
    const file=join(output,`${variant}-${narration?'narrated':'subtitles'}.mp4`);
    if(resolution==='720p') {
      const link=page.getByRole('link',{name:'Download MP4',exact:true});await link.waitFor();
      await page.screenshot({path:join(output,`${variant}-export-ready.png`)});
      const downloaded=page.waitForEvent('download');await link.click();const download=await downloaded;
      assert.equal(download.suggestedFilename(),'spending-limits.mp4');await download.saveAs(file);
      await page.getByRole('button',{name:'Close video export',exact:true}).click();
    } else writeFileSync(file,Buffer.from(await response.arrayBuffer()));
    const info=JSON.parse(execFileSync(tools.ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
    const video=info.streams.find(stream=>stream.codec_type==='video');
    assert.equal(video.codec_name,'h264');assert.equal(video.pix_fmt,'yuv420p');assert.equal(video.width,resolution==='1080p'?1920:1280);assert.equal(video.height,resolution==='1080p'?1080:720);
    assert.equal(info.streams.some(stream=>stream.codec_type==='audio'),narration);assert.ok(Number(info.format.duration)>5);
    const subtitle=info.streams.find(stream=>stream.codec_type==='subtitle');
    assert.equal(subtitle?.codec_name,'mov_text');
    // MP4 marks its first subtitle track as enabled even with disposition 0;
    // the important contract is selectable text, with no forced rendering.
    assert.equal(subtitle.disposition.forced,0);
    assert.equal(subtitle.tags.handler_name,'Story subtitles');
    const cues=JSON.parse(execFileSync(tools.ffprobe,['-v','error','-select_streams','s:0','-show_packets','-of','json',file],{encoding:'utf8'})).packets.filter(packet=>Number(packet.size)>2);
    assert.ok(cues.length>0);assert.equal(Number(cues[0].pts_time),0);
    for(let index=1;index<cues.length;index++) assert.ok(Math.abs(Number(cues[index].pts_time)-(Number(cues[index-1].pts_time)+Number(cues[index-1].duration_time)))<0.002);
    assert.ok(Math.abs(Number(cues.at(-1).pts_time)+Number(cues.at(-1).duration_time)-Number(info.format.duration))<0.05,'subtitle timing covers the complete video');
    const subtitles=execFileSync(tools.ffmpeg,['-v','error','-i',file,'-map','0:s:0','-c:s','srt','-f','srt','-'],{encoding:'utf8'});
    assert.match(subtitles,/Read the remaining budget/);
    // Inspect actual mov_text packets to prove players receive literal source
    // operators, rather than relying on another subtitle format's markup.
    const subtitleData=execFileSync(tools.ffmpeg,['-v','error','-i',file,'-map','0:s:0','-c:s','copy','-f','data','-']);
    for(const scene of expectedScenes) assert.ok(subtitleData.includes(Buffer.from(scene.text.replace(/\s+/g,' ').trim())),`subtitle text survives: ${scene.text}`);
    assert.equal(cues.length,expectedScenes.length,'every passage has a selectable subtitle');
    // Decode representative frames; a valid MP4 header alone is insufficient.
    execFileSync(tools.ffmpeg,['-v','error','-i',file,'-f','null','-'],{stdio:'pipe'});
    for(const [name,fraction] of [['overview',0.02],['diagram',0.25],['concept',0.5],['code',0.88]])
      execFileSync(tools.ffmpeg,['-y','-v','error','-ss',String(Number(info.format.duration)*fraction),'-i',file,'-frames:v','1',join(output,`${variant}-${name}.png`)],{stdio:'pipe'});
    console.log(`PASS ${variant}: ${Number(info.format.duration).toFixed(2)}s H.264 MP4, ${narration?'AAC narration':'no narration'}, selectable timed subtitles, fully decoded`);
  }
  assert.equal(readFileSync(join(repo,'.codestory/comments.json'),'utf8'),comments);
  assert.equal(readFileSync(storyPath,'utf8'),JSON.stringify(story,null,2));
  console.log(`Video evidence: ${output}`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(repo,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});}
