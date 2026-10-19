// Unit tests for repo setup (gitignore modes + skills check). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setGitignore, skillDirDigest, skillsInstalled, skillStatus, updateSkills } from '../dist/repo-setup.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ds-rs-'));

test('local mode ignores the whole .codestory dir', () => {
  const d = tmp();
  setGitignore(d, 'local');
  const gi = readFileSync(join(d, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.codestory/'));
  assert.ok(!gi.includes('.codestory/comments.json'));
  rmSync(d, { recursive: true, force: true });
});

test('shared mode ignores only comments.json', () => {
  const d = tmp();
  setGitignore(d, 'shared');
  const gi = readFileSync(join(d, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.codestory/comments.json'));
  assert.ok(!/^\.codestory\/$/m.test(gi));
  rmSync(d, { recursive: true, force: true });
});

test('switching modes leaves exactly one codestory line', () => {
  const d = tmp();
  writeFileSync(join(d, '.gitignore'), 'node_modules/\n');
  setGitignore(d, 'local');
  setGitignore(d, 'shared');
  setGitignore(d, 'shared');
  const gi = readFileSync(join(d, '.gitignore'), 'utf8');
  assert.equal((gi.match(/\.codestory/g) || []).length, 1);
  assert.ok(gi.includes('node_modules/'));
  rmSync(d, { recursive: true, force: true });
});

test('skillsInstalled detects ~/.agents/skills/codestory-storyteller', () => {
  const home = tmp();
  assert.equal(skillsInstalled(home), false);
  mkdirSync(join(home, '.agents', 'skills', 'review-tour'), { recursive: true });
  writeFileSync(join(home, '.agents', 'skills', 'review-tour', 'SKILL.md'), 'retired skill');
  assert.equal(skillsInstalled(home), false, 'the retired skill name must not satisfy the new install check');
  const legacy = skillStatus(home);
  assert.equal(legacy.legacyInstalled, true);
  assert.match(legacy.message, /renamed to codestory-storyteller/);
  mkdirSync(join(home, '.agents', 'skills', 'codestory-storyteller'), { recursive: true });
  writeFileSync(join(home, '.agents', 'skills', 'codestory-storyteller', 'SKILL.md'), '');
  assert.equal(skillsInstalled(home), true);
  rmSync(home, { recursive: true, force: true });
});

test('skillStatus reports a missing codestory-storyteller skill', () => {
  const home = tmp();
  const bundled = join(home, 'bundle', 'codestory-storyteller', 'SKILL.md');
  mkdirSync(join(home, 'bundle', 'codestory-storyteller'), { recursive: true });
  writeFileSync(bundled, 'current skill');

  const status = skillStatus(home, bundled);
  assert.equal(status.installed, false);
  assert.equal(status.current, false);
  assert.equal(status.candidates.length, 3);
  assert.ok(status.message.includes('not installed'));

  rmSync(home, { recursive: true, force: true });
});

test('skillStatus detects Codex installs and stale skill content', () => {
  const home = tmp();
  const bundled = join(home, 'bundle', 'codestory-storyteller', 'SKILL.md');
  const installed = join(home, '.codex', 'skills', 'codestory-storyteller', 'SKILL.md');
  mkdirSync(join(home, 'bundle', 'codestory-storyteller'), { recursive: true });
  mkdirSync(join(home, '.codex', 'skills', 'codestory-storyteller'), { recursive: true });
  writeFileSync(bundled, 'current skill');
  writeFileSync(installed, 'old skill');

  const stale = skillStatus(home, bundled);
  assert.equal(stale.installed, true);
  assert.equal(stale.current, false);
  assert.equal(stale.matches.length, 1);
  assert.equal(stale.matches[0].path, installed);
  assert.equal(stale.matches[0].current, false);
  assert.ok(stale.message.includes('out of date'));

  writeFileSync(installed, 'current skill');
  const current = skillStatus(home, bundled);
  assert.equal(current.installed, true);
  assert.equal(current.current, true);
  assert.equal(current.message, 'codestory-storyteller skill is installed and up to date.');

  const retired = join(home, '.agents', 'skills', 'review-tour');
  mkdirSync(retired, { recursive: true });
  writeFileSync(join(retired, 'SKILL.md'), 'retired skill');
  const needsMigration = skillStatus(home, bundled);
  assert.equal(needsMigration.current, false);
  assert.equal(needsMigration.agents.codex.current, false);
  assert.match(needsMigration.message, /finish the migration/);

  rmSync(home, { recursive: true, force: true });
});

test('skillStatus reports per-agent freshness, not just the aggregate', () => {
  const home = tmp();
  const bundled = join(home, 'bundle', 'codestory-storyteller', 'SKILL.md');
  mkdirSync(join(home, 'bundle', 'codestory-storyteller'), { recursive: true });
  writeFileSync(bundled, 'current skill');
  mkdirSync(join(home, '.codex', 'skills', 'codestory-storyteller'), { recursive: true });
  writeFileSync(join(home, '.codex', 'skills', 'codestory-storyteller', 'SKILL.md'), 'current skill');

  // Codex is current so the aggregate says current — but Claude has no install.
  const status = skillStatus(home, bundled);
  assert.equal(status.current, true);
  assert.equal(status.agents.codex.installed, true);
  assert.equal(status.agents.codex.current, true);
  assert.equal(status.agents.claude.installed, false);
  assert.equal(status.agents.claude.current, false);
  assert.equal(status.agents.claude.dir, '~/.claude/skills');
  assert.equal(status.agents.codex.dir, '~/.codex/skills');

  // A stale ~/.claude copy counts as installed but not current.
  mkdirSync(join(home, '.claude', 'skills', 'codestory-storyteller'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'codestory-storyteller', 'SKILL.md'), 'old skill');
  const stale = skillStatus(home, bundled);
  assert.equal(stale.current, true);
  assert.equal(stale.agents.claude.installed, true);
  assert.equal(stale.agents.claude.current, false);

  rmSync(home, { recursive: true, force: true });
});

test('updateSkills installs bundled skills into agent, Claude, and Codex skill dirs', () => {
  const home = tmp();
  const bundle = join(home, 'bundle', 'skills');
  mkdirSync(join(bundle, 'codestory-storyteller'), { recursive: true });
  writeFileSync(join(bundle, 'codestory-storyteller', 'SKILL.md'), 'codestory-storyteller current');
  for (const root of ['.agents', '.claude', '.codex']) {
    const retired = join(home, root, 'skills', 'review-tour');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'SKILL.md'), 'retired skill');
    const retiredReview = join(home, root, 'skills', 'address-review');
    mkdirSync(retiredReview, { recursive: true });
    writeFileSync(join(retiredReview, 'SKILL.md'), 'retired review skill');
  }

  const result = updateSkills(home, bundle);

  assert.deepEqual(result.installed.map((p) => p.replace(home, '<home>')).sort(), [
    '<home>/.agents/skills/codestory-storyteller',
    '<home>/.claude/skills/codestory-storyteller',
    '<home>/.codex/skills/codestory-storyteller',
  ]);
  assert.equal(readFileSync(join(home, '.agents', 'skills', 'codestory-storyteller', 'SKILL.md'), 'utf8'), 'codestory-storyteller current');
  assert.equal(readFileSync(join(home, '.claude', 'skills', 'codestory-storyteller', 'SKILL.md'), 'utf8'), 'codestory-storyteller current');
  for (const root of ['.agents', '.claude', '.codex']) {
    assert.equal(existsSync(join(home, root, 'skills', 'review-tour')), false);
    assert.equal(existsSync(join(home, root, 'skills', 'address-review')), false);
  }
  const status = skillStatus(home, join(bundle, 'codestory-storyteller', 'SKILL.md'));
  assert.equal(status.current, true);
  assert.equal(status.agents.claude.current, true);
  assert.equal(status.agents.codex.current, true);

  rmSync(home, { recursive: true, force: true });
});

test('a diffstory-storyteller copy from before the rename is a retired skill, named in the message', () => {
  const home = tmp();
  const retired = join(home, '.claude', 'skills', 'diffstory-storyteller');
  mkdirSync(retired, { recursive: true });
  writeFileSync(join(retired, 'SKILL.md'), 'the storyteller before the rename');

  const status = skillStatus(home);
  assert.equal(status.installed, false, 'the retired name does not satisfy the install check');
  assert.equal(status.current, false);
  assert.equal(status.legacyInstalled, true);
  assert.deepEqual(status.legacyNames, ['diffstory-storyteller']);
  assert.equal(
    status.message,
    'diffstory-storyteller was renamed to codestory-storyteller. Update skills to finish the migration.',
  );

  rmSync(home, { recursive: true, force: true });
});

test('every retired storyteller name on disk is named once, oldest first', () => {
  const home = tmp();
  for (const [root, name] of [
    ['.codex', 'diffstory-storyteller'],
    ['.agents', 'review-tour'],
    ['.claude', 'diffstory-storyteller'],
  ]) {
    mkdirSync(join(home, root, 'skills', name), { recursive: true });
    writeFileSync(join(home, root, 'skills', name, 'SKILL.md'), 'retired');
  }
  const status = skillStatus(home);
  assert.deepEqual(status.legacyNames, ['review-tour', 'diffstory-storyteller']);
  assert.match(status.message, /^review-tour and diffstory-storyteller were renamed to codestory-storyteller\. /);

  rmSync(home, { recursive: true, force: true });
});

test('updateSkills replaces a retired diffstory-storyteller copy in every agent root', () => {
  const home = tmp();
  const bundle = join(home, 'bundle', 'skills');
  mkdirSync(join(bundle, 'codestory-storyteller'), { recursive: true });
  writeFileSync(join(bundle, 'codestory-storyteller', 'SKILL.md'), 'codestory-storyteller current');
  for (const root of ['.agents', '.claude', '.codex']) {
    mkdirSync(join(home, root, 'skills', 'diffstory-storyteller'), { recursive: true });
    writeFileSync(join(home, root, 'skills', 'diffstory-storyteller', 'SKILL.md'), 'retired');
  }

  const result = updateSkills(home, bundle);

  for (const root of ['.agents', '.claude', '.codex']) {
    assert.equal(existsSync(join(home, root, 'skills', 'diffstory-storyteller')), false, `${root} keeps no retired copy`);
    assert.equal(
      readFileSync(join(home, root, 'skills', 'codestory-storyteller', 'SKILL.md'), 'utf8'),
      'codestory-storyteller current',
    );
  }
  assert.equal(result.status.legacyInstalled, false);
  assert.deepEqual(result.status.legacyNames, []);
  assert.equal(result.status.current, true);

  rmSync(home, { recursive: true, force: true });
});

test('skillStatus compares the whole skill folder, not just SKILL.md', () => {
  const home = tmp();
  const bundleDir = join(home, 'bundle', 'codestory-storyteller');
  const installedDir = join(home, '.claude', 'skills', 'codestory-storyteller');
  for (const dir of [bundleDir, installedDir]) {
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'same core');
  }
  writeFileSync(join(bundleDir, 'references', 'schema.md'), 'new schema');
  writeFileSync(join(installedDir, 'references', 'schema.md'), 'old schema');
  assert.equal(skillStatus(home, join(bundleDir, 'SKILL.md')).agents.claude.current, false);
  writeFileSync(join(installedDir, 'references', 'schema.md'), 'new schema');
  assert.equal(skillStatus(home, join(bundleDir, 'SKILL.md')).agents.claude.current, true);
  rmSync(home, { recursive: true, force: true });
});

test('skillDirDigest ignores .DS_Store and line-ending noise', () => {
  const home = tmp();
  const a = join(home, 'a');
  const b = join(home, 'b');
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, 'SKILL.md'), 'line one\nline two\n');
  writeFileSync(join(b, 'SKILL.md'), 'line one\r\nline two');
  writeFileSync(join(b, '.DS_Store'), 'junk');
  assert.equal(skillDirDigest(a), skillDirDigest(b));
  rmSync(home, { recursive: true, force: true });
});
