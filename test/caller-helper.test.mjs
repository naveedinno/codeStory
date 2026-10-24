import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateTour } from '../dist/tour.js';
import { buildReviewModel } from '../dist/view-model.js';
import { renderStoryStepPanel } from '../dist/render.js';
import { planStoryRefresh } from '../dist/story-refresh.js';
import { storyPrompt, codeStoryPrompt } from '../dist/agent.js';
import { codeStory, committedRepo } from './helpers/code-story-fixture.mjs';

export function pairedStory(sha, helperFile = 'app.ts') {
  const template = codeStory(sha).steps[0];
  return codeStory(sha, {
    hotspots: [{ step: 'guard', reason: 'The caller must not treat a successful classification as schedule readiness; I only checked the source.' }],
    steps: [
      { ...template, id: 'entry', order: 1, range: [8, 12], viewport: [4, 16], highlights: [[10, 10]],
        title: 'execute() chooses the route', landing: { symbol: 'execute()', role: { who: 'relayer' } },
        beats: [{ text: 'This is execute(), which asks the route guard before forwarding.', highlights: [[10, 10]] }] },
      { ...template, id: 'guard', order: 2, file: helperFile, range: [22, 26], viewport: [18, 30], highlights: [[24, 24]],
        title: 'checkRoute() rejects disabled targets', landing: { symbol: 'checkRoute()', calledBy: ['execute()'] },
        beats: [{ text: 'This is checkRoute(), which execute() calls before forwarding; disabled targets revert.', highlights: [[24, 24]] }],
        callSite: { step: 'entry', range: [10, 10], viewport: [6, 14] } },
    ],
  });
}

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('caller/helper anchors validate independently of JSON array order', () => {
  const story = pairedStory(SHA);
  assert.deepEqual(validateTour(story), []);
  story.steps.reverse();
  assert.deepEqual(validateTour(story), []);
  delete story.steps[0].callSite.viewport;
  assert.deepEqual(validateTour(story), []);
});

test('caller/helper anchors reject invalid links, crops, and versions', () => {
  const cases = [
    [s => s.steps[1].callSite = null, /callSite must be an object/],
    [s => s.steps[1].callSite.step = 'missing', /earlier code step/],
    [s => s.steps[1].callSite.step = 'guard', /earlier code step/],
    [s => s.steps[1].callSite.range = [0, 0], /callSite.range/],
    [s => s.steps[1].callSite.range = [4, 16], /at most 12 lines/],
    [s => s.steps[1].callSite.range = [17, 17], /inside the caller's viewport/],
    [s => s.steps[1].callSite.viewport = [1, 16], /inside the caller's viewport/],
    [s => s.steps[1].callSite.viewport = [11, 14], /inside callSite.viewport/],
    [s => s.steps[1].returnsTo = 'guard', /must match returnsTo/],
    [s => s.version = 3, /callSite requires story version 4/],
    [s => s.steps[0] = { id: 'entry', order: 1, kind: 'concept', title: 'Map', page: '<p>Map</p>', narration: 'A map.' }, /earlier code step/],
    [s => s.steps.push({ id: 'map', order: 3, kind: 'concept', title: 'Map', page: '<p>Map</p>', narration: 'A map.', callSite: { step: 'entry', range: [10, 10] } }), /callSite/],
  ];
  for (const [mutate, expected] of cases) {
    const story = pairedStory(SHA); mutate(story);
    const errors = validateTour(story);
    assert.ok(errors.some(error => expected.test(error)), errors.join('\n'));
  }
});

test('both source windows use the pinned revision, with isolated helper focus', () => {
  const repo = committedRepo();
  try {
    const story = pairedStory(repo.sha);
    const before = buildReviewModel(repo.dir, story, [], repo.sha);
    writeFileSync(join(repo.dir, 'app.ts'), 'UNCOMMITTED REPLACEMENT\n');
    const model = buildReviewModel(repo.dir, story, [], repo.sha);
    const helper = model.steps[1];
    assert.equal(helper.sceneLayout, 'caller-helper');
    assert.equal(helper.callSite.file, 'app.ts');
    assert.deepEqual(helper.callSite.blocks, before.steps[1].callSite.blocks);
    assert.deepEqual(helper.blocks, before.steps[1].blocks);
    assert.equal(helper.callSite.blocks[0][0].newNo, 6);
    assert.equal(helper.callSite.blocks[0].at(-1).newNo, 14);
    const html = renderStoryStepPanel(repo.dir, model, [], 1);
    const caller = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    assert.match(caller, /data-callsite-anchor/);
    assert.match(caller, /data-file="app.ts"/);
    assert.doesNotMatch(caller, /data-step-focus|data-speech-beat|UNCOMMITTED/);
    assert.match(html, /data-callsite-return="1"/);
    assert.match(html, /aria-controls="ds-story-diff-2-caller"/);
    assert.match(html, /Resize caller and helper panes/);
    assert.match(html, /data-step-focus="0"/);
    const lazy = buildReviewModel(repo.dir, story, [], repo.sha, { detailedStepIndexes: new Set() });
    assert.equal(lazy.steps[1].sceneLayout, 'caller-helper');
    assert.deepEqual(lazy.steps[1].callSite.blocks, []);
  } finally { rmSync(repo.dir, { recursive: true, force: true }); }
});

test('cross-file caller context follows refresh dependencies without optional landing or returnsTo', () => {
  const story = pairedStory(SHA, 'guard.ts');
  delete story.steps[0].landing; delete story.steps[1].landing;
  const plan = planStoryRefresh(story, [{ path: 'app.ts', inStory: true }]);
  assert.deepEqual(plan.stepIds, ['entry', 'guard']);
});

test('generation prompts ask for important helper depth and pin exact callSite fields', () => {
  const prompts = [storyPrompt('main', undefined, 'guided'), codeStoryPrompt({ commit: SHA, storyFile: '.codestory/stories/code-route.json', worktreeDiffers: [] })];
  for (const prompt of prompts) {
    assert.match(prompt, /important helpers' decisions and return consequences in normal spoken beats/);
    assert.match(prompt, /"callSite": \{"step":"earlier-caller-id","range":\[start,end\],"viewport":\[start,end\]\}/);
  }
});
