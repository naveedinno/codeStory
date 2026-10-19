// Unit tests for the app-owned progress protocol. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE_LABELS, phaseRank, observedPhase,
  runStarted, contextEvent, phaseEvent, fileEvent, commandEvent,
  activityEvent, toolEvent, textEvent, heartbeatEvent, warningEvent,
  errorEvent, doneEvent, planEvent,
  parseAgentNoteLine, noteEventsFromText, createFileEnricher,
} from '../dist/progress.js';

test('runStarted and contextEvent carry workflow + context fields', () => {
  assert.deepEqual(runStarted('guided_review', 'Generating guided review'), {
    type: 'run_started', workflow: 'guided_review', label: 'Generating guided review',
  });
  const ctx = contextEvent({
    repoName: 'SmartDiffChecker', repoPath: '/r', workflow: 'detailed_audit',
    agent: 'claude', model: 'opus', base: 'main', head: 'working tree',
    targetCount: undefined, taskMode: 'resume', taskLabel: 'Clarify quote handling', taskId: 'task-id',
  });
  assert.equal(ctx.type, 'context');
  assert.equal(ctx.repoName, 'SmartDiffChecker');
  assert.equal(ctx.agent, 'claude');
  assert.equal(ctx.model, 'opus');
  assert.equal(ctx.base, 'main');
  assert.equal(ctx.taskMode, 'resume');
  assert.equal(ctx.taskLabel, 'Clarify quote handling');
  assert.equal(ctx.taskId, 'task-id');
});

test('phaseEvent fills the default label and keeps detail optional', () => {
  assert.deepEqual(phaseEvent('reading_changes'), {
    type: 'phase', phase: 'reading_changes', label: PHASE_LABELS.reading_changes,
  });
  const e = phaseEvent('writing_output', 'Writing the story', 'story.json');
  assert.deepEqual(e, {
    type: 'phase', phase: 'writing_output', label: 'Writing the story', detail: 'story.json',
  });
});

test('PHASE_LABELS covers every phase', () => {
  for (const p of [
    'idle', 'preflight', 'resolving_context', 'preparing_prompt', 'starting_agent',
    'agent_running', 'reading_changes', 'recovering_why', 'designing_path', 'writing_output', 'validating_output',
    'applying_results', 'complete', 'failed', 'stopped',
  ]) {
    assert.equal(typeof PHASE_LABELS[p], 'string');
    assert.ok(PHASE_LABELS[p].length > 0);
  }
});

test('phaseRank is monotonic along the spine and sinks terminal failures', () => {
  assert.ok(phaseRank('preflight') < phaseRank('agent_running'));
  assert.ok(phaseRank('agent_running') < phaseRank('writing_output'));
  assert.ok(phaseRank('writing_output') < phaseRank('complete'));
  assert.ok(phaseRank('failed') >= phaseRank('complete'));
  assert.ok(phaseRank('stopped') >= phaseRank('complete'));
});

test('file/command/activity/tool/text helpers build readable labels', () => {
  assert.deepEqual(fileEvent('read', 'Read', 'src/x.ts'), {
    type: 'file', action: 'read', rawTool: 'Read', target: 'src/x.ts', label: 'Reading src/x.ts',
  });
  assert.equal(fileEvent('write', 'Write', 'a/story.json').label, 'Writing a/story.json');
  const cmd = commandEvent('git   diff --stat');
  assert.equal(cmd.type, 'command');
  assert.equal(cmd.command, 'git diff --stat');
  assert.equal(cmd.label, '$ git diff --stat');
  assert.deepEqual(activityEvent('search', 'Grep foo'), { type: 'activity', kind: 'search', label: 'Grep foo' });
  assert.deepEqual(toolEvent('DoThing x', 'DoThing', 'x'), { type: 'tool', label: 'DoThing x', rawTool: 'DoThing', target: 'x' });
  assert.deepEqual(textEvent('hi'), { type: 'text', data: 'hi' });
});

test('heartbeat/warning/error/done helpers carry their fields', () => {
  assert.deepEqual(heartbeatEvent(7000), { type: 'heartbeat', quietMs: 7000 });
  assert.deepEqual(warningEvent('No files changed', 'answered only'), {
    type: 'warning', label: 'No files changed', detail: 'answered only',
  });
  assert.deepEqual(errorEvent('preflight', 'No repository is open', 'Pick one first.'), {
    type: 'error', stage: 'preflight', label: 'No repository is open', detail: 'Pick one first.',
  });
  assert.deepEqual(errorEvent('execution', 'Codex failed', 'Choose another model.', 'raw diagnostic'), {
    type: 'error', stage: 'execution', label: 'Codex failed', detail: 'Choose another model.',
    technicalDetail: 'raw diagnostic',
  });
  assert.deepEqual(doneEvent('complete', { storyWritten: true }), {
    type: 'run_done', status: 'complete', result: { storyWritten: true },
  });
  assert.deepEqual(doneEvent('stopped'), { type: 'run_done', status: 'stopped' });
});

test('observedPhase proves reading on reads/searches and writing on target writes only', () => {
  assert.equal(observedPhase(fileEvent('read', 'Read', 'a.ts'), false), 'reading_changes');
  assert.equal(observedPhase(activityEvent('search', 'Grep x'), false), 'reading_changes');
  assert.equal(observedPhase(fileEvent('write', 'Write', 'a.ts'), false), null);
  assert.equal(observedPhase(fileEvent('write', 'Write', 'story.json'), true), 'writing_output');
  assert.equal(observedPhase(fileEvent('edit', 'Edit', 'a.ts'), true), 'writing_output');
  assert.equal(observedPhase(fileEvent('edit', 'Edit', 'a.ts'), false), null);
  assert.equal(observedPhase(textEvent('hello'), true), null);
});

test('phaseRank throws on a phase missing from PHASE_ORDER', () => {
  assert.throws(() => phaseRank('not_a_phase'), /unknown phase/);
});

test('planEvent carries the agent checklist verbatim', () => {
  assert.deepEqual(
    planEvent([
      { text: 'Read the diff', status: 'done' },
      { text: 'Drafting the story', status: 'active' },
      { text: 'Check coverage', status: 'pending' },
    ]),
    {
      type: 'plan',
      items: [
        { text: 'Read the diff', status: 'done' },
        { text: 'Drafting the story', status: 'active' },
        { text: 'Check coverage', status: 'pending' },
      ],
    },
  );
});

test('story phases slot between reading and writing, with labels', () => {
  assert.ok(phaseRank('reading_changes') < phaseRank('recovering_why'));
  assert.ok(phaseRank('recovering_why') < phaseRank('designing_path'));
  assert.ok(phaseRank('designing_path') < phaseRank('writing_output'));
  assert.equal(PHASE_LABELS.recovering_why, 'Recovering the why');
  assert.equal(PHASE_LABELS.designing_path, 'Designing the reading path');
});

test('observedPhase proves recovering_why on intent-evidence commands only', () => {
  assert.equal(observedPhase(commandEvent('git log --oneline -15 main..HEAD'), false), 'recovering_why');
  assert.equal(observedPhase(commandEvent('gh pr view --json title,body'), false), 'recovering_why');
  assert.equal(observedPhase(commandEvent('git diff --stat'), false), null);
  assert.equal(observedPhase(commandEvent('npm test'), false), null);
});

test('parseAgentNoteLine maps exact markers to phases, other notes to narration', () => {
  assert.deepEqual(parseAgentNoteLine('>> Recovering the why'), phaseEvent('recovering_why'));
  assert.deepEqual(parseAgentNoteLine('  >> designing the reading path'), phaseEvent('designing_path'));
  assert.deepEqual(parseAgentNoteLine('>> Writing the steps'), phaseEvent('writing_output'));
  assert.deepEqual(
    parseAgentNoteLine('>> Goal: enable keepers to cap the fee'),
    activityEvent('narration', 'Goal: enable keepers to cap the fee'),
  );
  assert.equal(parseAgentNoteLine('Reading src/x.ts'), null);
  assert.equal(parseAgentNoteLine('>>'), null);
  assert.equal(parseAgentNoteLine('>>   '), null);
  assert.equal(parseAgentNoteLine(''), null);
});

test('parseAgentNoteLine ignores trailing punctuation on phase markers', () => {
  assert.deepEqual(parseAgentNoteLine('>> Designing the reading path.'), phaseEvent('designing_path'));
  assert.deepEqual(parseAgentNoteLine('>> Recovering the why!'), phaseEvent('recovering_why'));
  assert.deepEqual(parseAgentNoteLine('>> Writing the steps...'), phaseEvent('writing_output'));
  // Narration keeps its punctuation untouched.
  assert.deepEqual(
    parseAgentNoteLine('>> Found the entry point!'),
    activityEvent('narration', 'Found the entry point!'),
  );
});

test('parseAgentNoteLine clips runaway narration to 300 chars', () => {
  const long = '>> ' + 'x'.repeat(400);
  const e = parseAgentNoteLine(long);
  assert.equal(e.type, 'activity');
  assert.equal(e.label.length, 301); // 300 + ellipsis
  assert.ok(e.label.endsWith('…'));
});

test('noteEventsFromText scans multi-line chunks and skips plain prose', () => {
  const evs = noteEventsFromText('thinking about it\n>> Recovering the why\n>> Goal: X\nplain line');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, 'phase');
  assert.equal(evs[0].phase, 'recovering_why');
  assert.deepEqual(evs[1], activityEvent('narration', 'Goal: X'));
  assert.deepEqual(noteEventsFromText('no notes here'), []);
});

test('createFileEnricher relativizes paths and counts distinct changed-file reads', () => {
  const enrich = createFileEnricher({ repoPath: '/repo', changedFiles: ['src/a.ts', 'src/b.ts'] });
  const e1 = enrich(fileEvent('read', 'Read', '/repo/src/a.ts'));
  assert.equal(e1.rel, 'src/a.ts');
  assert.equal(e1.changedIndex, 1);
  assert.equal(e1.changedTotal, 2);
  assert.equal(e1.label, 'Reading changed files · 1 of 2 · src/a.ts');
  // Re-reading the same file does not inflate the count.
  assert.equal(enrich(fileEvent('read', 'Read', '/repo/src/a.ts')).changedIndex, 1);
  assert.equal(enrich(fileEvent('read', 'Read', '/repo/src/b.ts')).changedIndex, 2);
  // A read given repo-relative (agent cwd = repo) still matches.
  const enrich2 = createFileEnricher({ repoPath: '/repo', changedFiles: ['src/a.ts'] });
  assert.equal(enrich2(fileEvent('read', 'Read', 'src/a.ts')).changedIndex, 1);
  // Context reads outside the scope stay plain but repo-relative.
  const ctx = enrich(fileEvent('read', 'Read', '/repo/docs/notes.md'));
  assert.equal(ctx.label, 'Reading docs/notes.md');
  assert.equal(ctx.changedIndex, undefined);
  // Writes are labeled relative but never counted as changed-file reads.
  const w = enrich(fileEvent('write', 'Write', '/repo/src/a.ts'));
  assert.equal(w.changedIndex, undefined);
  assert.equal(w.label, 'Writing src/a.ts');
  // Non-file events pass through by reference.
  const t = textEvent('x');
  assert.equal(enrich(t), t);
});

test('createFileEnricher suffix-matches a changed tail from another directory (deliberate trade-off)', () => {
  // matchChanged falls back to a suffix check so agents that report paths
  // under an unexpected prefix (absolute paths outside repoPath, worktree
  // copies) still count toward "n of N". The cost, pinned here: reading
  // vendor/a.ts counts as the changed a.ts even though it is a different file.
  const enrich = createFileEnricher({ repoPath: '/repo', changedFiles: ['a.ts'] });
  const e = enrich(fileEvent('read', 'Read', '/repo/vendor/a.ts'));
  assert.equal(e.rel, 'vendor/a.ts');
  assert.equal(e.changedIndex, 1);
  assert.equal(e.changedTotal, 1);
  assert.equal(e.label, 'Reading changed files · 1 of 1 · vendor/a.ts');
});

test('createFileEnricher with an empty scope only relativizes', () => {
  const enrich = createFileEnricher({ repoPath: '/repo', changedFiles: [] });
  const e = enrich(fileEvent('read', 'Read', '/repo/src/a.ts'));
  assert.equal(e.label, 'Reading src/a.ts');
  assert.equal(e.changedTotal, undefined);
});

test('code-story markers advance phases with their own labels', () => {
  assert.deepEqual(parseAgentNoteLine('>> Framing the question'), { type: 'phase', phase: 'recovering_why', label: 'Framing the question' });
  assert.deepEqual(parseAgentNoteLine('  >> mapping the code.'), { type: 'phase', phase: 'designing_path', label: 'Mapping the code' });
  // The story markers keep their default labels.
  assert.deepEqual(parseAgentNoteLine('>> Recovering the why'), { type: 'phase', phase: 'recovering_why', label: 'Recovering the why' });
});
