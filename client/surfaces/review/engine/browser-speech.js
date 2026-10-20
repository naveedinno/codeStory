// Backup narrator for when Lino is not available: the browser's own voice.
//
// It answers the same requests, with the same status shape, as the speech
// engine behind /api/aloud, so the review engine's playback loop, pause and
// resume, and beat highlighting run unchanged on top of it. Plain JavaScript
// with the synthesizer passed in, so node tests drive it with a fake.

var SERVICE = 'aloud-speech-daemon';
var PROTOCOL = 2;

function englishVoice(synth) {
  var voices = (synth.getVoices && synth.getVoices()) || [];
  var english = voices.filter(function (voice) { return /^en\b/i.test(String(voice.lang || '').replace('_', '-')); });
  return english.find(function (voice) { return voice.localService && voice.default; })
    || english.find(function (voice) { return voice.localService; })
    || english[0]
    || null;
}

/**
 * Returns null when this browser has no speech synthesis, so the caller can
 * keep the original "narration is unavailable" message.
 */
export function createBrowserSpeech(synth, Utterance) {
  if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') return null;
  var job = null;
  var jobs = 0;
  var voice = null;
  // Voices often load after the first call; pick again once they arrive.
  if (typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', function () { voice = null; });
  }

  function status() {
    var base = {
      ok: true,
      service: SERVICE,
      protocolVersion: PROTOCOL,
      engine: 'browser',
      voice: voice ? voice.name : '',
      rate: 1,
    };
    if (!job) return Object.assign(base, { running: false, paused: false, state: {} });
    return Object.assign(base, {
      jobId: job.id,
      running: job.running,
      paused: job.paused,
      state: Object.assign({}, job.state),
    });
  }

  // Cancelling fires end or error on the old utterance depending on the
  // browser. Dropping it from the job first makes those late callbacks inert.
  function silence(current) {
    if (current) current.utterance = null;
    synth.cancel();
  }

  function readFrom(current) {
    if (job !== current || current.paused || !current.running) return;
    var total = current.batches.length;
    if (current.index >= total) {
      current.running = false;
      current.utterance = null;
      current.state = { status: 'done', current: total, total: total, message: 'Finished reading' };
      return;
    }
    var utterance = new Utterance(current.batches[current.index]);
    voice = voice || englishVoice(synth);
    if (voice) utterance.voice = voice;
    utterance.lang = voice && voice.lang ? voice.lang : 'en-US';
    utterance.onend = function () {
      if (job !== current || current.utterance !== utterance) return;
      current.index += 1;
      readFrom(current);
    };
    utterance.onerror = function (event) {
      if (job !== current || current.utterance !== utterance) return;
      var reason = event && event.error;
      if (reason === 'interrupted' || reason === 'canceled') return;
      current.running = false;
      current.utterance = null;
      current.state = { status: 'error', current: current.index, total: total, message: 'Your browser could not read this aloud.' };
    };
    current.utterance = utterance;
    current.state = {
      status: 'reading',
      current: current.index + 1,
      total: total,
      message: 'Reading chunk ' + (current.index + 1) + ' of ' + total,
    };
    synth.speak(utterance);
  }

  function speak(body) {
    var text = String((body && body.text) || '').trim();
    var batches = Array.isArray(body && body.batches) && body.batches.length ? body.batches.slice() : [text];
    silence(job);
    jobs += 1;
    job = {
      id: 'browser-' + jobs,
      batches: batches,
      index: 0,
      paused: false,
      running: true,
      state: {},
      utterance: null,
    };
    readFrom(job);
    return status();
  }

  // Pause stops the current beat and resume starts it again from its first
  // word. Native pause and resume are unreliable across browsers; replaying
  // one short beat behaves the same everywhere.
  function control(action) {
    if (!job) return status();
    if (action === 'pause' && job.running && !job.paused) {
      job.paused = true;
      silence(job);
    } else if (action === 'resume' && job.running && job.paused) {
      job.paused = false;
      readFrom(job);
    } else if (action === 'stop' && job.running) {
      job.running = false;
      job.paused = false;
      job.state = Object.assign({}, job.state, { status: 'stopped', message: 'Stopped' });
      silence(job);
    }
    return status();
  }

  return {
    /** Mirrors the /api/aloud/<path> endpoints. */
    request: function (path, body) {
      if (path === 'status') return Promise.resolve(status());
      if (path === 'prepare') return Promise.resolve(null);
      if (path === 'speak') return Promise.resolve(speak(body));
      if (path === 'control') return Promise.resolve(control(body && body.action));
      return Promise.reject(new Error('Unknown narration request.'));
    },
  };
}
