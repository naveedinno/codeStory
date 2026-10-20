// The server-backed folder browser.
//
// A browser cannot read an absolute path back out of the OS file dialog, so
// "Add repository" opens this sheet and walks the filesystem through
// `GET /api/fs` instead. It is an ARIA 1.2 combobox: the text field keeps focus
// and owns `aria-activedescendant`, while the list below is a listbox whose
// options are `tabIndex={-1}`.
//
// Four keyboard bindings on the field, all preserved from the vanilla picker:
//
//   ArrowDown / ArrowUp   move the active option, WRAPPING (the change page's
//                         ref picker clamps instead — they are different, on
//                         purpose, and both are inventoried that way)
//   Home / End            first / last option
//   Enter                 activate the active option
//   Escape                close the sheet (preventDefault + stopPropagation, so
//                         the document-level handler does not also fire)
//
// Tab / Shift+Tab are handled one level up by `useModalChoreography`, whose
// focusable filter excludes `tabindex="-1"` — which is exactly what keeps these
// options out of the tab ring.
//
// Activating a row branches on `isGit`: a repository opens (and navigates away),
// anything else descends into it.
//
// ── beUI adoption notes ──────────────────────────────────────────────────────
//
// The sheet itself is NOT a beUI dialog and is not going to become one. The
// surface inventory ranks this choreography at-risk #5, and `use-modal.ts`
// implements the whole of it: a rAF before `.is-shown`, a 340 ms close hold
// (0 ms under reduced motion), re-entrancy guards, `inert` + `aria-hidden` on
// `#pickerMain`, the `tabindex !== "-1"` focus trap, and focus restore to the
// trigger. `bottom-sheet`, `drawer`, `center-morph-modal` and `command-palette`
// each implement roughly one of those six and silently drop the rest.
//
// What is adopted:
//
//   - `Input` for the filter field. Every ARIA attribute rides through its
//     `...rest` spread, so the combobox contract is unchanged; the wrapper
//     supplies the Signal colours and shrinks the 44 px pill to 34 px, and its
//     `data-state="focused"` is what drives the accent border now.
//     The clear control lives in the `rightIcon` slot and is rendered
//     conditionally rather than `hidden`: the slot styles descendant buttons
//     with `[&_button]:grid`, which out-specifies both `[hidden]` and a `hidden`
//     utility, so a hidden-but-present button would have been un-hidden by the
//     component. Not rendering it is also a stronger guarantee than `hidden` —
//     out of the layout, the tab ring and the accessibility tree at once.
//   - `Loader` for the loading row, and `Tooltip` on the icon-only close.
//   - `Button` for the chrome buttons. Options stay plain `<button>`: Motion's
//     press gesture writes `tabindex` onto `motion.button` (see the repair note
//     in `use-modal.ts`), and `tabindex="-1"` on these options is the single
//     thing keeping the folder list out of the dialog's tab ring.
//   - `useQuietSubtree` over the sheet, because `Input` bakes in a `role="alert"`
//     error message and `Loader` a `role="status"`. `keep` spares this surface's
//     one deliberate announcer — the sr-only folder count below the field.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, Search, X } from "lucide-react";
import { Button } from "../../vendor/beui/motion/button/base";
import { Input } from "../../vendor/beui/motion/input";
import { Loader } from "../../vendor/beui/motion/loader";
import { Tooltip } from "../../vendor/beui/motion/tooltip";
import { requestJson } from "../../shared/api";
import { cn } from "../../shared/cn";
import { useQuietSubtree } from "../../shared/quiet";
import { useModalChoreography } from "../../shared/use-modal";
import { TOOLTIP_SURFACE } from "./RecentRepos";
import { plural } from "./format";

interface FsEntry {
  name: string;
  path: string;
  isGit: boolean;
}

interface FsListing {
  path: string;
  parent: string | null;
  isGit: boolean;
  entries: FsEntry[];
}

type View = { kind: "loading" } | { kind: "error" } | { kind: "ready"; listing: FsListing };

const READ_ERROR = "Could not read that folder.";

export interface FolderBrowserHandle {
  /** `trigger` is the element focus returns to when the sheet closes. */
  open: (trigger?: HTMLElement | null) => void;
}

export interface FolderBrowserProps {
  /** The page content to inert while the sheet is up. */
  background: React.RefObject<HTMLElement | null>;
  /** Navigates away; the sheet does not close first. */
  onOpenRepo: (path: string) => void;
}

export const FolderBrowser = forwardRef<FolderBrowserHandle, FolderBrowserProps>(function FolderBrowser(
  { background, onOpenRepo },
  ref,
) {
  const scrim = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<View>({ kind: "loading" });
  const [refetching, setRefetching] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const [showActiveName, setShowActiveName] = useState(false);
  // Set just before a selection change that should also scroll; hover must not.
  const scrollOnSelect = useRef(false);
  // Guards a stale listing from overwriting a newer one when a slow parent
  // directory resolves after a fast child.
  const browseId = useRef(0);
  // Latest view for `browse()`, which keeps a mounted listing on refetch and so
  // must know whether there is one. Same assign-during-render idiom as the
  // modal hook's `openCb` — an idempotent write of derived state.
  const viewRef = useRef(view);
  viewRef.current = view;
  // Last path `browse()` was asked for, so the error branch can retry it.
  const lastPath = useRef<string | null>(null);

  // Strip the live regions the vendored Input and Loader bake in, but keep the
  // one this surface owns — see the adoption note at the top of the file.
  useQuietSubtree(sheet, { keep: ".ds-sr-only" });

  const entries = view.kind === "ready" ? view.listing.entries : [];
  const trimmed = query.trim();

  const filtered = useMemo(() => {
    const needle = trimmed.toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLocaleLowerCase().indexOf(needle) !== -1);
  }, [entries, trimmed]);

  const activeIndex = selected >= 0 && selected < filtered.length ? selected : -1;

  const browse = useCallback((path: string | null) => {
    const id = ++browseId.current;
    lastPath.current = path;
    setQuery("");
    setSelected(-1);
    setShowActiveName(false);
    // A listing already on screen stays mounted at reduced opacity behind a
    // small loading row; the full spinner is only for the first open, when
    // there is nothing to keep.
    if (viewRef.current.kind === "ready") setRefetching(true);
    else setView({ kind: "loading" });
    requestJson<FsListing>("/api/fs" + (path ? "?path=" + encodeURIComponent(path) : ""))
      .then((listing) => {
        if (browseId.current !== id) return;
        setRefetching(false);
        setView({ kind: "ready", listing });
        // Descending replaces every row, so focus has to come back to the field
        // or it lands on a button that no longer exists. Only while the sheet is
        // actually visible — the first `browse(null)` runs before the rAF.
        if (scrim.current?.classList.contains("is-shown")) search.current?.focus();
      })
      .catch(() => {
        if (browseId.current !== id) return;
        setRefetching(false);
        setView({ kind: "error" });
      });
  }, []);

  const modal = useModalChoreography({
    dialog: scrim,
    background,
    onOpen: () => {
      browse(null);
    },
    onClose: () => {
      setQuery("");
      setSelected(-1);
    },
  });

  const openModal = modal.open;
  useImperativeHandle(ref, () => ({ open: openModal }), [openModal]);

  // Focus once the sheet is actually shown, not from `onOpen`. During the
  // opening phase the scrim is still `visibility: hidden`, and focus() on a
  // hidden element is a silent no-op — which left focus on <body> whenever the
  // /api/fs call that used to re-focus was slow or failed.
  useEffect(() => {
    if (modal.shown) search.current?.focus();
  }, [modal.shown]);

  useEffect(() => {
    if (!scrollOnSelect.current) return;
    scrollOnSelect.current = false;
    if (activeIndex < 0) return;
    list.current?.querySelector(`#fs-entry-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = (index: number, scroll: boolean) => {
    scrollOnSelect.current = scroll;
    setSelected(index);
    setShowActiveName(scroll);
  };

  const move = (delta: number) => {
    if (!filtered.length) return;
    const next = activeIndex < 0 ? (delta > 0 ? 0 : filtered.length - 1) : (activeIndex + delta + filtered.length) % filtered.length;
    select(next, true);
  };

  const activate = (entry: FsEntry) => {
    if (entry.isGit) onOpenRepo(entry.path);
    else browse(entry.path);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      select(event.key === "Home" ? 0 : filtered.length - 1, true);
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && filtered[activeIndex]) {
      event.preventDefault();
      activate(filtered[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      // stopPropagation keeps the document-level handler from double-closing.
      event.preventDefault();
      event.stopPropagation();
      modal.close();
    }
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    // Vanilla: the input handler parks the selection at 0 when there is a query,
    // and `renderEntries` then clamps it against the new result set.
    const needle = value.trim().toLocaleLowerCase();
    if (!needle) {
      setSelected(-1);
      setShowActiveName(false);
      return;
    }
    const next = entries.filter((entry) => entry.name.toLocaleLowerCase().indexOf(needle) !== -1);
    setSelected(next.length ? 0 : -1);
    setShowActiveName(next.length > 0);
  };

  const current = view.kind === "ready" ? view.listing.path : "";
  const currentIsGit = view.kind === "ready" && view.listing.isGit;
  const hasFilter = query.length > 0;
  // The combobox reports collapsed the instant closing begins, 340ms before the
  // dialog is actually hidden — the vanilla control did the same.
  const expanded = modal.phase === "opening" || modal.phase === "open";

  const status =
    view.kind === "loading"
      ? "Loading folders…"
      : view.kind === "error"
        ? READ_ERROR
        : `${filtered.length} ${plural(filtered.length, "folder", "folders")} shown.`;

  const crumbs = useMemo(() => {
    if (view.kind !== "ready") return [];
    const parts = view.listing.path.split("/").filter(Boolean);
    const trail = [{ label: "/", path: "/", current: parts.length === 0 }];
    let acc = "";
    parts.forEach((part, i) => {
      acc += "/" + part;
      trail.push({ label: part, path: acc, current: i === parts.length - 1 });
    });
    return trail;
  }, [view]);

  return (
    <div
      ref={scrim}
      className={cn("ds-scrim", modal.shown && "is-shown")}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a repository folder"
      tabIndex={-1}
      hidden={!modal.mounted}
      onClick={(event) => {
        // Only a click on the scrim itself dismisses; clicks inside the sheet
        // bubble here too.
        if (event.target === scrim.current) modal.close();
      }}
    >
      <div
        ref={sheet}
        className="ds-sheet flex max-h-[76vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-island)] border border-line-soft bg-surface-3 shadow-[var(--shadow)] contrast-more:border-text"
      >
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3.5">
          <span className="flex-1 text-lg font-semibold">Choose a repository</span>
          <Tooltip content="Close" side="left" className={TOOLTIP_SURFACE}>
            <Button
              type="button"
              size="icon"
              pressScale={0.97}
              aria-label="Close"
              onClick={() => modal.close()}
              className="relative h-[30px] w-[30px] rounded-full bg-fill-3 text-text-2 transition-colors hover:bg-fill-2 hover:text-text after:absolute after:-inset-2 after:content-['']"
            >
              <X className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 border-b border-line-soft px-4 py-2 text-md text-text-2">
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-0.5">
              {i > 0 ? (
                <span className="text-text-3 opacity-60" aria-hidden="true">
                  /
                </span>
              ) : null}
              {crumb.current ? (
                <span className="rounded-[var(--radius-sm)] px-1 py-0.5 font-semibold text-text" aria-current="location">
                  {crumb.label}
                </span>
              ) : (
                /* `variant="ghost"`: without it the default `primary` variant
                   paints `bg-primary` under `text-accent`, and accent-on-accent
                   is a 1:1 contrast ratio — the crumb labels were literally
                   invisible in both themes. Nothing in the className below sets
                   a background, so there was no tailwind-merge key to displace
                   it. `hover:text-accent-text` re-pins the colour ghost would
                   otherwise hand to `hover:text-foreground`.

                   The ink is `--accent-text`, not `--accent`: these crumbs are
                   10 px, and plain Signal blue on the sheet reads 3.97:1 in
                   light. In dark the two tokens are the same value. */
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  pressScale={0.97}
                  whileHover={undefined}
                  onClick={() => browse(crumb.path)}
                  className="h-auto min-h-6 min-w-6 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[inherit] font-normal text-accent-text hover:bg-fill-2 hover:text-accent-text"
                >
                  {crumb.label}
                </Button>
              )}
            </span>
          ))}
        </div>

        <div className="border-b border-line-soft px-4 py-2.5">
          <Input
            ref={search}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={expanded}
            aria-controls="fslist"
            aria-label="Filter folders in this location"
            aria-activedescendant={activeIndex >= 0 ? `fs-entry-${activeIndex}` : undefined}
            placeholder="Filter folders"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={onSearchChange}
            onKeyDown={onSearchKeyDown}
            leftIcon={<Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            rightIcon={
              hasFilter ? (
                <Button
                  type="button"
                  size="icon"
                  pressScale={0.97}
                  aria-label="Clear folder filter"
                  onClick={() => {
                    setQuery("");
                    setSelected(-1);
                    search.current?.focus();
                  }}
                  className="relative h-[23px] w-[23px] rounded-[var(--radius-sm)] bg-fill-3 text-text-2 hover:bg-fill-2 after:absolute after:-inset-2.5 after:content-['']"
                >
                  <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                </Button>
              ) : null
            }
            classNames={{
              // `overflow-visible` matters: the clear button's -10px hit-slop is
              // an ::after box that the vendored `overflow-hidden` would clip.
              field: cn(
                "h-[34px] overflow-visible rounded-full border-line bg-bg ring-0",
                "transition-[box-shadow,border-color] duration-[var(--motion-duration-fast)]",
                "data-[state=focused]:border-accent-line contrast-more:border-text",
              ),
              input: cn(
                "ps-[35px] text-lg leading-[34px] text-text sm:text-base [@media(pointer:coarse)]:text-lg",
                hasFilter ? "pe-[34px]" : "pe-3.5",
                "placeholder:text-text-3",
                "[&::-webkit-search-cancel-button]:appearance-none",
              ),
              leftIcon: "start-[11px] text-text-3",
              rightIcon: "end-1.5 [&_button]:size-[23px] [&_svg]:h-3 [&_svg]:w-3",
            }}
          />
          <span className="ds-sr-only" role="status" aria-live="polite">
            {status}
          </span>
          {showActiveName && activeIndex >= 0 ? (
            <p className="m-0 mt-2 break-all text-sm text-text-2" aria-hidden="true">
              {filtered[activeIndex]?.name}
            </p>
          ) : null}
        </div>

        <div
          ref={list}
          id="fslist"
          role="listbox"
          aria-label="Folders in this location"
          aria-busy={refetching || undefined}
          className="min-h-[120px] flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {view.kind === "loading" ? (
            <div className="flex flex-col items-center gap-2.5 p-[26px] text-center text-base text-text-3">
              <Loader variant="dots" size={20} label="" />
              <span>Loading folders…</span>
            </div>
          ) : view.kind === "error" ? (
            <div className="flex flex-col items-center gap-3 p-[26px] text-center text-base text-text-3">
              <span>{READ_ERROR}</span>
              {/* Ghost idiom mirrors the crumb buttons above: the variant's own
                  colours are displaced, so the accent ink is pinned back on. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                pressScale={0.97}
                whileHover={undefined}
                onClick={() => browse(lastPath.current)}
                className="h-auto px-3 py-1.5 text-base font-semibold text-accent-text hover:bg-fill-2 hover:text-accent-text"
              >
                Try again
              </Button>
            </div>
          ) : filtered.length === 0 && !refetching ? (
            <div className="p-[26px] text-center text-base text-text-3">
              {trimmed ? `No folders match "${trimmed}". Clear the filter to see every folder.` : "No subfolders here."}
            </div>
          ) : (
            <>
              {/* Refetch keeps the previous rows mounted at reduced opacity
                  with pointer events on, behind the loading row below. */}
              <div className={refetching ? "opacity-55" : undefined}>
                {filtered.map((entry, index) => (
                  <button
                    key={entry.path}
                    id={`fs-entry-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => select(index, false)}
                    onClick={() => activate(entry)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-start",
                      "hover:bg-fill-2",
                      index === activeIndex && "bg-fill-2 shadow-[inset_0_0_0_1px_var(--accent-line)]",
                    )}
                  >
                    <span className="flex flex-none text-accent">
                      <Folder className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <Tooltip
                      content={entry.name}
                      side="bottom"
                      delay={350}
                      className={TOOLTIP_SURFACE}
                      wrapperClassName="min-w-0 max-w-full flex-1"
                    >
                      <span className="block min-w-0 truncate text-start text-sm">{entry.name}</span>
                    </Tooltip>
                    {entry.isGit ? (
                      <span className="rounded-[var(--radius-sm)] bg-add-soft px-2 py-px text-sm font-semibold text-diff-add-text">repo</span>
                    ) : (
                      <span className="flex flex-none text-text-3 opacity-50" aria-hidden="true">
                        <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {refetching ? (
                <div className="flex items-center justify-center gap-2 p-3 text-md text-text-3">
                  <Loader variant="dots" size={16} label="" />
                  <span>Loading folders…</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-line-soft px-4 py-3">
          <Tooltip content={current} side="top" className={TOOLTIP_SURFACE} wrapperClassName="min-w-0 flex-1">
            <span className="min-w-0 truncate rounded-[var(--radius-sm)] font-mono text-sm text-text-3 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]" tabIndex={0}>
              {current}
            </span>
          </Tooltip>
          <Button
            type="button"
            pressScale={0.97}
            disabled={!currentIsGit}
            onClick={() => {
              if (currentIsGit) onOpenRepo(current);
            }}
            // The disabled label is not a label, it is the reason — "Not a Git
            // repo" is the sheet's whole answer to "why can't I pick this?".
            // Fading an accent pill to 40% put that sentence at 2.35:1, the
            // least legible text on the surface, which is backwards. Disabled
            // therefore drops the accent entirely and becomes a full-opacity
            // neutral pill: ~5:1 in both themes, and greyed-out reads as
            // unavailable more honestly than a washed-out blue anyway.
            className={cn(
              "h-[var(--control-h-lg)] flex-none rounded-full px-4 text-base font-semibold",
              "bg-accent text-on-accent hover:bg-accent-solid-hover",
              "disabled:bg-fill-2 disabled:text-text-2 disabled:opacity-100",
            )}
          >
            {currentIsGit ? "Open this folder" : "Not a Git repo"}
          </Button>
        </div>
      </div>
    </div>
  );
});
