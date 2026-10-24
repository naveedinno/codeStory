// THROWAWAY prototype regression: exercise the docs' branch motion with live native viewers.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';

const url = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json';
const output = resolve(process.env.CODESTORY_MAP_GROWTH_OUT || '/tmp/codestory-map-growth-qa');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [variant, width, motion] of [
    ['A', 1440, 'no-preference'], ['B', 1440, 'no-preference'],
    ['A', 390, 'no-preference'], ['B', 320, 'no-preference'], ['A', 320, 'reduce'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'dark', reducedMotion: motion });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const target = new URL(url); target.searchParams.set('variant', variant);
    await page.goto(target.href); await page.locator('.sm-prototype').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([data-step-lazy]):not([hidden])'));
    const branch = page.locator('[data-presence-branch="route"]');
    const rootToggle = page.locator('[data-map-node="root"] .sm-expand');
    const routeToggle = page.locator('[data-map-node="route"] .sm-expand');
    const card = page.locator('[data-map-node="route-1"]');
    const key = async (key, id) => {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-map-focus')), id, 'logical focus lands without waiting for geometry');
    };
    await key('ArrowRight', 'route');
    await key('ArrowRight', 'route-1');
    const entering = await card.evaluate(element => ({
      opacity: Number(getComputedStyle(element).opacity),
      matrix: getComputedStyle(element).transform,
      animations: element.getAnimations().map(animation => animation.effect.getTiming()),
      edgeAnimations: document.querySelector('[data-map-edge="route-1"]').getAnimations().map(animation => animation.effect.getTiming()),
    }));
    if (motion === 'reduce') {
      assert.equal(entering.opacity, 1); assert.deepEqual(entering.animations, []); assert.deepEqual(entering.edgeAnimations, []);
    } else {
      assert.ok(entering.opacity < .5, 'new child has a real entrance instead of appearing fully painted');
      assert.ok(entering.animations.some(timing => timing.duration === 440 && timing.delay === 230));
      assert.ok(entering.edgeAnimations.some(timing => timing.duration === 520 && timing.delay === 0));
      assert.ok(entering.matrix.startsWith('matrix(0.94'), 'child starts at the docs scale');
      await page.waitForTimeout(320);
      const opacity = await card.evaluate(element => Number(getComputedStyle(element).opacity));
      assert.ok(opacity > 0 && opacity < 1, 'entrance has intermediate painted frames');
    }
    await page.waitForTimeout(720);
    assert.equal(await card.evaluate(element => getComputedStyle(element).opacity), '1');
    await page.screenshot({ path: resolve(output, `${variant}-${width}-${motion}-open.png`) });
    // A closing branch leaves layout immediately, but keeps the live DOM until its exit ends.
    await card.evaluate(element => { window.growthCard = element; });
    const exiting = await page.evaluate(async () => {
      document.querySelector('[data-map-node="route"] .sm-expand').click();
      await new Promise(requestAnimationFrame);
      const group = document.querySelector('[data-presence-branch="route"]');
      return { inert: group.inert, hiddenToAccessibility: group.getAttribute('aria-hidden'), exiting: group.dataset.branchExiting,
        selected: document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus,
        durations: document.querySelector('[data-map-node="route-1"]').getAnimations().map(animation => animation.effect.getTiming().duration) };
    });
    assert.equal(exiting.inert && exiting.hiddenToAccessibility === 'true', true);
    assert.equal(exiting.selected, 'route');
    if (motion !== 'reduce') {
      assert.equal(exiting.exiting, 'true');
      assert.ok(exiting.durations.includes(220));
    }
    await page.waitForTimeout(380); assert.equal(await branch.evaluate(element => element.hidden), true);
    await routeToggle.click(); await page.waitForTimeout(80);
    assert.equal(await card.evaluate(element => element === window.growthCard), true, 'reopening reuses the original card');
    if (motion !== 'reduce') {
      await page.locator('.sm-map').hover({ position: { x: 4, y: 4 } });
      await page.mouse.wheel(0, 40); await page.waitForTimeout(70);
      const interrupted = await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]);
      await page.waitForTimeout(400);
      assert.deepEqual(await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]), interrupted, 'wheel input interrupts framing at its presented position');
    }
    // Reverse before exit completion. Its stale timeout must not hide the reopened group.
    await routeToggle.click(); await page.waitForTimeout(40); await routeToggle.click();
    await page.waitForTimeout(760);
    assert.equal(await branch.evaluate(element => !element.hidden && !element.inert && !element.hasAttribute('aria-hidden')), true);
    assert.equal(await card.evaluate(element => getComputedStyle(element).opacity), '1');
    // Native Full file mode and both axes survive hiding an entire ancestor branch.
    const viewer = page.locator('[data-map-native-viewer="source-route"]');
    await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
    await viewer.getByRole('button', { name: 'Full file', exact: true }).click();
    const scroll = viewer.locator('[data-full-inner]').locator('..');
    await page.waitForTimeout(300);
    await key('Escape', 'route'); await key('Home', 'root'); await page.waitForTimeout(500);
    const stored = await scroll.evaluate(element => {
      element.scrollTop = 300; element.scrollLeft = 90;
      window.growthScroller = element;
      window.growthPanel = element.closest('.sm-native-step');
      return [element.scrollTop, element.scrollLeft];
    });
    await rootToggle.click(); await page.waitForTimeout(380);
    assert.equal(await viewer.evaluate(element => !element.getClientRects().length), true);
    await rootToggle.click(); await page.waitForTimeout(900);
    assert.equal(await scroll.evaluate(element => element === window.growthScroller && element.closest('.sm-native-step') === window.growthPanel), true);
    assert.equal(await viewer.getByRole('button', { name: 'Full file', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), stored, 'branch presence preserves native inspection offsets');
    // Holding/reversing keys keeps one current target and cannot queue stale branch exits.
    await key('ArrowRight', 'route'); await key('ArrowRight', 'route-1');
    await key('ArrowLeft', 'route'); await key('ArrowRight', 'route-1');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-map-focus')), 'route-4');
    await page.waitForTimeout(800);
    assert.equal(await card.isVisible(), true);
    assert.equal(await page.locator('[data-map-node="route-4"] .sm-card-head').evaluate(element => {
      const heading = element.getBoundingClientRect(), viewport = element.closest('.sm-map').getBoundingClientRect();
      return heading.top >= viewport.top && heading.bottom <= viewport.bottom;
    }), true, 'held arrows must leave the final selected heading in view');
    const position = await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]);
    await page.waitForTimeout(250);
    assert.deepEqual(await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]), position, 'extent release cannot cause a late camera jump');
    await page.locator('.sm-map').evaluate(element => { element.scrollTop = 0; });
    await page.getByRole('button', { name: 'Find current card', exact: true }).click();
    await page.waitForTimeout(450);
    assert.ok(await page.locator('[data-map-node="route-4"]').evaluate(element => {
      const card = element.getBoundingClientRect(), viewport = element.closest('.sm-map').getBoundingClientRect();
      return Math.abs(card.top + card.height / 2 - viewport.top - viewport.height / 2) < 2;
    }), 'pointer Find completes centering instead of being replaced by ordinary header reveal');
    await page.goto(target.href); await page.locator('.sm-prototype').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([data-step-lazy]):not([hidden])'));
    await key('ArrowRight', 'route'); await key('ArrowRight', 'route-1');
    await page.waitForTimeout(80); await key('Home', 'root');
    assert.equal(await page.locator('[data-map-node="root"] .sm-card-head').evaluate(element => {
      const heading = element.getBoundingClientRect(), viewport = element.closest('.sm-map').getBoundingClientRect();
      return heading.top >= viewport.top && heading.bottom <= viewport.bottom && heading.left >= viewport.left;
    }), true, 'Home reveals its heading immediately even during a branch entrance');
    const homePosition = await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]);
    await page.waitForTimeout(720);
    assert.deepEqual(await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]), homePosition, 'Home does not inherit a branch pan');
    await key('ArrowRight', 'route'); await key('ArrowRight', 'route-1'); await page.waitForTimeout(750);
    // Activate without Playwright's preliminary auto-scroll, which would hide
    // the extent-clamping bug by moving the viewport before collapse starts.
    await rootToggle.evaluate(element => element.click()); await page.waitForTimeout(40);
    await page.locator('.sm-map').hover({ position: { x: 4, y: 4 } });
    await page.mouse.wheel(0, 1); await page.waitForTimeout(70);
    const stoppedCollapse = await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]);
    if (motion !== 'reduce') assert.ok(stoppedCollapse.some(offset => offset > 2), 'probe interrupts before collapse reaches its destination');
    await page.waitForTimeout(650);
    assert.deepEqual(await page.locator('.sm-map').evaluate(element => [element.scrollTop, element.scrollLeft]), stoppedCollapse, 'releasing collapsed space cannot snap an interrupted viewport');
    await page.mouse.wheel(-50000, -50000); await page.waitForTimeout(200);
    assert.deepEqual(await page.locator('.sm-motion-extent').evaluate(element => [element.style.width, element.style.height]), ['0px', '0px'], 'held space is released as the reader returns');
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(output, `${variant}-${width}-${motion}.png`) });
    console.log(`PASS ${variant}/${width}/${motion}: branch/edge frames, instant logical focus, exits/reversals, retained native DOM/mode/scroll, stable camera`);
    await page.close();
  }
} finally { await browser.close(); }
