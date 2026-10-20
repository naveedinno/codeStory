import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client/surfaces/review/engine/review-engine.js', import.meta.url), 'utf8');

function reloadHarness() {
  let now = 0, nextId = 0, reloads = 0;
  const timers = new Map();
  const toast = { hidden: true, classList: { add() {}, remove() {} }, contains(node) { return node === this; } };
  const context = vm.createContext({
    $: () => toast,
    document: { body: { classList: { add() {}, remove() {} } }, activeElement: null },
    Date: { now: () => now },
    location: { reload: () => reloads++ },
    requestAnimationFrame: callback => callback(),
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, deadline: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    toast() {},
  });
  const start = source.indexOf('  function hideStoryReloadToast()');
  const end = source.indexOf('  function setLiveIssue(', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext('var storyReloadTimer=null,storyReloadToastSequence=0,storyReloadRemaining=10000,storyReloadStarted=0,storyReloadHovered=false;\n' + source.slice(start, end), context);
  return {
    context, toast,
    call: code => vm.runInContext(code, context),
    get reloads() { return reloads; },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.deadline <= target).sort((a, b) => a[1].deadline - b[1].deadline)[0];
        if (!due) break;
        now = due[1].deadline; timers.delete(due[0]); due[1].callback();
      }
      now = target;
    },
  };
}

test('story auto-reload pauses during interaction and resumes only the remaining time', () => {
  const h = reloadHarness();
  h.call('scheduleStoryReload()');
  h.advance(4000);
  h.call('storyReloadHovered=true;pauseStoryReload()');
  h.advance(20000);
  assert.equal(h.reloads, 0);
  h.context.document.activeElement = h.toast;
  h.call('storyReloadHovered=false;resumeStoryReload()');
  h.advance(20000);
  assert.equal(h.reloads, 0, 'focus keeps the countdown paused after the pointer leaves');
  h.context.document.activeElement = null;
  h.call('resumeStoryReload()');
  h.advance(5999);
  assert.equal(h.reloads, 0);
  h.advance(1);
  assert.equal(h.reloads, 1);
});

test('cancelling a paused reload cannot restart a stale countdown', () => {
  const h = reloadHarness();
  h.call('scheduleStoryReload()');
  h.advance(1000);
  h.call('pauseStoryReload();cancelStoryReload();resumeStoryReload()');
  h.advance(20000);
  assert.equal(h.reloads, 0);
  assert.equal(h.toast.hidden, true);
});
