// The Story view: the Overview panel, one lazy stub per step, and the floating
// filmstrip island.
//
// The single most important thing in this file is what it does NOT render.
// Every step ships as a stub — a `<section>` with a loading line and an
// invisible speech cache — and its real content arrives from
// `GET /api/review/step-panel?index=N` as server-rendered HTML when the
// reviewer walks onto it. A React port that reached for `steps.map(<Step/>)`
// with real content would put a 300-step story's whole highlighted diff into
// the initial document, which is precisely what the metadata-first render
// (`files: []`, empty detail sets, `trustPending: true`) exists to avoid.
//
// The `[data-step-speech-cache]` block inside each stub is the other half of
// that. It is `sr-only`, it looks like dead weight, and it is the only reason
// narration can plan a whole story without fetching a single panel: delete it
// and pressing Play on a 300-step story becomes 300 requests. It carries the
// same `[data-speech-beat]` / `[data-speech-concept]` / `.ds-why-text` nodes
// the loaded panel would.

import type { ReviewPayload, ReviewStepView } from "../../../src/payloads";
import { ExcludedScopeNotice, StoryMark } from "./Sidebar";
import { fileExtension, formatCount, html, numeral, plural, refLabel, withBreaks } from "./format";
import { StoryHealthRow } from "./StoryHealth";
import { NarrationSettings } from "./NarrationSettings";

/** The invisible narration index inside a lazy stub. */
function SpeechCache({ step }: { step: ReviewStepView }) {
  if (step.kind === "concept") {
    return (
      <div className="ds-sr-only" data-step-speech-cache>
        <span data-speech-concept>{step.conceptSpeech ?? ""}</span>
      </div>
    );
  }
  if (!step.beats.length) {
    return (
      <div className="ds-sr-only" data-step-speech-cache>
        <span className="ds-why-text" data-speech-text={step.why?.speech ?? ""}>
          {step.why?.text ?? ""}
        </span>
      </div>
    );
  }
  return (
    <div className="ds-sr-only" data-step-speech-cache>
      {step.beats.map((beat) => (
        <span
          key={beat.focusGroup}
          data-speech-beat={beat.focusGroup}
          data-focus-group={beat.focusGroup}
          data-speech-text={beat.text.speech}
        >
          {beat.text.text}
        </span>
      ))}
    </div>
  );
}

function LazyStepPanel({ step, index }: { step: ReviewStepView; index: number }) {
  return (
    <section
      className={`ds-step ds-step-lazy${step.kind === "concept" ? " ds-concept-step" : " is-code-step"}`}
      data-step-panel={index + 1}
      data-step-id={step.id}
      data-scene-layout={step.sceneLayout}
      data-step-lazy="1"
      hidden
    >
      <SpeechCache step={step} />
      <div className="ds-step-loading" role="status">
        Loading this review step…
      </div>
    </section>
  );
}

function DriftStatus({ drift }: { drift: NonNullable<ReviewPayload["storyDrift"]> }) {
  if (drift.state === "current") {
    return (
      <div className="ds-intro-freshness is-current" role="status">
        <span aria-hidden="true">✓</span>
        <span>Story current</span>
      </div>
    );
  }
  const needsRefresh = drift.inScopeFiles > 0;
  const parts = [
    drift.inScopeFiles ? `${formatCount(drift.inScopeFiles)} story ${plural(drift.inScopeFiles, "file")}` : "",
    drift.outsideScopeFiles
      ? `${formatCount(drift.outsideScopeFiles)} ${plural(drift.outsideScopeFiles, "file")} outside the story`
      : "",
  ]
    .filter(Boolean)
    .join(" + ");
  return (
    <button
      type="button"
      className={`ds-intro-freshness ds-drift-trigger${needsRefresh ? " is-stale" : " is-current"}`}
      data-drift-open
      aria-haspopup="dialog"
      aria-controls="ds-drift-drawer"
      aria-expanded="false"
    >
      <span aria-hidden="true">{needsRefresh ? "▲" : "✓"}</span>
      <span>{`${needsRefresh ? "Story needs refresh" : "Story current"} · ${parts} changed`}</span>
      <span className="ds-drift-trigger-link">See changes →</span>
    </button>
  );
}

/**
 * A code story's freshness. Its commit never changes, so the only question is
 * whether the files it visits moved on in the working tree, and the way
 * forward is a rewrite of the same question at the current code.
 */
function CodeDriftStatus({ payload }: { payload: ReviewPayload }) {
  const code = payload.code;
  if (!code) return null;
  if (code.drift.state === "current") {
    return (
      <div className="ds-intro-freshness is-current" role="status">
        <span aria-hidden="true">✓</span>
        <span>{`Code unchanged since ${code.shortCommit}`}</span>
      </div>
    );
  }
  if (code.drift.state === "unverified") {
    return (
      <div className="ds-intro-freshness" role="status">
        <span aria-hidden="true">▲</span>
        <span>{`Cannot compare with ${code.shortCommit} in this checkout`}</span>
      </div>
    );
  }
  const rewrite =
    code.storyId && !payload.history ? (
      <a href={`${payload.routeBase}/explain?story=${encodeURIComponent(code.storyId)}`}>Rewrite at current code</a>
    ) : null;
  if (code.drift.state === "missing-commit") {
    return (
      <div className="ds-intro-freshness is-stale" role="status">
        <span aria-hidden="true">▲</span>
        <span>{`Commit ${code.shortCommit} is not in this repository; this story was written somewhere else`}</span>
        {rewrite}
      </div>
    );
  }
  const changed = code.drift.files.length;
  return (
    <div className="ds-intro-freshness is-stale" role="status">
      <span aria-hidden="true">▲</span>
      <span>{`${formatCount(changed)} story ${plural(changed, "file")} changed since ${code.shortCommit}`}</span>
      {rewrite}
    </div>
  );
}

const FALLBACK_LEDE =
  "Each step builds on the one before it — read them in order, or jump to any file from the list.";

function ReadingPath({ arc }: { arc: NonNullable<ReviewPayload["story"]["arc"]> }) {
  const stages = arc.readingPath.split(/\s*->\s*/).map((stage) => stage.trim()).filter(Boolean);
  const visible = stages.length > 1 ? stages.join(" → ") : arc.readingPath.replaceAll("->", "→");
  const spoken = stages.length > 1 ? stages.join(", then ") : arc.readingPath.replaceAll("->", ", then ");
  return (
    <p className="ds-intro-reading">
      <span aria-hidden="true">{arc.changeTypeLabel}</span>
      <span aria-hidden="true">·</span>
      <span aria-hidden="true">{visible}</span>
      <span className="ds-sr-only">{`${arc.changeTypeLabel}. Reading path: ${spoken}`}</span>
    </p>
  );
}

function EvolutionDetails({ evolution }: { evolution: NonNullable<ReviewPayload["story"]["evolution"]> }) {
  return (
    <details className="ds-intro-evolution">
      <summary>
        <span>How this evolved</span>
        <small><span aria-hidden="true">·</span> {formatCount(evolution.commitCount)} {plural(evolution.commitCount, "commit")}</small>
        <span className="ds-intro-evolution-caret" aria-hidden="true">⌄</span>
      </summary>
      <ol>
        {evolution.phases.map((phase, index) => {
          const first = phase.firstCommit.slice(0, 7);
          const last = phase.lastCommit.slice(0, 7);
          return (
            <li key={`${phase.firstCommit}-${phase.lastCommit}`}>
              <span className="ds-evolution-index" aria-hidden="true">{index + 1}</span>
              <div className="ds-evolution-copy">
                <div className="ds-evolution-titleline">
                  <strong>{phase.title}</strong>
                  <span className="ds-evolution-range">
                    {formatCount(phase.commitCount)} {plural(phase.commitCount, "commit")} · {first}{first === last ? "" : `…${last}`}
                  </span>
                </div>
                <p dangerouslySetInnerHTML={html(phase.summary.html)} />
                {phase.relatedPanelIndex ? (
                  <button type="button" data-goto-step={phase.relatedPanelIndex}>
                    Review step {phase.relatedPanelIndex} <span aria-hidden="true">→</span>
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function IntroPanel({ payload }: { payload: ReviewPayload }) {
  const { story, hotspots, storyDrift, storyFreshness, routeBase } = payload;
  const summaryHtml = story.summary ? withBreaks(story.summary.html) : "";
  const goalHtml = story.intent ? withBreaks(story.intent.goal.html) : "";
  // With a recovered intent the goal leads and the summary becomes the reading
  // map; without one the summary (or a generic line) is the lede.
  const ledeHtml = goalHtml || summaryHtml || FALLBACK_LEDE;
  // Narration reads `data-speech-text` when present, so the spoken Overview is
  // the speech projection rather than whatever the visible markup flattens to.
  const ledeSpeech = story.intent?.goal.speech || story.summary?.speech || FALLBACK_LEDE;

  const design = goalHtml && story.intent?.design ? story.intent.design : undefined;
  const map = goalHtml && story.summary ? story.summary : undefined;
  const nonGoals = story.intent?.nonGoals ?? [];
  const verification = story.verification ?? [];
  // A code story explains code at one commit: it has no change to frame and
  // no diff to cover, and the reader's own question belongs beside the answer.
  const code = payload.subject === "code" ? payload.code : undefined;
  const question = code?.question;
  const hasContext = !!design || !!map || nonGoals.length > 0 || verification.length > 0 || !!question;

  const solidityOnly =
    payload.storyIncludedFiles.length > 0 &&
    payload.storyIncludedFiles.every((file) => file.toLowerCase().endsWith(".sol"));
  const scopeText = solidityOnly
    ? `Solidity only · ${payload.storyFilesChanged} ${plural(payload.storyFilesChanged, "file")}`
    : `${payload.storyFilesChanged} ${plural(payload.storyFilesChanged, "file")} in story`;

  return (
    <section className="ds-step is-intro" data-step-panel="0" data-scene-layout="opening">
      <div className="ds-introwrap">
        <span className="ds-intro-eyebrow">
          <StoryMark />
          <span>{code ? "The story of this code" : "The story of this change"}</span>
        </span>
        <h1 className="ds-intro-title" dangerouslySetInnerHTML={html(story.title.html)} />
        <p
          className="ds-intro-lede"
          data-speech-overview
          data-speech-text={ledeSpeech}
          dangerouslySetInnerHTML={html(ledeHtml)}
        />

        {code ? (
          <CodeDriftStatus payload={payload} />
        ) : storyDrift && storyDrift.state !== "unverified" ? (
          <DriftStatus drift={storyDrift} />
        ) : storyFreshness === "current" ? null : (
          <div
            className="ds-intro-freshness"
            role="status"
            aria-label={
              storyFreshness === "stale"
                ? "The diff changed after this story was generated. Regenerate the story before relying on coverage."
                : "This story baseline cannot be verified against its current scope. Regenerate the story before relying on coverage."
            }
          >
            <span aria-hidden="true">▲</span>
            <span>{storyFreshness === "stale" ? "Story is out of date" : "Freshness unverified"}</span>
            <a href={`${routeBase}/change`}>Regenerate</a>
          </div>
        )}

        {story.arc ? <ReadingPath arc={story.arc} /> : null}

        <div className="ds-intro-actions">
          {payload.steps.length ? (
            <button className="ds-intro-start" data-goto-step="1">
              <span className="ds-intro-start-main">
                Start the walkthrough <span className="ds-intro-arrow">→</span>
              </span>
            </button>
          ) : null}
        </div>

        {story.evolution ? <EvolutionDetails evolution={story.evolution} /> : null}

        <StoryHealthRow health={payload.health} />

        <div className="ds-intro-utility" role="group" aria-label="Story scope and optional review material">
          <span className="ds-intro-scope">
            {code ? `${payload.contextFiles} ${plural(payload.contextFiles, "file")} in story` : scopeText}
            <span className="ds-intro-base">
              {code ? (
                code.ref && code.ref !== code.commit ? (
                  <>
                    Explains <b>{code.ref}</b> at <b>{code.shortCommit}</b>
                  </>
                ) : (
                  <>
                    Explains commit <b>{code.shortCommit}</b>
                  </>
                )
              ) : payload.headRef ? (
                <>
                  <b>{payload.baseLabel}</b> → <b>{refLabel(payload.headRef)}</b>
                </>
              ) : (
                <>
                  Working tree vs <b>{payload.baseLabel}</b>
                </>
              )}
            </span>
          </span>
          {hotspots.length || hasContext ? (
            <details className="ds-intro-notes">
              <summary>
                <span>{code ? "Story notes" : "Review notes"}</span>
                <span className="ds-intro-notes-caret" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <div className="ds-intro-notes-body">
                {hotspots.length ? (
                  <div
                    className="ds-intro-hotspots"
                    role="note"
                    aria-label={code ? "Places the story asks you to read closely" : "Author-flagged review hotspots"}
                  >
                    <span className="ds-intro-block-kicker">
                      {code ? "Read these closely" : <>Where I&rsquo;d distrust this first</>}
                    </span>
                    <ul>
                      {hotspots.map((spot) => (
                        <li key={spot.panelIndex}>
                          <button type="button" data-goto-step={spot.panelIndex}>
                            <span className="ds-hotspot-step">
                              Step {spot.order} · <span dangerouslySetInnerHTML={html(spot.title.html)} />
                            </span>
                            <span className="ds-hotspot-reason" dangerouslySetInnerHTML={html(spot.reason.html)} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {hasContext ? (
                  <div className="ds-intro-context">
                    {question ? (
                      <div className="ds-intro-nongoals">
                        <span className="ds-intro-block-kicker">Your question</span>
                        <p className="ds-intro-design">{question}</p>
                      </div>
                    ) : null}
                    {design && code ? (
                      <div className="ds-intro-nongoals">
                        <span className="ds-intro-block-kicker">The short answer</span>
                        <p
                          className="ds-intro-design"
                          data-speech-overview
                          data-speech-text={design.speech}
                          dangerouslySetInnerHTML={html(withBreaks(design.html))}
                        />
                      </div>
                    ) : design ? (
                      <p
                        className="ds-intro-design"
                        data-speech-overview
                        data-speech-text={design.speech}
                        dangerouslySetInnerHTML={html(withBreaks(design.html))}
                      />
                    ) : null}
                    {map ? (
                      <p
                        className="ds-intro-design"
                        data-speech-overview
                        data-speech-text={map.speech}
                        dangerouslySetInnerHTML={html(withBreaks(map.html))}
                      />
                    ) : null}
                    {/* Deliberate omissions, so the reviewer does not flag what
                        the author skipped on purpose. */}
                    {nonGoals.length ? (
                      <div className="ds-intro-nongoals">
                        <span className="ds-intro-block-kicker">
                          {code ? "Not covered here" : "Deliberately not touched"}
                        </span>
                        <ul>
                          {nonGoals.map((goal, index) => (
                            <li key={index} dangerouslySetInnerHTML={html(goal.html)} />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {verification.length ? (
                      <div className="ds-intro-verification">
                        <span className="ds-intro-block-kicker">Verification evidence</span>
                        <ul>
                          {verification.map((entry, index) => (
                            <li key={index} data-result={entry.result} data-verification-row={index}>
                              <span className="ds-verify-result">
                                {entry.result === "passed" ? "Reported passed" : entry.result === "failed" ? "Reported failed" : "Not run"}
                              </span>
                              <span className="ds-verify-check">{entry.check}</span>
                              {entry.detail ? (
                                <span className="ds-verify-detail" dangerouslySetInnerHTML={html(entry.detail.html)} />
                              ) : null}
                              {!payload.history ? <button type="button" className="ds-btn ds-btn-ghost" data-run-verification={index}>Run locally…</button> : null}
                              <div className="ds-verification-receipt" data-verification-receipt aria-live="polite" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          <button type="button" className="ds-intro-allfiles" data-open-all-files>
            {code ? "Files in this story" : "All files"} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

const DEPTHS: [string, string, string, string, string][] = [
  [
    "brief",
    "Quick tour",
    "Shortest",
    "The fewest stops that still answer the question.",
    "Same selected changes",
  ],
  [
    "guided",
    "Guided tour",
    "Recommended",
    "One stop per idea, with the context each one needs.",
    "Same selected changes",
  ],
  [
    "detailed",
    "Deep dive",
    "Most detail",
    "Smaller stops for every guard, branch, state write, and test on the path.",
    "Trivial syntax stays skipped",
  ],
];

const AUDIENCES: [string, string, string][] = [
  ["newcomer", "Newcomer", "Full landings and primers for anything unfamiliar."],
  ["familiar", "Familiar", "Terse landings, primers only for ideas this change introduces."],
];

function StoryScopeControls({ files }: { files: ReviewPayload["files"] }) {
  const changed = files.filter((file) => file.kind !== "context");
  const extensions = [...new Set(changed.map((file) => fileExtension(file.file)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return (
    <>
      <label className="ds-storygen-field ds-field-note">
        <span className="ds-storygen-labelrow">
          <span className="ds-storygen-label" id="storyReviewerNoteLabel">
            What should this change accomplish?
          </span>
          <span className="ds-storygen-optional">Optional · recommended</span>
        </span>
        <textarea
          id="storyReviewerNote"
          rows={4}
          aria-labelledby="storyReviewerNoteLabel"
          aria-describedby="storyReviewerNoteHelp"
          placeholder="Paste the request, acceptance criteria, or anything the story must not miss."
        />
        <small className="ds-storygen-help" id="storyReviewerNoteHelp">
          This helps the agent separate intended behavior from accidental changes.
        </small>
      </label>
      <details className="ds-storyscope" data-story-scope open={changed.length <= 12}>
        <summary>
          <span className="ds-storyscope-copy">
            <span className="ds-storygen-label">Files to cover</span>
            <small>Every selected file gets the same coverage check.</small>
          </span>
          <span className="ds-storyscope-summary">
            <strong aria-live="polite">
              <b id="storyScopeCount">{formatCount(changed.length)}</b> of {formatCount(changed.length)} selected
            </strong>
            <span className="ds-storyscope-edit">Change</span>
            <span className="ds-storyscope-caret" aria-hidden="true">
              ⌄
            </span>
          </span>
        </summary>
        <div className="ds-storyscope-body">
          <label className="ds-storyfile-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" data-story-file-search placeholder="Find a file" aria-label="Find a story file" />
          </label>
          <div className="ds-storyscope-actions" role="group" aria-label="Story file selection shortcuts">
            {(
              [
                ["all", "Select all"],
                ["source", "Only source"],
                ["tests", "Only tests"],
                ["config", "Only config"],
                ["none", "Clear"],
              ] as [string, string][]
            ).map(([action, label]) => (
              <button key={action} className="ds-scopechip" type="button" data-story-scope-action={action}>
                {label}
              </button>
            ))}
            {extensions.map((ext) => (
              <button key={ext} className="ds-scopechip" type="button" data-story-ext={ext}>
                Only {ext}
              </button>
            ))}
          </div>
          <div className="ds-storyfiles">
            {changed.map((file) => (
              <label key={file.file} className="ds-storyfile" title={file.file}>
                <input type="checkbox" data-story-file value={file.file} defaultChecked />
                <span className="ds-storyfile-path">{file.file}</span>
                <span className="ds-storyfile-stat">
                  <span className="ds-stat-add">+{file.add}</span>
                  <span className="ds-stat-del">−{file.del}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="ds-storyscope-error" id="storyScopeError" tabIndex={-1} hidden>
            Select at least one file before generating the story.
          </p>
        </div>
      </details>
    </>
  );
}

/** The Story tab when there is no story yet. */
function GenerateCta({ payload }: { payload: ReviewPayload }) {
  const { excludedFiles, filesChanged, contextFiles, routeBase } = payload;
  const scope = excludedFiles.reduce(
    (facts, file) => ({
      changedFiles: facts.changedFiles + 1,
      addedLines: facts.addedLines + (file.addedLines ?? 0),
      removedLines: facts.removedLines + (file.removedLines ?? 0),
      hasUnknownLines: facts.hasUnknownLines || file.addedLines == null || file.removedLines == null,
    }),
    {
      changedFiles: filesChanged,
      addedLines: payload.totalAdd,
      removedLines: payload.totalDel,
      hasUnknownLines: false,
    },
  );
  const excludedOnly = filesChanged === 0 && excludedFiles.length > 0;
  return (
    <section className="ds-step is-intro" data-step-panel="0">
      <div className="ds-introwrap">
        <span className="ds-intro-eyebrow">
          <StoryMark />
          <span>No story yet</span>
        </span>
        <h1 className="ds-intro-title">
          {excludedOnly ? "Large change, lightweight review" : "Read the diff, or have the agent narrate it"}
        </h1>
        <p className="ds-intro-lede">
          {excludedOnly ? (
            "This scope contains a file whose full diff is too large to load here. Inspect its file preview under Review."
          ) : excludedFiles.length ? (
            <>
              Read the diff under <b>All files</b>. {formatCount(excludedFiles.length)}{" "}
              {plural(excludedFiles.length, "file")} {excludedFiles.length === 1 ? "stays" : "stay"} available
              separately under <b>Review</b>.
            </>
          ) : (
            <>
              The real diff is under <b>All files</b>. Keep reading it directly, or generate a story for this exact
              scope.
            </>
          )}
        </p>
        <div className="ds-intro-facts">
          <div className="ds-fact">
            <span className="ds-fact-n">{formatCount(scope.changedFiles)}</span>
            <span className="ds-fact-l">
              {plural(scope.changedFiles, "file")} changed
              {contextFiles ? ` · ${formatCount(contextFiles)} for context` : ""}
            </span>
          </div>
          <div className="ds-fact">
            <span className="ds-fact-n">
              <span className="ds-stat-add">+{formatCount(scope.addedLines)}</span>{" "}
              <span className="ds-stat-del">−{formatCount(scope.removedLines)}</span>
            </span>
            <span className="ds-fact-l">
              {scope.hasUnknownLines ? "known lines · binary counts separate" : "lines"}
            </span>
          </div>
        </div>

        {excludedOnly ? (
          <ExcludedScopeNotice files={excludedFiles} compact={false} />
        ) : (
          <div className="ds-storygen-card">
            <div className="ds-storygen-head">
              <div>
                <span className="ds-storygen-eyebrow">Story setup</span>
                <strong>Choose how the story should guide your review</strong>
                <p>
                  {excludedFiles.length
                    ? `The story covers the ${formatCount(filesChanged)} ${plural(filesChanged, "file")} you select. Review the ${formatCount(excludedFiles.length)} excluded ${plural(excludedFiles.length, "file")} separately.`
                    : "Every mode reviews the same selected changes. Depth changes the grouping, context, and explanation—not the coverage."}
                </p>
              </div>
            </div>
            <div className="ds-storygen-grid">
              <fieldset className="ds-storygen-field ds-field-detail">
                <legend className="ds-storygen-label">Review depth</legend>
                <p className="ds-storygen-help" id="storyDepthHelp">
                  Choose how much guidance you want, not how much code you are willing to miss.
                </p>
                <input id="storyMode" type="hidden" value="guided" />
                <div
                  className="ds-depthchoices"
                  role="radiogroup"
                  aria-label="Story depth"
                  aria-describedby="storyDepthHelp"
                >
                  {DEPTHS.map(([value, title, badge, desc, meta]) => {
                    const active = value === "guided";
                    return (
                      <button
                        key={value}
                        className={`ds-depthchoice${active ? " is-active" : ""}`}
                        type="button"
                        role="radio"
                        data-story-choice="storyMode"
                        data-value={value}
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                      >
                        <span className="ds-depthchoice-top">
                          <span className="ds-depthchoice-radio" aria-hidden="true" />
                          <strong>{title}</strong>
                          <span className={`ds-depthchoice-badge${active ? " is-recommended" : ""}`}>{badge}</span>
                        </span>
                        <span className="ds-depthchoice-desc">{desc}</span>
                        <span className="ds-depthchoice-meta">{meta}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="ds-storygen-field ds-field-agent is-wide">
                <span className="ds-storygen-label">Writer</span>
                <input id="storyAgentSel" type="hidden" value="" />
                <div className="ds-choicegroup" id="storyAgentChoices" role="radiogroup" aria-label="Story writer" />
                <p className="ds-storygen-agent-state" data-story-agent-state aria-live="polite" tabIndex={-1}>
                  Checking available writers…
                </p>
              </div>
              <div className="ds-storygen-field ds-field-model" data-story-quality-field hidden>
                <span className="ds-storygen-label">Quality</span>
                <input id="storyModelSel" type="hidden" value="" />
                <div className="ds-choicegroup" id="storyModelChoices" role="radiogroup" aria-label="Story quality" />
              </div>
              <fieldset className="ds-storygen-field ds-field-audience">
                <legend className="ds-storygen-label">Audience</legend>
                <p className="ds-storygen-help" id="storyAudienceHelp">
                  Who the story is written for. Your choice is remembered for this repo.
                </p>
                <input id="storyAudience" type="hidden" value={payload.audience} />
                <div
                  className="ds-choicegroup"
                  role="radiogroup"
                  aria-label="Story audience"
                  aria-describedby="storyAudienceHelp"
                >
                  {AUDIENCES.map(([value, title, desc]) => {
                    const active = value === payload.audience;
                    return (
                      <button
                        key={value}
                        className={`ds-choice${active ? " is-active" : ""}`}
                        type="button"
                        role="radio"
                        data-story-choice="storyAudience"
                        data-value={value}
                        title={desc}
                        aria-label={`${title}: ${desc}`}
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                      >
                        {title}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <StoryScopeControls files={payload.files} />
            </div>
            <button
              className="ds-intro-start ds-storygen-button"
              data-generate-story
              disabled
              data-review-url={`${routeBase}/review?story=story.json`}
              {...(payload.baseRef ? { "data-base": payload.baseRef } : {})}
              {...(payload.headRef ? { "data-head": payload.headRef } : {})}
            >
              <span className="ds-intro-start-main">
                <span data-storygen-cta-label>Generate guided review</span>{" "}
                <span className="ds-intro-arrow">→</span>
              </span>
              <span className="ds-intro-start-sub" data-storygen-cta-sub>
                {formatCount(filesChanged)} {plural(filesChanged, "file")} selected · gaps are flagged as unexplained
              </span>
            </button>
            <p className="ds-storygen-warn" id="storySkillWarn" hidden>
              <span id="storySkillWarnText" />
              <button className="ds-storygen-fix" id="storySkillUpdateBtn" type="button">
                Update skills
              </button>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The filmstrip island: transport, the adopted beat dock, and the numeral
 * thread.
 *
 * The stage is deliberately empty markup. Each step still renders its OWN
 * `[data-beat-dock]` — that is what the lazy step endpoint returns — and
 * `adoptStepDocks()` moves the active step's dock into the stage. One island,
 * not two bars: a dock rendered inside the step panel would scroll away with
 * the diff.
 */
function FilmstripThread({ steps }: { steps: ReviewStepView[] }) {
  return (
    <div className="ds-dock" data-story-dock>
      <div className="ds-dock-transport">
        <div className="ds-narration" data-narration>
          <div className="ds-narration-actions">
            <button
              className="ds-readaloud ds-readaloud-primary"
              data-readaloud
              type="button"
              title="Play story"
              aria-label="Play story"
              aria-pressed="false"
            >
              <span className="ds-readaloud-ico is-play" aria-hidden="true" />
              <span className="ds-readaloud-label" data-readaloud-label>
                Play
              </span>
              <span className="ds-readaloud-wave" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            </button>
            <button
              className="ds-narration-stop"
              data-aloud-stop
              type="button"
              title="Stop narration"
              aria-label="Stop narration"
              hidden
            >
              <span aria-hidden="true" />
            </button>
            <NarrationSettings />
          </div>
        </div>
        <div className="ds-dock-stage" data-dock-slot>
          <p className="ds-dock-idle" data-dock-idle>
            Overview
          </p>
        </div>
      </div>
      <nav
        className="ds-filmthread is-overview"
        data-filmthread
        aria-label="Reading order"
        style={{ "--thread-pct": "0%" } as React.CSSProperties}
      >
        <div className="ds-filmthread-scroll">
          <div className="ds-filmthread-nodes">
            <div className="ds-filmthread-line" aria-hidden="true" />
            <button
              type="button"
              className="ds-filmnode is-overview is-active"
              data-thread-node="0"
              data-goto-step="0"
              aria-label="Overview"
              tabIndex={0}
            >
              <span className="ds-filmnode-num" aria-hidden="true">
                ◆
              </span>
              <span className="ds-filmnode-label">Overview</span>
            </button>
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className="ds-filmnode"
                data-thread-node={index + 1}
                data-goto-step={index + 1}
                aria-label={`Step ${index + 1}: ${step.title.text}`}
                tabIndex={-1}
              >
                <span className="ds-filmnode-num" aria-hidden="true">
                  {numeral(index + 1)}
                </span>
                <span className="ds-filmnode-label" dangerouslySetInnerHTML={html(step.title.html)} />
              </button>
            ))}
          </div>
        </div>
        <span className="ds-filmthread-tooltip" data-filmthread-tooltip aria-hidden="true" />
      </nav>
    </div>
  );
}

export function StoryView({ payload }: { payload: ReviewPayload }) {
  const excludedOnly = payload.files.length === 0 && payload.excludedFiles.length > 0;
  return (
    <div className="ds-view" id="ds-view-tour" role="tabpanel" aria-labelledby="ds-tab-tour">
      {payload.storyless ? <GenerateCta payload={payload} /> : <IntroPanel payload={payload} />}
      {payload.storyless
        ? null
        : payload.steps.map((step, index) => <LazyStepPanel key={step.id} step={step} index={index} />)}
      {payload.storyless ? (
        // A storyless page has no numerals to walk, and the view switch lives in
        // the chrome. The only bar worth drawing is the excluded-file escape.
        excludedOnly ? (
          <nav className="ds-filmthread is-storyless" data-filmthread aria-label="Review navigation">
            <div className="ds-filmthread-scroll" />
            <button type="button" className="ds-filmthread-allfiles" data-goto-review="exclusions">
              {payload.excludedFiles.length === 1
                ? "Review excluded file"
                : `Review ${formatCount(payload.excludedFiles.length)} ${plural(payload.excludedFiles.length, "excluded file")}`}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </nav>
        ) : null
      ) : (
        <FilmstripThread steps={payload.steps} />
      )}
    </div>
  );
}
