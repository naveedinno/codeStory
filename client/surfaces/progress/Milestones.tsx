// The milestone thread — the run's narrative spine, made structural.
//
// A 2px line through small nodes: accent up to the live position, dim beyond.
// It is the one part of the panel that answers "how far through is this?"
// honestly, because the phases behind it are emitted by the app, not guessed
// from agent chatter.
//
// The labels stay in the accessibility tree — a screen-reader user who walks
// into the panel should be able to read where the run is, exactly as a sighted
// one can. What they must not do is ANNOUNCE: each advance is spoken once,
// through the panel's single live region, by `advanceMilestones` in state.ts.
// The strip itself carries no live-region semantics; only the dots, which are
// pure decoration, are hidden.
//
// ── beUI adoption notes ──────────────────────────────────────────────────────
//
// `agents/agent-activity/` is the vendored component nearest this one by name,
// and it answers a different question. It is a vertical, scrolling, collapsible
// log of what the agent *did* — one row per tool call, search or thought,
// growing without bound. This is a fixed six-node horizontal rail answering
// "how far through is this", built from phases the app emits rather than from
// agent chatter, and the whole run always fits. Swapping one for the other
// would delete the panel's only honest progress indicator, not restyle it.
// Its `role="status"` was never the blocker.

import { cn } from "../../shared/cn";
import { milestoneTone, type ProgressState } from "./state";

export function Milestones({ state, compact }: { state: ProgressState; compact: boolean }) {
  const { milestones } = state;
  if (!milestones) return null;

  return (
    <ol
      data-pp-miles=""
      className={cn(
        "m-0 flex list-none items-start gap-1.5 px-3.5 pt-3 pb-0.5",
        compact && "px-4 pt-3.5 pb-1",
      )}
    >
      {milestones.map((milestone, index) => {
        const tone = milestoneTone(state, index);
        return (
          <li
            key={milestone.label}
            data-tone={tone}
            aria-current={tone === "active" ? "step" : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center",
              "font-mono text-xs tracking-[var(--tracking-kicker)] uppercase",
              tone === "done" && "text-[var(--pp-muted)]",
              tone === "active" && "text-[var(--pp-text)]",
              tone === "error" && "text-[var(--pp-err)]",
              tone === "pending" && "text-[var(--pp-faint)]",
            )}
          >
            <span
              data-pp-segment=""
              aria-hidden="true"
              className={cn(
                "relative h-[5px] w-full flex-none overflow-hidden rounded-full bg-[var(--pp-line)]",
                "after:absolute after:inset-0 after:origin-left after:scale-x-0 after:rounded-[inherit] after:content-['']",
                "after:transition-transform after:duration-[var(--motion-duration-progress)] after:ease-[var(--motion-ease-out)] motion-reduce:after:transition-none",
                (tone === "done" || tone === "active") && "after:scale-x-100 after:bg-[var(--pp-blue)]",
                tone === "error" && "after:scale-x-100 after:bg-[var(--pp-err)]",
                tone === "active" &&
                  !state.finished &&
                  "after:animate-[pp-segment-breathe_1.1s_ease-in-out_infinite] motion-reduce:after:animate-none",
              )}
            />
            <span>
              <span className="sr-only">
                {tone === "done" ? "Done: " : tone === "active" ? (state.phase === "stopped" ? "Stopped at: " : "In progress: ") : tone === "error" ? "Failed: " : "To do: "}
              </span>
              {milestone.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
