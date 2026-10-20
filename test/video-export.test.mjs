import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseVideoOptions, videoFilename, videoScenes, videoSubtitles, videoNarrationSettings, VideoExports } from '../dist/video-export.js';

const options = { resolution:'720p', narration:false, speed:1, theme:'light' };
const prose = text => ({text, speech:text, html:text});
const payload = { story:{title:prose('A flow'),summary:prose('Follow the request.')}, steps:[
  {kind:'concept',title:prose('Context'),beats:[],conceptSpeech:'The model before the code.'},
  {kind:'changed',title:prose('Code'),beats:[{focusGroup:0,text:prose('Start here.')},{focusGroup:4,text:prose('Then follow the result.')} ]},
  {kind:'context',title:prose('Fallback'),beats:[],why:prose('A single note.')},
] };
const snapshot = () => ({payload,shell:'',panels:[],concepts:{}});
async function finished(exports, id) {
  for(let tries=0;tries<100;tries++) {
    const job=exports.get(id,'owner');
    if(!['rendering','encoding'].includes(job.state)) return job;
    await delay(5);
  }
  throw new Error('Video job did not settle');
}

test('video options reject arbitrary settings and filename injection', () => {
  assert.deepEqual(parseVideoOptions(options),options);
  for (const narrationEngine of ['lino','system']) assert.deepEqual(parseVideoOptions({...options,narration:true,narrationEngine}),{...options,narration:true,narrationEngine});
  const selected={...options,narration:true,narrationEngine:'lino',lino:{engine:'pocket',voice:'marius'}};
  assert.deepEqual(parseVideoOptions(selected),selected);
  for(const lino of [null,{}, {engine:'pocket',voice:''}, {engine:12,voice:'marius'}, {engine:'x'.repeat(101),voice:'marius'}])
    assert.throws(()=>parseVideoOptions({...selected,lino}),/Choose/);
  assert.throws(()=>parseVideoOptions({...selected,narrationEngine:'system'}),/Choose/);
  for(const value of [null,{}, {...options,resolution:'4k'}, {...options,narration:'true'}, {...options,speed:0}, {...options,theme:'auto'}, {...options,narrationEngine:'remote'}])
    assert.throws(()=>parseVideoOptions(value),/Choose/);
  assert.equal(videoFilename('../../A "flow"\r\n.mp4'),'a-flow-mp4.mp4');
  assert.equal(videoFilename('فارسی'),'codestory.mp4');
  assert.ok(videoFilename('A'.repeat(500)).length<=84);
});

test('export-specific model and voice override live choices without configuring or stopping the narrator', async () => {
  const models=[
    {id:'kokoro',ready:true,languages:['en'],voices:[{id:'af_heart'}]},
    {id:'pocket',ready:true,languages:['en'],voices:[{id:'alba'},{id:'marius'}]},
    {id:'missing',ready:false,languages:['en'],voices:[{id:'missing_voice'}]},
    {id:'farsi',ready:true,languages:['fa'],voices:[{id:'farsi_voice'}]},
  ];
  const reader={async models(){return models;},async generateAudio(){},
    async status(){assert.fail('Explicit export choices must not read the live narrator.');},
    async configure(){assert.fail('Export must not configure live narration.');},
    async control(){assert.fail('Export must not stop live narration.');}};
  const choice={engine:'pocket',voice:'marius'};
  const frozen=await videoNarrationSettings(reader,choice);
  choice.voice='alba';assert.deepEqual(frozen,{engine:'pocket',voice:'marius'});
  await assert.rejects(videoNarrationSettings(reader,{engine:'missing',voice:'missing_voice'}),/downloaded voice model/);
  await assert.rejects(videoNarrationSettings(reader,{engine:'farsi',voice:'farsi_voice'}),/supports English/);
  await assert.rejects(videoNarrationSettings(reader,{engine:'pocket',voice:'af_heart'}),/selected model/);
});

test('video follows every concept, beat and single note, preserving focus and all caption words', () => {
  const scenes = videoScenes(payload);
  assert.deepEqual(scenes.map(s=>[s.step,s.group]),[[0,undefined],[1,undefined],[2,0],[2,4],[3,undefined]]);
  const words=Array.from({length:180},(_,i)=>`word${i}`).join(' ');
  const long={story:{title:prose('Long')},steps:[{title:prose('Step'),beats:[{focusGroup:7,text:prose(words)}]}]};
  const chunks=videoScenes(long).filter(s=>s.step===1);
  assert.equal(chunks.map(s=>s.text).join(' '),words);
  assert.ok(chunks.every(s=>s.text.length<=210&&s.group===7));
});

test('soft subtitles keep exact passage boundaries and preserve literal source text', () => {
  const text=videoSubtitles([
    {startMs:0,endMs:1240,text:'A <T> & amount < remaining.\nNext line.'},
    {startMs:1240,endMs:3600040,text:'Equality → rejected.'},
    {startMs:3600040,endMs:3601000,text:'One hour later.'},
  ]);
  assert.equal(text,'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.240\nA &lt;T&gt; &amp; amount &lt; remaining. Next line.\n\n2\n00:00:01.240 --> 01:00:00.040\nEquality → rejected.\n\n3\n01:00:00.040 --> 01:00:01.000\nOne hour later.\n\n');
  for(const cues of [
    [{startMs:-1,endMs:100,text:'Negative'}],
    [{startMs:0,endMs:0,text:'Empty'}],
    [{startMs:0,endMs:1.5,text:'Fractional'}],
    [{startMs:0,endMs:100,text:'First'},{startMs:99,endMs:200,text:'Overlapping'}],
  ]) assert.throws(()=>videoSubtitles(cues),/ordered, non-overlapping/);
});

test('video jobs enforce owner isolation, one active render, and artifact readiness', async () => {
  let release, directory;
  const gate=new Promise(resolve=>{release=resolve;});
  const exports=new VideoExports(async input=>{directory=input.directory;await gate;await writeFile(join(directory,'video.mp4'),'video');});
  try {
    const first=exports.start('owner','Story','http://localhost',options,snapshot);
    assert.equal(exports.get(first.id,'someone-else'),undefined);
    assert.equal(exports.file(first.id,'owner'),undefined);
    assert.throws(()=>exports.start('owner','Other','http://localhost',options,snapshot),/Another video/);
    release();
    assert.equal((await finished(exports,first.id)).state,'ready');
    assert.equal(exports.get(first.id,'owner').filename,'story.mp4');
    assert.ok(existsSync(exports.file(first.id,'owner')));
  } finally {await exports.dispose();}
  assert.equal(existsSync(directory),false);
  assert.throws(()=>exports.start('owner','Other','http://localhost',options,snapshot),/shutting down/);
});

test('video job polling exposes stage estimates and clears them on completion', async () => {
  let input, begin, finish;
  const began=new Promise(resolve=>{begin=resolve;});
  const gate=new Promise(resolve=>{finish=resolve;});
  const exports=new VideoExports(async renderer=>{input=renderer;begin();await gate;await writeFile(join(input.directory,'video.mp4'),'video');});
  try {
    const job=exports.start('owner','Story','http://localhost',options,snapshot);
    assert.equal(job.estimatedRemainingMs,null);
    await began;
    input.progress(0,1000,'Opening renderer');
    await delay(10);
    input.progress(1,1000,'Generating narration');
    let progress=exports.get(job.id,'owner');
    assert.equal(progress.stageProgress,0.001);
    assert.ok(progress.estimatedRemainingMs>0);
    input.progress(1000,1000,'Encoding',true);
    assert.equal(exports.get(job.id,'owner').estimatedRemainingMs,null);
    await delay(10);
    input.progress(1000,1000,'Encoding',true,0.001);
    progress=exports.get(job.id,'owner');
    assert.equal(progress.stageProgress,0.001);
    assert.ok(progress.estimatedRemainingMs>0);
    finish();
    const ready=await finished(exports,job.id);
    assert.equal(ready.estimatedRemainingMs,null);
    assert.equal(ready.stageProgress,null);
  } finally {finish();await exports.dispose();}
});

test('cancelling waits for rendering to stop and removes partial video data', async () => {
  let began, directory;
  const started=new Promise(resolve=>{began=resolve;});
  const exports=new VideoExports(async input=>{
    directory=input.directory; await writeFile(join(directory,'partial.png'),'source');began();
    await new Promise(resolve=>input.signal.addEventListener('abort',resolve,{once:true}));
    input.signal.throwIfAborted();
  });
  try {
    const job=exports.start('owner','Story','http://localhost',options,snapshot);
    await started;
    assert.equal(await exports.cancel(job.id,'wrong-owner'),undefined);
    const cancelled=await exports.cancel(job.id,'owner');
    assert.equal(cancelled.state,'cancelled');
    assert.equal(cancelled.estimatedRemainingMs,null);
    assert.equal(exports.file(job.id,'owner'),undefined);
    assert.equal(existsSync(directory),false);
  } finally {await exports.dispose();}
});

test('failed snapshot or encoding never exposes a download and cleans source data', async () => {
  let directory;
  const exports=new VideoExports(async input=>{directory=input.directory;await writeFile(join(directory,'partial.mp4'),'partial');throw new Error('Source moved');});
  try {
    const job=exports.start('owner','Story','http://localhost',options,snapshot);
    const result=await finished(exports,job.id);
    assert.equal(result.state,'error');assert.equal(result.message,'Source moved');
    assert.equal(result.estimatedRemainingMs,null);
    assert.equal(exports.file(job.id,'owner'),undefined);
    // The terminal error is visible immediately; asynchronous file cleanup
    // must still complete promptly even when the full suite is busy.
    for(let tries=0;existsSync(directory)&&tries<100;tries++)await delay(10);
    assert.equal(existsSync(directory),false);
  } finally {await exports.dispose();}
});
