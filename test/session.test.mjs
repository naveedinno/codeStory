// Unit tests for the mutable review session. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  openSession,
  closeSession,
  sessionEntryScreen,
  issueReviewPageLease,
  getReviewPageLease,
} from '../dist/session.js';

test('createSession carries the initial repo/base/head', () => {
  const s = createSession({ repo: '/r', base: 'main', head: 'feat' });
  assert.equal(s.repo, '/r');
  assert.equal(s.base, 'main');
  assert.equal(s.head, 'feat');
  assert.equal(s.chooseStory, true);
});

test('openSession sets the repo and resets base/head', () => {
  const s = createSession({ repo: null, base: 'x', head: 'y' });
  openSession(s, '/new');
  assert.equal(s.repo, '/new');
  assert.equal(s.base, undefined);
  assert.equal(s.head, undefined);
  assert.equal(s.chooseStory, true);
});

test('closeSession clears everything', () => {
  const s = createSession({ repo: '/r', base: 'main' });
  closeSession(s);
  assert.equal(s.repo, null);
  assert.equal(s.base, undefined);
  assert.equal(s.chooseStory, true);
});

test('repo entry starts at review history', () => {
  const s = createSession({ repo: '/r' });
  assert.equal(sessionEntryScreen(s), 'stories');

  openSession(s, '/another');
  assert.equal(sessionEntryScreen(s), 'stories');
});

test('repo entry resumes only an explicitly selected review', () => {
  const s = createSession({ repo: '/r' });
  s.chooseStory = false;
  s.selectedStory = '/r/.codestory/stories/security.json';
  assert.equal(sessionEntryScreen(s), 'review');

  s.selectedStory = null;
  assert.equal(sessionEntryScreen(s), 'stories');
});

test('review page leases are opaque, coexist across tabs, expire, and clear across repositories', () => {
  const s = createSession({ repo: '/r' });
  const input = {
    repo: '/r', base: 'HEAD', fingerprint: 'fingerprint', scopeKey: 'scope',
    mode: 'since', from: 'snapshot-1', fromSnapshotDigest: 'snapshot-digest', storyIdentity: 'storyless',
    storyPath: '/r/.codestory/story.json', storyFingerprint: 'story-fingerprint', fileFingerprints: {},
  };
  const first = issueReviewPageLease(s, input, 1000);
  assert.ok(first.token.length >= 20);
  assert.equal(getReviewPageLease(s, first.token, 1000), first);
  assert.equal(getReviewPageLease(s, first.token, 1000)?.fromSnapshotDigest, 'snapshot-digest');
  assert.equal(getReviewPageLease(s, 'caller-controlled-token', 1000), undefined);

  const second = issueReviewPageLease(s, { ...input, mode: 'full', from: undefined }, 1001);
  assert.notEqual(second.token, first.token);
  assert.equal(getReviewPageLease(s, first.token, 1002), first, 'new navigation keeps an older tab leased');
  assert.equal(getReviewPageLease(s, second.token, 1002)?.mode, 'full');

  assert.equal(getReviewPageLease(s, first.token, first.expiresAt + 1), undefined, 'idle leases expire');

  openSession(s, '/another');
  assert.equal(getReviewPageLease(s, second.token, 1003), undefined);
});

test('review page lease registry evicts its least recently used tab at the bound', () => {
  const s = createSession({ repo: '/r' });
  const input = {
    repo: '/r', base: 'HEAD', fingerprint: 'fingerprint', scopeKey: 'scope', mode: 'full',
    storyIdentity: 'storyless', storyPath: '/r/.codestory/story.json', storyFingerprint: 'missing',
    fileFingerprints: {},
  };
  const leases = Array.from({ length: 24 }, (_, index) => issueReviewPageLease(s, input, 1000 + index));
  assert.equal(getReviewPageLease(s, leases[0].token, 1100), leases[0], 'renewing makes a tab recent');
  const newest = issueReviewPageLease(s, input, 1101);

  assert.equal(getReviewPageLease(s, leases[1].token, 1102), undefined, 'oldest idle tab is evicted');
  assert.equal(getReviewPageLease(s, leases[0].token, 1102), leases[0]);
  assert.equal(getReviewPageLease(s, newest.token, 1102), newest);
  assert.equal(s.reviewPageLeases.size, 24);
});

test('re-opening the same repo keeps existing review page leases', () => {
  const s = createSession({ repo: '/r' });
  const input = {
    repo: '/r', base: 'HEAD', fingerprint: 'fingerprint', scopeKey: 'scope', mode: 'full',
    storyIdentity: 'storyless', storyPath: '/r/.codestory/story.json', storyFingerprint: 'missing',
    fileFingerprints: {},
  };
  const lease = issueReviewPageLease(s, input, 1000);
  openSession(s, '/r');
  assert.equal(getReviewPageLease(s, lease.token, 1001), lease, 'same-repo re-open must not strand live tabs');
  openSession(s, '/other');
  assert.equal(getReviewPageLease(s, lease.token, 1002), undefined, 'switching repositories still clears leases');
});
