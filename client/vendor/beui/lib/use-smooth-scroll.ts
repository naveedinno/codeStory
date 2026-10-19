// Adapted from starc007/ui-components — components/motion/smooth-scroll.tsx (MIT)
//
// codeStory-local stand-in for that component's `useSmoothScroll()` hook.
// `smooth-scroll.tsx` itself is NOT vendored: it is a `lenis` wrapper, and
// hijacked smooth scrolling is hostile in a diff viewer (README modification 3).
//
// What upstream calls the "no-provider fallback" is the whole of this file: the
// native `scroll` listener that feeds the same three motion values, plus a
// `scrollTo` built on the platform's own smooth behaviour. `scroll-progress`
// and `scroll-to` consume exactly this surface, so they work unchanged; what
// they lose is the lerped Lenis path, which is the point.
//
// Kept API-compatible with upstream minus the `lenis` field, which had no
// consumer in the vendored set.

import { type MotionValue, useMotionValue } from "motion/react";
import { useCallback, useEffect, useMemo } from "react";

export type ScrollTarget = number | string | HTMLElement;

export type ScrollToOptions = {
  offset?: number;
  immediate?: boolean;
  /** Accepted for API compatibility; the native path cannot honour it. */
  duration?: number;
};

export type SmoothScrollApi = {
  /** Current scroll offset in px. */
  scrollY: MotionValue<number>;
  /** Scroll position as 0..1 of the scrollable height. */
  progress: MotionValue<number>;
  /** Signed scroll velocity (px/frame); drives velocity-based effects. */
  velocity: MotionValue<number>;
  /** Programmatic scroll. `immediate` (or reduced motion) jumps instantly. */
  scrollTo: (target: ScrollTarget, options?: ScrollToOptions) => void;
};

function readMetrics() {
  const max = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );
  return { y: window.scrollY, max };
}

function resolveTop(target: ScrollTarget, offset = 0): number {
  if (typeof target === "number") return target + offset;
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return window.scrollY;
  return el.getBoundingClientRect().top + window.scrollY + offset;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Page scroll state as motion values, read from the native scroll position.
 * Upstream returns the provider's Lenis-driven values when one is mounted; here
 * there is only the native path, so every caller gets the same thing.
 */
export function useSmoothScroll(): SmoothScrollApi {
  const scrollY = useMotionValue(0);
  const progress = useMotionValue(0);
  const velocity = useMotionValue(0);

  useEffect(() => {
    let lastY = readMetrics().y;
    let lastT = performance.now();
    const onScroll = () => {
      const { y, max } = readMetrics();
      const now = performance.now();
      const dt = now - lastT || 16;
      scrollY.set(y);
      progress.set(max > 0 ? y / max : 0);
      velocity.set(((y - lastY) / dt) * 16);
      lastY = y;
      lastT = now;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollY, progress, velocity]);

  const scrollTo = useCallback(
    (target: ScrollTarget, options?: ScrollToOptions) => {
      const immediate = options?.immediate || prefersReducedMotion();
      window.scrollTo({
        top: resolveTop(target, options?.offset),
        behavior: immediate ? "auto" : "smooth",
      });
    },
    [],
  );

  return useMemo<SmoothScrollApi>(
    () => ({ scrollY, progress, velocity, scrollTo }),
    [scrollY, progress, velocity, scrollTo],
  );
}
