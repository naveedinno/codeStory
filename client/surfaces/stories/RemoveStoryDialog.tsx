// "Remove <title> from this repo?" — the confirmation in front of a delete.
//
// The vanilla page used `window.confirm()` for this question and
// `window.alert()` for the failure. `surface-inventory.md` §2.7 flags that pair
// as an accessibility gap and names the only two honest replacements: keep the
// native dialogs, or build an accessible one. Deleting optimistically is NOT on
// that list, and a story file is not recoverable from this app.
//
// This is the second option, built on the shared modal choreography the folder
// browser already uses — the same rAF-then-class entrance, the same 210 ms exit
// hold, the same `inert` + `aria-hidden` background, the same focus trap and
// focus restore. Nothing new was invented for it.
//
// Two deliberate departures from the native dialogs, both improvements the
// native ones cannot offer:
//   - focus lands on Cancel, not on the destructive action;
//   - a failed delete reports inside the dialog and leaves it open, instead of
//     an `alert()` that dismisses the context along with itself.
//
// The destructive button is beUI's `StatefulButton`, which is a real
// idle → loading → error machine instead of a ternary on a label: it brings the
// spinner, `aria-busy`, and a label that becomes "Try again" once the delete has
// failed. It is also one of the twenty vendored components that ship a live
// region — an `aria-live="polite"` wrapper around its own label — so it is
// quieted here with `useQuietSubtree`. That is not a formality: this dialog
// already has an assertive announcer for the failure, and leaving the button's
// polite one in place would announce the reason and the button's new label as
// two separate events for the same failure. The error paragraph is passed to
// `keep`, which is exactly the case that option exists for.

import { useEffect, useRef } from "react";
import { Button } from "../../vendor/beui/motion/button/base";
import { StatefulButton } from "../../vendor/beui/motion/button/stateful";
import { cn } from "../../shared/cn";
import { useQuietSubtree } from "../../shared/quiet";
import { useModalChoreography } from "../../shared/use-modal";

export interface RemoveStoryDialogProps {
  /** The story queued for removal, or null when nothing is queued. */
  target: { id: string; title: string } | null;
  /** Page content to inert while the dialog is up. */
  background: React.RefObject<HTMLElement | null>;
  busy: boolean;
  /** Set when the DELETE failed; the dialog stays open and shows it. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemoveStoryDialog({
  target,
  background,
  busy,
  error,
  onConfirm,
  onCancel,
}: RemoveStoryDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const modal = useModalChoreography({ dialog, background, onClose: onCancel, canClose: () => !busy });

  // Strips the live region StatefulButton bakes into its label wrapper, after
  // every render, before paint. `keep` spares this dialog's own announcer —
  // the one node in here that is supposed to speak.
  useQuietSubtree(dialog, { keep: "[data-remove-error]" });

  // Focus waits for `is-shown`, and this is not a nicety. Between the "opening"
  // phase and the rAF that adds the class, `.ds-scrim` is still
  // `visibility: hidden` — and `focus()` on a `visibility: hidden` element is a
  // silent no-op, so focusing from `onOpen` leaves focus on <body> and the
  // reviewer has to Tab their way into a destructive dialog. `modal.shown` is
  // true only in the commit that adds the class, and this passive effect runs
  // after that commit has hit the DOM.
  useEffect(() => {
    if (modal.shown) cancel.current?.focus();
  }, [modal.shown]);

  // While busy both buttons disable, which would drop focus to the body
  // inside a still-trapped dialog. Move focus to the dialog itself instead.
  useEffect(() => {
    if (busy) dialog.current?.focus();
  }, [busy]);

  // The queued target is the single source of truth for "is this open"; the
  // choreography is driven from it rather than the other way round, so a
  // dismissal from anywhere (Escape, scrim, Cancel) takes the same path.
  const { open, close } = modal;
  useEffect(() => {
    if (target) open();
    else close();
  }, [target, open, close]);

  // Keep the last target on screen through the 210 ms exit, or the sheet
  // renders an empty question while it fades.
  const shown = useRef(target);
  if (target) shown.current = target;
  const story = target ?? shown.current;

  return (
    <div
      className={cn("ds-scrim", modal.shown && "is-shown")}
      hidden={!modal.mounted}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-story-title"
        aria-describedby="remove-story-body"
        tabIndex={-1}
        className={cn(
          "ds-sheet w-[min(420px,100%)] rounded-[var(--radius-island)] border border-line-soft bg-surface-3 p-5",
          "shadow-signal outline-none contrast-more:border-text",
        )}
      >
        <h2
          id="remove-story-title"
          className="m-0 font-display text-lg leading-[1.15] font-semibold tracking-[-.012em]"
        >
          Remove this story?
        </h2>
        <p id="remove-story-body" className="mt-2 mb-0 text-base leading-[1.45] text-text-2">
          Remove “{story?.title ?? ""}” from this repo? The story file is deleted; the code and any
          comments you left stay where they are.
        </p>

        {/* Assertive, because it answers an action the reviewer just took and
            the buttons below it have already come back to life. */}
        <p
          data-remove-error
          className={cn("mt-3 mb-0 text-md leading-[1.45] text-danger-text", !error && "hidden")}
          role="alert"
        >
          {error ?? ""}
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <Button
            ref={cancel}
            type="button"
            pressScale={0.97}
            disabled={busy}
            onClick={onCancel}
            className="h-[var(--control-h)] rounded-full bg-fill-2 px-4 text-md font-semibold text-text hover:bg-fill-3 disabled:opacity-55"
          >
            Cancel
          </Button>
          <StatefulButton
            type="button"
            state={busy ? "loading" : error ? "error" : "idle"}
            loadingText="Removing…"
            // The dialog stays open on failure and the reason is already on
            // screen above; what the button owes the reviewer is the next move.
            errorText="Try again"
            pressScale={0.97}
            disabled={busy}
            onClick={onConfirm}
            className="h-[var(--control-h)] rounded-full bg-del-soft px-4 text-md font-semibold text-danger-text hover:bg-del-soft hover:text-danger-text disabled:opacity-55"
          >
            Remove story
          </StatefulButton>
        </div>
      </div>
    </div>
  );
}
