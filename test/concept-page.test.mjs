import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  conceptPageCsp,
  conceptPageDocument,
  CONCEPT_PAGE_CSP,
  CONCEPT_PAGE_CSP_OFFLINE,
} from '../dist/concept-page.js';
import { validateTour } from '../dist/tour.js';
import { buildReviewModel } from '../dist/view-model.js';

test('the shim goes first inside <head>, before any author markup', () => {
  const html = conceptPageDocument('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><script>var mine=1</script></head><body>x</body></html>', 'dark');
  const shim = html.indexOf('data-codestory-shim');
  assert.ok(shim > -1);
  assert.ok(shim < html.indexOf('http-equiv'), 'the shim precedes the author CSP meta');
  assert.ok(shim < html.indexOf('var mine'), 'and the author script');
  assert.match(html, /<html[^>]*data-ds-theme="dark"|setAttribute\('data-ds-theme'/);
});

test('a fragment with no <head> still gets the shim prepended', () => {
  const html = conceptPageDocument('<svg><circle r="4"/></svg>', 'light');
  assert.ok(html.indexOf('data-codestory-shim') < html.indexOf('<svg>'));
});

test('a headless page keeps its doctype first', () => {
  const html = conceptPageDocument('<!doctype html><body>x</body>', 'light');
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.indexOf('data-codestory-shim') < html.indexOf('<body>'));
});

test('a headless page with an <html> tag keeps doctype and <html> first', () => {
  const html = conceptPageDocument('<!DOCTYPE html>\n<html lang="en"><body>x</body></html>', 'dark');
  const htmlOpen = html.indexOf('<html lang="en">');
  assert.ok(htmlOpen > -1);
  const shim = html.indexOf('data-codestory-shim');
  assert.ok(shim > htmlOpen + '<html lang="en">'.length);
  assert.ok(shim < html.indexOf('<body>'));
});

test('an uppercase or attributed <HEAD> is found', () => {
  const html = conceptPageDocument('<HTML><HEAD lang="en"><TITLE>t</TITLE></HEAD><BODY></BODY></HTML>', 'light');
  assert.ok(html.indexOf('data-codestory-shim') > html.indexOf('<HEAD lang="en">'));
  assert.ok(html.indexOf('data-codestory-shim') < html.indexOf('<TITLE>'));
});

test('the shim skips text entry and handled keys and only trusts its parent', () => {
  const html = conceptPageDocument('<p>x</p>', 'light');
  assert.match(html, /defaultPrevented/);
  assert.match(html, /isContentEditable/);
  assert.match(html, /INPUT|TEXTAREA|SELECT/);
  assert.match(html, /e\.source!==parent|e\.source !== parent/);
  assert.match(html, /codestory:key/);
  assert.match(html, /codestory:theme/);
});

test('key forwarding is deferred so an author preventDefault still wins', () => {
  const html = conceptPageDocument('<p>x</p>', 'light');
  const setTimeoutAt = html.indexOf('setTimeout');
  assert.ok(setTimeoutAt > -1, 'the shim defers the forward');
  const defaultPreventedAt = html.indexOf('defaultPrevented');
  assert.ok(
    defaultPreventedAt > setTimeoutAt,
    'the defaultPrevented check runs inside the deferred callback, after dispatch completes',
  );
  const postMessageAt = html.indexOf('parent.postMessage');
  assert.ok(
    postMessageAt > defaultPreventedAt,
    'the forward itself also runs inside the deferred callback',
  );
});

test('theme tokens are optional variables authors can override', () => {
  const html = conceptPageDocument('<p>x</p>', 'dark');
  assert.match(html, /--ds-accent:/);
  assert.match(html, /:root\[data-ds-theme="light"\]/);
  assert.doesNotMatch(html, /--ds-bg:/, 'pages sit on the app background, so there is no page background token');
});

test('the page has no background of its own: the app background shows through', () => {
  const html = conceptPageDocument('<html><head><style>body{background:#fff}</style></head><body>x</body></html>', 'dark');
  const shimCss = html.slice(html.indexOf('<style data-codestory-shim>'), html.indexOf('</style>') + 8);
  assert.match(shimCss, /html,body\{background:transparent!important\}/);
  assert.ok(html.indexOf('data-codestory-shim') < html.indexOf('body{background:#fff}'), 'the shim is in place before author CSS');
});

test('the page color scheme follows the theme so the frame stays transparent', () => {
  // A frame whose color-scheme differs from its embedder gets an opaque backdrop.
  const html = conceptPageDocument('<p>x</p>', 'dark');
  assert.match(html, /:root\{color-scheme:dark!important;/);
  assert.match(html, /:root\[data-ds-theme="light"\]\{color-scheme:light!important;/);
});

test('the page CSP is permissive but only frameable by codeStory', () => {
  assert.match(CONCEPT_PAGE_CSP, /default-src \* data: blob: 'unsafe-inline' 'unsafe-eval'/);
  assert.match(CONCEPT_PAGE_CSP, /^sandbox allow-scripts(;|$)/, 'the page is sandboxed even when opened as a top-level document');
  assert.doesNotMatch(CONCEPT_PAGE_CSP, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
  assert.match(CONCEPT_PAGE_CSP, /frame-ancestors 'self'/);
});

test('pages are offline unless they opt into network', () => {
  assert.equal(conceptPageCsp(true), CONCEPT_PAGE_CSP);
  assert.equal(conceptPageCsp(false), CONCEPT_PAGE_CSP_OFFLINE);
  assert.equal(conceptPageCsp(undefined), CONCEPT_PAGE_CSP_OFFLINE);
  assert.match(CONCEPT_PAGE_CSP_OFFLINE, /default-src 'none'/);
  assert.doesNotMatch(CONCEPT_PAGE_CSP_OFFLINE, /default-src [^;]*\*/);
  assert.match(CONCEPT_PAGE_CSP_OFFLINE, /script-src 'unsafe-inline'/, 'inline scripts still run');
  assert.match(CONCEPT_PAGE_CSP_OFFLINE, /style-src 'unsafe-inline'/, 'inline styles still apply');
  assert.match(CONCEPT_PAGE_CSP_OFFLINE, /^sandbox allow-scripts(;|$)/);
  assert.doesNotMatch(CONCEPT_PAGE_CSP_OFFLINE, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
  assert.match(CONCEPT_PAGE_CSP_OFFLINE, /frame-ancestors 'self'/);
});

function pageStory(network) {
  return {
    version: 4,
    title: 'Page story',
    summary: 'A page concept first.',
    steps: [
      {
        id: 'page', order: 1, title: 'How it moves', kind: 'concept',
        page: '<html><body>x</body></html>', narration: 'Watch.',
        ...(network === undefined ? {} : { network }),
      },
      {
        id: 'code', order: 2, title: 'Readme', kind: 'changed',
        file: 'README.md', range: [1, 1], why: 'The heading changed.',
      },
    ],
  };
}

test('network is an optional boolean on page concepts only', () => {
  assert.deepEqual(validateTour(pageStory(undefined)), []);
  assert.deepEqual(validateTour(pageStory(true)), []);
  assert.deepEqual(validateTour(pageStory(false)), []);
  assert.ok(validateTour(pageStory('yes')).join('\n').includes('.network must be a boolean'));
  const body = pageStory(undefined);
  delete body.steps[0].page;
  body.steps[0].body = '<p>x</p>';
  body.steps[0].preparesFor = ['code'];
  body.steps[0].network = true;
  assert.ok(validateTour(body).join('\n').includes('.network is only allowed with page'));
});

test('the view model flags network pages for the badge', () => {
  const model = buildReviewModel('/repo', pageStory(true), []);
  assert.equal(model.steps[0].kind, 'concept');
  assert.equal(model.steps[0].network, true);
  const offline = buildReviewModel('/repo', pageStory(undefined), []);
  assert.equal(offline.steps[0].network, false);
});

// Run the real shim against a stub window: only story navigation keys leave
// the page, so a hostile or careless page cannot drive app shortcuts through
// its own keyboard events either.
function runShim() {
  const html = conceptPageDocument('<p>x</p>', 'dark');
  const script = html.match(/<script data-codestory-shim>([^]*?)<\/script>/)[1];
  const handlers = {};
  const posted = [];
  const context = vm.createContext({
    document: { documentElement: { setAttribute() {} } },
    window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    parent: { postMessage: (message) => posted.push(message) },
    setTimeout: (fn) => fn(),
  });
  vm.runInContext(script, context);
  const target = (tagName, extra = {}) => ({ tagName, isContentEditable: false, closest: () => null, ...extra });
  const press = (key, t = target('BODY'), extra = {}) => handlers.keydown({ key, code: '', target: t, isComposing: false, defaultPrevented: false, ...extra });
  return { posted, press, target };
}

test('the shim forwards only story navigation keys', () => {
  const s = runShim();
  for (const key of ['ArrowLeft', 'ArrowRight', 'j', 'k', ' ']) s.press(key);
  for (const key of ['?', '/', 'c', 'b', 'v', 'n', 'Escape', 'Tab', 'Enter', 'ArrowUp']) s.press(key);
  assert.deepEqual(s.posted.map((m) => m.key), ['ArrowLeft', 'ArrowRight', 'j', 'k', ' ']);
  assert.ok(s.posted.every((m) => m.type === 'codestory:key'));
});

test('the shim keeps keys the page handles or types', () => {
  const s = runShim();
  s.press('j', s.target('INPUT'));
  s.press('k', s.target('DIV', { isContentEditable: true }));
  s.press('ArrowRight', s.target('BODY'), { defaultPrevented: true });
  s.press(' ', s.target('BUTTON', { closest: () => ({}) }));
  assert.deepEqual(s.posted, [], 'text entry, preventDefault, and Space on a page control stay in the page');
});

test('the concept page sits directly on the step background, not in a card', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
  const rule = css.match(/\.ds-concept-page\{([^}]*)\}/)?.[1] ?? '';
  assert.ok(rule, 'the .ds-concept-page rule exists');
  assert.doesNotMatch(rule, /background:(?!transparent)/, 'no surface fill behind the page');
  assert.doesNotMatch(rule, /border:(?!0)/, 'no card border around the page');
  const frame = css.match(/\.ds-concept-page-frame\{([^}]*)\}/)?.[1] ?? '';
  assert.match(frame, /background:transparent/);
  assert.match(css, /\.ds-concept-page:fullscreen[^{]*\{[^}]*background:var\(--/, 'fullscreen still gets an app surface, not black');
});
