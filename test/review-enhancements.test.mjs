import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { challengeTargets } from '../dist/challenge.js';
import { callerEvidence } from '../dist/landing-verify.js';
import { planStoryRefresh, validateStoryRefresh } from '../dist/story-refresh.js';
import { captureVerification, loadVerificationReceipts, canRunVerification } from '../dist/verification.js';
import { runStoryCheck } from '../dist/story-check.js';
import { reviewChangeFingerprint } from '../dist/git.js';

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'ds-enhance-'));
  const home = mkdtempSync(join(tmpdir(), 'ds-enhance-home-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'a.js'), 'export function helper() { return 1; }\n'); git('add', '.'); git('commit', '-qm', 'base');
  return { repo, home, git, close() { rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
}
const step = (id, order, extra = {}) => ({ id, order, kind: 'changed', file: `${id}.ts`, range: [1, 2], title: 'Simple change', ...extra });

test('challenge prioritizes later hotspots and trust boundaries, skips concepts, and explains its choice', () => {
  const story = { version: 4, steps: [step('a', 1), step('b', 2), step('c', 3), step('d', 4), step('e', 5), step('sensitive', 6), step('late', 7), { id: 'primer', order: 8, kind: 'concept' }], hotspots: [{ step: 'late', reason: 'Unexercised case.' }] };
  const result = challengeTargets(story, (file) => file === 'sensitive.ts' ? ['require(msg.sender == owner);', 'balance -= amount;'] : []);
  assert.equal(result[0].stepId, 'late'); assert.equal(result[1].stepId, 'sensitive');
  assert.ok(result[1].reasons.includes('Permission or trust boundary'));
  assert.ok(result[1].reasons.includes('State or value movement'));
  assert.ok(!result.some((target) => target.stepId === 'primer'));
  assert.deepEqual(challengeTargets({ steps: [step('z', 1), step('y', 2)] }).map((row) => row.stepId), ['z', 'y']);
});

test('refresh follows dependencies while preserving independent steps, all IDs, and metadata', () => {
  const story = { version: 4, title: 'Review', steps: [step('a', 1, { calls: ['b'] }), step('b', 2), step('independent', 3), { id: 'p', order: 4, kind: 'concept', preparesFor: ['b'], body: 'Context' }] };
  const plan = planStoryRefresh(story, [{ path: 'a.ts', inStory: true }]);
  assert.deepEqual(plan.stepIds, ['a', 'b', 'p']);
  const updated = structuredClone(story); updated.steps[0].title = 'Updated explanation';
  assert.deepEqual(validateStoryRefresh(story, updated, plan), []);
  updated.steps[2].title = 'Unrelated rewrite';
  assert.match(validateStoryRefresh(story, updated, plan).join('\n'), /Unaffected step/);
  updated.steps = updated.steps.filter((row) => row.id !== 'b'); updated.title = 'Different intent';
  assert.match(validateStoryRefresh(story, updated, plan).join('\n'), /retain its id/);
  assert.match(validateStoryRefresh(story, updated, plan).join('\n'), /intent, scope/);
  const added = structuredClone(story); added.steps.push(step('outside', 5));
  assert.match(validateStoryRefresh(story, added, plan).join('\n'), /outside the affected scope/);
});

test('caller evidence names its textual limits even when no call exists', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'caller.js'), '// caller and helper are unrelated names in this comment\n');
    const evidence = callerEvidence(f.repo, 'helper()', 'caller()');
    assert.equal(evidence.level, 'text-match'); assert.equal(evidence.file, 'caller.js'); assert.equal(evidence.line, 1);
    assert.equal(callerEvidence(f.repo, 'helper()', 'invented()'), null);
  } finally { f.close(); }
});

test('local receipts capture exit/output/revision separately from authored results and bound runaway output', async () => {
  const f = fixture();
  try {
    const input = { repo: f.repo, home: f.home, base: 'main' };
    const run = (options) => captureVerification({ ...input, fingerprint: reviewChangeFingerprint(f.repo, 'main'), ...options });
    await assert.rejects(run({ check: 'touch should-not-run', fingerprint: '0'.repeat(64) }), /review changed before/);
    const passed = await run({ check: 'printf verified' });
    assert.equal(passed.result, 'passed'); assert.equal(passed.output, 'verified'); assert.equal(passed.sourceStable, true);
    assert.equal(passed.revision, f.git('rev-parse', 'HEAD'));
    const failed = await run({ check: 'printf problem >&2; exit 3' });
    assert.equal(failed.result, 'failed'); assert.equal(failed.exitCode, 3); assert.equal(failed.output, 'problem');
    const changed = await run({ check: 'printf changed > a.js' });
    assert.equal(changed.sourceStable, false);
    const timeout = await run({ check: 'sleep 5', timeoutMs: 50 });
    assert.equal(timeout.result, 'failed'); assert.equal(timeout.timedOut, true);
    const big = await run({ check: 'yes x | head -c 100000' });
    assert.equal(big.output.length, 65536); assert.equal(big.truncated, true);
    assert.equal(loadVerificationReceipts(f.home, f.repo).length, 5);
    assert.equal(canRunVerification(f.repo, 'main'), false);
    await assert.rejects(run({ head: 'main', check: 'printf wrong-checkout' }), /checkout differs/);
  } finally { f.close(); }
});

test('the bundled demo passes current story contracts, lints, and complete coverage', () => {
  const f = fixture();
  try {
    execFileSync(process.execPath, ['examples/demo.mjs'], { env: { ...process.env, CODESTORY_DEMO_NO_SERVE: '1', CODESTORY_DEMO_DIR: f.repo }, stdio: 'pipe' });
    const report = runStoryCheck(f.repo, join(f.repo, '.codestory/story.json'));
    assert.deepEqual(report.errors, []); assert.deepEqual(report.findings, []);
    assert.equal(report.coverage.claimed, report.coverage.total);
    assert.ok(JSON.parse(readFileSync(join(f.repo, '.codestory/story.json'), 'utf8')).storySnapshot);
  } finally { f.close(); }
});
