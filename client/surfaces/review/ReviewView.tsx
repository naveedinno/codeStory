// The Files view and the Review view.
//
// Files view is all stubs. Every `.ds-filepanel` ships as a loading line and is
// filled from `GET /api/diff/file-panel?file=` when the reviewer selects it —
// and that panel's Split body is a SECOND lazy fetch on top. Only the active
// panel is un-`hidden`; none of them are unmounted, because `visibleDiffRoot()`
// and the change-jump walker resolve the active diff through the `hidden`
// attribute.
//
// Review view is the decision surface. Two things in it are easy to get wrong
// and are called out where they happen:
//
//   * The trust pill has six states in a strict precedence, and `pending` is
//     not the absence of a verdict — it is the honest statement that coverage
//     has not been computed, because computing it costs a whole-diff read this
//     page deliberately has not done. The pill says "Checking coverage…" and
//     `applyCoverageVerdict()` settles it after first paint. Defaulting
//     `uncovered` to 0 would turn an unknown into a green check.
//   * The queued-comment list renders EMPTY here. The engine owns those cards
//     (`syncFeedbackCards()`), which runs synchronously during `init()` seeded
//     with the payload's server-computed anchor states. Rendering them in React
//     too would mean two card builders for one card, drifting apart on the
//     first refresh.

import type { ReviewPayload } from "../../../src/payloads";
import { html, plural } from "./format";

function FilePanelStub({ file, index }: { file: ReviewPayload["files"][number]; index: number }) {
  return (
    <section
      className={`ds-filepanel${file.untoured ? " is-untoured" : ""}`}
      data-file-panel={index}
      data-file={file.file}
      data-review-hash={file.reviewHash}
      {...(file.kind === "new" ? { "data-newfile": "1" } : {})}
      {...(file.kind === "context" ? { "data-context-file": "1" } : {})}
      hidden={index !== 0}
    >
      <div className="ds-filepanel-loading" data-file-panel-lazy role="status">
        Loading file review…
      </div>
    </section>
  );
}

export function FilesView({ payload }: { payload: ReviewPayload }) {
  const excludedOnly = payload.files.length === 0 && payload.excludedFiles.length > 0;
  return (
    <div className="ds-view" id="ds-view-files" role="tabpanel" aria-labelledby="ds-tab-files" hidden>
      <div className="ds-filedetail" id="ds-file-detail">
        {payload.files.length ? (
          payload.files.map((file, index) => <FilePanelStub key={file.file} file={file} index={index} />)
        ) : excludedOnly ? (
          <ExcludedSection files={payload.excludedFiles} />
        ) : (
          <div className="ds-empty">No files in this change.</div>
        )}
      </div>
    </div>
  );
}

/** The wide excluded-scope notice, reused by the Files view's empty state. */
function ExcludedSection({ files }: { files: ReviewPayload["excludedFiles"] }) {
  const largeCount = files.filter((file) => file.reason === "large-diff").length;
  const singlePath = files.length === 1 ? files[0]?.path : undefined;
  const title =
    largeCount === 1 && files.length === 1
      ? "Large file kept lazy"
      : `${files.length} ${plural(files.length, "file")} kept lazy`;
  return (
    <div className="ds-excluded-only" role="note">
      <span className="ds-excluded-only-icon" aria-hidden="true">
        ↯
      </span>
      <div>
        <strong>{title}</strong>
        <p>
          {singlePath ? (
            <>
              <code className="ds-excluded-only-path">{singlePath}</code> remains
            </>
          ) : (
            "Still"
          )}{" "}
          part of this exact scope, but kept outside the diff DOM so the page stays fast.
        </p>
      </div>
      <button type="button" className="ds-btn ds-btn-ghost" data-goto-review="exclusions">
        Inspect bounded preview
      </button>
    </div>
  );
}

const EXCLUSION_REASON: Record<string, string> = {
  "generated-path": "Generated or vendored path",
  "large-diff": "Large diff",
  binary: "Binary or non-text change",
};

/**
 * The trust pill: one verdict, six states, strict precedence.
 *
 * Every fact except coverage is known here. Coverage needs the whole diff,
 * which the metadata-first render has not read — so `pending` ranks BELOW
 * everything known (an unknown must never mask a stale story or a staged
 * mismatch) and above the two verdicts only a resolved check can justify.
 */
function TrustPill({ payload }: { payload: ReviewPayload }) {
  const { chrome, excludedFiles, stagedWorktreeDivergentFiles: divergent, storyFreshness, trust, storyless } = payload;
  if (!chrome.showTrustPill) return null;
  const uncovered = trust.uncoveredCount;
  const state = divergent.length
    ? "divergent"
    : storyless && excludedFiles.length
      ? "excluded"
      : storyFreshness !== "current"
        ? "stale"
        : trust.pending
          ? "pending"
          : uncovered
            ? "uncovered"
            : "clean";
  // The arrow lands on the section that owns the fact the pill reports, not on
  // a generic anchor the reviewer then has to scan.
  const section =
    state === "divergent" ? "staged" : state === "excluded" ? "exclusions" : state === "uncovered" ? "unexplained" : "evidence";
  const classes = [
    "ds-trustpill",
    chrome.trustPillClean ? "is-clean" : "",
    state === "pending" ? "is-unknown" : "",
    excludedFiles.length || divergent.length ? "has-exclusions" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      className={classes}
      data-goto-review={section}
      data-trust-excluded={excludedFiles.length}
      {...(chrome.focusedStory ? { "data-trust-focused": "1" } : {})}
      title="Trust check — story freshness, coverage, staged state, and files outside the bounded renderer"
    >
      {state === "clean" ? (
        <span className="ds-check">✓</span>
      ) : state === "pending" ? (
        <span className="ds-tri ds-tri-spin">◌</span>
      ) : (
        <span className="ds-tri">▲</span>
      )}
      {state === "divergent" ? (
        <span>
          <b>{divergent.length}</b> staged/working-tree {plural(divergent.length, "mismatch")} · reconcile before
          deciding
        </span>
      ) : state === "excluded" ? (
        <span>
          <b>{excludedFiles.length}</b> excluded {plural(excludedFiles.length, "file")} · inspect before deciding
        </span>
      ) : state === "stale" ? (
        <span>
          <b>{storyFreshness === "stale" ? "Out of date" : "Unverified"}</b> story · regenerate it
        </span>
      ) : state === "pending" ? (
        <span data-trust-pill-text>Checking coverage…</span>
      ) : state === "uncovered" ? (
        <span>
          <b>{uncovered}</b> {plural(uncovered, "change")} not explained by the story
        </span>
      ) : (
        <span>
          {chrome.focusedStory ? "Story covers its selected scope" : "Story covers the rendered diff"}
          {excludedFiles.length ? (
            <>
              {" · "}
              <b>{excludedFiles.length}</b> excluded {plural(excludedFiles.length, "file")} to inspect
            </>
          ) : null}
        </span>
      )}
      <span className="ds-review-row-arrow">›</span>
    </button>
  );
}

/**
 * The Coverage tab's evidence block.
 *
 * `data-trust-uncovered` is how a later replacement settles the pill, and an
 * EMPTY value means "no verdict" — the client must leave the pill alone rather
 * than read a missing answer as zero.
 *
 * The `unexplained` section is deliberately absent: it exists only when
 * coverage has resolved AND ranges are uncovered, which cannot be true at first
 * paint (the route always renders `trustPending`). It arrives, with its diff
 * rows, from `GET /api/review/trust`.
 */
function TrustEvidence({ payload }: { payload: ReviewPayload }) {
  const { trust, storyless, excludedFiles, stagedWorktreeDivergentFiles: divergent } = payload;
  const clean = !trust.uncoveredCount;
  return (
    <div
      className="ds-trust-evidence"
      data-trust-evidence
      data-trust-pending={trust.pending ? "1" : "0"}
      data-trust-uncovered={trust.pending ? "" : trust.uncoveredCount}
      data-trust-storyless={storyless ? "1" : "0"}
    >
      <section
        className="ds-reviewpage-section"
        data-review-section="evidence"
        aria-labelledby="ds-reviewpage-evidence-h"
        tabIndex={-1}
      >
        <h2 className="ds-reviewpage-h" id="ds-reviewpage-evidence-h">
          Coverage
        </h2>
        <div className="ds-trust-sub">
          {storyless
            ? "Exact change scope, staging state, and files outside the bounded renderer."
            : "Coverage of the bounded review, plus every file kept outside it."}
        </div>
        {storyless || trust.pending ? null : (
          <div className="ds-trust-stats">
            <div className="ds-trust-stat ok">
              <div className="ds-trust-num">{trust.coveredLines}</div>
              <div className="ds-trust-lbl">changed {plural(trust.coveredLines, "line")} covered by a step</div>
            </div>
            <div className="ds-trust-stat warn">
              <div className="ds-trust-num">{trust.uncoveredLines}</div>
              <div className="ds-trust-lbl">{plural(trust.uncoveredLines, "change")} no step explains</div>
            </div>
          </div>
        )}
        {trust.pending ? (
          <div className="ds-trust-clean">
            Coverage is calculated from lazy file evidence as it is requested. This page does not call an unloaded
            change &ldquo;covered.&rdquo;
          </div>
        ) : storyless ? (
          <div className="ds-trust-clean">
            The full bounded diff is available file by file. No story-coverage claim is applied in this view.
          </div>
        ) : clean ? (
          <div className="ds-trust-clean">✓ Every changed range in the bounded renderer is fully explained by a step.</div>
        ) : null}
        <div className="ds-trust-foot">
          {storyless
            ? "The page shows the bounded diff directly. You still need to inspect excluded files and reconcile divergent staged state before deciding."
            : "Coverage means every rendered changed range is fully claimed by story steps. You still need to inspect excluded files before deciding."}
        </div>
      </section>

      {divergent.length ? (
        <section
          className="ds-reviewpage-section ds-exclusions"
          data-review-section="staged"
          aria-labelledby="ds-index-state-title"
          tabIndex={-1}
        >
          <h2 className="ds-reviewpage-h" id="ds-index-state-title">
            Staged state differs <span className="ds-option-count">{divergent.length}</span>
          </h2>
          <p className="ds-exclusions-note">
            These paths contain one version in Git&rsquo;s index and another in the working tree. A single combined
            diff cannot prove which version you intend to commit, so approval stays blocked until they match.
          </p>
          {divergent.map((path) => (
            <article key={path} className="ds-exclusion-card">
              <div>
                <code>{path}</code>
                <span>Index and working tree contain different bytes</span>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {excludedFiles.length ? (
        <section
          className="ds-reviewpage-section ds-exclusions"
          data-review-section="exclusions"
          aria-labelledby="ds-exclusions-title"
          tabIndex={-1}
        >
          <h2 className="ds-reviewpage-h" id="ds-exclusions-title">
            Outside the bounded renderer <span className="ds-option-count">{excludedFiles.length}</span>
          </h2>
          <p className="ds-exclusions-note">
            These files are part of the Git change but are not included in story coverage or the default diff DOM.
            Inspect them deliberately before deciding.
          </p>
          {excludedFiles.map((file) => (
            <article key={file.path} className="ds-exclusion-card" data-excluded-file={file.path}>
              <div>
                <code>{file.path}</code>
                <span>
                  {EXCLUSION_REASON[file.reason] ?? "Metadata-only change"} ·{" "}
                  {file.changedLines == null
                    ? "Binary or uncounted change"
                    : `${file.changedLines} changed ${plural(file.changedLines, "line")}`}
                </span>
              </div>
              <button type="button" className="ds-btn ds-btn-ghost" data-inspect-excluded={file.path}>
                Inspect current file
              </button>
              <div className="ds-exclusion-preview" data-excluded-preview hidden />
            </article>
          ))}
          <label className="ds-exclusion-ack">
            <input type="checkbox" data-exclusions-ack />
            <span>
              <strong>I inspected these exclusions</strong>
              <small>Bound to this exact diff; a code change clears the acknowledgment.</small>
            </span>
          </label>
        </section>
      ) : null}
    </div>
  );
}

const CHALLENGE_ITEMS: [string, string, string][] = [
  ["intent", "Challenge the intent", "Could the implementation be correct while solving the wrong user problem?"],
  [
    "failure",
    "Trace failure and rollback",
    "Follow errors, retries, partial writes, and cleanup—not only the happy path.",
  ],
  [
    "boundary",
    "Check trust boundaries",
    "Re-check permissions, untrusted input, state transitions, and value movement.",
  ],
  ["tests", "Look for the missing test", "Name the regression or edge case that would still escape the current suite."],
];

const REVIEW_TABS: [string, string][] = [
  ["coverage", "Coverage"],
  ["notes", "Comments"],
  ["challenge", "Challenge"],
  ["actions", "Actions"],
];

/**
 * What the Coverage tab's flag says.
 *
 * Ranges the story never explains get a count; files merely kept outside the
 * renderer get a bare mark. The two are different kinds of debt and adding them
 * together would invent a number that means nothing.
 */
function coverageFlag(uncovered: number, outside: number): { flag: string; label: string } {
  if (uncovered) return { flag: `▲${uncovered}`, label: `${uncovered} ${plural(uncovered, "change")} not explained by the story` };
  if (outside) return { flag: "▲", label: "files to inspect outside the story" };
  return { flag: "", label: "" };
}

export function ReviewPage({ payload }: { payload: ReviewPayload }) {
  const { chrome, trust, excludedFiles, stagedWorktreeDivergentFiles: divergent, routeBase } = payload;
  const openCount = chrome.openCount;
  // A pending page has no honest value for the flag, so it ships empty and the
  // client fills it in. The mark is decorative and the tab's own label is what
  // a screen reader reads, so the two are written together.
  const coverage = trust.pending
    ? { flag: "", label: "" }
    : coverageFlag(trust.uncoveredCount, excludedFiles.length + divergent.length);
  const challengeTargets = (payload.challengeTargets ?? []).flatMap((target) => {
    const step = payload.steps[target.panelIndex - 1];
    return step ? [{ ...target, step }] : [];
  });

  return (
    <div className="ds-view" id="ds-view-review" role="tabpanel" aria-labelledby="ds-tab-review" hidden>
      <div className="ds-reviewpage" data-review-tab="coverage">
        {/* Pinned above the tabs: a reviewer reading their notes should not have
            to scroll back to remember whether the story still covers the diff. */}
        <div className="ds-reviewsummary" data-review-section="status" tabIndex={-1}>
          <span className="ds-review-summary-label">
            <span className="ds-dot ds-dot-amber" />
            <span data-review-summary-count>
              <b>{openCount}</b> queued {plural(openCount, "comment")}
            </span>
          </span>
          {!chrome.feedbackHealthy ? (
            <div className="ds-feedback-health-alert" role="alert">
              <strong>Feedback file needs repair</strong>
              <span>{chrome.feedbackRecovery}</span>
            </div>
          ) : null}
          <TrustPill payload={payload} />
        </div>

        <div className="ds-reviewtabs" role="tablist" aria-label="Review sections">
          {REVIEW_TABS.map(([id, label]) => {
            const active = id === "coverage";
            return (
              <button
                key={id}
                className={`ds-reviewtab${active ? " is-active" : ""}`}
                type="button"
                role="tab"
                id={`ds-reviewtab-${id}`}
                data-review-tab-select={id}
                aria-controls={`ds-reviewpanel-${id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                {...(id === "coverage" && coverage.label ? { "aria-label": `Coverage, ${coverage.label}` } : {})}
              >
                {label}
                {id === "coverage" ? (
                  <span className="ds-reviewtab-flag" data-coverage-flag aria-hidden="true" hidden={!coverage.flag}>
                    {coverage.flag}
                  </span>
                ) : null}
                {id === "notes" ? (
                  <span className="ds-reviewtab-count" data-review-open-notes hidden={!openCount}>
                    {openCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          className="ds-reviewpanel"
          id="ds-reviewpanel-coverage"
          role="tabpanel"
          aria-labelledby="ds-reviewtab-coverage"
          data-review-panel="coverage"
          tabIndex={0}
        >
          <TrustEvidence payload={payload} />
        </div>

        <div
          className="ds-reviewpanel"
          id="ds-reviewpanel-notes"
          role="tabpanel"
          aria-labelledby="ds-reviewtab-notes"
          data-review-panel="notes"
          tabIndex={0}
          hidden
        >
          <section
            className="ds-reviewpage-section"
            data-review-section="notes"
            aria-labelledby="ds-reviewpage-notes-h"
            tabIndex={-1}
          >
            <div className="ds-queue-head">
              <div className="ds-queue-title">
                <h2 className="ds-reviewpage-h" id="ds-reviewpage-notes-h">
                  Review comments{" "}
                  <span className="ds-reviewpage-sub" data-queue-summary hidden={!openCount}>
                    {openCount} queued
                  </span>
                </h2>
                <p>Collect comments while you review, then copy the complete queue when you are ready.</p>
              </div>
              <div className="ds-queue-actions">
                <button
                  type="button"
                  className="ds-btn ds-btn-solid ds-copy-action"
                  data-copy-comments="queued"
                  disabled={!openCount}
                  aria-label="Copy all queued comments"
                >
                  <span className="ds-copy-action-icon" aria-hidden="true">
                    <span className="ds-copy-action-copy" />
                    <span className="ds-copy-action-check">✓</span>
                  </span>
                  <span data-copy-comments-label>Copy all</span>
                </button>
              </div>
            </div>
            {/* Filled by the engine's syncFeedbackCards(); see the file header. */}
            <div className="ds-feedback-list" data-feedback-view="feedback" />
          </section>
        </div>

        <div
          className="ds-reviewpanel"
          id="ds-reviewpanel-challenge"
          role="tabpanel"
          aria-labelledby="ds-reviewtab-challenge"
          data-review-panel="challenge"
          tabIndex={0}
          hidden
        >
          <section
            className="ds-reviewpage-section"
            data-review-section="challenge"
            aria-labelledby="ds-reviewpage-challenge-h"
            tabIndex={-1}
          >
            <h2 className="ds-reviewpage-h" id="ds-reviewpage-challenge-h">
              Challenge pass
            </h2>
            <div className="ds-challenge-panel" data-feedback-view="challenge">
              <div className="ds-challenge-head">
                <strong>Adversarial review pass</strong>
                <p>This checklist structures a human second pass; it does not certify the change.</p>
              </div>
              <div className="ds-challenge-list">
                {CHALLENGE_ITEMS.map(([id, title, detail]) => (
                  <label key={id} className="ds-challenge-item">
                    <input type="checkbox" data-challenge-check={id} />
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                  </label>
                ))}
              </div>
              {challengeTargets.length ? (
                <div className="ds-challenge-targets">
                  <span>Where to look closer</span>
                  {challengeTargets.map(({ step, panelIndex, reasons }) => (
                    <button key={step.id} type="button" className="ds-challenge-target" data-goto-step={panelIndex}>
                      <span>Step {step.order}</span>
                      <strong><span dangerouslySetInnerHTML={html(step.title.html)} /><small className="ds-challenge-reason">{reasons.join(" · ")}</small></strong>
                      <i aria-hidden="true">→</i>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div
          className="ds-reviewpanel"
          id="ds-reviewpanel-actions"
          role="tabpanel"
          aria-labelledby="ds-reviewtab-actions"
          data-review-panel="actions"
          tabIndex={0}
          hidden
        >
          <section
            className="ds-reviewpage-section"
            data-review-section="actions"
            aria-labelledby="ds-reviewpage-actions-h"
            tabIndex={-1}
          >
            <h2 className="ds-reviewpage-h" id="ds-reviewpage-actions-h">
              Review actions
            </h2>
            <div className="ds-review-section">
              <a className="ds-review-option" href={`${routeBase}/stories`}>
                <span className="ds-review-option-title">Review history</span>
                <span className="ds-review-option-desc">Open an earlier saved review for this repository.</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
