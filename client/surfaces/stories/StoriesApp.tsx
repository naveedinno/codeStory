// Review history — the saved-review list for one repository.
//
// This is the page every repo open lands on, which is why the route hands it a
// metadata-only projection by default (`listStoryMetadata`) and only rebuilds
// the diff for `?evidence=refresh` (`listStories`). The payload's
// `liveEvidence` flag carries that distinction into the UI, where it decides
// whether a row may present additions/deletions and drift as facts. Losing the
// split does not break the page — it makes reaching it slow, in proportion to
// the size of the repository, which is the kind of regression nobody notices
// until it is everywhere.
//
// The refresh itself is a link, not a fetch: navigating to `?evidence=refresh`
// re-renders the whole page server-side, so the URL describes what you are
// looking at and Back returns you to the cheap view. There is no
// `history.pushState` anywhere in this codebase and this surface adds none.
//
// beUI carries the chrome: `ButtonLink` for the one primary action,
// `ActionSwapRollText` for the two counts a delete changes in place, and
// `Tooltip` for the refresh link's explanation. What it deliberately does NOT
// carry is the page's shape — see the report for the list of components that
// were looked at and left alone, and why.
//
// The only runtime call is `DELETE /api/stories`. Its response carries a fresh
// live-evidence `stories` array, which this page deliberately does NOT adopt:
// swallowing it would silently upgrade a metadata-only page to live evidence
// (and ship every story's absolute path into the browser) as a side effect of
// deleting an unrelated row. Dropping the removed row locally is both cheaper
// and more honest.

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ActionSwapRollText } from "../../vendor/beui/motion/action-swap-roll";
import { ButtonLink } from "../../vendor/beui/motion/button/base";
import { Tooltip } from "../../vendor/beui/motion/tooltip";
import type { StoriesPayload, StoryRowView } from "../../../src/payloads";
import { failureMessage, requestJson } from "../../shared/api";
import { cn } from "../../shared/cn";
import { EASE_SIGNAL_OUT } from "../../shared/motion";
import { Nav, navActionClass } from "../../shared/nav";
import { EmptyHistory } from "./EmptyHistory";
import { RemoveStoryDialog } from "./RemoveStoryDialog";
import { StoryRow } from "./StoryRow";

export function StoriesApp({ payload }: { payload: StoriesPayload }) {
  const { repoName, routeBase, liveEvidence, now } = payload;
  const [stories, setStories] = useState<StoryRowView[]>(payload.stories);
  const [target, setTarget] = useState<StoryRowView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const cancel = () => {
    if (busy) return;
    setTarget(null);
    setError(null);
  };

  const confirm = () => {
    const story = target;
    if (!story) return;
    setBusy(true);
    setError(null);
    requestJson("/api/stories", {
      method: "DELETE",
      body: { id: story.id },
      fallback: "Could not remove story.",
      networkFallback: "Could not reach the server.",
    })
      .then(() => {
        setBusy(false);
        setTarget(null);
        setError(null);
        // Dropping the row is what renumbers the list, recounts the heading and
        // the open-comments status, and swaps in the empty state. The vanilla page
        // reached the last of those with `location.reload()`.
        setStories((rows) => rows.filter((row) => row.id !== story.id));
        setStatus(`Removed ${story.title || story.id}.`);
      })
      .catch((cause: unknown) => {
        setBusy(false);
        setError(failureMessage(cause, "Could not remove story."));
      });
  };

  // Reviews with notes, not notes. A metadata-only payload reports zero open
  // comments for every story because it never read the comment store, so this
  // is simply absent until someone asks for live evidence.
  const openNotes = stories.filter((story) => story.openComments).length;

  // A bundle import ends in a plain navigation, not a state patch: the new row
  // deserves a server-rendered card, and adopting the POST response's
  // live-evidence stories array would silently upgrade a metadata-only page.
  const importFile = (file: File) => {
    setImporting(true);
    setImportError(null);
    file
      .text()
      .then((text) => {
        let bundle: unknown;
        try {
          bundle = JSON.parse(text);
        } catch {
          throw new Error("That file is not valid JSON.");
        }
        return requestJson<{ id: string }>("/api/stories/bundle", {
          method: "POST",
          body: { name: file.name, bundle },
          fallback: "Could not import this bundle.",
          networkFallback: "Could not reach the server.",
        });
      })
      .then(() => {
        window.location.href = `${routeBase}/stories`;
      })
      .catch((cause: unknown) => {
        setImporting(false);
        setImportError(failureMessage(cause, "Could not import this bundle."));
      });
  };

  return (
    <>
      {/* The whole page, so the dialog can inert exactly this and nothing else. */}
      <div ref={main}>
        <Nav
          home="/repos"
          crumbs={[{ label: repoName, href: `${routeBase}/change` }, { label: "Review history" }]}
          right={
            // The explanation was a `title`, which never appears on keyboard
            // focus — and this link is the one control on the page whose cost
            // you want to know before you click it. beUI's tooltip opens on
            // focus as well as hover.
            <Tooltip
              content="Recompute live diff and drift evidence for every saved review"
              side="bottom"
              wrapperClassName="flex-none"
              className="max-w-[min(44ch,90vw)] rounded-[var(--radius-sm)] border-line-soft bg-surface-3 text-sm whitespace-normal text-text shadow-signal"
            >
              <a className={navActionClass} href={`${routeBase}/stories?evidence=refresh`}>
                Refresh evidence
              </a>
            </Tooltip>
          }
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="ds-reveal relative isolate mx-auto w-[min(960px,100%)] px-6 pt-7 pb-16 max-[760px]:px-4 max-[760px]:pt-[22px]"
        >
          <header className="mb-[22px] flex items-end justify-between gap-7 border-b border-line-soft pb-[22px] max-[760px]:items-start max-[560px]:block">
            <div className="min-w-0">
              <p className="m-0 mb-1.5 font-mono text-xs font-medium tracking-[var(--tracking-kicker)] text-text-3 uppercase">
                {repoName}
              </p>
              <div className="flex flex-wrap items-center gap-3.5">
                <h1 className="m-0 font-display text-[26px] font-bold tracking-[-.02em] text-balance">Review history</h1>
                {/* Exactly one "Start review" exists on this page, and it lives
                    with the title rather than in the empty state — the empty
                    state must not become the only way to start. */}
                {/* beUI's ButtonLink, so the page's one primary action has the
                    same press spring as every other control in the app. It had
                    no press feedback at all before — only a colour fade. The
                    scale is .97 rather than beUI's .93 for the same reason the
                    row's delete control overrides it. */}
                <ButtonLink
                  href={`${routeBase}/change`}
                  pressScale={0.97}
                  className={cn(
                    "h-[var(--control-h-lg)] rounded-full bg-accent px-4",
                    "text-base font-semibold text-on-accent no-underline hover:bg-accent-solid-hover",
                    "transition-colors duration-[var(--motion-duration-fast)] ease-out motion-reduce:transition-none",
                  )}
                >
                  Start review
                </ButtonLink>
                {/* The other way in: explain code that did not change. A link
                    styled like the import control, so the one primary action
                    stays the one primary action. */}
                <a
                  href={`${routeBase}/explain`}
                  className={cn(
                    "inline-flex h-[var(--control-h-lg)] items-center rounded-full border border-line px-4",
                    "text-base font-semibold text-text-2 no-underline hover:text-text",
                    "transition-colors duration-[var(--motion-duration-fast)] ease-out motion-reduce:transition-none",
                  )}
                >
                  Explain code
                </a>
                {/* Plain button styling, not a second primary: importing a
                    teammate's bundle is rare next to starting a review. */}
                <button
                  type="button"
                  disabled={importing}
                  aria-busy={importing || undefined}
                  onClick={() => fileInput.current?.click()}
                  className={cn(
                    "h-[var(--control-h-lg)] rounded-full border border-line px-4",
                    "text-base font-semibold text-text-2 hover:text-text",
                    "transition-colors duration-[var(--motion-duration-fast)] ease-out motion-reduce:transition-none",
                    "disabled:opacity-55",
                  )}
                >
                  {importing ? "Importing…" : "Import bundle"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  className="ds-sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) importFile(file);
                  }}
                />
              </div>
              {importError ? (
                <p className="mt-[7px] mb-0 text-base text-danger-text" role="alert">
                  {importError}
                </p>
              ) : null}
              <p className="mt-[7px] mb-0 max-w-[58ch] text-base leading-[1.45] text-pretty text-text-2">
                Resume a saved review when you need its scope or its notes.
              </p>
            </div>
            {openNotes ? (
              <span
                aria-label="Review history status"
                className="flex items-center gap-3.5 text-md whitespace-nowrap text-text-2 max-[560px]:mt-3.5"
              >
                {/* Removing a story with open comments changes this count while
                    the page stays put, and beUI's ActionSwapText is the one
                    swap primitive here that does NOT animate on mount
                    (`AnimatePresence initial={false}`) — so the count rolls
                    when it actually changes and stays still on load. A ticker
                    would count up from zero on every navigation. */}
                <ActionSwapRollText value={`notes-${openNotes}`}>
                  <span>
                    <b className="text-text tabular-nums">{openNotes}</b>{" "}
                    {openNotes === 1 ? "review has" : "reviews have"} open comments
                  </span>
                </ActionSwapRollText>
              </span>
            ) : null}
          </header>

          {stories.length ? (
            <section className="min-w-0" aria-labelledby="saved-reviews-title">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2
                  id="saved-reviews-title"
                  className="m-0 font-display text-[16px] leading-[1.1] font-semibold tracking-[-.012em]"
                >
                  {/* Same swap, same reason: a delete renumbers this heading in
                      place, and the roll is what says so. */}
                  <ActionSwapRollText value={`saved-${stories.length}`} className="align-baseline">
                    {stories.length} saved {stories.length === 1 ? "review" : "reviews"}
                  </ActionSwapRollText>
                </h2>
              </div>
              <div id="storyList" className="grid gap-3">
                <AnimatePresence initial={false}>
                  {stories.map((story, index) => (
                    <motion.div
                      key={story.id}
                      layout={!reduceMotion}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
                      transition={{ duration: 0.2, ease: EASE_SIGNAL_OUT }}
                    >
                      <StoryRow
                        story={story}
                        index={index}
                        routeBase={routeBase}
                        now={now}
                        liveEvidence={liveEvidence}
                        busy={busy && target?.id === story.id}
                        onRemove={setTarget}
                        onRestored={(patch: Partial<StoryRowView>) =>
                          setStories((rows) =>
                            rows.map((row) => (row.id === story.id ? { ...row, ...patch } : row)),
                          )
                        }
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ) : (
            <EmptyHistory />
          )}

          {/* The vanilla page announced a failed delete with alert() and a
              successful one not at all. The failure now reports inside the
              dialog; this is the success half, and it stays screen-reader-only
              because the row visibly disappearing is the sighted confirmation. */}
          <p className="ds-sr-only" role="status">
            {status}
          </p>
        </main>
      </div>

      <RemoveStoryDialog
        target={target ? { id: target.id, title: target.title || target.id } : null}
        background={main}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </>
  );
}
