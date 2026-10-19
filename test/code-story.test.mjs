// Code stories: a story that explains existing code at one commit, with no diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTour, validateNewGeneratedStory, validateTour } from '../dist/tour.js';
import {
  changedSinceCommit,
  codeStoryDrift,
  codeStoryOutputPath,
  codeStoryScope,
  codeStorySlug,
  verifyCodeStoryEvidence,
} from '../dist/code-story.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function codeStory(over = {}) {
  return {
    version: 4,
    subject: 'code',
    head: SHA,
    mode: 'guided',
    title: 'How a funding rate reaches settlement',
    summary: 'We start where settlement reads the rate and follow it into the cap.',
    intent: {
      goal: 'You want to know how a funding rate is capped before any balance moves.',
      design: '<code>settle()</code> reads the market config, then <code>capRate()</code> clamps the rate.',
      sources: ['code-derived'],
    },
    storyArc: { shape: 'entry-implementation', readingPath: 'settlement -> cap' },
    steps: [
      {
        id: 'map',
        order: 1,
        kind: 'concept',
        title: 'Where the rate comes from',
        page: '<!doctype html><html><body><p>config, then cap</p></body></html>',
        narration: 'Settlement reads one config per market, then caps the rate.',
      },
      {
        id: 's1',
        order: 2,
        kind: 'context',
        title: 'capRate() clamps the rate at the market cap',
        file: 'app.ts',
        range: [10, 10],
        viewport: [5, 15],
        highlights: [[10, 10]],
        why: 'Rules out a rate above the cap reaching settlement.',
        beats: [
          {
            text: 'This is <code>capRate()</code> in <code>app.ts</code>, the helper <code>settle()</code> calls once per market; it clamps the rate at the cap.',
            highlights: [[10, 10]],
          },
        ],
        landing: { symbol: 'capRate()', calledBy: ['settle()'] },
      },
    ],
    ...over,
  };
}

const codeStep = (over = {}) => ({ ...codeStory().steps[1], ...over });

test('a code story of context and concept steps validates', () => {
  assert.deepEqual(validateTour(codeStory()), []);
  assert.deepEqual(validateNewGeneratedStory(codeStory()), []);
});

test('code stories refuse changed and new-file steps', () => {
  const changed = validateTour(codeStory({ steps: [codeStep({ kind: 'changed', order: 1 })] }));
  assert.ok(
    changed.some((e) => /steps\[0\]\.kind "changed" is not allowed in a code story/.test(e)),
    changed.join('\n'),
  );
  const added = validateTour(codeStory({ steps: [codeStep({ kind: 'new-file', order: 1 })] }));
  assert.ok(added.some((e) => /steps\[0\]\.kind "new-file" is not allowed in a code story/.test(e)), added.join('\n'));
});

test('code stories pin a full commit and base must equal it', () => {
  const { head: _head, ...headless } = codeStory();
  const missing = validateTour(headless);
  assert.ok(missing.some((e) => /head must be the full 40-character commit id/.test(e)), missing.join('\n'));
  const short = validateTour(codeStory({ head: 'main' }));
  assert.ok(short.some((e) => /head must be the full 40-character commit id/.test(e)), short.join('\n'));
  const mismatched = validateTour(codeStory({ base: 'main' }));
  assert.ok(mismatched.some((e) => /base must equal head in a code story/.test(e)), mismatched.join('\n'));
  assert.deepEqual(validateTour(codeStory({ base: SHA })), []);
});

test('code stories need version 4 and carry no storyScope or evolution', () => {
  const errors = validateTour(
    codeStory({
      version: 3,
      steps: [codeStep({ order: 1 })],
      storyScope: { includedFiles: ['app.ts'] },
      evolution: {
        baseSha: SHA,
        headSha: SHA,
        phases: [{ title: 'One', summary: 'One phase.', firstCommit: SHA, lastCommit: SHA }],
      },
    }),
  );
  assert.ok(errors.some((e) => /a code story must be version 4/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /storyScope does not apply to a code story/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /evolution does not apply to a code story/.test(e)), errors.join('\n'));
});

test('code arcs use code shapes and no changeType', () => {
  const typed = validateTour(
    codeStory({ storyArc: { changeType: 'feature', shape: 'entry-implementation', readingPath: 'a -> b' } }),
  );
  assert.ok(typed.some((e) => /storyArc\.changeType does not apply to a code story/.test(e)), typed.join('\n'));
  const diffShape = validateTour(codeStory({ storyArc: { shape: 'before-after', readingPath: 'a -> b' } }));
  assert.ok(
    diffShape.some((e) => /storyArc\.shape must be one of entry-implementation, lifecycle/.test(e)),
    diffShape.join('\n'),
  );
  for (const shape of ['lifecycle', 'data-flow', 'map-then-path', 'core-supporting', 'rule-instances', 'cause-effect']) {
    assert.deepEqual(validateTour(codeStory({ storyArc: { shape, readingPath: 'a -> b' } })), [], shape);
  }
  // The diff vocabulary does not grow: a diff story still cannot pick a code-only shape.
  const diffSubjectStory = {
    version: 3,
    title: 'A diff story',
    summary: '',
    storyArc: { changeType: 'feature', shape: 'lifecycle', readingPath: 'a -> b' },
    steps: [{ ...codeStep({ order: 1 }), kind: 'changed' }],
  };
  assert.ok(validateTour(diffSubjectStory).some((e) => /storyArc\.shape must be one of cause-effect/.test(e)));
});

test('codeScope stays plain text with safe paths', () => {
  const unsafe = validateTour(codeStory({ codeScope: { paths: ['../x'] } }));
  assert.ok(
    unsafe.some((e) => /codeScope\.paths\[0\] must be a safe repository-relative path/.test(e)),
    unsafe.join('\n'),
  );
  const long = validateTour(codeStory({ codeScope: { question: 'q'.repeat(4001) } }));
  assert.ok(long.some((e) => /codeScope\.question must be at most 4000 characters/.test(e)), long.join('\n'));
  const many = validateTour(
    codeStory({ codeScope: { paths: Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`) } }),
  );
  assert.ok(many.some((e) => /codeScope\.paths must list at most 50 paths/.test(e)), many.join('\n'));
  // A question is shown as text, never as markup, so tag-shaped words are ordinary.
  assert.deepEqual(validateTour(codeStory({ codeScope: { question: 'How is Map<K, V> used in settle()?' } })), []);
  const control = validateTour(codeStory({ codeScope: { question: 'ring the bell\u0007' } }));
  assert.ok(
    control.some((e) => /codeScope\.question must not contain control characters/.test(e)),
    control.join('\n'),
  );
  assert.deepEqual(
    validateTour(codeStory({ codeScope: { ref: 'main', question: 'How is the rate capped?', paths: ['app.ts', 'src'] } })),
    [],
  );
});

test('subject must be diff or code', () => {
  const errors = validateTour(codeStory({ subject: 'docs' }));
  assert.ok(errors.some((e) => /subject must be "diff" or "code"/.test(e)), errors.join('\n'));
});

test('loadTour fills a code story base from its head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-code-story-'));
  try {
    const path = join(dir, 'code.json');
    writeFileSync(path, JSON.stringify(codeStory()));
    const tour = loadTour(path);
    assert.equal(tour.base, SHA);
    assert.equal(tour.head, SHA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- evidence and drift at the pinned commit ----

/** A repo on `main` with a 30-line app.ts and an unrelated other.ts, both committed. */
function withCommittedRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-code-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    const lines = Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
    writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
    writeFileSync(join(dir, 'other.ts'), 'export const other = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const sha = git('rev-parse', 'HEAD').trim();
    fn({ dir, sha, lines });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pinned = (sha, over = {}) => codeStory({ head: sha, base: sha, ...over });

test('code story evidence passes when every file and line exists at the commit', () => {
  withCommittedRepo(({ dir, sha }) => {
    assert.deepEqual(verifyCodeStoryEvidence(dir, pinned(sha)), { errors: [], worktreeDrift: [] });
  });
});

test('code story evidence names a missing file and a range past the end', () => {
  withCommittedRepo(({ dir, sha }) => {
    const story = pinned(sha, {
      steps: [
        codeStep({ id: 'gone', order: 1, file: 'missing.ts' }),
        codeStep({
          id: 'long',
          order: 2,
          range: [28, 28],
          viewport: [24, 34],
          highlights: [[28, 28]],
          beats: [{ text: 'The last export, <code>v28</code>, closes the file.', highlights: [[28, 28]] }],
        }),
      ],
    });
    const { errors } = verifyCodeStoryEvidence(dir, story);
    assert.ok(errors.some((e) => /missing\.ts does not exist at [0-9a-f]{7}/.test(e)), errors.join('\n'));
    assert.ok(
      errors.some((e) => /steps\[long\]\.viewport 24-34 runs past the end of app\.ts \(30 lines at [0-9a-f]{7}\)/.test(e)),
      errors.join('\n'),
    );
    assert.equal(errors.length, 2, errors.join('\n'));
  });
});

test('a commit missing from this repository is a readable error', () => {
  withCommittedRepo(({ dir }) => {
    const { errors } = verifyCodeStoryEvidence(dir, pinned('f'.repeat(40)));
    assert.deepEqual(errors, ['head fffffff is not a commit in this repository; this code story was written somewhere else']);
  });
});

test('uncommitted edits to a visited file are drift, not errors', () => {
  withCommittedRepo(({ dir, sha, lines }) => {
    writeFileSync(join(dir, 'app.ts'), ['// a new first line', ...lines].join('\n') + '\n');
    assert.deepEqual(verifyCodeStoryEvidence(dir, pinned(sha)), { errors: [], worktreeDrift: ['app.ts'] });
  });
});

test('drift stays current until a visited file changes', () => {
  withCommittedRepo(({ dir, sha, lines }) => {
    assert.deepEqual(codeStoryDrift(dir, pinned(sha)), { state: 'current', files: [] });
    writeFileSync(join(dir, 'other.ts'), 'export const other = 2;\n');
    assert.deepEqual(codeStoryDrift(dir, pinned(sha)), { state: 'current', files: [] });
    writeFileSync(join(dir, 'app.ts'), lines.slice(1).join('\n') + '\n');
    assert.deepEqual(codeStoryDrift(dir, pinned(sha)), { state: 'changed', files: ['app.ts'] });
    unlinkSync(join(dir, 'app.ts'));
    assert.deepEqual(codeStoryDrift(dir, pinned(sha)), { state: 'changed', files: ['app.ts'] });
    // A commit that is not here is its own state, so the reader can be told so.
    assert.deepEqual(codeStoryDrift(dir, pinned('f'.repeat(40))), { state: 'missing-commit', files: [] });
  });
});

test('changedSinceCommit reads the whole tree when no files are named', () => {
  withCommittedRepo(({ dir, sha }) => {
    writeFileSync(join(dir, 'other.ts'), 'export const other = 2;\n');
    assert.deepEqual(changedSinceCommit(dir, sha), ['other.ts']);
    assert.deepEqual(changedSinceCommit(dir, sha, []), []);
    assert.deepEqual(changedSinceCommit(dir, sha, ['app.ts']), []);
  });
});

test('slugs come from the question and stay unique', () => {
  assert.equal(codeStorySlug({ question: 'How does settlement work?' }), 'code-how-does-settlement-work');
  assert.equal(codeStorySlug({ question: '   ' }), 'code-codebase-tour');
  assert.equal(codeStorySlug({}), 'code-codebase-tour');
  assert.equal(codeStorySlug({ paths: ['contracts/facets', 'src'] }), 'code-contracts-facets');
  const long = codeStorySlug({ question: 'Walk me through every single step a liquidation takes from trigger to settlement' });
  assert.ok(long.length <= 48 && !long.endsWith('-'), long);
  assert.ok(long.startsWith('code-walk-me-through'), long);
  withCommittedRepo(({ dir }) => {
    const first = codeStoryOutputPath(dir, 'code-x');
    assert.equal(first, join(dir, '.codestory', 'stories', 'code-x.json'));
    mkdirSync(join(dir, '.codestory', 'stories'), { recursive: true });
    writeFileSync(first, '{}');
    assert.equal(codeStoryOutputPath(dir, 'code-x'), join(dir, '.codestory', 'stories', 'code-x-2.json'));
  });
});

test('the scope label reads ref at short commit', () => {
  const short = SHA.slice(0, 7);
  assert.deepEqual(codeStoryScope(codeStory({ codeScope: { ref: 'main' } })), {
    label: `main @ ${short}`,
    command: `git show ${SHA}`,
  });
  assert.equal(codeStoryScope(codeStory()).label, short);
  assert.equal(codeStoryScope(codeStory({ codeScope: { ref: SHA } })).label, short);
  assert.equal(codeStoryScope(codeStory({ codeScope: { ref: 'HEAD' } })).label, `HEAD @ ${short}`);
});

test('code story beats point at the code, never at an old side', () => {
  const errors = validateTour(
    codeStory({
      steps: [
        codeStep({
          order: 1,
          beats: [{ text: 'This is <code>capRate()</code>, the clamp settlement calls.', highlights: [[10, 10]], oldHighlights: [[9, 9]] }],
        }),
      ],
    }),
  );
  assert.ok(
    errors.some((e) => /steps\[0\]\.beats\[0\]\.oldHighlights do not apply to a code story/.test(e)),
    errors.join('\n'),
  );
});
