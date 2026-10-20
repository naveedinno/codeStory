// One live-progress panel for every agent run.
//
// This surface has no route. It is a panel inside the review page, fed by the
// NDJSON response body of `POST /api/generate` or `POST /api/story/repair`, and
// the host drives it through `useProgressRun()`.
//
// ── The announcement contract ────────────────────────────────────────────────
// There is exactly ONE live region in this tree: the visually-hidden span at the
// top, `role="status" aria-live="polite" aria-atomic="true"`, whose only content
// is `state.announcement`. Nothing else in this file may carry `aria-live`,
// `role="status"` or `role="log"`. The elapsed clock is explicitly opted out
// with `aria-live="off"`, and the error card uses `role="alert"` because it
// appears once, at the end, and is the one thing a user genuinely must hear.
//
// This is not decoration. During a normal run the panel re-renders on every
// file read, every shell command, every heartbeat and every stdout chunk —
// several hundred updates a minute. Marking the panel, the plan list or the
// activity line as live turns each of those into a spoken interruption.
//
// ── The palette ─────────────────────────────────────────────────────────────
// The panel carries its own colours and stays dark even in the light theme, by
// design: it is a console over the page, not part of it. `prefers-color-scheme:
// light` only lifts the ink slightly. That is why the `--pp-*` variables are set
// here rather than borrowed from the Signal tokens — the panel must not flip
// when the host does. Radii, the tonal fill and the pill shape ARE borrowed, so
// it still belongs to the same family.
//
// ── beUI adoption notes ──────────────────────────────────────────────────────
//
// This surface is the awkward one for beUI, because almost everything in the
// vendored `agents/` set ships a live region and the contract above says there
// may be exactly one. Four components are used; the rest were judged worse than
// what they would replace and the reasons are recorded next to each candidate.
//
//   - `Loader` (motion/loader) is the header spinner. It is the only adopted
//     component that speaks: it bakes in `role="status"` and an `sr-only`
//     label. Two independent things silence it — the `aria-hidden` wrapper
//     (which is exactly the semantics the hand-rolled ring had) and
//     `useQuietSubtree` below, which strips the role so a live region cannot
//     announce even if an AT ignores `aria-hidden` on an ancestor. Its own
//     `label` is emptied so no stray "Loading" text sits in front of the title.
//     What it buys over three Tailwind utilities: a real reduced-motion state.
//     The hand-rolled ring froze into a solid blue circle that read as a "done"
//     mark; `Loader` keeps a calm opacity pulse instead.
//   - `ActionSwapText` (motion/action-swap) carries the lifecycle headline.
//     The title changes about three times a run — "Preparing…" → "Writing your
//     review" → "Review ready" — and used to hard-cut. It now blur-swaps while
//     the pill morphs to the new width. `max-w-full` is added because the
//     component pins an explicit measured width and the ≤520px head grid gives
//     the title a `minmax(0,1fr)` cell it must not blow out of.
//   - `NumberTicker` (motion/number-ticker) rolls the plan counter's leading
//     digit. `startOnView={false}`: the component's default arms itself on an
//     IntersectionObserver, and this panel is either on screen or unmounted.
//   - `ActivityText` wraps `TextShimmer`; see that file for the two traps.
//
// `Button` writes `tabindex` onto `motion.button`, which matters where
// `tabIndex={-1}` is load-bearing. Nothing here is, so the two chrome buttons
// use it directly — they only need their Signal-free colours supplied,
// focus ring included, because the component sets `outline-none`.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { ActionSwapText } from "../../vendor/beui/motion/action-swap";
import { Button } from "../../vendor/beui/motion/button/base";
import { Loader } from "../../vendor/beui/motion/loader";
import { NumberTicker } from "../../vendor/beui/motion/number-ticker";
import { cn } from "../../shared/cn";
import { EASE_SIGNAL_DRAWER, EASE_SIGNAL_OUT } from "../../shared/motion";
import { useQuietSubtree } from "../../shared/quiet";
import { ActivityText } from "./ActivityText";
import { Elapsed } from "./Elapsed";
import { Milestones } from "./Milestones";
import { PlanList } from "./PlanList";
import { planCountSuffix, type ProgressVariant } from "./state";
import type { ProgressRun } from "./use-progress-run";

// A dark console in both themes. The panel root pins `data-theme="dark"` so
// these aliases always resolve to the dark token values; there is no
// OS-scheme branch because the app switches on `data-theme`, not the OS.
const PALETTE = [
  "[--pp-bg:var(--surface)]",
  "[--pp-elev:var(--surface-3)]",
  "[--pp-text:var(--text)]",
  "[--pp-muted:var(--text-3)]",
  "[--pp-faint:var(--text-3)]",
  "[--pp-line:var(--line)]",
  "[--pp-blue:var(--accent)]",
  "[--pp-err:var(--del)]",
  "[--pp-ok:var(--add)]",
].join(" ");

const VARIANT: Record<ProgressVariant, string> = {
  // The parked home: a console in the corner of the review page.
  floating:
    "fixed end-[calc(18px+env(safe-area-inset-right))] bottom-[calc(18px+env(safe-area-inset-bottom))] z-50 w-[min(460px,calc(100vw-36px))] max-h-[min(72vh,580px)] shadow-[var(--shadow)]",
  inline: "mt-5 max-h-[min(66vh,580px)]",
  // In the story stage the panel IS the content, so it gets room to breathe and
  // no scroll cap of its own.
  stage: "mt-7 max-h-none",
};

const ACTION = cn(
  "h-auto rounded-full border border-transparent px-[13px] py-1.5 text-xs font-semibold",
  "bg-[var(--fill-1,rgba(190,205,225,0.07))] text-[var(--pp-text)]",
  "hover:bg-[var(--fill-2,rgba(190,205,225,0.12))]",
  "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
);

export interface ProgressPanelProps {
  /** The run handle from `useProgressRun()`. */
  run: ProgressRun;
  /**
   * Placement. The vanilla panel was a single DOM node re-parented between
   * three homes; in React it is one element the host renders where it wants.
   */
  variant?: ProgressVariant;
  /**
   * Recovery actions, rendered in the footer. This replaces the vanilla
   * `showFoot(node)` DOM injection — pass buttons as children instead.
   */
  foot?: ReactNode;
  className?: string;
}

export function ProgressPanel({ run, variant = "floating", foot, className }: ProgressPanelProps) {
  const { state } = run;
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  // Strip the live region beUI's `Loader` bakes in, and spare the two this
  // panel owns deliberately: the single announcer, and the error card, which is
  // the one thing a user genuinely must hear and appears once, at the end.
  useQuietSubtree(root, { keep: "[data-pp-announcer], [data-pp-error]" });

  const stage = variant === "stage";
  // The standalone activity line is the fallback for runs with no plan; once a
  // plan exists the same text lives inside the active step. It also retires when
  // the run lands, because "Reading src/a.ts" is not a result.
  const showNowLine = !state.hasPlan && !!state.current && !state.finished;

  // Only the floating variant animates. `inline` and `stage` sit in normal
  // document flow as page content, and sliding page content is wrong — the
  // stage container already has an entrance of its own.
  const lift = variant === "floating" && !reduce;

  return (
    <AnimatePresence>
      {state.open ? (
        <motion.div
      key="progress-panel"
      ref={root}
      // The full transform string, not motion's x/y/scale shorthands: those are
      // not hardware-accelerated, and this panel animates in while an agent is
      // streaming NDJSON into it — precisely when the main thread is busiest.
      initial={lift ? { opacity: 0, transform: "translateY(12px) scale(0.985)" } : false}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      exit={
        lift
          ? {
              opacity: 0,
              transform: "translateY(8px) scale(0.99)",
              transition: { duration: 0.16, ease: EASE_SIGNAL_OUT },
            }
          : { opacity: 0, transition: { duration: 0.12 } }
      }
      // --motion-duration-spatial + --ease-drawer, the pair the folder-browser
      // sheet uses. Exit is faster than entry: a dismissal should get out of
      // the way.
      transition={{ duration: 0.34, ease: EASE_SIGNAL_DRAWER }}
      data-theme="dark"
      data-progress-panel=""
      data-variant={variant}
      data-state={state.phase}
      className={cn(
        PALETTE,
        "@container flex flex-col overflow-hidden rounded-[var(--radius-island,26px)]",
        "border border-[var(--pp-line)] bg-[var(--pp-bg)] text-[var(--pp-text)]",
        "font-sans tracking-[-0.01em]",
        VARIANT[variant],
        className,
      )}
    >
      {/*
        THE live region. One per panel, and it only ever holds a lifecycle
        sentence: "Preparing", the work title, a milestone label, "Checking the
        result", or the finish title. See state.ts `announce()`.
      */}
      <span
        data-pp-announcer=""
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {state.announcement}
      </span>

      <header
        className={cn(
          "flex items-center gap-[9px] border-b border-[var(--pp-line)] px-3.5 py-3",
          "@max-[520px]:grid @max-[520px]:grid-cols-[auto_minmax(0,1fr)_auto] @max-[520px]:items-start",
          "@max-[520px]:gap-x-[9px] @max-[520px]:gap-y-1.5",
        )}
      >
        {state.spinning ? (
          // `aria-hidden` is the semantics the hand-rolled ring had, and it is
          // also the first of the two things that keep Loader's baked-in
          // `role="status"` from ever speaking. The second is useQuietSubtree.
          <span
            aria-hidden="true"
            className="flex flex-none @max-[520px]:col-start-1 @max-[520px]:row-start-1"
          >
            <Loader
              variant="spinner"
              size={13}
              speed={0.7}
              label=""
              className="text-[var(--pp-blue)]"
            />
          </span>
        ) : null}
        <span
          data-pp-title=""
          className={cn(
            "min-w-0 font-mono text-xs font-medium tracking-[var(--tracking-kicker)] text-[var(--pp-blue)] uppercase",
            stage && "text-sm",
            "@max-[520px]:col-start-2 @max-[520px]:row-start-1 @max-[520px]:self-center",
          )}
        >
          <ActionSwapText value={state.title} animation="blur" className="max-w-full">
            {state.title}
          </ActionSwapText>
        </span>
        {state.agent ? (
          <span
            data-pp-agent=""
            className={cn(
              "max-w-[220px] overflow-hidden rounded-md border border-[var(--pp-line)] bg-[var(--pp-elev)]",
              "px-[7px] py-0.5 text-sm text-ellipsis whitespace-nowrap text-[var(--pp-muted)]",
              "@max-[520px]:col-start-2 @max-[520px]:row-start-2 @max-[520px]:max-w-full @max-[520px]:justify-self-start",
            )}
          >
            {state.agent}
          </span>
        ) : null}
        <span aria-hidden="true" className="flex-1 @max-[520px]:hidden" />
        {/* `pressScale` is not optional here even though beUI supplies a default.
            Its default is 0.93, which is outside the 0.95–0.98 band plan 011
            settled on and well past the 0.97 every other surface passes
            explicitly — leaving it unset made these two the most aggressive
            press in the app, on the one panel that appears while an agent is
            already working. */}
        {state.showStop ? (
          <Button
            data-pp-stop=""
            pressScale={0.97}
            onClick={run.requestStop}
            className={cn(ACTION, "@max-[520px]:col-start-3 @max-[520px]:row-start-1 @max-[520px]:row-span-2")}
          >
            Stop
          </Button>
        ) : null}
        {state.showClose ? (
          <Button
            data-pp-close=""
            pressScale={0.97}
            onClick={run.requestClose}
            className={cn(ACTION, "@max-[520px]:col-start-3 @max-[520px]:row-start-1 @max-[520px]:row-span-2")}
          >
            Close
          </Button>
        ) : null}
      </header>

      {state.repo ? (
        <div className="flex items-start gap-2.5 px-3.5 pt-2.5 pb-0.5">
          <span
            data-pp-repo=""
            className="min-w-0 flex-1 font-mono text-sm break-words text-[var(--pp-muted)]"
          >
            {state.repo}
          </span>
        </div>
      ) : null}

      <Milestones state={state} compact={stage} />

      {state.note ? (
        <div
          data-pp-note=""
          className={cn(
            "px-3.5 pt-2.5 pb-0.5 text-[0.8125rem] leading-[1.45] text-[var(--pp-text)]",
            stage && "px-4 pt-3 pb-1 text-sm",
          )}
        >
          {state.note}
        </div>
      ) : null}

      <PlanList state={state} />

      {showNowLine ? (
        <div data-pp-now="" className="min-h-6 flex-1 overflow-auto px-3.5 py-2">
          <ActivityText
            live={!state.finished}
            tone="muted"
            className="font-mono text-[0.78125rem] break-words"
          >
            {state.current}
          </ActivityText>
        </div>
      ) : null}

      <div
        data-pp-live=""
        data-tone={state.liveTone}
        className={cn(
          "flex items-center gap-2 border-t border-[var(--pp-line)] px-3.5 py-2.5 text-sm tabular-nums",
          state.liveTone === "error" ? "text-[var(--pp-muted)]" : "text-[var(--pp-faint)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 flex-none rounded-full",
            state.liveTone === "error" ? "bg-[var(--pp-err)]" : "bg-[var(--pp-ok)]",
            state.liveTone === "running" &&
              "animate-pulse [animation-duration:1.6s] motion-reduce:animate-none",
          )}
        />
        <span data-pp-live-text="">{state.liveText}</span>
        <Elapsed startedAt={state.startedAt} running={state.running} />
        {/*
          `state.liveCount` is the same fact as a plain string, and stays on the
          state for hosts that read it. Rendering from the two numbers is what
          lets the leading digit roll instead of jumping; `planCountSuffix` keeps
          the wording in one place.
        */}
        <span data-pp-live-count="" className="ms-auto">
          {state.hasPlan ? (
            <>
              <NumberTicker
                value={state.planDone}
                startOnView={false}
                duration={0.28}
                stagger={0}
              />
              {planCountSuffix(state.planTotal)}
            </>
          ) : (
            state.liveCount
          )}
        </span>
      </div>

      {state.error ? (
        <div
          data-pp-error=""
          role="alert"
          aria-atomic="true"
          className={cn(
            "mx-3.5 mt-3 mb-0.5 grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 rounded-xl px-3 py-[11px]",
            "border border-[color-mix(in_srgb,var(--pp-err)_28%,transparent)]",
            "bg-[color-mix(in_srgb,var(--pp-err)_8%,transparent)]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold",
              "bg-[color-mix(in_srgb,var(--pp-err)_12%,transparent)] text-[var(--pp-err)]",
            )}
          >
            !
          </span>
          <div>
            <div className="text-[0.8125rem] leading-[1.35] font-semibold break-words text-[var(--pp-text)]">
              {state.error.label || "The run failed"}
            </div>
            {state.error.detail ? (
              <div className="mt-[5px] font-mono text-xs leading-[1.6] break-words text-[var(--pp-muted)]">
                {state.error.detail}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        Raw agent output, revealed only on failure and never auto-opened. Still
        a native <details>, and the beUI adoption pass re-judged that rather
        than inheriting it. `AgentDisclosure` is a bare animated <div>: it
        supplies no trigger, so adopting it means hand-writing a button with
        `aria-expanded`/`aria-controls` to replace semantics <summary> gives for
        free, and losing find-in-page's ability to open a collapsed <details>.
        What it returns is a 0.22s clip-path wipe over a `<pre>` that can hold
        200 kB of stdout, with the height snapping open underneath it anyway
        (`openHeight` defaults to `auto`, which motion cannot tween). Worse on
        both sides of the trade.
      */}
      {state.showDetails ? (
        <details className="border-t border-[var(--pp-line)] px-3.5 pt-2 pb-2.5">
          <summary className="cursor-pointer text-xs tracking-[var(--tracking-kicker)] text-[var(--pp-muted)] uppercase">
            Technical details
          </summary>
          <pre
            data-pp-raw=""
            className="m-0 mt-1.5 max-h-40 overflow-auto font-mono text-[0.6875rem] leading-[1.5] break-words whitespace-pre-wrap text-[var(--pp-faint)]"
          >
            {state.raw}
          </pre>
        </details>
      ) : null}

      {foot ? (
        <div
          data-pp-foot=""
          className="flex flex-wrap items-center gap-[9px] border-t border-[var(--pp-line)] px-3.5 py-2.5 text-xs text-[var(--pp-text)]"
        >
          {foot}
        </div>
      ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** The accent action a recovery footer leads with ("Try again", "Change model"). */
export const progressPrimaryActionClass = cn(
  "h-auto rounded-full border-none px-[13px] py-[7px] text-xs font-semibold",
  "bg-[var(--pp-blue)] text-[var(--on-accent)] hover:bg-[var(--pp-blue)]",
  "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
);

/** The quiet companion action ("Review settings", "Retry after updating"). */
export const progressSecondaryActionClass = cn(
  "h-auto rounded-full border border-transparent bg-transparent px-[13px] py-[7px] text-xs font-semibold",
  "text-[var(--pp-text)] hover:bg-[var(--fill-1,rgba(190,205,225,0.07))]",
  "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
);
