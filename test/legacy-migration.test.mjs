// The diffStory → codeStory rename moved each repo's data folder (.diffstory/ →
// .codestory/) and the app home (~/.diffstory/ → ~/.codestory/). These pin the
// one-way migrations that carry the old data over: a newer copy always wins,
// and nothing that was not moved is ever deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { migrateLegacyDataDir, migrateLegacyHome } from '../dist/legacy-migration.js';

const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const read = (path) => readFileSync(path, 'utf8');
function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function withDir(prefix, fn) {
  const dir = tmp(prefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a legacy .diffstory folder moves into .codestory when the new one is absent', () => {
  withDir('ds-migrate-move-', (repo) => {
    put(join(repo, '.diffstory', 'story.json'), 'story');
    put(join(repo, '.diffstory', 'comments.json'), '[]');
    put(join(repo, '.diffstory', 'stories', 'a.json'), 'a');
    const result = migrateLegacyDataDir(repo);
    assert.equal(read(join(repo, '.codestory', 'story.json')), 'story');
    assert.equal(read(join(repo, '.codestory', 'comments.json')), '[]');
    assert.equal(read(join(repo, '.codestory', 'stories', 'a.json')), 'a');
    assert.equal(existsSync(join(repo, '.diffstory')), false, 'the moved folder is gone, not copied');
    assert.deepEqual(result.moved, ['.diffstory']);
    assert.deepEqual(result.kept, []);
  });
});

test('merging into an existing .codestory keeps its copy of a conflict and leaves the old file', () => {
  withDir('ds-migrate-merge-', (repo) => {
    put(join(repo, '.codestory', 'story.json'), 'new story');
    put(join(repo, '.codestory', 'stories', 'b.json'), 'new b');
    mkdirSync(join(repo, '.codestory', 'empty'));
    put(join(repo, '.diffstory', 'story.json'), 'old story');
    put(join(repo, '.diffstory', 'comments.json'), 'old comments');
    put(join(repo, '.diffstory', 'stories', 'a.json'), 'old a');
    put(join(repo, '.diffstory', 'stories', 'b.json'), 'old b');
    put(join(repo, '.diffstory', 'history', 'h1.json'), 'h1');
    mkdirSync(join(repo, '.diffstory', 'empty'));

    const result = migrateLegacyDataDir(repo);

    // A missing entry is renamed over, whole folders included; folders merge.
    assert.equal(read(join(repo, '.codestory', 'comments.json')), 'old comments');
    assert.equal(read(join(repo, '.codestory', 'stories', 'a.json')), 'old a');
    assert.equal(read(join(repo, '.codestory', 'history', 'h1.json')), 'h1');
    // A conflict keeps the .codestory copy and leaves the old file in place.
    assert.equal(read(join(repo, '.codestory', 'story.json')), 'new story');
    assert.equal(read(join(repo, '.codestory', 'stories', 'b.json')), 'new b');
    assert.equal(read(join(repo, '.diffstory', 'story.json')), 'old story');
    assert.equal(read(join(repo, '.diffstory', 'stories', 'b.json')), 'old b');
    // Emptied folders are removed; a folder still holding a kept file stays.
    assert.deepEqual(readdirSync(join(repo, '.diffstory')).sort(), ['stories', 'story.json']);
    assert.deepEqual(readdirSync(join(repo, '.diffstory', 'stories')), ['b.json']);
    assert.deepEqual(
      [...result.moved].sort(),
      ['.diffstory/comments.json', '.diffstory/history', '.diffstory/stories/a.json'],
    );
    assert.deepEqual([...result.kept].sort(), ['.diffstory/stories/b.json', '.diffstory/story.json']);

    // Running it again moves nothing and still never touches the kept files.
    assert.deepEqual(migrateLegacyDataDir(repo).moved, []);
    assert.equal(read(join(repo, '.diffstory', 'story.json')), 'old story');
    assert.equal(read(join(repo, '.codestory', 'story.json')), 'new story');
  });
});

test('a file and a folder with the same name are a conflict, not a merge', () => {
  withDir('ds-migrate-shape-', (repo) => {
    put(join(repo, '.codestory', 'stories'), 'a file where the folder would go');
    put(join(repo, '.diffstory', 'stories', 'a.json'), 'a');
    const result = migrateLegacyDataDir(repo);
    assert.equal(read(join(repo, '.codestory', 'stories')), 'a file where the folder would go');
    assert.equal(read(join(repo, '.diffstory', 'stories', 'a.json')), 'a');
    assert.deepEqual(result.kept, ['.diffstory/stories']);
  });
});

test('a repo with no legacy folder or legacy ignore rule is left exactly as it was', () => {
  withDir('ds-migrate-none-', (repo) => {
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    assert.deepEqual(migrateLegacyDataDir(repo), { moved: [], kept: [], gitignore: [] });
    assert.equal(existsSync(join(repo, '.codestory')), false, 'no empty .codestory/ is created');
    assert.equal(read(join(repo, '.gitignore')), 'node_modules/\n');
  });
  withDir('ds-migrate-bare-', (repo) => {
    assert.deepEqual(migrateLegacyDataDir(repo), { moved: [], kept: [], gitignore: [] });
    assert.deepEqual(readdirSync(repo), [], 'no .gitignore is created either');
  });
});

test('every .gitignore rule naming .diffstory gains its .codestory twin, once', () => {
  withDir('ds-migrate-ignore-', (repo) => {
    const before =
      'node_modules/\n' +
      '# keep .diffstory/ out of commits\n' +
      '.diffstory/comments.json\n' +
      '/.diffstory/history/\n' +
      '!.diffstory/story.json\n' +
      '.codestory/comments.json\n';
    writeFileSync(join(repo, '.gitignore'), before);
    const first = migrateLegacyDataDir(repo);
    // Comments are not rules, and a twin that already exists is not repeated.
    assert.deepEqual(first.gitignore, ['/.codestory/history/', '!.codestory/story.json']);
    const after = read(join(repo, '.gitignore'));
    assert.equal(after, before + '/.codestory/history/\n!.codestory/story.json\n');
    assert.deepEqual(migrateLegacyDataDir(repo).gitignore, [], 'a second run adds nothing');
    assert.equal(read(join(repo, '.gitignore')), after);
  });
  withDir('ds-migrate-ignore-eol-', (repo) => {
    writeFileSync(join(repo, '.gitignore'), '.diffstory/');
    migrateLegacyDataDir(repo);
    assert.equal(read(join(repo, '.gitignore')), '.diffstory/\n.codestory/\n', 'a missing final newline is added first');
    writeFileSync(join(repo, '.gitignore'), 'dist/\r\n.diffstory/\r\n');
    migrateLegacyDataDir(repo);
    assert.equal(read(join(repo, '.gitignore')), 'dist/\r\n.diffstory/\r\n.codestory/\r\n', 'CRLF files stay CRLF');
  });
});

test('the old app home is copied, never moved, into ~/.codestory', () => {
  withDir('ds-home-migrate-', (home) => {
    put(join(home, '.diffstory', 'recents.json'), 'recents');
    put(join(home, '.diffstory', 'settings.json'), 'settings');
    put(join(home, '.diffstory', 'story-selection.json'), 'selection');
    put(join(home, '.diffstory', 'verification', 'abc.json'), 'receipt');
    // An older install may still run from ~/.diffstory/src; it must stay put.
    put(join(home, '.diffstory', 'src', 'package.json'), 'old install');
    put(join(home, '.diffstory', 'kokoro-venv', 'pyvenv.cfg'), 'venv');

    const copied = migrateLegacyHome(home);

    assert.deepEqual([...copied].sort(), ['recents.json', 'settings.json', 'story-selection.json', 'verification']);
    assert.equal(read(join(home, '.codestory', 'recents.json')), 'recents');
    assert.equal(read(join(home, '.codestory', 'settings.json')), 'settings');
    assert.equal(read(join(home, '.codestory', 'story-selection.json')), 'selection');
    assert.equal(read(join(home, '.codestory', 'verification', 'abc.json')), 'receipt');
    assert.deepEqual(
      readdirSync(join(home, '.codestory')).sort(),
      ['recents.json', 'settings.json', 'story-selection.json', 'verification'],
      'only the four named entries cross over',
    );
    // The old home is untouched, src/ included.
    assert.deepEqual(
      readdirSync(join(home, '.diffstory')).sort(),
      ['kokoro-venv', 'recents.json', 'settings.json', 'src', 'story-selection.json', 'verification'],
    );
    assert.equal(read(join(home, '.diffstory', 'recents.json')), 'recents');
    assert.equal(read(join(home, '.diffstory', 'src', 'package.json')), 'old install');
    assert.equal(read(join(home, '.diffstory', 'verification', 'abc.json')), 'receipt');
  });
});

test('an entry the new home already has is never overwritten', () => {
  withDir('ds-home-keep-', (home) => {
    put(join(home, '.diffstory', 'settings.json'), 'old settings');
    put(join(home, '.codestory', 'settings.json'), 'new settings');
    put(join(home, '.diffstory', 'verification', 'a.json'), 'old a');
    put(join(home, '.codestory', 'verification', 'b.json'), 'new b');
    put(join(home, '.diffstory', 'recents.json'), 'old recents');

    assert.deepEqual(migrateLegacyHome(home), ['recents.json']);
    assert.equal(read(join(home, '.codestory', 'settings.json')), 'new settings');
    assert.deepEqual(readdirSync(join(home, '.codestory', 'verification')), ['b.json']);
    assert.equal(read(join(home, '.codestory', 'recents.json')), 'old recents');
    assert.deepEqual(migrateLegacyHome(home), [], 'a second run copies nothing');
  });
});

test('a home with no old store gets no new one', () => {
  withDir('ds-home-none-', (home) => {
    assert.deepEqual(migrateLegacyHome(home), []);
    assert.equal(existsSync(join(home, '.codestory')), false);
  });
});
