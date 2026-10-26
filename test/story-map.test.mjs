import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryMap } from '../dist/story-map.js';

const step = (id, order, chapter, kind = 'changed') => ({ id, order, chapter, kind,
  title: `Read <code>${id}</code>`, file: 'file.ts', range: [1, 3], why: 'Explain the change.',
  beats: [{ text: 'Start here.', highlights: [[1, 2]] }, { text: 'Then check this.', highlights: [[3, 3]] }] });

test('production map preserves step order, repeated chapters, and authored IDs without collisions', () => {
  const tour = { version: 4, title: 'A story', summary: 'Read <code>source</code>.',
    steps: [step('chapter-0', 3, 'Start'), step('root', 1, 'Start'), step('step-1', 2, 'Next')] };
  const before = JSON.stringify(tour), data = buildStoryMap(tour, 'base', 'head');
  assert.equal(JSON.stringify(tour), before);
  assert.equal(new Set(data.nodes.map(node => node.id)).size, data.nodes.length);
  assert.deepEqual(data.path.map(id => data.nodes.find(node => node.id === id).stepId), ['root', 'step-1', 'chapter-0']);
  const chapters = data.nodes.filter(node => node.structural === 'chapter');
  assert.deepEqual(chapters.map(node => node.label), ['Start', 'Next', 'Start']);
  assert.deepEqual(chapters.flatMap(node => node.children), data.path);
  const beat = data.nodes.find(node => node.id === 'step-2-beat-1');
  assert.equal(beat.stepId, 'step-1'); assert.equal(beat.panelIndex, 2); assert.equal(beat.beat, 1);
});

test('production media distinguishes actual diffs, source context and sandboxed pages', () => {
  const tour = { version: 4, title: 'Change', summary: '', steps: [step('change', 1, 'Change'),
    step('context', 2, 'Change', 'context'), { id: 'diagram', kind: 'concept', order: 3, title: 'Diagram', page: '<script>state()</script>' }] };
  const data = buildStoryMap(tour, 'base-sha');
  const diff = data.nodes.find(node => node.id === 'step-1').content[1];
  assert.equal(diff.type, 'diff'); assert.equal(diff.base, 'base-sha'); assert.equal(diff.head, 'Working tree');
  assert.deepEqual(diff.rangesByBeat, [[[1, 2]], [[3, 3]]]);
  assert.equal(data.nodes.find(node => node.id === 'step-2').content[1].type, 'code');
  assert.deepEqual(data.nodes.find(node => node.id === 'step-3').content, [{ type: 'page', viewerId: 'story-step-3', panelIndex: 3 }]);
  assert.ok(!JSON.stringify(data).includes('<script>'));
  const code = buildStoryMap({ ...tour, subject: 'code', steps: [step('source', 1, 'Source', 'context')] }, 'pinned', 'pinned');
  assert.equal(code.nodes.find(node => node.id === 'step-1').content[1].revision, 'pinned');
});
