import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
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
