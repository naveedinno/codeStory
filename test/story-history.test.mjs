import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import {
  HISTORY_LIMIT,
  isHistoryStoryId,
  listStoryHistory,
  liveStoryIdForSnapshot,
  restoreStoryVersion,
  snapshotStoryIfChanged,
} from '../dist/story-history.js';
import { storyPathForId } from '../dist/stories.js';
import { isDirty, isDirtyExceptHistory } from '../dist/git.js';
import { execFileSync } from 'node:child_process';

function repoWithStory() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-history-'));
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  return repo;
}

function storyFile(repo, id, tour) {
  const path = join(repo, '.codestory', id);
  mkdirSync(join(repo, '.codestory', 'stories'), { recursive: true });
  writeFileSync(path, JSON.stringify(tour));
  return path;
}

function tour(title, stepIds) {
  return {
    version: 4,
    title,
    summary: 'summary',
    steps: stepIds.map((id, i) => ({
      id,
      order: i + 1,
      title: `Step ${id}`,
      kind: 'changed',
      file: 'a.ts',
      range: [1, 2],
      why: 'because',
    })),
  };
}

test('snapshots a story on first sight and ignores unchanged bytes', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  const first = snapshotStoryIfChanged(repo, 'story.json');
  assert.ok(first);
  assert.equal(first.storyId, 'story.json');
  assert.equal(first.title, 'First');
  assert.equal(first.steps, 1);
  assert.match(first.id, /^history\/story-.*\.json$/);
  assert.equal(snapshotStoryIfChanged(repo, 'story.json'), null);
  assert.equal(readdirSync(join(repo, '.codestory', 'history')).length, 1);
});

test('snapshots again after the story changes, newest first', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  snapshotStoryIfChanged(repo, 'story.json');
  storyFile(repo, 'story.json', tour('Second', ['s1', 's2']));
  const second = snapshotStoryIfChanged(repo, 'story.json');
  assert.ok(second);
  const entries = listStoryHistory(repo, 'story.json');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'Second');
  assert.equal(entries[1].title, 'First');
  // The older snapshot diffs against the live story.
  assert.deepEqual(entries[1].diff, {
    titleChanged: true,
    stepDelta: 1,
    addedSteps: ['s2'],
    removedSteps: [],
  });
  assert.deepEqual(entries[0].diff?.addedSteps, []);
});

test('prunes snapshots beyond the limit', () => {
  const repo = repoWithStory();
  for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
    storyFile(repo, 'story.json', tour(`v${i}`, ['s1']));
    snapshotStoryIfChanged(repo, 'story.json');
  }
  const names = readdirSync(join(repo, '.codestory', 'history'));
  assert.equal(names.length, HISTORY_LIMIT);
  const entries = listStoryHistory(repo, 'story.json');
  assert.equal(entries[0].title, `v${HISTORY_LIMIT + 2}`);
});

test('restore puts snapshot bytes back and keeps the current version', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  snapshotStoryIfChanged(repo, 'story.json');
  storyFile(repo, 'story.json', tour('Second', ['s1', 's2']));
  snapshotStoryIfChanged(repo, 'story.json');
  const [current, older] = listStoryHistory(repo, 'story.json');
  void current;
  assert.equal(restoreStoryVersion(repo, 'story.json', older.name), true);
  const restored = JSON.parse(readFileSync(join(repo, '.codestory', 'story.json'), 'utf8'));
  assert.equal(restored.title, 'First');
  // Restoring snapshotted the pre-restore bytes, so it is undoable.
  const titles = listStoryHistory(repo, 'story.json').map((e) => e.title);
  assert.ok(titles.includes('Second'));
});

test('restore rejects traversal and foreign snapshots', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  snapshotStoryIfChanged(repo, 'story.json');
  mkdirSync(join(repo, '.codestory', 'stories'), { recursive: true });
  storyFile(repo, 'stories/other.json', tour('Other', ['s1']));
  snapshotStoryIfChanged(repo, 'stories/other.json');
  const foreign = listStoryHistory(repo, 'stories/other.json')[0].name;
  assert.equal(restoreStoryVersion(repo, 'story.json', '../story.json'), false);
  assert.equal(restoreStoryVersion(repo, 'story.json', foreign), false);
  assert.equal(restoreStoryVersion(repo, 'history/x.json', 'x.json'), false);
  assert.equal(
    JSON.parse(readFileSync(join(repo, '.codestory', 'story.json'), 'utf8')).title,
    'First',
  );
});

test('history snapshots never snapshot themselves', () => {
  const repo = repoWithStory();
  assert.equal(snapshotStoryIfChanged(repo, 'history/anything.json'), null);
  assert.deepEqual(listStoryHistory(repo, 'history/anything.json'), []);
  assert.equal(existsSync(join(repo, '.codestory', 'history')), false);
});

test('isHistoryStoryId classifies story ids', () => {
  assert.equal(isHistoryStoryId('history/a.json'), true);
  assert.equal(isHistoryStoryId('history'), true);
  assert.equal(isHistoryStoryId('story.json'), false);
  assert.equal(isHistoryStoryId('stories/a.json'), false);
  assert.equal(isHistoryStoryId(null), false);
  assert.equal(isHistoryStoryId(undefined), false);
});

test('liveStoryIdForSnapshot maps snapshots back to live stories', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  storyFile(repo, 'stories/Deep Dive.json', tour('Deep', ['s1']));
  const primary = snapshotStoryIfChanged(repo, 'story.json');
  const named = snapshotStoryIfChanged(repo, 'stories/Deep Dive.json');
  assert.ok(primary && named);
  assert.equal(liveStoryIdForSnapshot(repo, primary.name), 'story.json');
  assert.equal(liveStoryIdForSnapshot(repo, named.name), 'stories/Deep Dive.json');
  assert.equal(liveStoryIdForSnapshot(repo, 'nope-20261003T060445123-a1b2c3d4.json'), null);
  assert.equal(liveStoryIdForSnapshot(repo, 'garbage.json'), null);
});

test('storyPathForId resolves history snapshots for read-only review', () => {
  const repo = repoWithStory();
  storyFile(repo, 'story.json', tour('First', ['s1']));
  const entry = snapshotStoryIfChanged(repo, 'story.json');
  assert.ok(entry);
  assert.equal(storyPathForId(repo, entry.id), join(repo, '.codestory', entry.id));
  assert.equal(storyPathForId(repo, 'history/missing.json'), null);
  assert.equal(storyPathForId(repo, 'history/../story.json'), null);
});

test('snapshots do not dirty the tree for scope selection, real edits still do', () => {
  // Snapshots land on read paths, so a plain isDirty check would veto the
  // committed-story fallback on every clean tree with a snapshot in it.
  const repo = mkdtempSync(join(tmpdir(), 'ds-history-dirty-'));
  const g = (a) => execFileSync('git', a, { cwd: repo });
  g(['init', '-q']);
  g(['config', 'user.email', 't@e.st']);
  g(['config', 'user.name', 'T']);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  g(['add', '.']);
  g(['commit', '-qm', 'init']);
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  storyFile(repo, 'story.json', tour('First', ['s1']));
  g(['add', '.']);
  g(['commit', '-qm', 'story']);
  assert.equal(isDirtyExceptHistory(repo), false);

  assert.ok(snapshotStoryIfChanged(repo, 'story.json'), 'a snapshot lands');
  assert.equal(isDirty(repo), true, 'raw status still sees the snapshot file');
  assert.equal(isDirtyExceptHistory(repo), false, 'scope checks ignore it');

  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  assert.equal(isDirtyExceptHistory(repo), true, 'a real edit still counts');
});
