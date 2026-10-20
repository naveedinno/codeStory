// The persistent top bar for codeStory's front-door screens.
//
// A React port of `navBar()` / `navStyles()` in `src/nav.ts`, shared by the
// change/scope page and review history (the repo picker has never used it — it
// carries its own hero instead). Everything the vanilla bar guaranteed is
// guaranteed here:
//
//   - the wordmark always goes home, with `title="Home — your repositories"`
//     and `aria-label="Home — your repositories"`;
//   - the crumbs live inside `<nav aria-label="Breadcrumb">`, separated by
//     `aria-hidden` slashes, and the last one (or any without an `href`) is a
//     `<span aria-current="page">` rather than a link;
//   - the theme control sits between the crumbs and the page's own actions;
//   - below 560px the wordmark disappears and the mark stands alone.
//
// The `.nv-*` CSS became utilities rather than a second stylesheet — the only
// thing `navStyles()` did that a utility cannot is nothing, once the `--nv-*`
// aliases are inlined back onto the canonical tokens they aliased. Surfaces
// that put actions in the `right` slot should style them with
// {@link navActionClass} / {@link navPrimaryClass} so every bar's buttons stay
// the same shape.

import type { ReactNode } from "react";
import { Tooltip } from "../vendor/beui/motion/tooltip";
import { BrandMark } from "./brand";
import { cn } from "./cn";
import { EditorMenu } from "./editor-menu";
import { ThemeMenu } from "./theme-menu";

/** Signal colours for the portalled tooltip bubble, which has none of its own. */
const TOOLTIP_SURFACE =
  "max-w-[min(90vw,52ch)] rounded-[var(--radius-sm)] border-line-soft bg-surface-3 px-2.5 py-1 text-sm font-medium break-all whitespace-normal text-text shadow-[var(--shadow)]";

export interface Crumb {
  label: string;
  /** Omit on the current location; it renders as text, not a link. */
  href?: string;
}

/** Shared shape for a tonal action in the bar's `right` slot (`.nv-act`). */
const NAV_ACTION_BASE =
  "inline-flex flex-none items-center gap-1.5 h-[var(--control-h)] px-3.5 rounded-full text-md font-semibold tracking-[-.01em] whitespace-nowrap no-underline cursor-pointer border border-transparent " +
  "transition-[background-color,transform,box-shadow] duration-[var(--motion-duration-press)] ease-out " +
  "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] " +
  "motion-reduce:transition-none motion-reduce:active:transform-none contrast-more:border-text";

export const navActionClass = cn(
  NAV_ACTION_BASE,
  "text-text bg-fill-2 hover:bg-fill-3 active:scale-[.97] max-[560px]:px-2.5",
);

export const navPrimaryClass = cn(
  NAV_ACTION_BASE,
  "text-on-accent bg-accent hover:bg-accent-solid-hover active:scale-[.97] max-[560px]:px-2.5",
);

export interface NavProps {
  /** Where the wordmark points. Defaults to the repository picker. */
  home?: string;
  crumbs?: Crumb[];
  /** Page-specific actions, rendered after the theme control. */
  right?: ReactNode;
}

/** First-focus escape hatch for pages whose persistent chrome precedes content. */
export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "fixed start-3 top-3 z-[200] -translate-y-[calc(100%+24px)] rounded-full bg-accent px-4 py-2.5",
        "text-base font-semibold text-on-accent no-underline",
        "focus-visible:translate-y-0 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        "contrast-more:border contrast-more:border-text",
      )}
    >
      Skip to content
    </a>
  );
}

export function Nav({ home = "/repos", crumbs = [], right }: NavProps) {
  return (
    <header
      className={cn(
        "sticky top-2.5 z-30 mx-3 mt-2.5 flex h-[50px] items-center gap-3 px-4",
        "rounded-[var(--radius-island)] border border-line-soft bg-surface",
        "max-[560px]:top-2 max-[560px]:mx-2 max-[560px]:mt-2 max-[760px]:h-auto max-[760px]:min-h-[50px] max-[760px]:flex-wrap max-[560px]:gap-2 max-[560px]:px-3 max-[760px]:py-2",
        "contrast-more:border-text",
      )}
    >
      <SkipLink />

      <a
        href={home}
        title="Home — your repositories"
        aria-label="Home — your repositories"
        className={cn(
          "-ms-[7px] inline-flex flex-none items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-text no-underline",
          "transition-[background-color,transform,box-shadow] duration-[var(--motion-duration-press)] ease-out",
          "hover:bg-fill-2 active:scale-[.98]",
          "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
          "motion-reduce:transition-none motion-reduce:active:transform-none",
        )}
      >
        <BrandMark
          className="block [--ds-brand-node-a:var(--text)] [--ds-brand-node-b:var(--accent-hi)] [--ds-brand-node-c:var(--text)] [--ds-brand-path:var(--accent)]"
          size={22}
        />
        <span className="text-lg tracking-[-.01em] max-[560px]:hidden">
          <span className="font-medium text-text-2">code</span>
          <span className="font-semibold text-text">Story</span>
        </span>
      </a>

      {crumbs.length ? (
        <>
          <span className="h-5 w-px flex-none bg-line" aria-hidden="true" />
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              const shape =
                "block min-w-0 max-w-[42ch] truncate rounded-[var(--radius-sm)] px-1.5 py-1 text-base whitespace-nowrap";
              return (
                <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? (
                    <span className="flex-none text-base text-text-3 opacity-70" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  {crumb.href && !last ? (
                    <Tooltip
                      content={crumb.label}
                      side="bottom"
                      delay={350}
                      className={TOOLTIP_SURFACE}
                      wrapperClassName="min-w-0 max-w-full"
                    >
                      <a
                        href={crumb.href}
                        className={cn(
                          shape,
                          "text-accent-text no-underline hover:bg-fill-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
                        )}
                      >
                        {crumb.label}
                      </a>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      content={crumb.label}
                      side="bottom"
                      delay={350}
                      className={TOOLTIP_SURFACE}
                      wrapperClassName="min-w-0 max-w-full"
                    >
                      <span
                        className={cn(shape, "cursor-default font-semibold text-text focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]")}
                        aria-current="page"
                        tabIndex={0}
                      >
                        {crumb.label}
                      </span>
                    </Tooltip>
                  )}
                </span>
              );
            })}
          </nav>
        </>
      ) : null}

      {!crumbs.length ? <span className="min-w-0 flex-1" /> : null}
      <EditorMenu />
      <ThemeMenu />
      {right}
    </header>
  );
}
