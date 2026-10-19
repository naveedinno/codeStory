// The progress panel's whole behaviour, as a pure state machine.
//
// This module is deliberately React-free. `ProgressPanel.tsx` only *renders*
// what is computed here, and `use-progress-run.ts` only threads it through
// `useState`. Keeping the two apart matters for one specific reason:
//
//   The panel's single hardest requirement is about what it must NOT say.
//
// Six tests in the vanilla suite existed solely to assert that heartbeats, file
// events, command events, tool events, text chunks and the one-second elapsed
// tick are all silent to assistive technology. A 60-second agent run emits
// hundreds of those. The obvious React move — `aria-live="polite"` on the panel
// that is being updated — turns every one of them into a screen-reader
// interruption.
//
// So announcements are not a rendering concern at all. `state.announcement` is
// a single string, written by exactly one function (`announce`), from exactly
// five call sites, and rendered into exactly one visually-hidden live region.
// Every other field can change as often as it likes. If you are adding an event
// branch below and reaching for `announce`, that is almost certainly wrong.
//
// Ported from `src/progress-ui.ts` `ProgressPanel()`. The event switch is the
// mirror of the `ProgressEvent` union in `src/progress.ts`; the two must stay in
// sync, and `test/progress-ui.test.mjs` fails if the union grows a member this
// file does not name.

import type {
  Phase,
  PlanItem,
  ProgressEvent,
  RunStatus,
  Workflow,
} from "../../../src/progress";

export type ProgressVariant = "floating" | "inline" | "stage";

/** Where a run is in its life. `blocked` is "never started", not "failed". */
export type ProgressPhase =
  | "idle"
  | "running"
  | "complete"
  | "stopped"
  | "failed"
  | "blocked";

export type LiveTone = "running" | "done" | "error";

/** The shape both `error` events and `blocked()` speak. */
export interface ProgressError {
  label?: string;
  detail?: string;
  technicalDetail?: string;
}

export interface Milestone {
  label: string;
  phases: Phase[];
}

export interface ProgressState {
  /** False until `start()` or `blocked()`. The panel renders nothing when closed. */
  open: boolean;
  phase: ProgressPhase;
  /** Lifecycle headline: "Preparing…" → "Writing your review" → "Review ready". */
  title: string;
  /** "Codex · gpt-5.6-codex", or "" before the context event. */
  agent: string;
  /** "repo · main → feat/x · 2 comments", or "". */
  repo: string;
  workflow: Workflow | "";
  /** Null until a run_started names a workflow we have milestones for. */
  milestones: Milestone[] | null;
  milestoneIndex: number;
  milestoneFailed: boolean;
  /** Agent narration (a `>>` line that is not a phase marker), as prose. */
  note: string;
  /** The agent's own TodoWrite plan. */
  plan: PlanItem[];
  /** Latches true on the first non-empty plan and never goes back. */
  hasPlan: boolean;
  planDone: number;
  planTotal: number;
  /** The mono "what is happening right now" line. */
  current: string;
  /** The un-suffixed live state word: Preparing / Working / Checking. */
  liveState: string;
  /** What the live row actually prints, quiet-suffix included. */
  liveText: string;
  liveTone: LiveTone;
  /**
   * "3 of 8 done", or "". The panel's live row renders the same fact from
   * `planDone`/`planTotal` so the leading digit can roll; this stays the plain
   * string form, which is what a non-React host reads.
   */
  liveCount: string;
  startedAt: number;
  /** Drives the one-second elapsed tick. */
  running: boolean;
  /** Freezes the milestone-dot pulse once a run has landed. */
  finished: boolean;
  spinning: boolean;
  showStop: boolean;
  showClose: boolean;
  error: ProgressError | null;
  /** Raw agent stdout, capped. Only ever surfaced behind the details disclosure. */
  raw: string;
  showDetails: boolean;
  /**
   * The only string that reaches a live region. Written by `announce()` alone.
   * Deduped: re-setting the same text is a no-op, exactly as the vanilla panel's
   * `lastAnnouncement` guard behaved.
   */
  announcement: string;
}

const WORK: Record<Workflow, string> = {
  guided_review: "Writing your review",
  detailed_audit: "Writing your review",
  code_story: "Writing your code story",
};

const DONE: Record<Workflow, string> = {
  guided_review: "Review ready",
  detailed_audit: "Review ready",
  code_story: "Code story ready",
};

const FAIL: Record<Workflow, string> = {
  guided_review: "Generation failed",
  detailed_audit: "Generation failed",
  code_story: "Generation failed",
};

// The narrated spine of a story run. The three middle labels are the ones the
// story prompt tells the agent to print as `>> …` markers, so they are also the
// words the user has already seen in the agent's own output.
const STORY_MILESTONES: Milestone[] = [
  {
    label: "Preparing",
    phases: [
      "idle",
      "preflight",
      "resolving_context",
      "preparing_prompt",
      "starting_agent",
      "agent_running",
    ],
  },
  { label: "Recovering the why", phases: ["reading_changes", "recovering_why"] },
  { label: "Designing the reading path", phases: ["designing_path"] },
  { label: "Writing the story", phases: ["writing_output"] },
  { label: "Checking the result", phases: ["validating_output", "applying_results"] },
  { label: "Ready", phases: ["complete"] },
];

// A code story runs the same spine; its middle labels are the markers the
// code-story prompt prints, so the panel repeats the agent's own words.
const CODE_STORY_MILESTONES: Milestone[] = [
  STORY_MILESTONES[0],
  { label: "Framing the question", phases: ["reading_changes", "recovering_why"] },
  { label: "Mapping the code", phases: ["designing_path"] },
  ...STORY_MILESTONES.slice(3),
];

const MILESTONES: Record<Workflow, Milestone[]> = {
  guided_review: STORY_MILESTONES,
  detailed_audit: STORY_MILESTONES,
  code_story: CODE_STORY_MILESTONES,
};

/** Bound the in-memory log the way the server bounds its own capture. */
const RAW_CAP = 200_000;

const CURRENT_CAP = 120;
const NOTE_CAP = 220;

export function clip(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function firstLine(value: unknown): string {
  const text = String(value ?? "");
  const breakAt = text.indexOf("\n");
  return breakAt >= 0 ? text.slice(0, breakAt) : text;
}

/** `<60 → "42s"`, else `"3m 07s"`-ish. Matches the vanilla formatter exactly. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Everything after the plan counter's leading number: `" of 8 done"`.
 *
 * Split out because the panel renders that number through beUI's `NumberTicker`
 * so the digit rolls, and a rolling digit cannot live inside a pre-formatted
 * string. The suffix therefore has exactly one definition, used both by
 * `planCountLabel()` below (which fills `state.liveCount`) and by the live row.
 */
export function planCountSuffix(total: number): string {
  return ` of ${total} done`;
}

/** `"3 of 8 done"`. The plain-string form of the same fact. */
export function planCountLabel(done: number, total: number): string {
  return `${done}${planCountSuffix(total)}`;
}

export function agentChip(agent?: string, model?: string): string {
  const name = agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : "Agent";
  return model ? `${name} · ${model}` : name;
}

export function repoLine(event: {
  repoName?: string;
  workflow?: string;
  base?: string;
  head?: string;
  targetCount?: number;
}): string {
  let line = event.repoName || "";
  // A code story explains one commit, so there is no "→ head" to draw.
  if (event.base && event.workflow === "code_story") line += ` · ${event.base}`;
  else if (event.base) line += ` · ${event.base} → ${event.head || "working tree"}`;
  if (typeof event.targetCount === "number") {
    line += ` · ${event.targetCount} ${event.targetCount === 1 ? "comment" : "comments"}`;
  }
  return line;
}

/** "Working" plus the quiet suffix, which only appears once the agent has gone quiet. */
export function liveLabel(state: string, quietMs?: number): string {
  const quiet = typeof quietMs === "number" ? Math.round(quietMs / 1000) : 0;
  return (state || "Working") + (quiet >= 8 ? ` · quiet ${quiet}s` : "");
}

export function initialProgressState(): ProgressState {
  return {
    open: false,
    phase: "idle",
    title: "Preparing…",
    agent: "",
    repo: "",
    workflow: "",
    milestones: null,
    milestoneIndex: -1,
    milestoneFailed: false,
    note: "",
    plan: [],
    hasPlan: false,
    planDone: 0,
    planTotal: 0,
    current: "",
    liveState: "Working",
    liveText: "Starting…",
    liveTone: "running",
    liveCount: "",
    startedAt: 0,
    running: false,
    finished: false,
    spinning: false,
    showStop: false,
    showClose: false,
    error: null,
    raw: "",
    showDetails: false,
    announcement: "",
  };
}

/**
 * Put one sentence in front of a screen reader.
 *
 * The ONLY writer of `announcement`. Whitespace is collapsed and an unchanged
 * message is dropped, so a repeated milestone or a re-emitted title stays quiet.
 */
function announce(state: ProgressState, message: string): ProgressState {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text || text === state.announcement) return state;
  return { ...state, announcement: text };
}

function appendRaw(state: ProgressState, chunk: string): ProgressState {
  if (!chunk) return state;
  let raw = state.raw + chunk;
  if (raw.length > RAW_CAP) raw = "…" + raw.slice(raw.length - RAW_CAP);
  return { ...state, raw };
}

function showError(state: ProgressState, error: ProgressError): ProgressState {
  const next: ProgressState = { ...state, error };
  // A technical detail REPLACES the captured log rather than appending to it:
  // when the server knows exactly what went wrong, that beats 200 kB of stdout.
  if (error.technicalDetail) next.raw = String(error.technicalDetail);
  return next;
}

function setCurrent(state: ProgressState, text: unknown): ProgressState {
  const value = clip(text, CURRENT_CAP);
  if (!value) return state;
  return { ...state, current: value };
}

function setNote(state: ProgressState, text: unknown): ProgressState {
  const value = clip(text, NOTE_CAP);
  if (!value) return state;
  return { ...state, note: value };
}

function setLive(state: ProgressState, live: string, quietMs?: number): ProgressState {
  return { ...state, liveState: live, liveText: liveLabel(live, quietMs) };
}

function renderPlan(state: ProgressState, items: PlanItem[] | undefined): ProgressState {
  if (!items || !items.length) return state;
  const done = items.filter((item) => item?.status === "done").length;
  return {
    ...state,
    hasPlan: true,
    plan: items,
    planTotal: items.length,
    planDone: done,
    // A fresh plan owns the activity line: the previous step's "now" text
    // described work that is finished.
    current: "",
    liveCount: planCountLabel(done, items.length),
  };
}

/**
 * Monotonic milestone advance. A late-arriving earlier phase never rewinds the
 * thread, which is why this compares indexes instead of just looking one up.
 */
function advanceMilestones(state: ProgressState, phase: Phase): ProgressState {
  const { milestones } = state;
  if (!milestones) return state;
  for (let i = 0; i < milestones.length; i++) {
    if (milestones[i].phases.indexOf(phase) >= 0) {
      if (i > state.milestoneIndex) {
        return announce({ ...state, milestoneIndex: i }, milestones[i].label);
      }
      return state;
    }
  }
  return state;
}

/**
 * Begin (or restart) a run.
 *
 * Takes no prior state on purpose: everything the last run left behind — its
 * plan, milestones, error, captured log and last announcement — is cleared, and
 * a signature that accepted the old state would invite someone to keep a piece
 * of it. A re-run is a new run.
 */
export function startRun(now = Date.now()): ProgressState {
  const fresh: ProgressState = {
    ...initialProgressState(),
    open: true,
    phase: "running",
    startedAt: now,
    running: true,
    spinning: true,
    showStop: true,
    showClose: false,
    liveTone: "running",
  };
  // Announcing from a cleared announcer, so "Preparing" lands even on a re-run
  // that ended on "Preparing" last time.
  return announce(setLive(fresh, "Preparing", 0), "Preparing");
}

/** A run that ended, however it ended. `run_done` routes here. */
export function finishRun(
  state: ProgressState,
  status: RunStatus,
  result: Record<string, unknown> = {},
): ProgressState {
  const ok = status === "complete";
  const handedToDesktop = ok && result?.delivery === "desktop";

  let milestoneIndex = state.milestoneIndex;
  let milestoneFailed = state.milestoneFailed;
  if (ok && state.milestones) milestoneIndex = state.milestones.length;
  else if (!ok && status !== "stopped" && state.milestones) milestoneFailed = true;

  const title = handedToDesktop
    ? "Sent to ChatGPT"
    : ok
      ? state.workflow
        ? DONE[state.workflow]
        : "Done"
      : status === "stopped"
        ? "Stopped"
        : state.workflow
          ? FAIL[state.workflow]
          : "Couldn't finish";

  let next: ProgressState = {
    ...state,
    phase: ok ? "complete" : status,
    title,
    running: false,
    finished: true,
    spinning: false,
    showStop: false,
    showClose: true,
    milestoneIndex,
    milestoneFailed,
    liveTone: ok ? "done" : "error",
    liveText: handedToDesktop
      ? "Message delivered"
      : ok
        ? "Done"
        : status === "stopped"
          ? "Stopped"
          : "Failed",
  };

  if (ok || status === "stopped") next = announce(next, title);

  // A stream that just ends is the commonest failure and the least explicable
  // one, so it gets a written explanation rather than an empty error card.
  if (!ok && status !== "stopped" && !next.error) {
    next = showError(next, {
      label: "The connection to the agent ended",
      detail: "Try again. If it keeps failing, reopen codeStory and check the technical details.",
    });
  }
  // Revealed, never auto-opened: diagnostics are for the person who asks.
  if (!ok && next.raw.trim()) next = { ...next, showDetails: true };
  return next;
}

/** The run never started — no agent on PATH, a rejected payload, a 4xx. */
export function blockRun(state: ProgressState, error: ProgressError = {}): ProgressState {
  const next: ProgressState = {
    ...state,
    open: true,
    phase: "blocked",
    title: "Cannot start",
    running: false,
    spinning: false,
    showStop: false,
    showClose: true,
    liveTone: "error",
    liveText: error.label || "Blocked",
    liveCount: "",
  };
  return showError(next, {
    label: error.label || "Could not start.",
    detail: error.detail ?? "Try again.",
    ...(error.technicalDetail ? { technicalDetail: error.technicalDetail } : {}),
  });
}

/**
 * Fold one streamed `ProgressEvent` into the panel state.
 *
 * Unknown event types are ignored rather than throwing — a newer server talking
 * to an older page should degrade, not blank the panel mid-run.
 */
export function applyEvent(state: ProgressState, event: ProgressEvent): ProgressState {
  if (!event || !event.type) return state;
  switch (event.type) {
    case "run_started": {
      const workflow = event.workflow || "";
      const title = (workflow && WORK[workflow]) || event.label || "Working…";
      const milestones = (workflow && MILESTONES[workflow]) || null;
      const next: ProgressState = {
        ...state,
        workflow,
        title,
        milestones,
        milestoneIndex: milestones ? 0 : -1,
      };
      return announce(setLive(next, "Working", 0), title);
    }

    case "context":
      return {
        ...state,
        agent: agentChip(event.agent, event.model),
        repo: repoLine(event),
      };

    case "phase": {
      let next = advanceMilestones(state, event.phase);
      if (event.phase === "validating_output" || event.phase === "applying_results") {
        next = setLive({ ...next, title: "Checking the result…" }, "Checking", 0);
        // With milestones on screen the thread already said this; announcing it
        // again would be the same sentence twice.
        if (!next.milestones) next = announce(next, "Checking the result");
      }
      return next;
    }

    case "plan":
      return renderPlan(state, event.items);

    case "file":
    case "command":
    case "tool":
      return setCurrent(state, event.label);

    case "activity":
      return event.kind === "narration"
        ? setNote(state, event.label)
        : setCurrent(state, event.label);

    case "text": {
      const next = appendRaw(state, event.data || "");
      if (next.hasPlan) return next;
      const line = clip(firstLine(event.data), CURRENT_CAP);
      // A `>>` line has ALREADY reached the panel as a narration or phase event
      // (the server parses it in `parseAgentNoteLine`). Echoing the raw stdout
      // copy here would print every narration twice: once as prose in the note,
      // once as mono in the activity line. This guard looks redundant and is not.
      if (line && line.indexOf(">>") !== 0) return setCurrent(next, line);
      return next;
    }

    case "heartbeat":
      // Deliberately silent. This fires every few seconds for a whole minute.
      return setLive(state, state.liveState, event.quietMs);

    case "warning":
      return appendRaw(state, `[warn] ${event.label || ""}\n`);

    case "error":
      return showError(state, event);

    case "run_done":
      return finishRun(state, event.status, event.result || {});

    default:
      return state;
  }
}

/** Milestone rendering states, derived so the component holds no logic of its own. */
export type MilestoneTone = "done" | "active" | "pending" | "error";

export function milestoneTone(state: ProgressState, index: number): MilestoneTone {
  if (index < state.milestoneIndex) return "done";
  if (index === state.milestoneIndex) return state.milestoneFailed ? "error" : "active";
  return "pending";
}
