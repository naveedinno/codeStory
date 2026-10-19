// The one-shot Notes model (Signal 3b) keeps only scope identity, the diff
// fingerprint, and feedback health here — the versioned rounds/verdicts/
// snapshots machinery was removed with the port. These tests pin what remains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnifiedDiff } from '../dist/diff.js';
import { getDiff } from '../dist/git.js';
import {
  reviewDiffFingerprint,
  reviewScopeKey,
  reviewStateSummary,
} from '../dist/review-state.js';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-notes-'));
  const git = (args) => execFileSync('git', args, { cwd: dir });
  git(['init', '-q']);
  git(['config', 'user.email', 't@e.st']);
  git(['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'a.ts'), 'export const value = 1;\n');
  git(['add', '.']);
  git(['commit', '-qm', 'init']);
  return { dir, git };
}

function current(dir) {
  const diff = getDiff(dir, 'HEAD');
  return { diff, files: parseUnifiedDiff(diff) };
}

test('scope keys are stable per base/head pair and distinguish the working tree', () => {
  assert.equal(reviewScopeKey('main'), reviewScopeKey('main'));
  assert.equal(reviewScopeKey('main', 'feat'), reviewScopeKey('main', 'feat'));
  assert.notEqual(reviewScopeKey('main'), reviewScopeKey('main', 'feat'));
  assert.notEqual(reviewScopeKey('main'), reviewScopeKey('dev'));
});

test('the diff fingerprint identifies the exact rendered bytes', () => {
  assert.equal(reviewDiffFingerprint('diff'), reviewDiffFingerprint('diff'));
  assert.notEqual(reviewDiffFingerprint('diff'), reviewDiffFingerprint('diff '));
});

test('the summary carries scope, fingerprint, and feedback health — nothing more', () => {
  const { dir } = repo();
  try {
    writeFileSync(join(dir, 'a.ts'), 'export const value = 2;\n');
    const { diff, files } = current(dir);
    const summary = reviewStateSummary(dir, 'HEAD', undefined, diff, files);
    assert.equal(summary.scopeKey, reviewScopeKey('HEAD'));
    assert.equal(summary.currentDiffHash, reviewDiffFingerprint(diff));
    assert.equal(summary.feedbackHealth.status, 'healthy');
    assert.deepEqual(Object.keys(summary).sort(), ['currentDiffHash', 'feedbackHealth', 'scopeKey']);
    const pinned = reviewStateSummary(dir, 'HEAD', undefined, diff, files, 'external-fingerprint');
    assert.equal(pinned.currentDiffHash, 'external-fingerprint');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid feedback surfaces through the summary instead of reading as no comments', () => {
  const { dir } = repo();
  try {
    mkdirSync(join(dir, '.codestory'), { recursive: true });
    writeFileSync(join(dir, '.codestory', 'comments.json'), '[null, {"partial": true}]');
    const { diff, files } = current(dir);
    const summary = reviewStateSummary(dir, 'HEAD', undefined, diff, files);
    assert.equal(summary.feedbackHealth.status, 'invalid');
    assert.match(summary.feedbackHealth.recovery, /will not overwrite/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
