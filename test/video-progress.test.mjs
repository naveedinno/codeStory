import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoProgressEstimate, videoEncodingProgress } from '../dist/video-progress.js';

test('video ETA learns from completed work, counts down, and revises when processing speed changes', () => {
  let time=1000;
  const estimate=new VideoProgressEstimate(()=>time);
  assert.equal(estimate.fraction(),null);
  assert.equal(estimate.remainingMs(),null);
  estimate.update('rendering',0,10);
  assert.equal(estimate.fraction(),0);
  assert.equal(estimate.remainingMs(),null,'warm-up has no measured throughput');
  time=3000;estimate.update('rendering',1,10);
  assert.equal(estimate.remainingMs(),18000);
  time=4000;
  assert.equal(estimate.remainingMs(),17000,'time counts down between progress samples');
  estimate.update('rendering',1,10);
  assert.equal(estimate.remainingMs(),17000,'message-only updates do not distort the rate');
  time=5000;estimate.update('rendering',2,10);
  assert.equal(estimate.remainingMs(),16000);
  time=7000;estimate.update('rendering',4,10);
  assert.equal(estimate.remainingMs(),10200,'recent faster work revises the estimate');
  assert.equal(estimate.fraction(),0.4);
});

test('encoding starts its own measurement and an overdue estimate never reports zero', () => {
  let time=0;
  const estimate=new VideoProgressEstimate(()=>time);
  estimate.update('rendering',0,4);
  time=1000;estimate.update('rendering',1,4);
  time=5000;
  assert.equal(estimate.remainingMs(),null,'a stalled voice needs a fresh estimate');
  estimate.update('encoding',0,1);
  assert.equal(estimate.fraction(),0);
  assert.equal(estimate.remainingMs(),null,'generation speed is not encoding speed');
  time=7000;estimate.update('encoding',0.25,1);
  assert.equal(estimate.remainingMs(),6000);
  time=8000;
  assert.equal(estimate.remainingMs(),5000);
  estimate.update('encoding',1.1,1);
  assert.equal(estimate.fraction(),1,'encoder timestamp rounding is clamped');
  assert.equal(estimate.remainingMs(),null,'completion is a state rather than a fake zero countdown');
});

test('invalid and unknown progress never produce negative or non-finite estimates', () => {
  const estimate=new VideoProgressEstimate(()=>1000);
  for(const [completed,total] of [[NaN,1],[0,Infinity],[0,-1]])estimate.update('rendering',completed,total);
  assert.equal(estimate.fraction(),null);
  estimate.update('rendering',0,0);
  assert.equal(estimate.remainingMs(),null);
  estimate.update('rendering',-1,5);
  assert.equal(estimate.fraction(),0);
  assert.equal(estimate.remainingMs(),null);
});

test('FFmpeg progress parses split frame counts and ignores audio/subtitle timestamps that run ahead', () => {
  const values=[];
  const progress=videoEncodingProgress(value=>values.push(value));
  progress('out_time_us=12000000\nframe=1');
  assert.deepEqual(values,[]);
  progress('5\r\nspeed=1.5x\nframe=N/A\nframe=-1\n');
  progress('frame=30\nout_time_us=30000000\nprogress=end\n');
  assert.deepEqual(values,[15,30]);
});
