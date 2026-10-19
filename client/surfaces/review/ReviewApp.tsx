// The review page.
//
// This component renders the document ONCE and then gets out of the way. Every
// runtime change on this surface is written by the engine in
// `./engine/review-engine.js` — the same code that wrote it when the page was a
// server-rendered string — and React re-rendering on top of that would give a
// single attribute two writers. So there is no state here, no effects beyond
// the two below, and no props that change.
//
// The two effects:
//
//   1. `useLayoutEffect` stamps the page facts onto `<body>` before paint. The
//      engine reads a dozen of them (`data-review-scope`, `data-story-key`,
//      `data-review-page-token`, …) and so does the CSS (`ds-map-bg`,
//      `ds-overview-active`). The PAYLOAD is still the source of truth — these
//      attributes are a derived runtime detail this surface owns, which is why
//      they are written here rather than by the shell.
//   2. `useEffect` starts the engine, once, against the committed DOM.
//
// Why the chrome is hand-built rather than assembled from beUI: every
// `agents/*` component in the vendored library ships its own live region —
// `agents/file-diff` puts `aria-live="polite"` on the diff viewport itself,
// `agents/ai-sidebar` on the sidebar — and this page updates continuously as a
// reviewer walks it. A live region on the step panel means every arrow-key
// press re-reads the panel. `test/review-page.test.mjs` asserts both halves of
// that: that the vendored files still carry those attributes, and that this
// surface imports none of them.

import { useEffect, useLayoutEffect, useRef } from "react";
import { EditorMenu } from "../../shared/editor-menu";
import { ThemeMenu } from "../../shared/theme-menu";
import { SkipLink } from "../../shared/nav";
import type { ReviewPayload } from "../../../src/payloads";
import { startReviewEngine } from "./engine/review-engine";
import { initVerification } from "./engine/verification";
import { FilesView, ReviewPage } from "./ReviewView";
import { Sidebar } from "./Sidebar";
import { StoryView } from "./StoryView";
import { plural } from "./format";

const ICONS = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M20 11a8.1 8.1 0 0 0-14.9-4.4L3 10" />
      <path d="M3 4v6h6M4 13a8.1 8.1 0 0 0 14.9 4.4L21 14" />
      <path d="M21 20v-6h-6" />
    </>
  ),
};

function ChromeIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

function SidebarToggle() {
  return (
    <button
      className="ds-sidebar-toggle"
      data-sidebar-toggle
      aria-label="Collapse sidebar"
      aria-expanded="true"
      title="Collapse sidebar"
    >
      <span className="ds-ui-icon" aria-hidden="true">
        <ChromeIcon name="menu" />
      </span>
    </button>
  );
}

function CloseStory({
  routeBase,
  srOnlyLabel,
}: {
  routeBase: string;
  srOnlyLabel?: boolean;
}) {
  return (
    <a
      className="ds-back"
      data-close-story
      href={`${routeBase}/stories`}
      title="Close story and return to review history"
      aria-label="Close story and return to review history"
    >
      <span className="ds-ui-icon" aria-hidden="true">
        <ChromeIcon name="close" />
      </span>
      <span className={srOnlyLabel ? "ds-sr-only" : undefined}>
        Close story
      </span>
    </a>
  );
}

/**
 * The composed Review-tab label.
 *
 * `refreshCount()` rebuilds this exact string client-side from the same facts,
 * so the two must stay in step: a screen-reader user who hears the count change
 * must be hearing the same sentence the server rendered.
 */
function reviewTabLabel(payload: ReviewPayload): string {
  const {
    chrome,
    trust,
    excludedFiles,
    stagedWorktreeDivergentFiles: divergent,
    storyFreshness,
  } = payload;
  const open = chrome.openCount;
  const tail = chrome.feedbackHealthy
    ? divergent.length
      ? `, ${divergent.length} staged and working-tree ${plural(divergent.length, "version")} differ`
      : storyFreshness === "current"
        ? trust.uncoveredCount
          ? `, ${trust.uncoveredCount} ${plural(trust.uncoveredCount, "change")} not explained by the story`
          : excludedFiles.length
            ? `, ${excludedFiles.length} excluded ${plural(excludedFiles.length, "file")} to inspect`
            : ""
        : ", story requires regeneration"
    : ", feedback file needs repair";
  return `Review, ${open} queued ${plural(open, "comment")}${tail}`;
}

function DriftDrawer({ payload }: { payload: ReviewPayload }) {
  const report = payload.storyDrift;
  if (!report || report.state === "unverified" || !report.files.length)
    return null;
  const summary = report.inScopeFiles
    ? `${report.inScopeFiles} story ${plural(report.inScopeFiles, "file")}${
        report.outsideScopeFiles
          ? ` and ${report.outsideScopeFiles} ${plural(report.outsideScopeFiles, "file")} outside the story`
          : ""
      } changed after this story was captured.`
    : `${report.outsideScopeFiles} ${plural(report.outsideScopeFiles, "file")} outside the story changed. The story's selected files still match its baseline.`;
  return (
    <div
      className="ds-drawer-root"
      id="ds-drift-drawer"
      data-drift-observation={report.observationId ?? ""}
      hidden
    >
      <div className="ds-drawer-scrim" data-drift-close />
      <div
        className="ds-drawer ds-drift-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-drift-title"
        tabIndex={-1}
      >
        <div className="ds-drawer-head">
          <div>
            <div className="ds-drawer-title" id="ds-drift-title">
              Since story
            </div>
            <div className="ds-drawer-sub">{summary}</div>
          </div>
          <button
            className="ds-drawer-x"
            data-drift-close
            title="Close"
            aria-label="Close changes since story"
          >
            ×
          </button>
        </div>
        {report.inScopeFiles > 0 && !payload.history ? (
          <div className="ds-drift-refresh"><button type="button" className="ds-btn ds-btn-solid" data-drift-refresh>Refresh affected steps</button><span>Keep existing step IDs and comments; recheck the complete story.</span></div>
        ) : null}
        <div className="ds-drift-body">
          <div
            className="ds-drift-list"
            role="list"
            aria-label="Files changed since story"
          >
            {report.files.map((file) => {
              const label =
                file.oldPath && file.oldPath !== file.path
                  ? `${file.oldPath} → ${file.path}`
                  : file.path;
              const status =
                file.status === "mode-changed"
                  ? "Mode changed"
                  : file.status.charAt(0).toUpperCase() + file.status.slice(1);
              return (
                <button
                  key={file.path}
                  type="button"
                  className="ds-drift-file"
                  data-drift-file={file.path}
                  data-drift-label={label}
                  data-drift-detail={file.detail}
                  aria-pressed="false"
                >
                  <span className="ds-drift-file-main">
                    <code>{label}</code>
                    <span>
                      {status}
                      {file.detail === "summary-only" ? " · summary only" : ""}
                    </span>
                  </span>
                  <span className="ds-drift-file-meta">
                    <em className={`is-${file.scope}`}>
                      {file.scope === "story" ? "Story" : "Outside story"}
                    </em>
                    {file.additions !== undefined ||
                    file.deletions !== undefined ? (
                      <span className="ds-drift-lines">
                        <i>+{file.additions ?? 0}</i>
                        <b>−{file.deletions ?? 0}</b>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ds-drift-detail">
            <div className="ds-drift-detail-head">
              <button type="button" className="ds-drift-back" data-drift-back>
                ← Files
              </button>
              <code data-drift-selected-path aria-live="polite" />
            </div>
            <div className="ds-drift-preview" data-drift-preview>
              <div className="ds-diffnote">
                Choose a file to load its exact change since the story.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const COMMANDS: [string, string, string, string][] = [
  ["story", "Open Story", "J / K", "Move through the guided walkthrough"],
  ["files", "Open All files", "/", "Search and filter the changed files"],
  [
    "review",
    "Open Review",
    "",
    "Unresolved comments, coverage evidence, and the challenge pass",
  ],
  ["next-unviewed", "Next unreviewed file", "", "Keep the review moving"],
  [
    "toggle-viewed",
    "Toggle current file reviewed",
    "V",
    "Mark this file reviewed for this exact diff.",
  ],
  ["read-aloud", "Toggle read aloud", "Space", "Pause or resume read aloud"],
];

function CommandPalette() {
  return (
    <div className="ds-command-root" data-command-root hidden>
      {/* A div, not a button: a focusable scrim would join the modal tab loop.
          `render-accessibility.test.mjs` asserts this. */}
      <div
        className="ds-command-scrim"
        data-shortcuts-close
        aria-hidden="true"
      />
      <div
        className="ds-command"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-command-title"
        aria-describedby="ds-command-description"
        tabIndex={-1}
      >
        <div className="ds-command-head">
          <div>
            <strong id="ds-command-title">Commands</strong>
            <span id="ds-command-description">
              Keyboard-first review without hidden magic.
            </span>
          </div>
          <button
            data-shortcuts-close
            type="button"
            aria-label="Close commands"
          >
            ×
          </button>
        </div>
        <div
          className="ds-command-list"
          role="group"
          aria-label="Review commands"
        >
          {COMMANDS.map(([id, title, key, detail]) => (
            <button key={id} type="button" data-command={id}>
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
              {key ? <kbd>{key}</kbd> : null}
            </button>
          ))}
        </div>
        <div className="ds-command-foot">
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> changes / narration
          </span>
          <span>
            <kbd>C</kbd> comment selection
          </span>
          <span>
            <kbd>B</kbd> blame line
          </span>
          <span>
            <kbd>?</kbd> commands
          </span>
          <span>
            <label>
              <input type="checkbox" data-shortcuts-toggle defaultChecked /> Single-key shortcuts
            </label>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Everything the engine and the stylesheet read off `<body>`. */
function useBodyFacts(payload: ReviewPayload): void {
  useLayoutEffect(() => {
    const body = document.body;
    const attrs: Record<string, string | null> = {
      "data-storyless": payload.storyless ? "1" : null,
      // The engine opens new comments as questions on a code story.
      "data-story-subject": payload.subject,
      "data-read-view": "tour",
      "data-story-freshness": payload.storyFreshness,
      "data-feedback-health": payload.chrome.feedbackHealthy
        ? "healthy"
        : "invalid",
      "data-story-scope": payload.chrome.focusedStory ? "focused" : null,
      "data-repo": payload.repo,
      "data-viewed-scope": payload.viewedScope,
      "data-review-scope": payload.reviewScope,
      // Half of the reading-position key. Scope alone replayed one story's
      // position into another whenever two stories shared a base..head.
      "data-story-key": payload.storyKey,
      "data-current-diff-hash": payload.currentDiffHash,
      "data-review-page-token": payload.pageToken,
      // Blame links a commit back to the scope page for this repo.
      "data-route-base": payload.routeBase,
      // A frozen history snapshot: the engine keeps comment and repair
      // affordances quiet instead of letting them fail on POST.
      "data-history": payload.history ? "1" : null,
    };
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null) body.removeAttribute(name);
      else body.setAttribute(name, value);
    }
    body.classList.add("ds-map-bg");
    body.classList.toggle("ds-overview-active", !payload.storyless);
  }, [payload]);
}

export function ReviewApp({ payload }: { payload: ReviewPayload }) {
  const {
    routeBase,
    storyless,
    chrome,
    trust,
    excludedFiles,
    stagedWorktreeDivergentFiles: divergent,
  } = payload;
  const started = useRef(false);
  useBodyFacts(payload);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startReviewEngine({
      comments: payload.comments,
      commentAnchors: Object.fromEntries(
        payload.commentAnchors.map((a) => [a.id, a]),
      ),
    });
  }, [payload]);

  useEffect(() => initVerification({
    pageUrl: (path: string) => `${path}?page=${encodeURIComponent(payload.pageToken)}`,
  }), [payload.pageToken]);

  const history = payload.history;
  const historyWhen = history
    ? new Date(history.takenAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  return (
    <>
      <SkipLink />
      {history ? (
        <div className="ds-history-banner" role="note">
          <span>
            Viewing the version from <b>{historyWhen}</b> — this snapshot is read-only.
          </span>{" "}
          <a href={`${routeBase}/review?story=${encodeURIComponent(history.liveId)}`}>
            Return to the live story
          </a>
        </div>
      ) : null}
      <header
        className={`ds-reviewchrome${storyless ? "" : " is-storyful"}`}
        data-review-chrome
        {...(storyless
          ? { "data-storyless-chrome": "" }
          : { "data-story-chrome": "" })}
      >
        {/* Two islands: where the reader is (the active step's call map, copied
            in by the engine; the story title where there is no map), and the
            actions. */}
        <div className="ds-reviewchrome-island is-where">
          <div className="ds-reviewchrome-rail">
            <div className="ds-reviewchrome-nav">
              <SidebarToggle />
            </div>
          </div>
          <div className="ds-reviewchrome-main">
            <div className="ds-reviewchrome-mobile-nav">
              <SidebarToggle />
            </div>
            <div className="ds-titlewrap" data-landing-fallback>
              <div
                className="ds-title"
                title={
                  storyless ? "Reviewing the diff" : payload.story.title.text
                }
              >
                {storyless ? "Diff review" : payload.story.title.text}
              </div>
            </div>
            <div className="ds-landing-host" data-landing-host hidden />
          </div>
        </div>
        <div className="ds-reviewchrome-island is-actions">
          <div className="ds-reviewchrome-utilities">
            <div
              className="ds-viewtoggle"
              role="tablist"
              aria-label="Review view"
            >
              <button
                className="ds-tab is-active"
                id="ds-tab-tour"
                data-view="tour"
                role="tab"
                aria-controls="ds-view-tour"
                aria-selected="true"
                tabIndex={0}
              >
                Story
              </button>
              <button
                className="ds-tab"
                id="ds-tab-files"
                data-view="files"
                role="tab"
                aria-controls="ds-view-files"
                aria-selected="false"
                tabIndex={-1}
              >
                {payload.subject === "code" ? "Files" : "All files"}
              </button>
              <button
                className="ds-tab"
                id="ds-tab-review"
                data-view="review"
                data-review-status
                data-unexplained-count={trust.uncoveredCount}
                data-excluded-count={excludedFiles.length}
                data-index-divergence-count={divergent.length}
                data-story-freshness={payload.storyFreshness}
                role="tab"
                aria-controls="ds-view-review"
                aria-selected="false"
                tabIndex={-1}
                aria-label={reviewTabLabel(payload)}
                title={
                  payload.subject === "code"
                    ? "Review — your queued questions and notes"
                    : "Review — notes, coverage, and anything the story leaves unexplained"
                }
              >
                Review
                <span
                  className="ds-tab-flag"
                  data-review-flag
                  aria-hidden="true"
                  hidden={chrome.reviewClean}
                >
                  ▲
                </span>
                <span
                  className="ds-tab-badge"
                  id="ds-open-count"
                  title="Unresolved comments"
                  hidden={!chrome.openCount}
                >
                  <b>{chrome.openCount}</b>
                </span>
              </button>
            </div>
            <EditorMenu compact />
            <ThemeMenu />
            <div className="ds-actions">
              {storyless ? (
                <button
                  className="ds-reload-diff"
                  data-reload-diff
                  type="button"
                  title="Re-read the working tree and refresh this diff"
                  aria-label="Reload diff"
                >
                  <span
                    className="ds-ui-icon ds-reload-icon"
                    aria-hidden="true"
                  >
                    <ChromeIcon name="refresh" />
                  </span>
                  <span data-reload-label>Reload</span>
                </button>
              ) : null}
            </div>
            <CloseStory routeBase={routeBase} srOnlyLabel />
          </div>
        </div>
      </header>

      {/* Fixed, so a re-fire never moves the document under the reviewer. */}
      <div
        className="ds-live-banner"
        data-live-banner
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Live review status"
        hidden
      >
        <span className="ds-live-banner-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M12.7 5.3A5.25 5.25 0 1 0 13 9" />
            <path d="M12.7 2.7v2.6h-2.6" />
          </svg>
        </span>
        <span data-live-message>Diff changed.</span>
        <button
          className="ds-live-banner-reload"
          type="button"
          data-live-reload
        >
          Reload
        </button>
        <button
          className="ds-live-banner-dismiss"
          type="button"
          data-live-dismiss
          aria-label="Dismiss live review status"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div
        className="ds-toast ds-story-reload-toast"
        data-story-reload-toast
        role="status"
        aria-live="polite"
        aria-atomic="true"
        hidden
      >
        <span>Story updated. Reloading in 10 seconds.</span>
        <button
          type="button"
          data-story-reload-cancel
          aria-label="Cancel automatic story reload"
        >
          Cancel
        </button>
      </div>

      {/* The agent panel's home. The engine re-parents #ds-agentpanel into the
          story stage while a story is being generated and back again after. */}
      <div id="ds-agenthome">
        <div id="ds-agentpanel" data-variant="floating" />
      </div>

      <div className="ds-layout">
        <Sidebar payload={payload} />
        <main id="main-content" tabIndex={-1} className="ds-main">
          <StoryView payload={payload} />
          <FilesView payload={payload} />
          <ReviewPage payload={payload} />
        </main>
      </div>

      <DriftDrawer payload={payload} />
      <CommandPalette />
      <div className="ds-selection-menu" data-selection-menu role="menu" hidden>
        <button type="button" role="menuitem" data-selection-comment>
          Comment selected code
        </button>
      </div>
      <div
        className="ds-toast"
        id="ds-toast"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-relevant="additions text"
      />
      <noscript>
        <div className="ds-empty">
          diffStory needs JavaScript to drive the review.
        </div>
      </noscript>
    </>
  );
}
