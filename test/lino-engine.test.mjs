import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AloudUnavailableError } from '../dist/aloud-client.js';
import { createLinoReader, findLinoApp } from '../dist/lino-engine.js';

// A stand-in for Lino's bundled engine: same module layout and protocol, no
// voices. It starts on Persian, like a Lino that last read a Farsi passage,
// rejects any request without the secret it was handed, and records its random
// port so the test can probe it from outside.
const FAKE_DAEMON = `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
export async function runSpeechDaemon({ port, secret }) {
  let engine = 'pocket-farsi';
  const base = { ok: true, protocolVersion: 2, service: 'aloud-speech-daemon' };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/health') {
        return res.end(JSON.stringify({ ...base, capabilities: ['explicit-batches', 'prepare-speech'] }));
      }
      if (req.headers.authorization !== 'Bearer ' + secret) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ ok: false, error: 'A valid daemon authorization token is required.' }));
      }
      if (req.url === '/settings') engine = JSON.parse(body).engine;
      res.end(JSON.stringify({ ...base, engine, paused: false, running: false, state: {} }));
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  writeFileSync(new URL('./port', import.meta.url), String(server.address().port));
  return server;
}
`;

function fakeLino({ ready = true, session = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cs-lino-'));
  const app = join(root, 'Lino.app');
  const engine = join(app, 'Contents/Resources/ReadAloud/engine');
  mkdirSync(join(app, 'Contents/Helpers'), { recursive: true });
  mkdirSync(engine, { recursive: true });
  symlinkSync(process.execPath, join(app, 'Contents/Helpers/node'));
  writeFileSync(join(app, 'Contents/Resources/ReadAloud/package.json'), '{"type":"module"}');
  writeFileSync(join(engine, 'daemon.js'), FAKE_DAEMON);
  writeFileSync(join(engine, 'system-health.js'), `export const kokoroEnvironmentReady = () => ${ready};`);
  if (session) writeFileSync(join(engine, '../session.mjs'), `
    import { runSpeechDaemon } from './engine/daemon.js';
    import { writeFileSync } from 'node:fs';
    const server = await runSpeechDaemon({ port: 0, secret: 'session-secret' });
    writeFileSync(new URL('./used-session', import.meta.url), process.argv.slice(2).join(' '));
    process.stdout.write(JSON.stringify({ port: server.address().port, secret: 'session-secret', ready: true }) + '\\n');
    process.stdin.on('end', () => { server.close(); server.closeAllConnections(); });
    process.stdin.resume();
  `);
  return {
    app,
    port: () => Number(readFileSync(join(engine, 'port'), 'utf8')),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function portIsClosed(port) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

async function waitForClosedPort(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await portIsClosed(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test('findLinoApp needs both the bundled Node and the speech engine', () => {
  const lino = fakeLino();
  try {
    assert.equal(findLinoApp([join(lino.app, '..', 'Missing.app'), lino.app])?.path, lino.app);
    rmSync(join(lino.app, 'Contents/Helpers/node'));
    assert.equal(findLinoApp([lino.app]), null);
  } finally {
    lino.cleanup();
  }
});

test('Lino reader starts the bundled engine on demand, in English, behind its secret', async () => {
  const lino = fakeLino();
  const reader = createLinoReader({ appPaths: [lino.app] });
  try {
    assert.equal(existsSync(join(lino.app, 'Contents/Resources/ReadAloud/engine/port')), false);
    const status = await reader.status();
    // The engine came up on Persian; English narration must not use that model.
    assert.equal(status.engine, 'kokoro');
    assert.equal((await reader.speak({ text: 'Review this beat.' })).service, 'aloud-speech-daemon');

    const port = lino.port();
    const intruder = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(intruder.status, 401);

    reader.dispose();
    assert.equal(await waitForClosedPort(port), true);
    await assert.rejects(reader.status(), AloudUnavailableError);
  } finally {
    reader.dispose();
    lino.cleanup();
  }
});

test('Lino reader explains a missing Lino install', async () => {
  const reader = createLinoReader({ appPaths: [join(tmpdir(), 'no-such-dir', 'Lino.app')] });
  await assert.rejects(
    reader.status(),
    (error) => error instanceof AloudUnavailableError && error.fallback === 'browser' && /Narration needs Lino/.test(error.message),
  );
});

test('Lino reader prefers the supported session entry point when installed', async () => {
  const lino = fakeLino({ session: true });
  const reader = createLinoReader({ appPaths: [lino.app] });
  try {
    assert.equal((await reader.status()).engine, 'kokoro');
    assert.equal(readFileSync(join(lino.app, 'Contents/Resources/ReadAloud/used-session'), 'utf8'), '--language en');
    reader.dispose(); assert.equal(await waitForClosedPort(lino.port()), true);
  } finally { reader.dispose(); lino.cleanup(); }
});

test('Lino reader explains missing English voices instead of failing at playback', async () => {
  const lino = fakeLino({ ready: false });
  const reader = createLinoReader({ appPaths: [lino.app] });
  try {
    await assert.rejects(
      reader.speak({ text: 'Review this beat.' }),
      (error) => error instanceof AloudUnavailableError && error.fallback === 'browser' && /no English voice/.test(error.message),
    );
  } finally {
    reader.dispose();
    lino.cleanup();
  }
});
