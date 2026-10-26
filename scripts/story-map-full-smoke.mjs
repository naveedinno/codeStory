// Full authored tour: lazy media, chapter navigation and the native page bridge.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';

const url = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json&scope=full&variant=A';
const output = resolve(process.env.CODESTORY_MAP_FULL_OUT || '/tmp/codestory-full-tour-qa');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  const cases = process.env.CODESTORY_MAP_FULL_PLAYBACK_ONLY ? [] : [['A', 1440, 'no-preference'], ['A', 390, 'no-preference'], ['A', 320, 'reduce'], ['B', 1440, 'reduce'], ['C', 1440, 'reduce']];
  for (const [variant, width, motion] of cases) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'dark', reducedMotion: motion });
    page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/_prototype/viewer?')) requests.push(request.url()); });
    const target = new URL(url); target.searchParams.set('variant', variant); target.searchParams.set('scope', 'full');
    await page.goto(target.href);
    await page.locator('.sm-prototype').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="1"]:not([hidden]):not([data-step-lazy])'));
    const { nodes, path } = await (await page.request.get(new URL('/_prototype/map.json?scope=full', url).href)).json();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const parent = new Map(nodes.flatMap(node => node.children.map(id => [id, node])));
    const ancestors = id => parent.has(id) ? [...ancestors(parent.get(id).id), parent.get(id)] : [];
    const selected = id => page.waitForFunction(id => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === id, id);
    const key = async (value, id) => { await page.keyboard.press(value); await selected(id); };
    const visit = async id => {
      await page.locator('.sm-map [data-map-focus][aria-current]').focus();
      await key('Home', 'root');
      for (const node of [...ancestors(id), byId.get(id)].slice(1)) {
        const siblings = parent.get(node.id).children;
        await key('ArrowRight', siblings[0]);
        for (let i = 1; i <= siblings.indexOf(node.id); i++) await key('ArrowDown', siblings[i]);
      }
      await page.waitForTimeout(motion === 'reduce' ? 150 : 750);
    };
    const changeLayout = async next => {
      await page.getByRole('button', { name: 'Map options', exact: true }).click();
      await page.getByRole('combobox', { name: 'Map layout', exact: true }).selectOption(next);
      await page.getByRole('button', { name: 'Close map options', exact: true }).click();
      await page.waitForTimeout(200);
    };
    assert.equal(path.length, 129);
    assert.equal(nodes.filter(node => node.structural === 'chapter').length, 32);
    assert.equal(nodes.filter(node => node.structural === 'section').length, 7);
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
    assert.equal(requests.length, 0, 'overview does not fetch any embedded viewer');
    await selected('root');
    assert.equal(await page.locator('body').getAttribute('data-prototype-reading-path'), Array.from({ length: 129 }, (_, i) => i + 1).join(','));
    await page.screenshot({ path: resolve(output, `${variant}-${width}-overview.png`) });

    await visit('map-doors');
    const frameSelector = '[data-map-native-viewer="story-map-doors"] iframe';
    const frame = async () => (await page.locator(frameSelector).elementHandle()).contentFrame();
    await page.locator(frameSelector + '[src]').waitFor();
    await (await frame()).locator('[data-route="deposit"]').click();
    await (await frame()).evaluate(() => { window.__mapDiagramState = 42; });
    await (await frame()).locator('body').press('f');
    await page.locator('.sm-focus-dialog.is-fullscreen[open]').waitFor();
    assert.equal(await (await frame()).evaluate(() => window.__mapDiagramState), 42);
    await (await frame()).locator('body').press('Escape');
    await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    assert.equal(await (await frame()).evaluate(() => window.__mapDiagramState), 42);
    await page.getByRole('button', { name: 'Expand card', exact: true }).click();
    await page.locator('.sm-focus-dialog[open]').waitFor();
    await (await frame()).locator('[data-route="deposit"]').click();
    await (await frame()).locator('body').press('Escape');
    await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    assert.equal(await (await frame()).evaluate(() => window.__mapDiagramState), 42, 'ordinary Focus Escape closes the dialog and retains the interactive page');
    await changeLayout(variant === 'B' ? 'C' : 'B');
    assert.equal(await (await frame()).evaluate(() => window.__mapDiagramState), 42, 'layout handoff preserves the live iframe browsing context');
    assert.equal(await (await frame()).locator('[data-route="deposit"]').getAttribute('aria-pressed'), 'true');
    await changeLayout(variant);
    await page.screenshot({ path: resolve(output, `${variant}-${width}-diagram.png`) });

    await visit('b-relayable');
    const viewer = page.locator('[data-map-native-viewer="story-b-relayable"]');
    await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(300);
    const code = viewer.locator('.ds-helper-scroll');
    await code.focus(); await code.evaluate(node => { window.fullStoryPane = node; node.scrollTop = 100; });
    await page.keyboard.press('ArrowDown');
    await selected('b-relayable');
    await page.keyboard.press('f'); await page.locator('.sm-focus-dialog.is-fullscreen[open]').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('.sm-focus-dialog .ds-helper-scroll') === window.fullStoryPane), true);
    await page.keyboard.press('Escape'); await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    assert.equal(await code.evaluate(node => node === window.fullStoryPane), true);
    await page.keyboard.press('Escape');
    await selected('b-relayable');
    await page.screenshot({ path: resolve(output, `${variant}-${width}-code.png`) });
    const back = viewer.locator('[data-callsite-return]');
    await back.focus(); await back.click(); await selected('b-execute-call');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('body').getAttribute('data-prototype-reading-path'), String(byId.get('b-execute-call').panelIndex));

    await visit(path.at(-1));
    await page.keyboard.press('ArrowDown'); await selected(path.at(-1));
    assert.equal(await page.locator('.sm-map [data-map-focus][aria-current]').getAttribute('data-map-focus'), path.at(-1));
    assert.deepEqual(errors, []);
    console.log(`PASS ${variant}/${width}/${motion}: 129 steps, lazy viewers, diagrams/F/Escape/layout state, native code/caller return and final boundary`);
    await page.close();
  }

  // Drive the real playback controller with a silent local status fixture.
  // This verifies selection/scope, not audible synthesis or Lino availability.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let batches = [], running = false, paused = false, current = 1;
  const status = () => ({ service: 'aloud-speech-daemon', protocolVersion: 2, engine: 'fixture', jobId: 'full-map-fixture', running, paused,
    state: { status: running ? 'reading' : 'idle', current, total: batches.length } });
  await page.route('**/api/aloud/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    if (action === 'speak') { batches = body.batches; running = true; paused = false; }
    if (action === 'control') { if (body.action === 'stop') running = false; paused = body.action === 'pause'; }
    await route.fulfill({ json: status() });
  });
  await page.goto(url); await page.locator('.sm-prototype').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-step-panel="1"]:not([hidden]):not([data-step-lazy])'));
  await page.locator('[data-readaloud]').click();
  await page.waitForFunction(() => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === 'map-one-trade');
  await page.getByRole('button', { name: 'Expand card', exact: true }).click();
  await page.locator('.sm-focus-dialog[open]').waitFor();
  assert.ok(batches.length > 129, 'whole-tour playback queues the authored explanations, not just the first chapter');
  current = batches.length;
  await page.waitForFunction(() => document.querySelector('.sm-playback-label small')?.textContent === 'Step 129/129');
  const full = await (await page.request.get(new URL('/_prototype/map.json?scope=full', url).href)).json();
  const lastTitle = full.nodes.find(node => node.id === full.path.at(-1)).label;
  assert.ok((await page.locator('#sm-focus-title').innerText()).includes(lastTitle), 'Focus follows playback into the last authored card');
  assert.equal((await page.locator('body').getAttribute('data-prototype-reading-path')).split(',').length, 129, 'narration progress preserves the whole-tour scope');
  await page.getByRole('dialog').getByRole('button', { name: 'Pause narration', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume narration', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Resume narration', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pause narration', exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Stop narration', exact: true }).click();
  assert.equal(running, false);
  console.log('PASS full-tour mocked playback: folder handoff, authored queue, final-card/Focus synchronization, scope and Pause/Resume/Stop');
  await page.close();
} finally { await browser.close(); }
