// Turn the validated tour + parsed diff + coverage into the view structures the
// review page renders: the ordered story steps (side-by-side rows), the All-files
// overview (unified rows), the trust check, and the reconstructed full-file view.
//
// Diff data stays pure: code strings pass through verbatim and are escaped at the
// render boundary. Authored prose does not. Every narrative field is parsed here,
// exactly once (narrative.ts), and carried as a Narrative — `.html` for template
// interpolation, `.text` for attributes, labels, and truncation, `.speech` for
// Aloud. The renderer places those projections; it never escapes, truncates,
// re-parses, or markdown-renders story prose itself, which is what removes the
// sanitize-then-reparse gap mXSS lives in.
//
// The renderer (render.ts) and the /api/fullfile endpoint (server.ts) both consume
// these, so the diff-shaping logic lives in exactly one place.
import { changedRanges, rangesOverlap } from './diff.js';
import { readFileRange, readWholeFile, resolveCommit } from './git.js';
import { isCodeStory, orderedSteps } from './tour.js';
import { landingSearchName, callerEvidence, type CallerEvidence } from './landing-verify.js';
import { claimedRanges } from './types.js';
import { computeCoverage, filesForStoryCoverage, regeneratedCommandFor } from './coverage.js';
import { matchGlob } from './noise.js';
export { filesForStoryCoverage } from './coverage.js';
import { isCodeStep, isPageConcept } from './types.js';
import { narrative, narrativeText, type Narrative } from './narrative.js';
import { runSides, type IntraSides } from './intra-line.js';
import { projectStoryStepScene } from './story-scenes.js';
import { cachedEvolutionVerification } from './evolution.js';
import { createHash } from 'node:crypto';
import type {
  CodeStepKind,
  CodeTourStep,
  ConceptTourStep,
  DiffFile,
  DiffHunk,
  DiffLine,
  FileStatus,
  ReviewFileIndexEntry,
  LogicMove,
  LogicMoveKind,
  Tour,
  TourStep,
  StepKind,
  StoryStepSceneLayout,
  StoryStepWeight,
} from './types.js';

export type RowType = 'add' | 'del' | 'ctx';

/** One row of a side-by-side diff (story tour + full file). */
export interface SbsRow {
  type: RowType;
  oldNo?: number;
  newNo?: number;
  content: string;
  /** Paired views carry independent old/new file content in one aligned row. */
  leftContent?: string;
  rightContent?: string;
  paired?: boolean;
  /** A del/add pair merged onto one row (All-files split + full file). */
  changePair?: boolean;
  /** Commentable when it has a post-change line number. */
  comment?: boolean;
  /** Flagged by the trust check (changed but no step explains it). */
  untoured?: boolean;
  /** This deleted/added line reappears unchanged elsewhere in the file. */
  moved?: MovedMark;
}

/** One row of a compact unified diff (All-files cards). */
export interface UnifiedRow {
  type: RowType;
  no?: number;
  content: string;
  untoured?: boolean;
  moved?: MovedMark;
}

/** Where the other end of a moved line lives: the pane side and its line. */
export interface MovedMark {
  side: 'left' | 'right';
  line: number;
}

interface MovableRow {
  type: RowType;
  content: string;
  moved?: MovedMark;
}

/** Word characters a line needs before its reappearance counts as a move. A
 *  `}` or `return;` recurs everywhere and moves nowhere. */
const MOVE_MIN_WORD_CHARS = 10;

/**
 * Mark deleted lines that were re-added elsewhere in the same file, and the
 * added lines they became, so a relocated statement reads as one move instead
 * of an unrelated deletion and addition.
 *
 * Text is compared with whitespace collapsed (a move into a deeper block
 * re-indents it), and a match must be unambiguous: the line occurs exactly
 * once among the file's deletions and once among its additions. A deletion
 * and addition that the split view would pair in place — same change run,
 * same position — are an edit (typically a re-indent), not a move.
 *
 * `blocks` are the file's hunks in order; `line` gives a row's own number
 * (old for a deletion, new for an addition). Rows are marked in place.
 */
export function markMovedLines<T extends MovableRow>(blocks: T[][], line: (row: T) => number | undefined): void {
  type Slot = { row: T; run: number; k: number; line: number };
  const dels = new Map<string, Slot[]>();
  const adds = new Map<string, Slot[]>();
  let run = 0;
  for (const block of blocks) {
    let kDel = 0;
    let kAdd = 0;
    let inRun = false;
    for (const row of block) {
      if (row.type === 'ctx') {
        if (inRun) run++;
        inRun = false;
        kDel = kAdd = 0;
        continue;
      }
      inRun = true;
      const k = row.type === 'del' ? kDel++ : kAdd++;
      const n = line(row);
      if (n === undefined) continue;
      const key = row.content.trim().replace(/\s+/g, ' ');
      if ((key.match(/\w/g)?.length ?? 0) < MOVE_MIN_WORD_CHARS) continue;
      const map = row.type === 'del' ? dels : adds;
      const slot = { row, run, k, line: n };
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    }
    if (inRun) run++;
  }
  for (const [key, from] of dels) {
    const to = adds.get(key);
    if (from.length !== 1 || to?.length !== 1) continue;
    const [d, a] = [from[0], to[0]];
    if (d.run === a.run && d.k === a.k) continue;
    d.row.moved = { side: 'right', line: a.line };
    a.row.moved = { side: 'left', line: d.line };
  }
}

export type FileKind = 'changed' | 'new' | 'context';

const STEP_KIND_LABEL: Record<StepKind, string> = {
  changed: 'Changed',
  context: 'Context',
  'new-file': 'New file',
  concept: 'Concept',
};
const FILE_KIND_LABEL: Record<FileKind, string> = {
  changed: 'Changed',
  new: 'New file',
  context: 'Context',
};
/** The label a code story's unchanged-code stops and files carry. */
const CODE_KIND_LABEL = 'Code';

export interface StepViewBase {
  id: string;
  order: number;
  /** Attention weight; the tour default (`must`) is resolved at build time. */
  weight: StoryStepWeight;
  /** Projected once: `.html` for headings, `.text` for aria labels and titles. */
  title: Narrative;
  kind: StepKind;
  kindLabel: string;
  /** Derived presentation vocabulary; never authored in story.json. */
  sceneLayout: StoryStepSceneLayout;
  /** Authored review cues carried through from story.json, markup stripped. */
  tags: string[];
  /** Grouping key for long reading paths, so text only — never markup. */
  chapter?: string;
}

export interface StepHealthView {
  broad: boolean;
  reasons: string[];
  viewportLines: number;
  beatCount: number;
}

export interface LogicMoveEndpointView {
  file: string;
  range: [number, number];
  /** This panel contains rows for the endpoint. */
  local: boolean;
  /** 1-based story panel index for a remote endpoint when one is authored. */
  targetStep?: number;
}

export interface LogicMoveView {
  id: string;
  kind: LogicMoveKind;
  label?: string;
  hidden?: { as: 'path' | 'destination' | 'consequence'; tag: string; what: Narrative };
  before: LogicMoveEndpointView;
  after: LogicMoveEndpointView;
}

export interface CodeStepView extends StepViewBase {
  kind: CodeStepKind;
  file: string;
  oldFile: string;
  /** Storyteller-selected visible window. */
  viewport: [number, number];
  range: [number, number];
  /** Narrower post-change line ranges that glow while this step is read aloud. */
  focusRanges: Array<[number, number]>;
  /** Focus ranges grouped by spoken unit. */
  focusGroups: Array<Array<[number, number]>>;
  /** Old-side focus ranges grouped by spoken unit; beat i reads index i. */
  focusOldGroups: Array<Array<[number, number]>>;
  /** Whether focusRanges came from story JSON instead of the step range fallback. */
  focusExplicit: boolean;
  newFile: boolean;
  context: boolean;
  /** Code stories only: the commit this step's code is read at. */
  pinnedCommit?: string;
  why: Narrative;
  /** Verified "where am I" facts, drawn under the step title as a one-hop call graph. */
  landing?: {
    symbol: string;
    /** Basename of the step's file. */
    file: string;
    /** Authored callers; one that is another step's landing symbol links to it. */
    callers: LandingNodeView[];
    role?: { who: string; gate?: string };
    when?: string;
    /** The steps this one leads into (`calls`), by landing symbol or title. */
    callees: LandingNodeView[];
  };
  /** Author-declared distrust reason when this step is a story hotspot. */
  hotspot?: Narrative;
  /** Cross-file sweep claim: the glob and how many changed files it matches. */
  sweep?: { glob: string; files: number };
  health: StepHealthView;
  beats: StepBeatView[];
  /** Diff rows grouped by hunk (rendered with a ⋯ separator between blocks). */
  blocks: SbsRow[][];
  note?: string;
  moves: LogicMoveView[];
  pairedView?: string;
}

/** One node of a landing's call graph; `panelIndex` is set when it is a story step. */
export interface LandingNodeView {
  label: string;
  /** Plain prose (a step title) rather than a symbol. */
  prose?: boolean;
  panelIndex?: number;
  evidence?: CallerEvidence | null;
}

/** A primer's diagram: the caption is prose, the source is Mermaid the client parses. */
export interface ConceptDiagramView {
  type: 'mermaid';
  source: string;
  caption: Narrative;
}

export interface ConceptStepView extends StepViewBase {
  kind: 'concept';
  /** The only block-tier narrative in the model: headings, lists, tables, code. Legacy only. */
  body?: Narrative;
  diagram?: ConceptDiagramView;
  /** True for a v4 page concept; the page itself never enters the view model. */
  hasPage: boolean;
  /** True when the page opted into network access; offline pages omit the badge. */
  network: boolean;
  /** Plain-text narration for a page concept, spoken by Aloud. Page concepts only. */
  narration?: Narrative;
  preparesFor: Array<{ id: string; order: number; title: Narrative }>;
}

export type StepView = CodeStepView | ConceptStepView;

export interface StepBeatView {
  text: Narrative;
  focusGroup: number;
  highlights: Array<[number, number]>;
  oldHighlights: Array<[number, number]>;
}

export interface FileView {
  file: string;
  oldFile: string;
  status: FileStatus;
  kind: FileKind;
  kindLabel: string;
  add: number;
  del: number;
  /** Number of changed hunks in this file no step explains. */
  untoured: number;
  /** Generator command when `storyScope.regenerated` explains this file. */
  regeneratedBy?: string;
  stepId?: string;
  stepOrder?: number;
  hunks: UnifiedRow[][];
  /** [newStart, newEnd] per hunk, aligned with .hunks — lets the panel compute
   *  the gaps between hunks (and after the last one) for expand-context. */
  hunkRanges: Array<[number, number]>;
  /** Whether a complete-file view can be loaded (file exists in the working tree). */
  hasFull: boolean;
  /** Best-effort changed declarations, used only for navigation/search. */
  symbols: string[];
  /** Stable identity of the code diff, independent of story coverage state. */
  reviewHash: string;
}

export interface UncoveredView {
  file: string;
  line: number;
  rows: UnifiedRow[];
  stepId?: string;
  stepOrder?: number;
}

export interface TrustView {
  coveredLines: number;
  uncoveredLines: number;
  uncovered: UncoveredView[];
  /** Initial metadata-only pages have not loaded enough hunk evidence yet. */
  pending?: boolean;
}

/** One author-declared distrust spot, resolved against the ordered reading path. */
export interface HotspotView {
  stepId: string;
  /** 1-based panel index of the flagged step (panel 0 is the overview). */
  panelIndex: number;
  order: number;
  title: Narrative;
  reason: Narrative;
}

/** The recovered "why", projected for the Overview panel. */
export interface StoryIntentView {
  goal: Narrative;
  design?: Narrative;
  /** Evidence labels ("commit 41af8b7", "PR #12 body") — identifiers, not prose. */
  sources: string[];
  nonGoals: Narrative[];
}

/**
 * Tour-level narrative, projected once. Its existence is the reason render.ts
 * never touches Tour.title / Tour.summary / Tour.intent directly.
 */
export interface StoryView {
  title: Narrative;
  /** Absent when the story shipped an empty summary. */
  summary?: Narrative;
  /** Absent when no intent was recovered, or its goal was blank. */
  intent?: StoryIntentView;
  /** What the author ran; absent when the story has no verification list. */
  verification?: Array<{ check: string; result: 'passed' | 'failed' | 'not-run'; detail?: Narrative }>;
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
      summary: Narrative;
      firstCommit: string;
      lastCommit: string;
      commitCount: number;
      relatedPanelIndex?: number;
    }>;
  };
}

export interface ReviewModel {
  /** Title, summary, and recovered intent — already projected for the renderer. */
  story: StoryView;
  steps: StepView[];
  files: FileView[];
  hotspots: HotspotView[];
  trust: TrustView;
  totalSteps: number;
  codeSteps: number;
  conceptSteps: number;
  filesChanged: number;
  contextFiles: number;
  totalAdd: number;
  totalDel: number;
  /** Hunk-bearing changed files inside the story's selected scope. */
  storyFilesChanged: number;
}

export interface BuildReviewModelOptions {
  storyless?: boolean;
  /**
   * Detail is opt-out for non-page callers. The review page passes an explicit
   * set so off-screen story steps do not read and shape their source files.
   */
  detailedStepIndexes?: ReadonlySet<number>;
  /**
   * File summaries remain available to navigation while hunk rows are built
   * only for the requested detail panel.
   */
  detailedFilePaths?: ReadonlySet<string>;
  /** Lazy detail endpoints do not need the trust drawer's code excerpts. */
  includeTrustRows?: boolean;
  /** Bounded changed-file summaries used before individual diffs are loaded. */
  fileIndex?: readonly ReviewFileIndexEntry[];
  /** Never present unloaded coverage evidence as a clean result. */
  trustPending?: boolean;
  /** Base-side ref used to materialize paired old-file anchors. */
  baseRef?: string;
  /** Exact story-content identity used by the bounded evolution-verification cache. */
  storyIdentity?: string;
}

export function buildReviewModel(
  repo: string,
  tour: Tour,
  files: DiffFile[],
  headRef?: string,
  opts?: BuildReviewModelOptions,
): ReviewModel {
  const steps = orderedSteps(tour);
  // A code story shows unchanged code as its main evidence, so its stops read
  // "Code", not "Context", at its pinned commit. Derived here so every lazy
  // endpoint agrees.
  const pinnedCommit = isCodeStory(tour) ? (tour.head ?? '') : undefined;
  const codeStory = pinnedCommit !== undefined;
  // A story written in another clone pins a commit this one may not have; its
  // files exist, so "file not found" would blame the wrong thing.
  const unreadableNote =
    codeStory && pinnedCommit && resolveCommit(repo, pinnedCommit) === null
      ? `not readable at ${pinnedCommit.slice(0, 7)}: that commit is not in this repository`
      : undefined;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const codeSteps = steps.filter(isCodeStep);
  const coverageFiles = filesForStoryCoverage(tour, files);
  // Story-less (diff-only) view: there's no story to measure the diff against,
  // so nothing is "unexplained" — skip coverage instead of flagging every line.
  const uncovered = opts?.storyless ? [] : computeCoverage(tour, coverageFiles).uncovered;

  // Uncovered ranges grouped by file, for line-level "untoured" flagging.
  const uncoveredByFile = new Map<string, Array<[number, number]>>();
  for (const u of uncovered) {
    const list = uncoveredByFile.get(u.file) ?? [];
    list.push(u.range);
    uncoveredByFile.set(u.file, list);
  }

  // First ordered step that shows each file → the "Step N" chip + jump target.
  const stepByFile = new Map<string, CodeTourStep>();
  for (const s of codeSteps) if (!stepByFile.has(s.file)) stepByFile.set(s.file, s);

  // First declared reason wins if a step is (incorrectly) flagged twice.
  const hotspotByStep = new Map<string, Narrative>();
  for (const spot of tour.hotspots ?? []) {
    const reason = narrative(spot.reason ?? '', 'inline');
    if (reason.text.trim() && !hotspotByStep.has(spot.step)) hotspotByStep.set(spot.step, reason);
  }

  const landingGraph = landingGraphIndex(steps);
  const stepViews = steps.map((step, index) =>
    isCodeStep(step)
      ? buildCodeStep(
          repo,
          step,
          files,
          headRef,
          hotspotByStep.get(step.id),
          steps,
          opts?.baseRef,
          opts?.detailedStepIndexes === undefined || opts.detailedStepIndexes.has(index),
          landingGraph,
          pinnedCommit,
          unreadableNote,
        )
      : buildConceptStep(step, byId),
  );
  // Built from the step views, not the raw steps: the title is already projected
  // there, and parsing it twice would be the second parse this module exists to
  // remove.
  const hotspots: HotspotView[] = stepViews.flatMap((step, index) => {
    const reason = hotspotByStep.get(step.id);
    return reason && step.kind !== 'concept'
      ? [{ stepId: step.id, panelIndex: index + 1, order: step.order, title: step.title, reason }]
      : [];
  });
  const fileViews = buildFiles(
    repo,
    codeSteps,
    files,
    stepByFile,
    uncoveredByFile,
    (path) => regeneratedCommandFor(tour, path),
    headRef,
    opts?.detailedFilePaths,
    opts?.fileIndex,
    codeStory,
  );
  const trust = buildTrust(coverageFiles, uncovered, stepByFile, opts?.includeTrustRows !== false);
  if (opts?.trustPending) trust.pending = true;
  const changedFileViews = fileViews.filter((file) => file.kind !== 'context');
  const storyPaths = new Set(
    coverageFiles.length
      ? coverageFiles.map((file) => file.newPath)
      : codeSteps.filter((step) => step.kind !== 'context').map((step) => step.file),
  );
  const storyFileViews = changedFileViews.filter((file) => storyPaths.has(file.file));

  return {
    story: storyView(repo, tour, opts?.storyIdentity),
    steps: stepViews,
    files: fileViews,
    hotspots,
    trust,
    totalSteps: steps.length,
    codeSteps: codeSteps.length,
    conceptSteps: steps.length - codeSteps.length,
    filesChanged: changedFileViews.length,
    contextFiles: fileViews.filter((f) => f.kind === 'context').length,
    totalAdd: changedFileViews.reduce((a, f) => a + f.add, 0),
    totalDel: changedFileViews.reduce((a, f) => a + f.del, 0),
    storyFilesChanged: storyFileViews.length,
  };
}

/**
 * The story's own prose, projected once. Everything here lands inside a sentence
 * or a list item on the Overview panel, so it is inline-tier; the concept body is
 * the only block-tier narrative in the model.
 */
const CHANGE_TYPE_LABELS: Record<string, string> = {
  feature: 'Feature',
  'bug-fix': 'Bug fix',
  refactor: 'Refactor',
  security: 'Security',
  performance: 'Performance',
  migration: 'Migration',
  maintenance: 'Maintenance',
  mixed: 'Mixed change',
};

const NARRATIVE_SHAPE_LABELS: Record<string, string> = {
  'cause-effect': 'Cause and effect',
  'entry-implementation': 'Entry to implementation',
  'before-after': 'Before and after',
  'core-supporting': 'Core and supporting changes',
  'rule-instances': 'Rule and instances',
};

/** A code story explains code rather than a change, so its shapes read without "changes". */
const CODE_SHAPE_LABELS: Record<string, string> = {
  'entry-implementation': 'Entry to implementation',
  lifecycle: 'Lifecycle',
  'data-flow': 'Data flow',
  'map-then-path': 'Map, then one path',
  'core-supporting': 'Core and supporting pieces',
  'rule-instances': 'Rule and instances',
  'cause-effect': 'Cause and effect',
};

function storyView(repo: string, tour: Tour, storyIdentity?: string): StoryView {
  const summary = narrative(tour.summary ?? '', 'inline');
  const intent = tour.intent;
  const goal = narrative(intent?.goal ?? '', 'inline');
  const design = narrative(intent?.design ?? '', 'inline');
  const evolutionVerification = tour.evolution
    ? cachedEvolutionVerification(
        repo,
        storyIdentity ?? createHash('sha256').update(JSON.stringify(tour)).digest('hex'),
        tour,
      )
    : undefined;
  const ordered = orderedSteps(tour);
  const stepIndex = new Map(ordered.map((step, index) => [step.id, index + 1]));
  return {
    title: narrative(tour.title ?? '', 'inline'),
    summary: summary.text.trim() ? summary : undefined,
    // A goal that is blank once markup is stripped is no recovered intent at all,
    // and the Overview's layout hangs off whether one exists.
    intent: goal.text.trim()
      ? {
          goal,
          design: design.text.trim() ? design : undefined,
          sources: (intent?.sources ?? []).map((source) => narrativeText(source)).filter(Boolean),
          nonGoals: (intent?.nonGoals ?? [])
            .map((nonGoal) => narrative(nonGoal, 'inline'))
            .filter((nonGoal) => nonGoal.text.trim()),
        }
      : undefined,
    ...(tour.verification?.length
      ? {
          verification: tour.verification.map((entry) => ({
            check: narrativeText(entry.check),
            result: entry.result,
            ...(entry.detail ? { detail: narrative(entry.detail, 'inline') } : {}),
          })),
        }
      : {}),
    ...(tour.storyArc
      ? {
          arc: isCodeStory(tour)
            ? {
                changeType: 'code',
                changeTypeLabel: 'Code story',
                shape: tour.storyArc.shape,
                shapeLabel: CODE_SHAPE_LABELS[tour.storyArc.shape] ?? tour.storyArc.shape,
                readingPath: narrativeText(tour.storyArc.readingPath),
              }
            : {
                changeType: tour.storyArc.changeType ?? '',
                changeTypeLabel:
                  CHANGE_TYPE_LABELS[tour.storyArc.changeType ?? ''] ?? tour.storyArc.changeType ?? '',
                shape: tour.storyArc.shape,
                shapeLabel: NARRATIVE_SHAPE_LABELS[tour.storyArc.shape] ?? tour.storyArc.shape,
                readingPath: narrativeText(tour.storyArc.readingPath),
              },
        }
      : {}),
    ...(tour.evolution && evolutionVerification?.displayable
      ? {
          evolution: {
            commitCount: evolutionVerification.commitCount,
            phases: tour.evolution.phases.map((phase, index) => ({
              title: narrativeText(phase.title),
              summary: narrative(phase.summary, 'inline'),
              firstCommit: phase.firstCommit,
              lastCommit: phase.lastCommit,
              commitCount: evolutionVerification.phaseCommitCounts[index] ?? 0,
              ...(phase.relatedSteps?.find((id) => stepIndex.has(id))
                ? {
                    relatedPanelIndex: stepIndex.get(
                      phase.relatedSteps.find((id) => stepIndex.has(id)) as string,
                    ),
                  }
                : {}),
            })),
          },
        }
      : {}),
  };
}

function buildCodeStep(
  repo: string,
  step: CodeTourStep,
  files: DiffFile[],
  headRef?: string,
  hotspot?: Narrative,
  ordered?: TourStep[],
  baseRef?: string,
  detailed = true,
  landingGraph: LandingGraphIndex = landingGraphIndex(ordered ?? [step]),
  pinnedCommit?: string,
  unreadableNote?: string,
): CodeStepView {
  const codeStory = pinnedCommit !== undefined;
  const { blocks, note } = detailed ? stepBlocks(repo, step, files, headRef, baseRef, unreadableNote) : { blocks: [] };
  const diffFile = files.find((f) => f.newPath === step.file);
  const viewport = stepViewport(step);
  const highlights = stepHighlights(step);
  const beats = stepBeats(step);
  const focusGroups = stepFocusGroups(viewport, highlights, beats);
  const focusOldGroups = stepFocusOldGroups(beats);
  const focusExplicit = beats.length > 0 || highlights.length > 0;
  const moves = buildLogicMoves(step, diffFile?.oldPath ?? step.file, ordered ?? []);
  const pairedView = pairedMoveFor(step)?.id;
  return {
    id: step.id,
    order: step.order,
    weight: step.weight ?? 'must',
    title: narrative(step.title, 'inline'),
    chapter: chapterLabel(step),
    file: step.file,
    oldFile: diffFile?.oldPath ?? step.file,
    viewport,
    range: viewport,
    focusRanges: focusGroups.flat(),
    focusGroups,
    focusOldGroups,
    focusExplicit,
    kind: step.kind,
    kindLabel: codeStory && step.kind === 'context' ? CODE_KIND_LABEL : STEP_KIND_LABEL[step.kind],
    sceneLayout: projectStoryStepScene({
      kind: 'code',
      hasMoves: moves.length > 0,
      paired: pairedView !== undefined,
    }),
    tags: (step.tags ?? []).map((tag) => narrativeText(tag)),
    newFile: step.kind === 'new-file',
    context: step.kind === 'context',
    ...(codeStory && pinnedCommit ? { pinnedCommit } : {}),
    ...(step.kind !== 'context' && step.files?.length
      ? {
          sweep: {
            glob: step.files[0],
            files: files.filter((f) => step.files!.some((pattern) => matchGlob(pattern, f.newPath))).length,
          },
        }
      : {}),
    why: narrative(step.why ?? '', 'inline'),
    ...(step.landing
      ? {
          landing: {
            symbol: narrativeText(step.landing.symbol),
            file: step.file.split('/').pop() ?? step.file,
            callers: (step.landing.calledBy ?? []).map((caller) => ({
              ...landingCaller(caller, step.id, landingGraph),
              ...(detailed ? { evidence: callerEvidence(repo, step.landing!.symbol, caller, headRef) } : {}),
            })),
            ...(step.landing.role
              ? {
                  role: {
                    who: narrativeText(step.landing.role.who),
                    ...(step.landing.role.gate ? { gate: narrativeText(step.landing.role.gate) } : {}),
                  },
                }
              : {}),
            ...(step.landing.when ? { when: narrativeText(step.landing.when) } : {}),
            callees: (step.calls ?? []).flatMap((id) => landingCallee(id, landingGraph)),
          },
        }
      : {}),
    hotspot,
    health: stepHealth(step, viewport, focusGroups),
    beats,
    blocks,
    note,
    moves,
    pairedView,
  };
}

/**
 * The move whose two files become the left and right panes.
 *
 * Cross-file moves pair automatically: when a move lands on this step's file
 * from a different one, that relationship *is* the view, and the reader should
 * not have to open something to see the other side. `pairedView` remains an
 * explicit override for a step carrying more than one cross-file move.
 */
export function pairedMoveFor(step: CodeTourStep): LogicMove | undefined {
  if (!('moves' in step)) return undefined;
  const moves = step.moves ?? [];
  const explicitId = 'pairedView' in step ? step.pairedView : undefined;
  const crossFile = (move: LogicMove) => move.before.file !== move.after.file;
  if (explicitId) {
    const chosen = moves.find((move) => move.id === explicitId);
    return chosen && crossFile(chosen) ? chosen : undefined;
  }
  return moves.find((move) => crossFile(move) && move.after.file === step.file);
}

function buildLogicMoves(step: CodeTourStep, oldFile: string, ordered: TourStep[]): LogicMoveView[] {
  const authored = 'moves' in step ? step.moves ?? [] : [];
  const pairedId = pairedMoveFor(step)?.id;
  const targetStep = (file: string, range: [number, number]): number | undefined => {
    const index = ordered.findIndex((candidate) =>
      isCodeStep(candidate)
      && candidate.id !== step.id
      && candidate.file === file
      && claimedRanges(candidate).some((candidateRange) => rangesOverlap(candidateRange, range)),
    );
    return index >= 0 ? index + 1 : undefined;
  };
  return authored.map((move) => {
    const paired = pairedId === move.id;
    const beforeLocal = paired || move.before.file === step.file || move.before.file === oldFile;
    const afterLocal = paired || move.after.file === step.file;
    return {
      id: move.id,
      kind: move.kind,
      label: move.label ? narrativeText(move.label) : undefined,
      hidden: move.hidden
        ? {
            as: move.hidden.as,
            tag: narrativeText(move.hidden.tag),
            what: narrative(move.hidden.what, 'inline'),
          }
        : undefined,
      before: {
        ...move.before,
        local: beforeLocal,
        targetStep: beforeLocal ? undefined : targetStep(move.before.file, move.before.range),
      },
      after: {
        ...move.after,
        local: afterLocal,
        targetStep: afterLocal ? undefined : targetStep(move.after.file, move.after.range),
      },
    };
  });
}

/** Story steps keyed for the landing graph: by id, and by landing search name (first step wins). */
interface LandingGraphIndex {
  byId: Map<string, { step: TourStep; panelIndex: number }>;
  bySymbol: Map<string, { id: string; panelIndex: number }>;
}

function landingGraphIndex(ordered: TourStep[]): LandingGraphIndex {
  const byId = new Map<string, { step: TourStep; panelIndex: number }>();
  const bySymbol = new Map<string, { id: string; panelIndex: number }>();
  ordered.forEach((step, index) => {
    byId.set(step.id, { step, panelIndex: index + 1 });
    if (!isCodeStep(step) || !step.landing) return;
    const name = landingSearchName(step.landing.symbol);
    if (name && !bySymbol.has(name)) bySymbol.set(name, { id: step.id, panelIndex: index + 1 });
  });
  return { byId, bySymbol };
}

/**
 * A caller links only when its name is another step's landing symbol. The
 * checker verified the name, not the edge, so nothing here is inferred.
 */
function landingCaller(caller: string, selfId: string, graph: LandingGraphIndex): LandingNodeView {
  const target = graph.bySymbol.get(landingSearchName(caller));
  return {
    label: narrativeText(caller),
    ...(target && target.id !== selfId ? { panelIndex: target.panelIndex } : {}),
  };
}

function landingCallee(id: string, graph: LandingGraphIndex): LandingNodeView[] {
  const target = graph.byId.get(id);
  if (!target) return [];
  const { step, panelIndex } = target;
  return isCodeStep(step) && step.landing
    ? [{ label: narrativeText(step.landing.symbol), panelIndex }]
    : [{ label: narrativeText(step.title), prose: true, panelIndex }];
}

function buildConceptStep(step: ConceptTourStep, byId: Map<string, TourStep>): ConceptStepView {
  const hasPage = isPageConcept(step);
  return {
    id: step.id,
    order: step.order,
    weight: step.weight ?? 'must',
    title: narrative(step.title, 'inline'),
    chapter: chapterLabel(step),
    kind: 'concept',
    kindLabel: STEP_KIND_LABEL.concept,
    sceneLayout: projectStoryStepScene({ kind: 'concept', hasDiagram: step.diagram !== undefined, hasPage }),
    tags: (step.tags ?? []).map((tag) => narrativeText(tag)),
    hasPage,
    network: hasPage && step.network === true,
    // The page itself stays on disk: only the concept-page endpoint serves it.
    narration: hasPage ? narrative(step.narration, 'text') : undefined,
    body: hasPage ? undefined : narrative(step.body, 'block'),
    diagram: step.diagram
      ? {
          type: step.diagram.type,
          // The Mermaid source is not narrative: tour.ts validates it against its
          // own pattern list and the client parses it, so it stays verbatim.
          source: step.diagram.source,
          caption: narrative(step.diagram.caption, 'inline'),
        }
      : undefined,
    preparesFor: (step.preparesFor ?? [])
      .map((id) => byId.get(id))
      .filter((target): target is CodeTourStep => !!target && isCodeStep(target))
      .map((target) => ({ id: target.id, order: target.order, title: narrative(target.title, 'inline') }))
      .sort((a, b) => a.order - b.order),
  };
}

/** Chapters group the rail, so they are compared and printed as plain text. */
function chapterLabel(step: TourStep): string | undefined {
  return narrativeText(step.chapter ?? '').trim() || undefined;
}

function stepHealth(
  step: CodeTourStep,
  viewport: [number, number],
  focusGroups: Array<Array<[number, number]>>,
): StepHealthView {
  const viewportLines = viewport[0] === 0 ? 0 : viewport[1] - viewport[0] + 1;
  const beatCount = step.beats?.length ?? focusGroups.length;
  const reasons: string[] = [];
  if (viewportLines > 30) reasons.push(`${viewportLines} lines in one step`);
  if (beatCount > 3) reasons.push(`${beatCount} separate review beats`);
  const hasDistantFocus = focusGroups.some((group) => {
    const sorted = [...group].sort((a, b) => a[0] - b[0]);
    return sorted.some((range, index) => index > 0 && range[0] - sorted[index - 1][1] > 10);
  });
  if (hasDistantFocus) reasons.push('focus jumps across distant code');
  const widestSpan = focusGroups.reduce((widest, group) => {
    if (!group.length || group[0][0] === 0) return widest;
    const starts = group.map((range) => range[0]);
    const ends = group.map((range) => range[1]);
    return Math.max(widest, Math.max(...ends) - Math.min(...starts) + 1);
  }, 0);
  if (widestSpan > 20) reasons.push(`${widestSpan}-line focus span`);
  return { broad: reasons.length > 0, reasons, viewportLines, beatCount };
}

function stepViewport(step: CodeTourStep): [number, number] {
  return step.viewport ?? step.range;
}

function stepHighlights(step: CodeTourStep): Array<[number, number]> {
  return step.highlights ?? step.focus?.ranges ?? [];
}

function stepBeats(step: CodeTourStep): StepBeatView[] {
  return (step.beats ?? []).map((beat, i) => ({
    text: narrative(beat.text, 'inline'),
    focusGroup: i,
    highlights: beat.highlights ?? [],
    oldHighlights: beat.oldHighlights ?? [],
  }));
}

function stepFocusGroups(
  viewport: [number, number],
  highlights: Array<[number, number]>,
  beats: StepBeatView[],
): Array<Array<[number, number]>> {
  if (beats.length) return beats.map((beat) => beat.highlights);
  if (highlights.length) return highlights.map((range) => [range]);
  return [[viewport]];
}

/** Old-side focus ranges, parallel to stepFocusGroups: beat i reads index i. */
function stepFocusOldGroups(beats: StepBeatView[]): Array<Array<[number, number]>> {
  return beats.map((beat) => beat.oldHighlights);
}

function stepBlocks(
  repo: string,
  step: CodeTourStep,
  files: DiffFile[],
  headRef?: string,
  baseRef?: string,
  unreadableNote?: string,
): { blocks: SbsRow[][]; note?: string } {
  const viewport = stepViewport(step);
  const [start, end] = viewport;
  const file = files.find((f) => f.newPath === step.file);

  const paired = pairedMoveFor(step);
  if (paired && paired.before.file !== paired.after.file) {
    const oldSlice = readFileRange(repo, paired.before.file, Math.max(1, paired.before.range[0] - 6), paired.before.range[1] + 6, baseRef);
    const newSlice = readFileRange(repo, paired.after.file, Math.max(1, paired.after.range[0] - 6), paired.after.range[1] + 6, headRef);
    if (oldSlice && newSlice) {
      return { blocks: buildPairedBlocks(oldSlice, newSlice, paired.before.range, paired.after.range) };
    }
    return { blocks: [], note: 'paired move source could not be read at the requested revision' };
  }

  if (step.kind === 'changed') {
    if (file && file.hunks.length) {
      const whole = readWholeFile(repo, step.file, headRef);
      if (whole) {
        const rows = rowsInViewport(buildFullFileRows(file, whole, []), viewport);
        if (rows.length) return { blocks: [rows] };
      }
      const overlap = file.hunks.filter((h) => rangesOverlap(hunkNewRange(h), [start, end]));
      const use = overlap.length ? overlap : file.hunks;
      return {
        blocks: use.map((h) => h.lines.map(toSbs)),
        note: overlap.length ? undefined : 'tour range did not match a hunk — showing all changes in this file',
      };
    }
    const r = readFileRange(repo, step.file, start, end, headRef);
    if (!r) return { blocks: [], note: `file not found: ${step.file}` };
    return {
      blocks: [r.lines.map((c, i) => ctxRow(c, r.startLine + i))],
      note: 'no diff for this range — showing the current file',
    };
  }

  // context | new-file: read straight from the working tree.
  const r = readFileRange(repo, step.file, start, end, headRef);
  if (!r) return { blocks: [], note: unreadableNote ?? `file not found: ${step.file}` };
  if (step.kind === 'new-file') {
    return { blocks: [r.lines.map((c, i) => ({ type: 'add' as const, newNo: r.startLine + i, content: c, comment: true }))] };
  }
  return { blocks: [r.lines.map((c, i) => ctxRow(c, r.startLine + i))] };
}

export interface PairedFileSlice { lines: string[]; startLine: number }

/** Align two independent file slices once at their semantic-anchor top lines. */
export function buildPairedBlocks(
  oldSlice: PairedFileSlice,
  newSlice: PairedFileSlice,
  beforeRange: [number, number],
  afterRange: [number, number],
): SbsRow[][] {
  const oldLead = Math.max(0, beforeRange[0] - oldSlice.startLine);
  const newLead = Math.max(0, afterRange[0] - newSlice.startLine);
  const lead = Math.max(oldLead, newLead);
  const oldPad = lead - oldLead;
  const newPad = lead - newLead;
  const length = Math.max(oldPad + oldSlice.lines.length, newPad + newSlice.lines.length);
  const rows: SbsRow[] = [];
  for (let index = 0; index < length; index += 1) {
    const oldIndex = index - oldPad;
    const newIndex = index - newPad;
    const leftContent = oldIndex >= 0 && oldIndex < oldSlice.lines.length ? oldSlice.lines[oldIndex] : undefined;
    const rightContent = newIndex >= 0 && newIndex < newSlice.lines.length ? newSlice.lines[newIndex] : undefined;
    rows.push({
      type: 'ctx',
      content: rightContent ?? leftContent ?? '',
      leftContent,
      rightContent,
      oldNo: leftContent === undefined ? undefined : oldSlice.startLine + oldIndex,
      newNo: rightContent === undefined ? undefined : newSlice.startLine + newIndex,
      comment: true,
      paired: true,
    });
  }
  return [rows];
}

function rowsInViewport(rows: SbsRow[], [start, end]: [number, number]): SbsRow[] {
  return rows.filter((row, index) => rowInViewport(row, rows, index, start, end));
}

/**
 * Select every diff row anchored to a range of post-change line numbers.
 *
 * Unlike a plain `newNo` filter, this keeps deleted rows: a deletion is
 * anchored to the next surviving/added line, or one line after the previous
 * post-change line at EOF. Expanders use post-change ranges, so this produces
 * a complete slice without leaking a neighboring hunk into a context-only
 * gap.
 */
export function rowsInNewRange(
  rows: SbsRow[],
  [start, end]: [number, number],
): SbsRow[] {
  return rows.filter((row, index) => {
    if (row.newNo !== undefined)
      return row.newNo >= start && row.newNo <= end;
    if (row.type !== 'del') return false;
    const next = nearestNewLine(rows, index, 1);
    const previous = nearestNewLine(rows, index, -1);
    const anchor = next ?? (previous === undefined ? undefined : previous + 1);
    return anchor !== undefined && anchor >= start && anchor <= end;
  });
}

function rowInViewport(row: SbsRow, rows: SbsRow[], index: number, start: number, end: number): boolean {
  if (row.newNo !== undefined) return row.newNo >= start && row.newNo <= end;
  if (row.type !== 'del') return false;
  const prev = nearestNewLine(rows, index, -1);
  const next = nearestNewLine(rows, index, 1);
  return (
    (prev !== undefined && prev >= start - 1 && prev <= end) ||
    (next !== undefined && next >= start && next <= end + 1)
  );
}

function nearestNewLine(rows: SbsRow[], from: number, dir: -1 | 1): number | undefined {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
    if (rows[i].newNo !== undefined) return rows[i].newNo;
  }
  return undefined;
}

function buildFiles(
  repo: string,
  steps: CodeTourStep[],
  files: DiffFile[],
  stepByFile: Map<string, CodeTourStep>,
  uncoveredByFile: Map<string, Array<[number, number]>>,
  regenerated: (path: string) => string | null,
  headRef?: string,
  detailedFilePaths?: ReadonlySet<string>,
  fileIndex?: readonly ReviewFileIndexEntry[],
  codeStory = false,
): FileView[] {
  const views: FileView[] = [];
  const seen = new Set<string>();

  const summaries = fileIndex ?? files.map((file): ReviewFileIndexEntry => ({
    oldPath: file.oldPath,
    path: file.newPath,
    status: file.status,
    added: countLines(file, 'add'),
    removed: countLines(file, 'del'),
    byteSize: null,
    binary: false,
    large: false,
    generated: false,
    metadataOnly: !file.hunks.length,
    reviewHash: diffFileReviewHash(file),
  }));
  const diffByPath = new Map(files.map((file) => [file.newPath, file]));

  for (const summary of summaries) {
    const file = diffByPath.get(summary.path);
    seen.add(summary.path);
    const uncovered = uncoveredByFile.get(summary.path) ?? [];
    const hunks =
      file && (detailedFilePaths === undefined || detailedFilePaths.has(summary.path))
        ? movedUnified(file.hunks.map((h) => h.lines.map((l) => toUnified(l, uncovered))))
        : [];
    const step = stepByFile.get(summary.path);
    const regeneratedBy = regenerated(summary.path) ?? undefined;
    views.push({
      file: summary.path,
      oldFile: summary.oldPath,
      status: summary.status,
      kind: summary.status === 'added' ? 'new' : 'changed',
      kindLabel: summary.status === 'added' ? FILE_KIND_LABEL.new : FILE_KIND_LABEL.changed,
      add: summary.added ?? 0,
      del: summary.removed ?? 0,
      untoured: uncovered.length,
      ...(regeneratedBy ? { regeneratedBy } : {}),
      stepId: step?.id,
      stepOrder: step?.order,
      hunks,
      hunkRanges: file?.hunks.map(hunkNewRange) ?? [],
      hasFull: summary.status !== 'deleted',
      symbols: file ? changedSymbols(file) : [],
      reviewHash: summary.reviewHash,
    });
  }

  // Context-only files (referenced by a context step, absent from the diff).
  for (const step of steps) {
    if (step.kind !== 'context' || seen.has(step.file)) continue;
    seen.add(step.file);
    const detailed = detailedFilePaths === undefined || detailedFilePaths.has(step.file);
    const r = detailed
      ? readFileRange(repo, step.file, step.range[0], step.range[1], headRef)
      : null;
    const rows = r ? r.lines.map((c, i) => ({ type: 'ctx' as const, no: r.startLine + i, content: c })) : [];
    views.push({
      file: step.file,
      oldFile: step.file,
      status: 'modified',
      kind: 'context',
      kindLabel: codeStory ? CODE_KIND_LABEL : FILE_KIND_LABEL.context,
      add: 0,
      del: 0,
      untoured: 0,
      stepId: step.id,
      stepOrder: step.order,
      hunks: rows.length ? [rows] : [],
      hunkRanges: r ? [[r.startLine, r.startLine + rows.length - 1]] : [],
      hasFull: detailed ? r !== null : true,
      symbols: [],
      reviewHash: contextFileReviewHash(step.file, rows),
    });
  }

  return views.sort(byStepOrderThenPath);
}

function diffFileReviewHash(file: DiffFile): string {
  const stableHunks = file.hunks.map((hunk) =>
    hunk.lines.map((line) => ({
      type: line.type,
      no: line.type === 'del' ? line.oldNo : line.newNo,
      content: line.content,
    })),
  );
  return createHash('sha256')
    .update(JSON.stringify([
      file.status,
      file.oldPath,
      file.newPath,
      file.hunks.map(hunkNewRange),
      stableHunks,
    ]))
    .digest('hex')
    .slice(0, 64);
}

function contextFileReviewHash(file: string, rows: UnifiedRow[]): string {
  return createHash('sha256')
    .update(JSON.stringify(['modified', file, file, rows.length ? [[rows[0].no, rows[rows.length - 1].no]] : [], [rows]]))
    .digest('hex')
    .slice(0, 64);
}

/** Conservative declaration extraction for findability, never correctness claims. */
function changedSymbols(file: DiffFile): string[] {
  const found = new Set<string>();
  const declaration = /\b(?:async\s+)?(?:function|class|interface|type|enum|struct|contract|library|event|modifier|def|fn)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=|:)/;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'ctx') continue;
      const match = line.content.match(declaration);
      const symbol = match?.[1] ?? match?.[2];
      if (symbol) found.add(symbol);
      if (found.size >= 12) return [...found];
    }
  }
  return [...found];
}

function buildTrust(
  files: DiffFile[],
  uncovered: ReturnType<typeof computeCoverage>['uncovered'],
  stepByFile: Map<string, CodeTourStep>,
  includeRows: boolean,
): TrustView {
  const byPath = new Map(files.map((f) => [f.newPath, f]));
  let totalAdd = 0;
  for (const f of files) totalAdd += countLines(f, 'add');

  let uncoveredAdds = 0;
  const views: UncoveredView[] = uncovered.map((u) => {
    const file = byPath.get(u.file);
    const rows = includeRows && file
      ? file.hunks
          .filter((h) => rangesOverlap(hunkNewRange(h), u.range))
          .flatMap((h) => h.lines)
          .filter((l) => l.newNo !== undefined && l.newNo >= u.range[0] && l.newNo <= u.range[1])
          .map((l) => toUnified(l, [u.range]))
      : [];
    uncoveredAdds += rows.filter((r) => r.type === 'add').length;
    const step = stepByFile.get(u.file);
    return { file: u.file, line: u.range[0], rows, stepId: step?.id, stepOrder: step?.order };
  });

  return {
    coveredLines: Math.max(0, totalAdd - uncoveredAdds),
    uncoveredLines: uncoveredAdds || uncovered.length,
    uncovered: views,
  };
}

/**
 * Reconstruct the complete file as side-by-side rows: unchanged regions on both
 * sides, added lines on the right (left hatched), removed lines on the left.
 * Built from the working-tree file + the parsed hunks — no second git call.
 */
export function buildFullFileRows(
  file: DiffFile | undefined,
  newLines: string[],
  uncoveredRanges: Array<[number, number]>,
): SbsRow[] {
  const rows: SbsRow[] = [];
  const hunks = file ? [...file.hunks].sort((a, b) => a.newStart - b.newStart) : [];
  const untoured = (n: number | undefined) =>
    n !== undefined && uncoveredRanges.some((r) => n >= r[0] && n <= r[1]);
  let newCursor = 1;
  let oldCursor = 1;

  for (const h of hunks) {
    while (newCursor < h.newStart && newCursor <= newLines.length) {
      rows.push({ type: 'ctx', oldNo: oldCursor, newNo: newCursor, content: newLines[newCursor - 1], comment: true });
      newCursor++;
      oldCursor++;
    }
    for (const l of h.lines) {
      if (l.type === 'ctx') {
        rows.push({ type: 'ctx', oldNo: l.oldNo, newNo: l.newNo, content: l.content, comment: true });
        if (l.newNo !== undefined) newCursor = l.newNo + 1;
        if (l.oldNo !== undefined) oldCursor = l.oldNo + 1;
      } else if (l.type === 'add') {
        rows.push({ type: 'add', newNo: l.newNo, content: l.content, comment: true, untoured: untoured(l.newNo) });
        if (l.newNo !== undefined) newCursor = l.newNo + 1;
      } else {
        rows.push({ type: 'del', oldNo: l.oldNo, content: l.content });
        if (l.oldNo !== undefined) oldCursor = l.oldNo + 1;
      }
    }
  }
  while (newCursor <= newLines.length) {
    rows.push({ type: 'ctx', oldNo: oldCursor, newNo: newCursor, content: newLines[newCursor - 1], comment: true });
    newCursor++;
    oldCursor++;
  }
  markMovedLines([rows], sbsLine);
  return rows;
}

function sbsLine(row: SbsRow): number | undefined {
  return row.type === 'del' ? row.oldNo : row.newNo;
}

function movedUnified(hunks: UnifiedRow[][]): UnifiedRow[][] {
  markMovedLines(hunks, (row) => row.no);
  return hunks;
}

/** Split-layout blocks for one file's hunks (the All-files Split view):
 *  each hunk becomes a block of SbsRows, adds flagged when uncovered.
 *  `file` is optional so context-only files (no entry in the parsed diff,
 *  only referenced by a context step) degrade to no blocks — same shape as
 *  buildFullFileRows' handling of an absent DiffFile. */
export function hunksToSbsBlocks(
  file: DiffFile | undefined,
  uncoveredRanges: Array<[number, number]>,
): SbsRow[][] {
  if (!file) return [];
  const untoured = (n?: number) =>
    n !== undefined && uncoveredRanges.some((r) => n >= r[0] && n <= r[1]);
  const blocks = file.hunks.map((h) =>
    h.lines.map((l) => {
      const row = toSbs(l);
      if (l.type === 'add' && untoured(l.newNo)) row.untoured = true;
      return row;
    }),
  );
  markMovedLines(blocks, sbsLine);
  return blocks;
}

/** GitHub-style change pairing: within each run of deleted lines immediately
 *  followed by added lines, merge the k-th del with the k-th add onto one
 *  side-by-side row and word-diff the pair, so a rewritten statement reads as
 *  one before/after row instead of two islands separated by empty space.
 *  Excess lines on either side keep their single-sided rows; rows already
 *  paired by a story move view pass through untouched. A moved line never
 *  pairs, but it does not split the run around it either: it keeps its side
 *  and its place, and its neighbours still pair up. */
export function pairChangeRows(rows: SbsRow[]): { rows: SbsRow[]; sides: Map<SbsRow, IntraSides> } {
  const out: SbsRow[] = [];
  const sides = new Map<SbsRow, IntraSides>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== 'del' || rows[i].paired) {
      out.push(rows[i]);
      i++;
      continue;
    }
    const dels: SbsRow[] = [];
    const adds: SbsRow[] = [];
    while (i < rows.length && rows[i].type === 'del' && !rows[i].paired) dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === 'add' && !rows[i].paired) adds.push(rows[i++]);
    emitPairedRun(dels, adds, out, sides);
  }
  return { rows: out, sides };
}

/** One del-run and add-run emitted in place. The k-th pairable deletion merges
 *  with the k-th pairable addition; everything else — moved lines and the
 *  excess on the longer side — keeps its own side. Both columns are walked in
 *  file order, so a move never jumps to the end of the run: a line the reader
 *  expects between 285 and 287 renders between 285 and 287. */
function emitPairedRun(dels: SbsRow[], adds: SbsRow[], out: SbsRow[], sides: Map<SbsRow, IntraSides>): void {
  const pairDels = dels.filter((row) => !row.moved);
  const pairAdds = adds.filter((row) => !row.moved);
  const mates = new Map<SbsRow, SbsRow>();
  for (let k = 0; k < Math.min(pairDels.length, pairAdds.length); k++) mates.set(pairDels[k], pairAdds[k]);
  // Word marks come from the whole run, so a reflowed statement still shows its
  // real change; rows left unpaired keep their own side's marks.
  const marks = runSides(pairDels.map((row) => row.content), pairAdds.map((row) => row.content));
  const leftMarks = new Map(pairDels.map((row, k) => [row, marks.left[k]]));
  const rightMarks = new Map(pairAdds.map((row, k) => [row, marks.right[k]]));
  let di = 0;
  let ai = 0;
  while (di < dels.length || ai < adds.length) {
    const del = dels[di];
    const add = adds[ai];
    const mate = del && mates.get(del);
    if (mate) {
      // An addition standing between this deletion's mate and the ones already
      // paired is a move: it goes out first so the after column keeps its order.
      if (add && add !== mate) {
        out.push(add);
        ai++;
        continue;
      }
      out.push(mergePair(del, mate, sides, { left: leftMarks.get(del), right: rightMarks.get(mate) }));
      di++;
      ai++;
      continue;
    }
    if (del) {
      const left = leftMarks.get(del);
      if (left !== undefined) sides.set(del, { left });
      out.push(del);
      di++;
      continue;
    }
    const right = rightMarks.get(add);
    if (right !== undefined) sides.set(add, { right });
    out.push(adds[ai++]);
  }
}

/** A deletion and an addition read as one before/after row, word-diffed. */
function mergePair(del: SbsRow, add: SbsRow, sides: Map<SbsRow, IntraSides>, intra: IntraSides): SbsRow {
  const merged: SbsRow = {
    type: 'ctx',
    changePair: true,
    paired: true,
    oldNo: del.oldNo,
    newNo: add.newNo,
    content: add.content,
    leftContent: del.content,
    rightContent: add.content,
    comment: true,
    untoured: add.untoured,
  };
  if (intra.left !== undefined || intra.right !== undefined) sides.set(merged, intra);
  return merged;
}

// ---- helpers ----

function toSbs(l: DiffLine): SbsRow {
  return { type: l.type, oldNo: l.oldNo, newNo: l.newNo, content: l.content, comment: l.newNo !== undefined };
}

function ctxRow(content: string, no: number): SbsRow {
  return { type: 'ctx', oldNo: no, newNo: no, content, comment: true };
}

function toUnified(l: DiffLine, uncovered: Array<[number, number]>): UnifiedRow {
  const untoured =
    l.newNo !== undefined && uncovered.some((r) => l.newNo! >= r[0] && l.newNo! <= r[1]);
  return { type: l.type, no: l.newNo ?? l.oldNo, content: l.content, untoured };
}

// The new-file line span a hunk occupies, used to size the expandable gaps
// between hunks. A pure-deletion hunk has newLines === 0; the Math.max(…,1)
// floor claims one line at newStart so the range is never inverted — a known,
// harmless one-line seam where the context line beside such a hunk is attributed
// to the hunk rather than a neighboring gap. Revisit here if gap ranges change.
export function hunkNewRange(h: DiffHunk): [number, number] {
  return [h.newStart, h.newStart + Math.max(h.newLines, 1) - 1];
}

function countLines(file: DiffFile, type: RowType): number {
  let n = 0;
  for (const h of file.hunks) for (const l of h.lines) if (l.type === type) n++;
  return n;
}

function byStepOrderThenPath(a: FileView, b: FileView): number {
  const ao = a.stepOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.stepOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.file.localeCompare(b.file);
}

// changedRanges is re-exported for callers that want raw uncovered ranges.
export { changedRanges };
