// THROWAWAY regression: continuity and layout work, not just animation duration.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
const url = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json&variant=A';
try {
  for (const [width, motion] of [[1440, 'no-preference'], [390, 'no-preference'], [320, 'reduce']]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: motion, colorScheme: 'dark' });
    await page.goto(url); await page.locator('.sm-canvas-world').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([hidden]):not([data-step-lazy])'));
    await page.waitForTimeout(400);
    const world = page.locator('.sm-canvas-world');
    const flights = () => world.evaluate(element => element.getAnimations().filter(a => a.transitionProperty === 'transform').map(a => ({ state: a.playState, duration: a.effect.getTiming().duration })));
    const focus = id => page.waitForFunction(id => document.activeElement?.dataset.mapFocus === id, id);
    await page.keyboard.press('ArrowRight'); await focus('route');
    if (motion === 'reduce') assert.deepEqual(await flights(), []);
    else assert.ok((await flights()).some(a => a.state === 'running' && a.duration === 550), 'opening a card shares its 550ms layout clock, with immediate logical focus');
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight'); await focus('route-1');
    const leaf = page.locator('[data-canvas-node="route-1"]');
    await leaf.evaluate(element => { window.entrance = element.getAnimations().find(a => a.effect.getTiming().duration === 550); });
    await page.waitForTimeout(65);
    await page.keyboard.press('ArrowDown'); await focus('route-2');
    if (motion !== 'reduce') {
      assert.equal(await leaf.evaluate(element => element.getAnimations().includes(window.entrance) && window.entrance.playState === 'running'), true, 'sibling input preserves the unfinished entrance instead of finishing/cancelling it');
      assert.ok((await flights()).some(a => a.state === 'running'), 'sibling retarget has a camera flight');
    }
    await page.waitForTimeout(950);
    // Measure steady sibling travel separately from the SVG growth already in
    // progress: animated path geometry itself legitimately produces layouts.
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const count = async () => (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'LayoutCount').value;
    const before = await count(); await page.keyboard.press('ArrowDown'); await focus('route-3'); await page.waitForTimeout(600);
    const layouts = await count() - before;
    assert.ok(layouts <= 12, `sibling navigation must avoid remeasuring the entire map (${layouts} layouts)`);
    await page.keyboard.press('ArrowUp'); await focus('route-2');
    await page.waitForTimeout(65); await page.keyboard.press('ArrowDown'); await focus('route-3');
    await page.waitForTimeout(650);
    assert.ok(await page.locator('[data-map-node="route-3"] .sm-card-head').evaluate(element => { const r = element.getBoundingClientRect(), v = element.closest('.sm-map').getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; }), 'rapid reversal settles at the latest requested heading');
    await page.getByRole('button', { name: 'Map options', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in map', exact: true }).click();
    await page.getByRole('button', { name: 'Close map options', exact: true }).click();
    const zoom = await world.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
    await page.keyboard.press('ArrowDown'); await focus('route-4'); await page.waitForTimeout(600);
    assert.ok(Math.abs(await world.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a) - zoom) < .001, 'sibling navigation preserves reader zoom');
    // A real background gesture takes over the currently presented camera.
    await page.keyboard.press('Home'); await focus('root'); await page.waitForTimeout(60);
    if (motion !== 'reduce') assert.ok(await page.evaluate(() => {
      const path = document.querySelector('.sm-canvas-edges [data-map-edge="route"]'), matrix = path.getScreenCTM();
      const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
      const a = new DOMPoint(start.x, start.y).matrixTransform(matrix), b = new DOMPoint(end.x, end.y).matrixTransform(matrix);
      const parent = document.querySelector('[data-canvas-node="root"]').getBoundingClientRect(), child = document.querySelector('[data-canvas-node="route"]').getBoundingClientRect();
      const vertical = document.querySelector('.sm-canvas-world').dataset.vertical === 'true';
      return Math.hypot(a.x - (vertical ? parent.left + parent.width / 2 : parent.right), a.y - (vertical ? parent.bottom : parent.top + parent.height / 2)) < 3 && Math.hypot(b.x - child.left, b.y - child.top - child.height / 2) < 3;
    }), 'connectors stay attached when reading disclosure resizes their cards');
    await page.locator('.sm-map').hover({ position: { x: 5, y: 5 } }); await page.mouse.wheel(10, 20); await page.waitForTimeout(80);
    const stopped = await world.evaluate(element => getComputedStyle(element).transform); await page.waitForTimeout(650);
    assert.equal(await world.evaluate(element => getComputedStyle(element).transform), stopped);
    await page.goto(url); await page.locator('.sm-canvas-world').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([hidden]):not([data-step-lazy])'));
    await page.keyboard.press('ArrowRight'); await focus('route'); await page.waitForTimeout(700);
    await page.locator('[data-map-focus="route"]').click();
    await page.getByRole('button', { name: 'Next explanation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === 'route-1');
    assert.equal(await page.locator('[data-dock-step="25"] .is-selected').getAttribute('data-focus-group'), '1', 'reselecting an already active card acknowledges source synchronization');
    const execution = page.locator('[data-map-focus="execution"]'); await execution.focus(); await execution.click();
    await page.keyboard.press('ArrowRight'); await focus('execution-1');
    await page.keyboard.press('ArrowDown'); await focus('execution-2');
    await page.keyboard.press('ArrowDown'); await focus('policy'); await page.waitForTimeout(700);
    assert.equal(await page.locator('[data-canvas-node="policy"]').getAttribute('data-reading'), 'true');
    if (width === 1440) assert.ok(await page.locator('[data-canvas-node="policy"]').evaluate(element => element.offsetWidth) >= 1200, 'opened code leaves use the available desktop width');
    console.log(`PASS A/${width}/${motion}: immediate focus, continuous camera/entrance, reversal, ${layouts} sibling layouts, gesture interruption`);
    await page.close();
  }
} finally { await browser.close(); }
