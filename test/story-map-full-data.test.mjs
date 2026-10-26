import {test} from 'node:test';import assert from 'node:assert/strict';
import {fullStoryMap} from '../scripts/story-map-full-data.mjs';
import {readFileSync} from 'node:fs';
import {validateTour, validateNewGeneratedStory} from '../dist/tour.js';
const fixture=()=>({title:'Original tour',summary:'An <code>authored</code> summary.',head:'abc123',steps:[
 {id:'diagram',order:1,kind:'concept',chapter:'Start',title:'A diagram',page:'<html><script>interactive()</script></html>',narration:'Authored speech'},
 {id:'one',order:2,kind:'context',chapter:'Start',title:'The <code>one()</code> function',file:'one.sol',landing:{symbol:'one()'},beats:[{text:'Introduction',highlights:[[1,2]]},{text:'A <code>check</code> fails before spending.',highlights:[[3,4]]}]},
 {id:'two',order:3,kind:'context',chapter:'Finish',title:'The last function',file:'two.sol',beats:[{text:'The end.',highlights:[[5,6]]}]},
]});
test('full map covers every authored step in order and never changes the story',()=>{const story=fixture(),before=JSON.stringify(story);const {data,viewers}=fullStoryMap(story);assert.deepEqual(data.path,['diagram','one','two']);assert.equal(viewers.size,3);assert.equal(new Set(data.nodes.map(x=>x.id)).size,data.nodes.length);assert.equal(data.nodes.filter(x=>!x.structural&&x.beat===0).length,3);assert.equal(JSON.stringify(story),before);});
test('sections and chapters own authored code cards while narration stays inside its source',()=>{const {data}=fullStoryMap(fixture());const code=data.nodes.find(x=>x.id==='one');assert.equal(code.panelIndex,2);assert.equal(code.stepId,'one');assert.equal(code.beats,2);assert.deepEqual(code.children,[]);assert.deepEqual(code.content[1].rangesByBeat,[[[1,2]],[[3,4]]]);assert.equal(data.nodes.some(x=>x.id==='one-beat-1'),false);assert.ok(data.nodes.some(x=>x.structural==='chapter'&&x.children.includes('one')));assert.ok(data.nodes.every(x=>x.id==='root'||data.nodes.some(p=>p.children.includes(x.id))));});
test('authored HTML pages remain leased native viewer content, never injected into map metadata',()=>{const {data,viewers}=fullStoryMap(fixture());assert.deepEqual(data.nodes.find(x=>x.id==='diagram').content,[{type:'page',viewerId:'story-diagram',panelIndex:1}]);assert.equal(viewers.get('story-diagram'),0);assert.ok(!JSON.stringify(data).includes('<script>'));});

test('the map-authoring example validates and retains native media and in-card narration', () => {
  const reference = readFileSync(new URL('../skills/codestory-storyteller/references/map-stories.md', import.meta.url), 'utf8');
  const story = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(reference)[1]);
  assert.deepEqual(validateTour(story), []);
  assert.deepEqual(validateNewGeneratedStory(story), []);
  const before = JSON.stringify(story);
  const {data, viewers} = fullStoryMap(story);
  assert.deepEqual(data.path, ['card-and-viewer', 'card-hierarchy', 'adapter']);
  assert.equal(data.nodes.find(n => n.id === 'card-and-viewer').content[0].type, 'page');
  assert.equal(data.nodes.find(n => n.id === 'card-hierarchy').content[0].type, 'page');
  const code = data.nodes.find(n => n.id === 'adapter');
  assert.equal(code.content[1].type, 'code');
  assert.equal(code.content[1].revision, story.head);
  assert.deepEqual(code.children, []);
  assert.equal(code.beats, story.steps.find(step => step.id === 'adapter').beats.length);
  assert.deepEqual(code.content[1].rangesByBeat, story.steps.find(step => step.id === 'adapter').beats.map(beat => beat.highlights ?? []));
  assert.equal(viewers.size, 3);
  assert.equal(JSON.stringify(story), before);
});
