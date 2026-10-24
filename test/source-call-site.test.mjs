import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { callerInvocationLines, discoverStoryCallSite, sourceCodeMask } from '../dist/source-call-site.js';
import { callerEvidence } from '../dist/landing-verify.js';
import { buildReviewModel } from '../dist/view-model.js';
import { renderStoryStepPanel } from '../dist/render.js';
import { codeStory, committedRepo } from './helpers/code-story-fixture.mjs';

test('invocation lookup stays inside its caller and ignores data, comments, and declarations', () => {
  const source = [
    'function batch(call) { execute(call); }',
    'function execute(call) {',
    '  // checkRoute(call);',
    '  const message = "checkRoute(call) and a }";',
    '  /* checkRoute(call); { */',
    '  const template = `checkRoute(call)`;',
    '  const regex = /checkRoute()/;',
    '  function checkRoute() {}',
    '  if (call) { checkRoute(',
    '    call); }',
    '}',
    'function unrelated(call) { checkRoute(call); }',
  ];
  assert.deepEqual(callerInvocationLines(source, 'checkRoute()', 'execute()'), [9]);
  assert.deepEqual(callerInvocationLines(source, 'checkRoute()', 'execute()', [1, 8]), []);
  assert.deepEqual(callerInvocationLines(source, 'execute()', 'batch()'), [1]);
  assert.deepEqual(callerInvocationLines(source, 'checkRoute()', 'missing()'), []);
  const mask = sourceCodeMask(source.join('\n'));
  assert.equal(mask.length, source.join('\n').length);
  assert.equal(mask.split('\n').length, source.length);
});

test('arrow-returned regexes and generator declarations do not create helper calls', () => {
  assert.deepEqual(callerInvocationLines([
    'function caller() {',
    '  const pattern = () => /helper()/;',
    '  function* helper() { yield 1; }',
    '}',
  ], 'helper()', 'caller()'), []);
});

test('nested literal data and nested function bodies do not create caller-owned invocations', () => {
  for (const statement of [
    'const text = `prefix ${`checkRoute()`} suffix`;',
    'if (flag) /checkRoute()/.test(value);',
    'function other() { checkRoute(); }',
    'const other = function () { checkRoute(); };',
    'const other = () => { checkRoute(); };',
    'const handlers = { checkRoute() { return true; } };',
    'const handlers = { run() { checkRoute(); } };',
    'const handlers = { run(): boolean { checkRoute(); return true; } };',
    'const handlers = { "run"() { checkRoute(); } };',
    'const handlers = { [name]() { checkRoute(); } };',
    'const handlers = { [Symbol.iterator]() { checkRoute(); } };',
    'const handlers = { if() { checkRoute(); } };',
    'function nested(): boolean { checkRoute(); return true; }',
    'const handlers = { "run"():{} { checkRoute(); return {}; } };',
    'const handlers = { [name]():{} { checkRoute(); return {}; } };',
    'function nested():{} { checkRoute(); return {}; }',
    'const Hidden = class { static { checkRoute(); } };',
  ]) {
    assert.deepEqual(callerInvocationLines(['function execute() {', statement, '}'], 'checkRoute()', 'execute()'), [], statement);
  }
  assert.deepEqual(callerInvocationLines([
    'function execute() {',
    'function other() { checkRoute(); }',
    'checkRoute();',
    '}',
  ], 'checkRoute()', 'execute()'), [3]);
});

test('qualified source names do not lose their owner', () => {
  const lines = ['function execute() { Other.checkRoute(); }'];
  assert.deepEqual(callerInvocationLines(lines, 'Expected.checkRoute()', 'execute()'), []);
  assert.deepEqual(callerInvocationLines(lines, 'checkRoute()', 'execute()'), [], 'a receiver must not be discarded');
  assert.deepEqual(callerInvocationLines(['function execute() { Other . checkRoute(); }'], 'checkRoute()', 'execute()'), []);
  assert.deepEqual(callerInvocationLines(lines, 'Other.checkRoute()', 'execute()'), [1]);
  assert.deepEqual(callerInvocationLines(lines, 'checkRoute()', 'Expected.execute()'), []);
});

function fixture() {
  const repo = committedRepo();
  const lines = Array.from({ length: 30 }, () => '  // source context');
  lines[0] = 'function batch(call) { execute(call); }';
  lines[3] = 'function execute(call) {';
  lines[9] = '  const ready = checkRoute(call);';
  lines[14] = '}';
  lines[19] = 'function checkRoute(call) {';
  lines[23] = '  return call.route !== 0;';
  lines[27] = '}';
  writeFileSync(join(repo.dir, 'app.ts'), lines.join('\n') + '\n');
  const git = (...args) => execFileSync('git', args, { cwd: repo.dir, encoding: 'utf8' }).trim();
  git('add', 'app.ts'); git('commit', '-qm', 'Add source invocation fixture');
  const sha = git('rev-parse', 'HEAD');
  const template = codeStory(sha).steps[0];
  const story = codeStory(sha, { hotspots: undefined, steps: [
    { ...template, id: 'entry', order: 1, range: [8, 12], viewport: [4, 16], highlights: [[10, 10]],
      landing: { symbol: 'execute()', role: { who: 'relayer' } }, title: 'Execute the call',
      beats: [{ text: 'Execute asks the route guard before forwarding.', highlights: [[10, 10]] }] },
    { ...template, id: 'guard', order: 2, range: [22, 26], viewport: [18, 30], highlights: [[24, 24]],
      landing: { symbol: 'checkRoute()', calledBy: ['execute()'] }, title: 'Check the route',
      beats: [{ text: 'The route guard rejects disabled routes.', highlights: [[24, 24]] }] },
  ] });
  return { ...repo, sha, lines, story };
}

test('an existing story with no callSite gets real paired source at its pinned revision', () => {
  const repo = fixture();
  try {
    const original = JSON.stringify(repo.story);
    writeFileSync(join(repo.dir, 'app.ts'), '// A different working tree has no invocation.\n');
    const model = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    const helper = model.steps[1];
    assert.equal(helper.sceneLayout, 'caller-helper');
    assert.equal(helper.callSite.stepId, 'entry');
    assert.deepEqual(helper.callSite.range, [10, 10]);
    assert.equal(helper.landing.callers[0].evidence.line, 10, 'points at the helper invocation, not execute() in batch()');
    assert.equal(helper.landing.callers[0].evidence.level, 'invocation');
    assert.deepEqual(model.steps[0].landing.callees.map(c => c.panelIndex), [2], 'the overview can jump into this helper');
    const html = renderStoryStepPanel(repo.dir, model, [], 1);
    assert.match(html, /data-code-pair/);
    assert.match(html, /data-callsite-anchor class="ds-row is-callsite-focus/);
    assert.doesNotMatch(html, /<details class="ds-caller-evidence"/);
    assert.match(html, /popover="auto" role="dialog"/);
    assert.equal(JSON.stringify(repo.story), original, 'the real story is not rewritten');
    const evidence = callerEvidence(repo.dir, 'checkRoute()', 'execute()', repo.sha);
    assert.equal(evidence.line, 10);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('automatic pairing requires a visible invocation, and explicit crops take precedence', () => {
  const repo = fixture();
  try {
    const helper = repo.story.steps[1], caller = repo.story.steps[0];
    caller.viewport = [4, 8];
    assert.equal(discoverStoryCallSite(repo.dir, helper, repo.story.steps, repo.sha), undefined);
    const noCall = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.equal(noCall.steps[1].callSite, undefined);
    caller.viewport = [4, 16];
    helper.callSite = { step: 'entry', range: [10, 10], viewport: [8, 12] };
    const explicit = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.deepEqual(explicit.steps[1].callSite.viewport, [8, 12]);
    const later = structuredClone(repo.story.steps).reverse().map((step, i) => ({ ...step, order: i + 1 }));
    delete later[0].callSite;
    assert.equal(discoverStoryCallSite(repo.dir, later[0], later, repo.sha), undefined);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('distant calls do not become a misleading automatic bounding box', () => {
  const repo = fixture();
  try {
    const lines = [...repo.lines]; lines[13] = '  checkRoute(call);';
    const spans = callerInvocationLines(lines, 'checkRoute()', 'execute()');
    assert.deepEqual(spans, [10, 14], 'local repeated invocations remain inspectable');
    lines[14] = '  // keep the caller open'; lines[19] = '  // context';
    lines[23] = '  // context'; lines[25] = '  checkRoute(call);'; lines[27] = '}';
    writeFileSync(join(repo.dir, 'app.ts'), lines.join('\n'));
    repo.story.steps[0].viewport = [1, 30];
    assert.equal(discoverStoryCallSite(repo.dir, repo.story.steps[1], repo.story.steps), undefined);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('qualified story relationships stay distinct in both directions', () => {
  const repo = fixture();
  try {
    repo.story.steps[0].landing.symbol = 'Other.execute()';
    repo.story.steps[1].landing.calledBy = ['Expected.execute()'];
    const model = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.equal(model.steps[1].callSite, undefined);
    assert.equal(model.steps[1].landing.callers[0].panelIndex, undefined);
    assert.deepEqual(model.steps[0].landing.callees, []);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('explicit helper destinations with the same label remain reachable', () => {
  const repo = fixture();
  try {
    const helper = repo.story.steps[1];
    helper.landing.symbol = 'parse()';
    const second = { ...structuredClone(helper), id: 'yaml-parser', order: 3 };
    repo.story.steps.push(second);
    repo.story.steps[0].calls = [helper.id, second.id];
    const model = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.deepEqual(model.steps[0].landing.callees.map(node => node.panelIndex), [2, 3]);
    delete repo.story.steps[0].calls;
    second.file = 'yaml.ts';
    const inferred = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.deepEqual(inferred.steps[0].landing.callees.map(node => node.panelIndex), [2, 3], 'different source files also retain distinct inferred destinations');
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('an unqualified caller does not choose between conflicting owners', () => {
  const repo = fixture();
  try {
    const parent = repo.story.steps[0];
    parent.landing.symbol = 'First.execute()';
    repo.story.steps.splice(1, 0, { ...structuredClone(parent), id: 'other', order: 2, landing: { symbol: 'Other.execute()' } });
    repo.story.steps[2].order = 3;
    const model = buildReviewModel(repo.dir, repo.story, [], repo.sha);
    assert.equal(model.steps[2].landing.callers[0].panelIndex, undefined);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});
