// codeStory-local replacement for `next-themes`.
//
// Not vendored from starc007/ui-components — written for this repo so the beUI
// components that expect a `useTheme()` hook keep working without pulling in
// Next.js. The contract below mirrors `src/theme.ts` exactly, which is the
// canonical theme owner:
//
//   localStorage `ds-theme`  -> "light" | "dark", absent means "system"
//   <html data-theme>        -> resolved "light" | "dark"
//   <html data-theme-mode>   -> "system" | "light" | "dark"
//   html.style.colorScheme   -> resolved value
//   meta[data-ds-theme-color]-> #0a0c0f (dark) / #edf0f4 (light)
//   document event `ds-theme-change` -> detail { theme, mode }
//
// The inline bootstrap script in `src/theme.ts` runs before first paint and
// owns the initial write; this hook reads what it wrote and performs the same
// writes on change, so the vanilla surfaces and the React surfaces stay in
// sync (including across tabs, via the `storage` listener that script installs).

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ds-theme";
const THEME_CHANGE_EVENT = "ds-theme-change";
const DARK_THEME_COLOR = "#0a0c0f";
const LIGHT_THEME_COLOR = "#edf0f4";

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function readSystemTheme(): ResolvedTheme {
  return darkMediaQuery()?.matches ? "dark" : "light";
}

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? readSystemTheme() : mode;
}

/** Writes the resolved theme onto <html> the same way `src/theme.ts` does. */
function applyMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const value = resolve(mode);
  const root = document.documentElement;
  const previous = root.getAttribute("data-theme");
  root.setAttribute("data-theme", value);
  root.setAttribute("data-theme-mode", mode);
  root.style.colorScheme = value;
  const meta = document.querySelector("meta[data-ds-theme-color]");
  if (meta) {
    meta.setAttribute(
      "content",
      value === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
    );
  }
  if (previous !== value && typeof CustomEvent === "function") {
    document.dispatchEvent(
      new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: value, mode } }),
    );
  }
}

export interface UseThemeResult {
  /** The chosen mode, including "system". Matches next-themes' `theme`. */
  theme: ThemeMode;
  /** The concrete theme in effect. Matches next-themes' `resolvedTheme`. */
  resolvedTheme: ResolvedTheme;
  /** The OS preference, regardless of the chosen mode. */
  systemTheme: ResolvedTheme;
  setTheme: (next: ThemeMode) => void;
}

/**
 * Drop-in stand-in for `next-themes`' `useTheme()`, backed by codeStory's own
 * `data-theme` plumbing. Returns "light" before hydration on the server; the
 * pre-paint bootstrap script means the first client render already sees the
 * real value, so there is no flash to guard against.
 */
export function useTheme(): UseThemeResult {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);

  // Follow the OS preference and any write made by the vanilla control or
  // another tab, so both theme owners can coexist on one page.
  useEffect(() => {
    const media = darkMediaQuery();
    const syncSystem = () => setSystemTheme(readSystemTheme());
    const syncMode = () => {
      setMode(readMode());
      syncSystem();
    };
    media?.addEventListener?.("change", syncSystem);
    document.addEventListener(THEME_CHANGE_EVENT, syncMode);
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) syncMode();
    });
    return () => {
      media?.removeEventListener?.("change", syncSystem);
      document.removeEventListener(THEME_CHANGE_EVENT, syncMode);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / disabled storage: the attribute write still lands.
    }
    setMode(next);
    applyMode(next);
  }, []);

  return {
    theme: mode,
    resolvedTheme: mode === "system" ? systemTheme : mode,
    systemTheme,
    setTheme,
  };
}
