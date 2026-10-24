import test from 'node:test';
import assert from 'node:assert/strict';
import { videoNarrationBatches, videoNarrationTimings } from '../dist/video-narration.js';
import { videoScenes } from '../dist/video-export.js';

const prose = text => ({text});
const captions = text => videoScenes({story:{title:prose('A story'),summary:prose(text)},steps:[]});

test('one speech batch spans short captions, code focus changes and whole sentences', () => {
  const text = 'A sentence that continues across a caption boundary without restarting the narrator '.repeat(6) + 'ends here.';
  const scenes = [...captions(text),{step:1,group:2,text:'Now follow the code.'}];
  assert.ok(scenes.length > 2);
  const batches = videoNarrationBatches(scenes);
  assert.equal(batches.length,1);
  assert.equal(batches[0].text,scenes.map(scene=>scene.text).join(' '));
  assert.equal(batches[0].end,batches[0].text.length);
});

test('long narration packs complete sentences up to the synthesis limit without dropping words', () => {
  const sentences = Array.from({length:80},(_,index)=>`Sentence ${index} explains why the request moves through the shared policy before the order is accepted.`);
  const scenes = captions(sentences.join(' '));
  const text = scenes.map(scene=>scene.text).join(' ');
  const batches = videoNarrationBatches(scenes);
  assert.ok(batches.length > 1);
  assert.ok(batches.length < scenes.length / 5);
  assert.equal(batches.map(batch=>batch.text).join(' '),text);
  for (const [index,batch] of batches.entries()) {
    assert.ok(batch.text.length <= 3500);
    if (index < batches.length - 1) assert.ok(batch.text.length > 3000);
    assert.ok(batch.text.endsWith('.'),'batch ends at a sentence boundary');
    assert.equal(text.slice(batch.start,batch.end),batch.text);
  }
});

test('oversized sentences split only at words and oversized identifiers fail explicitly', () => {
  const scenes = captions(Array.from({length:1600},(_,i)=>`word${i}`).join(' '));
  const batches = videoNarrationBatches(scenes);
  assert.equal(batches.map(batch=>batch.text).join(' '),scenes.map(scene=>scene.text).join(' '));
  assert.ok(batches.every(batch=>batch.text.length<=3500));
  assert.throws(()=>videoNarrationBatches([{text:'x'.repeat(3501)}]),/word exceeds 3,500/);
  assert.deepEqual(videoNarrationBatches([]),[]);
});

test('caption clocks follow measured speech batches and playback speed with only one final tail', () => {
  const scenes = [{text:'First.'},{text:'Second.'},{text:'Third.'}];
  const text = scenes.map(scene=>scene.text).join(' ');
  const batches = [{text:'First. Second.',start:0,end:14},{text:'Third.',start:15,end:text.length}];
  const ends = videoNarrationTimings(scenes,batches,[14,6],10);
  assert.deepEqual(ends,[3000,7000,10600]);
  const whole = videoNarrationBatches(scenes);
  assert.equal(videoNarrationTimings(scenes,whole,[20],10).at(-1),10600,'padding is independent of caption count');
});

test('captions spanning a speech batch share one continuous, frame-aligned clock', () => {
  const scenes = [{text:'One two three four.'},{text:'Five six.'},{text:'Seven.'}];
  const batches = [{text:'One two',start:0,end:7},{text:'three four. Five six. Seven.',start:8,end:scenes.map(scene=>scene.text).join(' ').length}];
  const ends = videoNarrationTimings(scenes,batches,[1,3],4);
  assert.equal(ends.at(-1),4600);
  let previous = 0;
  for (const end of ends) { assert.ok(end>previous); assert.equal(end%40,0); previous=end; }
  const tiny = videoNarrationTimings([{text:'A'},{text:'B'},{text:'C'}],[{text:'A B C',start:0,end:5}],[0.1],0.1);
  assert.equal(tiny.at(-1),720);
  assert.ok(tiny.every((end,index)=>end>(tiny[index-1]??0)));
  for (const [seconds,audio] of [[[0],1],[[NaN],1],[[1],0],[[],1]])
    assert.throws(()=>videoNarrationTimings(scenes,[batches[0]],seconds,audio),/measure/);
});
