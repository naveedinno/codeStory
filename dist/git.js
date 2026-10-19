// Thin wrapper over the `git` CLI. No external deps — just child_process.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { APP_DATA_DIRS, APP_DATA_PATHSPECS, DIFF_CONTEXT_LINES, isAppDataPath } from "./config.js";
import { isGeneratedPath, REVIEW_NOISE_MAX_BYTES, REVIEW_NOISE_MAX_LINES, reviewExclusionMetadata, } from "./noise.js";
// History snapshots are written on read paths (review open, picker), so the
// dirtiness checks behind scope selection must not see them — otherwise the
// first visit to a clean tree vetoes the committed-story fallback forever.
// Mirrors HISTORY_DIRNAME in story-history.ts; story files and comments stay
// visible because only snapshot writes are implicit. Covers the pre-rename
// folder too, for snapshots a migration had to leave behind.
const HISTORY_PATHSPECS = APP_DATA_DIRS.map((dir) => `:(exclude)${dir}/history/**`);
export function assertSafeRef(ref) {
    if (typeof ref !== "string" ||
        !ref ||
        ref.length > 1024 ||
        ref.includes("\0") ||
        ref.includes(":") ||
        /^-/.test(ref)) {
        throw new Error("Git ref is invalid.");
    }
}
export function isSafeRepoPath(path) {
    return !(!path ||
        path.includes("\0") ||
        path.includes("\\") ||
        path.startsWith("/") ||
        path === "." ||
        path === ".." ||
        path.split("/").some((part) => !part || part === "." || part === "..") ||
        isAppDataPath(path));
}
export function assertSafeRepoPath(path) {
    if (!isSafeRepoPath(path))
        throw new Error("Repository-relative path is unsafe.");
}
function safeWorkingPath(repo, path) {
    assertSafeRepoPath(path);
    const absolute = resolve(repo, path);
    const rel = relative(repo, absolute);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
        throw new Error("Repository-relative path escapes the repository.");
    }
    return absolute;
}
function safeObjectPath(ref, path) {
    assertSafeRef(ref);
    assertSafeRepoPath(path);
    return `${ref}:${path}`;
}
function git(repo, args) {
    return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        // Capture stderr instead of inheriting it — base-detection probes are
        // expected to fail (e.g. no `origin`), and we don't want those leaking.
        stdio: ["ignore", "pipe", "pipe"],
    });
}
function tryGit(repo, args) {
    try {
        return git(repo, args);
    }
    catch {
        return null;
    }
}
function gitOutputAllowingDiffExit(repo, args) {
    const result = spawnSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error)
        return null;
    if (result.status === 0 || result.status === 1)
        return result.stdout ?? "";
    return null;
}
export function isGitRepo(repo) {
    return tryGit(repo, ["rev-parse", "--is-inside-work-tree"]) !== null;
}
/**
 * Decide what to diff against, in priority order:
 *   1. an explicit override (--base / tour.base)
 *   2. the merge-base of HEAD with the default branch (captures everything the
 *      branch changed, committed *and* uncommitted)
 *   3. HEAD (just the uncommitted changes)
 *   4. the empty tree (a fresh repo with no commits yet)
 */
export function resolveBase(repo, override, onFallback) {
    if (override) {
        try {
            assertSafeRef(override);
            if (tryGit(repo, [
                "rev-parse",
                "--verify",
                "--end-of-options",
                override,
            ]) !== null) {
                return override;
            }
            onFallback?.(override);
        }
        catch {
            onFallback?.(override);
            // Unsafe or malformed overrides are ignored; callers fall back to the
            // ordinary review base instead of passing user text to git.
        }
    }
    const hasHead = tryGit(repo, ["rev-parse", "--verify", "HEAD"]) !== null;
    if (!hasHead) {
        // Empty tree object — diffs the whole working tree as "added".
        return git(repo, ["hash-object", "-t", "tree", "/dev/null"]).trim();
    }
    for (const branch of defaultBranchCandidates(repo)) {
        const mergeBase = tryGit(repo, ["merge-base", "HEAD", branch]);
        if (mergeBase) {
            const ref = mergeBase.trim();
            // If we're already on the default branch, merge-base == HEAD and the diff
            // would be empty; fall through to HEAD so uncommitted work still shows.
            const head = tryGit(repo, ["rev-parse", "HEAD"])?.trim();
            if (ref && ref !== head)
                return ref;
        }
    }
    return "HEAD";
}
function defaultBranchCandidates(repo) {
    const out = [];
    const originHead = tryGit(repo, [
        "symbolic-ref",
        "--quiet",
        "refs/remotes/origin/HEAD",
    ]);
    if (originHead)
        out.push(originHead.trim().replace("refs/remotes/", ""));
    for (const name of ["main", "master", "develop"]) {
        if (tryGit(repo, ["rev-parse", "--verify", name]) !== null)
            out.push(name);
        if (tryGit(repo, ["rev-parse", "--verify", `origin/${name}`]) !== null)
            out.push(`origin/${name}`);
    }
    return out;
}
/**
 * Unified diff against `base`. With no `head`, diffs the working tree (the usual
 * "review my current change" case). With `head`, diffs `base..head` — two refs,
 * no working tree involved.
 *
 * Generated/oversized files (see `noiseFiles`) are subtracted from the diff:
 * a regenerated 20k-line ABI would otherwise become tens of thousands of DOM
 * rows in the review and crash the tab. Keeping this in the one diff everything
 * shares means the rendered review, the coverage gate, and the change summary
 * all agree on the same reduced set without each call site re-deriving it.
 */
export function getDiff(repo, base, head) {
    const noise = new Set(noiseFiles(repo, base, head));
    assertSafeRef(base);
    if (head)
        assertSafeRef(head);
    const args = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        `-U${DIFF_CONTEXT_LINES}`,
        "--end-of-options",
        base,
    ];
    if (head)
        args.push(head);
    args.push("--", ...APP_DATA_PATHSPECS, ...excludePathspecs([...noise]));
    const tracked = git(repo, args);
    if (head)
        return tracked;
    // `git diff <base>` compares the base directly with filesystem bytes. That
    // normally gives the useful aggregate change, but it can hide the index: an
    // MM file whose unstaged edit restores the base has no base→worktree diff
    // even though it still contains a staged change. Append only those missing
    // base→index paths so every staged change remains reviewable without
    // duplicating files already represented by the aggregate diff.
    const stagedOnly = stagedOnlyReviewPaths(repo, base).filter((path) => !noise.has(path));
    const staged = stagedOnly.length
        ? git(repo, [
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            `-U${DIFF_CONTEXT_LINES}`,
            "--end-of-options",
            base,
            "--",
            ...stagedOnly.map(literalPathspec),
        ])
        : "";
    // An index deletion restored at the same path is reported by Git as both a
    // tracked deletion and an untracked file (`D  path` + `?? path`). The trust
    // gate exposes that index/worktree collision explicitly, so do not append a
    // second diff block for the same path and make the reviewed identity look
    // like two independent files.
    const indexDivergent = new Set(stagedWorktreeDivergentFiles(repo, base));
    const untracked = untrackedFiles(repo)
        .filter((path) => !isAppDataPath(path))
        .filter((path) => !indexDivergent.has(path))
        .filter((path) => !noise.has(path))
        .map((path) => untrackedFileDiff(repo, path))
        .filter(Boolean);
    return joinDiffs([tracked, staged, ...untracked]);
}
/**
 * Build the initial review file list without generating or parsing unified
 * diff bodies. Git may inspect changed files to calculate numstat and object
 * ids, but Node only receives bounded metadata regardless of changed-byte size.
 */
export function reviewFileIndex(repo, base, head) {
    return reviewFileIndexSnapshot(repo, base, head).fileIndex;
}
/** Build the initial file index and its trust/exclusion companions from one
 * shared set of Git boundaries. The old callers independently recomputed the
 * same staged, worktree, untracked, and numstat sets several times. */
export function reviewFileIndexSnapshot(repo, base, head) {
    const entries = new Map();
    for (const file of nameStatus(repo, base, head))
        entries.set(file.path, file);
    let stagedOnly = [];
    let indexDivergent = new Set();
    let untracked = [];
    if (!head) {
        const staged = stagedChangedPaths(repo, base);
        stagedOnly = staged.filter((path) => !entries.has(path));
        for (const path of stagedOnly) {
            for (const file of nameStatus(repo, base, undefined, [path], true)) {
                if (!entries.has(file.path))
                    entries.set(file.path, file);
            }
        }
        untracked = untrackedFiles(repo);
        const worktree = new Set([...changedPaths(repo, []), ...untracked]);
        indexDivergent = new Set(staged.filter((path) => worktree.has(path) || stagedDeletionRestoredOnDisk(repo, path)));
        for (const path of untracked) {
            if (!indexDivergent.has(path)) {
                entries.set(path, { oldPath: "/dev/null", path, status: "added" });
            }
        }
    }
    const counts = new Map(reviewIndexNumstat(repo, base, head, stagedOnly, indexDivergent, untracked).map((file) => [file.path, file]));
    const changedFiles = [...entries.values()];
    const paths = changedFiles.map((file) => file.path);
    const resolvedBase = tryGit(repo, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${base}^{tree}`,
    ])?.trim() ?? base;
    const resolvedHead = head
        ? (tryGit(repo, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${head}^{tree}`,
        ])?.trim() ?? head)
        : "working-tree";
    const workingIdentities = head
        ? new Map()
        : workingPathIdentities(repo, paths);
    const indexOids = head
        ? new Map()
        : indexBlobOids(repo, paths);
    const fileIndex = changedFiles
        .map((file) => {
        const count = counts.get(file.path) ?? { added: null, removed: null };
        const changedLines = count.added == null || count.removed == null
            ? null
            : count.added + count.removed;
        const byteSize = reviewPathByteSize(repo, base, head, file.path);
        return {
            ...file,
            added: count.added,
            removed: count.removed,
            byteSize,
            binary: count.added == null || count.removed == null,
            large: (changedLines != null && changedLines >= REVIEW_NOISE_MAX_LINES) ||
                (byteSize != null && byteSize >= REVIEW_NOISE_MAX_BYTES),
            generated: isGeneratedPath(file.path),
            metadataOnly: changedLines === 0,
            reviewHash: reviewFileIndexHash(file, resolvedBase, resolvedHead, indexOids.get(file.path), workingIdentities.get(file.path)),
        };
    })
        .sort((a, b) => a.path.localeCompare(b.path));
    const excludedFiles = fileIndex
        .map((file) => reviewExclusionMetadata(file.path, file.added, file.removed, file.byteSize))
        .filter((file) => file !== null)
        .sort((a, b) => a.path.localeCompare(b.path));
    return {
        fileIndex,
        stagedWorktreeDivergentFiles: [...indexDivergent].sort(),
        excludedFiles,
    };
}
/** Capture the bounded review index and the exact identity derived from it as
 * one stable snapshot. This identity is shared by rendered page leases, lazy
 * evidence validation, and live drift detection; those paths must never use
 * different fingerprint algorithms for the same repository state. */
export function reviewChangeIndexSnapshot(repo, base, head) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = reviewSourceMetadataFingerprint(repo, base, head);
        const indexSnapshot = reviewFileIndexSnapshot(repo, base, head);
        const confirmed = reviewSourceMetadataFingerprint(repo, base, head);
        if (confirmed !== before)
            continue;
        const changeFingerprint = createHash("sha256")
            .update(JSON.stringify({
            base,
            head: head ?? "working-tree",
            source: confirmed,
            files: indexSnapshot.fileIndex.map((file) => [
                file.path,
                file.reviewHash,
            ]),
        }))
            .digest("hex");
        return {
            ...indexSnapshot,
            sourceFingerprint: confirmed,
            changeFingerprint,
        };
    }
    throw new Error("The change is moving too quickly to capture a stable review index. Try again.");
}
function reviewIndexNumstat(repo, base, head, stagedOnly, indexDivergent, untracked) {
    assertSafeRef(base);
    if (head)
        assertSafeRef(head);
    const args = ["diff", "--numstat", "--no-color", "--end-of-options", base];
    if (head)
        args.push(head);
    args.push("--", ...APP_DATA_PATHSPECS);
    const tracked = parseNumstat(tryGit(repo, args));
    if (head)
        return tracked;
    const staged = stagedOnly.length
        ? parseNumstat(tryGit(repo, [
            "diff",
            "--cached",
            "--numstat",
            "--no-color",
            "--end-of-options",
            base,
            "--",
            ...stagedOnly.map(literalPathspec),
        ]))
        : [];
    const untrackedCounts = untracked
        .filter((path) => !indexDivergent.has(path))
        .map((path) => ({ path, added: countFileLines(repo, path), removed: 0 }));
    return [...tracked, ...staged, ...untrackedCounts];
}
/**
 * Generate the unified diff for exactly one path. This is the content boundary
 * used by lazy file and story-step endpoints; initial-page code must use
 * reviewFileIndex() instead.
 */
export function getFileDiff(repo, base, path, head) {
    assertSafeRepoPath(path);
    const args = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        `-U${DIFF_CONTEXT_LINES}`,
        "--end-of-options",
        base,
    ];
    assertSafeRef(base);
    if (head) {
        assertSafeRef(head);
        args.push(head);
    }
    args.push("--", literalPathspec(path));
    const tracked = git(repo, args);
    if (head || tracked)
        return tracked;
    if (stagedOnlyReviewPaths(repo, base).includes(path)) {
        return git(repo, [
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            `-U${DIFF_CONTEXT_LINES}`,
            "--end-of-options",
            base,
            "--",
            literalPathspec(path),
        ]);
    }
    if (untrackedFiles(repo).includes(path))
        return untrackedFileDiff(repo, path);
    return "";
}
function nameStatus(repo, base, head, onlyPaths = [], cached = false) {
    const args = ["diff"];
    if (cached)
        args.push("--cached");
    assertSafeRef(base);
    if (head)
        assertSafeRef(head);
    args.push("--name-status", "-z", "--no-renames", "--end-of-options", base);
    if (head)
        args.push(head);
    args.push("--", ...(onlyPaths.length
        ? onlyPaths.map(literalPathspec)
        : [...APP_DATA_PATHSPECS]));
    const out = tryGit(repo, args);
    if (!out)
        return [];
    const fields = out.split("\0").filter(Boolean);
    const files = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const code = fields[i][0];
        const path = fields[i + 1];
        if (isAppDataPath(path))
            continue;
        let status = "modified";
        if (code === "A")
            status = "added";
        else if (code === "D")
            status = "deleted";
        else if (code === "R")
            status = "renamed";
        files.push({
            oldPath: status === "added" ? "/dev/null" : path,
            path,
            status,
        });
    }
    return files;
}
function reviewFileIndexHash(file, resolvedBase, resolvedHead, indexOid, workingIdentity) {
    const hash = createHash("sha256");
    // The tag predates the codeStory rename and stays: reviewers' viewed-file
    // marks are keyed by this hash, and a new tag would clear every one.
    hash.update("diffstory-file-index-v1\0");
    hash.update(file.oldPath);
    hash.update("\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.status);
    hash.update("\0");
    hash.update(resolvedBase);
    hash.update("\0");
    hash.update(resolvedHead);
    hash.update("\0");
    if (resolvedHead === "working-tree") {
        hash.update(indexOid ?? "missing-index");
        hash.update("\0");
        hash.update(workingIdentity ?? "missing-worktree");
    }
    else {
        hash.update("fixed-ref");
    }
    return hash.digest("hex");
}
function indexBlobOids(repo, paths) {
    const identities = new Map();
    for (let offset = 0; offset < paths.length; offset += 500) {
        const batch = paths.slice(offset, offset + 500);
        const out = tryGit(repo, [
            "ls-files",
            "--stage",
            "-z",
            "--",
            ...batch.map(literalPathspec),
        ]);
        for (const entry of out?.split("\0").filter(Boolean) ?? []) {
            const match = entry.match(/^\d+ ([0-9a-f]+) 0\t([\s\S]+)$/);
            if (match)
                identities.set(match[2], match[1]);
        }
    }
    return identities;
}
function workingPathIdentities(repo, paths) {
    const identities = new Map();
    const regular = [];
    for (const path of paths) {
        const abs = safeWorkingPath(repo, path);
        if (!existsSync(abs)) {
            identities.set(path, "missing");
            continue;
        }
        const stat = lstatSync(abs);
        if (stat.isSymbolicLink())
            identities.set(path, `symlink:${readlinkSync(abs)}`);
        else if (stat.isFile())
            regular.push(path);
        else
            identities.set(path, `special:${stat.mode & 0o170000}`);
    }
    for (let offset = 0; offset < regular.length; offset += 500) {
        const batch = regular.slice(offset, offset + 500);
        const out = tryGit(repo, ["hash-object", "--no-filters", "--", ...batch]);
        const oids = out?.trim().split("\n") ?? [];
        for (let i = 0; i < batch.length; i++) {
            identities.set(batch[i], oids[i] ? `blob:${oids[i]}` : "unreadable");
        }
    }
    return identities;
}
function reviewPathByteSize(repo, base, head, path) {
    if (!head) {
        try {
            const stat = lstatSync(safeWorkingPath(repo, path));
            if (stat.isFile() || stat.isSymbolicLink())
                return stat.size;
        }
        catch {
            // Deleted working-tree paths fall through to their base object.
        }
    }
    const ref = head ?? base;
    const size = tryGit(repo, [
        "cat-file",
        "-s",
        safeObjectPath(ref, path),
    ])?.trim();
    if (!size || !/^\d+$/.test(size))
        return null;
    const parsed = Number(size);
    return Number.isSafeInteger(parsed) ? parsed : null;
}
/**
 * Paths omitted from the bounded default diff. Kept for compatibility; callers
 * that show review scope should use excludedReviewFiles() so the omission and
 * reason remain visible.
 */
export function noiseFiles(repo, base, head) {
    return excludedReviewFiles(repo, base, head).map((file) => file.path);
}
/**
 * Structured omissions for the bounded default diff. Derived from --numstat so
 * callers can show the path, reason, and changed-line count without reading the
 * excluded file contents.
 */
export function excludedReviewFiles(repo, base, head) {
    return numstat(repo, base, head)
        .map((file) => reviewExclusionMetadata(file.path, file.added, file.removed, reviewPathByteSize(repo, base, head, file.path)))
        .filter((file) => file !== null)
        .sort((a, b) => a.path.localeCompare(b.path));
}
/** Fingerprint the same complete review identity used by page leases. The
 * underlying index includes excluded paths plus index/worktree blob identities,
 * while `.codestory/**` remains app state rather than product code. */
export function reviewChangeFingerprint(repo, base, head) {
    return reviewChangeIndexSnapshot(repo, base, head).changeFingerprint;
}
/**
 * Cheap identity for the set of live review sources. Existing-file byte
 * changes are caught by per-path stat signatures; this companion catches new
 * paths, staging transitions, and moving refs without hashing file bodies.
 */
export function reviewSourceMetadataFingerprint(repo, base, head) {
    const hash = createHash("sha256");
    assertSafeRef(base);
    if (head)
        assertSafeRef(head);
    const refs = [base, head ?? "HEAD"];
    const resolved = tryGit(repo, ["rev-parse", "--end-of-options", ...refs])
        ?.trim()
        .split("\n");
    hash.update(resolved?.[0] ?? base);
    hash.update("\0");
    if (head) {
        hash.update(resolved?.[1] ?? head);
    }
    else {
        hash.update(resolved?.[1] ?? "no-head");
        hash.update("\0");
        hash.update(tryGit(repo, [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
            ...APP_DATA_PATHSPECS,
        ]) ?? "");
    }
    return hash.digest("hex");
}
/** Git pathspecs that subtract the given paths from a diff (`:(exclude)<path>`). */
export function excludePathspecs(paths) {
    return paths.map((p) => `:(exclude)${p}`);
}
function literalPathspec(path) {
    return `:(literal)${path}`;
}
/**
 * Paths with both a staged base→index change and a separate index→worktree
 * state. Git's ordinary diff finds tracked worktree edits, but an index deletion
 * restored at the same path becomes untracked (`D  path` + `?? path`) and must
 * be included explicitly. A reviewer cannot infer both states from one
 * aggregate base→worktree diff, so callers should surface these paths and must
 * not treat an approval as trustworthy until the index and worktree are
 * reconciled.
 * Fixed-ref reviews have no mutable index boundary and therefore return none.
 */
export function stagedWorktreeDivergentFiles(repo, base, head) {
    if (head)
        return [];
    const staged = new Set(stagedChangedPaths(repo, base));
    const worktree = new Set([
        ...changedPaths(repo, []),
        ...untrackedFiles(repo),
    ]);
    return [...staged]
        .filter((path) => worktree.has(path) || stagedDeletionRestoredOnDisk(repo, path))
        .sort();
}
/**
 * `git diff` cannot report an index deletion restored as an untracked path. In
 * particular, `ls-files --others --exclude-standard` also hides that restore
 * when a committed ignore rule covers the formerly tracked path. Compare the
 * staged path with the actual stage-0 index entry and filesystem instead: an
 * index-missing path that exists in any form is a real index/worktree split.
 */
function stagedDeletionRestoredOnDisk(repo, path) {
    assertSafeRepoPath(path);
    const entries = tryGit(repo, [
        "ls-files",
        "--stage",
        "-z",
        "--",
        literalPathspec(path),
    ]);
    const hasStageZero = !!entries
        ?.split("\0")
        .filter(Boolean)
        .some((entry) => /^\d+ [0-9a-f]+ 0\t/.test(entry));
    if (hasStageZero)
        return false;
    try {
        lstatSync(safeWorkingPath(repo, path));
        return true;
    }
    catch {
        return false;
    }
}
function stagedOnlyReviewPaths(repo, base) {
    const aggregate = new Set(changedPaths(repo, [base]));
    return stagedChangedPaths(repo, base).filter((path) => !aggregate.has(path));
}
/** Paths changed in the index itself, excluding commits already present at HEAD. */
function stagedChangedPaths(repo, fallbackBase) {
    const indexBase = tryGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"])
        ? "HEAD"
        : fallbackBase;
    return changedPaths(repo, ["--cached", indexBase]);
}
/** Run `git diff --name-only` for one boundary and return literal NUL paths. */
function changedPaths(repo, boundary) {
    const args = ["diff", "--name-only", "-z", "--no-renames"];
    const cached = boundary[0] === "--cached";
    const refs = cached ? boundary.slice(1) : boundary;
    if (cached)
        args.push("--cached");
    refs.forEach(assertSafeRef);
    if (refs.length)
        args.push("--end-of-options", ...refs);
    args.push("--", ...APP_DATA_PATHSPECS);
    const out = tryGit(repo, args);
    if (!out)
        return [];
    return out
        .split("\0")
        .filter(Boolean)
        .filter((path) => !isAppDataPath(path))
        .sort();
}
export const EVOLUTION_MIN_COMMITS = 2;
export const EVOLUTION_MAX_COMMITS = 30;
const EVOLUTION_FILES_PER_COMMIT = 12;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
/**
 * Freeze the first-parent progression for one fixed commit range.
 *
 * Merge commits are measured against their first parent. This produces the net
 * change integrated onto the reviewed line instead of interleaving side-branch
 * commits into the story.
 */
export function commitEvolutionManifest(repo, base, head) {
    const baseSha = resolveCommit(repo, base);
    const headSha = resolveCommit(repo, head);
    if (!baseSha || !headSha)
        return null;
    const out = tryGit(repo, [
        "log",
        "--first-parent",
        "--reverse",
        "--format=%H%x09%P%x09%s",
        "--end-of-options",
        `${baseSha}..${headSha}`,
    ]);
    if (out === null)
        return null;
    const commits = out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
        const [sha = "", parentsRaw = "", ...subjectParts] = line.split("\t");
        if (!FULL_COMMIT_SHA.test(sha))
            return null;
        const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [];
        const parent = parents[0] ?? emptyTree(repo);
        const changed = numstat(repo, parent, sha);
        const paths = changed.map((file) => file.path).sort((a, b) => a.localeCompare(b));
        return {
            sha,
            subject: subjectParts.join("\t"),
            parentCount: parents.length,
            added: changed.reduce((sum, file) => sum + (file.added ?? 0), 0),
            removed: changed.reduce((sum, file) => sum + (file.removed ?? 0), 0),
            files: paths.slice(0, EVOLUTION_FILES_PER_COMMIT),
            omittedFiles: Math.max(0, paths.length - EVOLUTION_FILES_PER_COMMIT),
        };
    })
        .filter((entry) => entry !== null);
    return {
        baseSha,
        headSha,
        commits,
        eligible: commits.length >= EVOLUTION_MIN_COMMITS &&
            commits.length <= EVOLUTION_MAX_COMMITS,
    };
}
/** Branch names (local + remote), most-recently-committed first. For the picker. */
export function listBranches(repo) {
    return listBranchRefs(repo).map((b) => b.name);
}
/** Branch refs with enough metadata for the picker to avoid flattening everything together. */
export function listBranchRefs(repo) {
    const out = tryGit(repo, [
        "for-each-ref",
        "--format=%(refname)%09%(refname:short)",
        "--sort=-committerdate",
        "refs/heads",
        "refs/remotes",
    ]);
    if (!out)
        return [];
    return out
        .split("\n")
        .map((s) => {
        const [full, short] = s.split("\t");
        const name = (short ?? "").trim();
        if (!full || !name || name.endsWith("/HEAD"))
            return null;
        if (full.startsWith("refs/remotes/")) {
            const remote = name.includes("/")
                ? name.slice(0, name.indexOf("/"))
                : undefined;
            return { name, kind: "remote", remote };
        }
        return { name, kind: "local" };
    })
        .filter((b) => !!b);
}
/** Commits as {sha, subject, committedAt}, newest first. For the picker. Pass n <= 0 for all. */
export function listRecentCommits(repo, n = 15, ref) {
    const args = ["log"];
    if (n > 0)
        args.push(`-${n}`);
    args.push("--no-merges", "--pretty=format:%h%x09%cI%x09%s%x09%D");
    if (ref === "--all")
        args.push("--all");
    else if (ref) {
        try {
            assertSafeRef(ref);
        }
        catch {
            return [];
        }
        args.push("--end-of-options", ref);
    }
    const out = tryGit(repo, args);
    if (!out)
        return [];
    return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
        const [sha, committedAt = "", subject = "", refs = ""] = line.split("\t");
        return {
            sha,
            committedAt,
            committedAtLabel: commitTimeLabel(committedAt),
            committedAtRelative: relativeCommitTime(committedAt),
            subject,
            refs,
        };
    });
}
function commitTimeLabel(iso) {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return match
        ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
        : "";
}
function relativeCommitTime(iso, now = Date.now()) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then))
        return "";
    const seconds = Math.max(0, Math.floor((now - then) / 1000));
    if (seconds < 45)
        return "just now";
    if (seconds < 90)
        return "1m ago";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7)
        return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5)
        return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12)
        return `${months}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}
/** Current branch name, or null when detached. */
export function currentBranch(repo) {
    const b = tryGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
    return b && b !== "HEAD" ? b : null;
}
/** A short human label for what we diffed against. */
export function describeBase(repo, base) {
    try {
        assertSafeRef(base);
    }
    catch {
        return base;
    }
    const short = tryGit(repo, [
        "rev-parse",
        "--short",
        "--end-of-options",
        base,
    ])?.trim();
    const name = tryGit(repo, [
        "name-rev",
        "--name-only",
        "--end-of-options",
        base,
    ])?.trim();
    // name-rev describes ANY commit relative to some ref (`tags/v1~29^2`), which
    // reads like a ref the reviewer picked when it is really a walk from one. Only
    // an exact hit on a ref is worth naming; otherwise the short id is clearer.
    if (name && name !== "undefined" && !/[~^]/.test(name))
        return `${name} (${short ?? base})`;
    return short ?? base;
}
/** True when `ref` resolves to a commit object. */
export function isCommitRef(repo, ref) {
    try {
        assertSafeRef(ref);
    }
    catch {
        return false;
    }
    return (tryGit(repo, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
    ]) !== null);
}
/** Resolve a commit-ish ref to its full object id, or null if it is not a commit. */
export function resolveCommit(repo, ref) {
    try {
        assertSafeRef(ref);
    }
    catch {
        return null;
    }
    return (tryGit(repo, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
    ])?.trim() ?? null);
}
/** First-parent base for a single commit diff; root commits diff against the empty tree. */
export function commitParentBase(repo, commit) {
    assertSafeRef(commit);
    if (tryGit(repo, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${commit}^`,
    ]) !== null)
        return `${commit}^`;
    return emptyTree(repo);
}
/**
 * Where `branch` forked off its parent line: `merge-base(parent, branch)`.
 *
 * With an explicit `parent` that pair is the whole answer. Otherwise the parent
 * is discovered from the branch's own history rather than guessed from names:
 * walk the branch's first-parent line, dropping every commit some OTHER branch
 * can reach, and the first commit past the branch's own work is the fork. Real
 * repos cut feature branches from release lines (`version_0.8.6`) that split
 * from `main`/`develop` long ago, so measuring from a default branch alone
 * reports thousands of unrelated commits.
 *
 * "Other" excludes the branch's own remote twins (`origin/x` is not where `x`
 * came from) and topic branches merged in through a second parent. A ref whose
 * tip sits on the branch's first-parent line stays: that is a parent that has
 * not moved since the cut — or a child fast-forwarded back in, which the graph
 * cannot tell apart. A trunk only looks at trunks ranked
 * above it, so `main` never measures from `develop`. The one case no ref graph
 * can settle is a CHILD branch cut from this one — it shares a fork just like a
 * parent — which is what the explicit parent is for.
 */
export function branchForkPoint(repo, branch, parent) {
    const tip = resolveCommit(repo, branch);
    if (!tip)
        return null;
    if (parent) {
        if (!resolveCommit(repo, parent))
            return null;
        return measureFork(repo, tip, parent);
    }
    const remotes = (tryGit(repo, ["remote"]) ?? "").split("\n").filter(Boolean);
    const local = (ref) => {
        const remote = remotes.find((r) => ref.startsWith(`${r}/`));
        return remote ? ref.slice(remote.length + 1) : ref;
    };
    const trunks = [...new Set(defaultBranchCandidates(repo))];
    const trunkRank = (ref) => {
        const i = trunks.findIndex((t) => local(t) === local(ref));
        return i < 0 ? trunks.length : i;
    };
    const ownRank = trunkRank(branch);
    // A ref already merged into the branch is still a parent candidate when its
    // tip sits on the branch's first-parent line — a parent that has not moved
    // since the cut. One reached only through a merge's second parent is a topic
    // branch that was merged in, which is history, not where the branch came from.
    const merged = new Set((tryGit(repo, ["for-each-ref", "--format=%(refname)", "--merged", tip, "refs/heads", "refs/remotes"]) ?? "")
        .split("\n")
        .filter(Boolean));
    const firstParentLine = new Set((tryGit(repo, ["rev-list", "--first-parent", tip]) ?? "").split("\n").filter(Boolean));
    // Full refname → short name, for every ref that could be the parent.
    const others = new Map();
    for (const line of (tryGit(repo, [
        "for-each-ref",
        "--format=%(refname)%09%(refname:short)%09%(objectname)",
        "refs/heads",
        "refs/remotes",
    ]) ?? "").split("\n")) {
        const [full, short, object] = line.split("\t");
        if (!full || !short || full.endsWith("/HEAD"))
            continue;
        if (merged.has(full) && (object === tip || !firstParentLine.has(object)))
            continue;
        if (local(short) === local(branch))
            continue;
        if (ownRank < trunks.length && trunkRank(short) >= ownRank)
            continue;
        others.set(full, short);
    }
    if (!others.size)
        return null;
    // The branch's own first-parent commits, newest first. Empty means another
    // ref already contains the tip.
    const own = (tryGit(repo, [
        "rev-list",
        "--first-parent",
        tip,
        "--not",
        ...others.keys(),
    ]) ?? "")
        .split("\n")
        .filter(Boolean);
    const fork = own.length
        ? tryGit(repo, ["rev-parse", "--verify", "--quiet", `${own[own.length - 1]}^1`])?.trim()
        : tip;
    if (!fork)
        return null; // the branch's own line reaches its root commit
    const holders = (tryGit(repo, ["for-each-ref", "--format=%(refname)", "--contains", fork, "refs/heads", "refs/remotes"]) ?? "")
        .split("\n")
        .map((r) => others.get(r.trim()))
        .filter((r) => !!r);
    if (!holders.length)
        return null;
    // Name the parent the way a person would: a trunk first, then a local branch
    // over its remote copy, then `origin` over other remotes, then the shortest.
    const remoteShorts = new Set([...others].filter(([full]) => full.startsWith("refs/remotes/")).map(([, short]) => short));
    const isRemote = (r) => remoteShorts.has(r);
    holders.sort((a, b) => trunkRank(a) - trunkRank(b) ||
        Number(isRemote(a)) - Number(isRemote(b)) ||
        Number(!a.startsWith("origin/")) - Number(!b.startsWith("origin/")) ||
        a.length - b.length ||
        a.localeCompare(b));
    return measureFork(repo, tip, holders[0]);
}
function measureFork(repo, tip, parent) {
    const base = tryGit(repo, ["merge-base", "--end-of-options", parent, tip])?.trim();
    if (!base)
        return null;
    const ahead = Number(tryGit(repo, ["rev-list", "--count", "--end-of-options", `${base}..${tip}`])?.trim() ?? NaN);
    return Number.isFinite(ahead) ? { base, parent, ahead } : null;
}
/** Short commit label for controls and headings. */
export function describeCommit(repo, commit) {
    try {
        assertSafeRef(commit);
    }
    catch {
        return commit;
    }
    const out = tryGit(repo, [
        "show",
        "-s",
        "--format=%h %s",
        "--end-of-options",
        commit,
    ])?.trim();
    return out || commit;
}
/** True when the working tree has uncommitted changes (staged or unstaged, incl. untracked). */
export function isDirty(repo) {
    const out = tryGit(repo, ["status", "--porcelain"]);
    return out != null && out.trim().length > 0;
}
/** True when the working tree differs from HEAD, ignoring history snapshots. */
export function isDirtyExceptHistory(repo) {
    const out = tryGit(repo, [
        "status",
        "--porcelain",
        "--",
        ".",
        ...HISTORY_PATHSPECS,
    ]);
    return out != null && out.trim().length > 0;
}
/** True when HEAD has a parent commit (so HEAD~1 is a valid ref). */
export function hasParentCommit(repo) {
    return tryGit(repo, ["rev-parse", "--verify", "HEAD~1"]) !== null;
}
/** The empty-tree object — diffing against it shows a commit's whole content as added. */
export function emptyTree(repo) {
    return git(repo, ["hash-object", "-t", "tree", "/dev/null"]).trim();
}
/**
 * Per-file added/removed line counts for the change (`git diff --numstat`).
 * Binary files report `-`/`-`, which we surface as null. Used by the change summary.
 */
export function numstat(repo, base, head) {
    assertSafeRef(base);
    if (head)
        assertSafeRef(head);
    const args = ["diff", "--numstat", "--no-color", "--end-of-options", base];
    if (head)
        args.push(head);
    args.push("--", ...APP_DATA_PATHSPECS);
    const tracked = parseNumstat(tryGit(repo, args));
    if (head)
        return tracked;
    // Keep omission metadata aligned with getDiff(): a large, generated, binary,
    // or metadata-only staged remainder must still be identified even when the
    // worktree happens to match the base.
    const stagedOnly = stagedOnlyReviewPaths(repo, base);
    const staged = stagedOnly.length
        ? parseNumstat(tryGit(repo, [
            "diff",
            "--cached",
            "--numstat",
            "--no-color",
            "--end-of-options",
            base,
            "--",
            ...stagedOnly.map(literalPathspec),
        ]))
        : [];
    const indexDivergent = new Set(stagedWorktreeDivergentFiles(repo, base));
    return [
        ...tracked,
        ...staged,
        ...untrackedNumstat(repo).filter((file) => !indexDivergent.has(file.path)),
    ];
}
function parseNumstat(out) {
    return out
        ? out
            .split("\n")
            .filter(Boolean)
            .map((line) => {
            const parts = line.split("\t");
            const added = parts[0] === "-" ? null : Number(parts[0]);
            const removed = parts[1] === "-" ? null : Number(parts[1]);
            return { path: parts.slice(2).join("\t"), added, removed };
        })
        : [];
}
function joinDiffs(parts) {
    return parts
        .map((part) => part.trimEnd())
        .filter(Boolean)
        .join("\n");
}
function untrackedFiles(repo) {
    const out = tryGit(repo, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
    ]);
    if (!out)
        return [];
    return out
        .split("\0")
        .filter(Boolean)
        .filter((path) => !isAppDataPath(path))
        .sort();
}
function untrackedFileDiff(repo, path) {
    // Validate the path lexically, but pass it to git relative to `repo`. Using an
    // absolute path is safe but changes the patch header, which then leaks a
    // machine-local temp/repo path into the reviewed diff.
    safeWorkingPath(repo, path);
    return (gitOutputAllowingDiffExit(repo, [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-index",
        `-U${DIFF_CONTEXT_LINES}`,
        "--",
        "/dev/null",
        path,
    ]) ?? "");
}
function untrackedNumstat(repo) {
    return untrackedFiles(repo).map((path) => {
        const added = countFileLines(repo, path);
        return { path, added, removed: 0 };
    });
}
function countFileLines(repo, path) {
    let fd = null;
    try {
        fd = openSync(safeWorkingPath(repo, path), "r");
        const bytes = Buffer.allocUnsafe(64 * 1024);
        let totalBytes = 0;
        let lines = 0;
        let lastByte = -1;
        while (true) {
            const read = readSync(fd, bytes, 0, bytes.length, null);
            if (read === 0)
                break;
            totalBytes += read;
            for (let i = 0; i < read; i++) {
                const byte = bytes[i];
                if (byte === 0)
                    return null;
                if (byte === 10)
                    lines++;
                lastByte = byte;
            }
        }
        if (totalBytes === 0)
            return 0;
        return lastByte === 10 ? lines : lines + 1;
    }
    catch {
        return null;
    }
    finally {
        if (fd != null)
            closeSync(fd);
    }
}
/**
 * Read an inclusive 1-based line range from a file in the working tree.
 * Returns the lines (without trailing newlines) or null if the file is gone.
 */
export function readFileRange(repo, file, start, end, ref) {
    if (ref) {
        const from = Math.max(1, start);
        const tooLarge = refBlobTooLargeForPreview(repo, ref, file);
        if (tooLarge) {
            return { lines: ["[file too large to preview safely]"], startLine: from };
        }
        const text = readFileText(repo, file, ref);
        if (text == null)
            return null;
        const all = text.split("\n");
        const to = Math.min(all.length, Math.max(from, end));
        return { lines: all.slice(from - 1, to), startLine: from };
    }
    return readWorkingFileRange(repo, file, start, end);
}
const RANGE_READ_CHUNK_BYTES = 64 * 1024;
const RANGE_READ_MAX_LINE_BYTES = 256 * 1024;
const RANGE_READ_MAX_RESULT_BYTES = 2 * 1024 * 1024;
function readWorkingFileRange(repo, file, start, end) {
    const from = Math.max(1, start);
    const to = Math.max(from, end);
    let fd = null;
    try {
        fd = openSync(safeWorkingPath(repo, file), "r");
        const chunk = Buffer.allocUnsafe(RANGE_READ_CHUNK_BYTES);
        const lines = [];
        let lineNo = 1;
        let lineParts = [];
        let lineBytes = 0;
        let resultBytes = 0;
        let lineTruncated = false;
        let sawBytes = false;
        let endedWithNewline = false;
        const append = (part) => {
            if (lineNo < from ||
                lineNo > to ||
                resultBytes >= RANGE_READ_MAX_RESULT_BYTES)
                return;
            const available = Math.min(RANGE_READ_MAX_LINE_BYTES - lineBytes, RANGE_READ_MAX_RESULT_BYTES - resultBytes);
            if (available <= 0) {
                lineTruncated = true;
                return;
            }
            const kept = part.length > available ? part.subarray(0, available) : part;
            if (kept.length) {
                lineParts.push(Buffer.from(kept));
                lineBytes += kept.length;
                resultBytes += kept.length;
            }
            if (kept.length < part.length)
                lineTruncated = true;
        };
        const finishLine = () => {
            if (lineNo >= from && lineNo <= to) {
                let text = Buffer.concat(lineParts, lineBytes).toString("utf8");
                if (text.endsWith("\r"))
                    text = text.slice(0, -1);
                if (lineTruncated)
                    text += " … [line truncated]";
                lines.push(text);
            }
            lineNo++;
            lineParts = [];
            lineBytes = 0;
            lineTruncated = false;
        };
        while (lineNo <= to) {
            const read = readSync(fd, chunk, 0, chunk.length, null);
            if (read === 0)
                break;
            sawBytes = true;
            let offset = 0;
            while (offset < read && lineNo <= to) {
                const newline = chunk.indexOf(10, offset);
                if (newline < 0 || newline >= read) {
                    append(chunk.subarray(offset, read));
                    endedWithNewline = false;
                    break;
                }
                append(chunk.subarray(offset, newline));
                finishLine();
                endedWithNewline = true;
                offset = newline + 1;
            }
        }
        if (lineNo <= to && (lineParts.length || !sawBytes || endedWithNewline))
            finishLine();
        return { lines, startLine: from };
    }
    catch {
        return null;
    }
    finally {
        if (fd != null)
            closeSync(fd);
    }
}
/**
 * Read a whole file from the working tree as an array of lines (no trailing
 * newlines). Returns null if the file is gone. Used to reconstruct the
 * complete-file ("Full file") view.
 */
export function readWholeFile(repo, file, ref) {
    if (ref && refBlobTooLargeForPreview(repo, ref, file))
        return null;
    const text = readFileText(repo, file, ref);
    if (text == null)
        return null;
    const lines = text.split("\n");
    // Drop a single trailing empty element from a final newline so the line count
    // matches the file's real line count.
    if (lines.length > 1 && lines[lines.length - 1] === "")
        lines.pop();
    return lines;
}
function refBlobTooLargeForPreview(repo, ref, file) {
    const size = tryGit(repo, [
        "cat-file",
        "-s",
        safeObjectPath(ref, file),
    ])?.trim();
    return (!!size && /^\d+$/.test(size) && Number(size) > RANGE_READ_MAX_RESULT_BYTES);
}
function readFileText(repo, file, ref) {
    if (ref) {
        return tryGit(repo, [
            "show",
            "--end-of-options",
            safeObjectPath(ref, file),
        ]);
    }
    const abs = safeWorkingPath(repo, file);
    if (!existsSync(abs))
        return null;
    return readFileSync(abs, "utf8");
}
const ZERO_SHA = /^0{40}$/;
function blameAt(repo, file, line, args) {
    const out = tryGit(repo, [
        "blame",
        "--porcelain",
        "-L",
        `${line},${line}`,
        ...args,
        "--",
        file,
    ]);
    if (!out)
        return null;
    const lines = out.split("\n");
    const sha = lines[0]?.split(" ")[0] ?? "";
    if (!/^[0-9a-f]{40}$/.test(sha))
        return null;
    if (ZERO_SHA.test(sha))
        return "uncommitted";
    return commitInfo(repo, sha);
}
function commitInfo(repo, sha) {
    const out = tryGit(repo, ["show", "-s", "--format=%H%x00%s%x00%an%x00%aI", "--end-of-options", sha])?.trim();
    if (!out)
        return null;
    const [full, subject, author, date] = out.split("\0");
    return { sha: full, subject, author, date, relative: relativeCommitTime(date) };
}
/**
 * Which commit is responsible for one line of the diff on screen.
 *
 * After side (`right`): plain blame at `head` — or the working tree when the
 * review ends there, where an unsaved edit blames to the zero id.
 *
 * Before side (`left`): the line exists at `base` and not at the tip, so the
 * interesting commit is the one that took it away. `blame --reverse` finds the
 * last commit in base..tip that still had it; the first commit after that on
 * the ancestry path which touched the file is the removal. If even the tip
 * still has the line, the removal is uncommitted.
 */
export function blameReviewLine(repo, opts) {
    const { base, head, side, file, line } = opts;
    try {
        assertSafeRef(base);
        if (head)
            assertSafeRef(head);
        assertSafeRepoPath(file);
    }
    catch {
        return null;
    }
    if (!Number.isInteger(line) || line < 1)
        return null;
    if (side === "right") {
        const hit = blameAt(repo, file, line, head ? [head] : []);
        if (!hit)
            return null;
        if (hit === "uncommitted")
            return { kind: "uncommitted" };
        // `--is-ancestor` exits 1 (tryGit → null) when the commit is newer than base.
        const inRange = tryGit(repo, ["merge-base", "--is-ancestor", hit.sha, base]) === null;
        return { kind: "line", commit: hit, inRange };
    }
    const tip = resolveCommit(repo, head ?? "HEAD");
    const baseSha = resolveCommit(repo, base);
    const origin = baseSha ? blameAt(repo, file, line, [baseSha]) : null;
    const originCommit = origin && origin !== "uncommitted" ? origin : null;
    if (!tip || !baseSha)
        return null;
    if (tip === baseSha)
        return { kind: "removed", removedBy: "uncommitted", origin: originCommit };
    const lastSeen = tryGit(repo, [
        "blame",
        "--porcelain",
        "--reverse",
        "-L",
        `${line},${line}`,
        `${baseSha}..${tip}`,
        "--",
        file,
    ])
        ?.split("\n")[0]
        ?.split(" ")[0];
    if (!lastSeen || !/^[0-9a-f]{40}$/.test(lastSeen))
        return null;
    if (lastSeen === tip) {
        // Git follows the line to the tip, so it survives somewhere — usually
        // moved. The commit that moved it is the first in range whose diff touched
        // that exact text; with none, only the working tree has moved or dropped it.
        const text = (tryGit(repo, ["show", safeObjectPath(baseSha, file)]) ?? "").split("\n")[line - 1]?.trim();
        const mover = text
            ? (tryGit(repo, ["log", "--format=%H", "--reverse", `-G${escapeRegex(text)}`, `${baseSha}..${tip}`, "--", file]) ?? "")
                .split("\n")
                .filter(Boolean)[0]
            : undefined;
        const movedBy = mover ? commitInfo(repo, mover) : null;
        return movedBy
            ? { kind: "removed", removedBy: movedBy, moved: true, origin: originCommit }
            : { kind: "removed", removedBy: "uncommitted", origin: originCommit };
    }
    const after = (args) => (tryGit(repo, ["rev-list", "--ancestry-path", "--reverse", `${lastSeen}..${tip}`, ...args]) ?? "")
        .split("\n")
        .filter(Boolean)[0];
    // Prefer the first later commit that touched the file; a rename can hide it
    // from the path filter, so fall back to the first later commit at all.
    const next = after(["--", file]) ?? after([]);
    const removedBy = next ? commitInfo(repo, next) : null;
    if (!removedBy)
        return null;
    return { kind: "removed", removedBy, origin: originCommit };
}
/** Escape text for git's POSIX extended regex (`-G`). */
function escapeRegex(text) {
    return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
