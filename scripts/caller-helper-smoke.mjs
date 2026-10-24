// Real-browser regression for authored invocation context. Uses the same local
// Playwright workflow as browser-smoke.mjs, with a disposable demo and app home.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../dist/server.js';
import { loadTour } from '../dist/tour.js';
import { videoCapabilities, videoScenes } from '../dist/video-export.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'codestory-caller-helper-'));
const repo = join(scratch, 'repo');
const output = resolve(process.env.CODESTORY_CALLER_HELPER_OUT || join(scratch, 'screenshots'));
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [join(root, 'examples/demo.mjs')], {
  cwd: root, env: { ...process.env, CODESTORY_DEMO_NO_SERVE: '1', CODESTORY_DEMO_DIR: repo }, stdio: 'pipe',
});
const path = join(repo, '.codestory/story.json');
const story = JSON.parse(readFileSync(path, 'utf8'));
story.version = 4;
const crossFile = story.steps.find(step => step.id === 's2');
delete crossFile.moves;
crossFile.callSite = { step: 's1', range: [9, 9], viewport: [5, 16] };
const caller = story.steps.find(step => step.id === 's4');
story.steps.splice(story.steps.indexOf(caller) + 1, 0, {
  id: 'same-file-helper', kind: 'context', title: 'recordSpend() logs the accepted amount',
  file: 'src/orders.ts', range: [10, 13], viewport: [8, 13], highlights: [[10, 13]],
  why: 'The helper logs the accepted amount; it does not persist a new budget.',
  landing: { symbol: 'recordSpend()', calledBy: ['placeOrder()'] },
  beats: [{ text: 'This is recordSpend(), which placeOrder() calls after storing the order; it logs the amount without persisting a new budget.', highlights: [[10, 13]] }],
  callSite: { step: 's4', range: [6, 6] }, returnsTo: 's4',
});
story.steps.forEach((step, i) => { step.order = i + 1; });
writeFileSync(path, JSON.stringify(story)); loadTour(path);
let status = { ok: true, service: 'aloud-speech-daemon', protocolVersion: 2, engine: 'kokoro', voice: 'af_heart', rate: 1, running: false, paused: false, state: {} };
const spoken = [];
const server = serve({ repo, homeOverride: join(scratch, 'home'), port: 0, open: false, aloud: {
  async status() { return status; }, async prepare() {},
  async speak(input) { spoken.push(input); status = { ...status, running: true, jobId: 'fixture', state: { status: 'reading', current: 0, total: input.batches?.length ?? 1 } }; return status; },
  async control(action) { status = { ...status, running: action === 'resume', paused: action === 'pause', state: {} }; return status; },
} });
await once(server, 'listening');
const url = `http://localhost:${server.address().port}/repo/${basename(repo)}/review?story=story.json`;
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
let page;
try {
  for (const [name, viewport, reducedMotion] of [
    ['desktop', { width: 1440, height: 900 }, 'no-preference'],
    ['mobile', { width: 390, height: 844 }, 'reduce'],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion, colorScheme: 'dark' });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let releasePrefetch;
    const prefetch = new Promise(resolve => { releasePrefetch = resolve; });
    await page.route('**/api/review/step-panel?index=4&*', async route => { await prefetch; await route.continue(); });
    await page.goto(url);
    await page.locator('.ds-intro-start').waitFor();
    const go = async index => {
      await page.locator(`[data-thread-node='${index}']`).evaluate(node => node.click());
      await page.locator(`[data-step-panel='${index}']:not([data-step-lazy]):not([hidden])`).waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-story-scroll-pending'));
    };
    const pair = page.locator('.ds-step:not([hidden]) [data-code-pair]');
    // A direct helper visit exercises lazy rendering without first visiting its caller.
    await go(3);
    await pair.waitFor();
    assert.match(await pair.locator('.ds-callsite-path').innerText(), /src\/api.ts/);
    assert.match(await pair.locator('.ds-helper-scroll').innerText(), /src\/limits.ts/);
    assert.equal(await pair.locator('.ds-callsite-pane [data-step-focus]').count(), 0);
    const payload = await page.locator('#__CODESTORY_DATA__').evaluate(node => JSON.parse(node.textContent));
    const helperScenes = videoScenes(payload).filter(scene => scene.step === 3);
    assert.ok(helperScenes.some(scene => scene.text.includes('remaining budget')));
    assert.ok(helperScenes.some(scene => scene.text.includes('checkSpendingLimit()')));
    const callerScroll = pair.locator('.ds-callsite-scroll');
    const anchor = pair.locator('[data-callsite-anchor]');
    const initialScroll = await callerScroll.evaluate(node => node.scrollTop);
    const anchorVisible = await anchor.evaluate(node => { const a = node.getBoundingClientRect(), s = node.closest('.ds-callsite-scroll').getBoundingClientRect(); return a.top < s.bottom && a.bottom > s.top; });
    assert.equal(anchorVisible, true, 'the invocation is visible after activation');
    const deliberateScroll = await callerScroll.evaluate(node => { node.style.maxHeight = '120px'; node.scrollTop = 40; return node.scrollTop; });
    assert.ok(deliberateScroll > 0, 'the caller fixture can scroll');
    releasePrefetch();
    await page.locator('[data-step-panel="4"]:not([data-step-lazy])').waitFor({ state: 'attached' });
    assert.equal(await callerScroll.evaluate(node => node.scrollTop), deliberateScroll, 'a completed prefetch does not re-center an independently scrolled caller');
    await callerScroll.evaluate((node, top) => { node.scrollTop = top; }, initialScroll);
    if (name === 'desktop') {
      const divider = pair.getByRole('separator'); await divider.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await divider.getAttribute('aria-valuenow'), '44');
      const box = await divider.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 50); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 50); await page.mouse.up();
      assert.ok(Number(await divider.getAttribute('aria-valuenow')) > 44, 'pointer resizing changes the split');
      await pair.locator('[data-line-wrap-toggle]').click();
      await divider.focus(); await page.keyboard.press('End'); await page.keyboard.press('Home');
      const stillVisible = await anchor.evaluate(node => { const a = node.getBoundingClientRect(), s = node.closest('.ds-callsite-scroll').getBoundingClientRect(); return a.top < s.bottom && a.bottom > s.top; });
      assert.equal(stillVisible, true, 'resizing wrapped source keeps the invocation in view');
      await page.setViewportSize({ width: 1000, height: 700 });
      assert.equal(await anchor.evaluate(node => { const a = node.getBoundingClientRect(), s = node.closest('.ds-callsite-scroll').getBoundingClientRect(); return a.top < s.bottom && a.bottom > s.top; }), true, 'window resizing also keeps the invocation in view');
      await page.setViewportSize(viewport);
      await page.keyboard.press('End');
    } else {
      assert.equal(await pair.getByRole('separator').isVisible(), false);
      const a = await pair.locator('.ds-callsite-pane').boundingBox(), b = await pair.locator('.ds-helper-scroll').boundingBox();
      assert.ok(a.y + a.height <= b.y + 1, 'narrow panes stack');
    }
    await callerScroll.evaluate(node => { node.style.maxHeight = ''; });
    const toggle = pair.getByRole('button', { name: 'Hide caller', exact: true });
    await toggle.focus(); await page.keyboard.press('Enter');
    assert.equal(await pair.locator('.ds-callsite-pane').isVisible(), false);
    assert.equal(await pair.getByRole('button', { name: 'Show caller', exact: true }).getAttribute('aria-expanded'), 'false');
    await pair.getByRole('button', { name: 'Show caller', exact: true }).click();
    assert.equal(await pair.locator('.ds-callsite-pane').isVisible(), true);
    const before = await callerScroll.evaluate(node => { node.scrollLeft = 50; return node.scrollLeft; });
    await page.locator('[data-dock-step="3"] [data-beat-move="1"]').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-story-scroll-pending'));
    assert.equal(await callerScroll.evaluate(node => node.scrollLeft), before, 'helper focus does not scroll the caller');
    assert.equal(await pair.locator('.ds-callsite-pane .is-story-focus').count(), 0);
    assert.ok(await pair.locator('.ds-helper-scroll .is-story-focus').count());
    await page.screenshot({ path: join(output, `${name}-cross-file.png`) });
    // Return directly to a not-yet-loaded changed caller: choose its visible new-side invocation.
    await pair.getByRole('button', { name: 'Return to createOrder()', exact: true }).click();
    await page.locator('[data-step-panel="1"]:not([data-step-lazy]):not([hidden])').waitFor();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-story-scroll-pending'));
    await page.waitForFunction(() => document.querySelector('[data-dock-step="1"] .is-selected')?.getAttribute('data-focus-group') === '1');
    // Record a deliberate caller beat and scroll, then take another helper trip.
    const callerBeat = page.locator('[data-dock-step="1"] [data-story-beat]').last();
    while (await callerBeat.getAttribute('aria-pressed') !== 'true') await page.locator('[data-dock-step="1"] [data-beat-move="1"]').click();
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-story-scroll-pending'));
    const group = await callerBeat.getAttribute('data-focus-group');
    const saved = await page.locator('[data-step-panel="1"] .ds-diffscroll').evaluate(node => { node.scrollTop = 45; return { top: node.scrollTop, left: node.scrollLeft }; });
    await go(3);
    await pair.getByRole('button', { name: 'Return to createOrder()', exact: true }).click();
    await page.waitForFunction(group => document.querySelector('[data-dock-step="1"] .is-selected')?.getAttribute('data-focus-group') === group, group);
    await page.waitForFunction(saved => { const n = document.querySelector('[data-step-panel="1"] .ds-diffscroll'); return Math.abs(n.scrollTop - saved.top) < 1 && Math.abs(n.scrollLeft - saved.left) < 1; }, saved);
    const sameIndex = story.steps.findIndex(step => step.id === 'same-file-helper') + 1;
    await go(sameIndex);
    assert.match(await pair.locator('.ds-callsite-path').innerText(), /src\/orders.ts/);
    assert.match(await pair.locator('.ds-helper-scroll').innerText(), /src\/orders.ts/);
    assert.equal(await pair.locator('[data-callsite-anchor]').getAttribute('data-line'), '6');
    await page.screenshot({ path: join(output, `${name}-same-file.png`) });
    if (name === 'mobile') {
      const copy = await page.locator(`[data-dock-step="${sameIndex}"] .ds-beatdock-copy`).boundingBox();
      assert.ok(copy.width >= viewport.width - 40, 'detailed explanation has a readable full-width row');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'page has no horizontal overflow');
    if (name === 'desktop') {
      const speechRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/aloud/speak');
      await page.locator('[data-readaloud]').click();
      await speechRequest;
      await page.waitForFunction(() => !!document.querySelector('.ds-step:not([hidden]).is-voice-active'));
      assert.equal(await pair.locator('.ds-callsite-pane .is-voice-focus').count(), 0);
      assert.ok(spoken.some(input => /record\s*spend/i.test(input.text)), 'normal read-aloud includes the helper');
      await pair.getByRole('button', { name: 'Return to placeOrder()', exact: true }).click();
      await page.getByRole('button', { name: /^Resume/ }).waitFor();
      await page.locator('[data-aloud-stop]').click();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: source pairing, independent focus, hide/show, resize/stack, return position, narration/export passages`);
    await context.close();
  }
  console.log(`Caller/helper screenshots: ${output}`);
} catch (error) {
  if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(repo, { recursive: true, force: true }); }
