// Unit tests for agent detection + command building (not the real spawn). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillCore, skillCorpus, skillReferenceFiles } from './helpers/skill-text.mjs';
import {
  onPath, storyPrompt, normalizeStoryMode, agentCommand,
  streamCommand, normalizeCodexRunOptions, parseClaudeStreamLine, parseCodexStreamLine, toolSummary, classifyTool, planItems,
  codexErrorMessage, summarizeAgentFailure,
  selectAvailableAgent,
  storyRepairPrompt,
} from '../dist/agent.js';
import { codexTaskBinary } from '../dist/codex-tasks.js';
import { validateGeneratedTour, validateTour } from '../dist/tour.js';

test('onPath finds sh, not a bogus command', () => {
  assert.equal(onPath('sh'), true);
  assert.equal(onPath('definitely-not-a-real-cmd-xyz'), false);
});

test('storyPrompt names the base and the output file', () => {
  const p = storyPrompt('main (abc123)');
  assert.ok(p.includes('main (abc123)'));
  assert.ok(p.includes('.diffstory/story.json'));
  assert.ok(p.includes('set its "version" field to 4'));
  assert.ok(p.includes('Use the diffstory-storyteller skill'));
  assert.ok(!p.includes('diffStory review-tour skill'));
  assert.ok(p.includes('reviewer, not a changelog'));
  assert.ok(p.includes('Do not ask questions. Generate it directly.'));
});

test('storyPrompt pins narrative shape and supplies eligible frozen history', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'd'.repeat(40);
  const manifest = {
    baseSha,
    headSha,
    eligible: true,
    commits: [
      { sha: 'b'.repeat(40), subject: 'introduce boundary', parentCount: 1, added: 8, removed: 2, files: ['src/a.ts'], omittedFiles: 0 },
      { sha: 'c'.repeat(40), subject: 'prove boundary', parentCount: 1, added: 5, removed: 0, files: ['test/a.test.ts'], omittedFiles: 0 },
    ],
  };
  const prompt = storyPrompt('main', 'feature', 'guided', [], undefined, manifest);
  assert.ok(prompt.includes('"storyArc"'));
  assert.ok(prompt.includes('"changeType", "shape", and "readingPath"'));
  assert.ok(prompt.includes('"evolution" with "phases" only'));
  assert.ok(prompt.includes('server owns and adds "baseSha" and "headSha"'));
  assert.ok(prompt.includes('"firstCommit", "lastCommit", and optional "relatedSteps"'));
  assert.ok(prompt.includes('introduce boundary'));
  assert.ok(prompt.includes('src/a.ts'));
  assert.ok(storyPrompt('main').includes('Do not add "evolution"'));

  const frozenPrompt = storyPrompt(
    baseSha, headSha, 'guided', [], undefined, manifest,
    { base: 'main', head: 'feature' },
  );
  assert.ok(frozenPrompt.includes(`git diff ${baseSha}..${headSha} --`));
  assert.ok(frozenPrompt.includes('set its "base" field to "main"'));
  assert.ok(frozenPrompt.includes('its "head" field to "feature"'));
});

test('storyPrompt pins run facts and delegates every craft rule to the skill', () => {
  const p = storyPrompt('main');
  // Run-specific facts stay in the prompt…
  assert.ok(p.includes('git diff main --'));
  assert.ok(p.includes('set its "mode" field to "guided"'));
  assert.ok(p.includes('The skill owns the craft'));
  assert.ok(p.includes('recover the why, reconstruct the app path, storyboard the camera, then write the steps'));
  assert.ok(p.includes('hotspots'));
  assert.ok(p.includes('non-goals'));
  assert.ok(p.includes('The app validates the finished story'));
  assert.match(p, /set its "version" field to 4/);
  assert.match(p, /Page concept steps: "id", "order", "title", "kind": "concept", "page", "narration"/);
  assert.doesNotMatch(p, /concept-primer budgets/);
  // …while the craft contracts live only in SKILL.md, so the two cannot drift.
  for (const duplicated of [
    'Detail level contract', 'Viewport contract', 'Beat contract', 'Context contract',
    'Writing contract', 'Voice contract', 'Coverage contract', 'Range contract',
    'Focus pointer contract', 'Truth contract', 'Concept primer contract',
    'Falsifiable self-review', 'Phase 1 — Recover the why', 'Concept-gap test',
  ]) {
    assert.ok(!p.includes(duplicated), `craft rule duplicated in prompt: ${duplicated}`);
  }
  // Drift guard. The boundary the eval loop settled on: the prompt owns what the
  // VALIDATOR enforces (field names, numeric caps) because machine-checked
  // contracts do not survive being read as prose inside an 8k-word skill; the
  // skill owns judgment. So size alone is not the test — the craft-section
  // assertions above are. This cap just stops the skill leaking back in wholesale.
  // Raised from 4000 when the HTML format contract landed — that contract is
  // validator-enforced, so by the rule above it belongs here rather than in the
  // skill. Raised again for the validator-enforced v3 move field contract; the
  // craft-section assertions above remain the real drift guard.
  // Raised to 6000 for the checker instruction: it is how the agent verifies the
  // validator-enforced contracts (and coverage) before the finish gate runs.
  // Raised to 6500 for the v4 page-concept field contract, which the validator enforces.
  assert.ok(p.length < 6500, `prompt grew to ${p.length} chars — move craft rules into SKILL.md instead`);
});

test('storyPrompt supports story detail levels', () => {
  assert.equal(normalizeStoryMode('brief'), 'brief');
  assert.equal(normalizeStoryMode('detailed'), 'detailed');
  assert.equal(normalizeStoryMode('guided'), 'guided');
  assert.equal(normalizeStoryMode('anything else'), 'guided');

  assert.ok(storyPrompt('main').includes('set its "mode" field to "guided"'));
  assert.ok(storyPrompt('main', undefined, 'brief').includes('set its "mode" field to "brief"'));
  const detailed = storyPrompt('main', undefined, 'detailed');
  assert.ok(detailed.includes('git diff main --'));
  assert.ok(detailed.includes('set its "mode" field to "detailed"'));
  for (const mode of ['brief', 'guided', 'detailed']) {
    const prompt = storyPrompt('main', undefined, mode);
    // Raised from 4000 when the HTML format contract landed. Validator-enforced
    // contracts have to live in the prompt (see the comment above the field-name
    // block in agent.ts) because deep-skill prose does not reliably survive being
    // read — and an out-of-tier tag is now a validation failure. This ceiling
    // buys correctness, not verbosity; keep new prose out of it.
    // Raised to 6000 with the checker instruction (see the test above).
    // Raised to 6500 for the v4 page-concept field contract, which the validator enforces.
    assert.ok(prompt.length < 6500, `${mode} prompt grew to ${prompt.length} chars`);
  }
});

test('storyPrompt scales guidance to a familiar audience, and stays silent otherwise', () => {
  const familiar = storyPrompt('main', undefined, 'guided', [], undefined, undefined, undefined, {
    audience: 'familiar',
  });
  assert.ok(familiar.includes('Audience contract'));
  assert.ok(familiar.includes('references/audience.md'));
  assert.ok(familiar.length < 6500, `familiar prompt grew to ${familiar.length} chars`);
  const plain = storyPrompt('main');
  assert.ok(!plain.includes('Audience contract'));
  assert.equal(
    storyPrompt('main', undefined, 'guided', [], undefined, undefined, undefined, {
      audience: 'newcomer',
    }),
    plain,
  );
});

test('bundled diffstory-storyteller skill teaches reviewer-first story generation', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(skill.includes('Make a reviewer map before JSON'));
  assert.ok(skill.includes('falsifiable mental model'));
  assert.ok(skill.includes('Hard quality gates'));
  assert.ok(skill.includes('coverage ledger'));
  assert.ok(skill.includes('`viewport` is the review window'));
  assert.ok(flat.includes('`range` anchors; optional top-level `ranges` claim; `highlights` point'));
  assert.ok(skill.includes('Truth audit'));
  assert.ok(skill.includes('Do not claim tests pass unless you ran them'));
});

test('bundled diffstory-storyteller skill restores app context before judging the diff', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('reviewer remembers the requested outcome but not the app internals'));
  assert.ok(skill.includes('Reconstruct the app path'));
  assert.ok(skill.includes('inbound'));
  assert.ok(skill.includes('outbound'));
  assert.ok(skill.includes('entry -> existing owner -> changed decision -> downstream effect -> proof/risk'));
  assert.ok(skill.includes('behavioral entry point'));
  assert.ok(skill.includes('Do not start with imports, icons'));
  assert.ok(skill.includes('Context beats may and should highlight unchanged lines'));
});

test('bundled diffstory-storyteller skill makes the camera contract falsifiable', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('guided camera'));
  assert.ok(skill.includes('orientation -> change ->'));
  assert.ok(skill.includes('detailed steps stay within 60'));
  assert.ok(skill.includes('range` itself'));
  assert.ok(skill.includes('at most 12 context'));
  assert.ok(skill.includes('at most 12 lines'));
  assert.ok(skill.includes('Memory test'));
  assert.ok(skill.includes('Camera test'));
  assert.ok(skill.includes('First-stop test'));
});

test('bundled diffstory-storyteller skill requires the narrative story arc', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Narrative arc'));
  assert.ok(skill.includes('Open the goal on the problem, not on the diff'));
  assert.ok(skill.includes('designed the flow'));
  assert.ok(skill.includes('To implement that flow, I first'));
  assert.ok(skill.includes('intent -> flow -> implementation'));
  assert.ok(skill.includes('not a list of touched files'));
});

test('bundled storyteller declares reading shape and frozen first-parent evolution', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Every newly generated story carries `storyArc`'));
  assert.ok(skill.includes('`changeType`, `shape`, and'));
  assert.ok(skill.includes('plain-text `readingPath`'));
  assert.ok(skill.includes('Inspect the frozen first-parent progression'));
  assert.ok(skill.includes('1-6 contiguous phases'));
  assert.ok(skill.includes('never author server-owned `baseSha` or `headSha`'));
  assert.ok(skill.includes('final diff remains authoritative'));
  assert.ok(skill.includes('failure trigger -> trust boundary -> fix -> proof'));
});

test('bundled diffstory-storyteller skill teaches free concept pages', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Concept-gap test'));
  assert.ok(skill.includes('shown than told'));
  assert.ok(skill.includes('concrete instance from this diff'));
  assert.ok(skill.includes('The page has no background of its own'));
  assert.doesNotMatch(skill, /--ds-bg/);
  assert.ok(skill.includes('`narration` is what you would say while pointing at the page'));
  assert.ok(skill.includes('`--ds-accent`'));
  assert.ok(skill.includes('data-ds-theme'));
  assert.doesNotMatch(skill, /Never place two concept primers next to each other/);
  assert.doesNotMatch(skill, /Never end the story with a concept primer/);
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Put a concept page wherever its model helps most, first and last included; a page teaches a model the code needs, never a glossary.'));
  assert.doesNotMatch(flat, /never stack pages up front/);
  assert.ok(flat.includes('shows the model (something to drag, step, toggle, or watch); a page that is mostly paragraphs fails.'));
  assert.ok(flat.includes('or focus is in a text field (input, textarea, select, contenteditable)'));
  assert.ok(flat.includes('Only story navigation keys leave the page: the left and right arrows, `j`, `k`, and Space.'));
});

test('bundled diffstory-storyteller skill pins the v4 concept schema and no budgets', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(skill.includes('Newly generated stories use `"version": 4`'));
  assert.doesNotMatch(skill, /at most \d concept primers?/);
  assert.doesNotMatch(skill, /60-180 words/);
  assert.ok(skill.includes('Concept steps never claim diff coverage'));
  assert.ok(flat.includes('must not contain `file`, `range`, `ranges`, `viewport`, `highlights`, `beats`, `why`, `calls`, or `returnsTo`'));
  for (const tag of ['`skim`', '`sweep`', '`mechanical`']) assert.ok(flat.includes(tag));
  assert.ok(skill.includes('Stories longer than 10 steps'));
});

test('bundled skill schema example is a valid interleaved v4 story', () => {
  const skill = skillCorpus();
  const example = JSON.parse(skill.split(/^## Schema$/m)[1].split('```jsonc')[1].split('```')[0]);
  assert.deepEqual(validateTour(example), []);
  assert.deepEqual(validateGeneratedTour(example), []);
  assert.deepEqual(example.steps.map((step) => [step.order, step.kind]), [
    [1, 'changed'],
    [2, 'concept'],
    [3, 'new-file'],
    [4, 'context'],
  ]);
  assert.deepEqual(example.steps[1].preparesFor, ['s2']);
  assert.equal(example.version, 4);
  assert.match(example.steps[1].page, /^<!doctype html>/);
  assert.equal(typeof example.steps[1].narration, 'string');
  assert.equal(example.steps[1].body, undefined);
});

test('bundled diffstory-storyteller skill makes deleted-file steps use the changed kind', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Never use "deleted" as a step kind'));
  assert.ok(skill.includes('For deleted files, use kind "changed"'));
  assert.ok(skill.includes('anchor the range at the post-change deletion location'));
});

test('bundled diffstory-storyteller skill teaches the pure deleted-file sentinel anchor', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('For a whole deleted file, use `range`, `viewport`, and `highlights` of `[0, 0]`'));
  assert.ok(skill.includes('Do not invent line 1 for a file that no longer exists'));
});

test('bundled diffstory-storyteller skill teaches explicit read-aloud focus targets', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Focus pointer contract'));
  assert.ok(skill.includes('"focus"'));
  assert.ok(skill.includes('"ranges"'));
  assert.ok(skill.includes('inside that step'));
  assert.ok(skill.includes('post-change line numbers'));
  assert.ok(skill.includes('one or two lines'));
  assert.ok(skill.includes('not the whole displayed section'));
});

test('bundled diffstory-storyteller skill teaches viewport and highlighted line selection', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Viewport contract'));
  assert.ok(skill.includes('`viewport`'));
  assert.ok(skill.includes('`highlights`'));
  assert.ok(skill.includes('what the reviewer sees'));
  assert.ok(skill.includes('lines the story is currently talking about'));
  assert.ok(skill.includes('from the requirement'));
  assert.ok(skill.includes('far-apart highlight islands'));
  assert.ok(skill.includes('steady camera shot'));
});

test('bundled diffstory-storyteller skill requires beat-by-beat narration for read-aloud sync', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Beat contract'));
  assert.ok(skill.includes('`beats`'));
  assert.ok(skill.includes('separate speech'));
  assert.ok(skill.includes('one beat per highlighted code part'));
  assert.ok(skill.includes('Do not put one big speech over several highlight groups'));
});

test('bundled diffstory-storyteller skill teaches story detail levels', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Detail levels'));
  assert.ok(skill.includes('Brief mode'));
  assert.ok(skill.includes('Balanced mode'));
  assert.ok(skill.includes('Line-by-line mode'));
  assert.ok(skill.includes('line-by-line'));
  assert.ok(skill.includes('all meaningful code paths'));
  assert.ok(skill.includes('"mode": "brief"'));
  assert.ok(skill.includes('"mode": "detailed"'));
});

test('bundled diffstory-storyteller skill recovers intent before writing', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Recover the why'));
  assert.ok(skill.includes('"sources"'));
  assert.ok(skill.includes('code-derived'));
  assert.ok(skill.includes('conversation'));
  assert.ok(skill.includes('up to 2 short questions'));
  assert.ok(skill.includes('Not evidence: branch names, filenames, vibes'));
  assert.ok(skill.includes('Never invent product intent'));
});

test('bundled diffstory-storyteller skill enforces the narrative audit', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Narrative audit'));
  assert.ok(skill.includes('Order test'));
  assert.ok(skill.includes('Thread rule'));
  assert.ok(skill.includes('Thread test'));
  assert.ok(skill.includes('one continuous story'));
});

test('bundled diffstory-storyteller skill teaches focused story scopes', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('storyScope'));
  assert.ok(skill.includes('includedFiles'));
  assert.ok(skill.includes('excludedFiles'));
});

test('storyPrompt records the head ref for fixed range stories', () => {
  const p = storyPrompt('main', 'feature/liquidation');
  assert.ok(p.includes('git diff main..feature/liquidation --'));
  assert.ok(p.includes('set its "base" field to "main" and its "head" field to "feature/liquidation"'));
});

test('storyPrompt excludes oversized files from the diff and tells the agent to skip them', () => {
  const p = storyPrompt('main', 'feature/x', 'guided', ['abis/symmio.json', 'docs/gen.html']);
  // The agent's own diff command must subtract the generated files via pathspec.
  assert.ok(p.includes("git diff main..feature/x -- ':(exclude)abis/symmio.json' ':(exclude)docs/gen.html'"));
  // And it must be told not to chase coverage on them (which would loop forever).
  assert.ok(p.includes('Scope contract'));
  assert.ok(p.includes('intentionally excluded from this review: abis/symmio.json, docs/gen.html'));
  assert.ok(p.includes('Do not read, narrate, or write steps for them'));
});

test('storyPrompt supports selected story files and reviewer guidance', () => {
  const p = storyPrompt('main', 'feature/x', 'guided', ['package-lock.json'], {
    includedFiles: ['contracts/Fee.sol', 'src/story.ts'],
    excludedFiles: ['test/story.test.ts', 'package.json'],
    reviewerNote: 'Pay extra attention to the fee guard.',
  });
  assert.ok(p.includes("git diff main..feature/x -- 'contracts/Fee.sol' 'src/story.ts' ':(exclude)package-lock.json'"));
  assert.ok(p.includes('Story scope contract'));
  assert.ok(p.includes('Only create changed or new-file story steps for these selected files: contracts/Fee.sol, src/story.ts'));
  assert.ok(p.includes('These changed files are intentionally outside this story scope: test/story.test.ts, package.json'));
  assert.ok(p.includes('"storyScope"'));
  assert.ok(p.includes('Pay extra attention to the fee guard.'));
  assert.ok(p.includes('cite "reviewer guidance" in intent.sources'));
});

test('storyPrompt with no exclusions leaves the diff command untouched', () => {
  const p = storyPrompt('main');
  assert.ok(p.includes('git diff main --'));
  assert.ok(!p.includes(':(exclude)'));
  assert.ok(!p.includes('Scope contract'));
});

test('agentCommand builds headless invocations with a safe default model', () => {
  assert.deepEqual(agentCommand('claude', 'GO'), [
    'claude',
    ['-p', 'GO', '--permission-mode', 'acceptEdits', '--model', 'sonnet'],
  ]);
  assert.deepEqual(agentCommand('codex', 'GO'), [codexTaskBinary(), ['exec', '--full-auto', 'GO']]);
});

test('selectAvailableAgent honors explicit installed choices and rejects unavailable ones', () => {
  assert.deepEqual(selectAvailableAgent(undefined, ['claude', 'codex'], 'claude'), { ok: true, agent: 'claude' });
  assert.deepEqual(selectAvailableAgent('codex', ['claude', 'codex'], 'claude'), { ok: true, agent: 'codex' });

  const unavailable = selectAvailableAgent('codex', ['claude'], 'claude');
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 400);
  assert.match(unavailable.label, /not available/i);

  const invalid = selectAvailableAgent('gemini', ['claude', 'codex'], 'claude');
  assert.equal(invalid.ok, false);
  assert.match(invalid.detail, /Claude, Codex/i);
});

test('agentCommand honors an explicit model', () => {
  assert.deepEqual(agentCommand('claude', 'GO', 'opus')[1], [
    '-p', 'GO', '--permission-mode', 'acceptEdits', '--model', 'opus',
  ]);
  assert.deepEqual(agentCommand('codex', 'GO', 'gpt-5')[1], ['exec', '--full-auto', '--model', 'gpt-5', 'GO']);
});

test('agentCommand maps Codex configuration to real exec flags', () => {
  assert.deepEqual(
    agentCommand('codex', 'GO', 'gpt-5-codex', {
      codex: {
        sandbox: 'workspace-write',
        provider: 'lmstudio',
        profile: 'story',
        config: ['model_reasoning_effort="high"', 'features.web_search=true'],
      },
    })[1],
    [
      'exec',
      '--sandbox',
      'workspace-write',
      '--oss',
      '--local-provider',
      'lmstudio',
      '--profile',
      'story',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'features.web_search=true',
      '--model',
      'gpt-5-codex',
      'GO',
    ],
  );
  assert.deepEqual(
    agentCommand('codex', 'GO', undefined, { codex: { sandbox: 'danger-full-access', provider: 'ollama' } })[1],
    ['exec', '--dangerously-bypass-approvals-and-sandbox', '--oss', '--local-provider', 'ollama', 'GO'],
  );
});

test('normalizeCodexRunOptions keeps only supported story-generation options', () => {
  assert.deepEqual(normalizeCodexRunOptions({
    codexSandbox: 'workspace-write',
    codexProvider: 'ollama',
    codexProfile: ' review ',
    codexConfig: '# no\nfoo=true\nnot-a-config\nbar=\"baz\"',
  }), {
    sandbox: 'workspace-write',
    provider: 'ollama',
    profile: 'review',
    config: ['foo=true', 'bar="baz"'],
  });
});

test('storyRepairPrompt preserves unaffected steps and protected narrative history', () => {
  const prompt = storyRepairPrompt({
    action: 'split', stepId: 's2', file: 'src/a.ts', base: 'main',
    hasStoryArc: true, hasEvolution: true,
  });
  assert.match(prompt, /Split story step "s2" in src\/a\.ts/);
  assert.match(prompt, /Preserve every unaffected step/);
  assert.match(prompt, /Do not regenerate the walkthrough from scratch/);
  assert.match(prompt, /Preserve every unaffected concept step exactly/);
  assert.match(prompt, /Preserve legacy version 1 or 2/);
  assert.match(prompt, /version 3 whenever the repair adds moves or pairedView/);
  assert.match(prompt, /Upgrade to version 4 whenever the repair adds a page concept/);
  assert.match(prompt, /Preserve "storyArc" exactly/);
  assert.match(prompt, /Only "relatedSteps" may change/);
  assert.match(prompt, /firstCommit, and lastCommit exactly/);
  assert.match(prompt, /concept steps do not claim coverage/i);
  assert.match(prompt, /Outside "page": no links, images, SVG, id, or style/);
  assert.match(prompt, /\.diffstory\/story\.json/);
  assert.match(prompt, /diffstory-storyteller/);
});

test('streamCommand uses stream-json for claude and exec for codex', () => {
  assert.deepEqual(streamCommand('claude', 'GO'), [
    'claude',
    ['-p', 'GO', '--output-format', 'stream-json', '--verbose',
     '--permission-mode', 'acceptEdits', '--model', 'sonnet'],
  ]);
  assert.deepEqual(streamCommand('codex', 'GO'), [codexTaskBinary(), ['exec', '--full-auto', 'GO']]);
  assert.deepEqual(streamCommand('codex', 'GO', 'gpt-5')[1], ['exec', '--full-auto', '--model', 'gpt-5', 'GO']);
  assert.deepEqual(streamCommand('codex', 'GO', 'gpt-5', { codex: { sandbox: 'read-only' } })[1], [
    'exec',
    '--sandbox',
    'read-only',
    '--model',
    'gpt-5',
    'GO',
  ]);
});

test('Codex JSONL progress exposes useful story-generation events', () => {
  assert.deepEqual(
    parseCodexStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } })),
    [{ type: 'text', data: 'Done.' }],
  );
  assert.deepEqual(
    parseCodexStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test' } })),
    [{ type: 'command', command: 'npm test', label: '$ npm test' }],
  );
  assert.deepEqual(parseCodexStreamLine(JSON.stringify({ type: 'thread.started', thread_id: 'unused' })), []);
});

test('classifyTool maps tools to the most specific progress event', () => {
  assert.deepEqual(classifyTool('Read', { file_path: 'src/x.ts' }),
    { type: 'file', action: 'read', rawTool: 'Read', target: 'src/x.ts', label: 'Reading src/x.ts' });
  assert.deepEqual(classifyTool('Write', { file_path: 'a/story.json' }),
    { type: 'file', action: 'write', rawTool: 'Write', target: 'a/story.json', label: 'Writing a/story.json' });
  assert.deepEqual(classifyTool('Edit', { file_path: 'src/y.ts' }),
    { type: 'file', action: 'edit', rawTool: 'Edit', target: 'src/y.ts', label: 'Editing src/y.ts' });
  const bash = classifyTool('Bash', { command: 'git   diff --stat' });
  assert.equal(bash.type, 'command');
  assert.equal(bash.command, 'git diff --stat');
  assert.deepEqual(classifyTool('Grep', { pattern: 'foo' }),
    { type: 'activity', kind: 'search', label: 'Grep foo' });
  assert.deepEqual(
    classifyTool('TodoWrite', {
      todos: [
        { content: 'Read the diff', activeForm: 'Reading the diff', status: 'completed' },
        { content: 'Draft the story', activeForm: 'Drafting the story', status: 'in_progress' },
        { content: 'Check coverage', activeForm: 'Checking coverage', status: 'pending' },
      ],
    }),
    {
      type: 'plan',
      items: [
        { text: 'Read the diff', status: 'done' },
        { text: 'Drafting the story', status: 'active' },
        { text: 'Check coverage', status: 'pending' },
      ],
    },
  );
  const unknown = classifyTool('MysteryTool', { path: 'p' });
  assert.equal(unknown.type, 'tool');
  assert.equal(unknown.rawTool, 'MysteryTool');
});

test('planItems maps statuses, prefers activeForm for the active item, drops empties', () => {
  assert.deepEqual(
    planItems([{ content: 'a', activeForm: 'doing a', status: 'in_progress' }]),
    [{ text: 'doing a', status: 'active' }],
  );
  // Non-active items use content even if activeForm is present.
  assert.deepEqual(
    planItems([{ content: 'a', activeForm: 'doing a', status: 'completed' }]),
    [{ text: 'a', status: 'done' }],
  );
  // Unknown/missing status falls back to pending; missing activeForm falls back to content.
  assert.deepEqual(
    planItems([{ content: 'b', status: undefined }]),
    [{ text: 'b', status: 'pending' }],
  );
  // Non-array input and empty-text items are dropped.
  assert.deepEqual(planItems(undefined), []);
  assert.deepEqual(planItems([{ content: '   ', status: 'pending' }]), []);
});

test('parseClaudeStreamLine yields text and classified tool events', () => {
  const textLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } });
  assert.deepEqual(parseClaudeStreamLine(textLine), [{ type: 'text', data: 'Hello' }]);

  const toolLine = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/x.ts' } }] },
  });
  assert.deepEqual(parseClaudeStreamLine(toolLine),
    [{ type: 'file', action: 'edit', rawTool: 'Edit', target: 'src/x.ts', label: 'Editing src/x.ts' }]);
});

test('toolSummary shows the command for Bash and the target for file tools', () => {
  assert.equal(toolSummary('Bash', { command: 'git   diff --stat' }), '$ git diff --stat');
  assert.equal(toolSummary('Read', { file_path: 'src/api.ts' }), 'Read src/api.ts');
  assert.equal(toolSummary('Grep', { pattern: 'foo' }), 'Grep foo');
  assert.equal(toolSummary('SomethingElse', {}), 'SomethingElse');
  assert.ok(toolSummary('Bash', { command: 'x'.repeat(200) }).endsWith('…'));
});

test('parseClaudeStreamLine ignores non-JSON, empty, and non-assistant lines', () => {
  assert.deepEqual(parseClaudeStreamLine('not json'), []);
  assert.deepEqual(parseClaudeStreamLine(''), []);
  assert.deepEqual(parseClaudeStreamLine(JSON.stringify({ type: 'system', subtype: 'init' })), []);
});

test('parseCodexStreamLine forwards prose as text and $-lines as commands', () => {
  assert.deepEqual(parseCodexStreamLine('working on it'), [{ type: 'text', data: 'working on it' }]);
  assert.deepEqual(parseCodexStreamLine('   '), []);
  const cmd = parseCodexStreamLine('$ npm test');
  assert.equal(cmd.length, 1);
  assert.equal(cmd[0].type, 'command');
  assert.equal(cmd[0].command, 'npm test');
});

test('Codex upgrade failures become one actionable diagnostic instead of streamed JSON', () => {
  const message = "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
  const line = `ERROR: ${JSON.stringify({
    type: 'error',
    status: 400,
    error: { type: 'invalid_request_error', message },
  })}`;

  assert.equal(codexErrorMessage(line), message);
  assert.deepEqual(parseCodexStreamLine(line), []);

  const summary = summarizeAgentFailure([
    'hook: SessionStart',
    line,
    line,
  ].join('\n'));
  assert.equal(summary.label, 'Codex needs an update for gpt-5.6-sol');
  assert.match(summary.detail, /choose another model and try again/i);
  assert.equal(summary.technicalDetail, message);
  assert.doesNotMatch(summary.technicalDetail, /hook:|ERROR:|\{"type"/);
});

test('storyPrompt requires live >> phase markers and notes', () => {
  const p = storyPrompt('main');
  assert.match(p, /">> Recovering the why"/);
  assert.match(p, /">> Reconstructing the app path"/);
  assert.match(p, /">> Storyboarding the camera"/);
  assert.match(p, /">> Writing the steps"/);
  assert.match(p, /starting with ">> "/);
});

test('bundled diffstory-storyteller skill demands honest hotspots and non-goals', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Declare your doubts (hotspots)'));
  assert.ok(skill.includes('where should I distrust this?'));
  assert.ok(skill.includes('"hotspots"'));
  assert.ok(skill.includes('Honest reasons only'));
  assert.ok(skill.includes('the id of a `changed` or `new-file` step'));
  assert.ok(skill.includes('nonGoals'));
  assert.ok(skill.includes('Deliberately does not'));
  assert.ok(skill.includes('Hotspot test'));
  assert.ok(skill.includes('an accidental gap'));
});

test('bundled diffstory-storyteller skill makes every stop name the failure it rules out', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('A stop earns its place by naming the failure its evidence rules out'));
  assert.ok(skill.includes('name the specific bug'));
  assert.ok(skill.includes('Failure test'));
  assert.doesNotMatch(skill, /`question`/);
});

test('bundled diffstory-storyteller skill shows the same diff as changelog vs story', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('the same diff, told twice'));
  assert.ok(skill.includes('The changelog (do not write this)'));
  assert.ok(skill.includes('The story (write this)'));
  assert.ok(skill.includes('each beat names the failure its evidence rules out'));
});

test('bundled diffstory-storyteller skill teaches beat prose that unlocks, not inventories', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('the layer that most often goes flat'));
  assert.ok(skill.includes('No line-number narration'));
  assert.ok(skill.includes('One beat, one decision'));
  assert.ok(skill.includes('End on the consequence'));
  assert.ok(skill.includes('BAD  (one beat, three decisions, pure inventory)'));
  assert.ok(skill.includes('GOOD  (three beats, each one decision ending in its consequence)'));
  assert.ok(skill.includes('Beat prose test'));
});

test('bundled diffstory-storyteller skill rejects circular intent sources', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Prefer evidence that *motivated* the change'));
  assert.ok(skill.includes('circular'));
  assert.ok(skill.includes('keep the\n  goal narrow and factual'));
});

test('bundled diffstory-storyteller skill signals independent concerns instead of faking a thread', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('Branch rule'));
  assert.ok(skill.includes('Do not fake a thread between them'));
  assert.ok(skill.includes('announcing the switch'));
  assert.ok(skill.includes('An unsignalled jump between concerns'));
  assert.ok(skill.includes('an unannounced jump fails this test'));
});

test('bundled diffstory-storyteller skill permits only narrow mechanical sweep consolidation', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Count the hunks before you plan the steps'));
  assert.ok(flat.includes('Mechanical sweeps'));
  assert.ok(flat.includes('one repeated mechanical pattern in one file'));
  assert.ok(flat.includes('top-level `ranges`'));
  assert.ok(flat.includes('Keep `range` tight around one representative instance'));
  assert.ok(flat.includes('Scattered substantive decisions need separate steps'));
  assert.ok(flat.includes('coverage wins'));
  assert.ok(!flat.includes('One step claims exactly one `range`'));
});

test('bundled diffstory-storyteller skill keeps detailed mode from narrating line numbers', () => {
  const skill = skillCorpus();
  assert.ok(skill.includes('describes *granularity*, never *phrasing*'));
  assert.ok(skill.includes('does not license narrating line numbers'));
  assert.ok(skill.includes('let the highlight supply the address'));
});

test('bundled diffstory-storyteller skill forbids abbreviating sweep-step schema', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(flat.includes('shorter, never structurally lighter'));
  assert.ok(flat.includes('beats use `text`, never `body`'));
  assert.ok(flat.includes('drift into an abbreviated shape, and the app rejects the whole story over it'));
  assert.ok(flat.includes('Schema spot-check'));
  assert.ok(flat.includes('are the ones real stories lose first'));
  assert.ok(flat.includes('`order` (a number — never omit it)'));
});

test('storyPrompt pins machine-checked field names the skill prose cannot convey', () => {
  // Real eval runs paraphrased the beat field as "body" and "prose" and dropped
  // "order" from every step. Field names are the output contract, not craft, so
  // they live in the prompt where they cannot be reworded.
  const p = storyPrompt('main');
  assert.ok(p.includes('Exact field names (never paraphrase)'));
  assert.ok(p.includes('"order" (number 1..N)'));
  assert.ok(p.includes('optional TOP-LEVEL "ranges" only when "tags" includes "skim", "sweep", or "mechanical"'));
  assert.ok(p.includes('"text" (not "body" or "prose")'));
  assert.ok(p.includes('"body" is concept-only'));
  assert.ok(p.includes('Optional moves (max 6)'));
  assert.ok(p.includes('condition-changed'));
  assert.ok(p.includes('"label" (tag, max 24)'));
  assert.ok(p.includes('"hidden" {"as":path|destination|consequence, "tag" max 48, "what" max 120}'));
  assert.ok(p.includes('move "hidden.what" take INLINE tags only'));
  assert.ok(p.includes('move "label"/"hidden.tag"'));
  assert.ok(p.includes('One omission invalidates the story'));
});

test('bundled storyteller skill applies the diff-annotation restraint filter', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(flat.includes('could the reviewer learn this by reading the two columns?'));
  for (const kind of ['`moved`', '`extracted`', '`inlined`', '`wrapped`', '`unwrapped`', '`condition-changed`', '`reordered`', '`flow`']) {
    assert.ok(flat.includes(kind), `skill omits ${kind}`);
  }
  assert.ok(flat.includes('Never use `flow` when a named verb fits'));
  assert.ok(flat.includes('before.range` uses old/pre-change line numbers'));
  assert.ok(flat.includes("source on the left and destination on the right"));
  assert.ok(flat.includes('split them into separate steps'));
  assert.ok(flat.includes('Use a `destination` callout only as a fallback'));
  assert.ok(flat.includes('a branch with **no code to read**'));
  assert.ok(flat.includes('`hidden` is the only field that produces a callout'));
});

test('bundled diffstory-storyteller skill keeps sweep steps from becoming diff narration', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Sweep steps must not become diff narration'));
  assert.ok(flat.includes('Keep `range` tight around one representative instance'));
  assert.match(flat, /same (?:repeated )?(?:edit|change|pattern)/i);
  assert.ok(flat.includes('never a restatement of the changed lines'));
  assert.ok(flat.includes('same `chapter` so the rail shows one skimmable'));
});

test('bundled diffstory-storyteller skill separates range (claims) from highlights (points)', () => {
  const skill = skillCorpus();
  // Markdown rewraps as the prose is edited, so match against whitespace-normalized
  // text instead of guessing where a line happens to break.
  const flat = skill.replace(/\s+/g, ' ');
  for (const phrase of [
    '`range` anchors; optional top-level `ranges` claim; `highlights` point',
    'top-level `ranges`',
    'legacy `focus.ranges`',
    'complete coverage claim',
    '`range` must be contained in one entry',
    'not the bounding box',
    'Other top-level `ranges` entries may sit outside `viewport`',
    'Point the single beat at ONE local instance',
  ]) {
    assert.ok(flat.includes(phrase), `SKILL.md is missing: ${phrase}`);
  }
});

test('bundled diffstory-storyteller skill bans value-transition narration in beats', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  for (const phrase of [
    'Never narrate a value transition',
    'The diff already renders both sides in colour',
    'say what depended on it',
    'A sweep beat is allowed to be short; it is not allowed to be empty',
  ]) {
    assert.ok(flat.includes(phrase), `SKILL.md is missing: ${phrase}`);
  }
});

test('bundled diffstory-storyteller skill lands the listener before every change', () => {
  // Heard aloud, a step that opens on the change drops the listener into
  // unfamiliar code; they stop and replay. The first beat must say whose code
  // this is and why control gets here before it says what moved.
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  for (const phrase of [
    'Landing rule',
    'lands the listener before it says anything about the change',
    'who reaches it and when',
    'Land the listener first',
    'Landing test',
    'read ONLY the first beat of every code step, aloud',
    'Name the symbol again',
  ]) {
    assert.ok(flat.includes(phrase), `SKILL.md is missing: ${phrase}`);
  }
  // The worked examples are what runs copy, so they must model the landing.
  assert.ok(flat.includes('this is `placeOrder()` in the API layer'));
  assert.ok(flat.includes('This is `.ds-main`, the page surface'));
});

test('storyPrompt pins the landing rule next to the beat rules', () => {
  // One line, by design: the prompt owns pinned rules, the skill owns the craft.
  const guided = storyPrompt('main');
  assert.ok(guided.includes("A step's FIRST beat lands the listener: name the function/rule, who reaches it and when, then the change. Never open on the change."));
});

test('storyPrompt pins the numeric limits the validator enforces, per mode', () => {
  // Camera caps drifted the same way field names did: stated in the skill, ignored
  // in practice. They are machine-checked, so they belong next to the field names.
  const guided = storyPrompt('main');
  assert.ok(guided.includes('Hard limits the app enforces'));
  assert.ok(guided.includes('at most 12 lines'));
  assert.ok(guided.includes('A wide "range" does NOT permit a wide highlight'));
  assert.ok(guided.includes('Each claimed span covers its FULL changed cluster'));
  assert.ok(guided.includes('"range" is framed and inside "viewport"'));
  assert.ok(guided.includes('other "ranges" entries need not be'));
  assert.ok(guided.includes('"viewport": at most 40 lines in guided mode'));
  assert.ok(guided.includes('only a changed/new-file step with a larger "range" may use its length plus at most 12 context lines'));
  assert.ok(guided.includes('At most 3 beats per step in guided mode'));
  assert.ok(guided.includes('must not narrate a value transition'));

  const detailed = storyPrompt('main', undefined, 'detailed');
  assert.ok(detailed.includes('"viewport": at most 60 lines in detailed mode'));
  assert.ok(detailed.includes('At most 5 beats per step in detailed mode'));
});

test('storyPrompt self-check names every required field, not a sample', () => {
  // A run that was told to check only order/text/highlights shipped 55 code
  // steps with no "why" at all — the self-check list is what gets verified.
  const p = storyPrompt('main');
  assert.ok(p.includes('check EVERY step'));
  assert.ok(p.includes('all ten always-required fields'));
  assert.ok(!p.includes('all eleven of'));
  for (const f of ['id', 'order', 'title', 'kind', 'file', 'range', 'viewport', 'highlights', 'why', 'beats']) {
    assert.ok(p.includes(`"${f}"`), `self-check omits ${f}`);
  }
  assert.ok(p.includes('every beat has "text" plus highlights on one side'));
  assert.ok(p.includes('One omission invalidates the story'));
});

test('storyPrompt makes coverage a verification pass, not just a generation goal', () => {
  // Scattered mechanical edits may share one narrative only through explicit
  // top-level claims; ordinary behavior still keeps one framed local range.
  const p = storyPrompt('main');
  assert.ok(p.includes('Coverage pass'));
  assert.ok(p.includes('including separate clusters inside one hunk'));
  assert.ok(p.includes('changed/new-file step claims TOP-LEVEL "ranges" when present, otherwise "range"'));
  assert.ok(p.includes('Legacy "focus.ranges" only points at code; it never claims coverage'));
  assert.ok(p.includes('Only on a "skim"/"sweep"/"mechanical" step for one repeated sweep in one file'));
  assert.ok(p.includes('one representative "range"'));
  assert.ok(p.includes('every other full changed span in "ranges"'));
  assert.ok(p.includes('Other entries may be outside "viewport"'));
  assert.ok(p.includes('"range" must be contained in one entry, never a bounding box'));
  assert.ok(p.includes('Anything outside all claims is unexplained'));
});

test('storyPrompt requires every named source to be cited in intent.sources', () => {
  // A run named "DESIGN_MEMORY" in its goal while sources listed only the commit,
  // making the reviewer's one verifiable claim unverifiable.
  const p = storyPrompt('main');
  assert.ok(p.includes('must also appear in "sources"'));
  assert.ok(p.includes('if you cannot cite it, do not name it'));
});

test('bundled diffstory-storyteller skill bridges chapter seams without blanket long-tail merging', () => {
  const skill = skillCorpus();
  const flat = skill.replace(/\s+/g, ' ');
  for (const phrase of [
    'Chapter-seam rule',
    'must open by naming the seam',
    'the single most common place a story loses its thread',
    'Long-tail caution',
    'top-level `ranges`',
    'show a representative instance',
    'coverage-preserving tool for the repetitive tail',
    'not a general instruction to make stories shorter',
  ]) {
    assert.ok(flat.includes(phrase), `SKILL.md is missing: ${phrase}`);
  }
  assert.ok(flat.includes('one repeated mechanical pattern in one file'));
  assert.ok(flat.includes('Substantive changes still need enough local steps to explain every decision'));
  assert.ok(!flat.includes('Prose is the only lever here; step count is not.'));
});

test('the storyteller skill teaches the HTML tiers and the caption rule', () => {
  const skill = skillCorpus();
  assert.match(skill, /Narrative fields are HTML/);
  assert.match(skill, /<caption>/, 'the caption requirement must be shown, not merely described');
  assert.match(skill, /inline only/i, 'beats and why are inline-only');
  assert.match(skill, /plain text — no tags at all/, 'titles carry no markup');
  assert.doesNotMatch(skill, /add Markdown links\/images/, 'the Markdown-era prohibition is stale');
  // The five signal classes must match the sanitizer's vocabulary exactly.
  for (const cls of ['ds-bit', 'ds-slot', 'ds-flag', 'ds-val', 'ds-warn']) {
    assert.ok(skill.includes(cls), `${cls} missing from the authoring contract`);
  }
});

test('both authoring prompts pin the HTML format contract', () => {
  for (const mode of ['brief', 'guided', 'detailed']) {
    const prompt = storyPrompt('main', undefined, mode);
    assert.match(prompt, /restricted HTML, never Markdown/);
    assert.match(prompt, /INLINE tags only/);
    assert.match(prompt, /needs a <caption>/);
  }
  const repair = storyRepairPrompt({ action: 'rewrite', base: 'main', stepId: 's1' });
  assert.match(repair, /restricted HTML, never Markdown/);
});

test('the storyteller skill runs only when explicitly asked', () => {
  // Stories written unasked were a repeated complaint ("I don't need diff story").
  // The description is what agents match on, so it must say explicit-only.
  const skill = skillCorpus();
  const description = skill.match(/^description: (.*)$/m)?.[1] ?? '';
  assert.match(description, /only when the user explicitly asks/);
  assert.match(description, /Never on your own initiative/);
  assert.doesNotMatch(description, /right after you|before handing work back/i);
  assert.ok(skill.includes('Write a story only when the user (or a prompt) explicitly asks for one.'));
});

test('every storyteller reference file is linked from SKILL.md, and every link resolves', () => {
  const core = skillCore();
  const files = skillReferenceFiles();
  assert.ok(files.length > 0, 'references/ should exist');
  for (const f of files) assert.ok(core.includes(`references/${f}`), `SKILL.md never points at references/${f}`);
  for (const [, f] of core.matchAll(/references\/([a-z0-9-]+\.md)/g)) assert.ok(files.includes(f), `SKILL.md points at missing references/${f}`);
});

test('the always-loaded SKILL.md stays small enough to survive long sessions', () => {
  const lines = skillCore().trimEnd().split('\n').length;
  assert.ok(lines <= 520, `SKILL.md grew to ${lines} lines; move detail into references/`);
});

test('storyteller v2 teaches the 2026-09 corpus-audit rules', () => {
  const flat = skillCorpus().replace(/\s+/g, ' ');
  for (const phrase of [
    'Read standing preferences',
    '.diffstory/preferences.json',
    'check-story.mjs --ledger',
    'Put the riskiest stop in the first third',
    'A landing is a clause, not a paragraph',
    'Say what changed in behavior, not in values',
    'why this and not the obvious alternative',
    'One concrete trace per logic change',
    'Vary the frame; keep it warm',
    'List up to three terms, roles, or states a newcomer would ask about',
    'Environment gaps',
    'RESULT: READY',
    'Keep the story fresh',
    'Record a move whenever logic changed home',
    'Open the goal on the problem, not on the diff',
    'this is function x, in file z, that y calls when w',
    'never a vague population',
    'a landing beat usually needs 20-40',
    'Landing field: record the same facts',
    'a vague caller cannot pass',
  ]) {
    assert.ok(flat.includes(phrase), `skill is missing: ${phrase}`);
  }
});

test('the skill schema example carries no Markdown residue', async () => {
  const { lintStory } = await import('../dist/story-lint.js');
  const example = JSON.parse(skillCorpus().split(/^## Schema$/m)[1].split('```jsonc')[1].split('```')[0]);
  assert.deepEqual(lintStory(example).filter((f) => f.rule === 'markdown-residue'), []);
});

test('change-type playbooks cover every storyArc changeType', () => {
  const ref = readFileSync(new URL('../skills/diffstory-storyteller/references/change-types.md', import.meta.url), 'utf8');
  for (const t of ['feature', 'bug-fix', 'refactor', 'security', 'performance', 'migration', 'maintenance', 'mixed']) {
    assert.match(ref, new RegExp(`^### ${t}$`, 'm'), `no playbook for ${t}`);
  }
});

test('both authoring prompts tell the agent to run the bundled checker until READY', () => {
  const p = storyPrompt('main');
  assert.ok(p.includes('scripts/check-story.mjs'));
  assert.ok(p.includes('RESULT: READY'));
  const repair = storyRepairPrompt({ action: 'rewrite', base: 'main', stepId: 's1' });
  assert.ok(repair.includes('scripts/check-story.mjs'));
  assert.ok(repair.includes("A step's FIRST beat lands the listener"));
  assert.ok(!repair.includes('short, informal'));
});
