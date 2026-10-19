// Bundle entry for the live-progress panel.
//
// This surface is unusual: it has no route. It is a panel inside the review
// page, fed by the NDJSON response bodies of `POST /api/generate` and
// `POST /api/story/repair`. So this entry does not mount an app into `#root`
// the way `picker.tsx` or `change.tsx` do.
//
// It exists for two reasons:
//
//  1. It is the module the review page imports the component from, and building
//     it on its own keeps the surface honestly sized and independently
//     type-checked rather than hiding inside the review bundle.
//  2. It publishes an imperative bridge on `window.codeStoryProgress` for hosts
//     that are not React: the UI-atlas capture drives the panel with fixture
//     `ProgressEvent`s through exactly this door, and so does any manual check.
//
// The bridge mirrors the old global `ProgressPanel(root, opts)` API closely
// enough that a driver written against the vanilla panel needs only the mount
// call changed.

import { useImperativeHandle, useState, type ReactNode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ProgressEvent, RunStatus } from "../../src/progress";
import { ProgressPanel } from "../surfaces/progress/ProgressPanel";
import { runProgress } from "../surfaces/progress/run-progress";
import type { ProgressError, ProgressVariant } from "../surfaces/progress/state";
import { useProgressRun, type ProgressRunOptions } from "../surfaces/progress/use-progress-run";

export * from "../surfaces/progress";

export interface ProgressHostHandle {
  start(): void;
  handle(event: ProgressEvent): void;
  finish(status: RunStatus, result?: Record<string, unknown>): void;
  blocked(error?: ProgressError): void;
  close(): void;
  error(): ProgressError | null;
  /** Footer actions. The React answer to the vanilla `showFoot(node)`. */
  setFoot(foot: ReactNode): void;
  setVariant(variant: ProgressVariant): void;
  unmount(): void;
}

function Host({
  handleRef,
  options,
  variant: initialVariant,
}: {
  handleRef: RefObject<Omit<ProgressHostHandle, "unmount"> | null>;
  options: ProgressRunOptions;
  variant: ProgressVariant;
}) {
  const [variant, setVariant] = useState<ProgressVariant>(initialVariant);
  const [foot, setFoot] = useState<ReactNode>(null);
  const run = useProgressRun(options);

  // Every method below is stable across renders (useProgressRun keeps its
  // callbacks behind refs), so the bridge does not churn as events stream in.
  useImperativeHandle(
    handleRef,
    () => ({
      start: run.start,
      handle: run.handle,
      finish: run.finish,
      blocked: run.blocked,
      close: run.close,
      error: run.error,
      setFoot,
      setVariant,
    }),
    [run.start, run.handle, run.finish, run.blocked, run.close, run.error],
  );

  return <ProgressPanel run={run} variant={variant} foot={foot} />;
}

export interface MountProgressOptions extends ProgressRunOptions {
  variant?: ProgressVariant;
}

/**
 * Render a panel into a plain DOM container and return an imperative handle.
 *
 * `flushSync` is what makes the handle usable on the next line: `createRoot().render()`
 * is normally deferred, and a caller that mounts and immediately calls `start()`
 * would otherwise be talking to a null ref.
 */
export function mountProgressPanel(
  container: Element,
  options: MountProgressOptions = {},
): ProgressHostHandle {
  const { variant = "floating", ...runOptions } = options;
  const handleRef: RefObject<Omit<ProgressHostHandle, "unmount"> | null> = { current: null };
  let root: Root | null = createRoot(container);

  flushSync(() => {
    root?.render(<Host handleRef={handleRef} options={runOptions} variant={variant} />);
  });

  // An imperative caller expects the DOM to have caught up by the time the call
  // returns — that is what `panel.start(); panel.handle(…)` meant in the vanilla
  // panel, and what a capture script or a hand-driven check relies on. React
  // state updates are deferred by default, so every mutating call is flushed.
  // (React hosts do not go through this door and keep normal batching.)
  const bound = <T extends unknown[], R>(
    pick: (h: Omit<ProgressHostHandle, "unmount">) => (...args: T) => R,
    flush = true,
  ) =>
    (...args: T): R => {
      const current = handleRef.current;
      if (!current) throw new Error("codeStory: the progress panel is not mounted.");
      if (!flush) return pick(current)(...args);
      let out!: R;
      flushSync(() => {
        out = pick(current)(...args);
      });
      return out;
    };

  return {
    start: bound((h) => h.start),
    handle: bound((h) => h.handle),
    finish: bound((h) => h.finish),
    blocked: bound((h) => h.blocked),
    close: bound((h) => h.close),
    error: bound((h) => h.error, false),
    setFoot: bound((h) => h.setFoot),
    setVariant: bound((h) => h.setVariant),
    unmount() {
      const current = root;
      root = null;
      handleRef.current = null;
      // Deferred: unmounting inside a React event or effect throws.
      if (current) queueMicrotask(() => current.unmount());
    },
  };
}

declare global {
  interface Window {
    codeStoryProgress?: {
      mount: typeof mountProgressPanel;
      runProgress: typeof runProgress;
    };
  }
}

if (typeof window !== "undefined") {
  window.codeStoryProgress = { mount: mountProgressPanel, runProgress };
}
