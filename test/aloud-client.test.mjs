import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AloudTimeoutError, AloudUnavailableError, createAloudReader } from '../dist/aloud-client.js';

const STATUS = {
  jobId: 'job-1',
  ok: true,
  paused: false,
  protocolVersion: 2,
  running: true,
  service: 'aloud-speech-daemon',
  state: { status: 'reading' },
};
const HEALTH = {
  capabilities: ['explicit-batches', 'prefetch-playback', 'prepare-speech'],
  ok: true,
  protocolVersion: 2,
  service: 'aloud-speech-daemon',
};

async function fakeAloud(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

const AUDIO_ID = '23ee1a6c-6b90-4a4b-b9eb-c58f2322d3fd';
const AUDIO_PATH = `/api/v1/audio/jobs/${AUDIO_ID}`;
const AUDIO_INPUT = {text:'Follow the budget.',engine:'pocket',voice:'alba'};
const audioStatus = state => ({apiVersion:1,id:AUDIO_ID,state});
const audioHealth = {...HEALTH,capabilities:[...HEALTH.capabilities,'audio-jobs']};

test('Lino audio generation uses one idempotency key, authenticated downloads and explicit voice without touching playback', async () => {
  const directory=await mkdtemp(join(tmpdir(),'cs-audio-')),file=join(directory,'speech.wav');
  const posts=[],keys=[],calls=[];let polls=0;
  const fixture=await fakeAloud((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer private');
    calls.push(`${req.method} ${req.url}`);
    let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
      res.setHeader('Content-Type','application/json');
      if(req.url==='/health')return res.end(JSON.stringify(audioHealth));
      if(req.url==='/api/v1/audio/jobs'){
        posts.push(JSON.parse(body));keys.push(req.headers['idempotency-key']);
        if(posts.length===1)return req.socket.destroy();
        return res.end(JSON.stringify(audioStatus('generating')));
      }
      if(req.url===AUDIO_PATH){polls++;return res.end(JSON.stringify(audioStatus('ready')));}
      if(req.url===`${AUDIO_PATH}/file`){res.setHeader('Content-Type','audio/wav');return res.end('RIFF voice audio');}
      assert.fail(`Unexpected player operation ${req.url}`);
    });
  });
  try {
    const reader=createAloudReader(async()=>({url:fixture.url,secret:'private'}));
    await reader.generateAudio(AUDIO_INPUT,file,new AbortController().signal);
    assert.equal(await readFile(file,'utf8'),'RIFF voice audio');
    assert.deepEqual(posts,[{...AUDIO_INPUT,language:'en',rate:1},{...AUDIO_INPUT,language:'en',rate:1}]);
    assert.match(keys[0],/^[a-f0-9-]{36}$/);assert.equal(keys[0],keys[1]);assert.equal(polls,1);
    assert.equal(calls.some(call=>/\/(?:speak|stop|settings)$/.test(call)),false);
  } finally {fixture.server.close();await once(fixture.server,'close');await rm(directory,{recursive:true,force:true});}
});

test('cancelling Lino generation cancels only its audio job and never exposes a partial file', async () => {
  const directory=await mkdtemp(join(tmpdir(),'cs-audio-')),file=join(directory,'speech.wav');
  const controller=new AbortController();const calls=[];
  const fixture=await fakeAloud((req,res)=>{
    calls.push(`${req.method} ${req.url}`);req.resume();res.setHeader('Content-Type','application/json');
    if(req.url==='/health')return res.end(JSON.stringify(audioHealth));
    if(req.url==='/api/v1/audio/jobs'){
      res.end(JSON.stringify(audioStatus('generating')));
      setTimeout(()=>controller.abort(new Error('Cancel this export')),30);return;
    }
    assert.equal(`${req.method} ${req.url}`,`DELETE ${AUDIO_PATH}`);
    res.end(JSON.stringify(audioStatus('cancelled')));
  });
  try {
    await assert.rejects(createAloudReader(fixture.url).generateAudio(AUDIO_INPUT,file,controller.signal));
    assert.ok(calls.includes(`DELETE ${AUDIO_PATH}`));assert.equal(existsSync(file),false);
  } finally {fixture.server.close();await once(fixture.server,'close');await rm(directory,{recursive:true,force:true});}
});

test('Lino export explains older engines before sending narration text', async () => {
  const fixture=await fakeAloud((req,res)=>{
    assert.equal(req.url,'/health');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(HEALTH));
  });
  try {
    await assert.rejects(createAloudReader(fixture.url).generateAudio(AUDIO_INPUT,'unused.wav',new AbortController().signal),/Update Lino to export video/);
  } finally {fixture.server.close();await once(fixture.server,'close');}
});

test('Lino audio API surfaces model download errors', async () => {
  const fixture=await fakeAloud((req,res)=>{
    req.resume();res.setHeader('Content-Type','application/json');
    if(req.url==='/health')return res.end(JSON.stringify(audioHealth));
    res.statusCode=503;res.end(JSON.stringify({error:{code:'model_unavailable',message:'Download Pocket TTS in Lino.'}}));
  });
  try {
    await assert.rejects(createAloudReader(fixture.url).generateAudio(AUDIO_INPUT,'unused.wav',new AbortController().signal),/Download Pocket TTS/);
  } finally {fixture.server.close();await once(fixture.server,'close');}
});

test('Lino downloads reject foreign URLs and preserve pre-existing destination files', async () => {
  const directory=await mkdtemp(join(tmpdir(),'cs-audio-')),file=join(directory,'speech.wav');
  await writeFile(file,'existing');
  const fixture=await fakeAloud((req,res)=>{
    req.resume();res.setHeader('Content-Type','application/json');
    if(req.url==='/health')return res.end(JSON.stringify(audioHealth));
    if(req.url==='/api/v1/audio/jobs')return res.end(JSON.stringify({...audioStatus('ready'),downloadUrl:'https://untrusted.example/voice.wav'}));
    assert.equal(req.url,`${AUDIO_PATH}/file`);res.setHeader('Content-Type','audio/wav');res.end('RIFF voice');
  });
  try {
    await assert.rejects(createAloudReader(fixture.url).generateAudio(AUDIO_INPUT,file,new AbortController().signal),/EEXIST/);
    assert.equal(await readFile(file,'utf8'),'existing');
  } finally {fixture.server.close();await once(fixture.server,'close');await rm(directory,{recursive:true,force:true});}
});

test('Aloud client discovers real model options and sends authenticated session settings', async () => {
  const models=[{id:'kokoro',name:'Kokoro',ready:true,languages:['en'],voices:[{id:'af_heart',label:'Heart'}]}];
  let configured;
  const fixture=await fakeAloud((req,res)=>{
    req.on('error',()=>{});
    let body='';req.on('data',chunk=>{body+=chunk;});
    req.on('end',()=>{
      assert.equal(req.headers.authorization,'Bearer private');res.setHeader('Content-Type','application/json');
      if(req.url==='/health')return res.end(JSON.stringify({...HEALTH,capabilities:[...HEALTH.capabilities,'model-catalog']}));
      if(req.url==='/api/v1/models')return res.end(JSON.stringify({apiVersion:1,models}));
      if(req.url==='/settings')configured=JSON.parse(body);
      res.end(JSON.stringify({...STATUS,voice:'af_heart'}));
    });
  });
  try {
    const reader=createAloudReader(async()=>({url:fixture.url,secret:'private'}));
    assert.deepEqual(await reader.models(),models);
    await reader.configure({engine:'kokoro',voice:'af_heart',rate:1.25});
    assert.deepEqual(configured,{engine:'kokoro',voice:'af_heart',rate:1.25});
  } finally {fixture.server.close();await once(fixture.server,'close');}
});

test('Aloud client verifies the daemon before delegating speech and controls', async () => {
  const calls = [];
  const fixture = await fakeAloud((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString('utf8') });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify(HEALTH));
      if (req.url === '/pause') return res.end(JSON.stringify({ ok: true, paused: true }));
      res.end(JSON.stringify(STATUS));
    });
  });
  try {
    const aloud = createAloudReader(fixture.url);
    assert.equal((await aloud.speak({
      batches: ['Review this beat.', 'Then this one.'],
      prefetch: 3,
      text: 'Review this beat. Then this one.',
    })).jobId, 'job-1');
    await aloud.prepare({
      batches: ['Review this beat.'],
      text: 'Review this beat.',
    });
    assert.equal((await aloud.control('pause')).service, 'aloud-speech-daemon');
    assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
      'GET /health',
      'POST /speak',
      'GET /health',
      'POST /prepare',
      'GET /health',
      'POST /pause',
      'GET /status',
    ]);
    const spoken = JSON.parse(calls[1].body);
    assert.match(spoken.requestId, /^[a-f0-9-]{36}$/);
    assert.deepEqual({ ...spoken, requestId: undefined }, {
      batches: ['Review this beat.', 'Then this one.'],
      prefetch: 3,
      text: 'Review this beat. Then this one.',
      requestId: undefined,
    });
    assert.deepEqual(JSON.parse(calls[3].body), {
      batches: ['Review this beat.'],
      text: 'Review this beat.',
    });
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

test('Aloud client refuses an unrelated listener on the daemon port', async () => {
  const fixture = await fakeAloud((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'something-else', protocolVersion: 2 }));
  });
  try {
    await assert.rejects(
      createAloudReader(fixture.url).speak({ text: 'Do not send this.' }),
      (error) => error instanceof AloudUnavailableError && /compatible Lino reader/.test(error.message),
    );
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

test('Aloud client explains when the engine predates explicit narration batches', async () => {
  const fixture = await fakeAloud((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, protocolVersion: 2, service: 'aloud-speech-daemon' }));
  });
  try {
    await assert.rejects(
      createAloudReader(fixture.url).speak({ text: 'Queue this narration.' }),
      (error) => error instanceof AloudUnavailableError && /Update Lino/.test(error.message),
    );
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

// Aloud's HTTP server closes idle keep-alive sockets on Node's 5s default, so a
// pooled socket can die between two narration polls. Reusing it surfaced as
// "Aloud did not respond in time." even though Aloud was healthy and answering in
// single-digit milliseconds. One dropped connection must not fail the request.
test('Aloud client recovers when the daemon drops a pooled connection', async () => {
  let attempts = 0;
  const fixture = await fakeAloud((req, res) => {
    attempts += 1;
    if (attempts === 1) {
      req.socket.destroy();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(STATUS));
  });
  try {
    const status = await createAloudReader(fixture.url).status();
    assert.equal(status.jobId, 'job-1');
    assert.equal(attempts, 2, 'expected the dropped connection to be retried once');
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

test('Aloud client retries a dropped connection for speech, not just reads', async () => {
  const seen = [];
  const requestIds = [];
  const fixture = await fakeAloud((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/speak') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requestIds.push(JSON.parse(body).requestId);
        if (requestIds.length === 1) { req.socket.destroy(); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(STATUS));
      });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? HEALTH : STATUS));
  });
  try {
    const status = await createAloudReader(fixture.url).speak({ text: 'Narrate this beat.' });
    assert.equal(status.jobId, 'job-1');
    assert.equal(seen.filter((entry) => entry === 'POST /speak').length, 2);
    assert.match(requestIds[0], /^[a-f0-9-]{36}$/);
    assert.equal(requestIds[1], requestIds[0], 'one narration id must survive a transport retry');
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

test('Aloud client preserves the preparation receipt for callers that track readiness', async () => {
  const prepare = { id: 'prepare-1', beats: 4, ready: 0, state: 'generating' };
  const fixture = await fakeAloud((req, res) => {
    req.resume(); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/prepare' ? { ...HEALTH, accepted: true, prepare } : HEALTH));
  });
  try {
    assert.deepEqual(await createAloudReader(fixture.url).prepare({ text: 'Prepare this.' }), prepare);
  } finally { fixture.server.close(); await once(fixture.server, 'close'); }
});

test('Aloud client gives up honestly when every attempt is dropped', async () => {
  let attempts = 0;
  const fixture = await fakeAloud((req) => {
    attempts += 1;
    req.socket.destroy();
  });
  try {
    await assert.rejects(createAloudReader(fixture.url).status());
    assert.equal(attempts, 3, 'expected a bounded number of attempts, not an endless retry');
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

// The narration loop must be able to tell "retry this" apart from "Aloud is
// gone", otherwise one blip tears down playback that is still audible.
test('Aloud timeouts are marked transient and distinct from unavailability', () => {
  const timeout = new AloudTimeoutError();
  assert.equal(timeout.transient, true);
  assert.equal(timeout.statusCode, 504);
  assert.ok(timeout instanceof AloudUnavailableError, 'existing instanceof checks must keep working');
  assert.match(timeout.message, /did not respond in time/);
  const unavailable = new AloudUnavailableError();
  assert.equal(unavailable.transient, false);
  assert.equal(unavailable.statusCode, 503);
});

test('Aloud client uses the authoritative control response without an extra status poll', async () => {
  const calls = [];
  const fixture = await fakeAloud((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      return res.end(JSON.stringify(HEALTH));
    }
    res.end(JSON.stringify({ ...STATUS, paused: true, state: { message: 'Generating chunk 1 of 2', status: 'generating', current: 0, total: 2 } }));
  });
  try {
    const status = await createAloudReader(fixture.url).control('pause');
    assert.equal(status.paused, true);
    assert.equal(status.state.status, 'generating');
    assert.deepEqual(calls, ['GET /health', 'POST /pause']);
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});

test('Aloud client presents the engine secret on every request', async () => {
  const seen = [];
  const fixture = await fakeAloud((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization ?? '-'}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? HEALTH : STATUS));
  });
  try {
    let resolved = 0;
    const aloud = createAloudReader(async () => {
      resolved += 1;
      return { url: fixture.url, secret: 'engine-secret' };
    });
    await aloud.status();
    await aloud.speak({ text: 'Review this beat.' });
    assert.deepEqual(seen, [
      '/status Bearer engine-secret',
      '/health Bearer engine-secret',
      '/speak Bearer engine-secret',
    ]);
    // Resolved per operation, so a restarted engine's new port is picked up.
    assert.equal(resolved, 2);
  } finally {
    fixture.server.close();
    await once(fixture.server, 'close');
  }
});
