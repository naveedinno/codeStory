// THROWAWAY prototype regression: compact native headers and F/Escape inspection.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { videoCapabilities } from '../dist/video-export.js';
const base = process.argv[2] || 'http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json';
const output = process.env.CODESTORY_FULLSCREEN_OUT || '/tmp/codestory-fullscreen-qa';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [variant, width, motion, height = 1000] of [['A',1440,'no-preference'], ['B',1440,'no-preference'], ['C',1440,'no-preference'], ['A',390,'no-preference'], ['A',320,'reduce'], ['A',320,'reduce',740]]) {
    if (process.env.CODESTORY_FULLSCREEN_CASE && process.env.CODESTORY_FULLSCREEN_CASE !== `${variant}-${width}`) continue;
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: 'dark', reducedMotion: motion });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const shotKey = `${variant}-${width}${height === 1000 ? '' : `-${height}`}`;
    const target = new URL(base); target.searchParams.set('variant', variant);
    await page.goto(target.href); await page.locator('.sm-prototype').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-step-panel="24"]:not([data-step-lazy]):not([hidden])'));
    const dialog = page.locator('.sm-focus-dialog');
    const select = async id => {
      if (id === 'root') { await page.keyboard.press('Escape'); await page.keyboard.press('Home'); }
      const title = page.locator(`.sm-map [data-map-focus="${id}"]`).last();
      if (await title.count()) { await title.focus(); await page.waitForTimeout(450); await title.click(); }
      else throw new Error(`Missing title ${id}`);
      await page.waitForFunction(id => document.querySelector('.sm-map [aria-current][data-map-focus]')?.dataset.mapFocus === id, id);
      await page.waitForTimeout(750);
    };
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(750);
    const viewer = page.locator('[data-map-native-viewer="source-route"]');
    await viewer.locator('.ds-code').first().waitFor({ state: 'attached' });
    const viewerOptions = viewer.locator('.sm-viewer-options > summary');
    await viewerOptions.focus(); await viewerOptions.click();
    await viewer.locator('.sm-viewer-options-pop').waitFor({ state: 'visible' });
    assert.ok(await viewer.locator('summary[aria-label="Repair this story step"]').evaluate(element => {
      const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && element.contains(hit);
    }), 'the final options row stays reachable above the canvas and playback dock');
    const callerToggle = viewer.locator('[data-callsite-toggle]');
    assert.ok(await callerToggle.evaluate(element => !!element.closest('.sm-viewer-toolbar')), 'caller toggle shares the viewing toolbar');
    await callerToggle.focus(); await callerToggle.click();
    assert.equal(await viewer.locator('.ds-callsite-pane').isHidden(), true);
    await callerToggle.click();
    assert.equal(await viewer.locator('.ds-callsite-pane').isVisible(), true);
    await viewerOptions.click();
    const full = viewer.getByRole('button', { name: 'Full file', exact: true });
    await full.focus(); await full.press('Enter');
    await viewer.locator('[data-full-inner] .ds-code').first().waitFor({ state: 'visible' });
    const scroll = viewer.locator('.ds-helper-scroll');
    await scroll.focus(); await page.waitForTimeout(250);
    const stored = await scroll.evaluate(element => { element.scrollTop = 300; element.scrollLeft = 100; window.fullscreenScroll = element; window.fullscreenPanel = element.closest('.sm-native-step'); return [element.scrollTop, element.scrollLeft]; });
    assert.ok(stored[0] > 0);
    await page.keyboard.down('f'); await dialog.waitFor(); await page.waitForTimeout(200);
    assert.ok(await dialog.evaluate(element => element.classList.contains('is-fullscreen') && element.offsetWidth === innerWidth && element.offsetHeight === innerHeight));
    assert.ok(await dialog.locator('.ds-helper-scroll').evaluate(element => element === window.fullscreenScroll && element.closest('.sm-native-step') === window.fullscreenPanel));
    assert.equal(await dialog.getByRole('button', { name: 'Full file', exact: true }).getAttribute('aria-pressed'), 'true');
    // A held F cannot immediately toggle the new view away.
    await page.keyboard.down('f'); await page.keyboard.up('f');
    assert.equal(await dialog.evaluate(element => element.classList.contains('is-fullscreen')), true);
    await dialog.locator('.sm-viewer-options > summary').click();
    const repair = dialog.locator('summary[aria-label="Repair this story step"]');
    await repair.click();
    const note = dialog.locator('textarea').first();
    if (await note.count()) {
      await note.focus(); await page.keyboard.press('f');
      assert.equal(await dialog.evaluate(element => element.classList.contains('is-fullscreen')), true, 'typing F does not toggle inspection');
    }
    await page.keyboard.press('Escape');
    assert.ok(await repair.evaluate(element => !element.closest('details').open && document.activeElement === element));
    assert.equal(await dialog.evaluate(element => element.classList.contains('is-fullscreen')), true, 'native menu owns the first Escape');
    await page.keyboard.press('Escape');
    assert.ok(await dialog.locator('.sm-viewer-options').evaluate(node => !node.open));
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(150);
    assert.deepEqual(await scroll.evaluate(element => [element.scrollTop, element.scrollLeft]), stored, 'fullscreen clamping preserves requested offsets');
    assert.ok(await scroll.evaluate(element => document.activeElement === element));
    await page.getByRole('button', { name: 'Expand card', exact: true }).click(); await dialog.waitFor();
    await page.keyboard.press('f'); await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    assert.ok(await dialog.evaluate(element => element.open && !element.classList.contains('is-fullscreen')), 'Escape returns to ordinary Focus when opened there');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await select('change');
    const diff = page.locator('[data-map-native-viewer="diff-change"]');
    await diff.locator('.ds-code').first().waitFor({ state: 'attached' });
    assert.ok(await diff.locator('.ds-diff-path').evaluate(element => element.title.includes('contracts/gateway/SymmioGatewayTypes.sol') && element.getAttribute('aria-label').includes('contracts/gateway/SymmioGatewayTypes.sol')), 'compact historical filename retains the full path for hover and assistive technology');
    await page.screenshot({ path: `${output}/${shotKey}-compact.png` });
    assert.ok(await diff.evaluate(element => {
      const toolbar = element.querySelector('.sm-viewer-toolbar');
      return toolbar.offsetHeight <= (element.clientWidth > 680 ? 45 : 89) && toolbar.contains(element.querySelector('.sm-viewer-revision')) && toolbar.contains(element.querySelector('.ds-step-actions'));
    }), 'one shared toolbar groups revision, modes and source actions above the panes');
    await page.locator('.sm-map [data-map-focus="change"]').last().focus();
    await page.keyboard.press('f'); await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.activeElement?.matches('.ds-diffscroll')), 'default fullscreen focus is the code viewport, not a horizontal scrollbar');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await diff.getByRole('button', { name: 'Split', exact: true }).focus();
    await diff.getByRole('button', { name: 'Split', exact: true }).click();
    await page.keyboard.press('f'); await page.waitForTimeout(200);
    assert.equal(await dialog.getByRole('button', { name: 'Split', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `${output}/${shotKey}-diff-fullscreen.png` });
    await dialog.locator('.sm-viewer-options > summary').click();
    await dialog.getByRole('button', { name: 'Source references', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(element => element.classList.contains('is-fullscreen')), true, 'Source popover owns Escape');
    await page.keyboard.press('f'); await dialog.waitFor({ state: 'hidden' });
    await diff.locator('.ds-diff-path').focus(); await diff.locator('.ds-diff-path').click();
    assert.equal(await diff.getByRole('button', { name: 'Full file', exact: true }).getAttribute('aria-pressed'), 'true', 'historical filename still opens its native complete file');
    // Root contains both diagram and source: F on the diagram enlarges that
    // media, while F on the card heading defaults to its native source viewer.
    await select('root');
    const diagram = page.locator(variant === 'C' ? '.sm-detail-column .sm-diagram' : '[data-map-node="root"] .sm-diagram');
    await diagram.focus(); await page.keyboard.press('f'); await page.waitForTimeout(100);
    assert.equal(await dialog.locator('.sm-diagram:visible').count(), 1);
    assert.equal(await dialog.locator('[data-map-native-viewer]:visible').count(), 0);
    if (width <= 600) assert.ok(await dialog.locator('.sm-diagram li').evaluateAll(items => items.every(item => { const box = item.getBoundingClientRect(); return box.width > 200 && box.height < 100; })), 'phone diagrams use readable full-width labels');
    await page.screenshot({ path: `${output}/${shotKey}-diagram-fullscreen.png` });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await diagram.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Home'); await page.keyboard.press('f'); await page.waitForTimeout(200);
    await dialog.locator('[data-map-native-viewer="source-root"] .ds-code').first().waitFor({ state: 'attached' });
    assert.equal(await dialog.locator('.sm-diagram:visible').count(), 0);
    assert.equal(await dialog.locator('[data-map-native-viewer]:visible').count(), 1);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.keyboard.press('f');
    assert.equal(await dialog.evaluate(element => element.open), false, 'text-only explanation cards retain ordinary Focus');
    assert.deepEqual(errors, []);
    console.log(`PASS ${variant}/${width}x${height}/${motion}: compact header, F/Escape, native state, exact scroll restoration, menu ownership, media targeting`);
    await page.close();
  }
} finally { await browser.close(); }
