// The bundled checker, run exactly as an agent runs it: node <skill>/scripts/check-story.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('../skills/codestory-storyteller/scripts/check-story.mjs', import.meta.url));

/** A repo on `main` with one committed file and an uncommitted edit on line 10. */
function repoWithChange() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-check-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const lines = Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
  writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  lines[9] = 'export function capRate(rate: number, cap: number) { return Math.min(rate, cap); }';
  writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
  mkdirSync(join(dir, '.codestory'));
  return { dir, lines };
}

function goodStory(over = {}) {
  return {
    version: 3,
    mode: 'brief',
    title: 'Cap the funding rate',
    summary: 'One helper caps the rate before settlement.',
    base: 'main',
    intent: {
      goal: 'Rates above the market cap reached settlement.',
      design: 'Settlement already calls one per-market helper; capRate() now clamps there, so every market settles at or below its cap.',
      sources: ['conversation'],
    },
    storyArc: { changeType: 'bug-fix', shape: 'cause-effect', readingPath: 'helper -> cap' },
    steps: [{
      id: 's1', order: 1, kind: 'changed', title: 'capRate() clamps the rate at the cap',
      file: 'app.ts', range: [10, 10], viewport: [5, 15], highlights: [[10, 10]],
      why: 'Rules out a rate above the cap reaching settlement.',
      beats: [{ text: 'This is <code>capRate()</code>, the helper settlement calls per market; it clamps the rate at the cap.', highlights: [[10, 10]] }],
    }],
    ...over,
  };
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

function withRepo(fn) {
  const repo = repoWithChange();
  try { fn(repo); } finally { rmSync(repo.dir, { recursive: true, force: true }); }
}

test('--help prints usage and exits 0', () => {
  withRepo(({ dir }) => {
    const r = run(dir, '--help');
    assert.equal(r.code, 0);
    assert.match(r.out, /Usage: node check-story\.mjs/);
  });
});

test('a valid, fully covered story is READY', () => {
  withRepo(({ dir }) => {
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(goodStory()));
    const r = run(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESULT: READY/);
    assert.match(r.out, /coverage 1\/1 changed ranges claimed/);
  });
});

test('an unclaimed change is an error', () => {
  withRepo(({ dir, lines }) => {
    lines[24] = 'export const v25 = 2500;';
    writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(goodStory()));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /unexplained change: app\.ts 25-25/);
  });
});

test('basic contract failures stop the check early', () => {
  withRepo(({ dir }) => {
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(goodStory({ storyArc: 'mixed' })));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /storyArc must be an object/);
  });
});

test('lint errors fail the check and name the rule', () => {
  withRepo(({ dir }) => {
    const story = goodStory();
    story.steps[0].why = 'Uses **bold** Markdown.';
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(story));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /\[markdown-residue\]/);
  });
});

test('warnings pass by default and fail with --strict', () => {
  withRepo(({ dir }) => {
    const story = goodStory();
    story.steps[0].beats[0].text = 'The helper clamps the rate at the cap before settlement.';
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(story));
    assert.equal(run(dir).code, 0);
    const strict = run(dir, '--strict');
    assert.equal(strict.code, 1);
    assert.match(strict.out, /landing-missing-symbol/);
  });
});

test('--json reports machine-readable results', () => {
  withRepo(({ dir }) => {
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(goodStory()));
    const r = run(dir, '--json');
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ready, true);
    assert.equal(parsed.reports[0].story, '.codestory/story.json');
    assert.deepEqual(parsed.reports[0].errors, []);
  });
});

test('--ledger lists every changed range with its file', () => {
  withRepo(({ dir }) => {
    const r = run(dir, '--ledger');
    assert.equal(r.code, 0);
    assert.match(r.out, /app\.ts/);
    assert.match(r.out, /10-10/);
    const json = JSON.parse(run(dir, '--ledger', '--json').out);
    assert.deepEqual(json.files[0].ranges[0].range, [10, 10]);
  });
});

test('--ledger honors includeGlobs from .codestory/preferences.json', () => {
  withRepo(({ dir }) => {
    writeFileSync(join(dir, '.codestory/preferences.json'), JSON.stringify({ includeGlobs: ['**/*.sol'] }));
    const json = JSON.parse(run(dir, '--ledger', '--json').out);
    assert.deepEqual(json.files, []);
  });
});

test('no story is a setup error (exit 2)', () => {
  withRepo(({ dir }) => {
    const r = run(dir);
    assert.equal(r.code, 2);
    assert.match(r.out, /no story found/);
  });
});

/** The same repo as an agent finds it before the app reopens it after the rename. */
function withLegacyRepo(fn) {
  withRepo((repo) => {
    renameSync(join(repo.dir, '.codestory'), join(repo.dir, '.diffstory'));
    fn(repo);
  });
}

test('a repo the app has not opened since the rename is checked from .diffstory/, read-only', () => {
  withLegacyRepo(({ dir }) => {
    const story = JSON.stringify(goodStory());
    writeFileSync(join(dir, '.diffstory/story.json'), story);
    const r = run(dir, '--json');
    assert.equal(r.code, 0, r.out);
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ready, true);
    assert.equal(parsed.reports[0].story, '.diffstory/story.json');
    assert.deepEqual(parsed.unownedFiles, []);
    // The checker never writes: nothing is moved and no .codestory/ appears.
    assert.equal(existsSync(join(dir, '.codestory')), false);
    assert.equal(readFileSync(join(dir, '.diffstory/story.json'), 'utf8'), story);
  });
});

test('legacy scoped stories are found and still need storyScope.includedFiles', () => {
  withLegacyRepo(({ dir }) => {
    mkdirSync(join(dir, '.diffstory/stories'));
    writeFileSync(join(dir, '.diffstory/stories/cap.json'), JSON.stringify(goodStory()));
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /need storyScope\.includedFiles/);
  });
});

test('--ledger honors includeGlobs from a legacy .diffstory/preferences.json', () => {
  withLegacyRepo(({ dir }) => {
    writeFileSync(join(dir, '.diffstory/preferences.json'), JSON.stringify({ includeGlobs: ['**/*.sol'] }));
    const json = JSON.parse(run(dir, '--ledger', '--json').out);
    assert.deepEqual(json.files, []);
  });
});

test('once .codestory/ exists the legacy folder is not read', () => {
  withRepo(({ dir }) => {
    mkdirSync(join(dir, '.diffstory'));
    writeFileSync(join(dir, '.diffstory/story.json'), JSON.stringify(goodStory()));
    const r = run(dir);
    assert.equal(r.code, 2);
    assert.match(r.out, /no story found/);
  });
});

test('scoped stories under .codestory/stories/ need storyScope', () => {
  withRepo(({ dir }) => {
    mkdirSync(join(dir, '.codestory/stories'));
    writeFileSync(join(dir, '.codestory/stories/cap.json'), JSON.stringify(goodStory()));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /need storyScope\.includedFiles/);
  });
});

test('the committed checker bundle matches its sources', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'ds-bundle-')), 'check-story.mjs');
  const script = readFileSync(new URL('../scripts/build-skill-checker.mjs', import.meta.url), 'utf8');
  const banner = script.match(/js: '([^']+)'/)[1].replace(/\\n/g, '\n');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/story-check-cli.ts', import.meta.url))],
    outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    legalComments: 'none', logLevel: 'silent', banner: { js: banner },
  });
  assert.equal(readFileSync(out, 'utf8'), readFileSync(CHECKER, 'utf8'), 'run npm run build and commit skills/codestory-storyteller/scripts/check-story.mjs');
});

test('landing callers are verified by the checker', () => {
  withRepo(({ dir }) => {
    writeFileSync(join(dir, 'settle.ts'), "import { capRate } from './app';\nexport function settleFunding() { return capRate(1, 2); }\n");
    const good = goodStory();
    good.steps[0].landing = { symbol: 'capRate()', calledBy: ['settleFunding()'] };
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(good));
    const ok = run(dir);
    assert.doesNotMatch(ok.out, /landing/);
    const vague = goodStory();
    vague.steps[0].landing = { symbol: 'capRate()', calledBy: ['every settlement path'] };
    writeFileSync(join(dir, '.codestory/story.json'), JSON.stringify(vague));
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /is a description, not a symbol/);
  });
});

// ---- code stories: existing code at one pinned commit, no diff ----

function codeStory(sha, over = {}) {
  return {
    version: 4,
    subject: 'code',
    head: sha,
    mode: 'brief',
    title: 'How the funding rate is capped',
    summary: 'One helper caps the rate before settlement.',
    codeScope: { ref: 'main', question: 'How is the rate capped?' },
    intent: {
      goal: 'You want to know how a rate above the market cap is stopped.',
      design: 'Settlement calls <code>capRate()</code>, which clamps the rate at the cap.',
      sources: ['code-derived'],
    },
    storyArc: { shape: 'entry-implementation', readingPath: 'helper -> cap' },
    steps: [{
      id: 's1', order: 1, kind: 'context', title: 'capRate() clamps the rate at the cap',
      file: 'app.ts', range: [10, 10], viewport: [5, 15], highlights: [[10, 10]],
      why: 'Rules out a rate above the cap reaching settlement.',
      beats: [{ text: 'This is <code>capRate()</code>, the helper settlement calls per market; it clamps the rate at the cap.', highlights: [[10, 10]] }],
    }],
    ...over,
  };
}

function writeCodeStory(dir, story) {
  mkdirSync(join(dir, '.codestory/stories'), { recursive: true });
  writeFileSync(join(dir, '.codestory/stories/code-cap.json'), JSON.stringify(story));
  return '.codestory/stories/code-cap.json';
}

const commitAll = (dir) => {
  execFileSync('git', ['commit', '-qam', 'cap the rate'], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
};

test('the checker passes a code story under .codestory/stories without a storyScope', () => {
  withRepo(({ dir }) => {
    const sha = commitAll(dir);
    const r = run(dir, writeCodeStory(dir, codeStory(sha)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Code: main @ [0-9a-f]{7}/);
    assert.doesNotMatch(r.out, /Diff:/);
    assert.match(r.out, /RESULT: READY/);
  });
});

test('the checker flags a code step that runs past its file at the pinned commit', () => {
  withRepo(({ dir }) => {
    const sha = commitAll(dir);
    const story = codeStory(sha);
    Object.assign(story.steps[0], {
      range: [28, 28],
      viewport: [25, 40],
      highlights: [[28, 28]],
      beats: [{ text: 'This is <code>v28</code>, the export settlement reads last.', highlights: [[28, 28]] }],
    });
    const r = run(dir, writeCodeStory(dir, story));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /viewport 25-40 runs past the end of app\.ts \(30 lines at [0-9a-f]{7}\)/);
  });
});

test('the checker warns when a visited file has uncommitted edits', () => {
  withRepo(({ dir }) => {
    // repoWithChange leaves an uncommitted edit on line 10; the story explains HEAD.
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const r = run(dir, writeCodeStory(dir, codeStory(sha)));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[code-at-commit\]/);
    assert.match(r.out, /git show [0-9a-f]{7}:app\.ts/);
  });
});
