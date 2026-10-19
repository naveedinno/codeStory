// Shared data shapes for diffStory.
//
// Two authored artifacts flow through the system:
//   - the *story* (story.json) — written by the AI, describes the reading order.
//   - the *comments* (comments.json) — written by the reviewer (via the server),
//     read back by the AI to close the loop.
// Everything else (diffs, snippets, coverage) is derived at render time.

/** What a tour step is pointing at. */
export type CodeStepKind =
  | 'changed' // a region the diff actually touched — render the real hunk(s)
  | 'context' // unchanged code shown only so the change makes sense (e.g. the callee)
  | 'new-file'; // a brand-new file — render the region as added

/** A stop in the reading path: either code evidence or a just-in-time mental model. */
export type StepKind = CodeStepKind | 'concept';

/**
 * App-owned presentation layout derived from a validated step. This is a view
 * projection, never an authored story.json field.
 */
export type StoryStepSceneLayout =
  | 'concept-document'
  | 'concept-diagram'
  | 'concept-page'
  | 'code-focus'
  | 'logic-move'
  | 'paired-code';

/** How much detail the authored story should carry. */
export type StoryMode =
  | 'brief' // compact story: every changed hunk, grouped into the fewest useful stops
  | 'guided' // guided review: behavior and context without line-by-line narration
  | 'detailed'; // deep review: more correctness boundaries, while still skipping trivial syntax

/**
 * Who the story is written for. Newcomers get full landings and primers;
 * familiar readers get terse landings and primers only for new ideas.
 * Experts pay a penalty for newcomer guidance (expertise reversal).
 */
export type StoryAudience = 'newcomer' | 'familiar';

/** Optional legacy read-aloud pointer inside a step's wider review window. */
export interface StepFocusTarget {
  /** Inclusive post-change line ranges to glow; [0, 0] means a whole-file deletion. */
  ranges: Array<[number, number]>;
  /** Optional short cue for future reader surfaces. */
  label?: string;
}

/**
 * One read-aloud unit inside a step.
 *
 * Narrative fields across these shapes are authored as restricted HTML, in one
 * of three tiers — block, inline-only, or plain text — fixed by what the
 * surrounding markup can legally hold. docs/story-schema.md is the normative
 * statement of the tiers and the element/attribute allowlist.
 */
export interface StoryBeat {
  /**
   * Short narration spoken as one separate speech unit. Inline-tier HTML: this
   * renders inside a `<button>`, which cannot hold block content.
   */
  text: string;
  /**
   * Inclusive post-change line ranges this beat points at while it is spoken.
   * Optional only when `oldHighlights` carries the beat instead.
   */
  highlights?: Array<[number, number]>;
  /**
   * Inclusive OLD-side line ranges this beat points at: deleted lines that no
   * longer exist post-change. A beat needs `highlights`, `oldHighlights`, or
   * both — never neither. Old-side ranges glow the red deleted rows.
   */
  oldHighlights?: Array<[number, number]>;
}

/** The recovered "why" behind the change — shown before any step. */
export interface StoryIntent {
  /** What we wanted to enable: actor + capability, 1-2 sentences. Inline-tier HTML. */
  goal: string;
  /** The flow designed to achieve it, 1-2 sentences. Inline-tier HTML. */
  design?: string;
  /** Evidence the goal rests on: "commit 41af8b7", "PR #12 body", "conversation", "docs/plan.md", or "code-derived". */
  sources?: string[];
  /** Deliberate omissions the reviewer should not flag: "does not touch settlement ordering". Inline-tier HTML. */
  nonGoals?: string[];
}

/** An author-declared low-confidence spot: where the reviewer should distrust the change hardest. */
export interface StoryHotspot {
  /** Id of the code step whose evidence carries the doubt. */
  step: string;
  /** Why the author is least sure here: a guessed boundary, unexercised path, or unverified invariant. Inline-tier HTML. */
  reason: string;
}

/** Something the author ran (or could not run) to check the change. */
export interface StoryVerification {
  /** What was run, as the reviewer would type or recognise it. Plain text, ≤ 120 chars. */
  check: string;
  result: 'passed' | 'failed' | 'not-run';
  /** Optional one-line qualifier. Inline-tier HTML, ≤ 240 chars of text. */
  detail?: string;
}

/** One generator whose outputs need no story steps, only a command row. */
export interface StoryRegenerated {
  /** Glob patterns (`*`, `**`, `?`) over repo-relative paths, e.g. `abis/*.json`. */
  files: string[];
  /** The command that produced them, e.g. `npx hardhat export-abi`. Plain text. */
  by: string;
}

/** The changed files the reviewer intentionally asked the generated story to cover. */
export interface StoryScope {
  /** Repo-relative changed files that should receive story steps. */
  includedFiles: string[];
  /** Repo-relative changed files intentionally left out of the story. */
  excludedFiles?: string[];
  /**
   * Optional reviewer guidance captured from the generation form. Plain text —
   * it is reviewer-authored through a browser textarea and has no render
   * surface, so it never carries markup.
   */
  reviewerNote?: string;
  /** Generated outputs explained by their generator command instead of steps. */
  regenerated?: StoryRegenerated[];
}

/** What kind of change the story explains. */
export type StoryChangeType =
  | 'feature'
  | 'bug-fix'
  | 'refactor'
  | 'security'
  | 'performance'
  | 'migration'
  | 'maintenance'
  | 'mixed';

/** The reading structure used to order the final diff. */
export type StoryNarrativeShape =
  | 'cause-effect'
  | 'entry-implementation'
  | 'before-after'
  | 'core-supporting'
  | 'rule-instances';

/** What a story explains: a change, or existing code at one commit. */
export type StorySubject = 'diff' | 'code';

/** The reading structures a code story uses to explain code nobody changed. */
export type CodeStoryShape =
  | 'entry-implementation'
  | 'lifecycle'
  | 'data-flow'
  | 'map-then-path'
  | 'core-supporting'
  | 'rule-instances'
  | 'cause-effect';

/**
 * What the reader asked a code story to explain. Plain text throughout: it is
 * reader-authored and echoed back into prompts and labels, never rendered as markup.
 */
export interface CodeScope {
  /** The name the reader picked ("main", "v1.2.0"); `head` pins its commit. */
  ref?: string;
  /** The request as typed: what the reader wants to understand. */
  question?: string;
  /** Repo-relative files or directories the reader asked the story to focus on. */
  paths?: string[];
}

/** A compact declaration of how the reviewer should read the final change. */
export interface StoryArc {
  /** Diff stories only, where it is required. A code story explains code that did not change. */
  changeType?: StoryChangeType;
  shape: StoryNarrativeShape | CodeStoryShape;
  /** Plain-text stages separated with ASCII `->`; the UI renders proper arrows. */
  readingPath: string;
}

/** One contiguous first-parent phase in a fixed commit range. */
export interface StoryEvolutionPhase {
  /** Plain-text phase heading. */
  title: string;
  /** Inline-tier explanation of what changed during this phase. */
  summary: string;
  /** Inclusive commit boundaries. Prefixes are expanded by the server after generation. */
  firstCommit: string;
  lastCommit: string;
  /** Story steps whose final-code evidence reflects this phase. */
  relatedSteps?: string[];
}

/** Stable history context for a fixed-range story. */
export interface StoryEvolution {
  /** Server-owned immutable endpoints. */
  baseSha: string;
  headSha: string;
  phases: StoryEvolutionPhase[];
}

/**
 * How much attention a stop asks for. `must` is the default: the core path.
 * `skim` marks supporting stops the rail collapses and a must-read-only
 * walkthrough skips. Weight never affects diff coverage.
 */
export type StoryStepWeight = 'must' | 'skim';

/** Fields shared by every stop in the guided reading path. */
export interface TourStepBase {
  /** Stable id, referenced by `calls` / `returnsTo` and by comments. */
  id: string;
  /** 1-based position in the reading order. */
  order: number;
  /** Attention weight; absent reads as `must`. */
  weight?: StoryStepWeight;
  /**
   * Short headline for the step. Plain text — it feeds nine sinks including
   * `aria-label` and `title` attributes, where markup can only ever show as
   * literal characters.
   */
  title: string;
  /** Optional free-form labels (e.g. "entrypoint", "core", "test"). */
  tags?: string[];
  /** Optional concise section label for grouping long reading paths. */
  chapter?: string;
}

/** Fields shared by every code-backed stop. */
/**
 * Where a code step's camera lands, as facts the story checker verifies:
 * the symbol on screen, who reaches it by name (or, for an external entry
 * point, the role and the check that gates it), and when. Plain text.
 */
export interface StepLanding {
  /** The symbol on screen as a reviewer would search for it: "_capRate()", ".ds-main". */
  symbol: string;
  /** 1-3 functions, handlers, tests, or components that reach it, by name. */
  calledBy?: string[];
  /** For an external entry point with no calling function: who calls it, and the gate. */
  role?: { who: string; gate?: string };
  /** When it runs: "once per market, after the config is picked". */
  when?: string;
}

export interface CodeTourStepBase extends TourStepBase {
  /** Repo-relative path of the file this step shows. */
  file: string;
  /** Inclusive local camera anchor and legacy coverage claim; [0, 0] means a whole-file deletion. */
  range: [number, number];
  /** Inclusive visible review window the storyteller wants the diff viewer to show. */
  viewport?: [number, number];
  /** Inclusive post-change line ranges inside viewport; [0, 0] means a whole-file deletion. */
  highlights?: Array<[number, number]>;
  /** Optional beat-by-beat narration; each beat is spoken separately with its own highlights. */
  beats?: StoryBeat[];
  /** Optional legacy narrower post-change line range(s) to point at while reading aloud. */
  focus?: StepFocusTarget;
  /**
   * The review-oriented narrative: what to verify, what's subtle, why it's safe.
   * Inline-tier HTML — it renders inside a height-capped `<p>`.
   */
  why: string;
  /** Step ids this one leads into (renders the A -> B jump links). */
  calls?: string[];
  /** Step id to return to afterwards (the B -> A jump back). */
  returnsTo?: string;
  /** Verified "where am I" facts; rendered under the step title. */
  landing?: StepLanding;
}

/** Which version of a file a semantic move endpoint addresses. */
export interface MoveAnchor {
  /** Repo-relative path. Cross-file moves may name a path other than the step file. */
  file: string;
  /** Inclusive old-side (`before`) or new-side (`after`) line range. */
  range: [number, number];
}

/** The closed vocabulary the app can render as a semantic logic move. */
export type LogicMoveKind =
  | 'moved'
  | 'extracted'
  | 'inlined'
  | 'wrapped'
  | 'unwrapped'
  | 'condition-changed'
  | 'reordered'
  | 'flow';

/** A fact about a move that has no line of code to point at. */
export interface MoveHidden {
  /** The invisible relationship the callout describes. */
  as: 'path' | 'destination' | 'consequence';
  /** Short plain-text callout headline. */
  tag: string;
  /** One inline-tier clause the reviewer can act on. */
  what: string;
}

/** One agent-authored semantic relationship between old and new code. */
export interface LogicMove {
  /** Unique within the containing step. */
  id: string;
  kind: LogicMoveKind;
  before: MoveAnchor;
  after: MoveAnchor;
  /** Two- or three-word plain-text tag rendered on the annotation border. */
  label?: string;
  /** The one fact about this move that neither pane shows. */
  hidden?: MoveHidden;
}

/** A changed/new-file stop that may explicitly claim scattered changed spans. */
export interface ChangedCodeTourStep extends CodeTourStepBase {
  kind: 'changed' | 'new-file';
  /**
   * Optional complete coverage-claim list for scattered changed/new-file spans in one file.
   * `range` remains the tight camera anchor contained by one entry; other entries
   * may sit outside `viewport` and must not be collapsed into a bounding box.
   * Absent means the step claims exactly `range`, preserving legacy behaviour.
   */
  ranges?: Array<[number, number]>;
  /**
   * ONE glob (e.g. `src/i18n/*.json`) sweeping one mechanical change across
   * files. The step's own `file` is the representative instance the reviewer
   * reads; every other matched changed file must carry the same structural
   * edit (verified by the checker), and coverage claims all of it.
   */
  files?: string[];
  /** Semantic moves this step's evidence demonstrates. Requires story version 3. */
  moves?: LogicMove[];
  /** Cross-file move id to present as old-file/new-file paired panes. Requires version 3. */
  pairedView?: string;
}

/** An unchanged-code stop; context can frame evidence but never claim diff coverage. */
export interface ContextCodeTourStep extends CodeTourStepBase {
  kind: 'context';
  ranges?: never;
  files?: never;
}

/** One code-backed stop with a local camera anchor. */
export type CodeTourStep = ChangedCodeTourStep | ContextCodeTourStep;

/** Optional diagram inside a concept primer. Source is rendered locally by Mermaid. */
export interface ConceptDiagram {
  type: 'mermaid';
  source: string;
  /**
   * Human-readable fallback and accessible description for the diagram.
   * Inline-tier HTML; it is also what the narrator speaks for the figure.
   */
  caption: string;
}

/** A short document stop that teaches a mental model before dependent code. */
export interface LegacyConceptTourStep extends TourStepBase {
  kind: 'concept';
  /**
   * Block-tier narrative HTML: paragraphs, h2-h4, lists, quotes, `pre`, tables,
   * and definition lists. See docs/story-schema.md for the allowlist.
   */
  body: string;
  /** Later code-step ids this primer exists to prepare the reviewer for. */
  preparesFor: string[];
  /** At most one optional local Mermaid diagram. */
  diagram?: ConceptDiagram;
  page?: never;
  narration?: never;
}

/**
 * A v4 concept stop the author builds as a whole HTML page. The app never parses
 * it: the page is served from its own endpoint into a sandboxed iframe.
 */
export interface PageConceptTourStep extends TourStepBase {
  kind: 'concept';
  /** A complete HTML document. Any markup and inline script; CDN resources need `network`. */
  page: string;
  /** Plain text Aloud speaks and screen readers announce for the page. */
  narration: string;
  /**
   * Opt into network access for this page (CDN libraries, fonts, fetches).
   * Absent or false serves the page fully offline: inline markup, script, and
   * style still run, but every network request is blocked.
   */
  network?: boolean;
  /** Optional later code-step ids this page prepares the reviewer for. */
  preparesFor?: string[];
  body?: never;
  diagram?: never;
}

export type ConceptTourStep = LegacyConceptTourStep | PageConceptTourStep;

/** One stop on the guided tour. */
export type TourStep = CodeTourStep | ConceptTourStep;

export function isCodeStep(step: TourStep): step is CodeTourStep {
  return step.kind !== 'concept';
}

export function isPageConcept(step: TourStep): step is PageConceptTourStep {
  return step.kind === 'concept' && typeof (step as PageConceptTourStep).page === 'string';
}

/**
 * Every changed span a code step claims for the coverage gate. `ranges` exists so
 * one step can honestly claim scattered edits (a rename across twenty call sites)
 * instead of forcing one step per hunk; without it, `range` alone is the claim.
 */
export function claimedRanges(step: CodeTourStep): Array<[number, number]> {
  return step.ranges?.length ? step.ranges : [step.range];
}

/** The whole reading plan the AI emits. */
export interface Tour {
  /** v1 code-only; v2 concepts; v3 semantic moves; v4 page concepts and free concept placement. */
  version: 1 | 2 | 3 | 4;
  /** SHA-256 of the exact rendered git diff when the story was last generated or repaired. */
  diffFingerprint?: string;
  /** Immutable post-story repository evidence used for scope-aware freshness and since-story diffs. */
  storySnapshot?: { version: 1; id: string };
  /** Story depth requested at generation time; old stories default to guided. */
  mode?: StoryMode;
  /**
   * What the story explains. Absent means a diff story. A `code` story explains
   * existing code at one commit: `head` is that commit's full id, `base` equals
   * it, and every code step is a `context` step.
   */
  subject?: StorySubject;
  /** Code stories only: what the reader asked the story to explain. */
  codeScope?: CodeScope;
  /** Plain text — it feeds `<title>`, the page header, and a chrome tooltip. */
  title: string;
  /** Inline-tier HTML — it renders inside the intro `<p>` the narrator reads. */
  summary: string;
  /** Optional recovered intent: the goal, designed flow, and evidence sources. */
  intent?: StoryIntent;
  /** Author-declared distrust spots (at most 3), each anchored to a code step. */
  hotspots?: StoryHotspot[];
  /** What the author ran to check the change, and what could not be run. */
  verification?: StoryVerification[];
  /** Optional file-level generation scope for focused stories. */
  storyScope?: StoryScope;
  /** How this story orders and explains the final diff. */
  storyArc?: StoryArc;
  /** Optional verified first-parent history for fixed commit ranges. */
  evolution?: StoryEvolution;
  /** Optional git ref to diff against; overrides auto-detection. */
  base?: string;
  /** Optional head ref for fixed base..head stories. Omitted means working tree vs base. */
  head?: string;
  steps: TourStep[];
}

export type CommentType = 'change' | 'question' | 'nit';
/** Legacy impact field retained only so older comments.json files remain readable. */
export type CommentSeverity = 'blocking' | 'concern' | 'nit';
export type CommentStatus = 'open' | 'addressed' | 'resolved';
export type CommentSide = 'left' | 'right';

/** Legacy conversation data retained for backwards-compatible file parsing. */
export interface Turn {
  role: 'user' | 'ai';
  text: string;
  /** ISO timestamp; set by the server. */
  at: string;
}

/** The selected code text a reviewer anchored a comment to. */
export interface CommentSelection {
  /** Inclusive line range covered by the selected text, on the selected diff side. */
  startLine: number;
  endLine: number;
  /** Best-effort 1-based column offsets inside the first and last selected lines. */
  startColumn?: number;
  endColumn?: number;
}

/** A reviewer comment anchored to selected text, persisted for the agent to consume. */
export interface Comment {
  id: string;
  /**
   * Story this comment was left against, as a listStories() id ("story.json",
   * "stories/quote-v2.json"). Absent on comments written before stories were
   * separable, and on comments left outside a story; an absent value reads as
   * "belongs to every story" so no existing feedback disappears.
   */
  story?: string;
  /** Optional Story-view placement hint; absent for comments left in the All-files view. */
  step?: string;
  /** Diff side selected by the reviewer. Absent means the legacy right/current side. */
  side?: CommentSide;
  file: string;
  /** First selected-side line for placement and backward compatibility. */
  line: number;
  /** Reviewer-selected code/text snippet. Absent on legacy line-anchored comments. */
  selectedText?: string;
  /** Selected-side line range and optional columns. */
  selection?: CommentSelection;
  type: CommentType;
  /** Legacy field; new comments use their type without a second severity axis. */
  severity?: CommentSeverity;
  body: string;
  status: CommentStatus;
  /** Review round in which the comment was created. */
  reviewRound?: number;
  /** Snapshot the selected code belonged to, for version-aware verification. */
  reviewSnapshotId?: string;
  /** Stable digest of the selected text and its original anchor. */
  anchorHash?: string;
  /** ISO timestamp; set by the server. */
  createdAt: string;
  /** Legacy AI field; preserved on disk but not used by the review UI. */
  reply?: string;
  /** Legacy conversation field; preserved on disk but not used by the review UI. */
  turns?: Turn[];
}

// ---- Story history snapshots ----

/** One automatic snapshot of a story file under `.diffstory/history/`. */
export interface StoryHistoryEntry {
  /** listStories()-style id, e.g. "history/story-20261003T120000-a1b2c3d4.json". */
  id: string;
  /** File name within `.diffstory/history`. */
  name: string;
  /** Story id this snapshot was taken from. */
  storyId: string;
  /** ISO timestamp of when the snapshot file was written. */
  takenAt: string;
  /** Full SHA-256 of the snapshot bytes. */
  sha: string;
  updatedAt: number;
  valid: boolean;
  title: string;
  steps: number;
  /** Field-level summary against the current story; absent when current is unreadable. */
  diff?: StoryHistoryDiff;
}

/** How a snapshot differs from the live story: titles, step counts, step ids. */
export interface StoryHistoryDiff {
  titleChanged: boolean;
  stepDelta: number;
  addedSteps: string[];
  removedSteps: string[];
}

// ---- Derived (parsed) diff shapes ----

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  /** Line number in the old file (undefined for added lines). */
  oldNo?: number;
  /** Line number in the new file (undefined for deleted lines). */
  newNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** git's funcname text after the second @@ — the nearest enclosing declaration. */
  context?: string;
  lines: DiffLine[];
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  hunks: DiffHunk[];
}

/**
 * Bounded metadata for one changed path. Unlike DiffFile this shape never
 * carries hunk or source bytes, so it is safe to build for the initial page
 * even when the underlying change is extremely large.
 */
export interface ReviewFileIndexEntry {
  oldPath: string;
  path: string;
  status: FileStatus;
  added: number | null;
  removed: number | null;
  /** Current-side size, or base-side size for a deletion. */
  byteSize: number | null;
  binary: boolean;
  large: boolean;
  generated: boolean;
  metadataOnly: boolean;
  /** Stable identity for lazy detail responses and stale-response rejection. */
  reviewHash: string;
}
