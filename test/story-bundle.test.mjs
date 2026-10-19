import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bundleFileName,
  exportStoryBundle,
  importStoryBundle,
} from '../dist/story-bundle.js';
import { loadTour } from '../dist/tour.js';

function repoWithStory() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-bundle-'));
  mkdirSync(join(repo, '.codestory'), { recursive: true });
  return repo;
}

function tour(title = 'Exported') {
  return {
    version: 4,
    title,
    summary: 'summary',
    base: 'HEAD',
    steps: [
      { id: 's1', order: 1, title: 'Step', kind: 'changed', file: 'a.ts', range: [1, 2], why: 'because' },
    ],
  };
}

test('export bundles the validated story with replay metadata', () => {
  const repo = repoWithStory();
  const path = join(repo, '.codestory', 'story.json');
  writeFileSync(path, JSON.stringify(tour()));
  const bundle = exportStoryBundle(repo, path);
  assert.equal(bundle.bundle, 1);
  assert.equal(bundle.base, 'HEAD');
  assert.equal(bundle.story.title, 'Exported');
  assert.ok(bundle.exportedAt);
  assert.ok(bundle.repoName);
});

test('export refuses an invalid story instead of shipping it', () => {
  const repo = repoWithStory();
  const path = join(repo, '.codestory', 'story.json');
  writeFileSync(path, JSON.stringify({ version: 4, title: 'x' }));
  assert.throws(() => exportStoryBundle(repo, path), /not a valid story/);
});

test('bundle file names are download-safe', () => {
  assert.match(bundleFileName('story.json'), /^story-\d{8}\.codestory\.json$/);
  assert.match(
    bundleFileName('stories/Deep Dive.json'),
    /^stories-deep-dive-\d{8}\.codestory\.json$/,
  );
  assert.match(bundleFileName('../../x'), /^[a-z0-9-]+\.codestory\.json$/);
});

test('import saves under stories/ and never touches the primary story', () => {
  const repo = repoWithStory();
  writeFileSync(join(repo, '.codestory', 'story.json'), JSON.stringify(tour('Live')));
  const bundle = {
    bundle: 1,
    exportedAt: new Date().toISOString(),
    repoName: 'other',
    story: tour('Teammate walkthrough'),
  };
  const { id } = importStoryBundle(repo, 'teammate walkthrough', bundle);
  assert.equal(id, 'stories/teammate-walkthrough.json');
  assert.equal(loadTour(join(repo, '.codestory', id)).title, 'Teammate walkthrough');
  assert.equal(loadTour(join(repo, '.codestory', 'story.json')).title, 'Live');
});

test('import accepts a bare story and sanitizes hostile names', () => {
  const repo = repoWithStory();
  const first = importStoryBundle(repo, '../../../etc/evil', tour('Bare'));
  assert.equal(first.id, 'stories/etc-evil.json');
  assert.ok(!existsSync(join(repo, 'etc')));
  const second = importStoryBundle(repo, '../../../etc/evil', tour('Bare again'));
  assert.equal(second.id, 'stories/etc-evil-2.json', 'collisions get a suffix');
});

test('import rejects invalid bundles without writing', () => {
  const repo = repoWithStory();
  assert.throws(
    () => importStoryBundle(repo, 'bad', { bundle: 1, story: { version: 4 } }),
    /not a valid story/,
  );
  assert.equal(existsSync(join(repo, '.codestory', 'stories')), false);
});

test('imported stories open for review like any named story', () => {
  const repo = repoWithStory();
  const { id } = importStoryBundle(repo, '', tour('Untitled mate'));
  assert.equal(id, 'stories/untitled-mate.json', 'falls back to the story title');
  const raw = JSON.parse(readFileSync(join(repo, '.codestory', id), 'utf8'));
  assert.equal(raw.steps.length, 1);
});
