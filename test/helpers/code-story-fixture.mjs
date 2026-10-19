// Shared fixtures for code-story tests: a committed repo, a valid code story,
// and a running app server whose page payloads can be read back.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { serve } from '../../dist/server.js';

/** A repo on `main` with a 30-line app.ts committed; `sha` is that commit. */
export function committedRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ds-code-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const lines = Array.from({ length: 30 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
  writeFileSync(join(dir, 'app.ts'), lines.join('\n') + '\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { dir, lines, sha: git('rev-parse', 'HEAD').trim() };
}

/** A generation-valid code story pinned at `sha` with one code step on app.ts. */
export function codeStory(sha, over = {}) {
  return {
    version: 4,
    subject: 'code',
    head: sha,
    mode: 'guided',
    title: 'How the funding rate is capped',
    summary: 'One helper caps the rate before settlement.',
    intent: {
      goal: 'You want to know how a rate above the market cap is stopped.',
      design: 'Settlement calls <code>capRate()</code>, which clamps the rate at the cap.',
      sources: ['code-derived'],
      nonGoals: ['Liquidation is a separate story.'],
    },
    storyArc: { shape: 'entry-implementation', readingPath: 'helper -> cap' },
    hotspots: [{ step: 's1', reason: 'The cap is inclusive, which is easy to misread.' }],
    steps: [{
      id: 's1', order: 1, kind: 'context', title: 'capRate() clamps the rate at the cap',
      file: 'app.ts', range: [10, 10], viewport: [5, 15], highlights: [[10, 10]],
      why: 'Rules out a rate above the cap reaching settlement.',
      beats: [{ text: 'This is <code>capRate()</code>, the helper settlement calls per market; it clamps the rate at the cap.', highlights: [[10, 10]] }],
    }],
    ...over,
  };
}

/** Write a story under `.diffstory/stories/` and return its path. */
export function writeCodeStory(dir, story, name = 'code-cap.json') {
  mkdirSync(join(dir, '.diffstory', 'stories'), { recursive: true });
  const path = join(dir, '.diffstory', 'stories', name);
  writeFileSync(path, JSON.stringify(story));
  return path;
}

/** Run `fn(base)` against an app server opened on `repo`, with a throwaway home. */
export async function withServer(repo, fn) {
  const home = mkdtempSync(join(tmpdir(), 'ds-code-home-'));
  const server = serve({ repo, port: 0, open: false, homeOverride: home });
  await once(server, 'listening');
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(home, { recursive: true, force: true });
  }
}

/** The `__DIFFSTORY_DATA__` payload of a page. */
export const shellPayload = (html) => JSON.parse(html.match(/id="__DIFFSTORY_DATA__">([\s\S]*?)<\/script>/)[1]);

/** Fetch `/repo/<name><path>` and return its payload. */
export const pageOf = async (base, dir, path) =>
  shellPayload(await (await fetch(`${base}/repo/${encodeURIComponent(basename(dir))}${path}`)).text());

/**
 * Run `fn` with a fake `claude` first on PATH. It writes `content` to the story
 * file its prompt names ("Write <file>" or "back to <file>") and reports the
 * write the way Claude's stream does, so a run reaches the finish gate without
 * any real agent. Never let an agent route reach the real CLI from a test.
 */
export async function withFakeWriter(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-fake-writer-'));
  const script = join(dir, 'writer.mjs');
  writeFileSync(
    script,
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const prompt = process.argv.join(' ');
const match = /(?:Write|back to) (\\.diffstory\\/stories\\/[^ ,]+\\.json)/.exec(prompt);
if (match) {
  mkdirSync(dirname(match[1]), { recursive: true });
  writeFileSync(match[1], ${JSON.stringify(content)});
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: match[1] } }] } }));
}
`,
  );
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    await fn();
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
}

/** POST an agent route and return its final run_done event. */
export async function runToEnd(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return lines.find((event) => event.type === 'run_done') ?? { status: `http ${res.status}`, lines };
}
