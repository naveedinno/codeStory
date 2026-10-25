// Reading continuity: leaving a large card must not collapse the map mid-flight.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';
const base = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json&variant=A';
const output = process.env.CODESTORY_HANDOFF_OUT || '/tmp/codestory-handoff-qa';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [width, motion, full] of [[1440, 'no-preference', true], [390, 'no-preference', true], [320, 'reduce', true], [1440, 'no-preference', false]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: motion, colorScheme: 'dark' });
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.retirements = [];
      const header = () => {
        const el = document.querySelector('.sm-map [data-map-focus][aria-current]')?.closest('.sm-canvas-item')?.querySelector('.sm-card-head');
        if (!el) return null;
        const r = el.getBoundingClientRect(), s = new DOMMatrix(getComputedStyle(document.querySelector('.sm-canvas-world')).transform).a;
        return { x: r.left, y: r.top, s };
      };
      document.addEventListener('codestory:map-retire', () => window.retirements.push({ before: header() }));
      document.addEventListener('codestory:map-retired', () => { window.retirements.at(-1).after = header(); });
    });
    const url = new URL(base); if (full) url.searchParams.set('scope', 'full');
    await page.goto(url.href); await page.locator('.sm-canvas-world').waitFor();
    await page.waitForFunction(index => document.querySelector(`[data-step-panel="${index}"]:not([hidden]):not([data-step-lazy])`), full ? 1 : 24);
    const selected = id => page.waitForFunction(id => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === id, id);
    const key = async (value, id) => { await page.keyboard.press(value); await selected(id); };
    const node = id => page.locator(`[data-canvas-node="${id}"]`);
    const handoff = async (from, to, direction) => {
      const size = await node(from).evaluate(el => [el.offsetWidth, el.offsetHeight]);
      await page.evaluate(({ from, to }) => {
        const capture = { keyTime: 0, samples: [] }; window.handoffCapture = capture;
        const onKey = () => { capture.keyTime = performance.now(); window.removeEventListener('keydown', onKey, true); };
        window.addEventListener('keydown', onKey, true);
        const frame = () => {
          const old = document.querySelector(`[data-canvas-node="${from}"]`), next = document.querySelector(`[data-canvas-node="${to}"]`);
          if (capture.keyTime && next.querySelector('[aria-current]')) {
            const a = old.getBoundingClientRect(), b = next.getBoundingClientRect();
            const inset = getComputedStyle(next).clipPath.match(/^inset\((.*?)\)/)?.[1].split(' round ')[0].split(/\s+/).map(Number.parseFloat);
            const visibleBottom = b.bottom - (inset?.[2] ?? inset?.[0] ?? 0) * b.height / next.offsetHeight;
            capture.samples.push({ elapsed: performance.now() - capture.keyTime, top: b.top,
              gap: a.top < b.top ? b.top - a.bottom : a.top - visibleBottom, held: old.dataset.readingHeld === 'true' });
          }
          if (!capture.keyTime || performance.now() - capture.keyTime < 950) requestAnimationFrame(frame);
        }; requestAnimationFrame(frame);
      }, { from, to });
      await key(direction, to);
      if (motion !== 'reduce') {
        assert.equal(await node(from).getAttribute('data-reading-held'), 'true', 'old presentation survives immediate source/focus handoff');
        assert.deepEqual(await node(from).evaluate(el => [el.offsetWidth, el.offsetHeight]), size, 'no outgoing width/height snap during the camera flight');
      } else assert.equal(await page.locator('[data-reading-held="true"]').count(), 0, 'reduced motion has no delayed presentation');
      await page.waitForTimeout(1100);
      const samples = await page.evaluate(() => window.handoffCapture.samples);
      assert.ok(samples.length && samples[0].elapsed < 150, 'selection paints promptly instead of blocking for the previous quarter-second render');
      if (motion !== 'reduce') {
        const first = samples[0].top, end = samples.at(-1).top;
        assert.ok(samples.every(sample => sample.top >= Math.min(first, end) - 1 && sample.top <= Math.max(first, end) + 1), 'the camera and card land without overshooting their destination');
        const gap = full ? 32 : 44;
        assert.ok(samples.filter(sample => sample.held).every(sample => Math.abs(sample.gap - gap) < 1), 'incoming reveal and outgoing geometry maintain the sibling gap');
      }
      const valid = await node(from).evaluate(el => {
        if (el.dataset.readingHeld !== 'true') return true;
        const r = el.getBoundingClientRect(), v = el.closest('.sm-map').getBoundingClientRect();
        return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
      });
      assert.ok(valid, 'settled offscreen cards retire; visible context can remain until it leaves view');
    };
    if (full) {
      await key('ArrowRight', 'section-0'); await key('ArrowRight', 'chapter-0'); await key('ArrowRight', 'map-one-trade');
      await key('ArrowDown', 'map-doors'); await page.waitForTimeout(900);
      await handoff('map-doors', 'a-fallback', 'ArrowDown');
      const viewer = page.locator('[data-map-native-viewer="story-a-fallback"]');
      await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
      await viewer.getByRole('button', { name: 'Full file', exact: true }).focus();
      await viewer.getByRole('button', { name: 'Full file', exact: true }).click();
      await page.locator('[data-map-focus="a-fallback"]').focus();
      await page.waitForTimeout(300);
      await viewer.evaluate(el => { window.handoffViewer = el.querySelector('.sm-native-step'); });
      await page.screenshot({ path: `${output}/A-${width}-source.png` });
      await handoff('a-fallback', 'a-routing', 'ArrowDown');
      await handoff('a-routing', 'a-fallback', 'ArrowUp');
      assert.equal(await viewer.evaluate(el => el.querySelector('.sm-native-step') === window.handoffViewer), true);
      assert.equal(await viewer.getByRole('button', { name: 'Full file', exact: true }).getAttribute('aria-pressed'), 'true', 'native mode survives folding and reopening');
      await handoff('a-fallback', 'map-doors', 'ArrowUp');
      await key('ArrowDown', 'a-fallback'); await page.waitForTimeout(60);
      await key('ArrowDown', 'a-routing'); await page.waitForTimeout(60);
      await key('ArrowUp', 'a-fallback'); await page.waitForTimeout(1100);
      assert.equal(await node('a-fallback').getAttribute('data-presented-reading'), 'true', 'a stale retirement cannot close a reopened card');
      await page.getByRole('button', { name: 'Next explanation', exact: true }).click();
      await selected('a-fallback-beat-1');
      const previousPassage = await node('a-fallback').locator('.sm-prose').innerText();
      // Native progress changes disclosure without going through choose().
      await page.evaluate(() => document.querySelector('[data-thread-node="4"]').click());
      await selected('a-routing'); await page.waitForTimeout(1100);
      assert.equal(await node('a-fallback').locator('.sm-prose').innerText(), previousPassage, 'outgoing explanation does not reset to its introduction during travel');
      await page.getByRole('button', { name: 'Focus current card', exact: true }).click();
      await page.locator('.sm-focus-dialog[open]').waitFor(); await page.keyboard.press('f');
      await page.locator('.sm-focus-dialog.is-fullscreen').waitFor(); await page.keyboard.press('Escape');
      await page.locator('.sm-focus-dialog:not(.is-fullscreen)[open]').waitFor(); await page.keyboard.press('Escape');
      await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
      await page.locator('[data-map-focus="a-routing"]').focus();
      await key('ArrowUp', 'a-fallback'); await page.keyboard.press('Tab');
      await page.waitForTimeout(800);
      assert.ok(await page.evaluate(() => {
        const focused = document.activeElement, r = focused.getBoundingClientRect(), v = document.querySelector('.sm-map').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return focused.closest('[data-map-native-viewer]') && r.top >= v.top && r.bottom <= v.bottom && r.left >= v.left && r.right <= v.right && focused.contains(hit);
      }), 'Tab during a reversal leaves the native control visible after all movement settles');
    } else {
      await key('ArrowRight', 'route'); await page.waitForTimeout(900);
      await handoff('route', 'change', 'ArrowDown');
      await handoff('change', 'route', 'ArrowUp');
    }
    await page.locator('.sm-map').hover({ position: { x: 4, y: 4 } }); await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);
    assert.ok(await page.evaluate(() => window.retirements.every(({ before, after }) => before && after && Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1 && Math.abs(before.s - after.s) < .001)), 'retirement preserves destination header and zoom without recentering');
    await page.screenshot({ path: `${output}/A-${width}-${full ? 'full' : 'gateway'}-settled.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS A/${width}/${motion}/${full ? 'full' : 'gateway'}: hold, offscreen folding, anchored cleanup, reversal and native media`);
    await page.close();
  }
} finally { await browser.close(); }
