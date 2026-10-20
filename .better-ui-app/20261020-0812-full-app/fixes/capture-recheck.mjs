// Repository Playwright capture workflow. All app data lives in temporary fixtures.
import { chromium } from 'playwright-core';
import { serve } from '../../../dist/server.js';
import { once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, readFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const out = new URL('./screens/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'codestory-ui-recheck-'));
const repo = join(scratch, 'review-demo');
execFileSync(process.execPath, ['examples/demo.mjs'], { env: { ...process.env, CODESTORY_DEMO_NO_SERVE: '1', CODESTORY_DEMO_DIR: repo }, stdio: 'pipe' });
const server = serve({ repo, homeOverride: join(scratch, 'home'), port: 0, open: false });
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync), headless: true });
const evidence = { captures: [], checks: [], errors: [] };
const base = '/repo/review-demo';
async function context(width = 1440, theme = 'dark', options = {}) {
  const c = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 960 }, colorScheme: theme, ...options });
  await c.addInitScript(theme => localStorage.setItem('ds-theme', theme), theme);
  const p = await c.newPage();
  p.setDefaultTimeout(7000);
  p.on('pageerror', error => evidence.errors.push(error.message));
  return [c, p];
}
async function settle(p) { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400); }
async function shot(p, name) {
  await settle(p);
  await p.screenshot({ path: join(out, name + '.png') });
  evidence.captures.push({ name, url: p.url(), ...await p.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, title: document.title })) });
}
try {
  for (const width of [1440, 375, 320]) for (const theme of ['dark', 'light']) {
    const [c, p] = await context(width, theme);
    for (const [name, route] of [['picker', '/repos'], ['stories', `${base}/stories`], ['change', `${base}/change?base=main&head=feat%2Fspending-limit`], ['review', `${base}/review?story=story.json`], ['explain', `${base}/explain`], ['404', '/repo/missing-review/page']]) {
      await p.goto(origin + route);
      await shot(p, `${name}-${width}-${theme}`);
      if (name === 'review' && width === 320) { const bounds = await p.locator('.ds-reviewchrome-utilities .ds-back').boundingBox(); evidence.checks.push({ scenario: 'review close reachable 320 ' + theme, bounds, inside: !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320 }); }
    }
    await c.close();
  }
  // Long repository + branch, and long basename use real isolated Git fixtures.
  const longRepo = join(scratch, 'repository-' + 'x'.repeat(90));
  cpSync(repo, longRepo, { recursive: true });
  const longBranch = 'feature/' + 'long-branch-'.repeat(12);
  execFileSync('git', ['checkout', '-b', longBranch], { cwd: longRepo, stdio: 'pipe' });
  const longStoryFile = join(longRepo, '.codestory/story.json');
  const longStory = JSON.parse(readFileSync(longStoryFile, 'utf8'));
  longStory.head = longBranch;
  writeFileSync(longStoryFile, JSON.stringify(longStory));
  writeFileSync(join(longRepo, 'long-file-' + 'x'.repeat(100) + '.txt'), 'long filename\n');
  const [c, p] = await context(375);
  await p.goto(origin + '/repos');
  await p.evaluate(async path => { await fetch('/api/repo/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }); }, longRepo);
  await p.goto(origin + '/repos');
  await shot(p, 'stress-long-repo-branch-375');
  await p.goto(`${origin}/repo/${basename(longRepo)}/change?scope=uncommitted`);
  await shot(p, 'stress-long-basename-375');
  await p.goto(`${origin}/repo/${basename(longRepo)}/stories`);
  await shot(p, 'stress-long-history-375');
  await p.evaluate(async path => { await fetch('/api/repo/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }); }, repo);
  await c.close();
  // Actual browser media emulation, with selectors sampled after a file disclosure.
  const [reduced, rp] = await context(375, 'light', { reducedMotion: 'reduce', forcedColors: 'active', contrast: 'more' });
  await rp.goto(origin + `${base}/review?story=story.json`);
  await shot(rp, 'review-forced-colors-reduced-more-375');
  evidence.checks.push({ scenario: 'forced-colors/reduced-motion', result: await rp.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion:reduce)').matches, forced: matchMedia('(forced-colors:active)').matches, contrast: matchMedia('(prefers-contrast:more)').matches, carets: [...document.querySelectorAll('.ds-filetree-caret,.ds-storyscope-caret')].map(n => getComputedStyle(n).transitionDuration) })) });
  await reduced.close();
  // Root-font stress is labelled accurately, and is not native browser zoom.
  const [large, lp] = await context(1440);
  await lp.goto(origin + `${base}/review?story=story.json`);
  await lp.evaluate(() => document.documentElement.style.fontSize = '200%');
  await shot(lp, 'review-root-font-200pct');
  await large.close();
  // Unknown refs get an inline error; valid Git expressions are not limited to suggestions.
  const [refsContext, refsPage] = await context(375);
  await refsPage.goto(origin + `${base}/change?scope=commit&commit=HEAD`);
  const refField = refsPage.locator('#commitRef');
  await refField.fill('unknown-ui-ref-for-recheck');
  await refField.press('Enter');
  await refsPage.waitForFunction(() => document.querySelector('#commitRef')?.getAttribute('aria-invalid') === 'true');
  evidence.checks.push({ scenario: 'unknown ref', value: await refField.inputValue(), invalid: await refField.getAttribute('aria-invalid') });
  await shot(refsPage, 'change-invalid-ref-375');
  await refField.fill('HEAD~1');
  await refField.press('Enter');
  await refsPage.waitForURL(url => url.searchParams.get('commit') === 'HEAD~1');
  evidence.checks.push({ scenario: 'valid Git expression', url: refsPage.url() });
  await refsPage.goto(origin + `${base}/change?base=main&head=feat%2Fspending-limit`);
  await refsPage.setViewportSize({width:650,height:960});
  await shot(refsPage, 'change-container-650');
  await refsPage.evaluate(() => document.documentElement.dir = 'rtl');
  await shot(refsPage, 'change-rtl-650');
  await refsContext.close();
  // Draft restoration uses the real navigation and sessionStorage behavior.
  const [draft, dp] = await context();
  await dp.goto(origin + `${base}/explain`);
  const question = dp.locator('textarea').first();
  await question.fill('How is the monthly cap checked?');
  await dp.goto(origin + `${base}/stories`);
  await dp.goto(origin + `${base}/explain`);
  evidence.checks.push({ scenario: 'Explain draft round trip', restored: await question.inputValue() });
  await shot(dp, 'explain-restored-draft');
  await draft.close();
  const storyPath = join(repo, '.codestory/story.json');
  const originalStory = readFileSync(storyPath, 'utf8');
  const story = JSON.parse(originalStory);
  const example = story.steps.find(step => step.kind === 'changed');
  while (story.steps.length < 42) story.steps.push({ ...example, id: 'stress-' + story.steps.length, order: story.steps.length + 1 });
  writeFileSync(storyPath, JSON.stringify(story));
  const [many, mp] = await context(375);
  await mp.goto(origin + `${base}/review?story=story.json`);
  await mp.locator('.ds-intro-start').click();
  await shot(mp, 'stress-42-steps-375');
  evidence.checks.push({ scenario: '42 steps', nodes: await mp.locator('.ds-filmnode').count() });
  await many.close();
  const singleStory = {version: 2, title: 'One boundary', summary: 'Review one changed range.', base: 'main', head: 'feat/spending-limit', steps: [{id:'single-step',order:1,kind:'changed',title:'Check the request boundary',file:example.file,range:example.range,why:'Read the decision before placement.'}]};
  writeFileSync(storyPath, JSON.stringify(singleStory));
  const [one, op] = await context(375);
  await op.goto(origin + `${base}/review?story=story.json`);
  await settle(op);
  if (await op.locator('.ds-intro-start').count()) await op.locator('.ds-intro-start').click();
  await shot(op, 'stress-one-step-375');
  evidence.checks.push({ scenario: 'one step', nodes: await op.locator('.ds-filmnode').count() });
  await one.close();
  writeFileSync(storyPath, originalStory);
} finally {
  writeFileSync(new URL('./runtime-recheck.json', import.meta.url), JSON.stringify(evidence, null, 2));
  writeFileSync(new URL('./runtime-recheck.md', import.meta.url), '# Runtime recheck\n\nRepository Playwright capture workflow, isolated app home and temporary Git repositories. Desktop Chromium emulation; no physical-device or screen-reader claims. Root-font-200pct is font stress, not native browser zoom.\n\n' + evidence.captures.map(c => `- screens/${c.name}.png: ${c.width}px, overflow ${c.overflow}px, ${c.title}`).join('\n') + '\n\nChecks:\n```json\n' + JSON.stringify(evidence.checks, null, 2) + '\n```\n\nPage errors:\n```json\n' + JSON.stringify(evidence.errors, null, 2) + '\n```\n');
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ captures: evidence.captures.length, overflows: evidence.captures.filter(c => c.overflow > 0), errors: evidence.errors }));
