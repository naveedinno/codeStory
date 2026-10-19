import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { finishStoryGeneration, verifyLogicMoves } from '../dist/server.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ds-generate-finish-'));
const longPrimerBody = [
  'A request enters through the existing boundary and is normalized into a stable envelope before policy code reads it.',
  'The envelope keeps identity, scope, and the requested action together while downstream helpers decide whether that action is allowed.',
  'This is not another stored record or a second API request; it is temporary decision context shared by the next code steps.',
  'Keep that ownership model in mind when checking where normalization happens, which helper applies policy, and where the accepted result returns.',
].join(' ');

function writeStory(repo, stepKind, stepOverrides = {}) {
  const path = join(repo, '.codestory', 'story.json');
  mkdirSync(join(path, '..'), { recursive: true });
  const range = stepOverrides.range ?? [1, 1];
  const highlights = stepOverrides.highlights ?? [range];
  writeFileSync(
    path,
    JSON.stringify({
      version: 3,
      mode: 'guided',
      title: 'Generated story',
      summary: 'Generated story summary',
      intent: {
        goal: 'Help the reviewer understand the generated change.',
        design: 'The existing entry path reaches one changed decision and then its downstream effect.',
        sources: ['conversation'],
      },
      base: 'HEAD',
      steps: [
        {
          id: 's1',
          order: 1,
          title: 'Entry point',
          question: 'Does this entry point prove the intended decision before downstream work runs?',
          file: 'a.txt',
          range,
          viewport: range,
          highlights,
          beats: [{ text: 'Start at the changed decision.', highlights }],
          kind: stepKind,
          why: 'Start here.',
          ...stepOverrides,
        },
      ],
    }),
  );
  return path;
}

test('generation finish accepts only a valid written story', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'changed');
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'complete');
  assert.deepEqual(out.result, { storyWritten: true, storyValid: true });
  assert.deepEqual(out.events, []);
  assert.equal(session.selectedStory, storyPath);
  assert.equal(session.chooseStory, false);

  rmSync(repo, { recursive: true, force: true });
});

test('new generation requires storyArc while an older modern repair still runs logic verification', () => {
  const repo = tmp();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  writeFileSync(join(repo, 'old.ts'), 'function decide() {\n  return true;\n}\n');
  execFileSync('git', ['add', 'old.ts'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  rmSync(join(repo, 'old.ts'));
  writeFileSync(join(repo, 'new.ts'), 'function unrelated() {\n  return false;\n}\n');

  const storyPath = writeStory(repo, 'changed', {
    file: 'new.ts',
    range: [1, 3],
    viewport: [1, 3],
    highlights: [[1, 3]],
    beats: [{ text: 'The destination is reviewed here.', highlights: [[1, 3]] }],
    moves: [{
      id: 'claimed-move', kind: 'moved',
      before: { file: 'old.ts', range: [1, 3] },
      after: { file: 'new.ts', range: [1, 3] },
      label: 'moved',
    }],
  });

  const generated = finishStoryGeneration(
    { ok: true, output: '' },
    storyPath,
    { repo, chooseStory: true },
    undefined,
    { validateModern: true, requireStoryArc: true },
  );
  assert.equal(generated.status, 'failed');
  assert.match(generated.events[0].technicalDetail, /storyArc is required/);

  const repaired = finishStoryGeneration(
    { ok: true, output: '' },
    storyPath,
    { repo, chooseStory: true },
    undefined,
    {
      validateModern: true,
      requireStoryArc: false,
      originalStoryArc: undefined,
      originalEvolution: undefined,
    },
  );
  assert.equal(repaired.status, 'failed');
  assert.match(repaired.events[0].technicalDetail, /70% token overlap/);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish accepts an interleaved v3 concept primer before code', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'changed');
  const story = JSON.parse(readFileSync(storyPath, 'utf8'));
  story.steps[0].id = 'implementation';
  story.steps[0].order = 2;
  story.steps.unshift({
    id: 'primer',
    order: 1,
    title: 'The request lifecycle',
    kind: 'concept',
    body: longPrimerBody,
    preparesFor: ['implementation'],
    diagram: {
      type: 'mermaid',
      source: 'flowchart LR\n  Request --> Envelope --> Policy',
      caption: 'The mental model that prepares the next code step.',
    },
  });
  writeFileSync(storyPath, JSON.stringify(story));
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'complete');
  assert.deepEqual(out.result, { storyWritten: true, storyValid: true });
  assert.deepEqual(out.events, []);
  assert.equal(session.selectedStory, storyPath);
  assert.equal(session.chooseStory, false);

  rmSync(repo, { recursive: true, force: true });
});

test('generation verifies moved anchors against old and new repository blobs', () => {
  const repo = tmp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  const logic = ['function updateBalance(amount) {', '  balance -= amount;', '}'];
  writeFileSync(join(repo, 'old.ts'), logic.join('\n'));
  execFileSync('git', ['add', 'old.ts'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  rmSync(join(repo, 'old.ts'));
  writeFileSync(join(repo, 'new.ts'), logic.join('\n'));
  const story = {
    version: 3, mode: 'guided', title: 'Moved balance logic', summary: 'Follow the balance update into its new home.',
    base: 'HEAD', intent: { goal: 'Keep balance updates together.', design: 'The old body moves into the new module.', sources: ['code-derived'] },
    steps: [{
      id: 'move', order: 1, title: 'Move balance update', kind: 'changed', file: 'new.ts',
      range: [1, 3], viewport: [1, 3], highlights: [[1, 3]], why: 'The same update now has one home.',
      beats: [{ text: 'The new module owns the existing balance update.', highlights: [[1, 3]] }],
      moves: [{
        id: 'move-balance', kind: 'moved',
        before: { file: 'old.ts', range: [1, 3] }, after: { file: 'new.ts', range: [1, 3] },
        label: 'moved out',
      }],
    }],
  };
  assert.deepEqual(verifyLogicMoves(repo, story), { errors: [], warnings: [] });
  const storyPath = join(repo, '.codestory', 'story.json');
  mkdirSync(join(storyPath, '..'), { recursive: true });
  writeFileSync(storyPath, JSON.stringify(story));
  const accepted = finishStoryGeneration({ ok: true, output: '' }, storyPath, { repo, chooseStory: true });
  assert.equal(accepted.status, 'complete');
  assert.equal(accepted.result.storyValid, true);

  writeFileSync(join(repo, 'new.ts'), ['function unrelated() {', '  return false;', '}'].join('\n'));
  const falseMove = verifyLogicMoves(repo, story);
  assert.ok(falseMove.errors.some((error) => error.includes('at least 70% token overlap')));

  const outOfRange = structuredClone(story);
  outOfRange.steps[0].moves[0].after.range = [1, 30];
  assert.ok(verifyLogicMoves(repo, outOfRange).errors.some((error) => error.includes('outside the new version of "new.ts"')));

  const missingDestination = structuredClone(story);
  missingDestination.steps[0].moves[0].hidden = { as: 'destination', tag: 'off screen', what: 'inspect the new owner' };
  missingDestination.steps[0].moves[0].after.file = 'missing.ts';
  assert.ok(verifyLogicMoves(repo, missingDestination).errors.some((error) => error.includes('hidden destination file "missing.ts" could not be resolved')));

  writeFileSync(storyPath, JSON.stringify(story));
  const rejected = finishStoryGeneration({ ok: true, output: '' }, storyPath, { repo, chooseStory: true });
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.events[0].technicalDetail, /70% token overlap/);
  rmSync(repo, { recursive: true, force: true });
});

test('generation finish accepts deleted as a canonical changed step', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'deleted');
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'complete');
  assert.deepEqual(out.result, { storyWritten: true, storyValid: true });
  assert.deepEqual(out.events, []);
  assert.equal(session.selectedStory, storyPath);
  assert.equal(session.chooseStory, false);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish accepts pure deleted-file sentinel anchors', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'changed', {
    range: [0, 0],
    viewport: [0, 0],
    highlights: [[0, 0]],
  });
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'complete');
  assert.deepEqual(out.result, { storyWritten: true, storyValid: true });
  assert.deepEqual(out.events, []);
  assert.equal(session.selectedStory, storyPath);
  assert.equal(session.chooseStory, false);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish rejects a written but invalid story', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'bogus');
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'failed');
  assert.equal(out.result.storyWritten, true);
  assert.equal(out.result.storyValid, false);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].type, 'error');
  assert.equal(out.events[0].stage, 'validation');
  assert.match(out.events[0].label, /final check/i);
  assert.match(out.events[0].detail, /cannot safely open/i);
  assert.match(out.events[0].technicalDetail, /kind must be one of changed, context, new-file, concept/);
  assert.equal(session.selectedStory, undefined);
  assert.equal(session.chooseStory, true);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish rejects a legacy-minimal story that skips the guided camera', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'changed', {
    viewport: undefined,
    highlights: undefined,
    beats: undefined,
  });
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration({ ok: true, output: '' }, storyPath, session);

  assert.equal(out.status, 'failed');
  assert.equal(out.result.storyValid, false);
  assert.match(out.events[0].technicalDetail, /viewport is required for a generated story/);
  assert.match(out.events[0].technicalDetail, /highlights are required for a generated story/);
  assert.match(out.events[0].technicalDetail, /beats are required for a generated story/);
  assert.equal(session.selectedStory, undefined);
  assert.equal(session.chooseStory, true);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish does not treat an unchanged prior story as fresh output', () => {
  const repo = tmp();
  const storyPath = writeStory(repo, 'changed');
  const previous = readFileSync(storyPath, 'utf8');
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration(
    { ok: false, output: 'model failed before writing' },
    storyPath,
    session,
    previous,
  );

  assert.equal(out.status, 'failed');
  assert.deepEqual(out.result, { storyWritten: false, storyValid: false });
  assert.equal(out.events[0].stage, 'execution');
  assert.match(out.events[0].detail, /model failed before writing/);
  assert.equal(session.selectedStory, undefined);
  assert.equal(session.chooseStory, true);

  rmSync(repo, { recursive: true, force: true });
});

test('generation finish explains an incompatible Codex model without raw duplicated JSON', () => {
  const repo = tmp();
  const storyPath = join(repo, '.codestory', 'story.json');
  const session = { repo, chooseStory: true };
  const message = "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
  const line = `ERROR: ${JSON.stringify({
    type: 'error',
    status: 400,
    error: { type: 'invalid_request_error', message },
  })}`;

  const out = finishStoryGeneration({
    ok: false,
    failure: 'execution',
    output: `hook: SessionStart\n${line}\n${line}\n`,
  }, storyPath, session, null);

  assert.equal(out.status, 'failed');
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].label, 'Codex needs an update for gpt-5.6-sol');
  assert.match(out.events[0].detail, /choose another model and try again/i);
  assert.equal(out.events[0].technicalDetail, message);
  assert.doesNotMatch(out.events[0].detail, /ERROR:|hook:|\{"type"/);
  assert.doesNotMatch(out.events[0].technicalDetail, /ERROR:|hook:|\{"type"/);

  rmSync(repo, { recursive: true, force: true });
});

test('targeted repair can preserve a schema-valid legacy story without forcing a rewrite', () => {
  const repo = tmp();
  const storyPath = join(repo, '.codestory', 'story.json');
  mkdirSync(join(storyPath, '..'), { recursive: true });
  const previous = JSON.stringify({
    version: 1,
    title: 'Legacy story',
    summary: 'Old but still readable.',
    steps: [{ id: 's1', order: 1, title: 'Old step', file: 'a.txt', range: [1, 1], kind: 'changed', why: 'Before.' }],
  });
  writeFileSync(storyPath, previous);
  writeFileSync(storyPath, previous.replace('Before.', 'Repaired.'));
  const session = { repo, chooseStory: true };

  const out = finishStoryGeneration(
    { ok: true, output: '' },
    storyPath,
    session,
    previous,
    false,
  );

  assert.equal(out.status, 'complete');
  assert.deepEqual(out.result, { storyWritten: true, storyValid: true });
  assert.equal(session.selectedStory, storyPath);
  assert.equal(session.chooseStory, false);

  rmSync(repo, { recursive: true, force: true });
});

test('targeted legacy repair applies primer rules without forcing modern code cameras', () => {
  const repo = tmp();
  const storyPath = join(repo, '.codestory', 'story.json');
  mkdirSync(join(storyPath, '..'), { recursive: true });
  const previous = JSON.stringify({
    version: 1,
    title: 'Legacy story',
    summary: 'Old but still readable.',
    steps: [{ id: 'code', order: 1, title: 'Old step', file: 'a.txt', range: [1, 1], kind: 'changed', why: 'Before.' }],
  });
  const upgraded = {
    version: 2,
    mode: 'guided',
    title: 'Legacy story with one primer',
    summary: 'Learn the model, then read the preserved code step.',
    steps: [
      {
        id: 'primer',
        order: 1,
        title: 'The request envelope',
        kind: 'concept',
        body: 'Too short.',
        preparesFor: ['code'],
      },
      { id: 'code', order: 2, title: 'Old step', file: 'a.txt', range: [1, 1], kind: 'changed', why: 'Repaired.' },
    ],
  };
  writeFileSync(storyPath, previous);
  writeFileSync(storyPath, JSON.stringify(upgraded));

  const rejected = finishStoryGeneration(
    { ok: true, output: '' },
    storyPath,
    { repo, chooseStory: true },
    previous,
    false,
  );
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.events[0].technicalDetail, /at least 60 words/);

  upgraded.steps[0].body = longPrimerBody;
  writeFileSync(storyPath, JSON.stringify(upgraded));
  const session = { repo, chooseStory: true };
  const accepted = finishStoryGeneration(
    { ok: true, output: '' },
    storyPath,
    session,
    previous,
    false,
  );
  assert.equal(accepted.status, 'complete');
  assert.equal(accepted.result.storyValid, true);
  assert.equal(session.selectedStory, storyPath);

  rmSync(repo, { recursive: true, force: true });
});
