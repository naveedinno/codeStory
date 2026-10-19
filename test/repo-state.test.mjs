// Unit tests for inspectRepo (the per-repo summary the picker shows). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectRepo } from '../dist/repo-state.js';

function gitRepo() {
  const d = mkdtempSync(join(tmpdir(), 'ds-state-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['config', 'user.email', 't@e.st'], { cwd: d });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: d });
  writeFileSync(join(d, 'README.md'), '# hi\n');
  execFileSync('git', ['add', '.'], { cwd: d });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: d });
  return d;
}

test('inspectRepo reports a non-git directory', () => {
  const d = mkdtempSync(join(tmpdir(), 'ds-state-'));
  try {
    const s = inspectRepo(d);
    assert.equal(s.isGit, false);
    assert.equal(s.hasTour, false);
    assert.equal(s.name, basename(d));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('inspectRepo detects a git repo and a present tour', () => {
  const d = gitRepo();
  try {
    let s = inspectRepo(d);
    assert.equal(s.isGit, true);
    assert.equal(s.hasTour, false);
    assert.equal(typeof s.changedFiles, 'number');

    mkdirSync(join(d, '.codestory'), { recursive: true });
    writeFileSync(join(d, '.codestory', 'story.json'), '{}');
    s = inspectRepo(d);
    assert.equal(s.hasTour, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('inspectRepo treats named stories as present stories', () => {
  const d = gitRepo();
  try {
    let s = inspectRepo(d);
    assert.equal(s.hasTour, false);

    mkdirSync(join(d, '.codestory', 'stories'), { recursive: true });
    writeFileSync(join(d, '.codestory', 'stories', 'agent-review.json'), '{}');

    s = inspectRepo(d);
    assert.equal(s.hasTour, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('inspectRepo counts untracked files as reviewable changes', () => {
  const d = gitRepo();
  try {
    writeFileSync(join(d, 'new-file.ts'), 'export const value = 1;\n');

    const s = inspectRepo(d);
    assert.equal(s.isGit, true);
    assert.equal(s.changedFiles, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
