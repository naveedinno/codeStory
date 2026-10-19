import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const engine = readFileSync(new URL('../client/surfaces/review/engine/review-engine.js', import.meta.url), 'utf8');

test('the engine points concept frames at the leased page endpoint with the theme', () => {
  assert.match(engine, /function mountConceptPages\(panel\)/);
  assert.match(engine, /reviewPageUrl\('\/api\/review\/concept-page\?index='/);
  assert.match(engine, /mountConceptPages\(fresh\)/, 'lazy panels mount their frame');
});

test('forwarded keys are accepted only from a concept frame window', () => {
  assert.match(engine, /function onConceptFrameMessage\(e\)/);
  assert.match(engine, /contentWindow===e\.source/);
  assert.match(engine, /d\.type!=='codestory:key'/);
  assert.match(engine, /window\.addEventListener\('message',onConceptFrameMessage\)/);
});

test('theme changes reach every mounted concept frame', () => {
  assert.match(engine, /function syncConceptPageTheme\(\)/);
  assert.match(engine, /type:'codestory:theme'/);
  assert.match(engine, /attributeFilter:\['data-theme'\]/);
});

// ---- behavior, not just shape ----------------------------------------------
// The frame bridge is a security boundary: any mounted concept page can post
// anything to the app window. Run the real engine functions against a small
// DOM stub and prove only a focused frame on the active step, pressing a story
// navigation key, ever reaches the key handler.

const fn = (name) => engine.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'))?.[0];
const keysDecl = engine.match(/  var CONCEPT_FRAME_KEYS=[^\n]*/)?.[0];

function bridge() {
  const win = (name) => ({ name });
  const frame = (w) => ({ contentWindow: w, tagName: 'IFRAME' });
  const activeWin = win('active'), hiddenWin = win('hidden');
  const activeFrame = frame(activeWin), hiddenFrame = frame(hiddenWin);
  const panels = [
    { frames: [], contains: (f) => false },
    { frames: [hiddenFrame], contains: (f) => f === hiddenFrame },
    { frames: [activeFrame], contains: (f) => f === activeFrame },
  ];
  const calls = [];
  const context = vm.createContext({
    stepPanels: panels,
    active: 2,
    document: { activeElement: activeFrame },
    $all: (selector, root) => (root ? root.frames : panels.flatMap((p) => p.frames)),
    onKey: (event) => calls.push(event),
  });
  assert.ok(keysDecl, 'the engine declares its concept key allowlist');
  vm.runInContext(keysDecl, context);
  for (const name of ['conceptFrameForMessage', 'onConceptFrameMessage']) {
    const source = fn(name);
    assert.ok(source, `${name} exists`);
    vm.runInContext(source, context);
  }
  const send = (source, key, extra = {}) => context.onConceptFrameMessage({ source, data: { type: 'codestory:key', key, ...extra } });
  return { context, calls, send, activeWin, hiddenWin, activeFrame, hiddenFrame };
}

test('a focused frame on the active step can press story navigation keys', () => {
  const b = bridge();
  for (const key of ['ArrowLeft', 'ArrowRight', 'j', 'k', ' ']) b.send(b.activeWin, key);
  assert.deepEqual(b.calls.map((e) => e.key), ['ArrowLeft', 'ArrowRight', 'j', 'k', ' ']);
  assert.equal(b.calls[0].target, b.activeFrame);
});

test('a frame that is not on the active step is ignored, even when focused', () => {
  const b = bridge();
  b.context.document.activeElement = b.hiddenFrame;
  b.send(b.hiddenWin, 'j');
  assert.equal(b.calls.length, 0);
});

test('an unfocused frame on the active step is ignored', () => {
  const b = bridge();
  b.context.document.activeElement = { tagName: 'BODY' };
  b.send(b.activeWin, 'j');
  assert.equal(b.calls.length, 0);
});

test('keys that change views, open tools, or write state are never replayed', () => {
  const b = bridge();
  for (const key of ['?', '/', 'c', 'C', 'b', 'v', 'V', 'n', 'p', '[', ']', 'Escape', 'Tab', 'Enter', 'ArrowUp', 'Home', 'constructor', 'toString', '__proto__']) b.send(b.activeWin, key);
  assert.equal(b.calls.length, 0);
});

test('an unknown window or malformed message is ignored', () => {
  const b = bridge();
  b.send({ name: 'stranger' }, 'j');
  b.context.onConceptFrameMessage({ source: b.activeWin, data: { type: 'other', key: 'j' } });
  b.context.onConceptFrameMessage({ source: b.activeWin, data: { type: 'codestory:key', key: 7 } });
  b.context.onConceptFrameMessage({ source: b.activeWin, data: null });
  assert.equal(b.calls.length, 0);
});

test('a forged key code cannot turn an allowed key into another shortcut', () => {
  const b = bridge();
  b.send(b.activeWin, 'j', { code: 'Space' });
  b.send(b.activeWin, ' ', { code: 'KeyC' });
  assert.deepEqual(b.calls.map((e) => [e.key, e.code]), [['j', ''], [' ', 'Space']]);
});

test('the engine accepts exactly the keys the page shim forwards', async () => {
  const { CONCEPT_PAGE_KEYS } = await import('../dist/concept-page.js');
  const context = vm.createContext({});
  vm.runInContext(keysDecl, context);
  assert.deepEqual([...context.CONCEPT_FRAME_KEYS], [...CONCEPT_PAGE_KEYS]);
});

// ---- frame lifetime ----------------------------------------------------------
// A concept page may run timers, audio, or WebGL. Only the active step's page
// may be loaded; leaving the step unloads it, returning loads it again, and a
// page that finishes loading after a theme change still gets the current theme.

function lifetime() {
  const posted = [];
  const classSet = () => {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  };
  const makeFrame = (index, figure, panel) => {
    const listeners = {};
    const attrs = { 'data-concept-frame': '', 'data-concept-index': String(index) };
    const frame = {
      figure, panel, listeners,
      contentWindow: { postMessage: (message) => posted.push([index, message]) },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      removeAttribute: (name) => { delete attrs[name]; },
      get src() { return attrs.src ?? ''; },
      set src(value) { attrs.src = value; },
      cloneNode: () => {
        const copy = makeFrame(index, figure, panel);
        if ('src' in attrs) copy.src = attrs.src;
        return copy;
      },
      replaceWith: (other) => { panel.frames[panel.frames.indexOf(frame)] = other; },
    };
    return frame;
  };
  const panels = [1, 2, 3].map((index) => {
    const panel = { frames: [] };
    const figure = { classList: classSet() };
    panel.frames.push(makeFrame(index, figure, panel));
    panel.contains = (node) => node === panel || panel.frames.includes(node);
    return panel;
  });
  const html = { theme: 'dark', getAttribute: () => (html.theme === 'light' ? 'light' : 'dark') };
  const context = vm.createContext({
    stepPanels: panels,
    active: 0,
    document: { documentElement: html, fullscreenElement: null },
    $all: (selector, root) => (root && root.frames ? root.frames : panels.flatMap((p) => p.frames)),
    closest: (node, selector) => (selector === '[data-concept-page]' ? node.figure : null),
    reviewPageUrl: (path) => path,
  });
  vm.runInContext(engine.match(/  function conceptPageTheme\(\)[^\n]*/)[0], context);
  for (const name of ['mountConceptPages', 'unloadConceptPages']) {
    const source = fn(name);
    assert.ok(source, `${name} exists`);
    vm.runInContext(source, context);
  }
  const activate = (i) => {
    context.active = i;
    context.unloadConceptPages(panels[i]);
    context.mountConceptPages(panels[i]);
  };
  return { context, panels, posted, html, activate, frame: (i) => panels[i].frames[0] };
}

test('only the active step loads its concept page', () => {
  const t = lifetime();
  t.activate(1);
  assert.match(t.frame(1).src, /\/api\/review\/concept-page\?index=2&theme=dark/);
  assert.equal(t.frame(0).src, '');
  assert.equal(t.frame(2).src, '');
  t.context.mountConceptPages({ frames: t.panels.flatMap((p) => p.frames) });
  assert.equal(t.frame(2).src, '', 'a prefetched or theme-wide mount never loads an off-step page');
});

test('leaving a step unloads its page and returning loads it again', () => {
  const t = lifetime();
  t.activate(1);
  t.frame(1).listeners.load();
  assert.ok(t.frame(1).figure.classList.contains('is-loaded'));
  const running = t.frame(1);
  t.activate(2);
  assert.notEqual(t.frame(1), running, 'the running page is torn down');
  assert.equal(t.frame(1).src, '', 'and its replacement never loads');
  assert.ok(!t.frame(1)._dsMounted);
  assert.ok(!t.frame(1).figure.classList.contains('is-loaded'), 'the loading line comes back');
  assert.match(t.frame(2).src, /index=3/);
  t.activate(1);
  assert.match(t.frame(1).src, /index=2/, 'returning remounts the page');
  assert.equal(t.frame(2).src, '', 'and unloads the one left behind');
});

test('a page that loads after a theme change gets the current theme', () => {
  const t = lifetime();
  t.activate(1);
  t.html.theme = 'light';
  t.frame(1).listeners.load();
  assert.deepEqual(JSON.parse(JSON.stringify(t.posted)), [[2, { type: 'codestory:theme', theme: 'light' }]]);
});

test('step activation unloads off-step pages before mounting the active one', () => {
  assert.match(engine, /unloadConceptPages\(ap\);if\(ap\)mountConceptPages\(ap\);/);
});

// ---- fullscreen control --------------------------------------------------------

function fullscreen() {
  const calls = [];
  const attrs = {};
  const classes = new Set();
  const button = { setAttribute: (name, value) => { attrs[name] = value; } };
  const figure = {
    requestFullscreen: () => { calls.push('request'); return Promise.resolve(); },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  button.figure = figure;
  const context = vm.createContext({
    document: {
      fullscreenElement: null,
      exitFullscreen: () => { calls.push('exit'); return Promise.resolve(); },
    },
    $all: () => [button],
    closest: (node, selector) => (selector === '[data-concept-page]' ? node.figure : null),
  });
  for (const name of ['syncConceptPageFullscreen', 'toggleConceptPageFullscreen']) {
    const source = fn(name);
    assert.ok(source, `${name} exists`);
    vm.runInContext(source, context);
  }
  return { context, calls, attrs, classes, button, figure };
}

test('the page fullscreen button opens, then exits, and says which', () => {
  const f = fullscreen();
  f.context.toggleConceptPageFullscreen(f.button);
  assert.deepEqual(f.calls, ['request']);
  f.context.document.fullscreenElement = f.figure;
  f.context.syncConceptPageFullscreen();
  assert.equal(f.attrs['aria-pressed'], 'true');
  assert.equal(f.attrs['aria-label'], 'Exit page fullscreen');
  assert.ok(f.classes.has('is-fullscreen-active'));
  f.context.toggleConceptPageFullscreen(f.button);
  assert.deepEqual(f.calls, ['request', 'exit'], 'clicking while fullscreen exits');
  f.context.document.fullscreenElement = null;
  f.context.syncConceptPageFullscreen();
  assert.equal(f.attrs['aria-pressed'], 'false');
  assert.equal(f.attrs['aria-label'], 'Open page fullscreen');
  assert.ok(!f.classes.has('is-fullscreen-active'));
});

test('fullscreen changes keep the page button in sync', () => {
  assert.match(engine, /document\.addEventListener\('fullscreenchange',syncConceptPageFullscreen\)/);
});

test('the concept page heading stacks the eyebrow over the title', () => {
  const css = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.ds-concept-page-stage .ds-concept-heading{flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:8px;margin-bottom:0}'));
  assert.ok(!css.includes('.ds-concept-page-stage .ds-concept-title{margin:0}'), 'the redundant title reset is gone');
});
