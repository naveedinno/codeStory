// Exercise the shipped review route, page leases and real native viewer controls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../dist/server.js';
import { videoCapabilities } from '../dist/video-export.js';
import { loadTour } from '../dist/tour.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'codestory-map-app-'));
const repo = join(scratch, 'repo'), output = resolve(process.env.CODESTORY_MAP_APP_OUT || '/tmp/codestory-map-app-qa');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [join(root, 'examples/demo.mjs')], {
  cwd: root, env: { ...process.env, CODESTORY_DEMO_NO_SERVE: '1', CODESTORY_DEMO_DIR: repo }, stdio: 'pipe',
});
const storyPath = join(repo, '.codestory/story.json');
const story = JSON.parse(readFileSync(storyPath, 'utf8'));
story.version = 4;
story.steps.unshift({ id: 'interactive-page', kind: 'concept', order: 1, preparesFor: [story.steps[0].id],
  title: 'Interactive diagram', chapter: 'Diagram', narration: 'An interactive diagram retains its state.',
  page: '<!doctype html><html><body><button id="counter">0</button><script>window.count=0;document.querySelector("#counter").addEventListener("click",event=>{event.target.textContent=++window.count})</script></body></html>' });
story.steps.forEach((step, index) => { step.order = index + 1; step.chapter ||= 'Change'; });
writeFileSync(storyPath, JSON.stringify(story));
loadTour(storyPath);
let running = false, paused = false, batches = [], current = 1;
const status = () => ({ ok: true, service: 'aloud-speech-daemon', protocolVersion: 2, engine: 'fixture', jobId: 'map-test', running, paused,
  state: { status: running ? 'reading' : 'idle', current, total: batches.length } });
const server = serve({ repo, homeOverride: join(scratch, 'home'), port: 0, open: false, aloud: {
  async status() { return status(); }, async prepare() {},
  async speak(input) { batches = input.batches; running = true; return status(); },
  async control(action) { if (action === 'stop') running = false; paused = action === 'pause'; return status(); },
} });
await once(server, 'listening');
const url = `http://localhost:${server.address().port}/repo/${basename(repo)}/review?story=story.json`;
const browser = await chromium.launch({ executablePath: videoCapabilities().browser, headless: true });
try {
  for (const [name, width, motion] of [['desktop', 1440, 'no-preference'], ['mobile', 390, 'reduce']]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: motion, colorScheme: 'dark' });
    page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    page.on('request', request => requests.push(request.url()));
    await page.goto(url);
    try { await page.locator('.sm-map').waitFor(); } catch (error) {
      await page.screenshot({ path: join(output, `${name}-failure.png`) });
      console.error(page.url(), (await page.locator('body').innerText()).slice(0, 2400)); throw error;
    }
    await page.waitForFunction(() => document.querySelector('.sm-map [aria-current="location"]'));
    const data = await page.locator('#__CODESTORY_DATA__').evaluate(node => JSON.parse(node.textContent).storyMap);
    assert.equal(data.path.length, story.steps.length);
    assert.ok(!requests.some(url => url.includes('/_prototype/')), 'shipped mode needs no prototype server');
    assert.equal(await page.locator('[data-map-native-viewer]').count(), 0, 'root summary does not load media');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.waitForFunction(() => {
      const map = document.querySelector('.sm-map');
      return map?.dataset.mapOverview === 'false' && Number(map.dataset.mapZoom) >= 95;
    });
    assert.equal(await page.locator('.sm-map [data-map-node="root"] .sm-prose').isVisible(), true, 'entry starts at the readable story summary');
    await page.screenshot({ path: join(output, `${name}-entry.png`) });
    await page.waitForFunction(() => new URL(location.href).searchParams.get('card') === 'root');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === 'root');
    assert.equal(await page.locator('.sm-map [data-map-node="root"] .sm-prose').isVisible(), true, 'reload keeps the root summary rather than opening its shared native step');
    await page.getByRole('button', { name: 'Fit whole map', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sm-map')?.dataset.mapOverview === 'true');
    await page.screenshot({ path: join(output, `${name}-overview.png`) });
    await page.getByRole('button', { name: 'Find current card', exact: true }).click();
    await page.waitForFunction(() => {
      const map = document.querySelector('.sm-map');
      return map?.dataset.mapOverview === 'false' && Number(map.dataset.mapZoom) >= 95;
    });
    const byId = new Map(data.nodes.map(node => [node.id, node]));
    const parents = new Map(data.nodes.flatMap(node => node.children.map(id => [id, node])));
    const ancestors = id => parents.has(id) ? [...ancestors(parents.get(id).id), parents.get(id)] : [];
    const selected = id => page.waitForFunction(id => document.querySelector('.sm-map [data-map-focus][aria-current]')?.dataset.mapFocus === id, id);
    const key = async (key, id) => { await page.keyboard.press(key); await selected(id); };
    const visit = async id => {
      await page.locator('.sm-map [data-map-focus][aria-current]').focus();
      await key('Home', 'root');
      for (const node of [...ancestors(id), byId.get(id)].slice(1)) {
        const siblings = parents.get(node.id).children;
        await key('ArrowRight', siblings[0]);
        for (let i = 1; i <= siblings.indexOf(node.id); i++) await key('ArrowDown', siblings[i]);
      }
      await page.waitForTimeout(motion === 'reduce' ? 150 : 750);
    };
    const changeLayout = async variant => {
      await page.getByRole('button', { name: 'Map options', exact: true }).click();
      await page.getByRole('combobox', { name: 'Map layout', exact: true }).selectOption(variant);
      await page.getByRole('button', { name: 'Close map options', exact: true }).click();
      await page.waitForTimeout(200);
    };
    const codeNode = data.nodes.find(node => node.content.some(block => block.type === 'diff'));
    const chapterNode = data.nodes.find(node => node.structural === 'chapter');
    await visit(chapterNode.id);
    await page.reload();
    await selected(chapterNode.id);
    await visit(codeNode.id);
    const media = codeNode.content.find(block => block.type === 'diff');
    const viewer = page.locator(`[data-map-native-viewer="${media.viewerId}"]`);
    await viewer.locator('.ds-code:visible').first().waitFor();
    const linkedUrl = new URL(url);
    linkedUrl.searchParams.set('view', 'tour');
    linkedUrl.searchParams.set('step', String(codeNode.panelIndex));
    const linkedPosition = async () => {
      await selected(codeNode.id);
      await viewer.locator('.ds-code:visible').first().waitFor();
      await page.waitForFunction(({ index, count }) => document.querySelector('.sm-playback-label small')?.textContent === `Step ${index}/${count}`, { index: codeNode.panelIndex, count: story.steps.length });
      assert.equal(new URL(page.url()).searchParams.get('step'), String(codeNode.panelIndex), 'linked source step stays in the URL');
      assert.equal(await page.locator('.sm-map').getAttribute('data-map-overview'), 'false', 'linked source opens at readable scale');
    };
    await page.goto(linkedUrl.href);
    await linkedPosition();
    await page.reload();
    await linkedPosition();
    await viewer.evaluate(node => { window.savedMapViewer = node.firstElementChild; });
    await page.getByRole('button', { name: 'Focus current card', exact: true }).click();
    await page.locator('.sm-focus-dialog[open]').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('.sm-focus-dialog .sm-native-step') === window.savedMapViewer), true);
    await page.keyboard.press('Escape'); await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    await page.waitForTimeout(250);
    assert.equal(await viewer.evaluate(node => node.firstElementChild === window.savedMapViewer), true);
    await page.screenshot({ path: join(output, `${name}-code.png`) });
    await changeLayout('B');
    assert.equal(await viewer.evaluate(node => node.firstElementChild === window.savedMapViewer), true);
    await changeLayout('C');
    assert.equal(await viewer.evaluate(node => node.firstElementChild === window.savedMapViewer), true);
    await changeLayout('A');

    // Explanation leaves stay visibly selected after focus moves to controls,
    // and their titles use the same complete content width as other cards.
    const leaf = byId.get(codeNode.children[0]);
    await visit(leaf.id);
    const leafCard = page.locator(`.sm-map [data-map-node="${leaf.id}"]`);
    const leafTitle = leafCard.locator('[data-map-focus]');
    await page.getByRole('button', { name: 'Find current card', exact: true }).click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const geometry = await leafCard.evaluate(card => {
        const title = card.querySelector('[data-map-focus]'), heading = title.closest('h3');
        const style = getComputedStyle(card), color = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = rgb => rgb.map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
          .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        const a = luminance(color(style.borderTopColor)), b = luminance(color(style.backgroundColor));
        return { titleWidth: title.getBoundingClientRect().width, headingWidth: heading.getBoundingClientRect().width,
          contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), selected: card.classList.contains('is-current') };
      });
      assert.ok(geometry.selected, 'child remains selected when focus moves to map controls');
      assert.ok(Math.abs(geometry.titleWidth - geometry.headingWidth) < 1, 'child title uses the whole available heading width');
      assert.ok(geometry.contrast >= 3, `${theme} selected border is clearly distinct from the card: ${geometry.contrast}`);
      await page.screenshot({ path: join(output, `${name}-child-${theme}.png`) });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.keyboard.press('Tab');
    await leafTitle.focus();
    assert.equal(await leafTitle.evaluate(title => title.matches(':focus-visible')), true);
    await page.screenshot({ path: join(output, `${name}-child-keyboard.png`) });
    await page.keyboard.press('ArrowDown');
    await selected(codeNode.children[1]);
    assert.equal(await leafCard.evaluate(card => card.classList.contains('is-current')), false, 'selection leaves the previous explanation');

    const diagram = data.nodes.find(node => node.stepId === 'interactive-page');
    await visit(diagram.id);
    const frameSelector = `[data-map-native-viewer="${diagram.content[0].viewerId}"] iframe[src]`;
    await page.locator(frameSelector).waitFor();
    const frame = async () => (await page.locator(frameSelector).elementHandle()).contentFrame();
    await (await frame()).locator('#counter').click();
    assert.equal(await (await frame()).evaluate(() => window.count), 1, 'interactive fixture changed before Focus');
    await (await frame()).locator('body').press('f');
    await page.locator('.sm-focus-dialog.is-fullscreen[open]').waitFor();
    assert.equal(await (await frame()).evaluate(() => window.count), 1);
    await (await frame()).locator('body').press('Escape');
    await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    assert.equal(await (await frame()).evaluate(() => window.count), 1);
    await page.getByRole('button', { name: 'Focus current card', exact: true }).click();
    await page.locator('.sm-focus-dialog[open]').waitFor();
    await (await frame()).locator('body').press('Escape');
    await page.locator('.sm-focus-dialog').waitFor({ state: 'hidden' });
    await changeLayout('B');
    assert.equal(await (await frame()).evaluate(() => window.count), 1);
    await changeLayout('A');
    await page.screenshot({ path: join(output, `${name}-diagram.png`) });

    await page.locator('.sm-map [data-map-focus][aria-current]').focus();
    await key('Home', 'root');
    await page.locator('[data-readaloud]').click();
    await page.waitForFunction(() => document.querySelector('[data-readaloud]')?.getAttribute('aria-label')?.startsWith('Pause'));
    assert.ok(batches.length >= story.steps.length, 'normal mode queues the complete authored story');
    current = batches.length;
    await page.waitForFunction(count => document.querySelector('.sm-playback-label small')?.textContent === `Step ${count}/${count}`, story.steps.length);
    await page.locator('[data-aloud-stop]').click(); running = false; current = 1;
    await page.locator('[data-view=files]').click();
    await page.locator('.sm-prototype').waitFor({ state: 'hidden' });
    await page.locator('[data-view=tour]').click();
    await page.locator('.sm-map').waitFor();
    await page.locator('.ds-story-mode').click();
    await page.waitForURL(/mode=classic/);
    await page.locator('.ds-filmthread').waitFor();
    assert.equal(await page.locator('.sm-prototype').count(), 0);
    await page.getByRole('link', { name: 'Story map', exact: true }).click();
    await page.locator('.sm-map').waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: normal route, lazy leased viewers, Focus/Escape, A/B/C identity, interactive diagram state, narration and walkthrough switch`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); server.close(); rmSync(scratch, { recursive: true, force: true }); }
