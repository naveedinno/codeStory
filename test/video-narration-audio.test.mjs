import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { VideoExports, videoCapabilities, videoScenes } from '../dist/video-export.js';
import { videoNarrationBatches } from '../dist/video-narration.js';

const tools = videoCapabilities();
const available = tools.browser && tools.ffmpeg && tools.ffprobe;

// A continuous tone makes added gaps and truncated audio observable without
// depending on a downloaded voice, its pronunciation, or its natural pauses.
function tone() {
  const samples = 24000 * 2, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(samples*2,40);
  for (let i=0;i<samples;i++) wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/24000)*12000),44+i*2);
  return wav;
}

test('real MP4 joins large narration batches without caption gaps or clipped endings', {skip:!available,timeout:90000}, async () => {
  const prose = text => ({text});
  const payload = {story:{title:prose('Continuous narration')},steps:[{title:prose('Follow the request'),beats:[],
    conceptSpeech:Array.from({length:80},(_,index)=>`Sentence ${index} follows the request through the shared policy and explains why the order can continue.`).join(' ')}]};
  const scenes = videoScenes(payload), expected = videoNarrationBatches(scenes), calls = [];
  assert.ok(expected.length > 1);
  assert.ok(expected.length < scenes.length/5);
  const choice = {engine:'kokoro',voice:'af_heart'};
  const reader = {
    async models() { return [{id:choice.engine,ready:true,languages:['en'],voices:[{id:choice.voice}]}]; },
    async generateAudio(input,destination,signal) { signal.throwIfAborted(); calls.push(input); await writeFile(destination,tone()); },
    async status() { assert.fail('Export must not use the live narrator.'); },
    async configure() { assert.fail('Export must not reconfigure narration.'); },
    async control() { assert.fail('Export must not control live playback.'); },
  };
  const videos = new VideoExports(undefined,reader);
  try {
    const job = videos.start('owner','Tone','http://localhost',
      {resolution:'720p',narration:true,narrationEngine:'lino',lino:choice,speed:1.5,theme:'light'},
      ()=>({payload,panels:[],concepts:{},shell:'<!doctype html><html><body><button data-thread-node="0">Overview</button><button data-thread-node="1">Code</button><section data-step-panel="1">Request → Policy → Order</section></body></html>'}));
    let state;
    const deadline = Date.now()+80000;
    do { await delay(25); state=videos.get(job.id,'owner'); }
    while (['rendering','encoding'].includes(state.state) && Date.now()<deadline);
    assert.equal(state.state,'ready',JSON.stringify(state));
    assert.deepEqual(calls,expected.map(batch=>({...choice,text:batch.text})));
    const file = videos.file(job.id,'owner');
    const info = JSON.parse(execFileSync(tools.ffprobe,['-v','error','-show_format','-of','json',file],{encoding:'utf8'}));
    const spokenSeconds = expected.length*2/1.5;
    assert.ok(Math.abs(Number(info.format.duration)-(spokenSeconds+0.6))<0.1,'only one final tail is added');
    const pcm = execFileSync(tools.ffmpeg,['-v','error','-i',file,'-map','0:a:0','-ar','24000','-ac','1','-f','s16le','-']);
    const window = 2400;
    for (let start=0;start/24000<spokenSeconds-0.15;start+=window) {
      let sum = 0;
      for (let index=start;index<start+window;index++) sum+=pcm.readInt16LE(index*2)**2;
      assert.ok(Math.sqrt(sum/window)>5000,`speech is continuous through ${(start/24000).toFixed(1)}s`);
    }
    const cues = JSON.parse(execFileSync(tools.ffprobe,['-v','error','-select_streams','s:0','-show_packets','-of','json',file],{encoding:'utf8'})).packets.filter(packet=>Number(packet.size)>2);
    assert.equal(cues.length,scenes.length);
    for (let index=1;index<cues.length;index++)
      assert.ok(Math.abs(Number(cues[index].pts_time)-(Number(cues[index-1].pts_time)+Number(cues[index-1].duration_time)))<0.002);
    assert.ok(Math.abs(Number(cues.at(-1).pts_time)+Number(cues.at(-1).duration_time)-Number(info.format.duration))<0.05);
  } finally { await videos.dispose(); }
});

test('cancelling during batch synthesis stops generation and removes partial audio', {skip:!available,timeout:10000}, async () => {
  let begin, directory;
  const started = new Promise(resolve=>{begin=resolve;});
  const videos = new VideoExports(undefined,{
    async status() { return {engine:'kokoro',voice:'af_heart'}; },
    async generateAudio(_input,destination,signal) {
      directory=dirname(destination);
      await writeFile(destination,'partial speech'); begin();
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
      signal.throwIfAborted();
    },
  });
  try {
    const job = videos.start('owner','Cancel','http://localhost',
      {resolution:'720p',narration:true,narrationEngine:'lino',speed:1,theme:'light'},
      ()=>({payload:{story:{title:{text:'Cancel this narration'}},steps:[]},shell:'',panels:[],concepts:{}}));
    await started;
    assert.equal((await videos.cancel(job.id,'owner')).state,'cancelled');
    assert.equal(existsSync(directory),false);
    assert.equal(videos.file(job.id,'owner'),undefined);
  } finally {await videos.dispose();}
});
