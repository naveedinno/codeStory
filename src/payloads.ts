// The `__DIFFSTORY_DATA__` payload shapes — the contract between a route
// handler and its React surface.
//
// This module carries plain JSON-serializable interfaces and nothing else. That
// is what lets `client/` import these with `import type` across the src/client
// boundary and keep ONE definition of each shape instead of two that drift.
// `import type` is erased before esbuild ever sees it, so nothing from `src/` is
// bundled into the browser.
//
// It imports types from exactly two other modules, `./types.js` and
// `./noise.js`, and only because both are themselves import-free. That matters
// more than it looks: the client typechecker runs with `types: []` and no Node
// typings, so a type-only import that transitively reaches a module with
// `import { createHash } from 'node:crypto'` (which `view-model.ts` and
// `review-state.ts` both do) fails the client build. Anything those modules own
// is therefore restated here as a narrow projection rather than re-exported.
//
// Rules for anything added here (see
// `docs/superpowers/specs/server-shell-contract.md` §1):
//   - plain JSON only. No Map, no Set, no Date — epoch milliseconds and arrays.
//   - the payload is the whole initial state; do not smuggle state into
//     `data-*` attributes on <body>.
//   - keep presentation OUT. Raw values (`path`, `lastOpened`) travel; the
//     formatting (`~/…`, "7 min ago") happens in the component.

/**
 * One row of the recents list, as `recentRowsForPicker()` projects it.
 *
 * Formerly exported from `src/picker.ts`. That module rendered HTML and is
 * gone; the shape outlived it because `DELETE /api/repos/recent` returns a
 * fresh array of exactly this type.
 */
export interface RecentRow {
 path: string;
 name: string;
 isGit: boolean;
 hasTour: boolean;
 currentBranch: string | null;
 changedFiles: number;
 /** Epoch milliseconds. */
 lastOpened: number;
}

/** `GET /` (no repo), `GET /repos`, and the no-repo fallback for /change,/review. */
export interface PickerPayload {
 recents: RecentRow[];
 /** `os.homedir()`, used to render "~/…" paths client-side. */
 home: string;
 /** Server clock at render time — relative times must not use the client clock. */
 now: number;
}

/** One changed file, as `numstat()` reports it. `null` counts mean binary. */
export interface ChangeFileView {
 path: string;
 /** Added lines, or `null` for a binary / metadata-only change. */
 added: number | null;
 /** Removed lines, or `null` for a binary / metadata-only change. */
 removed: number | null;
}

/**
 * `GET /repo/<name>/change` — the scope picker.
 *
 * Also the review route's error surface: `reviewScreen()` falls through to
 * `changeScreen(…, notice)` when the selected story is missing or will not
 * parse, and `notice` is then the ONLY explanation the reviewer gets. It is
 * optional on the type and load-bearing in practice.
 *
 * Two departures from the shape proposed in `server-shell-contract.md` §5.3,
 * both because the proposal described the pre-resolution arguments rather than
 * what `changeScreen()` actually has in hand:
 *
 *   - `base` / `head` are the RESOLVED scope (`resolveScope()`), not "the
 *     session's explicit overrides". `changeScreen` writes the resolved pair
 *     onto the session before rendering, so by this point `base` is always a
 *     concrete ref ('HEAD', a parent SHA, a branch name) and `head` is absent
 *     only for a working-tree comparison. They are exactly the two values the
 *     `/diff` link has to carry, which is why they travel.
 *   - `active` includes `'uncommitted'`. The proposal listed `'' | 'compare' |
 *     'commit'`; `''` is unreachable from this route and `'uncommitted'` is the
 *     value that marks the first segment `aria-current`.
 *
 * `totalChanged` / `hasChanges` from the proposal are dropped: both are
 * `files.length`, and a second copy of a number can only ever disagree with it.
 */
export interface ChangePayload {
 repoName: string;
 /** `/repo/<encoded name>` — every link on the surface is built from this. */
 routeBase: string;
 /** Resolved base ref for the current scope. */
 base: string;
 /** Resolved head ref, absent when the comparison ends at the working tree. */
 head?: string;
 /** Human scope description from `resolveScope()`, e.g. "Uncommitted changes". */
 scopeLabel: string;
 active: "uncommitted" | "commit" | "branch" | "compare";
 /** Branch scope only: the branch under review, as the URL named it. */
 branch?: string;
 /** Branch scope only: the parent ref when pinned; absent means auto-detected. */
 branchFrom?: string;
 files: ChangeFileView[];
 /** Set only when a review route could not load its story. */
 notice?: string;
 /** Set only when a requested scope ref fell back to something else. */
 scopeNotice?: string;
}

/**
 * One saved review, as the review-history route projects a `StorySummary`.
 *
 * A narrowed projection rather than the raw summary: `StorySummary` also carries
 * `path` (an absolute filesystem path), plus `mode` / `base` / `head` and a
 * `current` boolean that `freshness` already answers. None of that is read by
 * the UI, and shipping an absolute path into the document is avoidable.
 *
 * `title` and `summary` arrive with `narrativeText()` already applied, because
 * this page renders plain text end to end and the client bundle should not have
 * to carry the narrative parser. Their *fallbacks* are presentation and stay in
 * the component: an empty `title` renders as the story id, an empty `summary`
 * as "No summary yet.".
 */
export interface StoryRowView {
 /** Also the `?story=` value for the review link. */
 id: string;
 /** `narrativeText()` of the authored title. Empty when the file is unreadable. */
 title: string;
 /** `narrativeText()` of the authored summary. Empty when there is none. */
 summary: string;
 /** Why the story could not be read. Present only when `valid` is false. */
 error?: string;
 valid: boolean;
 /** Epoch milliseconds — the story file's mtime. */
 updatedAt: number;
 steps: number;
 primers: number;
 files: number;
 freshness: "current" | "stale" | "unverified";
 inStoryDrift: number;
 outsideStoryDrift: number;
 /**
  * Live evidence. Meaningful only when `StoriesPayload.liveEvidence` is true;
  * the metadata projection reports zeroes (and a `liveFiles` count taken from
  * the story's own steps rather than from the diff).
  */
 liveFiles: number;
 additions: number;
 deletions: number;
 openComments: number;
 /** `command` is the raw git invocation, shown as the chip's `title`. */
 scope: { label: string; command: string };
 /** What the story explains: a diff, or existing code at one commit. */
 subject: "diff" | "code";
 /** Code stories only: the short id of the commit the story explains. */
 shortCommit?: string;
}

/** `GET /repo/<name>`, `/repo/<name>/`, `/repo/<name>/stories`. */
export interface StoriesPayload {
 repoName: string;
 /** `/repo/<encoded-basename>` — every link on the page is built from it. */
 routeBase: string;
 /** Newest-updated first, tie-broken by id. */
 stories: StoryRowView[];
 /**
  * True only when `?evidence=refresh` was honoured, i.e. the rows came from
  * `listStories()` and not `listStoryMetadata()`.
  *
  * One flag for the whole list, not one per row: both projections are a single
  * call, so every row in a payload always agrees. It gates the badge state
  * machine ("Saved" when false) and the `+A −D` fact, which must not be
  * presented as fact when nobody rebuilt the diff.
  */
 liveEvidence: boolean;
 /** Server clock at render time — relative times must not use the client clock. */
 now: number;
}

// ---------------------------------------------------------------------------
// review — the review page, storyful and storyless
// ---------------------------------------------------------------------------
//
// One surface, two entry points: `GET /repo/<n>/review` renders it with a story
// and `GET /repo/<n>/diff` renders the same page with `storyless: true` and a
// synthetic empty tour. There is no separate "diff" surface.
//
// The shape below is a NARROW PROJECTION of `ReviewModel`, not the model
// itself, and that is deliberate on two counts.
//
// 1. Size. The route builds its model metadata-first — `files: []`,
//    `detailedStepIndexes: new Set()`, `detailedFilePaths: new Set()`,
//    `trustPending: true` — so that a 300-step story ships 300 tiny stubs
//    instead of 300 highlighted diffs. Shipping `ReviewModel` verbatim would
//    put every step's `blocks`, `moves` and `focusGroups` into the document and
//    quietly undo that. What travels here is what the initial DOM actually
//    renders: rail cards, filmstrip labels, speech projections, file rows.
// 2. Reachability. `ReviewModel` lives in `view-model.ts`, which imports
//    `node:crypto`; see the note at the top of this file.
//
// Everything the projection omits arrives later through the lazy endpoints,
// each of which still returns server-rendered diff HTML.

import type { Comment, ReviewFileIndexEntry, StoryAudience, StoryMode, StoryStepSceneLayout, StoryStepWeight } from "./types.js";
import type { ReviewExclusionMetadata } from "./noise.js";

/** A projected narrative: sanitized HTML, flat text, and the spoken form. */
export interface ReviewProse {
 html: string;
 text: string;
 /** What narration reads. Never derived from `text` — the parser owns it. */
 speech: string;
}

/** One story-health finding: a contract error, a lint, or a runtime diagram failure. */
export interface StoryHealthFinding {
 kind: "contract" | "lint" | "diagram";
 severity: "error" | "warning";
 /** Original locator (`steps[2]`, `steps[s4].beats[0]`, `story`). */
 where: string;
 message: string;
 /** Lint rule id; absent for contract and diagram findings. */
 rule?: string;
 /** What to do about it; contract errors explain themselves. */
 fix?: string;
 /** Resolved target step, when the finding names one that exists. */
 stepId?: string;
 /** 1-based panel index for `data-goto-step` jumps. */
 panelIndex?: number;
 /** Code-step file, so repair targets the same evidence. */
 file?: string;
}

/** Everything the Overview health row renders. Empty findings means healthy. */
export interface StoryHealthView {
 findings: StoryHealthFinding[];
 errors: number;
 warnings: number;
 /** Changed ranges no step explains; the row links them to Review evidence. */
 unexplainedRanges: number;
}

/** One review beat: a sentence plus the diff rows it focuses. */
export interface ReviewBeatView {
 /** Index into the step's focus groups; also the `data-focus-group` value. */
 focusGroup: number;
 text: ReviewProse;
 /** "file.ts, lines 3 to 9" — the spoken destination for the beat button. */
 destination: string;
}

/**
 * One story step, as the *initial* document needs it.
 *
 * Enough for a rail card, a filmstrip node, a challenge target and — via
 * `beats` / `why` / `conceptSpeech` — the `[data-step-speech-cache]` block
 * inside the lazy stub. That cache is the only reason narration can plan a
 * 300-step story without fetching 300 panels; it is invisible `sr-only` markup
 * and the single easiest thing in this rewrite to delete by accident.
 *
 * The step's diff, moves and focus groups are NOT here. They arrive from
 * `GET /api/review/step-panel?index=N`.
 */
export interface ReviewStepView {
 id: string;
 kind: "changed" | "new-file" | "context" | "concept";
 /** Attention weight; the server resolves the tour default to `must`. */
 weight: StoryStepWeight;
 /** Derived presentation layout. It carries no diff or diagram detail. */
 sceneLayout: StoryStepSceneLayout;
 /** 1-based position among code steps, as the step header prints it. */
 order: number;
 title: ReviewProse;
 /** Post-change path. Absent on a concept step. */
 file?: string;
 /** "Changed" / "New file" / "Context" / "Concept". */
 kindLabel: string;
 /** Authored chapter label; drives the >10-step rail compaction grouping. */
 chapter?: string;
 /** Code steps only. Empty when the step has a single review note instead. */
 beats: ReviewBeatView[];
 /** The single review note used when a code step has no beats. */
 why?: ReviewProse;
 /** Concept steps only: title + body + caption, joined and terminated. */
 conceptSpeech?: string;
 /** Broad-step warning shown beside the rail's beat list. */
 health?: { broad: boolean; reasons: string[] };
}

/** One changed file, as the sidebar tree and the Files view stubs need it. */
export interface ReviewFileRow {
 file: string;
 add: number;
 del: number;
 /** Changed rows in this file that no story step explains. */
 untoured: number;
 kind: "changed" | "new" | "context";
 kindLabel: string;
 /** `data-filter-status` — the git status letter set the filter menu reads. */
 status: string;
 /** Changed declarations, folded into `data-filter-path` for search. */
 symbols: string[];
 /**
  * Binds a review mark to this exact file diff. `viewedFiles[path] === hash`
  * is the whole "reviewed" contract: a code change changes the hash and the
  * mark drops, which is why this is not a boolean.
  */
 reviewHash: string;
 /** Whether a full working-tree copy exists, so Full file can be offered. */
 hasFull: boolean;
 /** Whether the file has hunks at all; a file with none gets no mode toggle. */
 hasHunks: boolean;
 /** Generator command when `storyScope.regenerated` explains this file. */
 regeneratedBy?: string;
}

/** An author-flagged place to distrust first, listed on the Overview. */
export interface ReviewHotspotView {
 /** Navigation index (Overview is 0), so `data-goto-step` can use it directly. */
 panelIndex: number;
 order: number;
 title: ReviewProse;
 reason: ReviewProse;
}

/** The story's own words. Empty strings on a storyless page. */
export interface ReviewStoryView {
 title: ReviewProse;
 summary?: ReviewProse;
 /** Recovered intent. When present the goal leads and the summary is the map. */
  intent?: {
  goal: ReviewProse;
  design?: ReviewProse;
  /** Deliberate omissions, so a reviewer does not flag them as misses. */
    nonGoals: ReviewProse[];
  };
  /** What the author ran to check the change. */
  verification?: Array<{
    check: string;
    result: 'passed' | 'failed' | 'not-run';
    detail?: ReviewProse;
  }>;
  arc?: {
    changeType: string;
    changeTypeLabel: string;
    shape: string;
    shapeLabel: string;
    readingPath: string;
  };
  evolution?: {
    commitCount: number;
    phases: Array<{
      title: string;
      summary: ReviewProse;
      firstCommit: string;
      lastCommit: string;
      commitCount: number;
      relatedPanelIndex?: number;
    }>;
  };
}

/**
 * The coverage verdict as of first paint.
 *
 * `pending` is true on every real route, because resolving coverage costs a
 * whole-diff read the metadata-first render deliberately has not done. The page
 * must say "Checking coverage…" until `/api/review/coverage` answers and must
 * never read an unchecked change as clean — see `applyCoverageVerdict()`.
 */
export interface ReviewTrustView {
 pending: boolean;
 coveredLines: number;
 uncoveredLines: number;
 /** Number of uncovered ranges. Meaningless while `pending`. */
 uncoveredCount: number;
}

/** One file that changed after the story's baseline was captured. */
export interface StoryDriftViewFile {
 path: string;
 oldPath?: string;
 status:
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "mode-changed"
  | "unknown";
 scope: "story" | "outside";
 additions?: number;
 deletions?: number;
 detail: "exact" | "summary-only";
 reason?: string;
}

/** The "Since story" report behind the Overview's freshness control. */
export interface StoryDriftView {
 state: "current" | "outside-only" | "story-changed" | "mixed" | "unverified";
 observationId?: string;
 baselineId?: string;
 inScopeFiles: number;
 outsideScopeFiles: number;
 files: StoryDriftViewFile[];
}

/**
 * Where a queued comment's code went since it was written.
 *
 * Computed server-side by re-reading the working tree and searching for the
 * comment's `selectedText`, so it cannot be derived in the browser. The client
 * *preserves* these across its own card rebuilds rather than recomputing them.
 */
export interface CommentAnchorView {
 id: string;
 state: "current" | "moved" | "changed" | "old-side" | "legacy";
 /** Human label for the badge; server-owned because it depends on the state semantics. */
 label: string;
 /** Current line for moved anchors; omitted when the original line is still correct. */
 currentLine?: number;
}

/** Facts the chrome must have right on first paint, all derived server-side. */
export interface ReviewChromeFacts {
 openCount: number;
 blockingOpenCount: number;
 /** The story deliberately excluded some files from its scope. */
 focusedStory: boolean;
 feedbackHealthy: boolean;
 /** How to repair the comment store. Empty when healthy. */
 feedbackRecovery: string;
 /** Nothing on the Review page wants a decision — hides the ▲ flag. */
 reviewClean: boolean;
 showTrustPill: boolean;
 trustPillClean: boolean;
 /** "12 code steps + 2 primers" — the rail's reading-order label. */
 readingOrder: string;
}

/**
 * `GET /repo/<name>/explain` — ask for a code story.
 *
 * Everything the form needs before the reader types: which commit the story
 * would explain by default, whether uncommitted edits exist (they are not part
 * of the story), the standing depth and audience, and — for `?story=<id>` — the
 * existing code story's request, so a rewrite starts from the same question.
 */
export interface ExplainPayload {
  repoName: string;
  /** `/repo/<encoded name>`. */
  routeBase: string;
  /** Current branch, or null on a detached HEAD. */
  branch: string | null;
  /** Full id of HEAD, or null in a repository with no commits yet. */
  headCommit: string | null;
  /** "1a2b3c4 Subject line" for HEAD; empty with no commits. */
  headSubject: string;
  /** Tracked files differ from HEAD; a code story explains the commit, not them. */
  dirty: boolean;
  defaults: { mode: StoryMode; audience: StoryAudience };
  /** A rewrite of an existing code story. */
  prefill?: {
    storyId: string;
    /** Plain text. */
    title: string;
    question?: string;
    paths: string[];
    ref?: string;
    mode?: StoryMode;
  };
  /** Set when `?story=` named something that is not a readable code story. */
  notice?: string;
}

/**
 * A code story's pinned commit and freshness, as the Overview shows them.
 * The drift shape restates `CodeStoryDrift` from `code-story.ts`, which this
 * import-free module cannot reach (it imports node built-ins).
 */
export interface ReviewCodeView {
 /** Full id of the commit the story explains. */
 commit: string;
 shortCommit: string;
 /** The name the reader picked ("main"), when there was one. */
 ref?: string;
 /** "main @ 1a2b3c4", or the short id alone. */
 label: string;
 /** The story's id ("stories/code-x.json"), for the rewrite link. */
 storyId?: string;
 /** What the reader asked, as typed. */
 question?: string;
 paths: string[];
 /** Whether the files the story visits still match the commit in the working tree. */
 drift: { state: "current" | "changed" | "missing-commit" | "unverified"; files: string[] };
}

/** `GET /repo/<name>/review` and `GET /repo/<name>/diff`. */
export interface ReviewPayload {
 /** Absolute repo path. Diagnostic only; editor links are resolved server-side. */
 repo: string;
 repoName: string;
 routeBase: string;
 /** No story: Files opens by default and the Story tab offers the generator. */
 storyless: boolean;
 /** What the story explains. A `code` story has no diff: it reads code at one commit. */
 subject: "diff" | "code";
 /** Code stories only. */
 code?: ReviewCodeView;
 /** `describeBase()` — what the subtitle compares the working tree against. */
 baseLabel: string;
 /** Standing audience preference; the storyless generator offers to change it. */
 audience: StoryAudience;
 /** Contract errors and lint findings behind the Overview health row. */
 health: StoryHealthView;
 /** Ref for the post-change side. Absent means the live working tree. */
 headRef?: string;
 /** The story's own base ref, used by the storyless generator's scope. */
 baseRef?: string;

 /** Every lazy request on this page must carry `?page=<pageToken>`. */
 pageToken: string;
 /**
  * Identity of the story on screen. Half of the reading-position key:
  * several stories — and every regeneration of one — share a single
  * `base..head` scope, so the scope key alone cannot say whose saved position
  * a page may resume. Dropping it replays one story's position into another.
  */
 storyKey: string;
 /** `reviewState.scopeKey` — the other half, and the challenge/ack key root. */
 reviewScope: string;
 /** `${repo}|${scopeKey || baseLabel}|full` — scopes the reviewed-file marks. */
 viewedScope: string;
 /** Binds the challenge checklist and the exclusions acknowledgement to a diff. */
 currentDiffHash: string;

 story: ReviewStoryView;
 steps: ReviewStepView[];
 files: ReviewFileRow[];
 hotspots: ReviewHotspotView[];
 challengeTargets: Array<{ stepId: string; panelIndex: number; reasons: string[] }>;
 trust: ReviewTrustView;

 totalSteps: number;
 codeSteps: number;
 conceptSteps: number;
 filesChanged: number;
 contextFiles: number;
 totalAdd: number;
 totalDel: number;
 /** Hunk-bearing changed files inside the story's selected scope. */
 storyFilesChanged: number;
 /** The story's declared file scope, when it narrowed one. */
 storyIncludedFiles: string[];

 storyFreshness: "current" | "stale" | "unverified";
 storyDrift?: StoryDriftView;

 /**
  * Present when the story on screen is a frozen history snapshot: when it
  * was taken, and the live story id to return to. Mutations are refused.
  */
 history?: { takenAt: string; liveId: string };

 /** Already story-scoped by the lease. The chrome counts open comments separately. */
 comments: Comment[];
 commentAnchors: CommentAnchorView[];

 /** Files in the exact scope that the bounded renderer keeps out of the DOM. */
 excludedFiles: ReviewExclusionMetadata[];
 /** Paths whose index and working-tree bytes are different review states. */
 stagedWorktreeDivergentFiles: string[];

 chrome: ReviewChromeFacts;
}

/** Re-exported so the client can name what the payload carries. */
export type { Comment, ReviewFileIndexEntry, ReviewExclusionMetadata };
