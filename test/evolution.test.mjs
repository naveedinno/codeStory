import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../dist/atomic-json.js';
import {
  cachedEvolutionVerification,
  clearEvolutionVerificationCache,
  evolutionPreservationErrors,
  evolutionVerificationCacheSize,
  normalizeEvolutionObject,
  verifyEvolution,
} from '../dist/evolution.js';
import { commitEvolutionManifest } from '../dist/git.js';
import { prepareStoryOutput } from '../dist/server.js';
import { validateGeneratedTour, validateNewGeneratedStory, validateTour } from '../dist/tour.js';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-evolution-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'story.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const [subject, text] of [['introduce path', 'one'], ['tighten boundary', 'two'], ['prove result', 'three']]) {
    writeFileSync(join(repo, 'story.txt'), `base\n${text}\n`);
    git('add', '.');
    git('commit', '-qm', subject);
  }
  const head = git('rev-parse', 'HEAD');
  return { repo, git, base, head };
}

function modernStory(overrides = {}) {
  return {
    version: 3,
    mode: 'guided',
    title: 'Stable story',
    summary: 'Follow the changed decision into its proof.',
    intent: {
      goal: 'Let a reviewer verify the new decision.',
      design: 'The existing path reaches the changed decision and then its proof.',
      sources: ['conversation'],
    },
    steps: [{
      id: 'decision', order: 1, title: 'Changed decision', kind: 'changed', file: 'story.txt',
      range: [1, 1], viewport: [1, 1], highlights: [[1, 1]], why: 'This is the review hinge.',
      beats: [{ text: 'The final code makes the decision here.', highlights: [[1, 1]] }],
    }],
    ...overrides,
  };
}

test('story arc and evolution shape validation stay optional for old modern stories', () => {
  const old = modernStory();
  assert.deepEqual(validateGeneratedTour(old), []);
  assert.ok(validateNewGeneratedStory(old).includes('storyArc is required for a newly generated story'));

  const next = modernStory({
    storyArc: { changeType: 'bug-fix', shape: 'cause-effect', readingPath: 'failure -> fix -> proof' },
  });
  assert.deepEqual(validateNewGeneratedStory(next), []);

  const malformed = structuredClone(next);
  malformed.storyArc.readingPath = '<strong>not plain</strong>';
  malformed.evolution = {
    baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
    phases: [{
      title: 'Phase', summary: 'Summary', firstCommit: 'abcdef', lastCommit: 'b'.repeat(40), relatedSteps: ['missing'],
    }],
  };
  const errors = validateTour(malformed);
  assert.ok(errors.some((error) => error.includes('storyArc.readingPath <strong> is not allowed')));
  assert.ok(errors.some((error) => error.includes('7- to 40-character commit SHA')));
  assert.ok(errors.some((error) => error.includes('references unknown step id')));
});

test('every story arc enum and every evolution shape boundary is enforced', () => {
  const changeTypes = ['feature', 'bug-fix', 'refactor', 'security', 'performance', 'migration', 'maintenance', 'mixed'];
  const shapes = ['cause-effect', 'entry-implementation', 'before-after', 'core-supporting', 'rule-instances'];
  for (const changeType of changeTypes) {
    for (const shape of shapes) {
      assert.deepEqual(validateTour(modernStory({
        storyArc: { changeType, shape, readingPath: 'entry -> proof' },
      })), []);
    }
  }

  const invalid = modernStory({
    storyArc: { changeType: 'unknown', shape: 'file-order', readingPath: 'x'.repeat(201) },
    evolution: {
      baseSha: 'a'.repeat(39),
      headSha: 'z'.repeat(40),
      phases: Array.from({ length: 7 }, (_, index) => ({
        title: index ? `Phase ${index}` : '',
        summary: index ? 'Summary' : '',
        firstCommit: index ? 'a'.repeat(41) : 'abcdef',
        lastCommit: 'a'.repeat(7),
      })),
    },
  });
  const errors = validateTour(invalid);
  for (const fragment of [
    'storyArc.changeType must be one of',
    'storyArc.shape must be one of',
    'storyArc.readingPath must be at most 200 characters',
    'evolution.baseSha must be a full 40-character commit SHA',
    'evolution.headSha must be a full 40-character commit SHA',
    'evolution.phases must contain at most 6 phases',
    'evolution.phases[0].title is required',
    'evolution.phases[0].summary is required',
    'evolution.phases[0].firstCommit must be a 7- to 40-character commit SHA',
    'evolution.phases[1].firstCommit must be a 7- to 40-character commit SHA',
  ]) {
    assert.ok(errors.some((error) => error.includes(fragment)), `missing ${fragment}`);
  }
});

test('first-parent manifest is chronological, bounded, and measures commit changes', () => {
  const f = fixture();
  try {
    const manifest = commitEvolutionManifest(f.repo, f.base, f.head);
    assert.ok(manifest);
    assert.equal(manifest.baseSha, f.base);
    assert.equal(manifest.headSha, f.head);
    assert.equal(manifest.eligible, true);
    assert.deepEqual(manifest.commits.map((commit) => commit.subject), [
      'introduce path', 'tighten boundary', 'prove result',
    ]);
    assert.ok(manifest.commits.every((commit) => commit.parentCount === 1));
    assert.ok(manifest.commits.every((commit) => commit.files.includes('story.txt')));
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('first-parent evolution eligibility is limited to 2 through 30 commits', () => {
  const f = fixture();
  try {
    const oneBase = f.git('rev-parse', 'HEAD~1');
    assert.equal(commitEvolutionManifest(f.repo, oneBase, 'HEAD').commits.length, 1);
    assert.equal(commitEvolutionManifest(f.repo, oneBase, 'HEAD').eligible, false);
    for (let index = 4; index <= 31; index++) {
      writeFileSync(join(f.repo, 'story.txt'), `value ${index}\n`);
      f.git('add', '.');
      f.git('commit', '-qm', `progress ${index}`);
    }
    const oversized = commitEvolutionManifest(f.repo, f.base, 'HEAD');
    assert.equal(oversized.commits.length, 31);
    assert.equal(oversized.eligible, false);
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('merge commits are one first-parent phase measured against their first parent', () => {
  const f = fixture();
  try {
    const beforeMerge = f.git('rev-parse', 'HEAD');
    f.git('checkout', '-qb', 'side');
    writeFileSync(join(f.repo, 'side.txt'), 'side\n');
    f.git('add', '.');
    f.git('commit', '-qm', 'side work');
    f.git('checkout', '-q', 'main');
    f.git('merge', '--no-ff', '-qm', 'merge side', 'side');
    const head = f.git('rev-parse', 'HEAD');
    const manifest = commitEvolutionManifest(f.repo, beforeMerge, head);
    assert.equal(manifest.commits.length, 1);
    assert.equal(manifest.commits[0].subject, 'merge side');
    assert.equal(manifest.commits[0].parentCount, 2);
    assert.ok(manifest.commits[0].files.includes('side.txt'));
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('root-commit and divergent cross-ref comparisons degrade or freeze predictably', () => {
  const rootRepo = mkdtempSync(join(tmpdir(), 'ds-evolution-root-'));
  const rootGit = (...args) => execFileSync('git', args, { cwd: rootRepo, encoding: 'utf8' }).trim();
  try {
    rootGit('init', '-q', '-b', 'main');
    rootGit('config', 'user.email', 'test@example.com');
    rootGit('config', 'user.name', 'Test');
    writeFileSync(join(rootRepo, 'root.txt'), 'root\n');
    rootGit('add', '.');
    rootGit('commit', '-qm', 'root');
    const emptyTree = rootGit('hash-object', '-t', 'tree', '/dev/null');
    assert.equal(commitEvolutionManifest(rootRepo, emptyTree, 'HEAD'), null);
  } finally {
    rmSync(rootRepo, { recursive: true, force: true });
  }

  const f = fixture();
  try {
    f.git('branch', 'left', f.base);
    f.git('checkout', '-q', 'left');
    writeFileSync(join(f.repo, 'left.txt'), 'left\n');
    f.git('add', '.');
    f.git('commit', '-qm', 'left-only work');
    const left = f.git('rev-parse', 'HEAD');
    f.git('checkout', '-q', 'main');
    const manifest = commitEvolutionManifest(f.repo, left, f.head);
    assert.equal(manifest.baseSha, left);
    assert.equal(manifest.headSha, f.head);
    assert.deepEqual(manifest.commits.map((commit) => commit.subject), [
      'introduce path', 'tighten boundary', 'prove result',
    ]);
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('normalization expands unique prefixes and repository verification classifies defects', () => {
  const f = fixture();
  try {
    const manifest = commitEvolutionManifest(f.repo, f.base, f.head);
    const raw = {
      evolution: {
        phases: [{
          title: 'Build the path', summary: 'The commits introduce, tighten, and prove the path.',
          firstCommit: manifest.commits[0].sha.slice(0, 8),
          lastCommit: manifest.commits.at(-1).sha.slice(0, 9),
          relatedSteps: ['decision'],
        }],
      },
    };
    normalizeEvolutionObject(raw, manifest);
    assert.equal(raw.evolution.baseSha, f.base);
    assert.equal(raw.evolution.headSha, f.head);
    assert.equal(raw.evolution.phases[0].firstCommit, manifest.commits[0].sha);
    assert.equal(raw.evolution.phases[0].lastCommit, manifest.commits.at(-1).sha);

    const tour = modernStory({
      storyArc: { changeType: 'feature', shape: 'before-after', readingPath: 'before -> after -> proof' },
      evolution: raw.evolution,
    });
    assert.deepEqual(verifyEvolution(f.repo, tour, manifest), {
      errors: [], warnings: [], displayable: true, commitCount: 3, phaseCommitCounts: [3],
    });

    const gap = structuredClone(tour);
    gap.evolution.phases[0].firstCommit = manifest.commits[1].sha;
    const gapResult = verifyEvolution(f.repo, gap, manifest);
    assert.equal(gapResult.errors.length, 0);
    assert.equal(gapResult.displayable, false);
    assert.ok(gapResult.warnings.some((warning) => warning.includes('complete first-parent history')));

    const reversed = structuredClone(tour);
    reversed.evolution.phases[0].firstCommit = manifest.commits[2].sha;
    reversed.evolution.phases[0].lastCommit = manifest.commits[0].sha;
    assert.ok(verifyEvolution(f.repo, reversed, manifest).errors.some((error) => error.includes('runs backward')));

    const absent = structuredClone(tour);
    delete absent.evolution;
    const absentResult = verifyEvolution(f.repo, absent, manifest);
    assert.equal(absentResult.displayable, false);
    assert.ok(absentResult.warnings.some((warning) => warning.includes('no evolution block')));

    const ambiguousManifest = structuredClone(manifest);
    ambiguousManifest.commits[1].sha = `${manifest.commits[0].sha.slice(0, 7)}${'f'.repeat(33)}`;
    const ambiguous = structuredClone(tour);
    ambiguous.evolution.phases[0].firstCommit = manifest.commits[0].sha.slice(0, 7);
    assert.ok(verifyEvolution(f.repo, ambiguous, ambiguousManifest).errors.some((error) => error.includes('ambiguous')));
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('repair preservation protects arc and phase prose while allowing related step updates', () => {
  const arc = { changeType: 'feature', shape: 'entry-implementation', readingPath: 'entry -> implementation' };
  const evolution = {
    baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
    phases: [{ title: 'Build it', summary: 'The implementation lands.', firstCommit: 'c'.repeat(40), lastCommit: 'd'.repeat(40), relatedSteps: ['old'] }],
  };
  const allowed = modernStory({ storyArc: arc, evolution: { ...evolution, phases: [{ ...evolution.phases[0], relatedSteps: ['decision'] }] } });
  assert.deepEqual(evolutionPreservationErrors(allowed, arc, evolution), []);
  const reorderedArc = modernStory({
    storyArc: { readingPath: arc.readingPath, shape: arc.shape, changeType: arc.changeType },
    evolution,
  });
  assert.deepEqual(evolutionPreservationErrors(reorderedArc, arc, evolution), []);
  const changed = structuredClone(allowed);
  changed.evolution.phases[0].summary = 'Rewritten history.';
  assert.ok(evolutionPreservationErrors(changed, arc, evolution).some((error) => error.includes('relatedSteps')));
  assert.ok(evolutionPreservationErrors(modernStory(), undefined, undefined).length === 0);
});

test('verification cache reuses story identities, invalidates on identity change, and stays bounded', () => {
  const f = fixture();
  try {
    const manifest = commitEvolutionManifest(f.repo, f.base, f.head);
    const tour = modernStory({
      storyArc: { changeType: 'feature', shape: 'core-supporting', readingPath: 'core -> proof' },
      evolution: {
        baseSha: f.base, headSha: f.head,
        phases: [{ title: 'Complete range', summary: 'All commits stay together.', firstCommit: manifest.commits[0].sha, lastCommit: manifest.commits.at(-1).sha }],
      },
    });
    clearEvolutionVerificationCache();
    const first = cachedEvolutionVerification(f.repo, 'same', tour);
    assert.strictEqual(cachedEvolutionVerification(f.repo, 'same', tour), first);
    assert.notStrictEqual(cachedEvolutionVerification(f.repo, 'changed', tour), first);
    for (let index = 0; index < 130; index++) cachedEvolutionVerification(f.repo, `story-${index}`, tour);
    assert.equal(evolutionVerificationCacheSize(), 128);
  } finally {
    clearEvolutionVerificationCache();
    rmSync(f.repo, { recursive: true, force: true });
  }
});

test('atomic JSON writes skip byte-identical content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-atomic-json-'));
  const path = join(dir, 'story.json');
  try {
    assert.equal(writeJsonAtomic(path, { version: 1 }), true);
    const before = readFileSync(path, 'utf8');
    assert.equal(writeJsonAtomic(path, { version: 1 }), false);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('story output normalization expands history before stamping the fingerprint', () => {
  const f = fixture();
  const storyPath = join(f.repo, '.codestory', 'story.json');
  try {
    const manifest = commitEvolutionManifest(f.repo, f.base, f.head);
    const story = modernStory({
      storyArc: { changeType: 'feature', shape: 'cause-effect', readingPath: 'entry -> change -> proof' },
      evolution: {
        phases: [{
          title: 'Land the behavior', summary: 'The fixed range develops the final implementation.',
          firstCommit: manifest.commits[0].sha.slice(0, 7),
          lastCommit: manifest.commits.at(-1).sha.slice(0, 12),
        }],
      },
    });
    writeJsonAtomic(storyPath, story);
    prepareStoryOutput(storyPath, 'fingerprint-1', undefined, manifest);
    const normalized = JSON.parse(readFileSync(storyPath, 'utf8'));
    assert.equal(normalized.evolution.baseSha, f.base);
    assert.equal(normalized.evolution.headSha, f.head);
    assert.equal(normalized.evolution.phases[0].firstCommit, manifest.commits[0].sha);
    assert.equal(normalized.evolution.phases[0].lastCommit, manifest.commits.at(-1).sha);
    assert.equal(normalized.diffFingerprint, 'fingerprint-1');
    const bytes = readFileSync(storyPath, 'utf8');
    prepareStoryOutput(storyPath, 'fingerprint-1', undefined, manifest);
    assert.equal(readFileSync(storyPath, 'utf8'), bytes);
  } finally {
    rmSync(f.repo, { recursive: true, force: true });
  }
});
