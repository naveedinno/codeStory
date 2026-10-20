// The agent's OWN plan, from its TodoWrite calls — the centrepiece of the panel.
//
// The "what's happening now" line is nested INSIDE the active step rather than
// living in its own row. That is deliberate: it binds the churn of file and
// command events to the one plan item they belong to, instead of leaving a
// free-floating line that looks like it describes the whole run.
//
// ── beUI adoption notes ──────────────────────────────────────────────────────
//
// `agents/todo-list.tsx` is visually almost exactly this component and is the
// obvious thing to reach for. It is still not used, and the live region is no
// longer the reason — `useQuietSubtree` would strip the `aria-live="polite"` it
// puts on its `<ol>`. Four things it does that this list must not:
//
//   1. Every item title is `truncate`d. Plan items come from the agent's own
//      TodoWrite calls and are full sentences ("Design a reading path across
//      the spending-limit change"); this list wraps them, and eliding two
//      thirds of a three-item plan is a loss of the panel's main content.
//   2. There is nowhere to nest the activity line. `TodoList`'s only per-item
//      slot beside the title is `detail`, a `shrink-0` trailing cell, and the
//      title itself sits inside the truncating span under a strikethrough
//      overlay. `[data-pp-plan] [data-pp-step-now]` is a UI-atlas hook and,
//      more importantly, the binding described above.
//   3. It owns collapse state — `collapseOnComplete` folds the plan away the
//      moment the run lands, which is when a user is most likely to read it —
//      and adds a header row whose "3/8" restates the live row's counter.
//   4. It scroll-anchors to the bottom on every item-count change, with
//      `behavior: "smooth"`, inside a panel that already scrolls.
//
// So the list stays hand-built, keeping beUI's spacing and status vocabulary.
// The nested activity line does adopt `TextShimmer`, via `ActivityText`.

import { cn } from "../../shared/cn";
import { ActivityText } from "./ActivityText";
import type { ProgressState } from "./state";

const MARK = "flex-none w-3.5 text-start text-[0.6875rem] leading-[inherit]";

export function PlanList({ state }: { state: ProgressState }) {
  if (!state.hasPlan) return null;

  return (
    <ol
      data-pp-plan=""
      className="m-0 min-h-10 flex-1 list-none overflow-auto px-3.5 pt-1.5 pb-1"
    >
      {state.plan.map((item, index) => {
        const status = item?.status || "pending";
        const active = status === "active";
        return (
          <li
            key={`${index}-${item?.text ?? ""}`}
            data-status={status}
            className="flex items-baseline gap-2.5 py-1 font-mono text-[0.6875rem] leading-[1.55]"
          >
            {status === "done" ? (
              <span aria-hidden="true" className={cn(MARK, "text-[var(--pp-ok)]")}>
                ✓
              </span>
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  MARK,
                  active
                    ? "animate-pulse text-[var(--pp-blue)] [animation-duration:1.2s] motion-reduce:animate-none"
                    : "text-[var(--pp-faint)]",
                )}
              >
                {active ? "●" : "○"}
              </span>
            )}
            <span
              className={cn(
                "min-w-0 text-[0.6875rem]",
                status === "done" && "text-[var(--pp-faint)]",
                active && "text-[var(--pp-text)]",
                status === "pending" && "text-[var(--pp-muted)]",
              )}
            >
              <span className="sr-only">
                {status === "done" ? "Done: " : active ? "In progress: " : "To do: "}
              </span>
              {item?.text || ""}
              {active && state.current ? (
                <span data-pp-step-now="" className="mt-0.5 block">
                  <ActivityText
                    live={!state.finished}
                    tone="faint"
                    className="font-mono text-sm break-words"
                  >
                    {state.current}
                  </ActivityText>
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
