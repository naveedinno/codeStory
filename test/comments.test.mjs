// Unit tests for the comment store. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addComment,
  commentsForStory,
  deleteComment,
  loadComments,
  loadCommentsWithHealth,
  updateComment,
} from '../dist/comments.js';

function tmpRepo() { return mkdtempSync(join(tmpdir(), 'cmt-')); }

test('addComment persists a comment with no step (All-files annotation)', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { file: 'a.ts', line: 12, type: 'change', body: 'hi' });
    assert.equal(c.file, 'a.ts');
    assert.equal(c.line, 12);
    assert.equal(c.status, 'open');
    assert.ok(!('step' in c), 'step should be absent when not provided');
    const all = loadComments(repo);
    assert.equal(all.length, 1);
    assert.ok(!('step' in all[0]));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment keeps step when provided (Story annotation)', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { step: 's1', file: 'a.ts', line: 3, type: 'nit', body: 'x' });
    assert.equal(c.step, 's1');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment persists selected text and selected line range', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, {
      step: 's1',
      file: 'a.ts',
      line: 7,
      type: 'question',
      body: 'why this branch?',
      selectedText: 'if (needsRetry) {',
      selection: { startLine: 7, endLine: 8, startColumn: 5, endColumn: 18 },
    });
    assert.equal(c.selectedText, 'if (needsRetry) {');
    assert.deepEqual(c.selection, { startLine: 7, endLine: 8, startColumn: 5, endColumn: 18 });
    assert.deepEqual(loadComments(repo)[0].selection, c.selection);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment stores version-aware review metadata and an anchor digest', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, {
      file: 'a.ts',
      line: 7,
      type: 'change',
      body: 'tighten this',
      selectedText: 'return value',
      reviewRound: 2,
      reviewSnapshotId: 'r_snapshot',
    });
    assert.equal(c.reviewRound, 2);
    assert.equal(c.reviewSnapshotId, 'r_snapshot');
    assert.match(c.anchorHash, /^[a-f0-9]{20}$/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment persists which diff side was selected', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, {
      step: 's1',
      file: 'a.ts',
      line: 4,
      side: 'left',
      type: 'question',
      body: 'is the old branch still needed?',
      selectedText: 'oldBranch()',
      selection: { startLine: 4, endLine: 4 },
    });
    assert.equal(c.side, 'left');
    assert.equal(loadComments(repo)[0].side, 'left');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment ignores an empty step string', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { step: '', file: 'a.ts', line: 1, type: 'change', body: 'x' });
    assert.ok(!('step' in c));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment still requires file and a non-empty body', () => {
  const repo = tmpRepo();
  try {
    assert.throws(() => addComment(repo, { file: '', line: 1, type: 'change', body: 'x' }), /file/);
    assert.throws(() => addComment(repo, { file: 'a.ts', line: 1, type: 'change', body: '  ' }), /body/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('loadComments accepts legacy fields without turning them into active conversation state', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { file: 'a.ts', line: 1, type: 'question', body: 'why?' });
    // Simulate an old comments.json written by a pre-turns agent: a bare reply.
    const raw = loadComments(repo);
    raw[0].reply = 'because X';
    delete raw[0].turns;
    writeFileSync(join(repo, '.codestory', 'comments.json'), JSON.stringify(raw) + '\n');
    const [loaded] = loadComments(repo);
    assert.equal(loaded.reply, 'because X');
    assert.equal(loaded.turns, undefined);
    assert.equal(loaded.id, c.id);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('updateComment edits only reviewer-owned type and body', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { file: 'a.ts', line: 1, type: 'question', body: 'first?' });
    const updated = updateComment(repo, c.id, { type: 'change', body: '  request the fix  ' });
    assert.equal(updated.status, 'open');
    assert.equal(updated.type, 'change');
    assert.equal(updated.body, 'request the fix');
    assert.equal(updated.file, c.file);
    assert.equal(updated.line, c.line);
    assert.equal(loadComments(repo)[0].body, 'request the fix');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('updateComment rejects invalid edits and returns null for unknown ids', () => {
  const repo = tmpRepo();
  try {
    const c = addComment(repo, { file: 'a.ts', line: 1, type: 'change', body: 'x' });
    assert.throws(() => updateComment(repo, c.id, { body: '   ' }), /body/);
    assert.throws(() => updateComment(repo, c.id, { type: 'other' }), /type/);
    assert.equal(updateComment(repo, 'nope', { body: 'hi' }), null);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('comment loading reports malformed stores instead of treating them as empty feedback', () => {
  const repo = tmpRepo();
  try {
    mkdirSync(join(repo, '.codestory'));
    const path = join(repo, '.codestory', 'comments.json');
    const cases = [
      ['{broken', 'invalid-json'],
      [JSON.stringify({ comments: [] }), 'not-array'],
      [JSON.stringify([null]), 'invalid-entry'],
      [JSON.stringify([{ id: 'c1' }]), 'invalid-entry'],
    ];
    for (const [raw, reason] of cases) {
      writeFileSync(path, raw);
      const loaded = loadCommentsWithHealth(repo);
      assert.equal(loaded.health.status, 'invalid');
      assert.equal(loaded.health.reason, reason);
      assert.deepEqual(loaded.comments, []);
      assert.match(loaded.health.recovery, /will not overwrite/i);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('every comment mutation preserves a malformed comments file byte for byte', () => {
  const repo = tmpRepo();
  try {
    mkdirSync(join(repo, '.codestory'));
    const path = join(repo, '.codestory', 'comments.json');
    const malformed = '[null, {"partial": true}]';
    writeFileSync(path, malformed);
    const mutations = [
      () => addComment(repo, { file: 'a.ts', line: 1, type: 'change', body: 'x' }),
      () => updateComment(repo, 'c1', { body: 'follow up' }),
      () => deleteComment(repo, 'c1'),
    ];
    for (const mutate of mutations) {
      assert.throws(mutate, /will not overwrite the invalid file/i);
      assert.equal(readFileSync(path, 'utf8'), malformed);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('addComment stores the story it was filed against, and omits it when absent', () => {
  const repo = tmpRepo();
  try {
    const scoped = addComment(repo, {
      file: 'a.ts', line: 1, type: 'change', body: 'scoped', story: 'stories/quote-v2.json',
    });
    assert.equal(scoped.story, 'stories/quote-v2.json');

    const bare = addComment(repo, { file: 'a.ts', line: 2, type: 'change', body: 'bare' });
    assert.ok(!('story' in bare), 'story should be absent when not provided');

    const blank = addComment(repo, { file: 'a.ts', line: 3, type: 'change', body: 'blank', story: '   ' });
    assert.ok(!('story' in blank), 'a whitespace-only story id is not a story');

    assert.deepEqual(loadComments(repo).map((c) => c.story), ['stories/quote-v2.json', undefined, undefined]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('commentsForStory scopes feedback per story and keeps untagged comments everywhere', () => {
  const comments = [
    { id: 'c1', story: 'stories/a.json', file: 'a.ts', line: 1, type: 'change', body: 'a', status: 'open', createdAt: 'x' },
    { id: 'c2', story: 'stories/b.json', file: 'b.ts', line: 1, type: 'change', body: 'b', status: 'open', createdAt: 'x' },
    { id: 'c3', file: 'c.ts', line: 1, type: 'change', body: 'legacy', status: 'open', createdAt: 'x' },
  ];

  assert.deepEqual(
    commentsForStory(comments, 'stories/a.json').map((c) => c.id),
    ['c1', 'c3'],
    'one story sees its own comments plus untagged ones',
  );
  assert.deepEqual(commentsForStory(comments, 'stories/b.json').map((c) => c.id), ['c2', 'c3']);
  assert.deepEqual(
    commentsForStory(comments, 'stories/unknown.json').map((c) => c.id),
    ['c3'],
    'a story with no feedback of its own still sees untagged comments',
  );
  assert.deepEqual(
    commentsForStory(comments, null).map((c) => c.id),
    ['c1', 'c2', 'c3'],
    'a storyless surface sees the whole store',
  );
});

test('a repo whose comments predate stories keeps every comment visible', () => {
  const repo = tmpRepo();
  try {
    // Exactly the shape a pre-multi-story repo has on disk: no `story` field anywhere.
    mkdirSync(join(repo, '.codestory'), { recursive: true });
    writeFileSync(
      join(repo, '.codestory', 'comments.json'),
      JSON.stringify([
        { id: 'c1', step: 's1', file: 'a.ts', line: 4, type: 'change', body: 'old one', status: 'open', createdAt: 'x' },
        { id: 'c2', file: 'b.ts', line: 9, type: 'nit', body: 'old two', status: 'resolved', createdAt: 'x' },
      ]),
    );

    const loaded = loadCommentsWithHealth(repo);
    assert.equal(loaded.health.status, 'healthy', 'a story-less comment file is still valid');
    assert.deepEqual(commentsForStory(loaded.comments, 'stories/anything.json').map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(commentsForStory(loaded.comments, null).map((c) => c.id), ['c1', 'c2']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('a non-string story field invalidates the store instead of being ignored', () => {
  const repo = tmpRepo();
  try {
    mkdirSync(join(repo, '.codestory'), { recursive: true });
    writeFileSync(
      join(repo, '.codestory', 'comments.json'),
      JSON.stringify([{ id: 'c1', story: 7, file: 'a.ts', line: 1, type: 'change', body: 'x', status: 'open', createdAt: 'x' }]),
    );
    const loaded = loadCommentsWithHealth(repo);
    assert.equal(loaded.health.status, 'invalid');
    assert.match(loaded.health.message, /story must be a string/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
