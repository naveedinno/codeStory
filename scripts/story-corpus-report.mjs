#!/usr/bin/env node
// Lints every codeStory story under the given roots (default ~/Codes) and
// prints a Markdown report: basic validity, generation-contract errors, and
// lint findings by rule. No coverage check: a story's diff has usually moved
// on since it was written. Read-only.
//
//   npm run build
//   node scripts/story-corpus-report.mjs [root ...] [--since YYYY-MM-DD]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { validateGeneratedTour, validateTour } from '../dist/tour.js';
import { lintStory } from '../dist/story-lint.js';

const args = process.argv.slice(2);
const sinceAt = args.indexOf('--since');
const since = sinceAt >= 0 ? Date.parse(args[sinceAt + 1]) : 0;
if (sinceAt >= 0 && Number.isNaN(since)) {
  console.error('--since needs a date like 2026-09-25');
  process.exit(2);
}
const roots = args.filter((a, i) => !a.startsWith('--') && i !== sinceAt + 1);
if (!roots.length) roots.push(join(homedir(), 'Codes'));

// A repo the app has not opened since the codeStory rename still keeps its
// stories under the pre-rename folder; read both, as the bundled checker does.
const DATA_DIRS = new Set(['.codestory', '.diffstory']);

// Heavy or duplicate trees: dependencies, build output, eval/agent worktrees.
const SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'out', 'worktrees', 'vendor', 'lib']);

function* storyFiles(dir, depth = 0) {
  if (depth > 7) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (DATA_DIRS.has(entry.name)) {
      const single = join(path, 'story.json');
      if (existsSync(single)) yield single;
      const scoped = join(path, 'stories');
      if (existsSync(scoped)) {
        for (const name of readdirSync(scoped).sort()) if (name.endsWith('.json')) yield join(scoped, name);
      }
      continue;
    }
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    yield* storyFiles(path, depth + 1);
  }
}

const rows = [];
const totals = {};
for (const root of roots) {
  for (const file of storyFiles(root)) {
    if (statSync(file).mtimeMs < since) continue;
    const repo = file.slice(0, file.search(/\/\.(codestory|diffstory)\//));
    const name = `${relative(root, repo) || '.'} :: ${file.slice(repo.length + 12)}`;
    let tour;
    try {
      tour = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      rows.push({ name, note: 'unreadable JSON' });
      continue;
    }
    for (const step of tour?.steps ?? []) if (step?.kind === 'deleted') step.kind = 'changed';
    const basic = validateTour(tour);
    if (basic.length) {
      rows.push({ name, version: tour?.version, steps: tour?.steps?.length ?? 0, basic: basic.length });
      continue;
    }
    const contract = validateGeneratedTour(tour).length;
    const readLines = (f) => {
      const p = join(repo, f);
      return existsSync(p) ? readFileSync(p, 'utf8').split('\n') : null;
    };
    const findings = lintStory(tour, { readLines });
    const byRule = {};
    for (const f of findings) {
      const key = `${f.severity === 'error' ? 'E' : 'W'} ${f.rule}`;
      byRule[key] = (byRule[key] ?? 0) + 1;
      totals[key] = (totals[key] ?? 0) + 1;
    }
    rows.push({
      name,
      version: tour.version,
      steps: tour.steps.length,
      basic: 0,
      contract,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      top: Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} x${v}`).join(', '),
    });
  }
}

const cell = (v) => (v === undefined ? '-' : String(v).replace(/\|/g, '\\|'));
console.log(`# Story corpus report\n\n${rows.length} stories under ${roots.join(', ')}${since ? ` modified since ${args[sinceAt + 1]}` : ''}.\n`);
console.log('| story | v | steps | basic errors | contract errors | lint E | lint W | top findings |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(`| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.steps)} | ${cell(r.basic ?? r.note)} | ${cell(r.contract)} | ${cell(r.errors)} | ${cell(r.warnings)} | ${cell(r.top)} |`);
}
console.log('\n## Totals by rule\n');
for (const [rule, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`- ${rule}: ${n}`);
const clean = rows.filter((r) => r.basic === 0 && r.contract === 0 && r.errors === 0).length;
console.log(`\n${clean} of ${rows.length} stories pass basic validation, the generation contract, and lint errors.`);
