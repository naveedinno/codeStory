import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserSpeech } from '../client/surfaces/review/engine/browser-speech.js';

// Behaves like the browsers that fire `error: interrupted` on the utterance
// being cancelled. finish() plays the head utterance to its natural end.
function fakeSynth(voices = []) {
  const synth = {
    spoken: [],
    queue: [],
    cancels: 0,
    getVoices: () => voices,
    speak(utterance) { synth.spoken.push(utterance); synth.queue.push(utterance); },
    cancel() {
      synth.cancels += 1;
      const dropped = synth.queue.splice(0);
      for (const utterance of dropped) utterance.onerror?.({ error: 'interrupted' });
    },
    finish() { synth.queue.shift()?.onend?.(); },
  };
  return synth;
}

class Utterance {
  constructor(text) { this.text = text; }
}

test('browser speech is absent without a synthesizer', () => {
  assert.equal(createBrowserSpeech(undefined, Utterance), null);
  assert.equal(createBrowserSpeech(fakeSynth(), undefined), null);
});

test('browser speech reads each batch in order and reports progress like the engine', async () => {
  const synth = fakeSynth();
  const speech = createBrowserSpeech(synth, Utterance);
  const started = await speech.request('speak', { text: 'One. Two.', batches: ['One.', 'Two.'], prefetch: 3 });
  assert.equal(started.service, 'aloud-speech-daemon');
  assert.equal(started.protocolVersion, 2);
  assert.equal(started.running, true);
  assert.deepEqual(started.state, { status: 'reading', current: 1, total: 2, message: 'Reading chunk 1 of 2' });

  synth.finish();
  assert.equal((await speech.request('status')).state.current, 2);
  synth.finish();
  const done = await speech.request('status');
  assert.equal(done.running, false);
  assert.equal(done.state.status, 'done');
  assert.equal(done.jobId, started.jobId);
  assert.deepEqual(synth.spoken.map((utterance) => utterance.text), ['One.', 'Two.']);
});

test('pause silences the beat and resume replays it from its start', async () => {
  const synth = fakeSynth();
  const speech = createBrowserSpeech(synth, Utterance);
  await speech.request('speak', { text: 'One. Two.', batches: ['One.', 'Two.'] });
  synth.finish();
  const paused = await speech.request('control', { action: 'pause' });
  assert.equal(paused.paused, true);
  assert.equal(paused.running, true);
  // The interrupted beat must not count as finished.
  assert.equal(paused.state.current, 2);

  const resumed = await speech.request('control', { action: 'resume' });
  assert.equal(resumed.paused, false);
  assert.deepEqual(synth.spoken.map((utterance) => utterance.text), ['One.', 'Two.', 'Two.']);
});

test('stop ends the job, and a new speak replaces the old one', async () => {
  const synth = fakeSynth();
  const speech = createBrowserSpeech(synth, Utterance);
  const first = await speech.request('speak', { text: 'First story.' });
  const second = await speech.request('speak', { text: 'Second story.' });
  assert.notEqual(second.jobId, first.jobId);
  assert.deepEqual(synth.spoken.map((utterance) => utterance.text), ['First story.', 'Second story.']);

  const stopped = await speech.request('control', { action: 'stop' });
  assert.equal(stopped.running, false);
  assert.equal(stopped.state.status, 'stopped');
  synth.finish();
  assert.equal(synth.spoken.length, 2);
});

test('browser speech prefers a local English voice and treats prepare as a no-op', async () => {
  const voices = [
    { name: 'Remote English', lang: 'en-US', localService: false },
    { name: 'Persian', lang: 'fa-IR', localService: true, default: true },
    { name: 'Samantha', lang: 'en-US', localService: true },
  ];
  const synth = fakeSynth(voices);
  const speech = createBrowserSpeech(synth, Utterance);
  assert.equal(await speech.request('prepare', { text: 'Warm this.' }), null);
  assert.equal(synth.spoken.length, 0);
  await speech.request('speak', { text: 'Hello.' });
  assert.equal(synth.spoken[0].voice.name, 'Samantha');
  assert.equal(synth.spoken[0].lang, 'en-US');
});

test('a real synthesis error ends playback with a message', async () => {
  const synth = fakeSynth();
  const speech = createBrowserSpeech(synth, Utterance);
  await speech.request('speak', { text: 'Hello.' });
  synth.queue.shift().onerror({ error: 'synthesis-failed' });
  const status = await speech.request('status');
  assert.equal(status.running, false);
  assert.equal(status.state.status, 'error');
  assert.match(status.state.message, /browser could not read/);
});
