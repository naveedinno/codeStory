// The git-reference option model behind the three comboboxes.
//
// `GET /api/refs` answers `{ current, branches, commits }` once per page; every
// option list on this surface is a projection of that one response. Ported
// option-for-option from `src/change-page.ts`, including the parts that look
// arbitrary and are not:
//
//   - each field gets a DIFFERENT list. The commit field leads with `HEAD`, the
//     compare target leads with the `Working tree` pseudo-ref, and the compare
//     source has no pseudo-row at all — you cannot diff *from* an uncommitted
//     tree. The branch field lists branches only, and its parent field leads
//     with `Auto-detect`.
//   - before the fetch resolves, the list is a single unselectable "Loading
//     refs…" row rather than an empty listbox, so the field never looks broken.
//   - when the fetch FAILS, the list is an error row plus a Retry row instead
//     of the loading row, so a dead endpoint never reads as ongoing work. Both
//     carry sentinel values the hook refuses to choose; Retry reruns the fetch.
//   - the filter matches value + label + meta + kind, so typing "remote" or a
//     commit subject finds rows whose value contains neither.

export type FieldKind = "commit" | "base" | "head" | "branch" | "from";

/** The `Working tree` pseudo-ref. Never sent to git; it means "omit &head". */
export const WORKTREE = "__WORKTREE__";

/** The `Auto-detect` pseudo-ref for a branch's parent. Never sent to git; it means "omit &from". */
export const AUTO_PARENT = "__AUTO__";

/** The literal shown in the parent field when the parent is auto-detected. */
export const AUTO_PARENT_LABEL = "Auto-detect";

/** The literal shown in the target field when it means the working tree. */
export const WORKTREE_LABEL = "Working tree";

/** Sentinel values for the failed-load rows. Never a ref; the hook never chooses them. */
export const REFS_ERROR = "__REFS_ERROR__";
export const REFS_RETRY = "__REFS_RETRY__";

export interface RefOption {
  /** Empty for the non-selectable loading row; a `REFS_*` sentinel for the failed-load rows (also never chosen). */
  value: string;
  label: string;
  meta: string;
  kind: string;
}

export interface BranchRef {
  name: string;
  kind?: string;
}

export interface CommitRef {
  sha: string;
  subject?: string;
  refs?: string;
  committedAt?: string;
  committedAtLabel?: string;
  committedAtRelative?: string;
}

export interface RefsResponse {
  current?: string;
  /** Older builds answered with bare strings; both shapes are accepted. */
  branches?: (BranchRef | string)[];
  commits?: CommitRef[];
}

export interface RefData {
  current: string;
  branches: BranchRef[];
  commits: CommitRef[];
}

export function normalizeRefs(body: RefsResponse): RefData {
  return {
    current: body.current || "HEAD",
    branches: (body.branches ?? []).map((raw) => (typeof raw === "string" ? { name: raw, kind: "branch" } : raw)),
    commits: body.commits ?? [],
  };
}

function option(value: string, label: string, meta: string, kind: string): RefOption {
  return { value, label: label || value, meta, kind };
}

function commitMeta(commit: CommitRef): string {
  const subject = commit.subject || commit.refs || "commit";
  const when = commit.committedAtLabel || commit.committedAt || "";
  return [when, commit.committedAtRelative || "", subject].filter(Boolean).join(" · ");
}

function branchOptions(data: RefData): RefOption[] {
  return data.branches.map((branch) =>
    option(
      branch.name,
      branch.name,
      branch.kind === "remote" ? "remote branch" : "local branch",
      branch.kind === "remote" ? "remote" : "branch",
    ),
  );
}

function commitOptions(data: RefData): RefOption[] {
  return data.commits.map((commit) => option(commit.sha, commit.sha, commitMeta(commit), "commit"));
}

/** `null` data means the fetch has not landed yet; `failed` means it never will without a retry. */
export function optionsFor(kind: FieldKind, data: RefData | null, failed = false): RefOption[] {
  if (!data && failed) {
    return [
      option(REFS_ERROR, "Could not load refs", "the ref list didn't arrive", "error"),
      option(REFS_RETRY, "Try again", "load the ref list again", "retry"),
    ];
  }
  if (!data) return [option("", "Loading refs…", "reading local Git refs", "")];
  if (kind === "commit") return [option("HEAD", "HEAD", "current HEAD", "head")].concat(commitOptions(data));
  if (kind === "branch") return branchOptions(data);
  if (kind === "from") {
    return [option(AUTO_PARENT, AUTO_PARENT_LABEL, "nearest of main, master, develop", "auto")].concat(branchOptions(data));
  }
  if (kind === "head") {
    return [option(WORKTREE, WORKTREE_LABEL, "HEAD plus uncommitted edits", "worktree")].concat(
      branchOptions(data),
      commitOptions(data),
    );
  }
  return branchOptions(data).concat(commitOptions(data));
}

export function filterOptions(options: RefOption[], query: string): RefOption[] {
  const needle = query.trim().toLowerCase();
  return options.filter((row) => {
    if (!row.value) return true;
    if (row.value === REFS_ERROR || row.value === REFS_RETRY) return true;
    if (!needle) return true;
    return `${row.value} ${row.label} ${row.meta} ${row.kind}`.toLowerCase().indexOf(needle) >= 0;
  });
}

/**
 * Which row is active the moment the list is (re)built: the one matching what
 * is already in the field, the `Working tree` row when the field carries the
 * worktree flag, else the first row.
 */
export function defaultIndex(rows: RefOption[], value: string, worktree: boolean): number {
  if (!rows.length) return -1;
  const current = value.trim();
  const found = rows.findIndex((row) => row.value === current || (row.value === WORKTREE && worktree));
  return found < 0 ? 0 : found;
}

/**
 * Anchor the fixed-position listbox under its field, flipping above when it
 * would fall off the bottom.
 *
 * Written imperatively, into `style`, rather than through React state: this
 * also runs on every scroll and resize event, and a `setState` per scroll frame
 * is how an anchored popover starts to lag behind its anchor. Every constant is
 * the vanilla one.
 */
export function placePicker(input: HTMLElement, picker: HTMLElement): void {
  const rect = input.getBoundingClientRect();
  const width = Math.min(Math.max(260, Math.round(rect.width)), Math.max(220, window.innerWidth - 24));
  const left = Math.min(Math.max(12, Math.round(rect.left)), Math.max(12, window.innerWidth - width - 12));
  const maxHeight = Math.max(140, Math.min(260, window.innerHeight - 24));
  picker.style.maxHeight = `${maxHeight}px`;
  const height = Math.min(picker.offsetHeight || maxHeight, maxHeight);
  let top = rect.bottom + 7;
  let placement = "bottom";
  if (top + height > window.innerHeight - 12) {
    top = rect.top - 7 - height;
    placement = "top";
    if (top < 12) top = Math.max(12, window.innerHeight - height - 12);
  }
  picker.dataset.placement = placement;
  picker.style.transformOrigin = placement === "top" ? "50% 100%" : "50% 0%";
  picker.style.left = `${left}px`;
  picker.style.top = `${Math.round(top)}px`;
  picker.style.width = `${width}px`;
}
