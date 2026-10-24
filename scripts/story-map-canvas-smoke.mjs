// THROWAWAY: validate the Ivy canvas adapter and its native-viewer boundary.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';
const base = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json&variant=A';
const output = process.env.CODESTORY_CANVAS_OUT || '/tmp/codestory-ivy-canvas-qa'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [width, motion] of [[1440, 'no-preference'], [390, 'no-preference'], [320, 'reduce']]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'dark', reducedMotion: motion });
    page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('.sm-canvas-world').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([data-step-lazy]):not([hidden])'));
    await page.waitForTimeout(350);
    const world = page.locator('.sm-canvas-world'), map = page.locator('.sm-map');
    const camera = () => world.evaluate(element => { const m = new DOMMatrix(getComputedStyle(element).transform); return [m.e, m.f, m.a]; });
    assert.equal(await map.getAttribute('data-canvas-home'), 'true');
    assert.equal(await page.locator('[data-canvas-node="route"]').getAttribute('data-reading'), 'false');
    assert.equal(await page.locator('[data-map-native-viewer="source-route"]').isVisible(), false, 'overview avoids mounting a wall of visible code');
    if (width === 1440) assert.ok(await page.evaluate(() => {
      const children = [...document.querySelectorAll('[data-canvas-node]')].filter(e => e.dataset.canvasOpen === 'true' && e.dataset.canvasNode !== 'root').map(e => e.getBoundingClientRect());
      const root = document.querySelector('[data-canvas-node="root"]').getBoundingClientRect();
      return Math.abs(root.top + root.height / 2 - (Math.min(...children.map(r => r.top)) + Math.max(...children.map(r => r.bottom))) / 2) < 2;
    }), 'parent is balanced beside its children');
    await page.screenshot({ path: `${output}/${width}-overview.png` });
    const background = await map.boundingBox(), beforeDrag = await camera();
    await page.mouse.move(background.x + 5, background.y + 2); await page.mouse.down();
    await page.mouse.move(background.x + 5, background.y - 12); await page.mouse.up();
    await page.mouse.move(background.x + 25, background.y + 40);
    assert.equal(await map.evaluate(element => element.classList.contains('is-panning')), false, 'release outside the canvas clears a pending drag');
    assert.deepEqual(await camera(), beforeDrag);
    const key = async (key, id) => { await page.keyboard.press(key); assert.equal(await page.evaluate(() => document.activeElement?.dataset.mapFocus), id, 'logical focus is immediate'); };
    await key('ArrowRight', 'route'); await page.waitForTimeout(500);
    const viewer = page.locator('[data-map-native-viewer="source-route"]');
    await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
    assert.equal(await viewer.isVisible(), true, 'selection reveals the real native viewer');
    assert.ok((await camera())[2] >= .95, 'source is framed at a readable scale');
    await key('Home', 'root'); await page.waitForTimeout(500); await key('ArrowRight', 'route'); await page.waitForTimeout(500);
    assert.ok(await viewer.locator('.ds-helper-scroll').evaluate(element => {
      const code = element.getBoundingClientRect(), viewport = element.closest('.sm-map').getBoundingClientRect(); return code.top < viewport.bottom - 40 && code.bottom > viewport.top + 40;
    }), 'returning to a source card reframes its expanded reading body');
    await page.screenshot({ path: `${output}/${width}-source.png` });
    await key('ArrowRight', 'route-1');
    const entry = await page.locator('[data-canvas-node="route-1"]').evaluate(element => ({
      opacity: Number(getComputedStyle(element).opacity), animations: element.getAnimations().map(a => a.effect.getTiming()),
    }));
    if (motion === 'reduce') { assert.equal(entry.opacity, 1); assert.deepEqual(entry.animations, []); }
    else {
      assert.ok(entry.animations.some(a => a.duration === 440 && a.delay === 230), 'branch uses the real docs entrance');
      if (width === 1440) for (const delay of [80, 180]) {
        await page.waitForTimeout(delay);
        assert.ok(await page.evaluate(() => {
          const path = document.querySelector('.sm-canvas-edges [data-map-edge="route"]');
          const endpoint = path.getPointAtLength(path.getTotalLength());
          const screen = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(path.getScreenCTM());
          const card = document.querySelector('[data-canvas-node="route"]').getBoundingClientRect();
          return Math.hypot(screen.x - card.left, screen.y - card.top - card.height / 2) < 3;
        }), 'existing connectors remain attached during compensated reflow');
      }
    }
    await page.waitForTimeout(800);
    const headVisible = id => page.locator(`[data-map-node="${id}"] .sm-card-head`).evaluate(element => {
      const h = element.getBoundingClientRect(), v = element.closest('.sm-map').getBoundingClientRect(); return h.top >= v.top && h.bottom <= v.bottom && h.left >= v.left && h.right <= v.right;
    });
    assert.ok(await headVisible('route-1'), 'edge cards can be centred without native scroll limits');
    await page.screenshot({ path: `${output}/${width}-branch.png` });
    await key('ArrowLeft', 'route');
    const full = viewer.getByRole('button', { name: 'Full file', exact: true }); await full.focus(); await full.click();
    await viewer.locator('[data-full-inner] .ds-code').first().waitFor({ state: 'visible' });
    const scroll = viewer.locator('.ds-helper-scroll'); await page.waitForTimeout(180);
    const stored = await scroll.evaluate(element => { element.scrollTop = 300; element.scrollLeft = 100; window.canvasScroller = element; window.canvasPanel = element.closest('.sm-native-step'); return [element.scrollTop, element.scrollLeft]; });
    assert.ok(stored[0] > 0, 'probe stores an actual nonzero native scroll offset');
    await page.getByRole('button', { name: 'Fit whole map', exact: true }).click(); await page.waitForTimeout(700);
    assert.equal(await map.getAttribute('data-canvas-home'), 'true', 'native viewer paint cannot exit overview');
    assert.equal(await viewer.isVisible(), false);
    await page.getByRole('button', { name: 'Find current card', exact: true }).click(); await page.waitForTimeout(650);
    assert.equal(await viewer.isVisible(), true);
    assert.equal(await scroll.evaluate(element => element === window.canvasScroller && element.closest('.sm-native-step') === window.canvasPanel), true);
    assert.deepEqual(await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), stored, 'overview/reading retain both native inspection offsets');
    await page.getByRole('button', { name: 'Focus current card', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.equal(await dialog.locator('.ds-helper-scroll').evaluate(element => element === window.canvasScroller), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(120);
    assert.deepEqual(await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), stored, 'Focus retains requested offsets');
    await scroll.focus(); await page.waitForTimeout(80); const prior = await camera(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
    assert.deepEqual(await camera(), prior, 'native arrows never pan the map');
    await key('Escape', 'route'); await key('ArrowRight', 'route-1');
    await key('ArrowDown', 'route-2'); await key('ArrowDown', 'route-3'); await key('ArrowDown', 'route-4'); await page.waitForTimeout(400);
    const sourceFocus = await viewer.evaluate(element => {
      const scroll = element.querySelector('.ds-helper-scroll'), viewport = scroll.getBoundingClientRect();
      const rows = [...element.querySelectorAll('[data-full-inner] .is-story-focus')].map(row => { const box = row.getBoundingClientRect(); return { line: row.dataset.line, top: box.top, bottom: box.bottom }; });
      return { top: scroll.scrollTop, height: scroll.clientHeight, viewport: { top: viewport.top, bottom: viewport.bottom }, rows, visible: rows.some(row => row.top >= viewport.top && row.bottom <= viewport.bottom) };
    });
    assert.ok(sourceFocus.visible, `changed explanation reveals active source: ${JSON.stringify(sourceFocus)}`);
    await key('ArrowLeft', 'route'); await key('Home', 'root');
    assert.ok(await headVisible('root'), 'Home is immediately visible even after interrupted growth');
    await map.hover({ position: { x: 5, y: 5 } });
    const zoomBefore = (await camera())[2]; await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await page.waitForTimeout(100);
    assert.ok((await camera())[2] > zoomBefore, 'pointer-centred wheel zoom works');
    await page.mouse.wheel(40, 60); await page.waitForTimeout(100); const stopped = await camera(); await page.waitForTimeout(500);
    assert.deepEqual(await camera(), stopped, 'wheel owns the presented camera without delayed jumps');
    assert.deepEqual(await map.evaluate(element => [element.scrollTop, element.scrollLeft]), [0, 0], 'one camera owns map movement');
    assert.deepEqual(errors, []); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log(`PASS A/${width}/${motion}: balanced overview, readable native source, growth, camera/zoom/input, viewer DOM/offsets, Focus`);
    await page.close();
  }
} finally { await browser.close(); }
