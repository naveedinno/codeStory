// The recents stack: one card per remembered repository, plus the "unavailable
// repositories" disclosure and the no-repositories-yet empty state.
//
// Two details that look cosmetic and are not:
//
//   - Ordinals are continuous across the split. Available repos are 01..N and
//     the collapsed missing group picks up at N+1, so the numbering describes
//     one list even though it renders as two.
//   - Removal is per-row, not delegated. The vanilla code carries an explicit
//     regression note about this: a single delegated `click` handler reading
//     `e.target.closest('button[data-remove-repo]')` broke on WebKit, where the
//     event target can be the button's nested <svg>. React's synthetic events
//     are delegated at the root but resolve to the element that carries the
//     handler, so putting `onClick` on the button is the fixed behaviour, not
//     the broken one — provided the handler lives on the <button> and not on an
//     ancestor row.
//
// The only status pill that exists is `Missing`. Tour status was removed on
// purpose ("an internal concept that confused users"); do not put it back.
//
// ── beUI adoption notes ──────────────────────────────────────────────────────
//
// The theme bridge maps Signal's palette onto Tailwind, but it does NOT define
// the shadcn variable names beUI reaches for (`foreground`, `background`,
// `card`, `primary`, `destructive`, `muted`, `ring`). Those utilities compile to
// nothing, so every colour a vendored component wants has to be supplied here —
// including focus indication, because several of them also set `outline-none`.
//
//   - `Button` drives press feedback from Motion's spring rather than a CSS
//     `active:scale`, and gates it on `useReducedMotion()` internally, which is
//     what plans 010/011 asked for. Its `SIZE_CLASS` pins a height on every
//     variant, so each call site passes `h-auto`. The full-width card also
//     passes `whileHover={undefined}`: a 2% lift on a wide surface reads as a
//     lurch, for the same reason plan 011 rejected a 3% dip there.
//   - `ContextMenu` hangs off the row wrapper `<div>`, never off the card
//     button. `ContextMenuTrigger` clones `aria-haspopup="menu"` and
//     `aria-expanded` onto its child; on the card button those would announce a
//     menu button, which is a lie — activating it opens the repository. Neither
//     attribute is global ARIA, so on a plain `<div>` they are ignored, while
//     `contextmenu`, touch long-press and Shift+F10 still reach the handler by
//     bubbling up from whichever control in the row has focus.
//   - The unavailable-repos disclosure is a native `<details>`, not
//     `BouncyAccordion`: a bounce on a frequent control is noise, and `<summary>`
//     gives keyboard, screen-reader, and find-in-page behaviour for free.
//     (Pairing note for the recheck: FileSummary's generated-output disclosure
//     is the same pattern — plan 016 lands it there.)
//   - `useQuietSubtree` covers the whole stack because `Loader` bakes in
//     `role="status"`. A spinner that announces itself once per removed row is
//     noise on top of the picker's real status paragraph, which lives in
//     `PickerApp` and is deliberately left alone.

import { Fragment, useRef, type ReactNode } from "react";
import { ChevronRight, Folder, GitBranch, Trash2 } from "lucide-react";
import { AnimatedBadge } from "../../vendor/beui/motion/animated-badge";
import { Button } from "../../vendor/beui/motion/button/base";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../vendor/beui/motion/context-menu";
import { Loader } from "../../vendor/beui/motion/loader";
import { Tooltip } from "../../vendor/beui/motion/tooltip";
import type { RecentRow } from "../../../src/payloads";
import { cn } from "../../shared/cn";
import { useQuietSubtree } from "../../shared/quiet";
import { plural, prettyPath, relativeTime } from "./format";

/** Signal colours for the portalled tooltip bubble, which has none of its own. */
export const TOOLTIP_SURFACE =
  "max-w-[min(90vw,560px)] rounded-[var(--radius-sm)] border-line bg-surface-3 px-2.5 py-1 text-sm font-medium break-all whitespace-normal text-text shadow-[var(--shadow)]";

/** Menu rows are focused programmatically, so `:focus` — not `:focus-visible`. */
const MENU_ITEM = "focus:bg-fill-2 focus:outline-none";

interface RowProps {
  row: RecentRow;
  /** Zero-based position in the combined list; rendered as a 2-digit ordinal. */
  index: number;
  home: string;
  now: number;
  busy: boolean;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

function RepoRow({ row, index, home, now, busy, onOpen, onRemove }: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // ContextMenu restores focus to its trigger on Escape, and this trigger is a
  // <div> — `.focus()` on a non-focusable element is a silent no-op, so a
  // keyboard user who opened the menu with Shift+F10 was landing on <body>.
  // Verified in Chrome; the same class of bug as the sheet's onOpen focus.
  // Captured only when focus was inside the row, so a right-click with the
  // mouse (activeElement === body) does not yank focus anywhere on close.
  const restore = useRef<HTMLElement | null>(null);
  const onMenuOpenChange = (open: boolean) => {
    const active = document.activeElement as HTMLElement | null;
    if (open) restore.current = active && rowRef.current?.contains(active) ? active : null;
    else {
      // Only when the menu still owns focus. Closing because the user clicked
      // something else must not drag focus back onto the row.
      if (active?.closest("[data-context-menu-portal]")) restore.current?.focus?.();
      restore.current = null;
    }
  };

  // Branch · N changed files · relative time, with the dot separators dropped
  // for whatever is absent. A repo whose folder is gone shows only the time.
  const meta: ReactNode[] = [];
  if (row.isGit && row.currentBranch) {
    meta.push(
      <span key="branch" className="inline-flex items-center gap-1">
        <GitBranch className="h-[13px] w-[13px] opacity-80" strokeWidth={1.8} />
        {row.currentBranch}
      </span>,
    );
  }
  if (row.isGit && row.changedFiles > 0) {
    meta.push(<span key="changed">{`${row.changedFiles} changed ${plural(row.changedFiles, "file", "files")}`}</span>);
  }
  meta.push(<span key="time">{relativeTime(row.lastOpened, now)}</span>);

  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger>
        <div
          ref={rowRef}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_44px] items-stretch gap-2",
            "max-[480px]:relative max-[480px]:block",
            !row.isGit && "opacity-[.68]",
          )}
        >
          {/* `data-repo-card` is the UI-atlas evidence selector for this surface —
              a capture only counts as coverage if it can find a real row. */}
          {/* `variant="ghost"` is load-bearing, not cosmetic. The default
              variant is `primary`, whose class pair is
              `bg-primary text-primary-foreground`. `bg-surface-2` below
              out-merges the background — same tailwind-merge key — but nothing
              here sets a text colour, so `text-primary-foreground`
              (= --on-accent) survived and painted the repo name #fff on a
              #eef1f5 card in light theme: 1.06:1, unreadable. Ghost carries no
              background and a muted foreground, both of which the classes below
              legitimately override. */}
          <Button
            type="button"
            variant="ghost"
            data-repo-card
            pressScale={0.98}
            whileHover={undefined}
            onClick={() => onOpen(row.path)}
            className={cn(
              "flex h-auto w-full items-center gap-[13px] rounded-[var(--radius-island)] border border-transparent bg-surface-2 px-4 py-3.5 text-start text-text",
              "transition-[background-color,border-color] duration-[var(--motion-duration-fast)] ease-out",
              "hover:border-line hover:bg-fill-1",
              "contrast-more:border-text",
              "max-[480px]:pe-[54px]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "w-5 flex-none text-right font-mono text-xs font-semibold tracking-[-.01em] max-[480px]:hidden",
                row.isGit ? "text-[var(--numeral)]" : "text-[var(--text-3)]",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "grid h-[38px] w-[38px] flex-none place-items-center rounded-[var(--radius-lg)]",
                row.isGit ? "bg-accent-soft text-accent" : "bg-fill-3 text-text-2",
              )}
            >
              <Folder className="h-5 w-5" strokeWidth={1.7} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="flex items-center gap-2">
                {/* Same hover-to-reveal contract as the path below: the name
                    truncates, so the full string lives in the tooltip. */}
                <Tooltip
                  content={row.name}
                  side="bottom"
                  delay={350}
                  className={TOOLTIP_SURFACE}
                  wrapperClassName="min-w-0 max-w-full"
                >
                  <span className="block min-w-0 truncate text-lg font-semibold tracking-[-.012em]">
                    {row.name}
                  </span>
                </Tooltip>
                {row.isGit ? null : (
                  <AnimatedBadge
                    status="danger"
                    size="sm"
                    showIcon={false}
                    className="h-auto flex-none rounded-[var(--radius-sm)] border-0 bg-del-soft px-2 py-0.5 text-[11px] font-semibold text-diff-del-text"
                  >
                    Missing
                  </AnimatedBadge>
                )}
              </span>
              {/* The `title` this replaces was never in the accessibility tree:
                  the card's name comes from its text content, so the full path
                  was always a hover-only affordance. It still is — just legible,
                  and without the second-long native delay. */}
              <Tooltip
                content={row.path}
                side="bottom"
                delay={350}
                className={TOOLTIP_SURFACE}
                wrapperClassName="min-w-0 max-w-full"
              >
                <span className="block min-w-0 truncate font-mono text-xs text-text-2">
                  {prettyPath(row.path, home)}
                </span>
              </Tooltip>
              <span className="mt-px flex flex-wrap items-center gap-[7px] font-mono text-[11px] text-text-2">
                {meta.map((node, i) => (
                  <Fragment key={i}>
                    {i > 0 ? (
                      <span className="text-text-3 opacity-60" aria-hidden="true">
                        ·
                      </span>
                    ) : null}
                    {node}
                  </Fragment>
                ))}
              </span>
            </span>
            <span className="flex flex-none text-text-3 opacity-55" aria-hidden="true">
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </span>
          </Button>

          {/* The tooltip's anchor span becomes the 44px grid cell, so the compact
              overlay geometry moves onto it — the button keeps its own size and
              hit-slop, which is what ≤480px is TEST-LOCKED on. */}
          <Tooltip
            content="Remove from recent repositories"
            side="left"
            className={TOOLTIP_SURFACE}
            wrapperClassName="w-11 items-stretch max-[480px]:absolute max-[480px]:top-3 max-[480px]:end-3 max-[480px]:z-[2] max-[480px]:w-[34px]"
          >
            <Button
              type="button"
              size="icon"
              pressScale={0.97}
              disabled={busy}
              aria-busy={busy || undefined}
              aria-label={`Remove ${row.name} from recent repositories`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove(row.path);
              }}
              className={cn(
                "relative flex h-auto w-full items-center justify-center rounded-[var(--radius-island)] border border-transparent bg-transparent text-text-3",
                "transition-colors duration-[var(--motion-duration-fast)] hover:bg-del-soft hover:text-danger-text disabled:opacity-55",
                "contrast-more:border-text",
                // Compact layout: the control overlays the card's reserved right
                // gutter, with a -5px inset hit-slop so it stays thumb-sized.
                "max-[480px]:h-[34px] max-[480px]:w-[34px]",
                "max-[480px]:after:absolute max-[480px]:after:-inset-[5px] max-[480px]:after:content-['']",
              )}
            >
              {busy ? (
                <Loader variant="spinner" size={15} label="" />
              ) : (
                <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.9} />
              )}
            </Button>
          </Tooltip>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        ariaLabel={`Actions for ${row.name}`}
        className="min-w-52 rounded-[var(--radius-lg)] border-line bg-surface-3 p-1.5 shadow-[var(--shadow)]"
      >
        <ContextMenuItem className={cn(MENU_ITEM, "text-text")} onSelect={() => onOpen(row.path)}>
          Open repository
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy}
          className={cn(MENU_ITEM, "text-danger-text focus:bg-del-soft")}
          onSelect={() => onRemove(row.path)}
        >
          Remove from recent repositories
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EmptyRecents() {
  return (
    <div
      data-recents-empty
      className="rounded-[var(--radius-island)] border border-dashed border-line px-5 py-10 text-center text-text-2"
    >
      <span className="mb-3.5 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[var(--radius-island)] bg-fill-1 text-text-3">
        <Folder className="h-5 w-5" strokeWidth={1.7} />
      </span>
      <p className="m-0 mb-1.5 font-display text-xl font-bold tracking-[-.02em] text-text">No repositories yet</p>
      <p className="m-0 mx-auto max-w-[42ch] text-[12.5px] leading-[1.55]">
        Point codeStory at any local Git repository — it reads the working tree directly, nothing is uploaded.
      </p>
    </div>
  );
}

export interface RecentReposProps {
  recents: RecentRow[];
  home: string;
  now: number;
  removing: string | null;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

export function RecentRepos({ recents, home, now, removing, onOpen, onRemove }: RecentReposProps) {
  const root = useRef<HTMLDivElement>(null);
  useQuietSubtree(root);

  const available = recents.filter((row) => row.isGit);
  const missing = recents.filter((row) => !row.isGit);

  const rowFor = (row: RecentRow, index: number) => (
    <RepoRow
      key={row.path}
      row={row}
      index={index}
      home={home}
      now={now}
      busy={removing === row.path}
      onOpen={onOpen}
      onRemove={onRemove}
    />
  );

  // `grid gap-2` rather than `space-y-2`: ContextMenu wraps every row in a
  // `display:contents` provider, and a margin on a box that generates no box is
  // dropped. Grid gaps belong to the container, so they survive it.
  //
  // The explicit `minmax(0,1fr)` is not decoration. An implicit `auto` track is
  // floored at the item's min-content width, and below 480px a row's min-content
  // exceeds the 358px viewport — the track grew, the row overflowed, and the
  // remove control (absolutely positioned at the row's right edge) went off
  // screen entirely. Caught by the UI atlas, not by any DOM assertion.
  return (
    <div ref={root} className={recents.length ? "grid grid-cols-[minmax(0,1fr)] gap-2" : undefined}>
      {recents.length ? null : <EmptyRecents />}
      {available.map((row, i) => rowFor(row, i))}
      {missing.length ? (
        <details className="group mt-3 border-t border-line-soft pt-2">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-2 px-[3px] py-2 text-xs font-semibold text-text-3",
              // `list-none` drops the marker in Firefox; WebKit needs the
              // pseudo-element.
              "[&::-webkit-details-marker]:hidden",
              "focus-visible:shadow-[var(--shadow-focus)]",
            )}
          >
            <ChevronRight
              className="h-3.5 w-3.5 text-text-3 transition-transform duration-[var(--motion-duration-fast)] group-open:rotate-90 motion-reduce:transition-none"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span>
              {missing.length} unavailable {plural(missing.length, "repository", "repositories")}
            </span>
          </summary>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-0.5">
            {missing.map((row, i) => rowFor(row, available.length + i))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
