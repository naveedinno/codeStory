// The reader for a code story, rendered from the server's real payload.
//
// The review surfaces render once and hand the DOM to the engine, so their
// first render IS their markup. These tests bundle the components, feed them
// the payload a running server produces for a code story, and read the
// static markup back: the copy and structure a reader sees before any script.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { codeStory, committedRepo, pageOf, withServer, writeCodeStory } from './helpers/code-story-fixture.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bundleDir = mkdtempSync(join(tmpdir(), 'ds-reader-bundle-'));
let render;

before(async () => {
  // Browser-only globals the components touch during their first render:
  // StoryHealthRow seeds state from `window`, and motion checks element types.
  const quiet = { addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  globalThis.window ??= { ...quiet, matchMedia: () => ({ matches: false, ...quiet }) };
  globalThis.SVGElement ??= class SVGElement {};
  globalThis.HTMLElement ??= class HTMLElement {};
  const outfile = join(bundleDir, 'surfaces.mjs');
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { StoryView } from './client/surfaces/review/StoryView';
        import { ReviewPage } from './client/surfaces/review/ReviewView';
        import { Sidebar } from './client/surfaces/review/Sidebar';
        import { ReviewApp } from './client/surfaces/review/ReviewApp';
        import { ExplainApp } from './client/surfaces/explain/ExplainApp';
        import { StoriesApp } from './client/surfaces/stories/StoriesApp';
        const views = { StoryView, ReviewPage, Sidebar, ReviewApp, ExplainApp, StoriesApp };
        export const render = (name, payload) => renderToStaticMarkup(createElement(views[name], { payload }));
      `,
      resolveDir: ROOT,
      loader: 'tsx',
      sourcefile: 'reader-entry.tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    jsx: 'automatic',
    outfile,
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
    // React's server build is CommonJS and requires node built-ins at runtime.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  ({ render } = await import(outfile));
});

after(() => rmSync(bundleDir, { recursive: true, force: true }));

/** Payloads for a code story (and the same repo's diff page), after `prepare` runs. */
async function payloads(prepare = () => {}) {
  const repo = committedRepo();
  try {
    writeCodeStory(repo.dir, codeStory(repo.sha, { codeScope: { ref: 'main', question: 'How is the rate capped?' } }));
    prepare(repo);
    const out = {};
    await withServer(repo.dir, async (base) => {
      out.code = await pageOf(base, repo.dir, '/review?story=stories/code-cap.json');
      out.diff = await pageOf(base, repo.dir, '/diff');
    });
    return { ...out, sha: repo.sha };
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

test('a code story overview names its commit and drops change language', async () => {
  const { code, sha } = await payloads();
  const html = render('StoryView', code);
  assert.match(html, /The story of this code/);
  assert.match(html, new RegExp(`Explains <b>main</b> at <b>${sha.slice(0, 7)}</b>`));
  assert.match(html, /Code unchanged since [0-9a-f]{7}/);
  assert.match(html, /Your question/);
  assert.match(html, /How is the rate capped\?/);
  assert.match(html, /Read these closely/);
  assert.match(html, /Not covered here/);
  assert.match(html, /Files in this story/);
  assert.doesNotMatch(html, /The story of this change/);
  assert.doesNotMatch(html, /Working tree vs/);
  assert.doesNotMatch(html, /distrust/);
  assert.doesNotMatch(html, /Rewrite at current code/);
});

test('a drifted code story offers a rewrite at the current code', async () => {
  const { code } = await payloads(({ dir, lines }) => writeFileSync(join(dir, 'app.ts'), lines.slice(1).join('\n') + '\n'));
  const html = render('StoryView', code);
  assert.match(html, /1 story file changed since [0-9a-f]{7}/);
  assert.match(html, /href="\/repo\/[^"]+\/explain\?story=stories%2Fcode-cap\.json"/);
  assert.match(html, /Rewrite at current code/);
});

test('a code story review page opens on comments without coverage or challenge', async () => {
  const { code } = await payloads();
  const html = render('ReviewPage', code);
  assert.match(html, /data-review-tab="notes"/);
  assert.doesNotMatch(html, /data-review-tab-select="coverage"/);
  assert.doesNotMatch(html, /data-review-tab-select="challenge"/);
  assert.doesNotMatch(html, /ds-trustpill/);
  assert.match(html, /Questions and notes/);
  assert.match(html, /href="\/repo\/[^"]+\/explain"/);
});

test('a code story names its files tab Files while a diff review keeps All files', async () => {
  const { code, diff } = await payloads();
  assert.match(render('ReviewApp', code), /id="ds-tab-files"[^>]*>Files</);
  assert.match(render('ReviewApp', diff), /id="ds-tab-files"[^>]*>All files</);
});

test('the code story sidebar talks about code, not a change', async () => {
  // An uncommitted edit gives the diff page a changed file, so it draws its filters too.
  const { code, diff } = await payloads(({ dir, lines }) => writeFileSync(join(dir, 'app.ts'), [...lines, '// edit'].join('\n') + '\n'));
  const html = render('Sidebar', code);
  assert.match(html, /The code at a glance/);
  assert.match(html, /Search paths, symbols, or code/);
  assert.doesNotMatch(html, /data-file-filter="unexplained"/);
  assert.match(render('Sidebar', diff), /data-file-filter="unexplained"/);
});

// ---- the Explain code page and its entry points ----

/** Payloads for the explain page (optionally a rewrite) and review history. */
async function explainPayloads({ prepare = () => {}, story } = {}) {
  const repo = committedRepo();
  try {
    writeCodeStory(repo.dir, codeStory(repo.sha, { codeScope: { ref: 'main', question: 'How is the rate capped?', paths: ['app.ts'] } }));
    prepare(repo);
    const out = {};
    await withServer(repo.dir, async (base) => {
      out.explain = await pageOf(base, repo.dir, story ? `/explain?story=${encodeURIComponent(story)}` : '/explain');
      out.stories = await pageOf(base, repo.dir, '/stories');
    });
    return { ...out, sha: repo.sha };
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

test('the explain page asks a question and names the commit it explains', async () => {
  const { explain, sha } = await explainPayloads();
  const html = render('ExplainApp', explain);
  assert.match(html, /Explain the code/);
  assert.match(html, /What do you want to understand\?/);
  assert.match(html, /<textarea[^>]*name="question"/);
  assert.match(html, /<textarea[^>]*name="paths"/);
  assert.match(html, /<input[^>]*name="ref"[^>]*value="main"/);
  assert.match(html, new RegExp(`${sha.slice(0, 7)} base`));
  assert.match(html, /Write code story/);
  assert.doesNotMatch(html, /Uncommitted changes/);
});

test('the explain page says uncommitted edits are not part of the story', async () => {
  const { explain } = await explainPayloads({
    prepare: ({ dir, lines }) => writeFileSync(join(dir, 'app.ts'), [...lines, '// edit'].join('\n') + '\n'),
  });
  assert.match(render('ExplainApp', explain), /Uncommitted changes are not part of the story/);
});

test('a rewrite pre-fills the request and keeps the old version in history', async () => {
  const { explain } = await explainPayloads({ story: 'stories/code-cap.json' });
  const html = render('ExplainApp', explain);
  assert.match(html, /Rewriting “How the funding rate is capped”/);
  assert.match(html, /<textarea[^>]*name="question"[^>]*>How is the rate capped\?<\/textarea>/);
  assert.match(html, /<textarea[^>]*name="paths"[^>]*>app\.ts<\/textarea>/);
  assert.match(html, /Rewrite code story/);
});

test('review history offers Explain code', async () => {
  const { stories } = await explainPayloads();
  const html = render('StoriesApp', stories);
  assert.match(html, /href="\/repo\/[^"]+\/explain"[^>]*>Explain code</);
});

test('a code story row in review history reads as code, and says when it moved on', async () => {
  const repo = committedRepo();
  try {
    writeCodeStory(repo.dir, codeStory(repo.sha, { codeScope: { ref: 'main' } }));
    writeFileSync(join(repo.dir, 'app.ts'), repo.lines.slice(1).join('\n') + '\n');
    let stories;
    await withServer(repo.dir, async (base) => {
      stories = await pageOf(base, repo.dir, '/stories?evidence=refresh');
    });
    const row = stories.stories.find((story) => story.id === 'stories/code-cap.json');
    assert.equal(row.subject, 'code');
    const html = render('StoriesApp', stories);
    assert.match(html, /Code story/);
    assert.match(html, /Code changed/);
    assert.match(html, new RegExp(`1 story file changed since ${repo.sha.slice(0, 7)}`));
    assert.match(html, /Read story/);
    assert.match(html, new RegExp(`main @ ${repo.sha.slice(0, 7)}`));
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('a code story whose commit is missing names the problem and offers the rewrite', async () => {
  const repo = committedRepo();
  try {
    writeCodeStory(repo.dir, codeStory('f'.repeat(40), { codeScope: { ref: 'main' } }));
    let code;
    await withServer(repo.dir, async (base) => {
      code = await pageOf(base, repo.dir, '/review?story=stories/code-cap.json');
    });
    const html = render('StoryView', code);
    assert.match(html, /Commit fffffff is not in this repository/);
    assert.match(html, /href="\/repo\/[^"]+\/explain\?story=stories%2Fcode-cap\.json"/);
    assert.doesNotMatch(html, /Can’t compare/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});
