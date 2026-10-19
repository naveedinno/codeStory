import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveEventHub } from '../dist/live.js';

class FakeWatcher extends EventEmitter {
  constructor(listener) {
    super();
    this.listener = listener;
    this.closed = false;
  }
  change(filename) { this.listener('change', filename); }
  close() { this.closed = true; }
}

class FakeResponse extends EventEmitter {
  status = 0;
  headers = {};
  output = '';
  ended = false;
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  flushHeaders() {}
  write(chunk) { this.output += String(chunk); return true; }
  end() { this.ended = true; this.emit('close'); }
}

function harness() {
  let nextTimer = 1;
  const timers = new Map();
  const watchers = new Map();
  const fingerprints = new Map([['HEAD\0', 'diff-a']]);
  const stories = new Map([
    ['/repo/.codestory/story.json', 'story-a'],
    ['/repo/.codestory/stories/other.json', 'other-a'],
  ]);
  const signatures = new Map([
    ['/repo/.codestory/comments.json', 'sig-comments-a'],
    ['/repo/.codestory/review-state.json', 'sig-review-a'],
  ]);
  const active = new Set();
  const setTimer = (callback, delay) => {
    const timer = { id: nextTimer++, delay };
    timers.set(timer, callback);
    return timer;
  };
  const clearTimer = (timer) => timers.delete(timer);
  const run = (delay) => {
    const entries = [...timers].filter(([timer]) => timer.delay === delay);
    for (const [timer, callback] of entries) {
      timers.delete(timer);
      callback();
    }
  };
  let fingerprintCallCount = 0;
  const hub = new LiveEventHub({
    debounceMs: 200,
    pollMs: 4000,
    heartbeatMs: 15000,
    fingerprint: (_repo, base, head) => {
      fingerprintCallCount += 1;
      return fingerprints.get(`${base}\0${head ?? ''}`);
    },
    storyFingerprint: (path) => stories.get(path) ?? 'missing',
    fileSignature: (path) => signatures.get(path) ?? 'missing',
    pathExists: () => true,
    watchDirectory: (path, listener) => {
      const watcher = new FakeWatcher(listener);
      watchers.set(path, watcher);
      return watcher;
    },
    setTimer,
    clearTimer,
    leaseActive: (token) => active.has(token),
  });
  const lease = (overrides = {}) => ({
    token: 'lease-a', repo: '/repo', base: 'HEAD', fingerprint: 'diff-a', scopeKey: 'HEAD\0',
    mode: 'full', storyIdentity: 'story', storyPath: '/repo/.codestory/story.json',
    storyFingerprint: 'story-a', expiresAt: Date.now() + 10000, fileFingerprints: {}, ...overrides,
  });
  const connect = (value) => {
    active.add(value.token);
    const request = new EventEmitter();
    const response = new FakeResponse();
    hub.connect(value, request, response);
    return { request, response };
  };
  return {
    hub, timers, watchers, fingerprints, stories, signatures, active, run, lease, connect,
    fingerprintCalls: () => fingerprintCallCount,
  };
}

test('initial state recovers missed drift and poll transitions diff back to synced', () => {
  const h = harness();
  h.fingerprints.set('HEAD\0', 'diff-b');
  h.stories.set('/repo/.codestory/story.json', 'story-b');
  const { response } = h.connect(h.lease());

  assert.equal(response.status, 200);
  assert.match(response.output, /event: state/);
  assert.match(response.output, /"diffChanged":true/);
  assert.match(response.output, /"storyChanged":true/);

  h.fingerprints.set('HEAD\0', 'diff-a');
  h.stories.set('/repo/.codestory/story.json', 'story-a');
  h.run(4000);
  assert.match(response.output, /event: diff-synced/);
  assert.match(response.output, /event: story-synced/);
});

test('watch invalidations debounce and story changes target only the matching lease', () => {
  const h = harness();
  const first = h.connect(h.lease());
  const second = h.connect(h.lease({
    token: 'lease-b', storyPath: '/repo/.codestory/stories/other.json', storyFingerprint: 'other-a',
  }));
  const dataWatcher = h.watchers.get('/repo/.codestory');
  const storiesWatcher = h.watchers.get('/repo/.codestory/stories');

  h.signatures.set('/repo/.codestory/comments.json', 'sig-comments-b');
  dataWatcher.change('comments.json');
  dataWatcher.change('comments.json');
  h.run(200);
  assert.equal((first.response.output.match(/event: comments-changed/g) ?? []).length, 1);
  assert.equal((second.response.output.match(/event: comments-changed/g) ?? []).length, 1);

  h.stories.set('/repo/.codestory/story.json', 'story-b');
  storiesWatcher.change('story.json');
  h.run(200);
  assert.match(first.response.output, /event: story-changed/);
  assert.doesNotMatch(second.response.output, /event: story-changed/);
});

test('last disconnect disposes watchers and timers, while an evicted lease closes on poll', () => {
  const h = harness();
  const first = h.connect(h.lease());
  assert.equal(h.hub.activeGroups, 1);
  first.response.emit('close');
  assert.equal(h.hub.activeGroups, 0);
  assert.equal(h.timers.size, 0);
  assert.ok([...h.watchers.values()].every((watcher) => watcher.closed));

  const second = h.connect(h.lease({ token: 'lease-c' }));
  h.active.delete('lease-c');
  h.run(4000);
  assert.equal(second.response.ended, true);
  assert.equal(h.hub.activeGroups, 0);
});

test('storyless leases receive no story invalidations', () => {
  const h = harness();
  h.stories.set('/repo/.codestory/story.json', 'story-b');
  const { response } = h.connect(h.lease({ storyIdentity: 'storyless' }));
  assert.match(response.output, /"storyChanged":false/);

  h.stories.set('/repo/.codestory/story.json', 'story-c');
  h.watchers.get('/repo/.codestory').change('story.json');
  h.run(200);
  h.run(4000);
  assert.doesNotMatch(response.output, /event: story-changed/);
});

test('a second tab on the same scope reuses the cached fingerprint', () => {
  const h = harness();
  h.connect(h.lease());
  const before = h.fingerprintCalls();
  h.connect(h.lease({ token: 'lease-b' }));
  assert.equal(h.fingerprintCalls(), before, 'connect must reuse the fingerprint the group already computed');
});

test('a change the poll already broadcast is not re-broadcast by the debounce', () => {
  const h = harness();
  const { response } = h.connect(h.lease());

  h.signatures.set('/repo/.codestory/comments.json', 'sig-comments-b');
  h.watchers.get('/repo/.codestory').change('comments.json');
  h.run(4000);
  assert.equal((response.output.match(/event: comments-changed/g) ?? []).length, 1, 'poll observes the change');
  h.run(200);
  assert.equal(
    (response.output.match(/event: comments-changed/g) ?? []).length,
    1,
    'the debounce must not duplicate an invalidation the poll already delivered',
  );
});
