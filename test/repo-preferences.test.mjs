import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isStoryAudience,
  loadRepoPreferences,
  normalizeAudience,
  saveRepoPreferences,
} from '../dist/repo-preferences.js';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-prefs-'));
  mkdirSync(join(dir, '.codestory'), { recursive: true });
  return dir;
}

test('missing and malformed preferences fall back empty', () => {
  assert.deepEqual(loadRepoPreferences(repo()), {});
  const bad = repo();
  writeFileSync(join(bad, '.codestory', 'preferences.json'), '{nope');
  assert.deepEqual(loadRepoPreferences(bad), {});
  const arr = repo();
  writeFileSync(join(arr, '.codestory', 'preferences.json'), '[]');
  assert.deepEqual(loadRepoPreferences(arr), {});
});

test('audience normalizes to newcomer unless familiar', () => {
  assert.equal(normalizeAudience('familiar'), 'familiar');
  assert.equal(normalizeAudience('newcomer'), 'newcomer');
  assert.equal(normalizeAudience(undefined), 'newcomer');
  assert.equal(normalizeAudience('expert'), 'newcomer');
  assert.equal(isStoryAudience('familiar'), true);
  assert.equal(isStoryAudience('expert'), false);
});

test('load keeps valid fields and drops invalid ones', () => {
  const dir = repo();
  writeFileSync(
    join(dir, '.codestory', 'preferences.json'),
    JSON.stringify({
      defaultMode: 'detailed',
      includeGlobs: ['src/**'],
      excludeGlobs: 'nope',
      notes: 'Solidity only',
      audience: 'familiar',
      future: { kept: true },
    }),
  );
  const prefs = loadRepoPreferences(dir);
  assert.equal(prefs.defaultMode, 'detailed');
  assert.deepEqual(prefs.includeGlobs, ['src/**']);
  assert.equal(prefs.excludeGlobs, undefined);
  assert.equal(prefs.notes, 'Solidity only');
  assert.equal(prefs.audience, 'familiar');
});

test('save merges and preserves unknown keys, and drops bad audiences', () => {
  const dir = repo();
  writeFileSync(
    join(dir, '.codestory', 'preferences.json'),
    JSON.stringify({ notes: 'keep me', future: 1 }),
  );
  const saved = saveRepoPreferences(dir, { audience: 'familiar' });
  assert.equal(saved.audience, 'familiar');
  const raw = JSON.parse(readFileSync(join(dir, '.codestory', 'preferences.json'), 'utf8'));
  assert.equal(raw.notes, 'keep me');
  assert.equal(raw.future, 1);
  const dropped = saveRepoPreferences(dir, { audience: 'expert' });
  assert.equal(dropped.audience, undefined);
  assert.equal(
    JSON.parse(readFileSync(join(dir, '.codestory', 'preferences.json'), 'utf8')).audience,
    undefined,
  );
});

test('save creates the preferences file when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-prefs-'));
  const saved = saveRepoPreferences(dir, { audience: 'newcomer' });
  assert.equal(saved.audience, 'newcomer');
});
