// Presentation helpers for the scope picker, ported from `src/change-page.ts`.
//
// All four were server-side functions there. They move here because the payload
// carries raw values (a path, two line counts) and the formatting — the
// directory/basename split, the add/delete proportion bar, the generated-output
// partition — is presentation.

import type { ChangeFileView } from "../../../src/payloads";

const countFormatter = new Intl.NumberFormat("en-US");

/** Preserve compact small counts; group five-figure totals for scanning. */
export function formatCount(value: number): string {
  return Math.abs(value) >= 10_000 ? countFormatter.format(value) : String(value);
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** `["src/deep/", "file.ts"]` — the directory keeps its trailing slash. */
export function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}

/**
 * Build output and lockfiles, which are collapsed into a separate disclosure so
 * they never pad the primary reading list. Verbatim from the two expressions in
 * `change-page.ts`; the second one is deliberately anchored at a path segment
 * so `src/my-package-lock.json` is NOT treated as generated.
 */
export function generatedOutput(path: string): boolean {
  return (
    /^(dist|build|coverage|out|target)\//.test(path) ||
    /(^|\/)([^/]+\.generated\.[^/]+|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)
  );
}

export interface Totals {
  added: number;
  removed: number;
}

/** Summed over EVERY file, generated output included — as the ledger did. */
export function totals(files: ChangeFileView[]): Totals {
  return files.reduce<Totals>(
    (acc, file) => ({ added: acc.added + (file.added ?? 0), removed: acc.removed + (file.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
}

/** Width of the green half of a row's proportion bar, in percent. */
export function addShare(file: ChangeFileView): number {
  if (file.added === null || file.removed === null) return 0;
  const changed = Math.max(1, file.added + file.removed);
  return Math.round((file.added / changed) * 100);
}

/**
 * Carry the resolved scope onto the `/diff` link so the viewer diffs the same
 * two revs the picker resolved. Empty when neither is set.
 */
export function scopeQuery(base?: string, head?: string): string {
  const parts: string[] = [];
  if (base) parts.push(`base=${encodeURIComponent(base)}`);
  if (head) parts.push(`head=${encodeURIComponent(head)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
