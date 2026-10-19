import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import {
  captureStorySnapshot,
  inspectStoryDrift,
  loadStoryDriftDiff,
} from '../dist/story-drift.js';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'codestory-drift-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'drift@example.test']);
  git(['config', 'user.name', 'Drift Test']);
  mkdirSync(join(repo, 'contracts'));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 1; }\n');
  writeFileSync(join(repo, 'test', 'A.test.ts'), 'export const expected = 1\n');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked at base\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return {
    repo,
    git,
    cleanup: () => rmSync(repo, { recursive: true, force: true }),
  };
}

function capture(repo, options = {}) {
  return captureStorySnapshot({
    repo,
    base: 'HEAD',
    storyScope: { includedFiles: ['contracts/A.sol'] },
    ...options,
  });
}

test('capture is deterministic and a zero-drift working-tree snapshot is current', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 2; }\n');
    const first = capture(f.repo);
    const second = capture(f.repo);
    assert.deepEqual(second, first, 'identity contains repository content, not capture time');
    assert.match(first.id, /^[0-9a-f]{64}$/);

    const report = inspectStoryDrift({ repo: f.repo, snapshot: first });
    assert.equal(report.status, 'current');
    assert.equal(report.storyFreshness, 'current');
    assert.equal(report.complete, true);
    assert.equal(report.inScopeCount, 0);
    assert.equal(report.outsideScopeCount, 0);
    assert.deepEqual(report.changes, []);
    assert.match(report.observationId, /^[0-9a-f]{64}$/);

    const snapshotDir = join(f.repo, '.codestory', 'snapshots');
    assert.ok(existsSync(join(snapshotDir, `${first.id}.json`)));
    assert.ok(readdirSync(join(snapshotDir, 'blobs')).some((name) => name.endsWith('.gz')));

    const manifest = JSON.parse(readFileSync(join(snapshotDir, `${first.id}.json`), 'utf8'));
    const captured = manifest.state.entries.find((entry) => entry.path === 'contracts/A.sol').review;
    const capturedBytes = gunzipSync(readFileSync(join(snapshotDir, 'blobs', `${captured.blob}.gz`)));
    const objectFormat = manifest.base.resolvedTree.length === 64 ? 'sha256' : 'sha1';
    const capturedOid = createHash(objectFormat)
      .update(Buffer.from(`blob ${capturedBytes.length}\0`))
      .update(capturedBytes)
      .digest('hex');
    assert.equal(captured.oid, capturedOid, 'stable identity and stored bytes are bound to the same Git blob');
  } finally {
    f.cleanup();
  }
});

test('expected story binding covers base, head semantics, and normalized included files', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 7; }\n');
    const expected = {
      base: 'HEAD',
      storyScope: { includedFiles: ['contracts/A.sol', 'contracts/A.sol'] },
    };
    const report = inspectStoryDrift({ repo: f.repo, snapshot, expected });
    assert.equal(report.storyFreshness, 'stale');
    assert.match(report.observationId, /^[0-9a-f]{64}$/);

    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      expected,
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(loaded.status, 'exact');

    for (const mismatch of [
      { base: 'HEAD~0', storyScope: { includedFiles: ['contracts/A.sol'] } },
      { base: 'HEAD', head: 'HEAD', storyScope: { includedFiles: ['contracts/A.sol'] } },
      { base: 'HEAD', storyScope: { includedFiles: ['test/A.test.ts'] } },
    ]) {
      const rejected = inspectStoryDrift({ repo: f.repo, snapshot, expected: mismatch });
      assert.equal(rejected.status, 'unverified');
      assert.match(rejected.reason, /does not match the story base, head, or included-file scope/i);
    }

    const rejectedLoad = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      expected: { base: 'HEAD', storyScope: { includedFiles: ['test/A.test.ts'] } },
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(rejectedLoad.status, 'unverified');
  } finally {
    f.cleanup();
  }
});

test('a mutable base ref moving after capture makes the story unverified', () => {
  const f = fixture();
  try {
    f.git(['branch', 'story-base', 'HEAD']);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 2; }\n');
    const snapshot = captureStorySnapshot({
      repo: f.repo,
      base: 'story-base',
      storyScope: { includedFiles: ['contracts/A.sol'] },
    });
    const expected = { base: 'story-base', storyScope: { includedFiles: ['contracts/A.sol'] } };
    assert.equal(inspectStoryDrift({ repo: f.repo, snapshot, expected }).storyFreshness, 'current');

    f.git(['add', 'contracts/A.sol']);
    f.git(['commit', '-qm', 'advance comparison base']);
    f.git(['branch', '-f', 'story-base', 'HEAD']);
    assert.equal(f.git(['diff', 'story-base', '--']), '', 'the active comparison now resolves to the advanced base');

    const report = inspectStoryDrift({ repo: f.repo, snapshot, expected });
    assert.equal(report.status, 'unverified');
    assert.equal(report.storyFreshness, 'unverified');
    assert.match(report.reason, /base ref moved after its baseline was captured/i);
  } finally {
    f.cleanup();
  }
});

test('frozen capture keeps display refs while reading immutable endpoint trees', () => {
  const f = fixture();
  try {
    const frozenBase = f.git(['rev-parse', 'HEAD']);
    f.git(['branch', 'story-base', frozenBase]);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 2; }\n');
    f.git(['add', '.']);
    f.git(['commit', '-qm', 'story head']);
    const frozenHead = f.git(['rev-parse', 'HEAD']);
    f.git(['branch', 'story-head', frozenHead]);

    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 3; }\n');
    f.git(['add', '.']);
    f.git(['commit', '-qm', 'refs moved later']);
    f.git(['branch', '-f', 'story-base', 'HEAD']);
    f.git(['branch', '-f', 'story-head', 'HEAD']);

    const snapshot = captureStorySnapshot({
      repo: f.repo,
      base: 'story-base',
      head: 'story-head',
      frozenBase,
      frozenHead,
      storyScope: { includedFiles: ['contracts/A.sol'] },
    });
    const manifest = JSON.parse(readFileSync(
      join(f.repo, '.codestory', 'snapshots', `${snapshot.id}.json`),
      'utf8',
    ));
    assert.equal(manifest.base.requested, 'story-base');
    assert.equal(manifest.head.requested, 'story-head');
    assert.equal(manifest.base.resolvedTree, f.git(['rev-parse', `${frozenBase}^{tree}`]));
    assert.equal(manifest.head.resolvedTree, f.git(['rev-parse', `${frozenHead}^{tree}`]));
  } finally {
    f.cleanup();
  }
});

test('outside drift stays side-file-only while a later in-scope edit makes the story stale', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 2; }\n');
    const snapshot = capture(f.repo);

    writeFileSync(join(f.repo, 'test', 'A.test.ts'), 'export const expected = 2\n');
    const outside = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(outside.status, 'changed');
    assert.equal(outside.storyFreshness, 'current');
    assert.equal(outside.inScopeCount, 0);
    assert.equal(outside.outsideScopeCount, 1);
    assert.deepEqual(outside.changes.map((change) => [change.path, change.kind, change.inStory]), [
      ['test/A.test.ts', 'modified', false],
    ]);

    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 3; }\n');
    const both = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(both.storyFreshness, 'stale');
    assert.equal(both.inScopeCount, 1);
    assert.equal(both.outsideScopeCount, 1);
    assert.deepEqual(both.changes.map((change) => change.path), ['contracts/A.sol', 'test/A.test.ts']);
  } finally {
    f.cleanup();
  }
});

test('one hundred side files are counted deterministically without staling the story', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    mkdirSync(join(f.repo, 'notes'));
    for (let i = 99; i >= 0; i -= 1) {
      writeFileSync(join(f.repo, 'notes', `side-${String(i).padStart(3, '0')}.txt`), `side ${i}\n`);
    }
    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.storyFreshness, 'current');
    assert.equal(report.inScopeCount, 0);
    assert.equal(report.outsideScopeCount, 100);
    assert.equal(report.changes.length, 100);
    assert.equal(report.changes[0].path, 'notes/side-000.txt');
    assert.equal(report.changes[99].path, 'notes/side-099.txt');
    assert.ok(report.changes.every((change) => change.kind === 'added' && !change.inStory));
  } finally {
    f.cleanup();
  }
});

test('staged modifications, staged deletions, and untracked additions all remain visible', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 9; }\n');
    f.git(['add', 'contracts/A.sol']);
    f.git(['rm', '-q', 'tracked.txt']);
    writeFileSync(join(f.repo, 'loose.txt'), 'untracked after story\n');

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.storyFreshness, 'stale');
    assert.equal(report.inScopeCount, 1);
    assert.equal(report.outsideScopeCount, 2);
    assert.deepEqual(report.changes.map((change) => [change.path, change.kind]), [
      ['contracts/A.sol', 'modified'],
      ['loose.txt', 'added'],
      ['tracked.txt', 'deleted'],
    ]);
  } finally {
    f.cleanup();
  }
});

test('lazy loading returns an exact snapshot-to-current per-file unified diff', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A {\n\tuint256 value = 2;\n}\n');
    const snapshot = capture(f.repo);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A {\n\tuint256 value = 3;\n}\n');
    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.inScopeCount, 1);

    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(loaded.status, 'exact');
    assert.match(loaded.diff, /^diff --git a\/contracts\/A\.sol b\/contracts\/A\.sol/m);
    assert.match(loaded.diff, /^-\s*uint256 value = 2;/m);
    assert.match(loaded.diff, /^\+\s*uint256 value = 3;/m);

    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 4; }\n');
    const moved = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(moved.status, 'unverified', 'an observation never floats to newer bytes');
  } finally {
    f.cleanup();
  }
});

test('content-preserving add/delete pairs are reported as renames and diffed lazily', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo, { storyScope: { includedFiles: ['tracked.txt'] } });
    renameSync(join(f.repo, 'tracked.txt'), join(f.repo, 'renamed.txt'));
    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.deepEqual(report.changes.map((change) => ({
      path: change.path, oldPath: change.oldPath, kind: change.kind, inStory: change.inStory,
    })), [{ path: 'renamed.txt', oldPath: 'tracked.txt', kind: 'renamed', inStory: true }]);

    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'renamed.txt',
    });
    assert.equal(loaded.status, 'exact');
    assert.match(loaded.diff, /similarity index 100%/);
    assert.match(loaded.diff, /rename from tracked\.txt/);
    assert.match(loaded.diff, /rename to renamed\.txt/);
  } finally {
    f.cleanup();
  }
});

test('content-preserving renames remain one exact change when the file mode also changes', () => {
  const f = fixture();
  try {
    f.git(['config', 'core.filemode', 'true']);
    const snapshot = capture(f.repo, { storyScope: { includedFiles: ['tracked.txt'] } });
    renameSync(join(f.repo, 'tracked.txt'), join(f.repo, 'renamed-executable.txt'));
    chmodSync(join(f.repo, 'renamed-executable.txt'), 0o755);

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.inScopeCount, 1);
    assert.equal(report.outsideScopeCount, 0);
    assert.deepEqual(report.changes.map((change) => ({
      path: change.path,
      oldPath: change.oldPath,
      kind: change.kind,
      evidence: change.evidence,
    })), [{
      path: 'renamed-executable.txt',
      oldPath: 'tracked.txt',
      kind: 'renamed',
      evidence: 'exact',
    }]);

    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'renamed-executable.txt',
    });
    assert.equal(loaded.status, 'exact');
    assert.match(loaded.diff, /old mode 100644/);
    assert.match(loaded.diff, /new mode 100755/);
    assert.match(loaded.diff, /rename from tracked\.txt/);
    assert.match(loaded.diff, /rename to renamed-executable\.txt/);
  } finally {
    f.cleanup();
  }
});

test('deleting an ancestor directory preserves exact evidence for nested tracked files', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.repo, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(f.repo, 'nested', 'deep', 'tracked.txt'), 'nested tracked bytes\n');
    f.git(['add', 'nested/deep/tracked.txt']);
    f.git(['commit', '-qm', 'add nested tracked file']);
    const snapshot = capture(f.repo, { storyScope: { includedFiles: ['nested/deep/tracked.txt'] } });

    rmSync(join(f.repo, 'nested'), { recursive: true, force: true });
    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.complete, true);
    assert.equal(report.storyFreshness, 'stale');
    assert.deepEqual(report.changes.map((change) => ({
      path: change.path,
      kind: change.kind,
      evidence: change.evidence,
      reason: change.reason,
    })), [{
      path: 'nested/deep/tracked.txt',
      kind: 'deleted',
      evidence: 'exact',
      reason: undefined,
    }]);

    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'nested/deep/tracked.txt',
    });
    assert.equal(loaded.status, 'exact');
    assert.match(loaded.diff, /deleted file mode 100644/);
    assert.match(loaded.diff, /^-nested tracked bytes$/m);
  } finally {
    f.cleanup();
  }
});

test('missing, corrupt, and unsafe snapshot references are safely unverified', () => {
  const f = fixture();
  try {
    const missing = inspectStoryDrift({ repo: f.repo, snapshot: undefined });
    assert.equal(missing.status, 'unverified');
    assert.equal(missing.storyFreshness, 'unverified');

    const snapshot = capture(f.repo);
    writeFileSync(join(f.repo, '.codestory', 'snapshots', `${snapshot.id}.json`), '{broken');
    const corrupt = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(corrupt.status, 'unverified');
    assert.equal(corrupt.complete, false);

    const unsafe = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: 'x',
      path: '../outside',
    });
    assert.equal(unsafe.status, 'unverified');
  } finally {
    f.cleanup();
  }
});

test('binary, generated, and oversized side drift is counted with honest evidence', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    mkdirSync(join(f.repo, 'dist'));
    writeFileSync(join(f.repo, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(f.repo, 'dist', 'bundle.js'), 'generated output\n');
    writeFileSync(join(f.repo, 'oversized.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.storyFreshness, 'current');
    assert.equal(report.outsideScopeCount, 3);
    assert.deepEqual(report.changes.map((change) => [change.path, change.evidence, change.reason]), [
      ['asset.bin', 'unavailable', 'binary'],
      ['dist/bundle.js', 'exact', 'generated'],
      ['oversized.txt', 'partial', 'oversized'],
    ]);

    const binary = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'asset.bin',
    });
    assert.equal(binary.status, 'unavailable');
    assert.match(binary.reason, /Binary contents changed/);
  } finally {
    f.cleanup();
  }
});

test('an ancestor symlink cannot make drift inspection read outside the repository', () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'codestory-outside-'));
  try {
    const snapshot = capture(f.repo);
    writeFileSync(join(outside, 'A.sol'), 'outside bytes must never become repository evidence\n');
    rmSync(join(f.repo, 'contracts'), { recursive: true, force: true });
    symlinkSync(outside, join(f.repo, 'contracts'), 'dir');

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.status, 'changed');
    assert.equal(report.storyFreshness, 'stale');
    assert.equal(report.complete, false);
    assert.ok(report.changes.some((change) => change.path === 'contracts/A.sol' && change.evidence === 'unavailable'));
    assert.match(report.observationId, /^[0-9a-f]{64}$/);
    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(loaded.status, 'unavailable');
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test('regular-file to symlink transitions are never advertised as exact patches', () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    rmSync(join(f.repo, 'contracts', 'A.sol'));
    symlinkSync('../tracked.txt', join(f.repo, 'contracts', 'A.sol'));

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.complete, true);
    assert.deepEqual(report.changes.map((change) => [change.path, change.evidence, change.reason]), [
      ['contracts/A.sol', 'unavailable', 'special-file'],
    ]);
    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'contracts/A.sol',
    });
    assert.equal(loaded.status, 'unavailable');
    assert.match(loaded.reason, /symlink type or mode transition/i);
  } finally {
    f.cleanup();
  }
});

test('outside special-file drift stays countable and does not stale selected story paths', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const snapshot = capture(f.repo);
    rmSync(join(f.repo, 'tracked.txt'));
    execFileSync('mkfifo', [join(f.repo, 'tracked.txt')]);

    const report = inspectStoryDrift({ repo: f.repo, snapshot });
    assert.equal(report.status, 'changed');
    assert.equal(report.storyFreshness, 'current');
    assert.equal(report.complete, false);
    assert.equal(report.inScopeCount, 0);
    assert.equal(report.outsideScopeCount, 1);
    assert.deepEqual(report.changes.map((change) => [change.path, change.kind, change.evidence, change.reason]), [
      ['tracked.txt', 'modified', 'unavailable', 'special-file'],
    ]);
    assert.match(report.observationId, /^[0-9a-f]{64}$/);
    const loaded = loadStoryDriftDiff({
      repo: f.repo,
      snapshot,
      observationId: report.observationId,
      path: 'tracked.txt',
    });
    assert.equal(loaded.status, 'unavailable');
    assert.match(loaded.reason, /Special-file contents cannot be rendered safely/i);
  } finally {
    f.cleanup();
  }
});

test('a fixed-head snapshot follows the named head while keeping its base tree pinned', () => {
  const f = fixture();
  try {
    const base = f.git(['rev-parse', 'HEAD']);
    writeFileSync(join(f.repo, 'contracts', 'A.sol'), 'contract A { uint256 value = 2; }\n');
    f.git(['add', '.']);
    f.git(['commit', '-qm', 'story head']);
    const snapshot = captureStorySnapshot({
      repo: f.repo,
      base,
      head: 'HEAD',
      storyScope: { includedFiles: ['contracts/A.sol'] },
    });

    writeFileSync(join(f.repo, 'test', 'A.test.ts'), 'export const expected = 2\n');
    f.git(['add', '.']);
    f.git(['commit', '-qm', 'move head with a side file']);
    const report = inspectStoryDrift({
      repo: f.repo,
      snapshot,
      expected: { base, head: 'HEAD', storyScope: { includedFiles: ['contracts/A.sol'] } },
    });
    assert.equal(report.storyFreshness, 'current');
    assert.equal(report.inScopeCount, 0);
    assert.equal(report.outsideScopeCount, 1);
    assert.deepEqual(report.changes.map((change) => change.path), ['test/A.test.ts']);
  } finally {
    f.cleanup();
  }
});

test('persisted digest tags keep the names they had before the codeStory rename', () => {
  // Saved snapshot manifests are verified against these tags and viewed-file
  // marks are keyed by the file-index hash, so renaming a tag with the product
  // would silently invalidate every snapshot and review mark already on disk.
  const drift = readFileSync(new URL('../src/story-drift.ts', import.meta.url), 'utf8');
  const git = readFileSync(new URL('../src/git.ts', import.meta.url), 'utf8');
  for (const tag of ['diffstory-snapshot-v1', 'diffstory-state-v1', 'diffstory-observation-v1']) {
    assert.ok(drift.includes(`\`${tag}\\0`), `story-drift.ts still digests with ${tag}`);
  }
  assert.ok(git.includes('hash.update("diffstory-file-index-v1\\0");'), 'git.ts still digests with diffstory-file-index-v1');
});
