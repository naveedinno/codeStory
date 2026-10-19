// Unit tests for the per-repo remembered story selection. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  forgetSelection,
  loadStorySelections,
  recallStorySelection,
  recordStorySelection,
  rememberSelection,
  storySelectionFile,
} from '../dist/story-selection.js';

const tmpHome = () => mkdtempSync(join(tmpdir(), 'ds-sel-'));

test('rememberSelection records a repo and forgetSelection drops it', () => {
  const one = rememberSelection({}, '/repo/a', 'stories/quote-v2.json', 100);
  assert.deepEqual(one, { '/repo/a': { story: 'stories/quote-v2.json', at: 100 } });

  const two = rememberSelection(one, '/repo/b', 'story.json', 200);
  assert.equal(Object.keys(two).length, 2);
  assert.equal(two['/repo/a'].story, 'stories/quote-v2.json');

  const replaced = rememberSelection(two, '/repo/a', 'story.json', 300);
  assert.equal(replaced['/repo/a'].story, 'story.json', 'a repo keeps only its latest choice');
  assert.equal(Object.keys(replaced).length, 2);

  assert.deepEqual(forgetSelection(replaced, '/repo/a'), { '/repo/b': { story: 'story.json', at: 200 } });
});

test('rememberSelection prunes the oldest entries past the cap', () => {
  let selections = {};
  for (let i = 0; i < 5; i++) {
    selections = rememberSelection(selections, `/repo/${i}`, 'story.json', i, 3);
  }
  assert.deepEqual(Object.keys(selections).sort(), ['/repo/2', '/repo/3', '/repo/4']);
});

test('recordStorySelection round-trips through the global home store', () => {
  const home = tmpHome();
  try {
    assert.equal(recallStorySelection(home, '/repo/a'), null, 'nothing remembered yet');

    recordStorySelection(home, '/repo/a', 'stories/transient.json', 1);
    assert.equal(recallStorySelection(home, '/repo/a'), 'stories/transient.json');

    recordStorySelection(home, '/repo/a', null, 2);
    assert.equal(recallStorySelection(home, '/repo/a'), null, 'null forgets the selection');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the selection file lives in the global home, never in the repo', () => {
  const home = tmpHome();
  try {
    recordStorySelection(home, '/repo/a', 'story.json', 1);
    const file = storySelectionFile(home);
    assert.equal(file, join(home, '.codestory', 'story-selection.json'));
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.repos['/repo/a'].story, 'story.json');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a corrupt or foreign selection file reads as empty instead of throwing', () => {
  const home = tmpHome();
  try {
    const file = storySelectionFile(home);
    mkdirSync(join(file, '..'), { recursive: true });

    writeFileSync(file, 'not json at all');
    assert.deepEqual(loadStorySelections(home), {});

    writeFileSync(file, '[1,2,3]');
    assert.deepEqual(loadStorySelections(home), {});

    writeFileSync(file, JSON.stringify({ version: 1, repos: { '/a': { story: 42 } } }));
    assert.deepEqual(loadStorySelections(home), {}, 'a non-string story id is dropped');

    writeFileSync(file, JSON.stringify({ version: 1, repos: { '/a': { story: 'story.json' } } }));
    assert.deepEqual(loadStorySelections(home), { '/a': { story: 'story.json', at: 0 } });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
