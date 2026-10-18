// Tiny HTTP server over Node built-ins. The page is re-rendered on every GET, so
// refreshing reflects the current diff and story with no watch process. The repo
// is held in a mutable Session, so the same server can boot empty (app/picker
// mode) and switch repos at runtime via /api/repo/open.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { spawn } from "node:child_process";
import {
  loadTour,
  orderedSteps,
  validateGeneratedConceptSteps,
  validateGeneratedTour,
  validateNewGeneratedStory,
} from "./tour.js";
import {
  isGitRepo,
  resolveBase,
  getDiff,
  getFileDiff,
  reviewFileIndex,
  reviewChangeIndexSnapshot,
  describeBase,
  readFileRange,
  readWholeFile,
  listBranchRefs,
  listRecentCommits,
  currentBranch,
  isDirtyExceptHistory,
  hasParentCommit,
  emptyTree,
  resolveCommit,
  noiseFiles,
  excludedReviewFiles,
  reviewChangeFingerprint,
  reviewSourceMetadataFingerprint,
  stagedWorktreeDivergentFiles,
  numstat,
  assertSafeRepoPath,
  commitEvolutionManifest,
  blameReviewLine,
  type CommitEvolutionManifest,
} from "./git.js";
import { enclosingScopeLabel } from "./enclosing-scope.js";
import { parseUnifiedDiff } from "./diff.js";
import type { ReviewExclusionMetadata } from "./noise.js";
import { computeCoverage } from "./coverage.js";
import {
  renderReviewShell,
  renderFullFile,
  renderSplitHunks,
  renderUnifiedHunks,
  renderContextRows,
  renderFilePanelContent,
  renderStoryStepPanel,
  renderTrustEvidence,
  type StoryDriftView,
} from "./render.js";
import { esc } from "./diff-render.js";
import { renderShell } from "./shell.js";
import type { PickerPayload } from "./payloads.js";
import type { StoriesPayload, StoryRowView } from "./payloads.js";
import type { ChangePayload } from "./payloads.js";
import { narrativeText } from "./narrative.js";
import { summarizeChange } from "./change-view.js";
import { resolveScope, type Scope } from "./scope.js";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import {
  buildFullFileRows,
  hunksToSbsBlocks,
  filesForStoryCoverage,
  hunkNewRange,
  rowsInNewRange,
} from "./view-model.js";
import { buildReviewModel } from "./view-model.js";
import {
  loadComments,
  loadCommentsWithHealth,
  commentsForStory,
  addComment,
  deleteComment,
  updateComment,
  InvalidCommentStoreError,
  type CommentStoreHealth,
  type NewComment,
} from "./comments.js";
import { resolveStoryPath, APP_BRAND, DATA_DIR } from "./config.js";
import { conceptPageCsp, conceptPageDocument } from "./concept-page.js";
import {
  isCodeStep,
  isPageConcept,
  type DiffFile,
  type ReviewFileIndexEntry,
  type StoryScope,
  type StoryArc,
  type StoryEvolution,
  type Tour,
} from "./types.js";
import { writeJsonAtomic, writeTextAtomic } from "./atomic-json.js";
import {
  evolutionPreservationErrors,
  normalizeEvolutionObject,
  verifyEvolution,
} from "./evolution.js";
import {
  availableAgents,
  streamAgent,
  storyPrompt,
  agentPreflight,
  selectAvailableAgent,
  normalizeStoryMode,
  normalizeCodexRunOptions,
  summarizeAgentFailure,
  storyRepairPrompt,
  type StoryRepairAction,
  type Agent,
  type AgentRunOptions,
  type StreamResult,
} from "./agent.js";
import {
  runStarted,
  contextEvent,
  phaseEvent,
  heartbeatEvent,
  warningEvent,
  errorEvent,
  doneEvent,
  observedPhase,
  phaseRank,
  noteEventsFromText,
  createFileEnricher,
  type ProgressEvent,
  type Phase,
  type Workflow,
  type RunContext,
  type RunStatus,
  type FileScope,
} from "./progress.js";
import { skillStatus, updateSkills } from "./repo-setup.js";
import {
  createSession,
  openSession,
  closeSession,
  sessionEntryScreen,
  issueReviewPageLease,
  getReviewPageLease,
  type ReviewPageLease,
  type Session,
} from "./session.js";
import { inspectRepo } from "./repo-state.js";
import {
  forgetRecent,
  recordRecent,
  loadRecents,
  restoreRecent,
  type RecentEntry,
} from "./recents.js";
import {
  recallStorySelection,
  recordStorySelection,
} from "./story-selection.js";
import { listDirs } from "./fs-browse.js";
import {
  deleteStory,
  diffFingerprint,
  hasStories,
  listStories,
  listStoryMetadata,
  storyIdForPath,
  storyPathForId,
} from "./stories.js";
import { homedir } from "node:os";
import { callerEvidence } from "./landing-verify.js";
import { commentsPath } from "./config.js";
import { planStoryRefresh, validateStoryRefresh, storyRefreshPrompt } from "./story-refresh.js";
import { runStoryCheck, reportReady } from "./story-check.js";
import { captureVerification, canRunVerification, loadVerificationReceipts, verificationWorkspace } from "./verification.js";
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createAloudReader, type AloudReader } from "./aloud-client.js";
import { listCodexStoryModels } from "./codex-tasks.js";
import { LiveEventHub, storyFileFingerprint } from "./live.js";
import {
  isHistoryStoryId,
  listStoryHistory,
  liveStoryIdForSnapshot,
  restoreStoryVersion,
  snapshotStoryIfChanged,
} from "./story-history.js";
import { reviewStateSummary } from "./review-state.js";
import {
  DEFAULT_AUDIENCE,
  isStoryAudience,
  loadRepoPreferences,
  saveRepoPreferences,
} from "./repo-preferences.js";
import {
  bundleFileName,
  exportStoryBundle,
  importStoryBundle,
} from "./story-bundle.js";
import {
  captureStorySnapshot,
  inspectStoryDrift,
  loadStoryDriftDiff,
  type StoryDriftFileDiff,
  type StoryDriftReport,
  type StoryDriftExpectedBinding,
  type StorySnapshotRef,
} from "./story-drift.js";
import {
  editorLabel,
  editorNavigationTarget,
  openEditorTarget,
  openVSCodeTargetWithUrls,
  vscodeLaunchArgs,
  vscodeNavigationTarget,
  vscodeNavigationUrl,
  zedLaunchArgs,
  type EditorNavigationTarget,
} from "./editor.js";
import {
  isSourceEditor,
  loadEditorPreferences,
  saveSourceEditor,
  type SourceEditor,
} from "./editor-preferences.js";
import { verifyLogicMoves } from "./logic-moves.js";

export { verifyLogicMoves } from "./logic-moves.js";

export {
  editorNavigationTarget,
  vscodeLaunchArgs,
  vscodeNavigationTarget,
  vscodeNavigationUrl,
  zedLaunchArgs,
};
export type { EditorNavigationTarget };

// Only one agent run at a time: concurrent runs editing the same working tree would collide.
let agentBusy = false;

export interface ServeOptions {
  repo: string | null;
  port: number;
  baseOverride?: string;
  headOverride?: string;
  homeOverride?: string;
  aloud?: AloudReader;
  openEditor?: (target: EditorNavigationTarget, editor: SourceEditor) => boolean;
  openExternal?: (url: string) => boolean;
  open: boolean;
}

export function serve(opts: ServeOptions): Server {
  // Capture the home directory once. Besides making one server session stable,
  // this keeps parallel test servers from following later HOME mutations into
  // another test's recents, skills, or voice cache.
  const home = opts.homeOverride ?? homedir();
  const session = createSession({
    repo: opts.repo,
    base: opts.baseOverride,
    head: opts.headOverride,
  });
  const liveHub = new LiveEventHub({
    leaseActive: (token) => !!getReviewPageLease(session, token),
  });
  const aloud = opts.aloud ?? createAloudReader();
  const openEditor = opts.openEditor ?? ((target, editor) =>
    opts.openExternal && editor === "vscode"
      ? openVSCodeTargetWithUrls(target, opts.openExternal)
      : openEditorTarget(target, editor));
  const server = createServer((req, res) =>
    handle(req, res, session, home, liveHub, aloud, openEditor),
  );
  // Dispose the hub when close is REQUESTED, not on the 'close' event: the
  // server cannot finish closing while the hub still holds SSE responses open.
  const requestClose = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void) => {
    liveHub.dispose();
    return requestClose(callback);
  }) as typeof server.close;
  server.on("close", () => liveHub.dispose());

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${opts.port} is already in use.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  // This app can read repositories and launch local agents. Keep that surface
  // on the loopback interface even when the host machine is on a shared network.
  server.listen(opts.port, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : opts.port;
    const url = `http://localhost:${port}/`;
    if (session.repo == null) {
      console.log(`\n  ${APP_BRAND} app ready → ${url}`);
      console.log(
        `  pick a repo to review (or open one you've used before).\n`,
      );
    } else {
      const storyCount = listStoryMetadata(session.repo).length;
      const storyLabel = `${storyCount} ${storyCount === 1 ? "story" : "stories"}`;
      console.log(`\n  ${APP_BRAND} review ready → ${url}`);
      console.log(
        `  reviewing ${storyLabel} in ${join(session.repo, DATA_DIR)}`,
      );
      console.log(
        `  comments can be copied directly or queued in Review → Comments.\n`,
      );
    }
    console.log(`  Ctrl-C to stop.\n`);
    if (opts.open) openBrowser(url);
  });

  return server;
}

function noRepo(res: ServerResponse): void {
  sendJson(res, 409, { error: "No repo is open." });
}

/** Undefined means an unscoped legacy caller; null means a supplied dead lease. */
function optionalRequestLease(
  session: Session,
  url: URL,
): ReviewPageLease | null | undefined {
  const token = url.searchParams.get("page") ?? undefined;
  if (!token) return undefined;
  const lease = getReviewPageLease(session, token);
  if (!lease || !session.repo || lease.repo !== session.repo) return null;
  return lease;
}

function invalidFeedbackResponse(
  res: ServerResponse,
  health: Extract<CommentStoreHealth, { status: "invalid" }>,
): void {
  sendJson(res, 409, {
    error: `${health.message} ${health.recovery}`,
    feedbackHealth: health,
    reloadRequired: true,
  });
}

function sendCommentMutationError(res: ServerResponse, error: unknown): void {
  if (error instanceof InvalidCommentStoreError)
    return invalidFeedbackResponse(res, error.health);
  sendJson(res, 400, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function validateNewCommentForLease(
  input: NewComment,
  lease: ReviewPageLease | undefined,
): void {
  assertSafeRepoPath(input.file);
  if (!Number.isFinite(input.line) || Math.trunc(input.line) < 1) {
    throw new Error("comment line is required");
  }
  if (lease && !lease.fileFingerprints[input.file]) {
    throw new Error("comment file is not part of this review");
  }
}

function repoRouteBase(repo: string): string {
  return `/repo/${encodeURIComponent(basename(repo))}`;
}

function repoRoute(
  repo: string,
  screen: "stories" | "change" | "review" | "diff",
  search = "",
): string {
  return `${repoRouteBase(repo)}/${screen}${search}`;
}

function parseRepoRoute(
  pathname: string,
  repo: string | null,
): "stories" | "change" | "review" | "diff" | null {
  if (!repo) return null;
  const base = repoRouteBase(repo);
  if (pathname === base || pathname === `${base}/`) return "stories";
  if (!pathname.startsWith(`${base}/`)) return null;
  const screen = pathname.slice(base.length + 1);
  return screen === "stories" ||
    screen === "change" ||
    screen === "review" ||
    screen === "diff"
    ? screen
    : null;
}

/**
 * The desktop shell remembers its last /repo/<name>/... URL, while a freshly
 * started server has no open repository in memory. Rehydrate that session from
 * the persisted recents list so reopening the app does not strand the webview
 * on a 404. Recents are newest-first, which also resolves duplicate basenames
 * the same way the picker presents the most recently opened workspace.
 */
function recentRepoForRoute(pathname: string, home: string): string | null {
  const match = pathname.match(/^\/repo\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  let name: string;
  try {
    name = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return (
    loadRecents(home).find(
      (entry) => basename(entry.path) === name && isGitRepo(entry.path),
    )?.path ?? null
  );
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

function localHostname(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

/**
 * Reject DNS-rebinding hosts and browser cross-site requests. Requests from
 * curl/Node are still accepted when they address a loopback Host directly.
 */
function isTrustedLocalRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;

  let expected: URL;
  try {
    expected = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!localHostname(expected.hostname)) return false;

  const fetchSite = req.headers["sec-fetch-site"];
  if (
    typeof fetchSite === "string" &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  )
    return false;

  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const actual = new URL(origin);
    return (
      actual.protocol === "http:" &&
      localHostname(actual.hostname) &&
      actual.host === expected.host
    );
  } catch {
    return false;
  }
}

function setLocalResponseHeaders(res: ServerResponse): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'self'",
      "img-src 'self' data:",
      "media-src 'self' blob:",
      "script-src 'self' 'unsafe-inline'",
      // 'self' is required for the client stylesheet served from /assets/client;
      // 'unsafe-inline' still covers the inline styling the vanilla pages emit.
      "style-src 'self' 'unsafe-inline'",
    ].join("; "),
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
  home: string,
  liveHub: LiveEventHub,
  aloud: AloudReader,
  openEditor: (target: EditorNavigationTarget, editor: SourceEditor) => boolean,
): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  setLocalResponseHeaders(res);
  if (!isTrustedLocalRequest(req)) {
    return sendJson(res, 403, {
      error: "This local app only accepts same-origin localhost requests.",
    });
  }

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { app: "diffStory", ready: true });
    }
    if (method === "GET" && url.pathname === "/api/aloud/status") {
      return runAloudStatus(res, aloud);
    }
    if (method === "POST" && url.pathname === "/api/aloud/speak") {
      return readBody(req, res, (body) => runAloudSpeak(res, aloud, body));
    }
    if (method === "POST" && url.pathname === "/api/aloud/prepare") {
      return readBody(req, res, (body) => runAloudPrepare(res, aloud, body));
    }
    if (method === "POST" && url.pathname === "/api/aloud/control") {
      return readBody(req, res, (body) => runAloudControl(res, aloud, body));
    }
    if (method === "GET" && url.pathname === "/assets/mermaid.esm.min.mjs") {
      return sendMermaidBrowserAsset(res);
    }
    if (method === "GET" && url.pathname.startsWith("/assets/fonts/")) {
      return sendFontAsset(res, basename(url.pathname));
    }
    if (method === "GET" && url.pathname.startsWith("/assets/client/")) {
      return sendClientAsset(res, basename(url.pathname));
    }
    if (method === "GET" && url.pathname === "/api/events") {
      const lease = optionalRequestLease(session, url);
      if (!lease) {
        // 204 tells EventSource to stop reconnecting against a dead lease.
        res.statusCode = 204;
        res.end();
        return;
      }
      liveHub.connect(lease, req, res);
      return;
    }
    if (method === "GET" && url.pathname === "/") {
      if (session.repo == null) return sendHtml(res, pickerStub(home));
      // Back-compat for URLs emitted by older app builds.
      if (url.searchParams.has("story")) {
        return redirect(
          res,
          url.searchParams.get("story") === "new"
            ? repoRoute(session.repo, "change")
            : repoRoute(session.repo, "review", url.search),
        );
      }
      if (hasChangeQuery(url.searchParams)) {
        return redirect(res, repoRoute(session.repo, "change", url.search));
      }
      return redirect(
        res,
        repoRoute(session.repo, sessionEntryScreen(session), url.search),
      );
    }
    if (
      method === "GET" &&
      session.repo == null &&
      url.pathname.startsWith("/repo/")
    ) {
      const restoredRepo = recentRepoForRoute(url.pathname, home);
      if (!restoredRepo) return redirect(res, "/");
      openSession(session, restoredRepo);
      restoreStorySelection(session, home);
    }
    const repoScreen =
      method === "GET" ? parseRepoRoute(url.pathname, session.repo) : null;
    if (repoScreen === "stories") {
      // Reaching review history is the explicit "close story" transition. Keep
      // the persisted resume target aligned with the page the reviewer chose;
      // otherwise Home -> repo silently jumps back into the story they just
      // closed, which makes rapid navigation feel like it ignored them.
      const wasInsideStory =
        !session.chooseStory || typeof session.selectedStory === "string";
      session.chooseStory = true;
      session.selectedStory = undefined;
      if (wasInsideStory)
        recordStorySelection(home, session.repo as string, null, nowMs());
      return sendHtml(
        res,
        storyChooser(session, url.searchParams.get("evidence") === "refresh"),
      );
    }
    if (repoScreen === "change") {
      session.chooseStory = false;
      session.selectedStory = null;
      return sendHtml(res, changeScreen(session, url.searchParams));
    }
    if (repoScreen === "diff") {
      session.chooseStory = false;
      session.selectedStory = null;
      return sendHtml(res, diffScreen(session, url.searchParams));
    }
    if (repoScreen === "review") {
      return sendHtml(res, reviewScreen(session, url.searchParams, home));
    }
    if (method === "GET" && url.pathname === "/stories") {
      if (session.repo == null) return sendHtml(res, pickerStub(home));
      return redirect(res, repoRoute(session.repo, "stories"));
    }
    if (method === "GET" && url.pathname === "/repos") {
      // Home is a picker view, not a repository-close command. Keeping the
      // active session and its page leases alive makes browser Back/Forward
      // reliable; POST /api/repo/close remains the explicit close transition.
      return sendHtml(res, pickerStub(home));
    }
    if (method === "GET" && url.pathname === "/change") {
      if (session.repo == null) return sendHtml(res, pickerStub(home));
      return redirect(res, repoRoute(session.repo, "change", url.search));
    }
    if (method === "GET" && url.pathname === "/review") {
      if (session.repo == null) return sendHtml(res, pickerStub(home));
      return redirect(res, repoRoute(session.repo, "review", url.search));
    }
    if (method === "GET" && url.pathname === "/api/repos/recent") {
      return sendJson(res, 200, listRecentRepos(home));
    }
    if (method === "DELETE" && url.pathname === "/api/repos/recent") {
      return readBody(req, res, (body) => {
        let path = "";
        try {
          path = String(
            (JSON.parse(body || "{}") as { path?: string }).path ?? "",
          );
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        if (!path)
          return sendJson(res, 400, { error: "Missing repository path." });
        const before = loadRecents(home);
        const index = before.findIndex((entry) => entry.path === path);
        const removedEntry = index >= 0 ? before[index] : undefined;
        forgetRecent(home, path);
        return sendJson(res, 200, {
          ok: true,
          removed: Boolean(removedEntry),
          undo: removedEntry ? { entry: removedEntry, index } : null,
          recents: recentRowsForPicker(home),
        });
      });
    }
    if (method === "POST" && url.pathname === "/api/repos/recent/restore") {
      return readBody(req, res, (body) => {
        let raw: {
          undo?: { entry?: Partial<RecentEntry>; index?: unknown };
        };
        try {
          raw = JSON.parse(body || "{}") as typeof raw;
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        const candidate = raw.undo?.entry;
        const path = typeof candidate?.path === "string" ? candidate.path : "";
        const lastOpened = Number(candidate?.lastOpened);
        if (!path || !Number.isFinite(lastOpened)) {
          return sendJson(res, 400, {
            error: "A valid recent repository entry is required.",
          });
        }
        const entry: RecentEntry = { path, lastOpened };
        if (typeof candidate?.name === "string") entry.name = candidate.name;
        if (typeof candidate?.isGit === "boolean") entry.isGit = candidate.isGit;
        if (typeof candidate?.hasTour === "boolean") entry.hasTour = candidate.hasTour;
        if (
          candidate?.currentBranch === null ||
          typeof candidate?.currentBranch === "string"
        )
          entry.currentBranch = candidate.currentBranch;
        if (
          typeof candidate?.changedFiles === "number" &&
          Number.isFinite(candidate.changedFiles)
        )
          entry.changedFiles = candidate.changedFiles;
        const index = Number(raw.undo?.index);
        restoreRecent(home, entry, Number.isInteger(index) ? index : 0);
        return sendJson(res, 200, {
          ok: true,
          recents: recentRowsForPicker(home),
        });
      });
    }
    if (method === "GET" && url.pathname === "/api/agents") {
      return sendJson(res, 200, {
        agents: availableAgents(),
        skills: skillStatus(home),
      });
    }
    if (method === "GET" && url.pathname === "/api/settings/editor") {
      const editor = loadEditorPreferences(home).editor;
      return sendJson(res, 200, { editor, label: editorLabel(editor) });
    }
    if (method === "PUT" && url.pathname === "/api/settings/editor") {
      return readBody(req, res, (body) => {
        let value: unknown;
        try {
          value = (JSON.parse(body || "{}") as { editor?: unknown }).editor;
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        if (!isSourceEditor(value)) {
          return sendJson(res, 400, {
            error: "Choose Zed or VS Code as the source editor.",
          });
        }
        saveSourceEditor(home, value);
        return sendJson(res, 200, {
          ok: true,
          editor: value,
          label: editorLabel(value),
        });
      });
    }
    if (method === "GET" && url.pathname === "/api/verification") {
      const page = validateReviewPageLease(session, url.searchParams.get("page"));
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      try {
        const receipts = loadVerificationReceipts(home, page.repo);
        const workspace = receipts.length ? verificationWorkspace(page.repo, page.base) : "";
        const revision = resolveCommit(page.repo, "HEAD") ?? "unborn";
        return sendJson(res, 200, { checks: (page.tour.verification ?? []).map((entry) => {
          const receipt = [...receipts].reverse().find((row) => row.check === entry.check);
          return { receipt: receipt ?? null, current: !!receipt && receipt.sourceStable &&
            receipt.fingerprint === page.lease.fingerprint && receipt.workspace === workspace && receipt.revision === revision };
        }) });
      } catch (error) { return sendJson(res, 409, { error: (error as Error).message }); }
    }
    if (method === "POST" && url.pathname === "/api/verification/run") {
      return readBody(req, res, (body) => {
        const page = validateReviewPageLease(session, url.searchParams.get("page"));
        if (!page.ok) return sendReviewPageConflict(res, page.error);
        if (historyMutationError(session, page.lease)) return sendJson(res, 409, { error: "History snapshots are read-only." });
        if (agentBusy) return sendJson(res, 409, { error: "Another local run is already active." });
        try {
          const input = JSON.parse(body || "{}");
          const entry = Number.isInteger(input.index) ? page.tour.verification?.[input.index] : undefined;
          if (!entry || input.confirmed !== true) return sendJson(res, 400, { error: "Choose a check and confirm its exact command before running it." });
          if (!canRunVerification(page.repo, page.head)) return sendJson(res, 409, { error: "The checkout differs from the reviewed revision. Open that revision in a clean checkout before running this check." });
          const controller = new AbortController();
          res.once("close", () => controller.abort());
          agentBusy = true;
          captureVerification({ repo: page.repo, home, base: page.base, head: page.head, check: entry.check,
            fingerprint: page.lease.fingerprint, signal: controller.signal })
            .then((receipt) => sendJson(res, 200, { receipt, current: receipt.sourceStable }))
            .catch((error) => sendJson(res, 500, { error: (error as Error).message }))
            .finally(() => { agentBusy = false; });
        } catch (error) { return sendJson(res, 400, { error: (error as Error).message }); }
      });
    }
    if (method === "POST" && url.pathname === "/api/editor/caller") {
      return readBody(req, res, (body) => {
        const page = validateReviewPageLease(session, url.searchParams.get("page"));
        if (!page.ok) return sendReviewPageConflict(res, page.error);
        try {
          const input = JSON.parse(body || "{}");
          const step = orderedSteps(page.tour).find((candidate) => candidate.id === input.stepId);
          const landing = step && step.kind !== "concept" ? step.landing : undefined;
          const caller = landing?.calledBy?.find((name) => narrativeText(name) === input.caller);
          const evidence = landing && caller ? callerEvidence(page.repo, landing.symbol, caller, page.head) : null;
          if (!evidence) return sendJson(res, 404, { error: "No source match is available for that caller." });
          const currentLine = readWholeFile(page.repo, evidence.file)?.[evidence.line - 1]?.slice(0, 500);
          if (currentLine !== evidence.text) return sendJson(res, 409, { error: "The current source differs from the reviewed caller. Inspect the captured text or open the reviewed revision." });
          const target = editorNavigationTarget(page.repo, evidence.file, evidence.line, 1);
          const editor = loadEditorPreferences(home).editor;
          if (!target || !openEditor(target, editor)) return sendJson(res, 503, { error: "The caller source could not be opened in your editor." });
          return sendJson(res, 200, { ok: true });
        } catch (error) { return sendJson(res, 400, { error: (error as Error).message }); }
      });
    }
    if (method === "POST" && url.pathname === "/api/editor/open") {
      if (!session.repo) return noRepo(res);
      return readBody(req, res, (body) => {
        let input: { file?: unknown; line?: unknown; column?: unknown };
        try {
          input = JSON.parse(body || "{}") as typeof input;
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        const file = typeof input.file === "string" ? input.file : "";
        const line = Number(input.line);
        const column = Number(input.column);
        if (
          !file ||
          !Number.isInteger(line) ||
          line < 1 ||
          !Number.isInteger(column) ||
          column < 1
        ) {
          return sendJson(res, 400, {
            error: "A valid file, line, and column are required.",
          });
        }
        const page = validateReviewPageLease(
          session,
          url.searchParams.get("page"),
          file,
        );
        if (!page.ok) return sendReviewPageConflict(res, page.error);
        const allowed = new Set<string>([
          ...boundedReviewIndex(page.fileIndex).map(
            (candidate) => candidate.path,
          ),
          ...(page.storyless ? [] : storyReviewFiles(page.tour)),
        ]);
        if (!allowed.has(file))
          return sendJson(res, 400, {
            error: "That file is not part of this review.",
          });
        const editorTarget = editorNavigationTarget(
          page.repo,
          file,
          line,
          column,
        );
        if (!editorTarget)
          return sendJson(res, 400, {
            error: "That file path cannot be opened safely.",
          });
        const editor = loadEditorPreferences(home).editor;
        const label = editorLabel(editor);
        if (!openEditor(editorTarget, editor)) {
          return sendJson(res, 503, {
            error: `${label} could not be opened. Install ${label} or change the diffStory source editor preference.`,
          });
        }
        return sendJson(res, 200, { ok: true, editor, label });
      });
    }
    if (method === "GET" && url.pathname === "/api/codex/models") {
      listCodexStoryModels()
        .then((models) => sendJson(res, 200, { models }))
        .catch((error) =>
          sendJson(res, 502, { error: (error as Error).message }),
        );
      return;
    }
    if (method === "POST" && url.pathname === "/api/skills/update") {
      const updated = updateSkills(home);
      return sendJson(res, 200, {
        ok: true,
        installed: updated.installed,
        skills: updated.status,
      });
    }
    if (method === "GET" && url.pathname === "/api/fs") {
      const p = url.searchParams.get("path");
      return sendJson(res, 200, listDirs(p && p.trim() ? p : home));
    }
    if (method === "POST" && url.pathname === "/api/repo/open") {
      return readBody(req, res, (body) => {
        let path = "";
        try {
          path = String(
            (JSON.parse(body || "{}") as { path?: string }).path ?? "",
          );
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        if (!path || !isGitRepo(path)) {
          return sendJson(res, 400, { error: "Not a Git repository." });
        }
        if (session.repo && session.repo !== path)
          liveHub.closeRepo(session.repo);
        openSession(session, path);
        const previous = loadRecents(home).find((entry) => entry.path === path);
        const repoState = {
          path,
          name: basename(path),
          isGit: true,
          hasTour: hasStories(path),
          currentBranch: currentBranch(path),
          // The exact count belongs to review loading, not repository
          // navigation. Preserve the last observed value when one exists.
          changedFiles: previous?.changedFiles ?? 0,
        };
        recordRecent(home, path, nowMs(), repoState);
        sendJson(res, 200, {
          ...repoState,
          route: repoRoute(path, sessionEntryScreen(session)),
        });
      });
    }
    if (method === "POST" && url.pathname === "/api/repo/close") {
      if (session.repo) liveHub.closeRepo(session.repo);
      closeSession(session);
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE" && url.pathname === "/api/stories") {
      if (!session.repo) return noRepo(res);
      const repo = session.repo;
      return readBody(req, res, (body) => {
        let id = "";
        try {
          id = String((JSON.parse(body || "{}") as { id?: string }).id ?? "");
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        if (!id) return sendJson(res, 400, { error: "Missing story id." });
        const path = storyPathForId(repo, id);
        if (!path) return sendJson(res, 404, { error: "No such story." });
        deleteStory(repo, id);
        if (recallStorySelection(home, repo) === id)
          recordStorySelection(home, repo, null, nowMs());
        if (session.selectedStory === path) {
          session.selectedStory = undefined;
          session.chooseStory = true;
        }
        return sendJson(res, 200, {
          ok: true,
          removed: true,
          stories: listStories(repo),
        });
      });
    }
    if (method === "GET" && url.pathname === "/api/stories/history") {
      if (!session.repo) return noRepo(res);
      const id = url.searchParams.get("id") ?? "";
      if (!id || isHistoryStoryId(id))
        return sendJson(res, 400, { error: "Missing story id." });
      if (!storyPathForId(session.repo, id))
        return sendJson(res, 404, { error: "No such story." });
      return sendJson(res, 200, {
        id,
        history: listStoryHistory(session.repo, id),
      });
    }
    if (method === "POST" && url.pathname === "/api/stories/history/restore") {
      if (!session.repo) return noRepo(res);
      const repo = session.repo;
      return readBody(req, res, (body) => {
        let id = "";
        let name = "";
        try {
          const parsed = JSON.parse(body || "{}") as {
            id?: string;
            name?: string;
          };
          id = String(parsed.id ?? "");
          name = String(parsed.name ?? "");
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        if (!id || !name || isHistoryStoryId(id))
          return sendJson(res, 400, {
            error: "Missing story id or snapshot name.",
          });
        if (!storyPathForId(repo, id))
          return sendJson(res, 404, { error: "No such story." });
        if (!restoreStoryVersion(repo, id, name))
          return sendJson(res, 404, { error: "No such snapshot." });
        return sendJson(res, 200, {
          ok: true,
          stories: listStories(repo),
          history: listStoryHistory(repo, id),
        });
      });
    }
    if (method === "GET" && url.pathname === "/api/stories/bundle") {
      if (!session.repo) return noRepo(res);
      const id = url.searchParams.get("id") ?? "";
      if (!id) return sendJson(res, 400, { error: "Missing story id." });
      const path = storyPathForId(session.repo, id);
      if (!path) return sendJson(res, 404, { error: "No such story." });
      try {
        const bundle = exportStoryBundle(session.repo, path);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${bundleFileName(id)}"`,
        );
        res.setHeader("Cache-Control", "no-store");
        res.end(`${JSON.stringify(bundle, null, 2)}\n`);
      } catch (e) {
        return sendJson(res, 422, { error: (e as Error).message });
      }
      return;
    }
    if (method === "POST" && url.pathname === "/api/stories/bundle") {
      if (!session.repo) return noRepo(res);
      const repo = session.repo;
      return readBody(req, res, (body) => {
        let name = "";
        let data: unknown = null;
        try {
          const parsed = JSON.parse(body || "{}") as {
            name?: unknown;
            bundle?: unknown;
          };
          name = typeof parsed.name === "string" ? parsed.name : "";
          data = parsed.bundle ?? parsed;
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON." });
        }
        try {
          const { id } = importStoryBundle(repo, name, data);
          return sendJson(res, 201, { ok: true, id });
        } catch (e) {
          return sendJson(res, 422, { error: (e as Error).message });
        }
      });
    }
    if (method === "GET" && url.pathname === "/api/refs") {
      if (!session.repo) return noRepo(res);
      const ref = url.searchParams.get("ref")?.trim() || "";
      return sendJson(res, 200, {
        ...(ref ? { ref } : {}),
        current: currentBranch(session.repo),
        branches: listBranchRefs(session.repo),
        commits: listRecentCommits(session.repo, 0, ref || "--all"),
      });
    }
    if (method === "GET" && url.pathname === "/api/blame") {
      // Blame reads history, not the rendered diff, so it only needs the page's
      // own base..head — not the per-file freshness the diff endpoints enforce.
      const lease = getReviewPageLease(session, url.searchParams.get("page") ?? undefined);
      if (!lease || !session.repo || session.repo !== lease.repo) {
        return sendReviewPageConflict(res, "This review page is no longer active.");
      }
      const result = blameReviewLine(lease.repo, {
        base: lease.base,
        head: lease.head,
        side: url.searchParams.get("side") === "left" ? "left" : "right",
        file: url.searchParams.get("file") ?? "",
        line: Number(url.searchParams.get("line")),
      });
      if (!result) return sendJson(res, 404, { error: "Git has no blame for this line." });
      return sendJson(res, 200, result);
    }
    if (method === "GET" && url.pathname === "/api/fullfile") {
      const file = url.searchParams.get("file") ?? "";
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
        file,
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderFullFileResponse(page, file),
        file,
      );
    }
    if (method === "GET" && url.pathname === "/api/diff/split") {
      const file = url.searchParams.get("file") ?? "";
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
        file,
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderSplitResponse(page, file),
        file,
      );
    }
    if (method === "GET" && url.pathname === "/api/diff/context") {
      const file = url.searchParams.get("file") ?? "";
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
        file,
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderContextResponse(page, url.searchParams),
        file,
      );
    }
    if (method === "GET" && url.pathname === "/api/diff/file-panel") {
      const file = url.searchParams.get("file") ?? "";
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
        file,
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderFilePanelResponse(page, file),
        file,
      );
    }
    if (method === "GET" && url.pathname === "/api/review/step-panel") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderStoryStepResponse(page, url.searchParams.get("index") ?? ""),
      );
    }
    if (method === "GET" && url.pathname === "/api/review/concept-page") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      const index = Number.parseInt(url.searchParams.get("index") ?? "", 10);
      const step =
        !page.storyless && Number.isInteger(index) && index >= 1
          ? orderedSteps(page.tour)[index - 1]
          : undefined;
      if (!step || !isPageConcept(step))
        return sendJson(res, 404, { error: "This step has no concept page." });
      const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
      // The author's page runs in an opaque-origin sandbox, and offline unless
      // it opts into network. diffStory is the only document allowed to frame it.
      res.removeHeader("X-Frame-Options");
      res.setHeader("Content-Security-Policy", conceptPageCsp(step.network));
      return sendLeasedHtml(res, session, page, conceptPageDocument(step.page, theme));
    }
    if (method === "GET" && url.pathname === "/api/review/file-search") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      const query = (url.searchParams.get("q") ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 120);
      if (query.length < 2) return sendJson(res, 200, { query, files: [] });
      const matches = boundedReviewIndex(page.fileIndex)
        .map((entry) => materializePageFile(page, entry.path))
        .filter((file): file is DiffFile => !!file)
        .filter((file) =>
          file.hunks.some((hunk) =>
            hunk.lines.some(
              (line) =>
                line.type !== "ctx" &&
                line.content.toLowerCase().includes(query),
            ),
          ),
        )
        .map((file) => file.newPath);
      return sendJson(res, 200, { query, files: matches });
    }
    if (method === "GET" && url.pathname === "/api/review/trust") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(res, session, page, renderTrustResponse(page));
    }
    if (method === "GET" && url.pathname === "/api/review/coverage") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      // Coverage reads the whole diff, which takes long enough that the working
      // tree can move underneath it. sendLeasedHtml re-checks the race after
      // rendering for exactly this reason; a verdict is a trust claim, so it
      // gets the same treatment rather than reporting a tree that no longer is.
      const verdict = reviewCoverageVerdict(page);
      if (reviewPageRaceSignature(page.lease) !== page.raceSignature) {
        return sendReviewPageConflict(
          res,
          "The change moved while coverage was being calculated.",
        );
      }
      return sendJson(res, 200, verdict);
    }
    if (method === "GET" && url.pathname === "/api/review/excluded-file") {
      const page = validateReviewPageLease(
        session,
        url.searchParams.get("page"),
      );
      if (!page.ok) return sendReviewPageConflict(res, page.error);
      return sendLeasedHtml(
        res,
        session,
        page,
        renderExcludedFileResponse(page, url.searchParams.get("file") ?? ""),
      );
    }
    if (method === "GET" && url.pathname === "/api/story-drift") {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      if (!lease || lease.storyIdentity === "storyless")
        return sendJson(res, 409, { error: "No guided story is active." });
      try {
        const tour = loadTour(lease.storyPath);
        if (
          reviewStoryIdentity(lease.storyPath, tour, false) !==
          lease.storyIdentity
        ) {
          return sendReviewPageConflict(
            res,
            "The guided review changed after this page loaded.",
          );
        }
        return sendJson(
          res,
          200,
          storyDriftView(
            inspectStoryDrift({
              repo: lease.repo,
              snapshot: tour.storySnapshot,
              expected: storyDriftBinding(lease.base, lease.head, tour),
            }),
          ),
        );
      } catch (error) {
        return sendJson(res, 409, { error: (error as Error).message });
      }
    }
    if (method === "GET" && url.pathname === "/api/story-drift/file") {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      if (!lease || lease.storyIdentity === "storyless")
        return sendJson(res, 409, { error: "No guided story is active." });
      try {
        const tour = loadTour(lease.storyPath);
        if (
          reviewStoryIdentity(lease.storyPath, tour, false) !==
          lease.storyIdentity
        ) {
          return sendReviewPageConflict(
            res,
            "The guided review changed after this page loaded.",
          );
        }
        const loaded = loadStoryDriftDiff({
          repo: lease.repo,
          snapshot: tour.storySnapshot,
          expected: storyDriftBinding(lease.base, lease.head, tour),
          observationId: url.searchParams.get("observation") ?? "",
          path: url.searchParams.get("file") ?? "",
        });
        if (loaded.status === "unverified")
          return sendReviewPageConflict(
            res,
            loaded.reason ?? "The drift evidence changed.",
          );
        const layout =
          url.searchParams.get("layout") === "unified" ? "unified" : "split";
        return sendHtml(res, renderStoryDriftFileResponse(loaded, layout));
      } catch (error) {
        return sendReviewPageConflict(res, (error as Error).message);
      }
    }
    if (method === "GET" && url.pathname === "/api/review-state") {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      if (!session.repo) return noRepo(res);
      const data = lease
        ? reviewDataForLease(lease, false)
        : sessionReviewData(session);
      const summary = reviewStateSummary(
        lease?.repo ?? session.repo,
        data.base,
        data.head,
        data.diff,
        data.files,
        data.changeFingerprint,
      );
      return sendJson(res, 200, summary);
    }
    if (method === "GET" && url.pathname === "/api/comments") {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      const repo = lease?.repo ?? session.repo;
      if (!repo) return noRepo(res);
      const loaded = loadCommentsWithHealth(repo);
      if (loaded.health.status === "invalid")
        return invalidFeedbackResponse(res, loaded.health);
      return sendJson(
        res,
        200,
        commentsForStory(loaded.comments, activeStoryId(session, lease)),
      );
    }
    if (method === "POST" && url.pathname === "/api/comments") {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      const repo = lease?.repo ?? session.repo;
      if (!repo) return noRepo(res);
      const historyBlocked = historyMutationError(session, lease);
      if (historyBlocked) return sendJson(res, 409, { error: historyBlocked });
      return readBody(req, res, (body) => {
        try {
          const loaded = loadCommentsWithHealth(repo);
          if (loaded.health.status === "invalid")
            return invalidFeedbackResponse(res, loaded.health);
          const input = JSON.parse(body) as NewComment;
          validateNewCommentForLease(input, lease);
          // The server owns the story tag: a client cannot file feedback against a
          // story it is not reviewing, and an untagged page leaves it absent.
          const story = activeStoryId(session, lease);
          const comment = addComment(
            repo,
            story ? { ...input, story } : { ...input, story: undefined },
          );
          sendJson(res, 201, comment);
        } catch (e) {
          sendCommentMutationError(res, e);
        }
      });
    }
    if (method === "POST" && url.pathname === "/api/generate") {
      return readBody(req, res, (body) => runGenerate(res, session, body));
    }
    if (method === "POST" && url.pathname === "/api/story/repair") {
      return readBody(req, res, (body) => runStoryRepair(res, session, body));
    }
    if (method === "POST" && url.pathname === "/api/story/refresh") {
      return readBody(req, res, (body) => runStoryRefresh(res, session, url, body));
    }
    if (method === "PATCH" && url.pathname.startsWith("/api/comments/")) {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      const repo = lease?.repo ?? session.repo;
      if (!repo) return noRepo(res);
      const id = decodeURIComponent(
        url.pathname.slice("/api/comments/".length),
      );
      const patchBlocked = historyMutationError(session, lease);
      if (patchBlocked) return sendJson(res, 409, { error: patchBlocked });
      return readBody(req, res, (body) => {
        try {
          const input = JSON.parse(body || "{}") as {
            type?: string;
            body?: string;
            status?: string;
          };
          const story =
            lease === undefined ? undefined : activeStoryId(session, lease);
          const updated = updateComment(repo, id, input, story);
          if (updated) {
            sendJson(res, 200, updated);
          } else sendJson(res, 404, { error: "No such comment." });
        } catch (e) {
          sendCommentMutationError(res, e);
        }
      });
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/comments/")) {
      const lease = optionalRequestLease(session, url);
      if (lease === null)
        return sendReviewPageConflict(
          res,
          "This review page is no longer active.",
        );
      const repo = lease?.repo ?? session.repo;
      if (!repo) return noRepo(res);
      const id = decodeURIComponent(
        url.pathname.slice("/api/comments/".length),
      );
      const deleteBlocked = historyMutationError(session, lease);
      if (deleteBlocked) return sendJson(res, 409, { error: deleteBlocked });
      try {
        const loaded = loadCommentsWithHealth(repo);
        if (loaded.health.status === "invalid")
          return invalidFeedbackResponse(res, loaded.health);
        const story =
          lease === undefined ? undefined : activeStoryId(session, lease);
        const ok = deleteComment(repo, id, story);
        res.statusCode = ok ? 204 : 404;
        res.end();
      } catch (error) {
        sendCommentMutationError(res, error);
      }
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  } catch (e) {
    sendHtml(res, errorPage((e as Error).message), 500);
  }
}

/**
 * The repository picker shell.
 *
 * The whole route is `recentRowsForPicker(home)` plus two scalars, and it must
 * stay that cheap — Home is reachable from every page, and re-inspecting every
 * remembered repository here is what made it slow before (see the note on
 * `recentRowsForPicker`). `now` is the server clock: relative times like
 * "7 min ago" are computed against it in the browser so a skewed client clock
 * cannot invent a repository opened in the future.
 *
 * `ds-map-bg` is on <body> rather than in the React tree so the dot field is
 * painted with the first frame, before the bundle has parsed.
 */
function pickerStub(home: string): string {
  return renderShell<PickerPayload>({
    surface: "picker",
    title: "Pick a repository",
    bodyClass: "ds-map-bg",
    payload: { recents: recentRowsForPicker(home), home, now: Date.now() },
  });
}

/**
 * Review history — the saved-review list for the open repository.
 *
 * The `refreshEvidence` split is the whole performance story of this route and
 * is easy to lose. `listStoryMetadata()` reads the story files and nothing else:
 * it reports `freshness: 'unverified'` and zeroes for additions/deletions/open
 * comments, which is what makes reaching this page (every repo open lands here)
 * independent of repository size. `listStories()` rebuilds the diff and the
 * drift report for EVERY saved story, and only `?evidence=refresh` asks for it.
 * The flag travels in the payload so the UI can say "Saved" instead of dressing
 * unverified zeroes up as facts.
 *
 * `narrativeText()` runs here rather than in the browser: the authored title and
 * summary are narrative markup, this page renders plain text end to end, and
 * projecting server-side keeps `narrative.ts` out of the client bundle.
 */
function storyChooser(session: Session, refreshEvidence = false): string {
  const repo = session.repo as string;
  const summaries = refreshEvidence
    ? listStories(repo)
    : listStoryMetadata(repo);
  const stories: StoryRowView[] = summaries.map((s) => ({
    id: s.id,
    title: narrativeText(s.title),
    summary: narrativeText(s.summary),
    ...(s.valid ? {} : { error: s.error }),
    valid: s.valid,
    updatedAt: s.updatedAt,
    steps: s.steps,
    primers: s.primers,
    files: s.files,
    freshness: s.freshness,
    inStoryDrift: s.inStoryDrift,
    outsideStoryDrift: s.outsideStoryDrift,
    liveFiles: s.liveFiles,
    additions: s.additions,
    deletions: s.deletions,
    openComments: s.openComments,
    scope: { label: s.scope.label, command: s.scope.command },
  }));
  const repoName = basename(repo);
  return renderShell<StoriesPayload>({
    surface: "stories",
    title: `${repoName} Review history`,
    bodyClass: "ds-map-bg",
    payload: {
      repoName,
      routeBase: repoRouteBase(repo),
      stories,
      liveEvidence: refreshEvidence,
      now: Date.now(),
    },
  });
}

function hasChangeQuery(params: URLSearchParams): boolean {
  return (
    params.has("scope") ||
    params.has("base") ||
    params.has("head") ||
    params.has("commit")
  );
}

function reviewScreen(
  session: Session,
  params: URLSearchParams,
  home: string,
): string {
  const picked = applyStoryChoice(session, params, home);
  if (session.selectedStory === null) {
    return changeScreen(session, params);
  }

  // A built, VALID review uses the story's own base unless the URL explicitly
  // supplies a scope override. A missing or malformed story falls back to the
  // scope picker with a notice, never the raw error page.
  const storyFile = selectedStoryPath(session);
  if (existsSync(storyFile)) {
    try {
      loadTour(storyFile);
      const observed = session.repo
        ? storyIdForPath(session.repo, storyFile)
        : null;
      if (observed) snapshotStoryIfChanged(session.repo as string, observed);
      applyScope(session, params);
      return renderReview(session);
    } catch (e) {
      return changeScreen(session, params, (e as Error).message);
    }
  }
  if (picked) {
    return changeScreen(session, params, "That story could not be found.");
  }
  return changeScreen(session, params);
}

function applyStoryChoice(
  session: Session,
  params: URLSearchParams,
  home: string,
): boolean {
  if (!session.repo || !params.has("story")) return false;
  const id = params.get("story") ?? "";
  session.chooseStory = false;
  session.base = undefined;
  session.head = undefined;
  if (id === "new") {
    session.selectedStory = null;
    // The storyless change view is not a story, so stop resuming one.
    recordStorySelection(home, session.repo, null, nowMs());
    return true;
  }
  const path = storyPathForId(session.repo, id);
  session.selectedStory = path;
  // A history snapshot is a visit, not a resume target: reopening the repo
  // must land on the live story, never a frozen read-only version.
  if (path && !isHistoryStoryId(id))
    recordStorySelection(home, session.repo, id, nowMs());
  return true;
}

/**
 * Re-select the story this repo was last reviewing so a restart resumes it. A remembered
 * id that no longer resolves — the story was deleted or renamed — falls through to the
 * picker rather than guessing at a replacement.
 */
function restoreStorySelection(session: Session, home: string): void {
  if (!session.repo) return;
  const remembered = recallStorySelection(home, session.repo);
  if (!remembered) return;
  const path = storyPathForId(session.repo, remembered);
  if (!path) return;
  session.selectedStory = path;
  session.chooseStory = false;
}

function selectedStoryPath(session: Session): string {
  if (!session.repo) throw new Error("No repo is open.");
  return session.selectedStory ?? resolveStoryPath(session.repo);
}

/**
 * Which story owns the feedback on this surface, as a listStories() id. A rendered page
 * answers from its own lease rather than the session, so a tab reviewing one story keeps
 * its feedback scope even after another tab switches stories. `null` means no story is
 * active (the all-files change view), and those surfaces see the whole store.
 */
function leaseStoryId(lease: ReviewPageLease): string | null {
  return lease.storyIdentity === "storyless"
    ? null
    : storyIdForPath(lease.repo, lease.storyPath);
}

function activeStoryId(
  session: Session,
  lease?: ReviewPageLease | null,
): string | null {
  if (lease) return leaseStoryId(lease);
  if (!session.repo || session.selectedStory === null) return null;
  return storyIdForPath(session.repo, selectedStoryPath(session));
}

/**
 * History snapshots open read-only in review: comments, generation, and
 * repair all target the live story, so they refuse to run from a snapshot.
 */
function historyMutationError(
  session: Session,
  lease?: ReviewPageLease | null,
): string | null {
  return isHistoryStoryId(activeStoryId(session, lease))
    ? "This is a frozen history snapshot. Return to the live story to make changes."
    : null;
}

/** Apply a scope choice from the Your-change switcher (?scope=... | ?base= | ?head=). */
function applyScope(session: Session, params: URLSearchParams): void {
  if (params.get("scope") === "auto") {
    session.base = undefined;
    session.head = undefined;
    return;
  }
  if (hasChangeQuery(params)) {
    const scope = resolveScope(session.repo as string, params);
    session.base = scope.base;
    session.head = scope.head;
  }
}

/** Resolve scope from the request, stash it on the session, render the scope picker. */
function changeScreen(
  session: Session,
  params: URLSearchParams,
  notice?: string,
): string {
  const scope = resolveScope(session.repo as string, params);
  session.base = scope.base;
  session.head = scope.head;
  return renderChange(session, scope, notice);
}

/**
 * The "Your change" scope picker: choose what to diff, then open it in the
 * review viewer (the "Review N files" CTA).
 *
 * Also the review route's error surface — `reviewScreen()` reaches here with a
 * `notice` when a story is missing or will not parse, and that string is the
 * only explanation the reviewer gets. It travels in the payload; the React
 * surface renders it above the scope controls.
 *
 * `scope.base` / `scope.head` are what the session was just set to, so the
 * payload carries the RESOLVED pair rather than the raw query. That is what the
 * `/diff` link has to repeat for the viewer to diff the same two revs.
 */
function renderChange(session: Session, scope: Scope, notice?: string): string {
  const repo = session.repo as string;
  const summary = summarizeChange(repo, session.base, session.head);
  const scopeNotice = [scope.substitutionNote, summary.note].filter(Boolean).join(' ');
  return renderShell<ChangePayload>({
    surface: "change",
    title: "Choose review scope",
    bodyClass: "ds-map-bg",
    payload: {
      repoName: basename(repo),
      routeBase: repoRouteBase(repo),
      base: scope.base,
      ...(scope.head ? { head: scope.head } : {}),
      scopeLabel: scope.label,
      active: scope.active,
      ...(scope.branch ? { branch: scope.branch } : {}),
      ...(scope.from ? { branchFrom: scope.from } : {}),
      files: summary.files,
      ...(notice ? { notice } : {}),
      ...(scopeNotice ? { scopeNotice } : {}),
    },
  });
}

/** Resolve scope, then render the story-less *review viewer* for it: the real
 *  review page with no story — All-files (the diff) by default, with the Story
 *  tab offering the guided-review generator. This is where "Open the diff" lands. */
function diffScreen(session: Session, params: URLSearchParams): string {
  const scope = resolveScope(session.repo as string, params);
  session.base = scope.base;
  session.head = scope.head;
  const repo = session.repo as string;
  const data = sessionReviewIndex(session);
  const { base, head, fileIndex } = data;
  const reviewState = reviewStateSummary(
    repo,
    base,
    head,
    "",
    [],
    data.changeFingerprint,
  );
  const tour: Tour = { version: 1, title: "", summary: "", steps: [], base };
  const storyPath = selectedStoryPath(session);
  const pageLease = issueReviewPageLease(session, {
    repo,
    base,
    ...(head ? { head } : {}),
    fingerprint: data.changeFingerprint,
    scopeKey: reviewState.scopeKey,
    mode: "full",
    storyIdentity: reviewStoryIdentity(storyPath, tour, true),
    storyPath,
    storyFingerprint: storyFileFingerprint(storyPath),
    fileFingerprints: reviewIndexFingerprints(
      fileIndex,
      tour,
      true,
      data.changeFingerprint,
    ),
  });
  cacheReviewPageSnapshot(
    pageLease.token,
    { tour, base, head, fileIndex },
    true,
    reviewPageRaceSignature(pageLease, data.sourceFingerprint),
  );
  return renderReviewShell({
    repo,
    tour,
    files: [],
    fileIndex: boundedReviewIndex(fileIndex),
    baseLabel: describeBase(repo, base),
    audience: loadRepoPreferences(repo).audience ?? DEFAULT_AUDIENCE,
    headRef: head,
    comments: loadComments(repo),
    routeBase: repoRouteBase(repo),
    repoName: basename(repo),
    storyless: true,
    reviewState,
    reviewPageToken: pageLease.token,
    storyKey: pageLease.storyIdentity,
    stagedWorktreeDivergentFiles: data.stagedWorktreeDivergentFiles,
    excludedFiles: data.excludedFiles,
  });
}

/** The recents list, each entry enriched with its current repo state for the picker. */
function listRecentRepos(home: string) {
  return loadRecents(home).map((e) => ({
    ...inspectRepo(e.path),
    lastOpened: e.lastOpened,
  }));
}

/**
 * Navigation home must not synchronously re-inspect every recent repository.
 * Opening a repo already validates it and records a state snapshot; older
 * recents without one get safe display defaults and are validated when opened.
 * A missing path is the one cheap freshness check worth doing on this path.
 */
function recentRowsForPicker(home: string) {
  return loadRecents(home).map((entry) => ({
    path: entry.path,
    name: entry.name ?? basename(entry.path),
    isGit: existsSync(entry.path) && (entry.isGit ?? true),
    hasTour: entry.hasTour ?? false,
    currentBranch: entry.currentBranch ?? null,
    changedFiles: entry.changedFiles ?? 0,
    lastOpened: entry.lastOpened,
  }));
}

interface ReviewData {
  tour: Tour;
  base: string;
  head?: string;
  diff: string;
  files: DiffFile[];
  changeFingerprint: string;
}

interface ReviewIndexData {
  tour: Tour;
  base: string;
  head?: string;
  fileIndex: ReviewFileIndexEntry[];
  changeFingerprint: string;
  sourceFingerprint: string;
  stagedWorktreeDivergentFiles: string[];
  excludedFiles: ReviewExclusionMetadata[];
}

interface ReviewPageSnapshot {
  tour: Tour;
  base: string;
  head?: string;
  fileIndex: ReviewFileIndexEntry[];
  storyless: boolean;
  sourceSignature: string;
}

// Lazy evidence must reuse the immutable snapshot that produced its page.
// Re-reading and parsing the complete diff for one off-screen panel defeats the
// lazy boundary and makes every click scale with total change size.
const reviewPageSnapshots = new Map<string, ReviewPageSnapshot>();

/**
 * Capture the initial review from bounded Git metadata only. This deliberately
 * does not call getDiff() or parseUnifiedDiff(); exact file bodies belong to
 * the lazy detail boundary.
 */
function sessionReviewIndex(
  session: Session,
  requireSelectedStory = false,
): ReviewIndexData {
  if (!session.repo) throw new Error("No repo is open.");
  const repo = session.repo;
  let tour: Tour = { version: 1, title: "", summary: "", steps: [] };
  if (session.selectedStory !== null) {
    try {
      tour = loadTour(selectedStoryPath(session));
    } catch (error) {
      if (requireSelectedStory) throw error;
    }
  }

  const sessionHasScope =
    session.base !== undefined || session.head !== undefined;
  let base = resolveBase(repo, session.base ?? tour.base);
  let head = session.head ?? tour.head;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const indexSnapshot = reviewChangeIndexSnapshot(repo, base, head);
    const fileIndex = indexSnapshot.fileIndex;
    if (
      !sessionHasScope &&
      tour.base === "HEAD" &&
      head === undefined &&
      fileIndex.length === 0 &&
      !isDirtyExceptHistory(repo)
    ) {
      base = hasParentCommit(repo) ? "HEAD~1" : emptyTree(repo);
      head = "HEAD";
      continue;
    }
    return {
      tour,
      base,
      head,
      fileIndex,
      changeFingerprint: indexSnapshot.changeFingerprint,
      sourceFingerprint: indexSnapshot.sourceFingerprint,
      stagedWorktreeDivergentFiles: indexSnapshot.stagedWorktreeDivergentFiles,
      excludedFiles: indexSnapshot.excludedFiles,
    };
  }
  throw new Error(
    "The change is moving too quickly to capture a stable review index. Try again.",
  );
}

function reviewIndexFingerprints(
  fileIndex: readonly ReviewFileIndexEntry[],
  tour: Tour,
  storyless: boolean,
  changeFingerprint: string,
): Record<string, string> {
  const fingerprints = Object.create(null) as Record<string, string>;
  for (const file of fileIndex) fingerprints[file.path] = file.reviewHash;
  if (!storyless) {
    // Context-only and move-endpoint paths are live evidence too. Using the
    // stricter whole-change identity is safe: any concurrent change invalidates
    // their lazy request.
    for (const file of storyReviewFiles(tour)) {
      if (!fingerprints[file]) fingerprints[file] = changeFingerprint;
    }
  }
  return fingerprints;
}

function boundedReviewIndex(
  fileIndex: readonly ReviewFileIndexEntry[],
): ReviewFileIndexEntry[] {
  return fileIndex.filter(
    (file) =>
      !file.binary && !file.large && !file.generated && !file.metadataOnly,
  );
}

function cacheReviewPageSnapshot(
  token: string,
  data: Omit<ReviewPageSnapshot, "storyless" | "sourceSignature">,
  storyless: boolean,
  sourceSignature: string,
): void {
  reviewPageSnapshots.set(token, { ...data, storyless, sourceSignature });
  while (reviewPageSnapshots.size > 16) {
    const oldest = reviewPageSnapshots.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    reviewPageSnapshots.delete(oldest);
  }
}

function reviewDiff(
  repo: string,
  session: Session,
  tour: Tour,
): { base: string; head?: string; diff: string } {
  const sessionHasScope =
    session.base !== undefined || session.head !== undefined;
  let base = resolveBase(repo, session.base ?? tour.base);
  let head = session.head ?? tour.head;
  let diff = getDiff(repo, base, head);

  if (
    !sessionHasScope &&
    tour.base === "HEAD" &&
    head === undefined &&
    diff.trim() === "" &&
    !isDirtyExceptHistory(repo)
  ) {
    base = hasParentCommit(repo) ? "HEAD~1" : emptyTree(repo);
    head = "HEAD";
    diff = getDiff(repo, base, head);
  }

  return { base, head, diff };
}

function loadReview(session: Session): Omit<ReviewData, "changeFingerprint"> {
  if (!session.repo) throw new Error("No repo is open.");
  const repo = session.repo;
  const tour = loadTour(selectedStoryPath(session));
  const { base, head, diff } = reviewDiff(repo, session, tour);
  const files = parseUnifiedDiff(diff);
  return { tour, base, head, diff, files };
}

function renderReview(session: Session): string {
  const repo = session.repo as string;
  const data = sessionReviewIndex(session, true);
  const { tour, base, head, fileIndex } = data;
  const reviewState = reviewStateSummary(
    repo,
    base,
    head,
    "",
    [],
    data.changeFingerprint,
  );
  const storyDrift = tour.storySnapshot
    ? storyDriftView(
        inspectStoryDrift({
          repo,
          snapshot: tour.storySnapshot,
          expected: storyDriftBinding(base, head, tour),
        }),
      )
    : undefined;
  const storyPath = selectedStoryPath(session);
  const onScreenId = storyIdForPath(repo, storyPath);
  const historyNotice =
    onScreenId && isHistoryStoryId(onScreenId)
      ? historyNoticeFor(repo, onScreenId)
      : undefined;
  const pageLease = issueReviewPageLease(session, {
    repo,
    base,
    ...(head ? { head } : {}),
    fingerprint: data.changeFingerprint,
    scopeKey: reviewState.scopeKey,
    mode: "full",
    storyIdentity: reviewStoryIdentity(storyPath, tour, false),
    storyPath,
    storyFingerprint: storyFileFingerprint(storyPath),
    fileFingerprints: reviewIndexFingerprints(
      fileIndex,
      tour,
      false,
      data.changeFingerprint,
    ),
  });
  cacheReviewPageSnapshot(
    pageLease.token,
    { tour, base, head, fileIndex },
    false,
    reviewPageRaceSignature(pageLease, data.sourceFingerprint),
  );
  return renderReviewShell({
    repo,
    routeBase: repoRouteBase(repo),
    repoName: basename(repo),
    tour,
    files: [],
    fileIndex: boundedReviewIndex(fileIndex),
    baseLabel: describeBase(repo, base),
    audience: loadRepoPreferences(repo).audience ?? DEFAULT_AUDIENCE,
    headRef: head,
    comments: commentsForStory(
      loadComments(repo),
      activeStoryId(session, pageLease),
    ),
    reviewState,
    reviewPageToken: pageLease.token,
    storyKey: pageLease.storyIdentity,
    storyDrift,
    stagedWorktreeDivergentFiles: data.stagedWorktreeDivergentFiles,
    excludedFiles: data.excludedFiles,
    ...(historyNotice ? { history: historyNotice } : {}),
  });
}

/** Banner facts for a history snapshot on screen; undefined when unresolvable. */
function historyNoticeFor(
  repo: string,
  id: string,
): { takenAt: string; liveId: string } | undefined {
  const liveId = liveStoryIdForSnapshot(repo, id.slice("history/".length));
  if (!liveId) return undefined;
  try {
    return {
      takenAt: new Date(
        statSync(join(repo, DATA_DIR, id)).mtimeMs,
      ).toISOString(),
      liveId,
    };
  } catch {
    return undefined;
  }
}

function readSessionReviewData(
  session: Session,
  requireSelectedStory = false,
): Omit<ReviewData, "changeFingerprint"> {
  if (!session.repo) throw new Error("No repo is open.");
  if (session.selectedStory !== null) {
    try {
      return loadReview(session);
    } catch (error) {
      if (requireSelectedStory) throw error;
      // A broken or missing story must not prevent comments and review checkpoints
      // from using the real diff underneath it.
    }
  }
  const repo = session.repo;
  const base = resolveBase(repo, session.base);
  const head = session.head;
  const diff = getDiff(repo, base, head);
  return {
    tour: { version: 1, title: "", summary: "", steps: [], base },
    base,
    head,
    diff,
    files: parseUnifiedDiff(diff),
  };
}

/** Read diff evidence and its full-change fingerprint as one optimistic
 * snapshot. A changing working tree is retried; it is never paired with a
 * fingerprint from a different repository state. */
function sessionReviewScope(
  session: Session,
  requireSelectedStory: boolean,
): { base: string; head?: string } {
  const repo = session.repo as string;
  if (session.selectedStory !== null) {
    try {
      const tour = loadTour(selectedStoryPath(session));
      return {
        base: resolveBase(repo, session.base ?? tour.base),
        head: session.head ?? tour.head,
      };
    } catch (error) {
      if (requireSelectedStory) throw error;
    }
  }
  return { base: resolveBase(repo, session.base), head: session.head };
}

function sessionReviewData(
  session: Session,
  requireSelectedStory = false,
): ReviewData {
  if (!session.repo) throw new Error("No repo is open.");
  const repo = session.repo;
  let expectedScope = sessionReviewScope(session, requireSelectedStory);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = reviewChangeFingerprint(
      repo,
      expectedScope.base,
      expectedScope.head,
    );
    const data = readSessionReviewData(session, requireSelectedStory);
    if (
      data.base !== expectedScope.base ||
      (data.head ?? "") !== (expectedScope.head ?? "")
    ) {
      expectedScope = { base: data.base, head: data.head };
      continue;
    }
    const confirmedFingerprint = reviewChangeFingerprint(
      repo,
      data.base,
      data.head,
    );
    if (confirmedFingerprint === before) {
      return { ...data, changeFingerprint: confirmedFingerprint };
    }
  }
  throw new Error(
    "The change is moving too quickly to capture a stable review snapshot. Try again.",
  );
}

interface LeasedReviewPage {
  ok: true;
  lease: ReviewPageLease;
  /** Cheap live-source signature captured after the full lease validation. */
  raceSignature: string;
  repo: string;
  tour: Tour;
  base: string;
  head?: string;
  diff: string;
  fileIndex: ReviewFileIndexEntry[];
  /** Complete scope files used for identity and exclusions. */
  fullFiles: DiffFile[];
  /** Exact file diff presented by this page (full or since-feedback). */
  files: DiffFile[];
  storyless: boolean;
}

type ReviewPageLeaseResult = LeasedReviewPage | { ok: false; error: string };

function reviewPageRaceSignature(
  lease: ReviewPageLease,
  sourceFingerprint?: string,
): string {
  const paths = lease.head
    ? [lease.storyPath]
    : [
        lease.storyPath,
        ...Object.keys(lease.fileFingerprints).map((file) =>
          join(lease.repo, file),
        ),
      ];
  return `${sourceFingerprint ?? reviewSourceMetadataFingerprint(lease.repo, lease.base, lease.head)}\0${paths
    .sort()
    .map((path) => {
      try {
        const stat = statSync(path, { bigint: true });
        return `${path}\0${stat.size}\0${stat.mtimeNs}\0${stat.mode}`;
      } catch {
        return `${path}\0missing`;
      }
    })
    .join("\0")}`;
}

function reviewStoryIdentity(
  storyPath: string,
  tour: Tour,
  storyless: boolean,
): string {
  if (storyless) return "storyless";
  return diffFingerprint(`${storyPath}\0${JSON.stringify(tour)}`);
}

/** Re-read exactly the immutable scope and story named by a page lease. */
function reviewDataForLease(
  lease: ReviewPageLease,
  requireStory = true,
): ReviewData {
  const storyless = lease.storyIdentity === "storyless";
  let tour: Tour = {
    version: 1,
    title: "",
    summary: "",
    steps: [],
    base: lease.base,
  };
  if (!storyless) {
    try {
      tour = loadTour(lease.storyPath);
    } catch (error) {
      // A broken or missing story must not prevent comments, review state, and
      // checkpoints from using the real diff underneath it.
      if (requireStory) throw error;
    }
  }
  // The fingerprint covers strictly more state than the diff, so an unchanged
  // fingerprint on both sides of the diff read proves the pair is consistent.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const changeFingerprint = reviewChangeFingerprint(
      lease.repo,
      lease.base,
      lease.head,
    );
    const diff = getDiff(lease.repo, lease.base, lease.head);
    const confirmedFingerprint = reviewChangeFingerprint(
      lease.repo,
      lease.base,
      lease.head,
    );
    if (changeFingerprint === confirmedFingerprint) {
      return {
        tour,
        base: lease.base,
        ...(lease.head ? { head: lease.head } : {}),
        diff,
        files: parseUnifiedDiff(diff),
        changeFingerprint,
      };
    }
  }
  throw new Error(
    "The change is moving too quickly to capture a stable review snapshot. Try again.",
  );
}

/** Identity of exactly what one file panel can render. Changed files are fully
 * identified by their parsed base-to-current diff; context-only story files
 * fall back to their current contents. */
function reviewFileFingerprint(
  repo: string,
  head: string | undefined,
  files: DiffFile[],
  file: string,
): string | undefined {
  const diffFile = files.find((candidate) => candidate.newPath === file);
  if (diffFile) return diffFingerprint(JSON.stringify({ diffFile }));
  const currentLines = readWholeFile(repo, file, head);
  if (currentLines === null) return undefined;
  return diffFingerprint(JSON.stringify({ currentLines }));
}

/**
 * Resolve an opaque page token and re-check every piece of review identity
 * against one stable live read. The stored mode/from marker is authoritative;
 * lazy callers cannot promote a since-feedback page into the full diff.
 */
function validateReviewPageLease(
  session: Session,
  token: string | null,
  file?: string,
): ReviewPageLeaseResult {
  const lease = getReviewPageLease(session, token ?? undefined);
  if (!lease)
    return { ok: false, error: "This review page is no longer active." };
  if (!session.repo || session.repo !== lease.repo) {
    return {
      ok: false,
      error: "The repository changed after this review page loaded.",
    };
  }

  const storyless = lease.storyIdentity === "storyless";
  const snapshot = reviewPageSnapshots.get(lease.token);

  if (snapshot) {
    try {
      const liveTour = storyless ? snapshot.tour : loadTour(lease.storyPath);
      if (
        reviewStoryIdentity(lease.storyPath, liveTour, storyless) !==
        lease.storyIdentity
      ) {
        return {
          ok: false,
          error: "The guided review changed after this page loaded.",
        };
      }
      const liveSourceSignature = reviewPageRaceSignature(lease);
      const unchangedByMetadata =
        liveSourceSignature === snapshot.sourceSignature;
      const liveFingerprint = unchangedByMetadata
        ? lease.fingerprint
        : reviewChangeFingerprint(lease.repo, lease.base, lease.head);
      const unchangedWholeReview =
        unchangedByMetadata || liveFingerprint === lease.fingerprint;
      const unchangedRequestedFile =
        !unchangedWholeReview && file
          ? reviewFileIndex(lease.repo, lease.base, lease.head).find(
              (entry) => entry.path === file,
            )?.reviewHash === lease.fileFingerprints[file]
          : false;
      if (unchangedWholeReview || unchangedRequestedFile) {
        return {
          ok: true,
          lease,
          raceSignature: liveSourceSignature,
          repo: lease.repo,
          tour: snapshot.tour,
          base: snapshot.base,
          head: snapshot.head,
          diff: "",
          fileIndex: snapshot.fileIndex,
          fullFiles: [],
          files: [],
          storyless: snapshot.storyless,
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: storyless
          ? "The review evidence moved while this page was open."
          : `The selected story cannot be validated: ${(error as Error).message}`,
      };
    }
  }

  let data: ReviewData;
  try {
    data = reviewDataForLease(lease);
  } catch (error) {
    return {
      ok: false,
      error: storyless
        ? "The review evidence moved while this page was open."
        : `The selected story cannot be validated: ${(error as Error).message}`,
    };
  }
  const reviewState = reviewStateSummary(
    lease.repo,
    data.base,
    data.head,
    data.diff,
    data.files,
    data.changeFingerprint,
  );
  if (
    data.base !== lease.base ||
    (data.head ?? "") !== (lease.head ?? "") ||
    reviewState.scopeKey !== lease.scopeKey
  ) {
    return {
      ok: false,
      error: "The review scope changed after this page loaded.",
    };
  }
  if (
    reviewStoryIdentity(lease.storyPath, data.tour, storyless) !==
    lease.storyIdentity
  ) {
    return {
      ok: false,
      error: "The guided review changed after this page loaded.",
    };
  }
  const files = data.files;
  if (data.changeFingerprint !== lease.fingerprint) {
    const leasedFileFingerprint = file
      ? lease.fileFingerprints[file]
      : undefined;
    const currentFileFingerprint = file
      ? reviewFileFingerprint(lease.repo, data.head, files, file)
      : undefined;
    if (
      !leasedFileFingerprint ||
      currentFileFingerprint !== leasedFileFingerprint
    ) {
      return {
        ok: false,
        error: "The change moved after this review page loaded.",
      };
    }
  }
  return {
    ok: true,
    lease,
    raceSignature: reviewPageRaceSignature(lease),
    repo: lease.repo,
    tour: data.tour,
    base: data.base,
    head: data.head,
    diff: data.diff,
    fileIndex: reviewFileIndex(lease.repo, data.base, data.head),
    fullFiles: data.files,
    files,
    storyless,
  };
}

function sendReviewPageConflict(res: ServerResponse, detail: string): void {
  sendJson(res, 409, {
    error: `Reload required: ${detail}`,
    detail,
    reloadRequired: true,
  });
}

/** Re-check after synchronous rendering to close the external working-tree race. */
function sendLeasedHtml(
  res: ServerResponse,
  _session: Session,
  page: LeasedReviewPage,
  html: string,
  _file?: string,
): void {
  // The expensive full fingerprint was checked immediately before rendering.
  // Re-stat only the live files the renderer could have read to close that
  // synchronous race without making every lazy request hash the whole change
  // a second time. Fixed-ref evidence is immutable; only its story file is live.
  if (reviewPageRaceSignature(page.lease) !== page.raceSignature) {
    return sendReviewPageConflict(
      res,
      "The change moved while this panel was loading.",
    );
  }
  sendHtml(res, html);
}

function materializePageFile(
  page: LeasedReviewPage,
  file: string,
): DiffFile | undefined {
  const already = page.files.find((candidate) => candidate.newPath === file);
  if (already) return already;
  const entry = page.fileIndex.find((candidate) => candidate.path === file);
  if (
    !entry ||
    entry.binary ||
    entry.large ||
    entry.generated ||
    entry.metadataOnly
  )
    return undefined;
  const diff = getFileDiff(page.repo, page.base, file, page.head);
  return parseUnifiedDiff(diff).find((candidate) => candidate.newPath === file);
}

/** Every path a story may legitimately navigate to, including move endpoints. */
function storyReviewFiles(tour: Tour): string[] {
  const files = new Set<string>();
  for (const step of tour.steps) {
    if (!isCodeStep(step)) continue;
    files.add(step.file);
    if ("moves" in step) {
      for (const move of step.moves ?? []) {
        files.add(move.before.file);
        files.add(move.after.file);
      }
    }
  }
  return [...files];
}

/** The lazily-loaded "Full file" side-by-side view for one file. Works with or
 *  without a story: story-less, there's no coverage to flag, so it's just the
 *  diff reconstructed against the working tree. */
function renderFullFileResponse(page: LeasedReviewPage, file: string): string {
  if (!file) return `<div class="ds-diffnote">No file requested.</div>`;
  const { repo, tour, head, storyless } = page;
  const allowed = new Set<string>([
    ...boundedReviewIndex(page.fileIndex).map((entry) => entry.path),
    ...(storyless ? [] : storyReviewFiles(tour)),
  ]);
  if (!allowed.has(file))
    return `<div class="ds-diffnote">That file isn't part of this change.</div>`;

  const df = materializePageFile(page, file);
  const files = df ? [df] : [];
  const newLines = readWholeFile(repo, file, head) ?? [];
  const ranges = storyless
    ? []
    : computeCoverage(tour, filesForStoryCoverage(tour, files))
        .uncovered.filter((u) => u.file === file)
        .map((u) => u.range);
  const rows = buildFullFileRows(df, newLines, ranges);
  return renderFullFile(rows, {
    file,
    oldFile: df?.oldPath,
    newFile: df?.status === "added",
  });
}

/** The lazily-loaded Split (hunks-only, side-by-side) view for one file. Mirrors
 *  renderFullFileResponse's scope rules exactly, including allowing context-only
 *  files (referenced by a context step but absent from the diff itself). */
function renderSplitResponse(page: LeasedReviewPage, file: string): string {
  if (!file) return `<div class="ds-diffnote">No file requested.</div>`;
  const { repo, tour, head, storyless } = page;
  const allowed = new Set<string>([
    ...boundedReviewIndex(page.fileIndex).map((entry) => entry.path),
    ...(storyless ? [] : storyReviewFiles(tour)),
  ]);
  if (!allowed.has(file))
    return `<div class="ds-diffnote">That file isn't part of this change.</div>`;

  const df = materializePageFile(page, file);
  const files = df ? [df] : [];
  const ranges = storyless
    ? []
    : computeCoverage(tour, filesForStoryCoverage(tour, files))
        .uncovered.filter((u) => u.file === file)
        .map((u) => u.range);
  // Prefer a scope read from the post-change file; git's own funcname is the
  // fallback when the file cannot be read at this revision.
  const newLines =
    df && df.status !== "deleted" ? readWholeFile(repo, file, head) : undefined;
  const scopes = df
    ? df.hunks.map(
        (h) =>
          (newLines ? enclosingScopeLabel(newLines, h.newStart) : undefined) ??
          h.context,
      )
    : [];
  return renderSplitHunks(hunksToSbsBlocks(df, ranges), {
    file,
    oldFile: df?.oldPath,
    newFile: df?.status === "added",
    hunkRanges: df ? df.hunks.map(hunkNewRange) : [],
    canExpand: df ? df.status !== "deleted" : false,
    scopes,
  });
}

/** Render one All-files detail on demand so large reviews do not ship every
 * syntax-highlighted file into the initial document. */
function renderFilePanelResponse(page: LeasedReviewPage, file: string): string {
  if (!file) return `<div class="ds-diffnote">No file requested.</div>`;
  const { repo, tour, head, storyless } = page;
  const entry = page.fileIndex.find((candidate) => candidate.path === file);
  if (
    entry &&
    (entry.binary || entry.large || entry.generated || entry.metadataOnly)
  ) {
    return `<div class="ds-diffnote">This file stays outside the bounded diff renderer. Open Trust check to inspect its safe preview.</div>`;
  }
  const df = materializePageFile(page, file);
  const files = df ? [df] : [];
  const model = buildReviewModel(repo, tour, files, head, {
    storyless,
    detailedStepIndexes: new Set(),
    detailedFilePaths: new Set([file]),
    includeTrustRows: false,
    baseRef: page.base,
    fileIndex: entry ? [entry] : undefined,
  });
  const view = model.files.find((candidate) => candidate.file === file);
  if (!view)
    return `<div class="ds-diffnote">That file isn't part of this change.</div>`;
  const stepIndexById = new Map(
    model.steps.map((step, index) => [step.id, index + 1]),
  );
  return renderFilePanelContent(view, stepIndexById);
}

/** Render a single guided-review step on demand. The index is the 1-based
 * panel index used by the client (Overview is panel 0). */
function renderStoryStepResponse(
  page: LeasedReviewPage,
  rawIndex: string,
): string {
  if (page.storyless)
    return `<div class="ds-diffnote">No guided story is selected.</div>`;
  const index = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(index) || index < 1) {
    return `<div class="ds-diffnote">No valid story step requested.</div>`;
  }
  const { repo, tour, head } = page;
  const step = orderedSteps(tour)[index - 1];
  const df =
    step && isCodeStep(step) ? materializePageFile(page, step.file) : undefined;
  const files = df ? [df] : [];
  const model = buildReviewModel(repo, tour, files, head, {
    storyless: false,
    detailedStepIndexes: new Set([index - 1]),
    detailedFilePaths: new Set(),
    includeTrustRows: false,
    baseRef: page.base,
  });
  return renderStoryStepPanel(
    repo,
    model,
    commentsForStory(loadComments(repo), leaseStoryId(page.lease)),
    index - 1,
  );
}

function renderTrustResponse(page: LeasedReviewPage): string {
  const diff = getDiff(page.repo, page.base, page.head);
  const files = parseUnifiedDiff(diff);
  const model = buildReviewModel(page.repo, page.tour, files, page.head, {
    storyless: page.storyless,
    detailedStepIndexes: new Set(),
    detailedFilePaths: new Set(),
    includeTrustRows: true,
    baseRef: page.base,
  });
  const stepIndexById = new Map(
    model.steps.map((step, index) => [step.id, index + 1]),
  );
  return renderTrustEvidence(
    model.trust,
    stepIndexById,
    excludedReviewFiles(page.repo, page.base, page.head),
    stagedWorktreeDivergentFiles(page.repo, page.base, page.head),
    page.storyless,
  );
}

/**
 * The pill-sized answer to "does the story explain every rendered change?".
 *
 * The review page renders from a lazy file index, so coverage cannot be known
 * at first paint and the pill starts in an explicit unknown state. This is the
 * cheap resolution of that unknown: same coverage math as the trust drawer, but
 * with `includeTrustRows` off so no diff rows are built for a verdict that only
 * needs counts. Range counts match `model.trust.uncovered.length`, which is the
 * number the pill and the review chip are computed from at render time.
 */
function reviewCoverageVerdict(page: LeasedReviewPage): {
  storyless: boolean;
  uncovered: number;
} {
  const files = parseUnifiedDiff(getDiff(page.repo, page.base, page.head));
  const model = buildReviewModel(page.repo, page.tour, files, page.head, {
    storyless: page.storyless,
    detailedStepIndexes: new Set(),
    detailedFilePaths: new Set(),
    includeTrustRows: false,
    baseRef: page.base,
  });
  return { storyless: page.storyless, uncovered: model.trust.uncovered.length };
}

function renderExcludedFileResponse(
  page: LeasedReviewPage,
  file: string,
): string {
  if (!file) return `<div class="ds-diffnote">No file requested.</div>`;
  const { repo, base, head } = page;
  const excluded = excludedReviewFiles(repo, base, head).find(
    (candidate) => candidate.path === file,
  );
  if (!excluded) {
    return `<div class="ds-diffnote">That file is not an excluded part of this review.</div>`;
  }
  if (excluded.reason === "binary") {
    return `<div class="ds-diffnote">Binary contents are not decoded in the review. The file is still part of the exact change fingerprint and must be acknowledged before approval.</div>`;
  }
  let preview = readFileRange(repo, file, 1, 500, head);
  let side = "Current file";
  if (!preview) {
    preview = readFileRange(repo, file, 1, 500, base);
    side = "File before deletion";
  }
  if (!preview)
    return `<div class="ds-diffnote">This binary or missing file cannot be previewed as text.</div>`;
  const rows = preview.lines
    .map(
      (line, index) =>
        `<span><i>${preview.startLine + index}</i><code>${esc(line) || " "}</code></span>`,
    )
    .join("");
  return `<div class="ds-excluded-file-head"><strong>${side}</strong><span>Bounded preview · first ${preview.lines.length} lines, not story coverage or a before/after diff.</span></div><pre class="ds-excluded-code">${rows}</pre>`;
}

function storyDriftView(report: StoryDriftReport): StoryDriftView {
  const state: StoryDriftView["state"] =
    report.storyFreshness === "unverified"
      ? "unverified"
      : report.inScopeCount && report.outsideScopeCount
        ? "mixed"
        : report.inScopeCount
          ? "story-changed"
          : report.outsideScopeCount
            ? "outside-only"
            : "current";
  return {
    state,
    ...(report.observationId ? { observationId: report.observationId } : {}),
    inScopeFiles: report.inScopeCount,
    outsideScopeFiles: report.outsideScopeCount,
    files: report.changes.map((change) => ({
      path: change.path,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      status: change.kind,
      scope: change.inStory ? "story" : "outside",
      detail: change.evidence === "exact" ? "exact" : "summary-only",
      ...(change.reason ? { reason: change.reason } : {}),
    })),
  };
}

function renderStoryDriftFileResponse(
  result: StoryDriftFileDiff,
  layout: "split" | "unified" = "split",
): string {
  const note = result.reason
    ? `<div class="ds-diffnote${result.status === "partial" ? "" : " is-warning"}">${esc(result.reason)}</div>`
    : "";
  if (!result.diff) {
    return (
      note ||
      `<div class="ds-diffnote">${esc(metadataOnlyDriftDescription(result))}</div>`
    );
  }
  const file = parseUnifiedDiff(result.diff)[0];
  if (!file || !file.hunks.length)
    return `${note}<div class="ds-diffnote">${esc(metadataOnlyDriftDescription(result))}</div>`;
  if (layout === "unified") return `${note}${renderUnifiedHunks(file)}`;
  return `${note}${renderSplitHunks(hunksToSbsBlocks(file, []), {
    file: file.newPath || result.path,
    oldFile: file.oldPath || result.oldPath,
    newFile: file.status === "added",
    hunkRanges: file.hunks.map(hunkNewRange),
    canExpand: false,
  })}`;
}

function metadataOnlyDriftDescription(result: StoryDriftFileDiff): string {
  const modes = result.diff?.match(
    /^old mode ([0-7]+)\r?\nnew mode ([0-7]+)$/m,
  );
  if (result.oldPath && result.oldPath !== result.path) {
    if (modes) {
      return `Renamed ${result.oldPath} to ${result.path} and changed file mode from ${modes[1]} to ${modes[2]}; file contents did not change.`;
    }
    return `Renamed ${result.oldPath} to ${result.path}; file contents did not change.`;
  }
  if (modes)
    return `File mode changed from ${modes[1]} to ${modes[2]}; file contents did not change.`;
  return "File metadata changed without textual content changes.";
}

/** Rows for expand-a-hunk-gap, clamped to [from, to] new-file line numbers. */
function renderContextResponse(
  page: LeasedReviewPage,
  params: URLSearchParams,
): string {
  const { repo, tour, head, storyless } = page;
  const file = params.get("file") ?? "";
  if (!file) return `<div class="ds-diffnote">No file requested.</div>`;
  const from = Math.max(1, parseInt(params.get("from") ?? "1", 10) || 1);
  const toRaw = params.get("to") ?? "eof";
  const to =
    toRaw === "eof" ? Number.MAX_SAFE_INTEGER : parseInt(toRaw, 10) || 0;
  const layout =
    params.get("layout") === "split"
      ? ("split" as const)
      : ("unified" as const);
  if (to < from) return `<div data-ctx-rows data-from="0" data-to="0"></div>`;

  // Mirror renderFullFileResponse exactly: context-only story files are valid,
  // but a since-feedback page can only expand files from its issued model.
  const allowed = new Set<string>([
    ...boundedReviewIndex(page.fileIndex).map((entry) => entry.path),
    ...(storyless ? [] : storyReviewFiles(tour)),
  ]);
  if (!allowed.has(file))
    return `<div class="ds-diffnote">That file isn't part of this change.</div>`;
  const df = materializePageFile(page, file);
  const newLines = readWholeFile(repo, file, head) ?? [];
  if (!newLines.length)
    return `<div class="ds-diffnote">Couldn't read ${esc(file)} from the working tree.</div>`;
  // Clamp to the real file length: ranges past EOF must serve fewer rows,
  // never invented ones. Defense-in-depth — the parser now bounds hunks by
  // their header counts, so it no longer leaks a phantom row past EOF.
  const last = newLines.length;
  const servedTo = Math.min(to, last);
  const rows = rowsInNewRange(buildFullFileRows(df, newLines, []), [
    from,
    servedTo,
  ]);
  return renderContextRows(rows, layout, {
    file,
    oldFile: df?.oldPath,
    newFile: df?.status === "added",
    servedRange: [from, servedTo],
  });
}

function nowMs(): number {
  return Date.now();
}

function agentFailureEvent(r: StreamResult): ProgressEvent {
  const stage = r.failure === "startup" ? "startup" : "execution";
  const summary = summarizeAgentFailure(r.output, stage);
  return errorEvent(
    stage,
    summary.label,
    summary.detail,
    summary.technicalDetail,
  );
}

/** Everything runWorkflow needs to drive one agent run end to end. */
interface WorkflowSpec {
  workflow: Workflow;
  title: string;
  context: RunContext;
  agent: Agent;
  prompt: string;
  model?: string;
  agentOptions?: AgentRunOptions;
  /** True when this event is a write to the run's own output (drives writing_output). */
  isTargetWrite: (ev: ProgressEvent) => boolean;
  /** After the agent exits, compute terminal status + result + any error/warning events. */
  finish: (r: StreamResult) => {
    status: RunStatus;
    result: Record<string, unknown>;
    events: ProgressEvent[];
  };
  /** Optional cleanup for temp checkouts created only for this workflow. */
  cleanup?: () => void;
  /** Optional file scope: relativize file-event paths and count distinct changed-file reads. */
  fileScope?: FileScope;
}

export function finishStoryGeneration(
  r: StreamResult,
  storyPath: string,
  session: Pick<Session, "selectedStory" | "chooseStory"> &
    Partial<Pick<Session, "repo">>,
  previousStoryContents?: string | null,
  finishPolicy: StoryFinishPolicy | boolean = DEFAULT_STORY_FINISH_POLICY,
): {
  status: RunStatus;
  result: Record<string, unknown>;
  events: ProgressEvent[];
} {
  const currentStoryContents = existsSync(storyPath)
    ? readFileSync(storyPath, "utf8")
    : null;
  const storyWritten =
    currentStoryContents !== null &&
    (previousStoryContents === undefined ||
      previousStoryContents === null ||
      currentStoryContents !== previousStoryContents);
  if (storyWritten) {
    const historyRepo = session.repo ?? repoForStoryPath(storyPath);
    const historyId = storyIdForPath(historyRepo, storyPath);
    if (historyId) snapshotStoryIfChanged(historyRepo, historyId);
  }
  const events: ProgressEvent[] = [];
  let status: RunStatus = "complete";
  if (storyWritten) {
    try {
      const tour = loadTour(storyPath);
      const policy = normalizeStoryFinishPolicy(finishPolicy);
      const qualityErrors = policy.validateModern
        ? policy.requireStoryArc
          ? validateNewGeneratedStory(tour)
          : validateGeneratedTour(tour)
        : validateGeneratedConceptSteps(tour);
      if (
        Object.prototype.hasOwnProperty.call(policy, "originalStoryArc") ||
        Object.prototype.hasOwnProperty.call(policy, "originalEvolution")
      ) {
        qualityErrors.push(
          ...evolutionPreservationErrors(
            tour,
            policy.originalStoryArc,
            policy.originalEvolution,
          ),
        );
      }
      const moveVerification = policy.validateModern
        ? verifyLogicMoves(session.repo ?? repoForStoryPath(storyPath), tour)
        : { errors: [], warnings: [] };
      qualityErrors.push(...moveVerification.errors);
      const evolutionVerification = verifyEvolution(
        session.repo ?? repoForStoryPath(storyPath),
        tour,
        policy.evolutionManifest,
      );
      qualityErrors.push(...evolutionVerification.errors);
      if (qualityErrors.length) {
        throw new Error(
          `Generated story did not meet the storyteller contract:\n  - ${qualityErrors.join("\n  - ")}`,
        );
      }
      for (const warning of moveVerification.warnings) {
        events.push(
          warningEvent("Logic move needs a closer look", warning, "validation"),
        );
      }
      for (const warning of evolutionVerification.warnings) {
        events.push(
          warningEvent("Commit evolution was hidden", warning, "validation"),
        );
      }
      session.selectedStory = storyPath;
      session.chooseStory = false;
      return { status, result: { storyWritten, storyValid: true }, events };
    } catch (e) {
      events.push(
        errorEvent(
          "validation",
          "The story did not pass its final check",
          "The agent wrote a story, but diffStory cannot safely open it yet. Try again or change the story settings.",
          (e as Error).message,
        ),
      );
      status = "failed";
      return { status, result: { storyWritten, storyValid: false }, events };
    }
  }
  if (r.failure === "startup") {
    events.push(agentFailureEvent(r));
    status = "failed";
  } else if (r.ok) {
    events.push(
      errorEvent(
        "output_missing",
        "The agent finished without a story",
        "No .diffstory/story.json was created. Try again, or open technical details to see what the agent returned.",
      ),
    );
    status = "failed";
  } else {
    events.push(agentFailureEvent(r));
    status = "failed";
  }
  return { status, result: { storyWritten, storyValid: false }, events };
}

export interface StoryFinishPolicy {
  validateModern: boolean;
  requireStoryArc: boolean;
  originalStoryArc?: StoryArc;
  originalEvolution?: StoryEvolution;
  evolutionManifest?: CommitEvolutionManifest;
}

const DEFAULT_STORY_FINISH_POLICY: StoryFinishPolicy = {
  validateModern: true,
  requireStoryArc: false,
};

function normalizeStoryFinishPolicy(
  policy: StoryFinishPolicy | boolean,
): StoryFinishPolicy {
  if (typeof policy === "boolean") {
    return { validateModern: policy, requireStoryArc: false };
  }
  return policy;
}

function repoForStoryPath(storyPath: string): string {
  let cursor = dirname(resolve(storyPath));
  while (cursor !== dirname(cursor) && basename(cursor) !== DATA_DIR)
    cursor = dirname(cursor);
  return basename(cursor) === DATA_DIR
    ? dirname(cursor)
    : dirname(dirname(resolve(storyPath)));
}

/**
 * The shared spine for every agent workflow: emit run_started → context → app
 * phases, stream normalized agent events (advancing phases monotonically on real
 * observation), heartbeat liveness while the child runs, then validate → run_done.
 */
function runWorkflow(
  res: ServerResponse,
  repo: string,
  spec: WorkflowSpec,
): void {
  agentBusy = true;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  const ac = new AbortController();
  res.on("close", () => ac.abort());

  let seq = 0;
  const send = (e: ProgressEvent) => {
    try {
      res.write(JSON.stringify({ seq: seq++, ...e }) + "\n");
    } catch {
      /* client disconnected */
    }
  };

  // Phases only ever advance (monotonic by rank).
  let curRank = -1;
  const advance = (phase: Phase, label?: string, detail?: string) => {
    if (phaseRank(phase) <= curRank) return;
    curRank = phaseRank(phase);
    send(phaseEvent(phase, label, detail));
  };

  send(runStarted(spec.workflow, spec.title));
  send(contextEvent(spec.context));
  advance("resolving_context");
  advance("preparing_prompt");
  advance("starting_agent");
  advance("agent_running");

  let lastActivity = nowMs();
  const heart = setInterval(() => {
    if (!ac.signal.aborted) send(heartbeatEvent(nowMs() - lastActivity));
  }, 5000);

  const enrich = spec.fileScope
    ? createFileEnricher(spec.fileScope)
    : (e: ProgressEvent) => e;

  streamAgent(
    spec.agent,
    repo,
    spec.prompt,
    (ev) => {
      lastActivity = nowMs();
      const out = enrich(ev);
      send(out);
      const ph = observedPhase(out, spec.isTargetWrite(out));
      if (ph) advance(ph);
      if (out.type === "text") {
        for (const note of noteEventsFromText(out.data)) {
          if (note.type === "phase") advance(note.phase, note.label);
          else send(note);
        }
      }
    },
    spec.model,
    ac.signal,
    spec.agentOptions,
  )
    .then((r) => {
      clearInterval(heart);
      if (ac.signal.aborted) {
        send(doneEvent("stopped"));
        return;
      }
      advance("validating_output");
      const { status, result, events } = spec.finish(r);
      for (const e of events) send(e);
      send(doneEvent(status, result));
    })
    .catch((err) => {
      clearInterval(heart);
      if (ac.signal.aborted) {
        send(doneEvent("stopped"));
        return;
      }
      send(errorEvent("execution", "The agent run crashed", String(err)));
      send(doneEvent("failed"));
    })
    .finally(() => {
      clearInterval(heart);
      try { spec.cleanup?.(); }
      catch (error) { send(errorEvent("validation", "The previous story could not be restored", "The run failed and its saved artifact needs recovery before retrying.", (error as Error).message)); }
      finally { res.end(); agentBusy = false; }
    });
}

function stableDiffRef(
  repo: string,
  ref: string | undefined,
): string | undefined {
  if (!ref) return undefined;
  return resolveCommit(repo, ref) ?? ref;
}

/**
 * `git diff --numstat` renders renames as `dir/{old => new}/file` (or bare
 * `old => new`). Changed-file matching needs the post-rename path — the file
 * the agent will actually read — else "n of N" carries an unreachable N.
 */
export function postRenamePath(path: string): string {
  if (!path.includes(" => ")) return path;
  if (path.includes("{")) {
    return path
      .replace(/\{[^{}]*? => ([^{}]*?)\}/g, "$1")
      .replace(/\/{2,}/g, "/");
  }
  return path.slice(path.indexOf(" => ") + 4);
}

type ScopeResult =
  | { ok: true; scope?: StoryScope }
  | { ok: false; detail: string };
type NoteResult = { ok: true; note?: string } | { ok: false; detail: string };
type IncludedFilesResult =
  | { ok: true; included: string[] }
  | { ok: false; detail: string };

function normalizeReviewerNote(value: unknown): NoteResult {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string")
    return { ok: false, detail: "Story guidance must be text." };
  const note = value.trim();
  return { ok: true, ...(note ? { note: note.slice(0, 4000) } : {}) };
}

function normalizeIncludedFiles(
  value: unknown,
  changedFiles: string[],
): IncludedFilesResult {
  if (value === undefined || value === null)
    return { ok: true, included: changedFiles };
  if (!Array.isArray(value))
    return { ok: false, detail: "Selected story files must be an array." };
  const requested = [
    ...new Set(value.map((v) => (typeof v === "string" ? v.trim() : ""))),
  ].filter(Boolean);
  if (!requested.length)
    return { ok: false, detail: "Pick at least one file for the story." };
  const changed = new Set(changedFiles);
  const unknown = requested.filter((p) => !changed.has(p));
  if (unknown.length) {
    return {
      ok: false,
      detail: `Selected file is not part of this change: ${unknown[0]}`,
    };
  }
  const requestedSet = new Set(requested);
  return {
    ok: true,
    included: changedFiles.filter((p) => requestedSet.has(p)),
  };
}

function storyScopeFromInput(
  input: { includedFiles?: unknown; reviewerNote?: unknown },
  changedFiles: string[],
): ScopeResult {
  const note = normalizeReviewerNote(input.reviewerNote);
  if (!note.ok) return note;
  const files = normalizeIncludedFiles(input.includedFiles, changedFiles);
  if (!files.ok) return files;
  const included = files.included;
  const excluded = changedFiles.filter((p) => !included.includes(p));
  if (!excluded.length && !note.note) return { ok: true };
  return {
    ok: true,
    scope: {
      includedFiles: included,
      ...(excluded.length ? { excludedFiles: excluded } : {}),
      ...(note.note ? { reviewerNote: note.note } : {}),
    },
  };
}

function stampStoryMetadata(
  storyPath: string,
  fingerprint: string,
  scope?: StoryScope,
  snapshot?: StorySnapshotRef,
): void {
  if (!existsSync(storyPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(storyPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return;
    parsed.diffFingerprint = fingerprint;
    if (scope) parsed.storyScope = scope;
    if (snapshot) parsed.storySnapshot = snapshot;
    writeJsonAtomic(storyPath, parsed);
  } catch {
    // Validation will report malformed or missing stories in the normal finish path.
  }
}

/** Normalize agent output and stamp app-owned metadata in one atomic write. */
export function prepareStoryOutput(
  storyPath: string,
  fingerprint: string,
  scope?: StoryScope,
  evolutionManifest?: CommitEvolutionManifest,
): void {
  if (!existsSync(storyPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(storyPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return;
    normalizeEvolutionObject(parsed, evolutionManifest);
    parsed.diffFingerprint = fingerprint;
    if (scope) parsed.storyScope = scope;
    writeJsonAtomic(storyPath, parsed);
  } catch {
    // The final load reports malformed agent output with its ordinary validation error.
  }
}

function storySnapshotScope(tour: Tour): Pick<StoryScope, "includedFiles"> {
  const includedFiles =
    tour.storyScope?.includedFiles ??
    tour.steps.filter(isCodeStep).map((step) => step.file);
  return {
    includedFiles: [...new Set(includedFiles)].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

function storyDriftBinding(
  base: string,
  head: string | undefined,
  tour: Tour,
): StoryDriftExpectedBinding {
  return {
    base,
    ...(head ? { head } : {}),
    storyScope: storySnapshotScope(tour),
  };
}

function captureAndStampStoryBaseline(
  repo: string,
  storyPath: string,
  base: string,
  head?: string,
  frozenManifest?: CommitEvolutionManifest,
): StorySnapshotRef {
  const storySource = readFileSync(storyPath, "utf8");
  const tour = loadTour(storyPath);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = captureStorySnapshot({
      repo,
      base,
      ...(head ? { head } : {}),
      ...(frozenManifest
        ? {
            frozenBase: frozenManifest.baseSha,
            frozenHead: frozenManifest.headSha,
          }
        : {}),
      storyScope: storySnapshotScope(tour),
    });
    if (frozenManifest) {
      const diff = getDiff(
        repo,
        frozenManifest.baseSha,
        frozenManifest.headSha,
      );
      if (readFileSync(storyPath, "utf8") !== storySource) {
        throw new Error(
          "The story changed while DiffStory captured its baseline.",
        );
      }
      stampStoryMetadata(storyPath, diffFingerprint(diff), undefined, snapshot);
      return snapshot;
    }
    const expected = storyDriftBinding(base, head, tour);
    const observed = inspectStoryDrift({ repo, snapshot, expected });
    if (observed.status !== "current") continue;
    const diff = getDiff(repo, base, head);
    const confirmed = inspectStoryDrift({ repo, snapshot, expected });
    if (
      confirmed.status !== "current" ||
      confirmed.currentIdentity !== observed.currentIdentity
    )
      continue;
    if (readFileSync(storyPath, "utf8") !== storySource) {
      throw new Error(
        "The story changed while DiffStory captured its baseline.",
      );
    }
    stampStoryMetadata(storyPath, diffFingerprint(diff), undefined, snapshot);
    return snapshot;
  }
  throw new Error(
    "The repository kept changing while diffStory captured the story baseline.",
  );
}

function finishWithStoryBaseline(
  finished: ReturnType<typeof finishStoryGeneration>,
  repo: string,
  storyPath: string,
  base: string,
  head?: string,
  frozenManifest?: CommitEvolutionManifest,
): ReturnType<typeof finishStoryGeneration> {
  if (finished.status !== "complete") return finished;
  try {
    const snapshot = captureAndStampStoryBaseline(
      repo,
      storyPath,
      base,
      head,
      frozenManifest,
    );
    return {
      ...finished,
      result: { ...finished.result, storySnapshot: snapshot.id },
    };
  } catch (error) {
    return {
      status: "failed",
      result: { ...finished.result, storySnapshot: false },
      events: [
        ...finished.events,
        errorEvent(
          "validation",
          "The story baseline could not be captured",
          "The story is valid, but freshness cannot be proven yet. Retry when repository writes have finished.",
          (error as Error).message,
        ),
      ],
    };
  }
}

function runStoryRefresh(res: ServerResponse, session: Session, url: URL, body: string): void {
  const page = validateReviewPageLease(session, url.searchParams.get("page"));
  if (!page.ok) return sendReviewPageConflict(res, page.error);
  if (historyMutationError(session, page.lease)) return sendJson(res, 409, { error: "History snapshots are read-only." });
  try {
    const input = JSON.parse(body || "{}");
    const original = page.tour;
    const binding = storyDriftBinding(page.base, page.head, original);
    const drift = inspectStoryDrift({ repo: page.repo, snapshot: original.storySnapshot, expected: binding });
    if (!drift.complete || !drift.inScopeCount || !drift.observationId || input.observation !== drift.observationId ||
      drift.changes.some((change) => change.inStory && change.evidence !== "exact")) {
      return sendJson(res, 409, { error: "Reload the changes since story. A focused refresh needs a current, exact observation of changed story files." });
    }
    const agents = availableAgents();
    const pre = agentPreflight({ repo: page.repo, busy: agentBusy, agents });
    if (!pre.ok) return sendJson(res, pre.status, errorEvent(pre.stage, pre.label, pre.detail));
    const selected = selectAvailableAgent(input.agent, agents, pre.agent);
    if (!selected.ok) return sendJson(res, selected.status, errorEvent(selected.stage, selected.label, selected.detail));
    const plan = planStoryRefresh(original, drift.changes);
    const storyPath = page.lease.storyPath;
    const before = readFileSync(storyPath, "utf8");
    const commentsBefore = existsSync(commentsPath(page.repo)) ? readFileSync(commentsPath(page.repo), "utf8") : null;
    let accepted = false;
    const sourceUnchanged = () => inspectStoryDrift({ repo: page.repo, snapshot: original.storySnapshot, expected: binding }).currentIdentity === drift.currentIdentity;
    runWorkflow(res, page.repo, {
      workflow: "guided_review", title: "Refreshing affected story steps", agent: selected.agent,
      prompt: storyRefreshPrompt(plan, storyPath, page.base, page.head),
      context: { repoName: basename(page.repo), repoPath: page.repo, workflow: "guided_review", agent: selected.agent, base: describeBase(page.repo, page.base), head: page.head ?? "working tree" },
      isTargetWrite: (event) => event.type === "file" && event.action !== "read" && event.target.endsWith("story.json"),
      finish: (result) => {
        try {
          if (!result.ok) throw new Error("The refresh agent did not finish successfully.");
          const updated = loadTour(storyPath);
          const errors = validateStoryRefresh(original, updated, plan);
          if (errors.length) throw new Error(errors.join("\n"));
          if (!sourceUnchanged()) throw new Error("The source changed during the refresh. Reload before trying again.");
          const commentsNow = existsSync(commentsPath(page.repo)) ? readFileSync(commentsPath(page.repo), "utf8") : null;
          if (commentsNow !== commentsBefore) throw new Error("The comment queue changed during refresh. It was left untouched by the app.");
          const report = runStoryCheck(page.repo, storyPath);
          if (!reportReady(report)) throw new Error([...report.errors, ...report.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message)].join("\n"));
          // Capture only after full coverage and preservation pass. Comments and
          // their stable step anchors are never rewritten by this operation.
          captureAndStampStoryBaseline(page.repo, storyPath, page.base, page.head);
          if (!sourceUnchanged()) throw new Error("The source changed while the new baseline was captured.");
          const finished = finishStoryGeneration(result, storyPath, { repo: page.repo, selectedStory: storyPath, chooseStory: false }, before, {
            validateModern: true, requireStoryArc: false, originalStoryArc: original.storyArc, originalEvolution: original.evolution,
          });
          accepted = finished.status === "complete";
          return { ...finished, result: { ...finished.result, refreshedStepIds: plan.stepIds, changedFiles: plan.changedFiles } };
        } catch (error) {
          return { status: "failed", result: { storyWritten: false, storyValid: false }, events: [errorEvent("validation", "The focused refresh was not accepted", "The previous story will be restored. Review the details, then retry.", (error as Error).message)] };
        }
      },
      cleanup: () => { if (!accepted) writeTextAtomic(storyPath, before); },
      fileScope: { repoPath: page.repo, changedFiles: plan.changedFiles },
    });
  } catch (error) { return sendJson(res, 400, { error: (error as Error).message }); }
}

function runStoryRepair(
  res: ServerResponse,
  session: Session,
  body: string,
): void {
  let input: {
    action?: string;
    file?: string;
    line?: number;
    stepId?: string;
    agent?: string;
  } = {};
  try {
    input = JSON.parse(body || "{}");
  } catch {
    return sendJson(
      res,
      400,
      errorEvent(
        "preflight",
        "Invalid request",
        "The request body was not valid JSON.",
      ),
    );
  }
  const repairBlocked = historyMutationError(session);
  if (repairBlocked)
    return sendJson(
      res,
      409,
      errorEvent("preflight", "History snapshot is read-only", repairBlocked),
    );
  const action = input.action as StoryRepairAction;
  if (
    !(
      ["explain", "rewrite", "shorten", "split"] as StoryRepairAction[]
    ).includes(action)
  ) {
    return sendJson(
      res,
      400,
      errorEvent(
        "preflight",
        "Invalid story repair",
        "Choose explain, rewrite, shorten, or split.",
      ),
    );
  }
  const agents = availableAgents();
  const pre = agentPreflight({ repo: session.repo, busy: agentBusy, agents });
  if (!pre.ok)
    return sendJson(
      res,
      pre.status,
      errorEvent(pre.stage, pre.label, pre.detail),
    );
  const selected = selectAvailableAgent(input.agent, agents, pre.agent);
  if (!selected.ok)
    return sendJson(
      res,
      selected.status,
      errorEvent(selected.stage, selected.label, selected.detail),
    );
  const repo = session.repo as string;
  const storyPath = selectedStoryPath(session);
  if (!existsSync(storyPath)) {
    return sendJson(
      res,
      404,
      errorEvent(
        "preflight",
        "No story to repair",
        "Generate a story before tuning a step.",
      ),
    );
  }
  let originalTour: Tour;
  let storyWasModern = false;
  try {
    originalTour = loadTour(storyPath);
    storyWasModern = validateGeneratedTour(originalTour).length === 0;
  } catch (e) {
    return sendJson(
      res,
      400,
      errorEvent(
        "validation",
        "The current story is invalid",
        (e as Error).message,
      ),
    );
  }
  const storyBefore = readFileSync(storyPath, "utf8");
  const data = sessionReviewData(session);
  const repairEvolutionManifest = originalTour.evolution
    ? commitEvolutionManifest(
        repo,
        originalTour.evolution.baseSha,
        originalTour.evolution.headSha,
      ) ?? undefined
    : undefined;
  const repairBase =
    originalTour.evolution?.baseSha ?? stableDiffRef(repo, data.base) ?? data.base;
  const repairHead =
    originalTour.evolution?.headSha ?? stableDiffRef(repo, data.head);
  const title =
    action === "explain"
      ? "Explaining an uncovered change"
      : action === "rewrite"
        ? "Rewriting a story step"
        : action === "shorten"
          ? "Shortening a story step"
          : "Splitting a story step";
  runWorkflow(res, repo, {
    workflow: "guided_review",
    title,
    agent: selected.agent,
    prompt: storyRepairPrompt({
      action,
      file: input.file?.trim() || undefined,
      line: Number.isFinite(input.line)
        ? Math.trunc(Number(input.line))
        : undefined,
      stepId: input.stepId?.trim() || undefined,
      base: repairBase,
      head: repairHead,
      hasStoryArc: !!originalTour.storyArc,
      hasEvolution: !!originalTour.evolution,
    }),
    context: {
      repoName: basename(repo),
      repoPath: repo,
      workflow: "guided_review",
      agent: selected.agent,
      base: describeBase(repo, data.base),
      head: data.head ?? "working tree",
    },
    isTargetWrite: (event) =>
      event.type === "file" &&
      event.action !== "read" &&
      event.target.endsWith("story.json"),
    finish: (result) => {
      const storyChanged =
        existsSync(storyPath) &&
        readFileSync(storyPath, "utf8") !== storyBefore;
      if (storyChanged) {
        prepareStoryOutput(
          storyPath,
          diffFingerprint(getDiff(repo, repairBase, repairHead)),
          undefined,
          repairEvolutionManifest,
        );
      }
      const finished = finishStoryGeneration(
        result,
        storyPath,
        session,
        storyBefore,
        {
          validateModern: storyWasModern,
          requireStoryArc: false,
          originalStoryArc: originalTour.storyArc,
          originalEvolution: originalTour.evolution,
          evolutionManifest: repairEvolutionManifest,
        },
      );
      return finishWithStoryBaseline(
        finished,
        repo,
        storyPath,
        originalTour.base ?? data.base,
        originalTour.head ?? data.head,
        repairEvolutionManifest,
      );
    },
    fileScope: {
      repoPath: repo,
      changedFiles: numstat(repo, repairBase, repairHead).map((file) =>
        postRenamePath(file.path),
      ),
    },
  });
}

/** Drive the agent to write a story for the current repo, streaming progress NDJSON. */
function runGenerate(
  res: ServerResponse,
  session: Session,
  body: string,
): void {
  let input: {
    base?: string;
    head?: string;
    agent?: string;
    model?: string;
    mode?: string;
    codexSandbox?: string;
    codexProvider?: string;
    codexProfile?: string;
    codexConfig?: string[] | string;
    includedFiles?: unknown;
    reviewerNote?: unknown;
    audience?: unknown;
  } = {};
  try {
    input = JSON.parse(body || "{}");
  } catch {
    return sendJson(
      res,
      400,
      errorEvent(
        "preflight",
        "Invalid request",
        "The request body was not valid JSON.",
      ),
    );
  }
  const generateBlocked = historyMutationError(session);
  if (generateBlocked)
    return sendJson(
      res,
      409,
      errorEvent("preflight", "History snapshot is read-only", generateBlocked),
    );

  const agents = availableAgents();
  const pre = agentPreflight({ repo: session.repo, busy: agentBusy, agents });
  if (!pre.ok)
    return sendJson(
      res,
      pre.status,
      errorEvent(pre.stage, pre.label, pre.detail),
    );
  const selected = selectAvailableAgent(input.agent, agents, pre.agent);
  if (!selected.ok)
    return sendJson(
      res,
      selected.status,
      errorEvent(selected.stage, selected.label, selected.detail),
    );
  const agent = selected.agent;
  const model =
    input.model && input.model.trim() ? input.model.trim() : undefined;
  const mode = normalizeStoryMode(input.mode);
  const agentOptions =
    agent === "codex" ? { codex: normalizeCodexRunOptions(input) } : undefined;
  const workflow: Workflow =
    mode === "detailed" ? "detailed_audit" : "guided_review";
  const title =
    mode === "brief"
      ? "Generating compact story"
      : mode === "detailed"
        ? "Generating deep review"
        : "Generating guided review";
  const repo = session.repo as string;

  const base = resolveBase(repo, input.base);
  const promptBase = stableDiffRef(repo, base) ?? base;
  const promptHead = stableDiffRef(repo, input.head);
  const evolutionManifest = promptHead
    ? commitEvolutionManifest(repo, promptBase, promptHead) ?? undefined
    : undefined;
  session.base = base;
  session.head = input.head;
  const storyPath = resolveStoryPath(repo);
  const storyBefore = existsSync(storyPath)
    ? readFileSync(storyPath, "utf8")
    : null;
  // Generated/oversized files (regenerated ABIs, lockfiles) are subtracted from
  // the agent's diff just as they are from the rendered review and coverage gate,
  // so all three agree and the agent doesn't waste a run narrating a 20k-line ABI.
  const excludePaths = noiseFiles(repo, promptBase, promptHead);
  // The exact changed files the review shows (noise subtracted), so file-read
  // progress can honestly say "3 of 8 changed files".
  const changedFiles = numstat(repo, promptBase, promptHead)
    .map((f) => postRenamePath(f.path))
    .filter((p) => !excludePaths.includes(p));
  // An explicit audience choice sticks: it is saved as a standing preference
  // and used for this run. Otherwise the standing preference (if any) applies.
  const repoPrefs = loadRepoPreferences(repo);
  const audience =
    isStoryAudience(input.audience)
      ? saveRepoPreferences(repo, { audience: input.audience }).audience ??
        DEFAULT_AUDIENCE
      : (repoPrefs.audience ?? DEFAULT_AUDIENCE);
  const storyScope = storyScopeFromInput(input, changedFiles);
  if (!storyScope.ok) {
    return sendJson(
      res,
      400,
      errorEvent("preflight", "Invalid story scope", storyScope.detail),
    );
  }

  runWorkflow(res, repo, {
    workflow,
    title,
    agent,
    model,
    agentOptions,
    prompt: storyPrompt(
      promptBase,
      promptHead,
      mode,
      excludePaths,
      storyScope.scope,
      evolutionManifest,
      { base, head: input.head },
      { audience },
    ),
    context: {
      repoName: basename(repo),
      repoPath: repo,
      workflow,
      agent,
      model,
      base: describeBase(repo, promptBase),
      head: promptHead ?? "working tree",
    },
    // For generate, the output is the story file.
    isTargetWrite: (ev) =>
      ev.type === "file" &&
      ev.action !== "read" &&
      ev.target.endsWith("story.json"),
    finish: (r) => {
      const storyChanged =
        existsSync(storyPath) &&
        (storyBefore === null ||
          readFileSync(storyPath, "utf8") !== storyBefore);
      if (storyChanged) {
        prepareStoryOutput(
          storyPath,
          diffFingerprint(getDiff(repo, promptBase, promptHead)),
          storyScope.scope,
          evolutionManifest,
        );
      }
      const finished = finishStoryGeneration(
        r,
        storyPath,
        session,
        storyBefore,
        {
          validateModern: true,
          requireStoryArc: true,
          evolutionManifest,
        },
      );
      return finishWithStoryBaseline(
        finished,
        repo,
        storyPath,
        base,
        input.head,
        evolutionManifest,
      );
    },
    fileScope: { repoPath: repo, changedFiles },
  });
}

function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  done: (body: string) => void,
): void {
  let data = "";
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk) => {
    if (tooLarge) return;
    size += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(String(chunk));
    if (size > 1_000_000) {
      tooLarge = true;
      data = "";
      sendJson(res, 413, { error: "Request body is too large." });
      return;
    }
    data += chunk;
  });
  req.on("end", () => {
    if (!tooLarge) done(data);
  });
}

function runAloudStatus(res: ServerResponse, aloud: AloudReader): void {
  aloud
    .status()
    .then((status) => sendJson(res, 200, status))
    .catch((error) => sendAloudError(res, error));
}

function runAloudSpeak(
  res: ServerResponse,
  aloud: AloudReader,
  body: string,
): void {
  let input: { batches?: unknown; prefetch?: unknown; text?: unknown };
  try {
    input = JSON.parse(body || "{}") as typeof input;
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON." });
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return sendJson(res, 400, { error: "No text to speak." });
  const batches = Array.isArray(input.batches)
    ? input.batches.map((batch) =>
        typeof batch === "string" ? batch.trim() : "",
      )
    : undefined;
  if (batches && (batches.length === 0 || batches.some((batch) => !batch))) {
    return sendJson(res, 400, {
      error: "Narration batches must be non-empty strings.",
    });
  }
  const prefetch = Number(input.prefetch);
  aloud
    .speak({
      text,
      ...(batches ? { batches } : {}),
      ...(Number.isFinite(prefetch) ? { prefetch } : {}),
    })
    .then((status) => sendJson(res, 200, status))
    .catch((error) => sendAloudError(res, error));
}

function runAloudPrepare(
  res: ServerResponse,
  aloud: AloudReader,
  body: string,
): void {
  let input: { batches?: unknown; prefetch?: unknown; text?: unknown };
  try {
    input = JSON.parse(body || "{}") as typeof input;
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON." });
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return sendJson(res, 400, { error: "No text to prepare." });
  const batches = Array.isArray(input.batches)
    ? input.batches.map((batch) =>
        typeof batch === "string" ? batch.trim() : "",
      )
    : undefined;
  if (batches && (batches.length === 0 || batches.some((batch) => !batch))) {
    return sendJson(res, 400, {
      error: "Narration batches must be non-empty strings.",
    });
  }
  // Forwarded, not dropped: this is how far ahead the page wants warmed, and
  // without it Aloud falls back to its own default depth.
  const prefetch = Number(input.prefetch);
  aloud
    .prepare({
      text,
      ...(batches ? { batches } : {}),
      ...(Number.isFinite(prefetch) ? { prefetch } : {}),
    })
    .then(() => {
      res.statusCode = 204;
      res.end();
    })
    .catch((error) => sendAloudError(res, error));
}

function runAloudControl(
  res: ServerResponse,
  aloud: AloudReader,
  body: string,
): void {
  let action: "pause" | "resume" | "stop";
  try {
    const input = JSON.parse(body || "{}") as { action?: unknown };
    if (
      input.action !== "pause" &&
      input.action !== "resume" &&
      input.action !== "stop"
    ) {
      return sendJson(res, 400, { error: "Unknown Aloud playback action." });
    }
    action = input.action;
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON." });
  }
  aloud
    .control(action)
    .then((status) => sendJson(res, 200, status))
    .catch((error) => sendAloudError(res, error));
}

function sendAloudError(res: ServerResponse, error: unknown): void {
  const status = Number(
    (error as { statusCode?: unknown } | undefined)?.statusCode,
  );
  // Flag blips the reader can recover from (a timeout, a dropped keep-alive
  // socket) so the narration loop can retry instead of tearing playback down and
  // telling the reviewer narration is unavailable.
  const transient =
    (error as { transient?: unknown } | undefined)?.transient === true;
  sendJson(
    res,
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503,
    {
      error: error instanceof Error ? error.message : "Aloud is unavailable.",
      ...(transient ? { transient: true } : {}),
    },
  );
}

const MERMAID_BROWSER_ASSET = new URL("./mermaid.esm.min.mjs", import.meta.url);

function sendMermaidBrowserAsset(res: ServerResponse): void {
  if (!existsSync(MERMAID_BROWSER_ASSET)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const stat = statSync(MERMAID_BROWSER_ASSET);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "public, max-age=3600");
  createReadStream(MERMAID_BROWSER_ASSET).pipe(res);
}

// Self-hosted woff2 for the Signal / Thread-Ledger type system. Served
// same-origin so the font-src 'self' CSP needs no change. The allowlist is the
// path-traversal guard: only these exact filenames resolve, everything else 404s.
const FONT_ASSET_DIR = new URL("./assets/fonts/", import.meta.url);
const FONT_ASSET_FILES = new Set([
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-500-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-sans-latin-700-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-500-normal.woff2",
  "ibm-plex-mono-latin-600-normal.woff2",
  "ibm-plex-mono-latin-700-normal.woff2",
  "space-grotesk-latin-500-normal.woff2",
  "space-grotesk-latin-600-normal.woff2",
  "space-grotesk-latin-700-normal.woff2",
]);

function sendFontAsset(res: ServerResponse, name: string): void {
  if (!FONT_ASSET_FILES.has(name)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const asset = new URL(name, FONT_ASSET_DIR);
  if (!existsSync(asset)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const stat = statSync(asset);
  res.statusCode = 200;
  res.setHeader("Content-Type", "font/woff2");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  createReadStream(asset).pipe(res);
}

const CLIENT_ASSET_DIR = new URL("./client/", import.meta.url);
const CLIENT_ASSET_TYPES = new Map<string, string>([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

/**
 * Serve a React surface bundle or the compiled stylesheet from dist/client.
 *
 * The filenames are not content-hashed, so these must not be cached the way the
 * immutable font files are — a stale bundle after a rebuild would be silent and
 * baffling. `no-cache` still allows revalidation, so warm loads stay cheap.
 */
function sendClientAsset(res: ServerResponse, name: string): void {
  // Reject traversal and nested paths outright: this directory is flat.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const type = CLIENT_ASSET_TYPES.get(name.slice(name.lastIndexOf(".")));
  if (!type) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const asset = new URL(name, CLIENT_ASSET_DIR);
  if (!existsSync(asset)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const stat = statSync(asset);
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(asset).pipe(res);
}

function sendHtml(res: ServerResponse, html: string, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Never cache a page shell. It embeds the review page lease token and the
  // session's current state, so a cached copy is not merely stale — it hands
  // back a dead lease. It is also why a rebuilt app could still look unchanged
  // until a hard reload.
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function errorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${APP_BRAND} — error</title>
<style>body{background:#0e0f13;color:#e7e8ec;font:15px/1.6 system-ui;padding:60px;max-width:70ch;margin:auto}
code{background:#16181d;padding:2px 6px;border-radius:4px}h1{color:#f85149}</style></head>
<body><h1>Couldn't build the review</h1><pre><code>${escapeText(message)}</code></pre>
<p>Fix the issue above and refresh. Most often the story is missing or malformed — open the diff and generate a fresh one.</p>
</body></html>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is best-effort */
  }
}
