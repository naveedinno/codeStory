// install-skills.sh must leave no stale storyteller copy behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/install-skills.sh', import.meta.url));
const SKILL = fileURLToPath(new URL('../skills/codestory-storyteller/SKILL.md', import.meta.url));
const install = (home, ...args) => spawnSync('sh', [SCRIPT, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });

test('default install refreshes an existing stale Codex copy and creates no new agent dirs', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-install-'));
  const codex = join(home, '.codex', 'skills', 'codestory-storyteller');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'SKILL.md'), 'stale');
  const r = install(home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(codex, 'SKILL.md'), 'utf8'), readFileSync(SKILL, 'utf8'));
  assert.ok(existsSync(join(home, '.agents', 'skills', 'codestory-storyteller', 'SKILL.md')));
  assert.equal(existsSync(join(home, '.claude')), false);
  rmSync(home, { recursive: true, force: true });
});

test('an install replaces a diffstory-storyteller copy from before the rename', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-install-'));
  const claudeRetired = join(home, '.claude', 'skills', 'diffstory-storyteller');
  const agentsRetired = join(home, '.agents', 'skills', 'diffstory-storyteller');
  for (const dir of [claudeRetired, agentsRetired]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'retired');
  }
  const r = install(home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(claudeRetired), false, 'no retired copy is left beside the new one');
  assert.equal(existsSync(agentsRetired), false);
  // Claude Code had the old copy, so it gets the renamed skill without --claude.
  assert.equal(
    readFileSync(join(home, '.claude', 'skills', 'codestory-storyteller', 'SKILL.md'), 'utf8'),
    readFileSync(SKILL, 'utf8'),
  );
  assert.ok(existsSync(join(home, '.agents', 'skills', 'codestory-storyteller', 'SKILL.md')));
  assert.equal(existsSync(join(home, '.codex')), false, 'an agent with no copy still gets none');
  rmSync(home, { recursive: true, force: true });
});

test('--codex installs into ~/.codex/skills even when absent', () => {
  const home = mkdtempSync(join(tmpdir(), 'ds-install-'));
  assert.equal(install(home, '--codex').status, 0);
  assert.ok(existsSync(join(home, '.codex', 'skills', 'codestory-storyteller', 'SKILL.md')));
  rmSync(home, { recursive: true, force: true });
});

test('--help documents --codex', () => {
  assert.match(install(tmpdir(), '--help').stdout, /--codex/);
});
