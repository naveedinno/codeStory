// The three-way colour-theme control: System / Light / Dark.
//
// A faithful React port of `themeControl()` in `src/theme.ts`, not beUI's
// `motion/theme-toggle.tsx`. The vendored toggle is a two-state light↔dark
// switch; codeStory's control is a menu whose third state, System, is stored as
// the *absence* of the `ds-theme` key and follows `prefers-color-scheme` live.
// Swapping in the two-state toggle would silently delete System, so this wraps
// the shared `useTheme()` hook instead (which is where the real storage,
// `data-theme` and `ds-theme-change` plumbing lives).
//
// Behaviour preserved from the vanilla control:
//   - toggle: 34×34 pill, `aria-haspopup="menu"`, `aria-expanded`, and
//     `aria-label`/`title` = "Color theme: System|Light|Dark".
//   - `::after{inset:-6px}` hit-slop (see `.ds-theme-toggle` in shared.css).
//   - menu: `role="menu"`, three `role="menuitemradio"` buttons with
//     `aria-checked` and a ✓ revealed by the checked state.
//   - opening focuses the currently-checked item.
//   - Escape closes and returns focus to the toggle.
//   - ArrowDown/ArrowUp wrap; Home/End jump to the ends.
//   - a document `mousedown` outside the wrapper closes it.
//   - choosing saves, applies, closes, and returns focus to the toggle.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { useTheme, type ThemeMode } from "./theme";

const MODES: ThemeMode[] = ["system", "light", "dark"];
const LABEL: Record<ThemeMode, string> = { system: "System", light: "Light", dark: "Dark" };

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "system") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="6.25" />
        <path d="M10 3.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.9 12.4A6.7 6.7 0 0 1 7.6 4.1 6.7 6.7 0 1 0 15.9 12.4z" />
    </svg>
  );
}

export function ThemeMenu({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Arrow-open target: set by the toggle key handler, consumed by the open effect.
  const pendingFocus = useRef<number | null>(null);

  const close = useCallback((restoreFocus: boolean) => {
    pendingFocus.current = null;
    setOpen((wasOpen) => {
      if (wasOpen && restoreFocus) toggle.current?.focus();
      return false;
    });
  }, []);

  // Opening focuses the checked item, matching the vanilla control — unless an
  // arrow key on the toggle requested the first or last item instead.
  useEffect(() => {
    if (!open) return;
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (pending !== null) {
      menu.current?.querySelectorAll<HTMLElement>("[data-theme-choice]")?.[pending]?.focus();
      return;
    }
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, theme]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[data-theme-choice]") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const label = `Color theme: ${LABEL[theme]}`;

  // Arrow keys on the toggle open the menu at the first/last item, mirroring
  // onMenuKeyDown's wrap direction. Enter/Space fall through to native click.
  const onToggleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const count = menu.current?.querySelectorAll("[data-theme-choice]").length ?? 0;
    if (!count) return;
    pendingFocus.current = event.key === "ArrowDown" ? 0 : count - 1;
    setOpen(true);
  };

  // A theme flip restyles the whole document; suppress transitions for that one
  // frame so segment tiles, buttons, and tabs cut over instead of smearing.
  const choose = (mode: ThemeMode) => {
    const override = document.createElement("style");
    override.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(override);
    setTheme(mode);
    void document.body.offsetHeight;
    requestAnimationFrame(() => override.remove());
    close(true);
  };

  return (
    <div ref={wrap} className={cn("ds-theme-wrap", className)}>
      <button
        ref={toggle}
        type="button"
        className="ds-theme-toggle"
        data-theme-toggle
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onToggleKeyDown}
      >
        <span>
          <ThemeIcon mode={theme} />
        </span>
      </button>
      <div
        ref={menu}
        className="ds-theme-menu"
        role="menu"
        aria-label="Color theme"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="menuitemradio"
            data-theme-choice={mode}
            aria-checked={theme === mode}
            onClick={() => choose(mode)}
          >
            <span className="ds-theme-choice-icon">
              <ThemeIcon mode={mode} />
            </span>
            <span>{LABEL[mode]}</span>
            <span className="ds-theme-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
