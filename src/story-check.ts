// The bundled story checker: the app's own contract validators, the coverage
// gate against the real git diff, logic-move verification, and the
// deterministic prose lints, runnable without the app. Agents run it from the
// skill folder (`node <skill-dir>/scripts/check-story.mjs`); it is bundled by
// scripts/build-skill-checker.mjs. It is not a codeStory CLI: nothing is
// installed, and it only reads.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { codeStoryScope, verifyCodeStoryEvidence } from "./code-story.js";
import { changedRanges, parseUnifiedDiff } from "./diff.js";
import { enclosingScopeLabel } from "./enclosing-scope.js";
import { getDiff, readWholeFile, resolveBase, resolveCommit } from "./git.js";
import { computeCoverage, filesForStoryCoverage, stalePointers } from "./coverage.js";
import { verifyLandings } from "./landing-verify.js";
import { verifyLogicMoves } from "./logic-moves.js";
import { lintStory, type LintFinding } from "./story-lint.js";
import {
  isCodeStory,
  normalizeCodeStoryRefs,
  validateGeneratedTour,
  validateNewGeneratedStory,
  validateTour,
} from "./tour.js";
import { isCodeStep, type DiffFile, type Tour } from "./types.js";

export interface StoryCheckReport {
  /** Story path relative to the repository. */
  story: string;
  /** What the story explains: a diff, or existing code at one commit. */
  subject: "diff" | "code";
  /** What the story was measured against: "main..working tree", or "main @ 1a2b3c4" for code. */
  diffLabel: string;
  /** Contract failures: the app would reject the story or flag unexplained changes. */
  errors: string[];
  /** Prose and structure lint findings (errors and warnings). */
  findings: LintFinding[];
  /** Soft logic-move doubts from the move verifier. */
  moveWarnings: string[];
  /** Changed-range coverage, when the diff could be read. */
  coverage: { claimed: number; total: number } | null;
  /** The parsed story when it passed basic validation. */
  tour?: Tour;
}

export interface LedgerRange {
  range: [number, number];
  /** Nearest enclosing function/class/rule line, when one can be found. */
  scope?: string;
}

export interface LedgerFile {
  file: string;
  status: DiffFile["status"];
  test: boolean;
  ranges: LedgerRange[];
}

export interface StoryLedger {
  diffLabel: string;
  files: LedgerFile[];
}

const TEST_PATH =
  /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.t\.sol$|_test\.(go|py|rs)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|swift|cs)$/i;

/** True when no contract error and no lint error remain (and, if strict, no warning). */
export function reportReady(report: StoryCheckReport, strict = false): boolean {
  if (report.errors.length) return false;
  if (report.findings.some((f) => f.severity === "error")) return false;
  if (strict && (report.findings.length || report.moveWarnings.length)) return false;
  return true;
}

function canonicalizeDeletedKind(parsed: unknown): void {
  const steps = (parsed as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (step && typeof step === "object" && (step as { kind?: unknown }).kind === "deleted") {
      (step as { kind: string }).kind = "changed";
    }
  }
}

/** Check one story file against the repository it lives in. */
export function runStoryCheck(repo: string, storyPath: string): StoryCheckReport {
  const story = relative(repo, storyPath) || storyPath;
  const report: StoryCheckReport = {
    story,
    subject: "diff",
    diffLabel: "",
    errors: [],
    findings: [],
    moveWarnings: [],
    coverage: null,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storyPath, "utf8"));
  } catch (error) {
    report.errors.push(`${story} is not readable JSON: ${(error as Error).message}`);
    return report;
  }
  canonicalizeDeletedKind(parsed);
  normalizeCodeStoryRefs(parsed);
  if (isCodeStory(parsed)) report.subject = "code";
  const basic = validateTour(parsed);
  if (basic.length) {
    // The app refuses to load this story; deeper checks would only add noise.
    report.errors.push(...basic);
    return report;
  }
  const tour = parsed as Tour;
  report.tour = tour;
  report.errors.push(
    ...(tour.version >= 3 ? validateNewGeneratedStory(tour) : validateGeneratedTour(tour)),
  );
  if (report.subject === "code") return checkCodeStory(repo, tour, report);
  if (/(^|\/)\.(codestory|diffstory)\/stories\//.test(story) && !tour.storyScope?.includedFiles?.length) {
    report.errors.push("stories under .codestory/stories/ need storyScope.includedFiles");
  }

  const base = resolveBase(repo, tour.base);
  report.diffLabel = `${tour.base ?? base}..${tour.head ?? "working tree"}`;
  let files: DiffFile[] = [];
  try {
    files = filesForStoryCoverage(tour, parseUnifiedDiff(getDiff(repo, base, tour.head)));
  } catch (error) {
    report.errors.push(`could not read the diff ${report.diffLabel}: ${(error as Error).message}`);
  }
  const coverage = computeCoverage(tour, files);
  report.coverage = { claimed: coverage.fullyClaimedChangedRanges, total: coverage.totalChangedRanges };
  for (const change of coverage.unclaimed) {
    report.errors.push(
      `unexplained change: ${change.file} ${change.range[0]}-${change.range[1]} is not claimed by any changed/new-file step`,
    );
  }
  for (const step of stalePointers(tour, files)) {
    const file = isCodeStep(step) ? step.file : "?";
    report.errors.push(
      `stale step ${step.id}: its range or ranges do not match changed code in ${file} (re-read the post-change file and fix the line numbers)`,
    );
  }
  report.errors.push(...verifySweeps(tour, files));
  report.errors.push(...verifyOldHighlights(tour, files));
  const moves = verifyLogicMoves(repo, tour);
  report.errors.push(...moves.errors);
  report.moveWarnings.push(...moves.warnings);
  report.errors.push(...verifyLandings(repo, tour).errors);
  report.findings = lintStory(tour, {
    readLines: (file) => readWholeFile(repo, file, tour.head),
  });
  return report;
}

/**
 * A code story has no diff to cover. Its trust floor is that every file and
 * line it points at exists at the pinned commit, every landing checks out
 * there, and its prose passes the same lints as any story. Working-tree edits
 * to a shown file are a warning: the app reads the commit, so the danger is
 * only an author who took line numbers from the edited copy.
 */
function checkCodeStory(repo: string, tour: Tour, report: StoryCheckReport): StoryCheckReport {
  report.diffLabel = codeStoryScope(tour).label;
  const evidence = verifyCodeStoryEvidence(repo, tour);
  report.errors.push(...evidence.errors);
  const head = tour.head ?? "";
  if (!head || resolveCommit(repo, head) === null) return report;
  report.errors.push(...verifyLandings(repo, tour).errors);
  report.findings = lintStory(tour, {
    readLines: (file) => readWholeFile(repo, file, head),
  });
  const short = head.slice(0, 7);
  for (const file of evidence.worktreeDrift) {
    report.findings.push({
      rule: "code-at-commit",
      severity: "warning",
      where: file,
      message: `${file} differs from ${short} in the working tree, and the app shows this story at ${short}.`,
      fix: `Take line numbers from \`git show ${short}:${file}\`, not the working tree.`,
    });
  }
  return report;
}

/**
 * A cross-file sweep is honest only when every matched file changed the same
 * way: the reviewer reads one representative instance and trusts the rest.
 * The signature is structural — hunk count plus the ordered changed lines
 * with values blanked — so the same key renamed in thirty locale files
 * passes while a differently-shaped edit fails. Line numbers and values
 * may differ; the referenced thing and the edit's shape may not.
 */
export function verifySweeps(tour: Tour, files: DiffFile[]): string[] {
  const errors: string[] = [];
  for (const step of tour.steps) {
    if (!isCodeStep(step) || step.kind === "context" || !step.files?.length) continue;
    const matched = files.filter((f) =>
      step.files!.some((pattern) => matchGlob(pattern, f.newPath)),
    );
    if (!matched.length) {
      errors.push(
        `sweep step ${step.id}: "${step.files[0]}" matches no changed file in this story's scope (drop the sweep or fix the glob)`,
      );
      continue;
    }
    const expected = sweepSignature(matched[0]);
    const divergent = matched.filter((file) => sweepSignature(file) !== expected);
    if (divergent.length) {
      const names = divergent.map((file) => file.newPath);
      const shown = names.slice(0, 4).join(", ");
      errors.push(
        `sweep step ${step.id}: ${shown}${names.length > 4 ? ` and ${names.length - 4} more` : ""} ` +
          `${names.length === 1 ? "does" : "do"} not carry the same structural edit as ${matched[0].newPath} ` +
          `(a sweep claims every matched file, so each one must change the same way — narrow the glob or write separate steps)`,
      );
    }
  }
  return errors;
}

/** Hunk count plus the changed-line skeleton: the first literal per line is
 *  the thing referenced (kept); later literals and all numbers are values
 *  (blanked). The same key renamed in thirty locale files passes; a file
 *  that renamed a different key fails. */
function sweepSignature(file: DiffFile): string {
  const skeleton = (content: string): string => {
    let seen = 0;
    return content
      .trim()
      .replace(/"[^"\n]*"|'[^'\n]*'/g, (literal) => (seen++ === 0 ? literal : '""'))
      .replace(/\b\d+(\.\d+)?\b/g, "0");
  };
  const lines = file.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type === "add" || line.type === "del")
    .map((line) => `${line.type === "add" ? "+" : "-"}${skeleton(line.content)}`);
  return [`hunks:${file.hunks.length}`, ...lines].join("\n");
}

/**
 * Beat `oldHighlights` must point at lines the diff actually deleted. Shape
 * validation cannot check this — old-side numbers live outside the
 * post-change viewport — so the checker overlaps each range with the file's
 * deleted lines instead.
 */
export function verifyOldHighlights(tour: Tour, files: DiffFile[]): string[] {
  const errors: string[] = [];
  const byPath = new Map(files.map((file) => [file.newPath, file]));
  for (const step of tour.steps) {
    if (!isCodeStep(step) || !step.beats?.length) continue;
    const file = byPath.get(step.file);
    const deleted = new Set<number>();
    for (const hunk of file?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.type === "del" && line.oldNo !== undefined) deleted.add(line.oldNo);
      }
    }
    step.beats.forEach((beat, beatIndex) => {
      for (const [start, end] of beat.oldHighlights ?? []) {
        let hits = false;
        for (let line = start; line <= end; line++) {
          if (deleted.has(line)) {
            hits = true;
            break;
          }
        }
        if (!hits) {
          errors.push(
            `steps[${step.id}].beats[${beatIndex}].oldHighlights ${start}-${end} ` +
              `point at no deleted line in ${step.file} (re-read the base-side file and fix the old line numbers)`,
          );
        }
      }
    });
  }
  return errors;
}

/** Changed files a set of scoped stories leaves to nobody (same base/head only). */
export function unownedFiles(repo: string, tours: Tour[]): string[] {
  if (tours.length < 2) return [];
  const key = (t: Tour) => `${t.base ?? ""}..${t.head ?? ""}`;
  if (new Set(tours.map(key)).size !== 1) return [];
  const owned = new Set(tours.flatMap((t) => t.storyScope?.includedFiles ?? []));
  const excluded = new Set(tours.flatMap((t) => t.storyScope?.excludedFiles ?? []));
  const base = resolveBase(repo, tours[0].base);
  return parseUnifiedDiff(getDiff(repo, base, tours[0].head))
    .map((f) => f.newPath)
    .filter((path) => !owned.has(path) && !excluded.has(path));
}

/** Minimal glob: `**` spans directories, `*` and `?` stay inside one segment. */
import { globToRegExp, matchGlob } from "./noise.js";

export { globToRegExp };

/** Every changed range a story must claim, with the enclosing scope for orientation. */
export function storyLedger(
  repo: string,
  opts: { base?: string; head?: string; include?: string[]; exclude?: string[] } = {},
): StoryLedger {
  const base = resolveBase(repo, opts.base);
  const include = (opts.include ?? []).map(globToRegExp);
  const exclude = (opts.exclude ?? []).map(globToRegExp);
  const files = parseUnifiedDiff(getDiff(repo, base, opts.head)).filter(
    (f) =>
      (!include.length || include.some((re) => re.test(f.newPath))) &&
      !exclude.some((re) => re.test(f.newPath)),
  );
  return {
    diffLabel: `${opts.base ?? base}..${opts.head ?? "working tree"}`,
    files: files.map((f) => {
      const lines = f.status === "deleted" ? null : readWholeFile(repo, f.newPath, opts.head);
      return {
        file: f.newPath,
        status: f.status,
        test: TEST_PATH.test(f.newPath),
        ranges: changedRanges(f).map((range) => {
          const scope = lines && range[0] > 0 ? enclosingScopeLabel(lines, range[0]) : undefined;
          return scope ? { range, scope } : { range };
        }),
      };
    }),
  };
}

export function formatLedger(ledger: StoryLedger): string {
  const total = ledger.files.reduce((n, f) => n + f.ranges.length, 0);
  const out = [
    `Changed ranges for ${ledger.diffLabel}: ${ledger.files.length} files, ${total} ranges.`,
    "Every range must be claimed by a changed/new-file step (range, or top-level ranges on a tagged sweep).",
    "",
  ];
  for (const f of ledger.files) {
    const tags = [f.status !== "modified" ? f.status : "", f.test ? "test" : ""].filter(Boolean).join(", ");
    out.push(`${f.file}${tags ? `  (${tags})` : ""}`);
    if (f.status === "deleted") {
      out.push("  whole file deleted: use range, viewport, and highlights of [0, 0]");
      continue;
    }
    for (const r of f.ranges) {
      const span = `${r.range[0]}-${r.range[1]}`.padEnd(11);
      out.push(`  ${span}${r.scope ? `in ${r.scope}` : ""}`);
    }
  }
  return out.join("\n");
}

function groupFindings(findings: LintFinding[]): Array<{ rule: string; items: LintFinding[] }> {
  const groups = new Map<string, LintFinding[]>();
  for (const f of findings) groups.set(f.rule, [...(groups.get(f.rule) ?? []), f]);
  return [...groups].map(([rule, items]) => ({ rule, items }));
}

function formatGroup(rule: string, items: LintFinding[]): string[] {
  const places = items.map((f) => f.where);
  const shown = places.slice(0, 6).join(", ") + (places.length > 6 ? `, … (${places.length} places)` : "");
  const lines = [`  - [${rule}] ${items.length > 1 ? `x${items.length} at ` : "at "}${shown}`];
  lines.push(`      ${items[0].message}`);
  lines.push(`      fix: ${items[0].fix}`);
  return lines;
}

export function formatReport(report: StoryCheckReport, strict = false): string {
  const lintErrors = report.findings.filter((f) => f.severity === "error");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const errorCount = report.errors.length + lintErrors.length;
  const out = [`codeStory story check: ${report.story}`];
  if (report.diffLabel && report.subject === "code") {
    out.push(`Code: ${report.diffLabel}`);
  } else if (report.diffLabel) {
    const cov = report.coverage ? ` · coverage ${report.coverage.claimed}/${report.coverage.total} changed ranges claimed` : "";
    out.push(`Diff: ${report.diffLabel}${cov}`);
  }
  if (errorCount) {
    out.push("", `ERRORS (${errorCount}) — the story is not ready until these are fixed`);
    for (const e of report.errors) out.push(`  - ${e}`);
    for (const g of groupFindings(lintErrors)) out.push(...formatGroup(g.rule, g.items));
  }
  if (warnings.length || report.moveWarnings.length) {
    const groups = groupFindings(warnings);
    out.push(
      "",
      `WARNINGS (${groups.length + (report.moveWarnings.length ? 1 : 0)} rules, ${warnings.length + report.moveWarnings.length} places) — fix, or be able to say why the rule does not apply here`,
    );
    for (const g of groups) out.push(...formatGroup(g.rule, g.items));
    for (const w of report.moveWarnings) out.push(`  - [move] ${w}`);
  }
  const ready = reportReady(report, strict);
  out.push(
    "",
    ready
      ? `RESULT: READY — 0 errors, ${warnings.length + report.moveWarnings.length} warnings`
      : `RESULT: NOT READY${strict && !errorCount ? " (strict: warnings count)" : ""} — ${errorCount} errors, ${warnings.length + report.moveWarnings.length} warnings`,
  );
  return out.join("\n");
}
