// Code stories explain existing code at one pinned commit. This module is their
// git-facing half: proving a story's evidence exists at its commit, noticing
// when the code it visits has moved on, and naming where an app-written story
// goes. The story's shape is validated in tour.ts beside every other contract.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';
import { assertSafeRepoPath, readWholeFile, resolveCommit } from './git.js';
import { isCodeStep, type Tour } from './types.js';

/** Whether the code a story visits still matches the commit it explains. */
export interface CodeStoryDrift {
  /** `missing-commit`: the commit is not in this repository (a story written elsewhere). */
  state: 'current' | 'changed' | 'missing-commit' | 'unverified';
  /** Visited files whose working-tree content differs from the commit. */
  files: string[];
}

const SLUG_MAX = 48;
const DEFAULT_SLUG = 'code-codebase-tour';

/** Every file a code step shows, sorted and unique. */
export function codeStoryFiles(tour: Tour): string[] {
  return [...new Set(tour.steps.filter(isCodeStep).map((step) => step.file))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Tracked files whose working-tree content differs from `commit`, deletions
 * included. Without `files` the whole tree is compared (app data excluded);
 * an empty list compares nothing. `null` means git could not answer.
 */
export function changedSinceCommit(repo: string, commit: string, files?: string[]): string[] | null {
  if (!/^[0-9a-f]{40}$/i.test(commit)) return null;
  let paths: string[] | null = null;
  if (files) {
    paths = files.filter((file) => {
      try {
        assertSafeRepoPath(file);
        return true;
      } catch {
        return false;
      }
    });
    if (!paths.length) return [];
  }
  const args = paths
    ? ['--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames', commit, '--', ...paths]
    : ['diff', '--name-only', '-z', '--no-renames', commit, '--', '.', `:(exclude)${DATA_DIR}`];
  try {
    const out = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [...new Set(out.split('\0').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

/** True when `path` (a file or a directory) exists in the tree of `commit`. */
export function pathExistsAtCommit(repo: string, commit: string, path: string): boolean {
  try {
    assertSafeRepoPath(path);
    execFileSync('git', ['cat-file', '-e', `${commit}:${path}`], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True when `commit` names a commit object that exists in this repository. */
function knownCommit(repo: string, commit: string | undefined): commit is string {
  return !!commit && resolveCommit(repo, commit)?.toLowerCase() === commit.toLowerCase();
}

/**
 * Prove a code story's evidence exists at its pinned commit: the commit is
 * here, every shown file exists at it, and no camera or highlight runs past a
 * file's last line. Working-tree edits to shown files are not errors (the app
 * reads the commit, not the tree); they come back as `worktreeDrift`.
 */
export function verifyCodeStoryEvidence(
  repo: string,
  tour: Tour,
): { errors: string[]; worktreeDrift: string[] } {
  const head = tour.head ?? '';
  const short = head.slice(0, 7);
  if (!knownCommit(repo, head)) {
    return {
      errors: [`head ${short || '(none)'} is not a commit in this repository; this code story was written somewhere else`],
      worktreeDrift: [],
    };
  }
  const errors: string[] = [];
  const lineCounts = new Map<string, number | null>();
  const countLines = (file: string): number | null => {
    if (!lineCounts.has(file)) lineCounts.set(file, readWholeFile(repo, file, head)?.length ?? null);
    return lineCounts.get(file) ?? null;
  };
  for (const step of tour.steps) {
    if (!isCodeStep(step)) continue;
    const where = `steps[${step.id}]`;
    const lines = countLines(step.file);
    if (lines === null) {
      errors.push(
        pathExistsAtCommit(repo, head, step.file)
          ? `${where}.file ${step.file} is too large to show at ${short}; pick a smaller file`
          : `${where}.file ${step.file} does not exist at ${short}`,
      );
      continue;
    }
    const spans: Array<[string, [number, number] | undefined]> = [
      ['range', step.range],
      ['viewport', step.viewport],
      ...(step.highlights ?? []).map((span, i): [string, [number, number]] => [`highlights[${i}]`, span]),
      ...(step.beats ?? []).flatMap((beat, b) =>
        (beat.highlights ?? []).map((span, i): [string, [number, number]] => [`beats[${b}].highlights[${i}]`, span]),
      ),
    ];
    for (const [field, span] of spans) {
      if (!span || span[1] <= lines) continue;
      errors.push(
        `${where}.${field} ${span[0]}-${span[1]} runs past the end of ${step.file} (${lines} lines at ${short})`,
      );
    }
  }
  return { errors, worktreeDrift: changedSinceCommit(repo, head, codeStoryFiles(tour)) ?? [] };
}

/** Whether the files a code story visits have changed since its commit. */
export function codeStoryDrift(repo: string, tour: Tour): CodeStoryDrift {
  if (!knownCommit(repo, tour.head)) return { state: 'missing-commit', files: [] };
  const changed = changedSinceCommit(repo, tour.head, codeStoryFiles(tour));
  if (changed === null) return { state: 'unverified', files: [] };
  return changed.length ? { state: 'changed', files: changed } : { state: 'current', files: [] };
}

/** "main @ 1a2b3c4", or the short id alone when no distinct ref was named. */
export function codeStoryScope(tour: Tour): { label: string; command: string } {
  const head = tour.head ?? '';
  const short = head.slice(0, 7);
  const ref = tour.codeScope?.ref?.trim();
  const sameAsHead = !!ref && /^[0-9a-f]{7,40}$/i.test(ref) && head.toLowerCase().startsWith(ref.toLowerCase());
  return {
    label: ref && !sameAsHead ? `${ref} @ ${short}` : short,
    command: head ? `git show ${head}` : '',
  };
}

/** A filename stem for an app-written code story, from what the reader asked. */
export function codeStorySlug(input: { question?: string; paths?: string[] }): string {
  const source = input.question?.trim() || input.paths?.find((path) => path.trim())?.trim() || '';
  const words = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!words) return DEFAULT_SLUG;
  const slug = `code-${words}`;
  if (slug.length <= SLUG_MAX) return slug;
  const cut = slug.slice(0, SLUG_MAX);
  const atWord = cut.slice(0, cut.lastIndexOf('-'));
  return (atWord.length > 'code-'.length ? atWord : cut).replace(/-+$/, '');
}

/** `.diffstory/stories/<slug>.json`, numbered `-2`, `-3`, … when the name is taken. */
export function codeStoryOutputPath(repo: string, slug: string): string {
  const dir = join(repo, DATA_DIR, 'stories');
  let candidate = join(dir, `${slug}.json`);
  for (let n = 2; existsSync(candidate); n += 1) candidate = join(dir, `${slug}-${n}.json`);
  return candidate;
}
