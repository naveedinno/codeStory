// The repository picker — codeStory's front door.
//
// Rendered for `GET /repos`, and for `/`, `/change`, `/review` and `/stories`
// when no repository is open. Everything it shows on first paint comes from the
// `PickerPayload` embedded by the shell; the only thing fetched on mount is the
// skills banner.
//
// Navigation is a real URL assignment, never a client-side route. There is no
// `history.pushState` anywhere in this codebase and this surface does not
// introduce one: opening a repository is `location.href = <server-chosen route>`,
// which is what makes Back and Forward behave.
//
// Feedback stays mounted as one polite live region, but is also visible. That
// gives every user the same progress and error state, and lets a removed recent
// repository be restored without reopening the folder browser.

import { useRef, useState } from "react";
import { CircleAlert, CheckCircle2, LoaderCircle, Plus, RotateCcw, X } from "lucide-react";
import type { PickerPayload, RecentRow } from "../../../src/payloads";
import { Button } from "../../vendor/beui/motion/button/base";
import { Tooltip } from "../../vendor/beui/motion/tooltip";
import { failureMessage, requestJson } from "../../shared/api";
import { cn } from "../../shared/cn";
import { FolderBrowser, type FolderBrowserHandle } from "./FolderBrowser";
import { Hero } from "./Hero";
import { RecentRepos, TOOLTIP_SURFACE } from "./RecentRepos";
import { SkillBanner } from "./SkillBanner";
import { fallbackRepoRoute } from "./format";

interface OpenResponse {
  route?: string;
}

interface RecentUndo {
  entry: RecentRow;
  index: number;
}

interface RecentResponse {
  recents?: RecentRow[];
  undo?: RecentUndo | null;
}

type Status = {
  text: string;
  tone: "progress" | "success" | "error";
  undo?: { payload: RecentUndo; name: string; actionLabel?: string };
  retry?: { kind: "open" | "remove"; path: string };
} | null;

function StatusToast({
  status,
  onDismiss,
  onUndo,
}: {
  status: Status;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  const Icon = status?.tone === "error" ? CircleAlert : status?.tone === "progress" ? LoaderCircle : CheckCircle2;
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[70] flex justify-center"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {status ? (
        <div
          data-picker-status
          className="pointer-events-auto flex w-fit max-w-[min(560px,100%)] items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-3 px-3 py-2.5 text-[13px] leading-[1.45] text-text shadow-signal contrast-more:border-text"
        >
          <Icon
            className={cn(
              "h-4 w-4 flex-none",
              status.tone === "error"
                ? "text-danger-text"
                : status.tone === "success"
                  ? "text-diff-add-text"
                  : "text-accent-text",
              status.tone === "progress" && "animate-spin motion-reduce:animate-none",
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 text-pretty">{status.text}</span>
          {status.undo || status.retry ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              pressScale={0.96}
              onClick={onUndo}
              className="h-9 flex-none gap-1.5 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-text hover:bg-fill-3"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {status.undo ? (status.undo.actionLabel ?? "Undo") : "Try again"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            pressScale={0.96}
            onClick={onDismiss}
            aria-label="Dismiss message"
            className="h-9 w-9 flex-none rounded-full text-text-2 hover:bg-fill-2 hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PickerApp({ payload }: { payload: PickerPayload }) {
  const [recents, setRecents] = useState<RecentRow[]>(payload.recents);
  const [status, setStatus] = useState<Status>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const browser = useRef<FolderBrowserHandle>(null);

  const openRepo = (path: string) => {
    if (!path) return;
    setStatus({ text: "Opening repository…", tone: "progress" });
    requestJson<OpenResponse>("/api/repo/open", {
      method: "POST",
      body: { path },
      // Two distinct messages, as before: the server refused, versus we never
      // reached it at all.
      fallback: "Could not open that path.",
      networkFallback: "Could not reach the server.",
    })
      .then((data) => {
        // The server picks the route (review history, or straight back into a
        // restored story). The fallback only fires if it declined to.
        window.location.href = data?.route || fallbackRepoRoute(path);
      })
      .catch((cause: unknown) => {
        setStatus({
          text: failureMessage(cause, "Could not open that path."),
          tone: "error",
          retry: { kind: "open", path },
        });
      });
  };

  const removeRepo = (path: string) => {
    const row = recents.find((recent) => recent.path === path);
    setRemoving(path);
    requestJson<RecentResponse>("/api/repos/recent", {
      method: "DELETE",
      body: { path },
      fallback: "Could not remove repository.",
    })
      .then((data) => {
        // Dropping the row from state is what re-numbers the list, recounts the
        // unavailable group, collapses it when it empties, and swaps in the
        // empty state — all of which `syncRecentUi()` did by hand.
        setRecents(data.recents ?? recents.filter((recent) => recent.path !== path));
        setRemoving(null);
        setStatus({
          text: `Removed ${row?.name ?? "repository"} from recent repositories.`,
          tone: "success",
          ...(data.undo
            ? { undo: { payload: data.undo, name: row?.name ?? data.undo.entry.name } }
            : {}),
        });
      })
      .catch((cause: unknown) => {
        setRemoving(null);
        setStatus({
          text: failureMessage(cause, "Could not remove repository."),
          tone: "error",
          retry: { kind: "remove", path },
        });
      });
  };

  const restoreRepo = () => {
    const undo = status?.undo;
    if (!undo) return;
    setRemoving(undo.payload.entry.path);
    requestJson<RecentResponse>("/api/repos/recent/restore", {
      method: "POST",
      body: { undo: undo.payload },
      fallback: "Could not restore repository.",
    })
      .then((data) => {
        if (data.recents) setRecents(data.recents);
        setRemoving(null);
        setStatus({ text: `Restored ${undo.name} to recent repositories.`, tone: "success" });
      })
      .catch(() => {
        setRemoving(null);
        setStatus({
          text: `Could not restore ${undo.name}. Try again.`,
          tone: "error",
          undo: { ...undo, actionLabel: "Try again" },
        });
      });
  };

  return (
    <>
      <main
        ref={main}
        className="mx-auto flex min-h-screen w-[min(820px,100%)] flex-col px-6 pt-9 pb-7 max-[760px]:px-4 max-[760px]:py-6"
      >
        <Hero />

        <section className="ds-reveal ds-reveal-2 mb-14 min-w-0 max-[760px]:mb-10">
          <div className="mt-0.5 mb-3.5 flex items-end justify-between gap-[18px] max-[480px]:items-center">
            <h2 className="m-0 font-display text-2xl leading-[1.1] font-bold tracking-[-.02em] text-balance max-[480px]:text-xl">
              Repositories
            </h2>
            {/* Icon-only below 760px; the accessible name has to survive that.
                The beUI Tooltip replaces the `title` this used to carry: it also
                shows on keyboard focus, which `title` never did, and it is the
                narrow width where the button is icon-only that needs it most. */}
            <Tooltip content="Add repository" side="left" className={TOOLTIP_SURFACE} wrapperClassName="flex-none">
              <Button
                type="button"
                // The UI atlas clicks this by id to capture the modal frames.
                id="quickAddBtn"
                aria-label="Add repository"
                pressScale={0.97}
                onClick={(event) => browser.current?.open(event.currentTarget as HTMLElement)}
                className="h-[var(--control-h)] gap-[7px] rounded-full bg-accent px-3.5 text-[12.5px] font-semibold text-on-accent hover:bg-accent-solid-hover max-[760px]:w-[var(--control-h)] max-[760px]:px-0"
              >
                <Plus className="h-[15px] w-[15px]" strokeWidth={2} />
                <span className="max-[760px]:hidden">Add repository</span>
              </Button>
            </Tooltip>
          </div>

          <RecentRepos
            recents={recents}
            home={payload.home}
            now={payload.now}
            removing={removing}
            onOpen={openRepo}
            onRemove={removeRepo}
          />

          <SkillBanner />
        </section>
      </main>

      <FolderBrowser ref={browser} background={main} onOpenRepo={openRepo} />
      <StatusToast
        status={status}
        onDismiss={() => setStatus(null)}
        onUndo={() => {
          if (status?.retry) {
            if (status.retry.kind === "open") openRepo(status.retry.path);
            else removeRepo(status.retry.path);
          } else restoreRepo();
        }}
      />
    </>
  );
}
