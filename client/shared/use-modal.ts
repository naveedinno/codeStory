// The modal open/close choreography, preserved verbatim from the vanilla
// picker's `openModal` / `closeModal` / `trapModalFocus`.
//
// `surface-inventory.md` ranks this #5 in "At risk", and the specific warning is
// worth restating because it describes exactly what a stock <Dialog> would do:
//
//   "A React port using a library's <Dialog> will get the a11y right and quietly
//    change the timing — and probably lose the tabindex!=='-1' filter that keeps
//    listbox options out of the tab ring."
//
// So this is not a dialog library. It is a four-state machine over the same DOM
// the vanilla code drove, with the same four load-bearing details:
//
//   1. `requestAnimationFrame` between un-hiding and adding `.is-shown`.
//      `hidden` is `display:none`; adding the class in the same frame gives the
//      browser no "before" style to transition from, and the sheet snaps in.
//   2. A 340 ms close timer (0 ms under `prefers-reduced-motion: reduce`) before
//      re-applying `hidden`, so the exit transition is not cut off mid-flight —
//      and the timer only hides if the modal was not reopened meanwhile.
//   3. Re-entrancy guards on both entry points, keyed on "is a close in
//      flight": open() bails when already open and not closing; close() bails
//      when already closed or already closing.
//   4. `inert` AND `aria-hidden="true"` together on the background element.
//      `inert` alone leaves the content in the accessibility tree on browsers
//      that support it partially; `aria-hidden` alone leaves it focusable.
//
// The focus trap is the vanilla `modalFocusables()` selector, including the
// `tabindex !== '-1'` filter. The folder listbox renders its options as
// `tabIndex={-1}` `role="option"` elements driven by `aria-activedescendant`;
// they must stay out of the Tab ring or Tab walks the folder list instead of the
// dialog's controls.

import { useCallback, useEffect, useRef, useState } from "react";

export type ModalPhase = "closed" | "opening" | "open" | "closing";

/** Matches `--motion-duration-spatial`: the sheet's exit budget. */
export const MODAL_CLOSE_MS = 340;

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';

/**
 * The vanilla `modalFocusables()`, plus one repair.
 *
 * The `tabindex !== '-1'` filter is redundant with the selector for elements
 * that carry the attribute, but not for `<button tabindex="-1">`, which the
 * `button:not([disabled])` arm matches first. That is precisely the folder-list
 * option case, so the filter stays.
 *
 * The repair: the vanilla selector expressed "skip disabled controls" as
 * `button:not([disabled])`, which is enough only while nothing puts a
 * `tabindex` on a disabled button. beUI's `Button` is a `motion.button`, and
 * Motion's press gesture stamps `tabindex="0"` on it — so a disabled button
 * comes back in through the `[tabindex]:not([tabindex="-1"])` arm and lands at
 * the END of the list. The trap then never recognises the real last element,
 * Tab falls out of the dialog, and (because the background is `inert`) focus
 * escapes to the document body. Checking the `disabled` property restores the
 * set the vanilla selector was describing.
 */
export function modalFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) =>
      !node.hidden &&
      !(node as HTMLButtonElement | HTMLInputElement).disabled &&
      node.getAttribute("aria-hidden") !== "true" &&
      node.getAttribute("tabindex") !== "-1",
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface ModalChoreographyOptions {
  /** The scrim/dialog root. Gets `hidden` and the `.is-shown` class. */
  dialog: React.RefObject<HTMLElement | null>;
  /** Page content behind the modal. Gets `inert` + `aria-hidden` while it is up. */
  background: React.RefObject<HTMLElement | null>;
  /**
   * Runs synchronously after the dialog is un-hidden and the background is
   * inerted, before the rAF that starts the transition. This is where the
   * vanilla code focused the search field and kicked off `browse(null)`.
   */
  onOpen?: () => void;
  /** Runs synchronously when closing starts, before focus is restored. */
  onClose?: () => void;
  /** Return false while an operation must finish before the dialog can close. */
  canClose?: () => boolean;
}

export interface ModalChoreography {
  phase: ModalPhase;
  /** False only while `phase === 'closed'` — drives the `hidden` attribute. */
  mounted: boolean;
  /** True only while `phase === 'open'` — drives the `.is-shown` class. */
  shown: boolean;
  /** `trigger` is the element focus returns to; defaults to `document.activeElement`. */
  open: (trigger?: HTMLElement | null) => void;
  close: () => void;
}

export function useModalChoreography(options: ModalChoreographyOptions): ModalChoreography {
  const { dialog, background, onOpen, onClose, canClose } = options;
  const [phase, setPhase] = useState<ModalPhase>("closed");
  const trigger = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number>(0);
  const phaseRef = useRef<ModalPhase>("closed");
  phaseRef.current = phase;

  // Keep the callbacks in refs: they close over surface state that changes on
  // every keystroke, and the effects below must not re-run for that.
  const openCb = useRef(onOpen);
  openCb.current = onOpen;
  const closeCb = useRef(onClose);
  closeCb.current = onClose;
  const canCloseCb = useRef(canClose);
  canCloseCb.current = canClose;

  const open = useCallback(
    (from?: HTMLElement | null) => {
      // "bail if already open and not mid-close"
      if (phaseRef.current !== "closed" && phaseRef.current !== "closing") return;
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = 0;
      }
      trigger.current = from ?? (document.activeElement as HTMLElement | null);
      setPhase("opening");
    },
    [],
  );

  const close = useCallback(() => {
    // "bail if already hidden or mid-close"
    if (phaseRef.current === "closed" || phaseRef.current === "closing") return;
    if (canCloseCb.current?.() === false) return;
    setPhase("closing");
  }, []);

  // Opening: un-hidden by the render this effect follows. Inert the background,
  // let the surface focus/load, then start the transition on the next frame.
  useEffect(() => {
    if (phase !== "opening") return;
    dialog.current?.removeAttribute("inert");
    dialog.current?.removeAttribute("aria-hidden");
    const behind = background.current;
    if (behind) {
      behind.setAttribute("inert", "");
      behind.setAttribute("aria-hidden", "true");
    }
    openCb.current?.();
    const frame = requestAnimationFrame(() => {
      setPhase((current) => (current === "opening" ? "open" : current));
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, background, dialog]);

  // Closing: drop the class immediately, hand the page back, restore focus, then
  // hide after the exit transition — unless something reopened us meanwhile.
  useEffect(() => {
    if (phase !== "closing") return;
    const behind = background.current;
    if (behind) {
      behind.removeAttribute("inert");
      behind.removeAttribute("aria-hidden");
    }
    closeCb.current?.();
    const restore = trigger.current;
    trigger.current = null;
    if (restore && document.contains(restore)) {
      restore.focus();
    } else if (behind && document.contains(behind)) {
      // A successful removal can delete its trigger. Return to a stable page
      // target; the closing sheet is about to be hidden and cannot keep focus.
      const hadTabIndex = behind.hasAttribute("tabindex");
      if (!hadTabIndex) behind.setAttribute("tabindex", "-1");
      behind.focus();
      if (!hadTabIndex) behind.removeAttribute("tabindex");
    }
    dialog.current?.setAttribute("inert", "");
    dialog.current?.setAttribute("aria-hidden", "true");
    closeTimer.current = window.setTimeout(
      () => {
        closeTimer.current = 0;
        setPhase((current) => (current === "closing" ? "closed" : current));
      },
      prefersReducedMotion() ? 0 : MODAL_CLOSE_MS,
    );
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = 0;
      }
    };
  }, [phase, background, dialog]);

  // Escape + the Tab/Shift+Tab trap. Bound on `document` for the lifetime of the
  // surface and gated on the phase, exactly as the vanilla listener was bound
  // once and gated on `scrim.hidden`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === "closed" || phaseRef.current === "closing") return;
      const root = dialog.current;
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = modalFocusables(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, close]);

  return { phase, mounted: phase !== "closed", shown: phase === "open", open, close };
}
