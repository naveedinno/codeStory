// Load and validate the story file (.diffstory/story.json). Validation is hand-rolled (no schema dep)
// but thorough — a malformed story should fail loudly with a useful message,
// not render a broken page.
import { readFileSync } from "node:fs";
import { assertSafeRepoPath } from "./git.js";
import { matchGlob } from "./noise.js";
import {
  narrativeIssues,
  narrativeText,
  type NarrativeTier,
} from "./narrative.js";
import type {
  CodeStepKind,
  CodeStoryShape,
  Tour,
  TourStep,
  StepKind,
  StoryMode,
  StoryChangeType,
  StoryNarrativeShape,
} from "./types.js";

const CODE_KINDS: CodeStepKind[] = ["changed", "context", "new-file"];
const KINDS: StepKind[] = [...CODE_KINDS, "concept"];
const MODES: StoryMode[] = ["brief", "guided", "detailed"];
const CHANGE_TYPES: StoryChangeType[] = [
  "feature",
  "bug-fix",
  "refactor",
  "security",
  "performance",
  "migration",
  "maintenance",
  "mixed",
];
const NARRATIVE_SHAPES: StoryNarrativeShape[] = [
  "cause-effect",
  "entry-implementation",
  "before-after",
  "core-supporting",
  "rule-instances",
];
/**
 * How a code story may read existing code. It shares the diff shapes that
 * describe code rather than a change, and adds three of its own; `before-after`
 * stays diff-only because there is no "before" to show.
 */
export const CODE_STORY_SHAPES: CodeStoryShape[] = [
  "entry-implementation",
  "lifecycle",
  "data-flow",
  "map-then-path",
  "core-supporting",
  "rule-instances",
  "cause-effect",
];
const CODE_SCOPE_MAX_PATHS = 50;
const CODE_SCOPE_MAX_QUESTION = 4000;
const CODE_SCOPE_MAX_REF = 200;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const COMMIT_PREFIX = /^[0-9a-f]{7,40}$/i;
const READING_PATH_MAX_CHARS = 200;
const EVOLUTION_MAX_PHASES = 6;
const MOVE_KINDS = [
  "moved",
  "extracted",
  "inlined",
  "wrapped",
  "unwrapped",
  "condition-changed",
  "reordered",
  "flow",
] as const;
const CONCEPT_CODE_FIELDS = [
  "file",
  "range",
  "ranges",
  "viewport",
  "highlights",
  "beats",
  "focus",
  "why",
  "calls",
  "returnsTo",
  "landing",
] as const;
const CONCEPT_MIN_WORDS = 60;
const CONCEPT_MAX_WORDS = 220;
const MERMAID_MAX_CHARS = 8_000;
const MERMAID_MAX_LINES = 80;
/** Lines of framing a viewport may add around its range — about six either side. */
const CONTEXT_ALLOWANCE = 12;

/**
 * Beat prose that says nothing the rendered diff already says. Both patterns are
 * forbidden by the storyteller skill, but prose guidance lands unevenly, so the
 * mechanically detectable cases are enforced at generation time.
 *
 * `LINE_NUMBER_OPENER` — "Line 742 makes …", "Lines 30-34 add …". The highlight
 * already points at those lines; the words should explain, not re-address.
 * `VALUE_TRANSITION` — "650 → 600", "650->600". Both sides are already rendered
 * in colour, so restating them costs a line and teaches nothing. Prose arrows
 * between words ("request → handler") stay legal: only digit-to-digit matches.
 *
 * Both run against the text projection, never the raw field. "<strong>Line
 * 742</strong> makes …" and "650 &rarr; 600" are the same sentence to a reader,
 * so they have to be the same sentence to the gate.
 */
const LINE_NUMBER_OPENER = /^lines?\s+\d/i;
const VALUE_TRANSITION = /\d\s*(?:→|->|—>|–>)\s*\d/;

export class TourError extends Error {}

/**
 * Authoring problems in one narrative field, reported under the field's own path.
 * `narrativeIssues` returns an empty array for prose the sanitizer keeps intact,
 * so a clean story adds nothing here.
 */
function validateNarrative(
  value: unknown,
  name: string,
  tier: NarrativeTier,
  errors: string[],
): void {
  if (typeof value !== "string") return;
  for (const issue of narrativeIssues(value, tier))
    errors.push(`${name} ${issue}`);
}

/** True when a field carries no readable prose once its markup is stripped. */
function isBlankNarrative(value: unknown): boolean {
  return typeof value !== "string" || !narrativeText(value).trim();
}

function isLineNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isDeletionAnchor(value: unknown): value is [0, 0] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === 0 &&
    value[1] === 0
  );
}

/**
 * A stop the author marked as skim-worthy: mechanical sweep coverage rather than
 * a place the reviewer must weigh a decision. Authored via `tags`, so the story
 * declares its own low-stakes stops instead of the app guessing from prose.
 */
function isSkimStep(step: { tags?: unknown }): boolean {
  return (
    Array.isArray(step.tags) &&
    step.tags.some(
      (tag) =>
        typeof tag === "string" &&
        /^(skim|sweep|mechanical)$/i.test(tag.trim()),
    )
  );
}

/** A range that strict validation can safely compare after shape validation. */
function isComparableLineRange(value: unknown): value is [number, number] {
  return (
    isDeletionAnchor(value) ||
    (Array.isArray(value) &&
      value.length === 2 &&
      isLineNumber(value[0]) &&
      isLineNumber(value[1]) &&
      value[0] <= value[1])
  );
}

function mergedLineRanges(
  ranges: Array<[number, number]>,
): Array<[number, number]> {
  const sorted = ranges
    .filter((range) => !isDeletionAnchor(range))
    .map((range) => [...range] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range[0] > previous[1] + 1) merged.push(range);
    else previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

function sameLineCoverage(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): boolean {
  if (a.some(isDeletionAnchor) || b.some(isDeletionAnchor)) {
    return (
      a.length === 1 &&
      b.length === 1 &&
      isDeletionAnchor(a[0]) &&
      isDeletionAnchor(b[0])
    );
  }
  return (
    JSON.stringify(mergedLineRanges(a)) === JSON.stringify(mergedLineRanges(b))
  );
}

function validateLineRange(
  value: unknown,
  name: string,
  errors: string[],
  opts: { allowDeletionAnchor?: boolean } = {},
): [number, number] | undefined {
  if (isDeletionAnchor(value)) {
    if (opts.allowDeletionAnchor) return value;
    errors.push(
      `${name} can use [0, 0] only for a pure deleted-file changed step`,
    );
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isLineNumber(value[0]) ||
    !isLineNumber(value[1])
  ) {
    errors.push(`${name} must be [startLine, endLine]`);
    return undefined;
  }
  if (value[0] > value[1]) {
    errors.push(`${name} must start before it ends`);
    return undefined;
  }
  return [value[0], value[1]];
}

function validateFocus(
  step: Record<string, unknown>,
  containerRange: [number, number] | undefined,
  containerName: string,
  where: string,
  errors: string[],
  allowDeletionAnchor: boolean,
): void {
  if (step.focus === undefined) return;
  if (
    typeof step.focus !== "object" ||
    step.focus === null ||
    Array.isArray(step.focus)
  ) {
    errors.push(`${where}.focus must be an object`);
    return;
  }
  const focus = step.focus as Record<string, unknown>;
  if (focus.label !== undefined && typeof focus.label !== "string") {
    errors.push(`${where}.focus.label must be a string`);
  }
  if (!Array.isArray(focus.ranges) || focus.ranges.length === 0) {
    errors.push(`${where}.focus.ranges must be a non-empty array`);
    return;
  }
  focus.ranges.forEach((range, j) => {
    const focusRange = validateLineRange(
      range,
      `${where}.focus.ranges[${j}]`,
      errors,
      { allowDeletionAnchor },
    );
    if (
      focusRange &&
      containerRange &&
      (focusRange[0] < containerRange[0] || focusRange[1] > containerRange[1])
    ) {
      errors.push(
        `${where}.focus.ranges[${j}] must be inside ${containerName}`,
      );
    }
  });
}

function validateHighlights(
  step: Record<string, unknown>,
  containerRange: [number, number] | undefined,
  containerName: string,
  where: string,
  errors: string[],
  allowDeletionAnchor: boolean,
): void {
  if (step.highlights === undefined) return;
  if (!Array.isArray(step.highlights) || step.highlights.length === 0) {
    errors.push(`${where}.highlights must be a non-empty array`);
    return;
  }
  step.highlights.forEach((range, j) => {
    const highlight = validateLineRange(
      range,
      `${where}.highlights[${j}]`,
      errors,
      { allowDeletionAnchor },
    );
    if (
      highlight &&
      containerRange &&
      (highlight[0] < containerRange[0] || highlight[1] > containerRange[1])
    ) {
      errors.push(`${where}.highlights[${j}] must be inside ${containerName}`);
    }
  });
}

function validateBeatHighlights(
  beat: Record<string, unknown>,
  beatIndex: number,
  containerRange: [number, number] | undefined,
  containerName: string,
  where: string,
  errors: string[],
  allowDeletionAnchor: boolean,
): void {
  const hasNew =
    Array.isArray(beat.highlights) && beat.highlights.length > 0;
  const hasOld =
    Array.isArray(beat.oldHighlights) && beat.oldHighlights.length > 0;
  if (!hasNew && !hasOld) {
    errors.push(
      `${where}.beats[${beatIndex}] needs highlights, oldHighlights, or both`,
    );
    return;
  }
  if (beat.highlights !== undefined) {
    if (!Array.isArray(beat.highlights) || beat.highlights.length === 0) {
      errors.push(
        `${where}.beats[${beatIndex}].highlights must be a non-empty array`,
      );
    } else {
      beat.highlights.forEach((range, j) => {
        const highlight = validateLineRange(
          range,
          `${where}.beats[${beatIndex}].highlights[${j}]`,
          errors,
          { allowDeletionAnchor },
        );
        if (
          highlight &&
          containerRange &&
          (highlight[0] < containerRange[0] || highlight[1] > containerRange[1])
        ) {
          errors.push(
            `${where}.beats[${beatIndex}].highlights[${j}] must be inside ${containerName}`,
          );
        }
      });
    }
  }
  if (beat.oldHighlights !== undefined) {
    if (!Array.isArray(beat.oldHighlights) || beat.oldHighlights.length === 0) {
      errors.push(
        `${where}.beats[${beatIndex}].oldHighlights must be a non-empty array`,
      );
    } else {
      // Old-side ranges address the deleted rows, not the post-change
      // viewport, so only shape is checked here — the checker verifies them
      // against the real diff. [0, 0] is meaningless old-side: deletions have
      // real old line numbers, and whole-file deletion anchors post-change.
      beat.oldHighlights.forEach((range, j) => {
        const highlight = validateLineRange(
          range,
          `${where}.beats[${beatIndex}].oldHighlights[${j}]`,
          errors,
          { allowDeletionAnchor: false },
        );
        if (highlight && (highlight[0] < 1 || highlight[1] < 1)) {
          errors.push(
            `${where}.beats[${beatIndex}].oldHighlights[${j}] must be old-side line numbers`,
          );
        }
      });
    }
  }
}

function validateBeats(
  step: Record<string, unknown>,
  containerRange: [number, number] | undefined,
  containerName: string,
  where: string,
  errors: string[],
  allowDeletionAnchor: boolean,
): void {
  if (step.beats === undefined) return;
  if (!Array.isArray(step.beats) || step.beats.length === 0) {
    errors.push(`${where}.beats must be a non-empty array`);
    return;
  }
  step.beats.forEach((rawBeat, i) => {
    if (
      typeof rawBeat !== "object" ||
      rawBeat === null ||
      Array.isArray(rawBeat)
    ) {
      errors.push(`${where}.beats[${i}] must be an object`);
      return;
    }
    const beat = rawBeat as Record<string, unknown>;
    if (isBlankNarrative(beat.text)) {
      errors.push(`${where}.beats[${i}].text is required`);
    }
    validateNarrative(beat.text, `${where}.beats[${i}].text`, "inline", errors);
    validateBeatHighlights(
      beat,
      i,
      containerRange,
      containerName,
      where,
      errors,
      allowDeletionAnchor,
    );
  });
}

function validateIntent(t: Record<string, unknown>, errors: string[]): void {
  if (t.intent === undefined) return;
  if (
    typeof t.intent !== "object" ||
    t.intent === null ||
    Array.isArray(t.intent)
  ) {
    errors.push("intent must be an object");
    return;
  }
  const intent = t.intent as Record<string, unknown>;
  if (isBlankNarrative(intent.goal)) errors.push("intent.goal is required");
  validateNarrative(intent.goal, "intent.goal", "inline", errors);
  if (intent.design !== undefined && typeof intent.design !== "string")
    errors.push("intent.design must be a string");
  validateNarrative(intent.design, "intent.design", "inline", errors);
  if (intent.sources !== undefined) {
    if (!Array.isArray(intent.sources) || intent.sources.length === 0) {
      errors.push("intent.sources must be a non-empty array");
    } else {
      intent.sources.forEach((s, i) => {
        if (typeof s !== "string" || !s.trim())
          errors.push(`intent.sources[${i}] must be a non-empty string`);
        // Sources are evidence labels the reviewer scans, never formatted prose.
        validateNarrative(s, `intent.sources[${i}]`, "text", errors);
      });
    }
  }
  if (intent.nonGoals !== undefined) {
    if (Array.isArray(intent.nonGoals)) {
      // An empty array means "this change has no deliberate omissions", which is
      // the same honest claim as omitting the field. Rejecting it would fail a
      // whole story over a semantically correct answer.
      intent.nonGoals.forEach((s, i) => {
        if (typeof s !== "string" || !s.trim())
          errors.push(`intent.nonGoals[${i}] must be a non-empty string`);
        validateNarrative(s, `intent.nonGoals[${i}]`, "inline", errors);
      });
    } else {
      errors.push("intent.nonGoals must be an array");
    }
  }
}

/** Shape-only hotspot validation; step-id resolution happens once all ids are known. */
function validateHotspots(t: Record<string, unknown>, errors: string[]): void {
  if (t.hotspots === undefined) return;
  if (!Array.isArray(t.hotspots) || t.hotspots.length === 0) {
    errors.push("hotspots must be a non-empty array");
    return;
  }
  t.hotspots.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`hotspots[${i}] must be an object`);
      return;
    }
    const spot = raw as Record<string, unknown>;
    if (typeof spot.step !== "string" || !spot.step.trim())
      errors.push(`hotspots[${i}].step is required`);
    if (isBlankNarrative(spot.reason))
      errors.push(`hotspots[${i}].reason is required`);
    validateNarrative(spot.reason, `hotspots[${i}].reason`, "inline", errors);
  });
}

const VERIFICATION_RESULTS = ["passed", "failed", "not-run"] as const;

/** Optional record of what the author ran; separate from hotspots, which are doubts. */
function validateVerification(t: Record<string, unknown>, errors: string[]): void {
  if (t.verification === undefined) return;
  if (!Array.isArray(t.verification)) {
    errors.push("verification must be an array");
    return;
  }
  if (t.verification.length > 8)
    errors.push("verification must have at most 8 entries");
  t.verification.forEach((raw, i) => {
    const where = `verification[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.check !== "string" || !entry.check.trim()) {
      errors.push(`${where}.check is required`);
    } else {
      if (entry.check.length > 120)
        errors.push(`${where}.check must be at most 120 characters`);
      validateNarrative(entry.check, `${where}.check`, "text", errors);
    }
    if (!VERIFICATION_RESULTS.includes(entry.result as (typeof VERIFICATION_RESULTS)[number]))
      errors.push(`${where}.result must be one of passed, failed, not-run`);
    if (entry.detail !== undefined) {
      if (typeof entry.detail !== "string" || !entry.detail.trim()) {
        errors.push(`${where}.detail must be a non-empty string when present`);
      } else {
        if (narrativeText(entry.detail).length > 240)
          errors.push(`${where}.detail must be at most 240 characters of text`);
        validateNarrative(entry.detail, `${where}.detail`, "inline", errors);
      }
    }
  });
}

function validateStringArray(
  value: unknown,
  name: string,
  errors: string[],
  opts: { required?: boolean; nonEmpty?: boolean } = {},
): void {
  if (value === undefined) {
    if (opts.required) errors.push(`${name} is required`);
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array`);
    return;
  }
  if (opts.nonEmpty && value.length === 0) {
    errors.push(`${name} must be a non-empty array`);
    return;
  }
  value.forEach((s, i) => {
    if (typeof s !== "string" || !s.trim())
      errors.push(`${name}[${i}] must be a non-empty string`);
  });
}

function validateRepoPath(value: string, name: string, errors: string[]): void {
  try {
    assertSafeRepoPath(value);
  } catch {
    errors.push(`${name} must be a safe repository-relative path`);
  }
}

function validateStoryScope(
  t: Record<string, unknown>,
  errors: string[],
): void {
  if (t.storyScope === undefined) return;
  if (
    typeof t.storyScope !== "object" ||
    t.storyScope === null ||
    Array.isArray(t.storyScope)
  ) {
    errors.push("storyScope must be an object");
    return;
  }
  const scope = t.storyScope as Record<string, unknown>;
  validateStringArray(scope.includedFiles, "storyScope.includedFiles", errors, {
    required: true,
    nonEmpty: true,
  });
  validateStringArray(scope.excludedFiles, "storyScope.excludedFiles", errors);
  if (Array.isArray(scope.includedFiles)) {
    scope.includedFiles.forEach((file, index) => {
      if (typeof file === "string" && file.trim())
        validateRepoPath(file, `storyScope.includedFiles[${index}]`, errors);
    });
  }
  if (Array.isArray(scope.excludedFiles)) {
    scope.excludedFiles.forEach((file, index) => {
      if (typeof file === "string" && file.trim())
        validateRepoPath(file, `storyScope.excludedFiles[${index}]`, errors);
    });
  }
  if (
    scope.reviewerNote !== undefined &&
    typeof scope.reviewerNote !== "string"
  ) {
    errors.push("storyScope.reviewerNote must be a string");
  }
  // Reviewer guidance is echoed back into agent prompts, not into the page.
  validateNarrative(
    scope.reviewerNote,
    "storyScope.reviewerNote",
    "text",
    errors,
  );
  if (scope.regenerated !== undefined) {
    if (!Array.isArray(scope.regenerated)) {
      errors.push("storyScope.regenerated must be an array");
      return;
    }
    scope.regenerated.forEach((entry: unknown, index: number) => {
      const where = `storyScope.regenerated[${index}]`;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push(`${where} must be an object`);
        return;
      }
      const { files, by } = entry as Record<string, unknown>;
      validateStringArray(files, `${where}.files`, errors, {
        required: true,
        nonEmpty: true,
      });
      if (Array.isArray(files)) {
        files.forEach((pattern, patternIndex) => {
          if (typeof pattern === "string" && pattern.trim())
            validateGlobPattern(pattern, `${where}.files[${patternIndex}]`, errors);
        });
      }
      if (typeof by !== "string" || !by.trim()) {
        errors.push(`${where}.by must be a non-empty string`);
      } else if (by.length > 240) {
        errors.push(`${where}.by must be at most 240 characters`);
      }
      // The command renders in the all-files view, so markup never survives it.
      validateNarrative(by, `${where}.by`, "text", errors);
    });
  }
}

/** A cross-file sweep: exactly one safe glob, and the step's own file — the
 *  representative instance the reviewer reads — must match it. */
function validateSweepFiles(
  step: Record<string, unknown>,
  where: string,
  errors: string[],
): void {
  if (!Array.isArray(step.files)) {
    errors.push(`${where}.files must be an array with one glob`);
    return;
  }
  if (step.files.length !== 1 || typeof step.files[0] !== "string") {
    errors.push(`${where}.files must name exactly one glob`);
    return;
  }
  validateGlobPattern(step.files[0], `${where}.files[0]`, errors);
  if (
    typeof step.file === "string" &&
    step.files[0].trim() &&
    !matchGlob(step.files[0], step.file)
  ) {
    errors.push(
      `${where}.file must match its sweep glob: the step shows one matched instance`,
    );
  }
}

/**
 * A glob over repo-relative paths: `*`, `**`, and `?` are welcome, but the
 * pattern must still stay inside the repo — no absolutes, no `..`, no drives.
 */
function validateGlobPattern(value: string, name: string, errors: string[]): void {
  if (!value.trim()) {
    errors.push(`${name} must be a non-empty string`);
    return;
  }
  const segments = value.split("/");
  const bad =
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[a-zA-Z]:/.test(value) ||
    segments.some(
      (segment) => segment === ".." || segment === "" || /[[{}\]!]/.test(segment),
    );
  if (bad) errors.push(`${name} must be a safe repository-relative glob`);
}

function validateStoryArc(
  t: Record<string, unknown>,
  errors: string[],
  codeStory: boolean,
): void {
  if (t.storyArc === undefined) return;
  if (
    typeof t.storyArc !== "object" ||
    t.storyArc === null ||
    Array.isArray(t.storyArc)
  ) {
    errors.push("storyArc must be an object");
    return;
  }
  const arc = t.storyArc as Record<string, unknown>;
  if (codeStory) {
    if (arc.changeType !== undefined) {
      errors.push(
        "storyArc.changeType does not apply to a code story; it explains code that did not change, so drop the field",
      );
    }
    if (!CODE_STORY_SHAPES.includes(arc.shape as CodeStoryShape)) {
      errors.push(
        `storyArc.shape must be one of ${CODE_STORY_SHAPES.join(", ")} in a code story`,
      );
    }
  } else {
    if (!CHANGE_TYPES.includes(arc.changeType as StoryChangeType)) {
      errors.push(`storyArc.changeType must be one of ${CHANGE_TYPES.join(", ")}`);
    }
    if (!NARRATIVE_SHAPES.includes(arc.shape as StoryNarrativeShape)) {
      errors.push(`storyArc.shape must be one of ${NARRATIVE_SHAPES.join(", ")}`);
    }
  }
  if (typeof arc.readingPath !== "string" || !arc.readingPath.trim()) {
    errors.push("storyArc.readingPath is required");
  } else if (arc.readingPath.length > READING_PATH_MAX_CHARS) {
    errors.push(
      `storyArc.readingPath must be at most ${READING_PATH_MAX_CHARS} characters`,
    );
  }
  validateNarrative(
    arc.readingPath,
    "storyArc.readingPath",
    "text",
    errors,
  );
}

/** True for a story that explains existing code at one commit rather than a change. */
export function isCodeStory(tour: unknown): boolean {
  return (
    typeof tour === "object" &&
    tour !== null &&
    (tour as Record<string, unknown>).subject === "code"
  );
}

/**
 * A code story pins one commit. Authors write `head`; `base` defaults to the
 * same id, which is what makes every diff the app takes of the story empty.
 */
export function normalizeCodeStoryRefs(obj: unknown): void {
  if (!isCodeStory(obj)) return;
  const tour = obj as Record<string, unknown>;
  if (tour.base === undefined && typeof tour.head === "string") tour.base = tour.head;
}

/** The fixed facts of a code story: one pinned commit, no diff-only fields. */
function validateCodeStorySubject(t: Record<string, unknown>, errors: string[]): void {
  if (t.version !== 4) errors.push("a code story must be version 4");
  if (typeof t.head !== "string" || !FULL_COMMIT_SHA.test(t.head)) {
    errors.push(
      "head must be the full 40-character commit id the code story explains (git rev-parse HEAD)",
    );
  }
  if (t.base !== undefined && t.base !== t.head) {
    errors.push("base must equal head in a code story; it explains one commit, not a range");
  }
  if (t.storyScope !== undefined) {
    errors.push("storyScope does not apply to a code story; use codeScope.paths for its focus");
  }
  if (t.evolution !== undefined) {
    errors.push("evolution does not apply to a code story");
  }
  if (t.codeScope === undefined) return;
  if (typeof t.codeScope !== "object" || t.codeScope === null || Array.isArray(t.codeScope)) {
    errors.push("codeScope must be an object");
    return;
  }
  errors.push(...codeScopeIssues(t.codeScope as Record<string, unknown>));
}

// A question may span lines; a ref may not.
const QUESTION_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const REF_CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The rules for what a reader asked a code story to explain. The request
 * handler and the file validator both call this, so a request the server
 * accepts can never become a story file the finish gate rejects. The ref and
 * question are reader-authored text, shown only as text (a text node, a
 * textarea, prompt text), so `Map<K, V>` is an ordinary question; only length
 * and control characters are refused.
 */
export function codeScopeIssues(scope: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const text = (value: unknown, name: string, max: number, control: RegExp) => {
    if (value === undefined) return;
    if (typeof value !== "string") {
      errors.push(`${name} must be a string`);
      return;
    }
    if (value.length > max) errors.push(`${name} must be at most ${max} characters`);
    if (control.test(value)) errors.push(`${name} must not contain control characters`);
  };
  text(scope.ref, "codeScope.ref", CODE_SCOPE_MAX_REF, REF_CONTROL);
  text(scope.question, "codeScope.question", CODE_SCOPE_MAX_QUESTION, QUESTION_CONTROL);
  validateStringArray(scope.paths, "codeScope.paths", errors);
  if (Array.isArray(scope.paths)) {
    if (scope.paths.length > CODE_SCOPE_MAX_PATHS) {
      errors.push(`codeScope.paths must list at most ${CODE_SCOPE_MAX_PATHS} paths`);
    }
    scope.paths.forEach((path, index) => {
      if (typeof path === "string" && path.trim())
        validateRepoPath(path, `codeScope.paths[${index}]`, errors);
    });
  }
  return errors;
}

/** Shape-only evolution checks; repository history is verified after loading. */
function validateEvolution(t: Record<string, unknown>, errors: string[]): void {
  if (t.evolution === undefined) return;
  if (
    typeof t.evolution !== "object" ||
    t.evolution === null ||
    Array.isArray(t.evolution)
  ) {
    errors.push("evolution must be an object");
    return;
  }
  const evolution = t.evolution as Record<string, unknown>;
  for (const field of ["baseSha", "headSha"] as const) {
    if (!FULL_COMMIT_SHA.test(String(evolution[field] ?? ""))) {
      errors.push(`evolution.${field} must be a full 40-character commit SHA`);
    }
  }
  if (!Array.isArray(evolution.phases) || evolution.phases.length === 0) {
    errors.push("evolution.phases must be a non-empty array");
    return;
  }
  if (evolution.phases.length > EVOLUTION_MAX_PHASES) {
    errors.push(
      `evolution.phases must contain at most ${EVOLUTION_MAX_PHASES} phases`,
    );
  }
  evolution.phases.forEach((raw, index) => {
    const where = `evolution.phases[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const phase = raw as Record<string, unknown>;
    if (typeof phase.title !== "string" || !phase.title.trim()) {
      errors.push(`${where}.title is required`);
    }
    validateNarrative(phase.title, `${where}.title`, "text", errors);
    if (isBlankNarrative(phase.summary)) {
      errors.push(`${where}.summary is required`);
    }
    validateNarrative(phase.summary, `${where}.summary`, "inline", errors);
    for (const field of ["firstCommit", "lastCommit"] as const) {
      if (!COMMIT_PREFIX.test(String(phase[field] ?? ""))) {
        errors.push(
          `${where}.${field} must be a 7- to 40-character commit SHA`,
        );
      }
    }
    validateStringArray(
      phase.relatedSteps,
      `${where}.relatedSteps`,
      errors,
      { nonEmpty: true },
    );
  });
}

function validateConceptDiagram(
  value: unknown,
  where: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${where}.diagram must be an object`);
    return;
  }
  const diagram = value as Record<string, unknown>;
  if (diagram.type !== "mermaid")
    errors.push(`${where}.diagram.type must be "mermaid"`);
  if (typeof diagram.caption !== "string" || !diagram.caption.trim()) {
    errors.push(`${where}.diagram.caption is required`);
  }
  validateNarrative(
    diagram.caption,
    `${where}.diagram.caption`,
    "inline",
    errors,
  );
  if (typeof diagram.source !== "string" || !diagram.source.trim()) {
    errors.push(`${where}.diagram.source is required`);
    return;
  }

  const source = diagram.source.trim();
  const lines = source.split(/\r?\n/);
  if (source.length > MERMAID_MAX_CHARS) {
    errors.push(
      `${where}.diagram.source must be at most ${MERMAID_MAX_CHARS} characters`,
    );
  }
  if (lines.length > MERMAID_MAX_LINES) {
    errors.push(
      `${where}.diagram.source must be at most ${MERMAID_MAX_LINES} lines`,
    );
  }
  const declaration =
    lines
      .find((line) => line.trim() && !line.trim().startsWith("%%"))
      ?.trim() ?? "";
  if (
    !/^(?:flowchart\s+(?:TD|TB|BT|LR|RL)|sequenceDiagram\b|stateDiagram-v2\b)/.test(
      declaration,
    )
  ) {
    errors.push(
      `${where}.diagram.source must start with flowchart, sequenceDiagram, or stateDiagram-v2`,
    );
  }
  const unsafePatterns: Array<[RegExp, string]> = [
    [/%%\s*\{/i, "configuration directives"],
    [/\bclick\b/i, "click directives"],
    [/\bhref\b/i, "href directives"],
    [/(?:https?:|javascript:|data:)?\/\//i, "external URLs"],
    [/(?:javascript:|data:)/i, "executable or embedded URLs"],
    [/<\/?[a-z][^>]*>/i, "HTML tags"],
    [/\b(?:image|img)\s*:/i, "image directives"],
    [/\b(?:classDef|linkStyle|style)\b/i, "custom style directives"],
  ];
  for (const [pattern, label] of unsafePatterns) {
    if (pattern.test(source))
      errors.push(`${where}.diagram.source cannot contain unsafe ${label}`);
  }
}

function validateConceptStep(
  step: Record<string, unknown>,
  where: string,
  storyVersion: unknown,
  errors: string[],
): void {
  const isPage = step.page !== undefined;
  if (isPage && step.body !== undefined)
    errors.push(`${where} concept step takes either page or body, not both`);
  if (isPage) {
    if (storyVersion !== 4)
      errors.push(`${where}.page requires story version 4`);
    // The page is the author's own document. It is served into a sandbox and
    // never parsed here, so the only check is that there is something to serve.
    if (typeof step.page !== "string" || !step.page.trim())
      errors.push(`${where}.page must be a non-empty string`);
    if (isBlankNarrative(step.narration))
      errors.push(`${where}.narration is required`);
    validateNarrative(step.narration, `${where}.narration`, "text", errors);
    if (step.network !== undefined && typeof step.network !== "boolean")
      errors.push(`${where}.network must be a boolean`);
    if (step.diagram !== undefined)
      errors.push(`${where}.diagram is only allowed with body`);
  } else {
    if (isBlankNarrative(step.body)) errors.push(`${where}.body is required`);
    // The one block-tier field in the whole story: headings, lists, tables, code.
    validateNarrative(step.body, `${where}.body`, "block", errors);
    if (step.narration !== undefined)
      errors.push(`${where}.narration is only allowed with page`);
    if (step.network !== undefined)
      errors.push(`${where}.network is only allowed with page`);
    validateConceptDiagram(step.diagram, where, errors);
  }
  validateStringArray(step.preparesFor, `${where}.preparesFor`, errors, {
    required: storyVersion !== 4,
    nonEmpty: true,
  });
  if (Array.isArray(step.preparesFor)) {
    const refs = step.preparesFor.filter(
      (ref): ref is string => typeof ref === "string",
    );
    if (new Set(refs).size !== refs.length)
      errors.push(`${where}.preparesFor must not contain duplicate step ids`);
  }
  for (const field of CONCEPT_CODE_FIELDS) {
    if (step[field] !== undefined)
      errors.push(`${where}.${field} is not allowed for a concept step`);
  }
}

/** A landing states where the camera is, as plain-text facts the checker verifies. */
function validateLanding(value: unknown, where: string, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${where} must be an object`);
    return;
  }
  const landing = value as Record<string, unknown>;
  const text = (field: unknown, name: string, max: number, required: boolean) => {
    if (field === undefined) {
      if (required) errors.push(`${name} is required`);
      return;
    }
    if (typeof field !== "string" || !field.trim()) {
      errors.push(`${name} must be a non-empty string`);
      return;
    }
    if (field.length > max) errors.push(`${name} must be at most ${max} characters`);
    validateNarrative(field, name, "text", errors);
  };
  text(landing.symbol, `${where}.symbol`, 80, true);
  text(landing.when, `${where}.when`, 80, false);
  if (landing.calledBy !== undefined) {
    if (!Array.isArray(landing.calledBy) || landing.calledBy.length === 0 || landing.calledBy.length > 3) {
      errors.push(`${where}.calledBy must list 1 to 3 callers`);
    } else {
      landing.calledBy.forEach((caller, i) => text(caller, `${where}.calledBy[${i}]`, 80, true));
    }
  }
  if (landing.role !== undefined) {
    if (typeof landing.role !== "object" || landing.role === null || Array.isArray(landing.role)) {
      errors.push(`${where}.role must be an object`);
    } else {
      const role = landing.role as Record<string, unknown>;
      text(role.who, `${where}.role.who`, 40, true);
      text(role.gate, `${where}.role.gate`, 80, false);
    }
  }
  if (landing.calledBy === undefined && landing.role === undefined) {
    errors.push(`${where} needs calledBy (who calls it, by name) or role (who reaches an external entry point)`);
  }
}

function validateCodeStep(
  step: Record<string, unknown>,
  where: string,
  storyFiles: Set<string> | null,
  storyVersion: unknown,
  errors: string[],
): void {
  const stepKind = step.kind as CodeStepKind;
  if (typeof step.file !== "string" || !step.file)
    errors.push(`${where}.file is required`);
  else validateRepoPath(step.file, `${where}.file`, errors);
  if (typeof step.why !== "string") errors.push(`${where}.why is required`);
  validateNarrative(step.why, `${where}.why`, "inline", errors);
  validateStringArray(step.calls, `${where}.calls`, errors);
  if (step.returnsTo !== undefined && typeof step.returnsTo !== "string") {
    errors.push(`${where}.returnsTo must be a string`);
  }
  validateLanding(step.landing, `${where}.landing`, errors);
  if (
    storyFiles &&
    stepKind !== "context" &&
    typeof step.file === "string" &&
    !storyFiles.has(step.file)
  ) {
    errors.push(`${where}.file must be in storyScope.includedFiles`);
  }
  const allowDeletionAnchor = stepKind === "changed";
  const stepRange = validateLineRange(step.range, `${where}.range`, errors, {
    allowDeletionAnchor,
  });
  const viewportRange =
    step.viewport === undefined
      ? undefined
      : validateLineRange(step.viewport, `${where}.viewport`, errors, {
          allowDeletionAnchor,
        });
  const containerRange = viewportRange ?? stepRange;
  const containerName = viewportRange ? `${where}.viewport` : `${where}.range`;
  if (stepKind === "context" && step.ranges !== undefined) {
    errors.push(`${where}.ranges is not allowed for a context step`);
  } else {
    validateClaimedRanges(step, stepRange, where, errors, allowDeletionAnchor);
  }
  if (stepKind === "context" && step.files !== undefined) {
    errors.push(`${where}.files is not allowed for a context step`);
  } else if (step.files !== undefined) {
    validateSweepFiles(step, where, errors);
  }
  validateFocus(
    step,
    containerRange,
    containerName,
    where,
    errors,
    allowDeletionAnchor,
  );
  validateHighlights(
    step,
    containerRange,
    containerName,
    where,
    errors,
    allowDeletionAnchor,
  );
  validateBeats(
    step,
    containerRange,
    containerName,
    where,
    errors,
    allowDeletionAnchor,
  );
  validateMoves(
    step,
    where,
    storyFiles,
    storyVersion,
    viewportRange ?? stepRange,
    errors,
  );
}

function validateMoveAnchor(
  value: unknown,
  name: string,
  storyFiles: Set<string> | null,
  errors: string[],
): { file: string; range: [number, number] } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${name} must be an object`);
    return undefined;
  }
  const anchor = value as Record<string, unknown>;
  const file = typeof anchor.file === "string" ? anchor.file.trim() : "";
  if (file) validateRepoPath(file, `${name}.file`, errors);
  else errors.push(`${name}.file must be a non-empty string`);
  const range = validateLineRange(anchor.range, `${name}.range`, errors);
  if (file && storyFiles && !storyFiles.has(file)) {
    errors.push(`${name}.file must be in storyScope.includedFiles`);
  }
  return file && range ? { file, range } : undefined;
}

/** Hidden facts become accessible callouts, so their schema is intentionally narrow. */
function validateMoveHidden(
  value: unknown,
  name: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${name} must be an object`);
    return;
  }
  const hidden = value as Record<string, unknown>;
  if (!["path", "destination", "consequence"].includes(hidden.as as string)) {
    errors.push(`${name}.as must be one of path, destination, consequence`);
  }
  if (typeof hidden.tag !== "string" || !hidden.tag.trim()) {
    errors.push(`${name}.tag must be a non-empty string`);
  } else {
    validateNarrative(hidden.tag, `${name}.tag`, "text", errors);
    if (hidden.tag.length > 48)
      errors.push(`${name}.tag must be at most 48 characters`);
  }
  if (typeof hidden.what !== "string" || !hidden.what.trim()) {
    errors.push(`${name}.what must be a non-empty string`);
  } else {
    validateNarrative(hidden.what, `${name}.what`, "inline", errors);
    if (hidden.what.length > 120)
      errors.push(`${name}.what must be at most 120 characters`);
  }
}

function validateMoves(
  step: Record<string, unknown>,
  where: string,
  storyFiles: Set<string> | null,
  storyVersion: unknown,
  visibleRange: [number, number] | undefined,
  errors: string[],
): void {
  if (step.moves === undefined && step.pairedView === undefined) return;
  if (storyVersion !== 3 && storyVersion !== 4)
    errors.push(`${where}.moves and pairedView require story version 3 or 4`);
  if (step.kind === "context") {
    if (step.moves !== undefined)
      errors.push(`${where}.moves is not allowed for a context step`);
    if (step.pairedView !== undefined)
      errors.push(`${where}.pairedView is not allowed for a context step`);
    return;
  }
  if (step.moves === undefined) {
    if (step.pairedView !== undefined)
      errors.push(`${where}.pairedView requires ${where}.moves`);
    return;
  }
  if (!Array.isArray(step.moves)) {
    errors.push(`${where}.moves must be an array`);
    return;
  }
  if (step.moves.length > 6)
    errors.push(`${where}.moves must contain at most 6 moves`);
  const ids = new Set<string>();
  const validMoves = new Map<
    string,
    {
      before: { file: string; range: [number, number] };
      after: { file: string; range: [number, number] };
    }
  >();
  step.moves.forEach((rawMove, index) => {
    const name = `${where}.moves[${index}]`;
    if (
      typeof rawMove !== "object" ||
      rawMove === null ||
      Array.isArray(rawMove)
    ) {
      errors.push(`${name} must be an object`);
      return;
    }
    const move = rawMove as Record<string, unknown>;
    if (typeof move.id !== "string" || !move.id.trim()) {
      errors.push(`${name}.id must be a non-empty string`);
    } else if (ids.has(move.id)) {
      errors.push(`${name}.id "${move.id}" is duplicated`);
    } else {
      ids.add(move.id);
    }
    if (!MOVE_KINDS.includes(move.kind as (typeof MOVE_KINDS)[number])) {
      errors.push(`${name}.kind must be one of ${MOVE_KINDS.join(", ")}`);
    }
    const before = validateMoveAnchor(
      move.before,
      `${name}.before`,
      storyFiles,
      errors,
    );
    const after = validateMoveAnchor(
      move.after,
      `${name}.after`,
      storyFiles,
      errors,
    );
    if (move.label !== undefined && typeof move.label !== "string") {
      errors.push(`${name}.label must be a string`);
    } else if (typeof move.label === "string") {
      validateNarrative(move.label, `${name}.label`, "text", errors);
      if (move.label.length > 24)
        errors.push(`${name}.label must be at most 24 characters`);
    }
    validateMoveHidden(move.hidden, `${name}.hidden`, errors);
    if (before && after) {
      if (before.file !== step.file && after.file !== step.file) {
        errors.push(
          `${name} must anchor at least one endpoint in ${where}.file`,
        );
      }
      if (
        before.file === after.file &&
        visibleRange &&
        (after.range[1] < visibleRange[0] || after.range[0] > visibleRange[1])
      ) {
        errors.push(`${name}.after.range must intersect ${where}.viewport`);
      }
      if (
        typeof move.hidden === "object" &&
        move.hidden !== null &&
        !Array.isArray(move.hidden) &&
        (move.hidden as Record<string, unknown>).as === "destination" &&
        before.file === after.file
      ) {
        errors.push(
          `${name}.hidden.as "destination" requires a cross-file move`,
        );
      }
      if (typeof move.id === "string" && move.id.trim())
        validMoves.set(move.id, { before, after });
    }
  });
  if (step.pairedView !== undefined) {
    if (typeof step.pairedView !== "string" || !step.pairedView.trim()) {
      errors.push(`${where}.pairedView must be a non-empty move id`);
      return;
    }
    const move = validMoves.get(step.pairedView);
    if (move) {
      if (move.before.file === move.after.file) {
        errors.push(`${where}.pairedView must reference a cross-file move`);
      }
      if (move.after.file !== step.file) {
        errors.push(
          `${where}.pairedView move after.file must equal ${where}.file`,
        );
      }
    } else {
      errors.push(
        `${where}.pairedView must reference a move id in ${where}.moves`,
      );
    }
  }
}

/**
 * Optional `ranges`: every changed span this step claims for the coverage gate.
 *
 * Deliberately NOT constrained to the viewport. That is the whole point — a
 * mechanical sweep touches lines no single 40-line camera shot can display, and
 * before this existed the only way to claim them was one step per hunk, which
 * produced 60-step stories that lost fields and read as disconnected captions.
 *
 * `range` stays the tight anchor the camera frames (and still drives the
 * viewport caps), so it must correspond to one of the claimed spans rather than
 * their bounding box — a bounding box over scattered spans would license an
 * enormous viewport and defeat the camera contract.
 */
function validateClaimedRanges(
  step: Record<string, unknown>,
  stepRange: [number, number] | undefined,
  where: string,
  errors: string[],
  allowDeletionAnchor: boolean,
): void {
  if (step.ranges === undefined) return;
  if (!Array.isArray(step.ranges) || step.ranges.length === 0) {
    errors.push(`${where}.ranges must be a non-empty array when present`);
    return;
  }
  const parsed = step.ranges.map((value, i) =>
    validateLineRange(value, `${where}.ranges[${i}]`, errors, {
      allowDeletionAnchor,
    }),
  );
  const valid = parsed.filter((r): r is [number, number] => !!r);
  if (valid.length !== parsed.length || !stepRange) return;

  // The anchor must be part of what is claimed, so the framed evidence and the
  // coverage claim can never drift apart.
  const anchored = valid.some((span) =>
    isDeletionAnchor(span) || isDeletionAnchor(stepRange)
      ? isDeletionAnchor(span) && isDeletionAnchor(stepRange)
      : span[0] <= stepRange[0] && span[1] >= stepRange[1],
  );
  if (!anchored) {
    errors.push(
      `${where}.range must be contained in one of ${where}.ranges (the span the viewport frames)`,
    );
  }
}

function storyScopeIncludedFiles(
  t: Record<string, unknown>,
): Set<string> | null {
  if (
    typeof t.storyScope !== "object" ||
    t.storyScope === null ||
    Array.isArray(t.storyScope)
  )
    return null;
  const includedFiles = (t.storyScope as Record<string, unknown>).includedFiles;
  if (!Array.isArray(includedFiles) || includedFiles.length === 0) return null;
  if (!includedFiles.every((f) => typeof f === "string" && f.trim()))
    return null;
  return new Set(includedFiles as string[]);
}

export function loadTour(path: string): Tour {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new TourError(
      `No review story found at ${path}. Open the diff in the diffStory app and generate one.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new TourError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  canonicalizeStepKindAliases(parsed);
  normalizeCodeStoryRefs(parsed);
  const errors = validateTour(parsed);
  if (errors.length) {
    throw new TourError(
      `${path} is not a valid story:\n  - ${errors.join("\n  - ")}`,
    );
  }
  return parsed as Tour;
}

function canonicalizeStepKindAliases(obj: unknown): void {
  if (typeof obj !== "object" || obj === null) return;
  const steps = (obj as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return;
  for (const s of steps) {
    if (typeof s !== "object" || s === null) continue;
    const step = s as Record<string, unknown>;
    if (step.kind === "deleted") step.kind = "changed";
  }
}

export function validateTour(obj: unknown): string[] {
  const errors: string[] = [];
  if (typeof obj !== "object" || obj === null)
    return ["story must be a JSON object"];
  const t = obj as Record<string, unknown>;

  if (t.version !== 1 && t.version !== 2 && t.version !== 3 && t.version !== 4)
    errors.push("version must be 1, 2, 3, or 4");
  if (
    t.diffFingerprint !== undefined &&
    !/^[0-9a-f]{64}$/i.test(String(t.diffFingerprint))
  ) {
    errors.push("diffFingerprint must be a SHA-256 hex digest");
  }
  if (t.storySnapshot !== undefined) {
    const snapshot = t.storySnapshot;
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      Array.isArray(snapshot) ||
      (snapshot as Record<string, unknown>).version !== 1 ||
      !/^[0-9a-f]{64}$/.test(
        String((snapshot as Record<string, unknown>).id ?? ""),
      )
    ) {
      errors.push("storySnapshot must be a version 1 snapshot reference");
    }
  }
  if (t.mode !== undefined && !MODES.includes(t.mode as StoryMode)) {
    errors.push(`mode must be one of ${MODES.join(", ")}`);
  }
  if (t.subject !== undefined && t.subject !== "diff" && t.subject !== "code") {
    errors.push('subject must be "diff" or "code"');
  }
  const codeStory = t.subject === "code";
  if (codeStory) validateCodeStorySubject(t, errors);
  if (isBlankNarrative(t.title)) errors.push("title is required");
  validateNarrative(t.title, "title", "text", errors);
  if (typeof t.summary !== "string")
    errors.push('summary is required (use "" if none)');
  validateNarrative(t.summary, "summary", "inline", errors);
  validateIntent(t, errors);
  validateHotspots(t, errors);
  validateVerification(t, errors);
  validateStoryScope(t, errors);
  validateStoryArc(t, errors, codeStory);
  validateEvolution(t, errors);
  if (!Array.isArray(t.steps) || t.steps.length === 0) {
    errors.push("steps must be a non-empty array");
    return errors;
  }
  const rawSteps = t.steps as unknown[];

  const storyFiles = storyScopeIncludedFiles(t);
  const ids = new Set<string>();
  const orders = new Set<number>();
  const stepsById = new Map<string, Record<string, unknown>>();
  let codeStepCount = 0;
  rawSteps.forEach((s, i) => {
    const where = `steps[${i}]`;
    if (typeof s !== "object" || s === null) {
      errors.push(`${where} must be an object`);
      return;
    }
    const step = s as Record<string, unknown>;
    if (typeof step.id !== "string" || !step.id)
      errors.push(`${where}.id is required`);
    else if (ids.has(step.id))
      errors.push(`${where}.id "${step.id}" is duplicated`);
    else {
      ids.add(step.id);
      stepsById.set(step.id, step);
    }

    if (typeof step.order !== "number") {
      errors.push(`${where}.order must be a number`);
    } else if (!Number.isInteger(step.order) || step.order <= 0) {
      errors.push(`${where}.order must be a positive integer`);
    } else if (orders.has(step.order)) {
      errors.push(`${where}.order ${step.order} is duplicated`);
    } else {
      orders.add(step.order);
    }
    if (typeof step.title !== "string" || !step.title)
      errors.push(`${where}.title is required`);
    validateNarrative(step.title, `${where}.title`, "text", errors);
    if (
      step.chapter !== undefined &&
      (typeof step.chapter !== "string" || !step.chapter.trim())
    ) {
      errors.push(`${where}.chapter must be a non-empty string`);
    }
    // Chapters group the rail by string equality, so they carry no markup.
    validateNarrative(step.chapter, `${where}.chapter`, "text", errors);
    validateStringArray(step.tags, `${where}.tags`, errors);
    if (Array.isArray(step.tags)) {
      step.tags.forEach((tag, tagIndex) =>
        validateNarrative(tag, `${where}.tags[${tagIndex}]`, "text", errors),
      );
    }
    if (
      step.weight !== undefined &&
      step.weight !== "must" &&
      step.weight !== "skim"
    ) {
      errors.push(`${where}.weight must be "must" or "skim"`);
    }
    const stepKind = step.kind as StepKind;
    if (!KINDS.includes(stepKind)) {
      errors.push(`${where}.kind must be one of ${KINDS.join(", ")}`);
      // Keep reporting malformed code-anchor fields alongside the bad kind, as
      // v1 validation did, so authors can fix one step in a single pass.
      validateCodeStep(step, where, storyFiles, t.version, errors);
      return;
    }
    if (codeStory && (stepKind === "changed" || stepKind === "new-file")) {
      errors.push(
        `${where}.kind "${stepKind}" is not allowed in a code story; every code stop shows unchanged code, so use "context"`,
      );
    }
    if (codeStory && Array.isArray(step.beats)) {
      step.beats.forEach((beat, beatIndex) => {
        if (beat && typeof beat === "object" && (beat as Record<string, unknown>).oldHighlights !== undefined) {
          errors.push(
            `${where}.beats[${beatIndex}].oldHighlights do not apply to a code story; there is no old side to point at`,
          );
        }
      });
    }
    if (stepKind === "concept") {
      if (t.version !== 2 && t.version !== 3 && t.version !== 4)
        errors.push(`${where}.kind "concept" requires story version 2, 3, or 4`);
      validateConceptStep(step, where, t.version, errors);
    } else {
      codeStepCount += 1;
      validateCodeStep(step, where, storyFiles, t.version, errors);
    }
  });

  if (codeStepCount === 0)
    errors.push("steps must include at least one code step");

  // Referential integrity for code flow and concept-to-code preparation links.
  // A story's reading path is defined by `order`, even when the JSON array was
  // authored out of order, so adjacency checks use that same canonical path.
  const readingPath = rawSteps
    .map((step, sourceIndex) => ({ step, sourceIndex }))
    .sort((a, b) => {
      const aOrder =
        typeof (a.step as Record<string, unknown> | null)?.order === "number"
          ? ((a.step as Record<string, unknown>).order as number)
          : Number.MAX_SAFE_INTEGER;
      const bOrder =
        typeof (b.step as Record<string, unknown> | null)?.order === "number"
          ? ((b.step as Record<string, unknown>).order as number)
          : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.sourceIndex - b.sourceIndex;
    });

  readingPath.forEach(({ step: s, sourceIndex: i }, pathIndex) => {
    if (typeof s !== "object" || s === null) return;
    const step = s as Record<string, unknown>;
    if (step.kind === "concept") {
      const refs = Array.isArray(step.preparesFor)
        ? step.preparesFor.filter(
            (ref): ref is string => typeof ref === "string",
          )
        : [];
      // v4 hands placement to the author: concepts may sit back to back, open
      // or close the story, and stand alone. Earlier versions keep their rules.
      if (t.version !== 4) {
        const next = readingPath[pathIndex + 1]?.step;
        if (!next || typeof next !== "object" || next === null) {
          errors.push(`steps[${i}] concept step cannot be the last step`);
        } else if ((next as Record<string, unknown>).kind === "concept") {
          errors.push(`steps[${i}] concept steps cannot be adjacent`);
        } else if (
          typeof (next as Record<string, unknown>).id === "string" &&
          !refs.includes((next as Record<string, unknown>).id as string)
        ) {
          errors.push(
            `steps[${i}].preparesFor must include the immediately following code step`,
          );
        }
      }
      for (const ref of refs) {
        const target = stepsById.get(ref);
        if (!target) {
          errors.push(
            `steps[${i}].preparesFor must reference a known later code step; "${ref}" is unknown`,
          );
          continue;
        }
        if (target.kind === "concept") {
          errors.push(
            `steps[${i}].preparesFor must reference later code steps, not concept "${ref}"`,
          );
        }
        if (
          t.version !== 4 &&
          typeof step.order === "number" &&
          typeof target.order === "number" &&
          target.order <= step.order
        ) {
          errors.push(
            `steps[${i}].preparesFor must reference later code steps`,
          );
        }
      }
      return;
    }
    const refs: Array<[field: "calls" | "returnsTo", ref: string]> = [
      ...(Array.isArray(step.calls)
        ? step.calls
            .filter((ref): ref is string => typeof ref === "string")
            .map((ref): ["calls", string] => ["calls", ref])
        : []),
      ...(typeof step.returnsTo === "string"
        ? [["returnsTo", step.returnsTo] as ["returnsTo", string]]
        : []),
    ];
    for (const [field, ref] of refs) {
      if (!ids.has(ref)) {
        errors.push(`steps[${i}] references unknown step id "${ref}"`);
      } else if (stepsById.get(ref)?.kind === "concept") {
        errors.push(
          `steps[${i}].${field} must reference code steps, not concept "${ref}"`,
        );
      }
    }
  });

  // Hotspots anchor distrust to real evidence, so each must resolve to a code step.
  if (Array.isArray(t.hotspots)) {
    t.hotspots.forEach((raw, i) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
      const ref = (raw as Record<string, unknown>).step;
      if (typeof ref !== "string" || !ref.trim()) return;
      if (!ids.has(ref)) {
        errors.push(`hotspots[${i}].step references unknown step id "${ref}"`);
      } else if (stepsById.get(ref)?.kind === "concept") {
        errors.push(
          `hotspots[${i}].step must reference a code step, not concept "${ref}"`,
        );
      }
    });
  }

  if (
    typeof t.evolution === "object" &&
    t.evolution !== null &&
    !Array.isArray(t.evolution) &&
    Array.isArray((t.evolution as Record<string, unknown>).phases)
  ) {
    ((t.evolution as Record<string, unknown>).phases as unknown[]).forEach(
      (raw, phaseIndex) => {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
        const related = (raw as Record<string, unknown>).relatedSteps;
        if (!Array.isArray(related)) return;
        related.forEach((ref, refIndex) => {
          if (typeof ref === "string" && ref.trim() && !ids.has(ref)) {
            errors.push(
              `evolution.phases[${phaseIndex}].relatedSteps[${refIndex}] references unknown step id "${ref}"`,
            );
          }
        });
      },
    );
  }

  return errors;
}

/**
 * Words the reviewer actually hears. Counting the raw field would let markup pad
 * a thin primer past the minimum — "<strong>" is not a word — so the count runs
 * on the text projection, the same string the speech stream is built from.
 */
function conceptWordCount(body: unknown): number {
  return typeof body === "string"
    ? (narrativeText(body).match(/[\p{L}\p{N}_][\p{L}\p{N}_'-]*/gu)?.length ??
        0)
    : 0;
}

/**
 * Generated-primer rules that also apply when a targeted repair upgrades a
 * legacy code-only story. They intentionally do not impose modern camera
 * requirements on untouched v1-era code steps.
 */
export function validateGeneratedConceptSteps(tour: Tour): string[] {
  const errors: string[] = [];
  const concepts = tour.steps
    .map((step, index) => ({ step, index }))
    .filter(
      (
        entry,
      ): entry is {
        step: Extract<TourStep, { kind: "concept" }>;
        index: number;
      } => entry.step.kind === "concept",
    );
  if (!concepts.length) return errors;
  // v4 stories are free: no per-mode cap and no word bounds on any concept.
  if (tour.version === 4) return errors;

  const mode = tour.mode ?? "guided";
  const limit = mode === "brief" ? 1 : mode === "detailed" ? 3 : 2;
  if (concepts.length > limit) {
    errors.push(
      `${mode} stories can include at most ${limit === 1 ? "one" : limit === 2 ? "two" : "three"} concept ${limit === 1 ? "step" : "steps"}`,
    );
  }

  for (const { step, index } of concepts) {
    const words = conceptWordCount(step.body);
    if (words < CONCEPT_MIN_WORDS) {
      errors.push(
        `steps[${index}].body must contain at least ${CONCEPT_MIN_WORDS} words`,
      );
    }
    if (words > CONCEPT_MAX_WORDS) {
      errors.push(
        `steps[${index}].body must stay within ${CONCEPT_MAX_WORDS} words`,
      );
    }
  }
  return errors;
}

/**
 * New stories generated by the app must use the modern storyteller contract.
 * `validateTour()` intentionally stays backward-compatible so older hand-written
 * stories still open; this stricter profile is only applied at generation time.
 */
export function validateGeneratedTour(tour: Tour): string[] {
  // This function is exported and is also used independently by tests and
  // repair detection. Preserve the shape errors instead of assuming every
  // caller already ran loadTour(); strict checks below then add the generation
  // contract without turning malformed agent output into a TypeError.
  const errors: string[] = validateTour(tour);
  errors.push(...validateGeneratedConceptSteps(tour));

  if (tour.version !== 3 && tour.version !== 4)
    errors.push("version must be 3 or 4 for a generated story");
  if (!tour.mode) errors.push("mode is required for a generated story");
  // Callers normally hand this a tour that already passed validateTour(), but it
  // is exported and agent output can be arbitrary — report a missing field
  // rather than throwing, so the reviewer sees a fixable message.
  if (isBlankNarrative(tour.summary)) {
    errors.push("summary must explain the generated reading path");
  }
  if (tour.intent) {
    if (isBlankNarrative(tour.intent.design)) {
      errors.push(
        isCodeStory(tour)
          ? "intent.design must give the short answer: the path this story walks and what it shows"
          : "intent.design must explain the existing app path, attachment point, and new outcome",
      );
    }
    if (!Array.isArray(tour.intent.sources) || !tour.intent.sources.length) {
      errors.push(
        "intent.sources must name the evidence used to recover the task",
      );
    }
  } else {
    errors.push("intent is required for a generated story");
  }
  if ((tour.hotspots?.length ?? 0) > 3) {
    errors.push(
      "hotspots must name at most 3 distrust spots; keep only the places you are least sure about",
    );
  }

  tour.steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    if (step.kind === "concept") {
      return;
    }
    if (isBlankNarrative(step.why)) {
      errors.push(`${where}.why must be a non-empty fallback recap`);
    }
    if (step.ranges !== undefined && !isSkimStep(step)) {
      errors.push(
        `${where}.ranges requires a "skim", "sweep", or "mechanical" tag for a generated story`,
      );
    }
    if (
      (step as { files?: unknown }).files !== undefined &&
      !isSkimStep(step)
    ) {
      errors.push(
        `${where}.files requires a "skim", "sweep", or "mechanical" tag for a generated story`,
      );
    }
    if (!step.viewport)
      errors.push(`${where}.viewport is required for a generated story`);
    if (!step.highlights?.length)
      errors.push(`${where}.highlights are required for a generated story`);
    if (!step.beats?.length)
      errors.push(`${where}.beats are required for a generated story`);

    const stepRange = isComparableLineRange(step.range)
      ? step.range
      : undefined;
    const viewportRange = isComparableLineRange(step.viewport)
      ? step.viewport
      : undefined;
    if (
      viewportRange &&
      stepRange &&
      !isDeletionAnchor(stepRange) &&
      !isDeletionAnchor(viewportRange)
    ) {
      if (stepRange[0] < viewportRange[0] || stepRange[1] > viewportRange[1]) {
        errors.push(`${where}.range must be inside ${where}.viewport`);
      }
      // The caps bound how much *padding* a step frames around its change, not
      // the change itself. A single hunk can exceed the cap, and `range` must
      // span it whole, so capping the viewport below the range's own size makes
      // those two rules unsatisfiable together. Every range therefore keeps a
      // context allowance — roughly six lines either side — on top of its size.
      const viewportLines = viewportRange[1] - viewportRange[0] + 1;
      const rangeLines = stepRange[1] - stepRange[0] + 1;
      const withContext = rangeLines + CONTEXT_ALLOWANCE;
      // Context stops do not claim changed code, so a huge context `range`
      // cannot justify a huge camera. Only changed/new-file steps may need the
      // larger-range exception to frame one genuinely contiguous change.
      const detailedCap =
        step.kind === "context" ? 60 : Math.max(60, withContext);
      const compactCap =
        step.kind === "context" ? 40 : Math.max(40, withContext);
      if (viewportLines > detailedCap) {
        errors.push(
          `${where}.viewport must stay within one 60-line camera shot`,
        );
      }
      if (
        (tour.mode === "brief" || tour.mode === "guided") &&
        viewportLines > compactCap
      ) {
        errors.push(
          `${where}.viewport should stay within 40 lines in ${tour.mode} mode; split the step`,
        );
      }
    }

    const beatLimit = tour.mode === "detailed" ? 5 : 3;
    if ((step.beats?.length ?? 0) > beatLimit) {
      errors.push(
        `${where}.beats should contain at most ${beatLimit} review points in ${tour.mode ?? "guided"} mode; split the step`,
      );
    }

    step.beats?.forEach((beat, beatIndex) => {
      // Two prose failures that make a beat say nothing the diff hasn't already
      // shown. Both are asked for in the skill, but prose guidance lands
      // inconsistently across runs, so the ones that can be checked are checked.
      // Both patterns read the text projection, so markup and entities cannot
      // hide a line-number opener or a value transition from them.
      const beatText = narrativeText(
        typeof beat?.text === "string" ? beat.text : "",
      ).trim();
      if (LINE_NUMBER_OPENER.test(beatText)) {
        errors.push(
          `${where}.beats[${beatIndex}].text must not open by naming line numbers; ` +
            `the highlight already points there — say why those lines matter`,
        );
      }
      if (VALUE_TRANSITION.test(beatText)) {
        errors.push(
          `${where}.beats[${beatIndex}].text must not narrate a value transition; ` +
            `the diff already shows both sides — say what depended on the old value`,
        );
      }
      // A generated story can arrive malformed (an agent omitting both
      // highlight sides, or spelling the beat's `text` as `body`). Report that
      // as a validation error the author can act on — never throw a TypeError
      // from here, since callers surface this message directly to the reviewer.
      const newSide = Array.isArray(beat?.highlights) ? beat.highlights : [];
      const oldSide = Array.isArray(
        (beat as { oldHighlights?: unknown } | null)?.oldHighlights,
      )
        ? ((beat as { oldHighlights: unknown[] }).oldHighlights ?? [])
        : [];
      if (newSide.length === 0 && oldSide.length === 0) {
        errors.push(
          `${where}.beats[${beatIndex}] needs highlights, oldHighlights, or both for a generated story`,
        );
        return;
      }
      // Each side is checked on its own: old-side lines live in a different
      // numbering than new-side ones, so a beat pointing at both is not a jump.
      for (const [field, list] of [
        ["highlights", newSide],
        ["oldHighlights", oldSide],
      ] as const) {
        const validHighlights: Array<{
          range: [number, number];
          sourceIndex: number;
        }> = [];
        list.forEach((highlight, highlightIndex) => {
          if (isComparableLineRange(highlight)) {
            validHighlights.push({
              range: highlight,
              sourceIndex: highlightIndex,
            });
          } else {
            errors.push(
              `${where}.beats[${beatIndex}].${field}[${highlightIndex}] must be a [start, end] pair`,
            );
          }
        });
        const sortedHighlights = validHighlights
          .map(({ range }) => range)
          .sort((a, b) => a[0] - b[0]);
        if (
          sortedHighlights.some(
            (range, index) =>
              index > 0 && range[0] - sortedHighlights[index - 1][1] > 10,
          )
        ) {
          errors.push(
            `${where}.beats[${beatIndex}] jumps across distant code; split it into local review points`,
          );
        }
        validHighlights.forEach(({ range, sourceIndex }) => {
          if (!isDeletionAnchor(range) && range[1] - range[0] + 1 > 12) {
            errors.push(
              `${where}.beats[${beatIndex}].${field}[${sourceIndex}] must point at at most 12 lines`,
            );
          }
        });
      }
    });

    if (step.highlights?.length && step.beats?.length) {
      const stepHighlights = step.highlights.filter(isComparableLineRange);
      const beatHighlights = step.beats
        .flatMap((beat) =>
          Array.isArray(beat.highlights) ? beat.highlights : [],
        )
        .filter(isComparableLineRange);
      if (!sameLineCoverage(stepHighlights, beatHighlights)) {
        errors.push(
          `${where}.highlights must match the union of ${where}.beats highlights`,
        );
      }
    }

    if (step.kind !== "context" && stepRange && step.beats?.length) {
      // A pure-deletion narrative points only at old-side rows the post-change
      // range cannot contain; the checker verifies those against the real diff
      // instead. A step with any new-side beat must still overlap the change.
      const beatOld = (beat: unknown): boolean =>
        Array.isArray((beat as { oldHighlights?: unknown })?.oldHighlights) &&
        ((beat as { oldHighlights: unknown[] }).oldHighlights.length ?? 0) > 0;
      const beatNew = (beat: unknown): boolean =>
        Array.isArray((beat as { highlights?: unknown })?.highlights) &&
        ((beat as { highlights: unknown[] }).highlights.length ?? 0) > 0;
      const allOldSide =
        step.beats.length > 0 &&
        step.beats.every((beat) => beatOld(beat) && !beatNew(beat));
      const coversChange =
        allOldSide ||
        step.beats.some((beat) =>
          (Array.isArray(beat.highlights) ? beat.highlights : [])
            .filter(isComparableLineRange)
            .some((highlight) =>
              isDeletionAnchor(stepRange)
                ? isDeletionAnchor(highlight)
                : !isDeletionAnchor(highlight) &&
                  highlight[0] <= stepRange[1] &&
                  highlight[1] >= stepRange[0],
            ),
        );
      if (!coversChange) {
        errors.push(
          `${where}.beats must include a highlight that overlaps the changed range`,
        );
      }
    }
  });

  return errors;
}

/** Requirements added only to fresh app-generated stories, never legacy repair detection. */
export function validateNewGeneratedStory(tour: Tour): string[] {
  const errors = validateGeneratedTour(tour);
  if (!tour.storyArc) errors.push("storyArc is required for a newly generated story");
  return errors;
}

/** Steps in reading order. */
export function orderedSteps(tour: Tour): TourStep[] {
  return [...tour.steps].sort((a, b) => a.order - b.order);
}
