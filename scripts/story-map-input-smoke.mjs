// THROWAWAY prototype regression. Run against npm run prototype:story-map.
// Exercise ordinary focus paths with normal motion, not only focused titles.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';

const url = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json';
const output = resolve(process.env.CODESTORY_MAP_INPUT_OUT || '/tmp/codestory-map-input-qa');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [variant, width, motion] of [
    ['A', 1440, 'no-preference'], ['B', 1440, 'no-preference'], ['C', 1440, 'no-preference'],
    ['A', 390, 'no-preference'], ['A', 320, 'reduce'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'dark', reducedMotion: motion });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.mapTransitions = [];
      const original = document.startViewTransition?.bind(document);
      if (original) document.startViewTransition = (...args) => {
        window.mapTransitions.push(document.documentElement.dataset.dsMotion);
        return original(...args);
      };
    });
    const target = new URL(url); target.searchParams.set('variant', variant);
    const go = async () => {
      await page.goto(target.href);
      await page.locator('.sm-prototype').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([data-step-lazy]):not([hidden])'));
      // A reload can restore the persisted native step before the prototype
      // mounts. Measure map-owned transitions only after the map is ready.
      await page.evaluate(() => { window.mapTransitions = []; });
    };
    const selected = id => page.waitForFunction(id => document.querySelector('.sm-map [data-map-focus][aria-current]')?.getAttribute('data-map-focus') === id, id);
    const focused = id => page.waitForFunction(id => document.activeElement?.getAttribute('data-map-focus') === id, id);
    const key = async (value, id) => { await page.keyboard.press(value); await selected(id); await focused(id); };
    await go();
    const card = id => page.locator(variant === 'C' ? `.sm-detail-column > [data-map-detail="${id}"]` : `.sm-map [data-map-node="${id}"]`);
    const number = id => card(id).locator('.sm-map-order').innerText();
    const enterChildren = async id => {
      const control = card(id).locator('.sm-child-cards');
      if (variant === 'C') await control.click();
      else {
        if (await control.getAttribute('aria-expanded') !== 'true') {
          await control.click(); await selected(id);
          assert.equal(await control.getAttribute('aria-expanded'), 'true', 'edge count unfolds the branch without replacing the parent');
        }
        await page.keyboard.press('ArrowRight');
      }
    };
    const hitAreas = id => card(id).locator('.sm-parent-card,.sm-sibling-cards button,.sm-child-cards').evaluateAll(buttons => buttons.length >= 3 && buttons.every(button => { const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; }));
    assert.equal(await number('root'), '01');
    if (variant === 'A') {
      assert.equal(await page.locator('.sm-sibling-cards:not([hidden]),.sm-child-cards.is-map-count:not(:disabled)').count(), 0, 'zoomed-out overview has passive edge counts instead of tiny active controls');
      await card('route').locator('.sm-select').click(); await selected('route');
      await page.waitForTimeout(750);
      assert.ok(await hitAreas('route'), 'direct chapter selection opens full-size navigation, without going through the root first');
      await go();
      await card('root').locator('.sm-select').click();
    }
    await enterChildren('root'); await selected('route'); await focused('route');
    assert.equal(await number('route'), '02');
    await page.waitForTimeout(450);
    assert.ok(await hitAreas('route'), 'navigation hit areas remain at least 44px at the readable canvas scale');
    if (variant === 'A') assert.ok(await card('route').evaluate(card => {
      const title = card.querySelector('.sm-select'), method = card.querySelector('.sm-symbol');
      const titleStyle = getComputedStyle(title), cardStyle = getComputedStyle(card), rect = method.getBoundingClientRect(), bounds = card.getBoundingClientRect();
      return document.activeElement === title && title.matches(':focus-visible') && titleStyle.boxShadow === 'none' && cardStyle.boxShadow !== 'none' && parseFloat(getComputedStyle(method).fontSize) >= 13 && rect.left >= bounds.left && rect.right <= bounds.right;
    }), 'keyboard focus frames the card, while the plain heading and readable method name remain unobscured');
    if (variant === 'A') assert.ok(await card('route').locator('.sm-child-cards').evaluate(button => { const r = button.getBoundingClientRect(), map = button.closest('.sm-map').getBoundingClientRect(); return r.left >= map.left && r.right <= map.right && r.top >= map.top && r.bottom <= map.bottom; }), 'the branch port stays fully inside the canvas viewport');
    assert.equal(await card('route').getByRole('button', { name: 'No previous sibling', exact: true }).isDisabled(), true);
    await enterChildren('route'); await selected('route-1'); await focused('route-1');
    assert.equal(await number('route-1'), '02.1');
    assert.equal(await card('route-1').locator('.sm-child-cards').count(), 0, 'leaf cards have no child port');
    assert.equal(await card('route-1').locator('.sm-peer-dots').getAttribute('aria-label'), 'Card 1 of 4 siblings');
    assert.equal(await card('route-1').locator('.sm-card-relations').count(), 0, 'navigation never interrupts the card body');
    await card('route-1').getByRole('button', { name: /^Next sibling/ }).click(); await selected('route-2'); await focused('route-2');
    assert.equal(await number('route-2'), '02.2');
    await key('ArrowUp', 'route-1');
    await card('route-1').locator('.sm-parent-card').click(); await selected('route'); await focused('route');
    await card('route').getByRole('button', { name: /^Next sibling/ }).click(); await selected('change'); await focused('change');
    assert.equal(await number('change'), '03');
    await card('change').locator('.sm-parent-card').click(); await selected('root');
    await enterChildren('root'); await selected('route');
    await page.getByRole('button', { name: 'Expand card', exact: true }).click();
    await page.getByRole('dialog').locator('.sm-child-cards').click(); await selected('route-1');
    await page.waitForFunction(() => document.querySelector('#sm-focus-title')?.textContent.startsWith('02.1 '));
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'sm-focus-title', 'focused navigation moves focus to the new card title');
    await page.getByRole('dialog').getByRole('button', { name: 'Close card', exact: true }).click();
    await go();
    // No preliminary focus() call: this was a dead path in the previous version.
    await key('ArrowRight', 'route');
    if (variant === 'A') {
      await page.waitForTimeout(750);
      assert.ok(await page.locator('.sm-canvas-world').evaluate(world => new DOMMatrix(getComputedStyle(world).transform).a >= .95), 'opening from overview settles at readable scale, including late layout refreshes');
    }
    await key('Home', 'root');
    await key('ArrowDown', 'route');
    await key('ArrowLeft', 'root');
    await page.locator(variant === 'C' ? '.sm-detail-column .sm-prose' : '[data-map-node="root"] .sm-prose').first().click();
    await key('ArrowRight', 'route');
    await key('ArrowRight', 'route-1');
    for (let i = 0; i < 8; i++) { await page.keyboard.down('ArrowDown'); await page.waitForTimeout(25); }
    await page.keyboard.up('ArrowDown');
    await selected('route-4'); await focused('route-4');
    await page.waitForTimeout(250); await selected('route-4');
    const inspectionTopic = variant === 'C' ? 'route' : 'route-4';
    if (variant === 'C') await key('Escape', 'route');
    const viewer = page.locator('.sm-map [data-map-native-viewer="source-route"]');
    await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
    // On the transform canvas, Tab/focus brings an offscreen native control
    // into the camera. Locator auto-scroll cannot move a transform camera.
    if (variant === 'A') await viewer.getByRole('button', { name: 'Unified', exact: true }).focus();
    await viewer.getByRole('button', { name: 'Unified', exact: true }).click();
    const scroller = viewer.locator('.ds-helper-scroll');
    await scroller.focus();
    // Let the mode change finish framing its active lines before beginning
    // independent code inspection (the faster runtime can reach this sooner).
    await page.waitForTimeout(250);
    await scroller.evaluate(node => { node.scrollTop = 0; });
    const before = await scroller.evaluate(node => node.scrollTop);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(before => document.querySelector('.sm-map [data-map-native-viewer="source-route"] .ds-helper-scroll').scrollTop > before, before);
    await selected(inspectionTopic);
    await page.waitForTimeout(220);
    assert.ok(await scroller.evaluate(node => node.scrollTop) > before, 'inspection is not undone by delayed source centering');
    const viewerOptions = viewer.locator('.sm-viewer-options > summary');
    await viewerOptions.focus(); await viewerOptions.click();
    const repair = viewer.locator('summary[aria-label="Repair this story step"]');
    if (variant === 'A') await repair.focus();
    await repair.click();
    await page.keyboard.press('Escape');
    assert.equal(await repair.evaluate(node => !node.closest('details').open && node === document.activeElement), true, 'Escape closes the native menu before leaving code');
    await page.keyboard.press('Escape');
    assert.ok(await viewerOptions.evaluate(node => !node.parentElement.open && node === document.activeElement), 'the outer options disclosure owns the next Escape');
    await key('Escape', inspectionTopic);
    if (inspectionTopic !== 'route') await key('ArrowLeft', 'route');
    // Closing Focus returns to its opener, which must still support map keys.
    if (variant === 'C') await page.getByRole('button', { name: 'Expand card', exact: true }).click();
    else { if (variant === 'A') await page.locator('[data-map-node="route"] .sm-card-actions button').focus(); await page.locator('[data-map-node="route"] .sm-card-actions button').click(); }
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.locator('.sm-viewer-options > summary').click();
    const focusedRepair = dialog.locator('summary[aria-label="Repair this story step"]');
    await focusedRepair.click();
    await page.keyboard.press('Escape');
    assert.equal(await focusedRepair.evaluate(node => !node.closest('details').open && node === document.activeElement), true, 'nested menu closes before Focus');
    assert.equal(await dialog.isVisible(), true);
    await page.keyboard.press('Escape');
    assert.ok(await dialog.locator('.sm-viewer-options').evaluate(node => !node.open));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await key('ArrowRight', 'route-1');
    await key('ArrowLeft', 'route');
    // A uses Ivy's visual camera travel while focus remains immediate. B/C
    // retain their scroll framing. Native inputs still own their keys below.
    await page.locator('.sm-map').evaluate(node => { node.scrollTop = 1600; });
    await page.getByRole('button', { name: 'Find current card', exact: true }).focus();
    await page.keyboard.press('Enter'); await focused('route');
    if (variant === 'A' && motion !== 'reduce') await page.waitForTimeout(450);
    const position = await page.locator('.sm-map').evaluate(node => [node.scrollTop, node.scrollLeft]);
    await page.waitForTimeout(260);
    assert.deepEqual(await page.locator('.sm-map').evaluate(node => [node.scrollTop, node.scrollLeft]), position, 'keyboard Find settles without delayed drift');
    // Native widgets retain their own keyboard behavior.
    await page.getByRole('button', { name: 'Map options', exact: true }).click();
    await page.getByRole('combobox', { name: 'Map layout', exact: true }).focus();
    await page.keyboard.press('ArrowDown'); await selected('route');
    assert.equal(await page.getByRole('combobox', { name: 'Map layout', exact: true }).evaluate(node => node === document.activeElement), true, 'layout selection retains native focus');
    await page.getByRole('button', { name: 'Follow this branch', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(260);
    assert.equal(await page.getByRole('button', { name: 'Map options', exact: true }).evaluate(node => node === document.activeElement), true, 'Follow restores the popover trigger');
    if (await page.locator('.sm-options').evaluate(node => node.matches(':popover-open'))) await page.getByRole('button', { name: 'Close map options', exact: true }).click();
    await page.getByRole('tab', { name: 'Story', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#ds-tab-files').getAttribute('aria-selected') === 'true');
    await page.getByRole('tab', { name: 'Story', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.mapTransitions.filter(kind => kind === 'step' || kind === 'mode')), [], 'hidden source updates never snapshot the map');
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(output, `${variant}-${width}-${motion}.png`) });
    console.log(`PASS ${variant}/${width}/${motion}: initial/prose keys, held keys, native code/Escape, keyboard framing, widget ownership, no map snapshots`);
    await page.close();
  }
} finally { await browser.close(); }
