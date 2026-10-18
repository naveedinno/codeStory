// Server-rendered diff fragments, and the review page's bootstrap payload.
//
// This file used to be the whole review page: 2,400 lines that produced one
// self-contained HTML document with all CSS and JS inlined. The page is React
// now (`client/surfaces/review/`), and what is left here is the half that
// genuinely belongs on the server:
//
//   * the DIFF FRAGMENT renderers. `diff-render.ts`, `highlight.ts` and
//     `intra-line.ts` still emit rows as HTML strings, and the lazy endpoints
//     (`/api/review/step-panel`, `/api/diff/file-panel`, `/api/diff/split`,
//     `/api/fullfile`, `/api/diff/context`, `/api/review/trust`,
//     `/api/story-drift/file`) still answer with them. React injects those with
//     `dangerouslySetInnerHTML` and reads the 30 `data-*` attributes on the
//     markup through ONE delegated handler. React must not own row rendering:
//     a very large bounded file is thousands of rows, and the annotation and
//     focus-group passes measure them with live `getBoundingClientRect()`.
//   * `renderReviewShell()`, which builds the `ReviewPayload` and hands it to
//     the shared shell.
//
// Authored text and code are escaped here, server-side. The one client-side
// HTML insertion remains locally rendered Mermaid SVG, parsed and sanitized in
// the browser before it reaches the DOM.
import { buildReviewModel, pairChangeRows } from "./view-model.js";
import { challengeTargets } from "./challenge.js";
import { intraLineMap } from "./intra-line.js";
import { renderSplitRow, renderUnifiedRow, renderHunkGap, SplitColumns, untouredRuns, wholeUntoured, plainRows, } from "./diff-render.js";
import { renderShell } from "./shell.js";
import { APP_BRAND } from "./config.js";
import { readWholeFile } from "./git.js";
import { storyHealth } from "./story-health.js";
function commentSide(c) {
    return c.side === "left" ? "left" : "right";
}
function jsonForDataScript(value) {
    return JSON.stringify(value)
        .replace(/&/g, "\\u0026")
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}
// ---- sidebar ----
function repairStepIcon() {
    return '<span class="ds-story-tune-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z"/></svg></span>';
}
function changeJumpControls() {
    return `<div class="ds-changejump" data-change-nav hidden>
    <button class="ds-changebtn" data-change-prev title="Previous change (← / P)" aria-label="Previous change">←</button>
    <span class="ds-changecount" data-change-count>0 / 0</span>
    <button class="ds-changebtn" data-change-next title="Next change (→ / N)" aria-label="Next change">→</button>
  </div>`;
}
function lineWrapToggle() {
    return `<button class="ds-linewrap-toggle" data-line-wrap-toggle type="button" aria-pressed="false" aria-label="Wrap long lines" title="Wrap long lines">
    <span class="ds-ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 6h12M4 11h14a3 3 0 0 1 0 6h-3"/><path d="m17 14-3 3 3 3M4 17h6"/></svg></span>
    <span data-line-wrap-label>Wrap</span>
  </button>`;
}
// ---- story tour ----
/** Render one story step for the lazy review-step endpoint. */
export function renderStoryStepPanel(_repo, model, comments, stepIndex) {
    const step = model.steps[stepIndex];
    if (!step)
        return '<div class="ds-diffnote">That story step does not exist.</div>';
    return stepPanel(step, stepIndex, comments);
}
function stepPanel(step, i, comments) {
    return step.kind === "concept"
        ? conceptStepPanel(step, i)
        : codeStepPanel(step, i, comments);
}
function codeStepPanel(s, i, comments) {
    const diffRegionId = `ds-story-diff-${i + 1}`;
    return `<section class="ds-step is-code-step" data-step-panel="${i + 1}" data-step-id="${esc(s.id)}" data-scene-layout="${esc(s.sceneLayout)}" data-step-weight="${s.weight}"${s.focusExplicit ? ' data-story-focus="authored"' : ""} hidden>
    <div class="ds-step-top">
      <div class="ds-step-titlerow">
        <h1 class="ds-step-title">${s.title.html}</h1>
        <div class="ds-step-actions">
          <span class="ds-badge ds-badge-${s.kind === "new-file" ? "new" : s.kind}">${esc(s.kindLabel)}</span>
          ${s.sweep ? `<span class="ds-badge ds-badge-sweep" title="${esc(`Sweeps ${s.sweep.files} changed ${s.sweep.files === 1 ? "file" : "files"} matching ${s.sweep.glob}; each carries the same changed lines as this instance`)}">Sweep · ${s.sweep.files}</span>` : ""}
          ${storyRepairMenu(s, true)}
        </div>
      </div>
      ${landingLine(s)}
      ${s.landing?.callers.length ? `<details class="ds-caller-evidence"><summary>Caller evidence · agent-reported relationships</summary><p>Text matches locate the named symbols. They do not prove a call or runtime reachability.</p><ul>${s.landing.callers.map((caller) => `<li><code>${esc(caller.label)}</code>${caller.evidence ? ` — <button type="button" data-caller-source data-caller-step="${esc(s.id)}" data-caller-name="${esc(caller.label)}">${esc(caller.evidence.file)}:${caller.evidence.line}</button><span>Text match only</span><pre>${esc(caller.evidence.text)}</pre>` : ' — No source match available'}</li>`).join('')}</ul></details>` : ''}
    </div>
    ${s.hotspot
        ? `<div class="ds-hotspot-flag" role="note"><span class="ds-hotspot-flag-kicker" aria-hidden="true">▲ Distrust</span><span class="ds-sr-only">Author-flagged hotspot: </span><span class="ds-hotspot-flag-reason">${s.hotspot.html}</span></div>`
        : ""}
    <div class="ds-diffscroll">
      <div class="ds-diff" id="${diffRegionId}" data-diff data-story-diff data-file="${esc(s.file)}" role="region" aria-label="${esc(s.file)} story diff"${s.newFile ? ' data-newfile="1"' : ""}>
        <div class="ds-difftoolbar">
          <button class="ds-diff-path" type="button" data-open-full-diff="${esc(s.file)}" aria-label="${esc(`Open ${s.file} in All files`)}" title="${esc(`Open every change in ${s.file} under All files`)}"><span class="ds-dim">${esc(splitPath(s.file)[0])}</span><span class="ds-cardpath-base">${esc(splitPath(s.file)[1])}</span></button>
          <div class="ds-diffview-controls">
            ${lineWrapToggle()}
            <div class="ds-modetoggle" role="group" aria-label="Diff display mode">
              <button data-mode="diff" aria-pressed="false">Unified</button>
              <button class="is-active" data-mode="split" aria-pressed="true">Split</button>
              <button data-mode="full" aria-pressed="false">Full file</button>
            </div>
          </div>
        </div>
        <div data-diff-inner hidden>${storyUnifiedDiffInner(s, comments)}</div>
        <div data-split-inner data-loaded="1">${diffInner(s, comments)}</div>
        <div data-full-inner hidden></div>
      </div>
    </div>
    ${stepStoryHtml(s, diffRegionId, i + 1)}
  </section>`;
}
/**
 * "Where am I": a one-hop call graph, shown in the header's map island — who reaches the symbol on screen, the
 * symbol and its file, and the steps it leads into. Nodes that are story steps
 * jump to them; callers outside the story stay quiet text. Not narrated.
 */
function landingLine(s) {
    const landing = s.landing;
    if (!landing)
        return "";
    const node = (n) => {
        const label = n.prose ? esc(n.label) : `<code>${esc(n.label)}</code>`;
        return n.panelIndex === undefined
            ? `<span class="ds-landing-node is-external" title="${esc(n.label)}">${label}</span>`
            : `<button type="button" class="ds-landing-node is-step" data-goto-step="${n.panelIndex}" title="Go to step ${n.panelIndex}: ${esc(n.label)}">${label}</button>`;
    };
    // An arrow and its column wrap as one hop, so a narrow header never strands an arrow.
    const hop = (...items) => `<span class="ds-landing-hop">${items.join("")}</span>`;
    // The map sits in a fixed-height header, so a column shows its first node and
    // folds the rest behind a "+N" chip instead of stacking.
    const column = (kind, name, items, noun) => {
        const [first, ...rest] = items;
        const more = rest.length
            ? `<li><details class="ds-landing-more"><summary title="${rest.length} more ${noun}${rest.length === 1 ? "" : "s"}" aria-label="${rest.length} more ${noun}${rest.length === 1 ? "" : "s"}">+${rest.length}</summary><ul class="ds-landing-more-list">${rest
                .map((item) => `<li>${item}</li>`)
                .join("")}</ul></details></li>`
            : "";
        return `<ul class="ds-landing-col is-${kind}" aria-label="${name}"><li>${first}</li>${more}</ul>`;
    };
    const edge = '<span class="ds-landing-edge" aria-hidden="true"></span>';
    const parts = [];
    if (landing.callers.length) {
        parts.push(hop(column("callers", "Called by", landing.callers.map(node), "caller"), edge));
    }
    else if (landing.role) {
        parts.push(hop(column("callers", "Called by", [`<span class="ds-landing-node is-external is-role">the ${esc(landing.role.who)}</span>`], "caller"), landing.role.gate
            ? `<span class="ds-landing-edge has-label"><span class="ds-sr-only">through </span><code>${esc(landing.role.gate)}</code></span>`
            : edge));
    }
    parts.push(`<div class="ds-landing-here" aria-current="location"><code class="ds-landing-symbol">${esc(landing.symbol)}</code><span class="ds-landing-meta"><span class="ds-landing-file">${esc(landing.file)}</span>${landing.when
        ? `<span class="ds-landing-sep" aria-hidden="true">·</span><span class="ds-landing-when">${esc(landing.when)}</span>`
        : ""}</span></div>`);
    if (landing.callees.length)
        parts.push(hop(edge, column("callees", "Calls", landing.callees.map(node), "call")));
    // Inert until the engine copies it into the header's map island on activation.
    return `<template data-step-landing><div class="ds-landing" role="group" aria-label="Where this step is">${parts.join("")}</div></template>`;
}
function moveRangeLabel(file, [start, end]) {
    return `${file}:${start}${start === end ? "" : `–${end}`}`;
}
function calloutEndpoint(move) {
    if (move.hidden?.as === "destination") {
        return move.before.local
            ? { endpoint: move.before, side: "left" }
            : { endpoint: move.after, side: "right" };
    }
    return move.after.local
        ? { endpoint: move.after, side: "right" }
        : { endpoint: move.before, side: "left" };
}
function rowMatchesEndpoint(row, endpoint, side) {
    const line = side === "left" ? row.oldNo : row.newNo;
    return (endpoint.local &&
        line !== undefined &&
        line >= endpoint.range[0] &&
        line <= endpoint.range[1]);
}
function calloutsByLastRow(s) {
    const rows = s.blocks.flat();
    const result = new Map();
    for (const move of s.moves) {
        if (!move.hidden)
            continue;
        const anchor = calloutEndpoint(move);
        const row = rows
            .filter((candidate) => rowMatchesEndpoint(candidate, anchor.endpoint, anchor.side))
            .at(-1);
        if (!row)
            continue;
        result.set(row, [...(result.get(row) ?? []), move]);
    }
    return result;
}
function moveTargetAttributes(endpoint) {
    return `${endpoint.targetStep ? ` data-move-target-step="${endpoint.targetStep}"` : ""} data-move-target-file="${esc(endpoint.file)}" data-move-target-line="${endpoint.range[0]}"`;
}
function crossFileRouteHtml(move, remote) {
    const remoteIsSource = !move.before.local;
    const role = remoteIsSource ? "source" : "destination";
    const fileLabel = moveRangeLabel(remote.file, remote.range);
    const file = `<button type="button" class="ds-annot-dest"${moveTargetAttributes(remote)} aria-label="${esc(`Open cross-file ${role} ${fileLabel}`)}"><span>${esc(fileLabel)}</span></button>`;
    const here = `<span class="ds-annot-here ds-annot-here-${remoteIsSource ? "right" : "left"}">this code</span>`;
    const arrow = '<span class="ds-annot-route-arrow" aria-hidden="true">→</span>';
    return `<div class="ds-annot-route" data-cross-file-role="${role}">
    <span class="ds-annot-relation">Cross-file ${role}</span>
    <span class="ds-annot-endpoints">${remoteIsSource ? `${file}${arrow}${here}` : `${here}${arrow}${file}`}</span>
  </div>`;
}
function calloutHtml(move, unified = false) {
    if (!move.hidden)
        return "";
    const anchor = calloutEndpoint(move);
    const remote = move.before.local
        ? move.after.local
            ? undefined
            : move.after
        : move.before;
    const route = move.hidden.as === "destination" && remote
        ? crossFileRouteHtml(move, remote)
        : "";
    const detail = `<span class="ds-annot-tag">${esc(move.hidden.tag)}</span>
    <span class="ds-annot-what">${move.hidden.what.html}</span>`;
    return `<div class="ds-annot-callout ds-annot-callout-${move.hidden.as}${route ? " ds-annot-callout-cross" : ""} ds-annot-callout-${unified ? "unified" : anchor.side}" data-annot-callout="${esc(move.id)}" data-move-id="${esc(move.id)}" role="note">
    ${route}${route ? `<div class="ds-annot-detail">${detail}</div>` : detail}
  </div>`;
}
function rowCallouts(row, callouts, unified = false) {
    return (callouts.get(row) ?? [])
        .map((move) => calloutHtml(move, unified))
        .join("");
}
function annotationEndpoint(endpoint) {
    if (endpoint.local)
        return { local: true };
    return {
        local: false,
        file: endpoint.file,
        range: endpoint.range,
        ...(endpoint.targetStep ? { targetStep: endpoint.targetStep } : {}),
    };
}
function annotationSummary(s) {
    const relationships = s.moves
        .filter((move) => Boolean(move.label))
        .map((move) => {
        const sourceLabel = move.kind === "flow" ? "Source" : "Before";
        const destinationLabel = move.kind === "flow" ? "destination" : "after";
        return `<span>Code relationship: ${esc(move.label ?? "")}. ${sourceLabel} ${esc(moveRangeLabel(move.before.file, move.before.range))}; ${destinationLabel} ${esc(moveRangeLabel(move.after.file, move.after.range))}.</span>`;
    });
    return relationships.length
        ? `<div class="ds-sr-only" data-annotation-summary>${relationships.join(" ")}</div>`
        : "";
}
function annotationData(s) {
    const moves = s.moves
        .filter((move) => Boolean(move.label || move.hidden))
        .map((move) => ({
        id: move.id,
        kind: move.kind,
        ...(move.label ? { tag: move.label } : {}),
        before: annotationEndpoint(move.before),
        after: annotationEndpoint(move.after),
        arrow: move.before.local && move.after.local,
    }));
    return moves.length
        ? `<script type="application/json" data-annotations>${jsonForDataScript({ moves })}</script>`
        : "";
}
function storyRepairMenu(step, iconOnly = false) {
    const healthTitle = step.health.broad
        ? ` Broad step: ${step.health.reasons.join(" · ")}.`
        : "";
    return `<details class="ds-story-tune${iconOnly ? " is-icon" : ""}">
    <summary aria-label="Repair this story step" title="Story repair options.${esc(healthTitle)}">${iconOnly ? repairStepIcon() : "<span>Repair step</span>"}</summary>
    <div class="ds-story-tune-pop"><button type="button" data-story-repair="rewrite" data-story-step="${esc(step.id)}" data-story-file="${esc(step.file)}"><strong>Rewrite explanation</strong><small>Make the claim and evidence sharper without changing the review path.</small></button><button type="button" data-story-repair="shorten" data-story-step="${esc(step.id)}" data-story-file="${esc(step.file)}"><strong>Make shorter</strong><small>Condense this explanation without dropping its risk.</small></button><button type="button" data-story-repair="split" data-story-step="${esc(step.id)}" data-story-file="${esc(step.file)}"><strong>Split into smaller stops</strong><small>Give each decision its own stop.</small></button></div>
  </details>`;
}
function conceptStepPanel(s, i) {
    if (s.hasPage)
        return conceptPagePanel(s, i);
    const diagram = s.diagram
        ? `<figure class="ds-concept-diagram" data-concept-diagram>
        <div class="ds-concept-diagram-tools">
          <span class="ds-concept-diagram-gesture" data-mermaid-gesture-hint>Drag to pan · Scroll to zoom</span>
          <div class="ds-concept-diagram-zoom" role="group" aria-label="Diagram zoom controls">
            <button type="button" data-mermaid-zoom="out" aria-label="Zoom out" title="Zoom out (−)"><span aria-hidden="true">−</span></button>
            <button type="button" class="ds-concept-diagram-reset" data-mermaid-reset aria-label="Reset diagram view" title="Reset diagram view (0)"><span data-mermaid-zoom-label>100%</span></button>
            <button type="button" data-mermaid-zoom="in" aria-label="Zoom in" title="Zoom in (+)"><span aria-hidden="true">+</span></button>
          </div>
          <button type="button" class="ds-concept-diagram-fullscreen" data-mermaid-fullscreen aria-label="Open diagram fullscreen" aria-pressed="false" title="Open diagram fullscreen">
            <svg class="ds-concept-diagram-expand" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
            <svg class="ds-concept-diagram-collapse" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>
          </button>
        </div>
        <div class="ds-concept-diagram-output" data-mermaid-output role="img" tabindex="0" aria-keyshortcuts="+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown" aria-label="${esc(s.diagram.caption.text)}"><span class="ds-concept-diagram-loading">Drawing the mental model…</span></div>
        <pre data-mermaid-source hidden>${esc(s.diagram.source)}</pre>
        <figcaption>${s.diagram.caption.html}</figcaption>
        <details class="ds-concept-diagram-source" data-mermaid-fallback>
          <summary>Diagram source</summary>
          <pre><code>${esc(s.diagram.source)}</code></pre>
        </details>
      </figure>`
        : "";
    const speech = conceptSpeechText(s);
    return `<section class="ds-step ds-concept-step" data-step-panel="${i + 1}" data-step-id="${esc(s.id)}" data-scene-layout="${esc(s.sceneLayout)}" data-step-weight="${s.weight}" hidden>
    <div class="ds-concept-scroll">
      <article class="ds-concept-document" aria-labelledby="ds-concept-title-${i + 1}">
        <div class="ds-concept-copy">
          <div class="ds-concept-heading">
            <span class="ds-concept-eyebrow"><span aria-hidden="true">◇</span> Mental model</span>
          </div>
          <h1 class="ds-concept-title" id="ds-concept-title-${i + 1}">${s.title.html}</h1>
          <div class="ds-concept-body ds-md">${s.body?.html ?? ""}</div>
        </div>
        ${diagram}
        <span class="ds-sr-only" data-speech-concept>${esc(speech)}</span>
      </article>
    </div>
  </section>`;
}
/**
 * A v4 page concept: the author's HTML runs in an opaque-origin sandbox the
 * engine points at /api/review/concept-page. The panel carries no page bytes.
 */
function conceptPagePanel(s, i) {
    const speech = conceptSpeechText(s);
    return `<section class="ds-step ds-concept-step" data-step-panel="${i + 1}" data-step-id="${esc(s.id)}" data-scene-layout="${esc(s.sceneLayout)}" data-step-weight="${s.weight}" hidden>
    <article class="ds-concept-page-stage" aria-labelledby="ds-concept-title-${i + 1}">
      <div class="ds-concept-heading">
        <span class="ds-concept-eyebrow"><span aria-hidden="true">◇</span> Mental model</span>
        <h1 class="ds-concept-title" id="ds-concept-title-${i + 1}">${s.title.html}</h1>
        ${s.network ? `<span class="ds-concept-network" title="This page loads remote resources. Opening it can contact servers its author chose.">Network</span>` : ""}
      </div>
      <figure class="ds-concept-page" data-concept-page>
        <button type="button" class="ds-concept-page-fullscreen" data-concept-page-fullscreen aria-pressed="false" aria-label="Open page fullscreen" title="Open page fullscreen">
          <svg class="ds-concept-page-expand" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>
          <svg class="ds-concept-page-collapse" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>
        </button>
        <span class="ds-concept-page-loading">Loading the mental model…</span>
        <iframe class="ds-concept-page-frame" data-concept-frame data-concept-index="${i + 1}" sandbox="allow-scripts" allow="fullscreen" title="${esc(`Concept page: ${s.title.text}`)}" loading="lazy"></iframe>
      </figure>
      <span class="ds-sr-only" data-speech-concept>${esc(speech)}</span>
    </article>
  </section>`;
}
/**
 * Ends a spoken segment with sentence punctuation, without doubling it.
 *
 * Joining these segments with a bare ". " produced "…where to continue.. The
 * primer sits…" whenever a segment already ended in punctuation.
 */
function endsSentence(text) {
    return /[.!?:;]$/.test(text) ? text : `${text}.`;
}
/**
 * The spoken form of a primer: the projections the parser already produced,
 * ordered and terminated. The markdown-stripping this used to do lived here only
 * because the body arrived as raw authored prose; the speech projection owns that
 * shaping now, so the renderer only decides what is said in what order.
 */
function conceptSpeechText(s) {
    return [s.title.speech, s.narration?.speech, s.body?.speech, s.diagram?.caption.speech]
        .map((part) => part?.trim())
        .filter((part) => Boolean(part))
        .map(endsSentence)
        .join(" ")
        .trim();
}
function stepStoryHtml(s, diffRegionId, stepIndex) {
    if (!s.beats.length)
        return `<div class="ds-beatdock is-single" data-beat-dock data-dock-step="${stepIndex}" hidden>
    <span class="ds-beatdock-count">Review note</span>
    <p class="ds-why-text" data-speech-text="${esc(s.why.speech)}">${nl(s.why.html)}</p>
  </div>`;
    return `<div class="ds-beatdock" data-beat-dock data-dock-step="${stepIndex}" hidden>
    <span class="ds-beatdock-count"><b data-beat-current>01</b><span>/ ${String(s.beats.length).padStart(2, "0")}</span></span>
    <div class="ds-beatdock-copy">
      <div class="ds-beats">${s.beats.map((beat) => beatHtml(beat, s.file, diffRegionId)).join("")}</div>
    </div>
    <span class="ds-beatdock-actions">
      <button type="button" data-beat-move="-1" aria-label="Previous review beat" disabled>←</button>
      <button type="button" data-beat-move="1" aria-label="Next review beat">→</button>
    </span>
    <div class="ds-sr-only" data-story-focus-status aria-live="polite" aria-atomic="true"></div>
  </div>`;
}
function beatHtml(beat, file, diffRegionId) {
    const destination = beatDestination(file, beat.highlights, beat.oldHighlights);
    return `<button type="button" class="ds-beat ds-beatdock-note" data-story-beat data-speech-beat="${beat.focusGroup}" data-focus-group="${beat.focusGroup}" data-speech-text="${esc(beat.text.speech)}" data-focus-destination="${esc(destination)}" aria-controls="${diffRegionId}" aria-pressed="false" aria-label="Focus beat ${beat.focusGroup + 1}: ${esc(beat.text.text)}"><span class="ds-beat-text">${nl(beat.text.html)}</span></button>`;
}
/**
 * Spoken destination for a beat button. Exported for tests; panels and the
 * rail speech cache render it.
 */
export function beatDestination(file, highlights, oldHighlights = []) {
    const ranges = highlights.map(([start, end]) => {
        if (start === 0 && end === 0)
            return "deleted lines";
        return start === end ? `line ${start}` : `lines ${start} to ${end}`;
    });
    for (const [start, end] of oldHighlights) {
        ranges.push(start === end
            ? `deleted line ${start}`
            : `deleted lines ${start} to ${end}`);
    }
    return `${file}, ${ranges.join(" and ")}`;
}
function storyUnifiedDiffInner(s, comments) {
    if (!s.blocks.length || !s.blocks.some((b) => b.length)) {
        return `<div class="ds-diffnote">${esc(s.note ?? "Nothing to show for this step.")}</div>`;
    }
    const callouts = calloutsByLastRow(s);
    const body = s.blocks
        .map((block, bi) => {
        const intra = intraLineMap(block, (r) => r.type, (r) => r.content);
        return ((bi > 0 ? renderHunkGap() : "") +
            block
                .map((row) => storyUnifiedRow(row, s, comments, bi, intra) +
                rowCallouts(row, callouts, true))
                .join(""));
    })
        .join("");
    const note = s.note && s.blocks.some((b) => b.length)
        ? `<div class="ds-diffnote ds-diffnote-soft">${esc(s.note)}</div>`
        : "";
    return `${storyUnifiedHead(s)}${note}${annotationSummary(s)}<div class="ds-diffbody ds-diffbody-unified">${body}</div>`;
}
function storyUnifiedHead(s) {
    const label = s.context ? "Context" : s.newFile ? "New file" : "Unified";
    const note = s.context
        ? "unchanged — shown so the change makes sense"
        : s.newFile
            ? ""
            : "before and after in one readable column";
    return `<div class="ds-diffhead ds-diffhead-ctx"><span class="ds-diffhead-side"><span class="ds-diffhead-label${s.newFile ? " ds-green" : ""}">${label}</span><span class="ds-diffhead-path">${esc(s.file)}</span></span>${note ? `<span class="ds-diffhead-note">${note}</span>` : ""}</div>`;
}
function storyUnifiedRow(row, s, _comments, blockIndex, intra) {
    const target = row.type === "del" && row.oldNo !== undefined
        ? { side: "left", file: s.oldFile, line: row.oldNo }
        : row.newNo === undefined
            ? undefined
            : { side: "right", file: s.file, line: row.newNo };
    const unified = {
        type: row.type,
        no: target?.line,
        content: row.content,
        untoured: row.untoured,
    };
    const side = row.type === "del"
        ? intra?.get(row)?.left
        : row.type === "add"
            ? intra?.get(row)?.right
            : undefined;
    const focusIndex = rowVoiceFocusIndex(row, s, blockIndex);
    const focusAttr = focusIndex === null ? "" : ` data-step-focus="${focusIndex}"`;
    const stepAttr = target ? ` data-step="${esc(s.id)}"` : "";
    const rowHtml = renderUnifiedRow(unified, target, side).replace(/^<div class="([^"]+)"/, `<div class="$1"${stepAttr}${focusAttr}`);
    return rowHtml;
}
function diffInner(s, _comments) {
    if (!s.blocks.length || !s.blocks.some((b) => b.length)) {
        return `<div class="ds-diffnote">${esc(s.note ?? "Nothing to show for this step.")}</div>`;
    }
    const head = diffHead(s);
    const paired = s.pairedView
        ? s.moves.find((move) => move.id === s.pairedView)
        : undefined;
    const single = !paired && (s.context || s.newFile);
    const callouts = calloutsByLastRow(s);
    const note = s.note && s.blocks.some((b) => b.length)
        ? `<div class="ds-diffnote ds-diffnote-soft">${esc(s.note)}</div>`
        : "";
    if (single) {
        // Context and new-file steps read as one column; nothing to keep in step.
        const body = s.blocks
            .map((block, bi) => {
            const intra = intraLineMap(block, (r) => r.type, (r) => r.content);
            const runs = untouredRuns(block);
            return ((bi > 0 ? renderHunkGap() : "") +
                block
                    .map((row) => renderSplitRow(row, { ...sbsRowOpts(row, s, bi, intra), untouredTag: runs.get(row) ?? null }) +
                    rowCallouts(row, callouts))
                    .join(""));
        })
            .join("");
        return `${head}${note}${annotationSummary(s)}<div class="ds-diffbody">${body}</div>${annotationData(s)}`;
    }
    const canExpandViewport = !s.context && !s.newFile && !s.pairedView && s.viewport[0] > 0;
    const cols = new SplitColumns({
        bodyClass: paired?.kind === "flow" ? "ds-diffbody-paired-flow" : undefined,
    });
    if (canExpandViewport && s.viewport[0] > 1) {
        cols.gap({ file: s.file, from: 1, to: s.viewport[0] - 1 }, { edge: "before" });
    }
    s.blocks.forEach((block, bi) => {
        const intra = intraLineMap(block, (r) => r.type, (r) => r.content);
        const runs = untouredRuns(block);
        if (bi > 0)
            cols.gap();
        for (const row of block) {
            cols.row(row, { ...sbsRowOpts(row, s, bi, intra), untouredTag: runs.get(row) ?? null });
            for (const move of callouts.get(row) ?? []) {
                const html = calloutHtml(move);
                if (calloutEndpoint(move).side === "left")
                    cols.left(html);
                else
                    cols.right(html);
            }
        }
    });
    if (canExpandViewport) {
        cols.gap({ file: s.file, from: s.viewport[1] + 1, to: "eof" }, { edge: "after" });
    }
    return `${head}${note}${annotationSummary(s)}${cols.html()}${annotationData(s)}`;
}
function diffHead(s) {
    if (s.context) {
        return `<div class="ds-diffhead ds-diffhead-ctx">
      <span class="ds-diffhead-side"><span class="ds-diffhead-label">Context</span><span class="ds-diffhead-path">${esc(s.file)}</span></span>
      <span class="ds-diffhead-note">unchanged — shown so the change makes sense</span>
    </div>`;
    }
    const paired = s.pairedView
        ? s.moves.find((move) => move.id === s.pairedView)
        : undefined;
    if (paired) {
        const flow = paired.kind === "flow";
        const leftLabel = flow ? "Source" : "Before";
        const rightLabel = flow ? "Destination" : "After";
        return `<div class="ds-diffhead ds-diffhead-paired">
      <span class="ds-diffhead-side ds-diffhead-side-l"><span class="ds-diffhead-label">${leftLabel}</span><span class="ds-diffhead-path">${esc(paired.before.file)}</span></span><span class="ds-diffhead-divider"></span>
      <span class="ds-diffhead-side ds-diffhead-side-r"><span class="ds-diffhead-label ${flow ? "ds-blue" : "ds-green"}">${rightLabel}</span><span class="ds-diffhead-path">${esc(paired.after.file)}</span></span>
    </div>`;
    }
    if (s.newFile) {
        return `<div class="ds-diffhead ds-diffhead-ctx">
      <span class="ds-diffhead-side"><span class="ds-diffhead-label ds-green">New file</span><span class="ds-diffhead-path">${esc(s.file)}</span></span>
    </div>`;
    }
    const leftLabel = s.newFile ? "Did not exist" : "Before";
    const rightLabel = s.newFile ? "New file" : "After";
    // Both sides of an ordinary edit name the same file, and the step head above
    // already carries it. Only a rename earns the path on both sides.
    const renamed = !s.newFile && s.oldFile !== s.file;
    return `<div class="ds-diffhead">
    <span class="ds-diffhead-side ds-diffhead-side-l">
      <span class="ds-diffhead-label${s.newFile ? " ds-dim" : ""}">${leftLabel}</span>
      ${renamed ? `<span class="ds-diffhead-path">${esc(s.oldFile)}</span>` : ""}
    </span>
    <span class="ds-diffhead-divider"></span>
    <span class="ds-diffhead-side ds-diffhead-side-r">
      <span class="ds-diffhead-label${s.newFile ? " ds-green" : ""}">${rightLabel}</span>
      ${renamed ? `<span class="ds-diffhead-path">${esc(s.file)}</span>` : ""}
    </span>
  </div>`;
}
function sbsRowOpts(row, s, blockIndex, intra) {
    const paired = s.pairedView
        ? s.moves.find((move) => move.id === s.pairedView)
        : undefined;
    const leftTarget = !s.context && (paired || !s.newFile) && row.oldNo !== undefined
        ? {
            side: "left",
            file: paired?.before.file ?? s.oldFile,
            line: row.oldNo,
        }
        : undefined;
    const rightTarget = row.newNo === undefined
        ? undefined
        : {
            side: "right",
            file: paired?.after.file ?? s.file,
            line: row.newNo,
        };
    return {
        leftTarget,
        rightTarget,
        stepId: s.id,
        focusIndex: rowVoiceFocusIndex(row, s, blockIndex),
        single: !paired && (s.context || s.newFile),
        sides: intra?.get(row),
        moveTokens: rowMoveTokens(row, s),
    };
}
function rowMoveTokens(row, s) {
    const tokens = [];
    for (const move of s.moves) {
        if (move.before.local &&
            row.oldNo !== undefined &&
            row.oldNo >= move.before.range[0] &&
            row.oldNo <= move.before.range[1])
            tokens.push(`${move.id}:before`);
        if (move.after.local &&
            row.newNo !== undefined &&
            row.newNo >= move.after.range[0] &&
            row.newNo <= move.after.range[1])
            tokens.push(`${move.id}:after`);
    }
    return tokens;
}
function rowVoiceFocusIndex(row, s, blockIndex) {
    const idx = s.focusGroups.findIndex((ranges, group) => ranges.some((range) => rowInFocusRange(row, s, range)) ||
        (s.focusOldGroups[group] ?? []).some((range) => rowInOldFocusRange(row, range)));
    if (idx >= 0) {
        return s.focusExplicit ? idx : blockIndex;
    }
    return !s.focusExplicit && row.type === "del" && s.kind === "changed"
        ? blockIndex
        : null;
}
function rowInFocusRange(row, s, [start, end]) {
    if (row.newNo !== undefined)
        return row.newNo >= start && row.newNo <= end;
    return s.kind === "changed" && row.type === "del" && start === 0 && end === 0;
}
/**
 * Old-side focus: deleted rows glow when their OLD line number falls inside a
 * beat's `oldHighlights`. Exported for tests; the engine only ever reads the
 * stamped `data-step-focus` attribute.
 */
export function rowInOldFocusRange(row, [start, end]) {
    return (row.type === "del" && row.oldNo !== undefined && row.oldNo >= start && row.oldNo <= end);
}
// ---- all files ----
/** Inner master/detail panel markup, also served lazily for non-active files. */
export function renderFilePanelContent(f, _stepIndexById) {
    const [dir, base] = splitPath(f.file);
    const canExpand = f.kind !== "context" && f.hasFull;
    const gapBefore = (hi) => {
        if (!canExpand)
            return hi > 0 ? renderHunkGap() : "";
        if (hi === 0) {
            const start = f.hunkRanges[0]?.[0] ?? 1;
            return start > 1
                ? renderHunkGap({ file: f.file, from: 1, to: start - 1 })
                : "";
        }
        const prevEnd = f.hunkRanges[hi - 1][1];
        const nextStart = f.hunkRanges[hi][0];
        return nextStart - prevEnd > 1
            ? renderHunkGap({ file: f.file, from: prevEnd + 1, to: nextStart - 1 })
            : renderHunkGap();
    };
    // A new file's whole content is the hunk — nothing is hidden past it, so the
    // trailing "reveal more" affordance would promise lines that can't exist.
    const gapAfterLast = canExpand && f.hunks.length && f.kind !== "new"
        ? renderHunkGap({
            file: f.file,
            from: f.hunkRanges[f.hunkRanges.length - 1][1] + 1,
            to: "eof",
        })
        : "";
    // A file the story never visits is flagged once, in the head; its rows stay
    // plain. The split and full-file responses apply the same rule to the same
    // rows, so every mode agrees.
    const whole = wholeUntoured(f.hunks.flat());
    const hunks = whole ? f.hunks.map(plainRows) : f.hunks;
    const unified = hunks.length
        ? hunks
            .map((hunk, hi) => {
            const intra = intraLineMap(hunk, (r) => r.type, (r) => r.content);
            const runs = untouredRuns(hunk);
            return (gapBefore(hi) +
                hunk
                    .map((r) => unifiedRow(r, f.file, f.oldFile, unifiedIntra(r, intra), runs.get(r) ?? null))
                    .join(""));
        })
            .join("") + gapAfterLast
        : '<div class="ds-diffnote">No diff to show.</div>';
    const wholeBadge = whole
        ? `<span class="ds-untoured-badge" title="The story never visits this file"><span class="ds-tri">▲</span>Unexplained file</span>`
        : "";
    // Changed files default to Split. A context-only file has no before/after
    // diff, so Unified is its real evidence and Split must not be offered.
    const toggle = f.kind === "context"
        ? `<div class="ds-modetoggle" role="group" aria-label="File display mode"><button class="is-active" data-mode="diff" aria-pressed="true">Unified</button>${f.hasFull
            ? '<button data-mode="full" aria-pressed="false">Full file</button>'
            : ""}</div>`
        : f.hasFull
            ? `<div class="ds-modetoggle" role="group" aria-label="Diff display mode"><button data-mode="diff" aria-pressed="false">Unified</button><button class="is-active" data-mode="split" aria-pressed="true">Split</button><button data-mode="full" aria-pressed="false">Full file</button></div>`
            : f.hunks.length
                ? `<div class="ds-modetoggle" role="group" aria-label="Diff display mode"><button data-mode="diff" aria-pressed="false">Unified</button><button class="is-active" data-mode="split" aria-pressed="true">Split</button></div>`
                : "";
    // A context-only file has no add/del counts worth showing.
    const stat = f.kind === "context"
        ? ""
        : `<span class="ds-diffstat" title="${f.add} added, ${f.del} deleted"><span class="ds-diffstat-add">+${f.add}</span><span class="ds-diffstat-del">−${f.del}</span></span>`;
    return `<div class="ds-filepanel-head">
      <span class="ds-cardpath"><span class="ds-dim">${esc(dir)}</span><span class="ds-cardpath-base">${esc(base)}</span></span>
      ${stat}
      ${wholeBadge}
      <span class="ds-flex"></span>
      ${changeJumpControls()}
      <button type="button" class="ds-viewed-toggle" data-viewed-toggle aria-pressed="false" aria-label="Mark ${esc(f.file)} reviewed" title="Mark reviewed (V)"><span class="ds-viewed-toggle-icon" aria-hidden="true">✓</span><span class="ds-viewed-toggle-label" data-viewed-label>Mark reviewed</span></button>
      ${lineWrapToggle()}
      ${toggle}
    </div>
    <div class="ds-filepanel-body">
      <div data-diff-inner${f.kind === "context" ? "" : " hidden"}><div class="ds-diffbody ds-diffbody-unified">${unified}</div></div>
      <div data-split-inner${f.kind === "context" ? " hidden" : ""}><div class="ds-diffnote" role="status">Loading the split view…</div></div>
      <div data-full-inner hidden></div>
    </div>
  `;
}
function fileReviewHash(file) {
    // Story-derived presentation flags are intentionally absent: repairing the
    // narrative must not clear a review mark when the file diff is unchanged.
    return file.reviewHash;
}
function unifiedRow(row, file, oldFile = file, intra, tag) {
    const target = row.no === undefined
        ? undefined
        : {
            side: row.type === "del" ? "left" : "right",
            file: row.type === "del" ? oldFile : file,
            line: row.no,
        };
    return renderUnifiedRow(row, target, intra, tag);
}
/** Look up a unified row's precomputed intra-line side (del→left, add→right). */
function unifiedIntra(row, map) {
    const sides = map.get(row);
    return row.type === "del" ? sides?.left : sides?.right;
}
function commentAnchorLabel(state) {
    if (state === "changed")
        return "Code changed";
    if (state === "moved")
        return "Code moved";
    if (state === "old-side")
        return "Old side";
    if (state === "legacy")
        return "Line-only anchor";
    return "Anchor current";
}
function commentAnchorView(repo, headRef, c) {
    let state = "current";
    let currentLine;
    if (commentSide(c) === "left")
        state = "old-side";
    else if (c.selectedText) {
        const lines = readWholeFile(repo, c.file, headRef);
        if (lines) {
            const text = lines.join("\n");
            const index = text.indexOf(c.selectedText);
            if (index < 0)
                state = "changed";
            else {
                currentLine = text.slice(0, index).split("\n").length;
                state = currentLine === c.line ? "current" : "moved";
            }
        }
        else
            state = "changed";
    }
    else
        state = "legacy";
    return {
        id: c.id,
        state,
        label: commentAnchorLabel(state),
        ...(currentLine !== undefined && currentLine !== c.line
            ? { currentLine }
            : {}),
    };
}
// ---- trust evidence ----
export function renderTrustEvidence(trust, stepIndexById, excludedFiles, indexDivergentFiles, storyless) {
    const clean = !trust.uncovered.length;
    const verdict = trust.pending
        ? `<div class="ds-trust-clean">Coverage is calculated from lazy file evidence as it is requested. This page does not call an unloaded change “covered.”</div>`
        : storyless
            ? `<div class="ds-trust-clean">The full bounded diff is available file by file. No story-coverage claim is applied in this view.</div>`
            : clean
                ? `<div class="ds-trust-clean">✓ Every changed range in the bounded renderer is fully explained by a step.</div>`
                : "";
    const coverage = `<section class="ds-reviewpage-section" data-review-section="evidence" aria-labelledby="ds-reviewpage-evidence-h" tabindex="-1">
    <h2 class="ds-reviewpage-h" id="ds-reviewpage-evidence-h">Coverage</h2>
    <div class="ds-trust-sub">${storyless ? "Exact change scope, staging state, and files outside the bounded renderer." : "Coverage of the bounded review, plus every file kept outside it."}</div>
    ${storyless || trust.pending
        ? ""
        : `<div class="ds-trust-stats">
      <div class="ds-trust-stat ok"><div class="ds-trust-num">${trust.coveredLines}</div><div class="ds-trust-lbl">changed ${plural(trust.coveredLines, "line")} covered by a step</div></div>
      <div class="ds-trust-stat warn"><div class="ds-trust-num">${trust.uncoveredLines}</div><div class="ds-trust-lbl">${plural(trust.uncoveredLines, "change")} no step explains</div></div>
    </div>`}
    ${verdict}
    <div class="ds-trust-foot">${storyless ? "The page shows the bounded diff directly. You still need to inspect excluded files and reconcile divergent staged state before deciding." : "Coverage means every rendered changed range is fully claimed by story steps. You still need to inspect excluded files before deciding."}</div>
  </section>`;
    const unexplained = trust.pending || storyless || clean
        ? ""
        : unexplainedSection(trust, stepIndexById);
    const exclusions = excludedFiles.length
        ? `<section class="ds-reviewpage-section ds-exclusions" data-review-section="exclusions" aria-labelledby="ds-exclusions-title" tabindex="-1">
        <h2 class="ds-reviewpage-h" id="ds-exclusions-title">Outside the bounded renderer <span class="ds-option-count">${excludedFiles.length}</span></h2>
        <p class="ds-exclusions-note">These files are part of the git change but are not included in story coverage or the default diff DOM. Inspect them deliberately before deciding.</p>
        ${excludedFiles.map(excludedFileCard).join("")}
        <label class="ds-exclusion-ack"><input type="checkbox" data-exclusions-ack><span><strong>I inspected these exclusions</strong><small>Bound to this exact diff; a code change clears the acknowledgment.</small></span></label>
      </section>`
        : "";
    const stagedState = indexDivergentFiles.length
        ? `<section class="ds-reviewpage-section ds-exclusions" data-review-section="staged" aria-labelledby="ds-index-state-title" tabindex="-1">
        <h2 class="ds-reviewpage-h" id="ds-index-state-title">Staged state differs <span class="ds-option-count">${indexDivergentFiles.length}</span></h2>
        <p class="ds-exclusions-note">These paths contain one version in Git's index and another in the working tree. A single combined diff cannot prove which version you intend to commit, so approval stays blocked until they match.</p>
        ${indexDivergentFiles.map((path) => `<article class="ds-exclusion-card"><div><code>${esc(path)}</code><span>Index and working tree contain different bytes</span></div></article>`).join("")}
      </section>`
        : "";
    // Every block below is its own review-page section, so the wrapper only exists
    // to give the lazy fetch one node to swap. data-trust-uncovered is how that
    // replacement settles the pill: an empty value means "no verdict" — the client
    // must leave the pill alone rather than read a missing answer as zero.
    return `<div class="ds-trust-evidence" data-trust-evidence data-trust-pending="${trust.pending ? "1" : "0"}" data-trust-uncovered="${trust.pending ? "" : trust.uncovered.length}" data-trust-storyless="${storyless ? "1" : "0"}">
    ${coverage}
    ${unexplained}
    ${stagedState}
    ${exclusions}
  </div>`;
}
/**
 * The unexplained changes, on their own.
 *
 * These used to render inline under Status, which turned a routine "19 ranges no
 * step claims" into a page-long wall of amber the moment the review page opened.
 * They are evidence a reviewer should choose to read, not an alarm: the section
 * states the size of the gap and which files hold it, and keeps the diff cards
 * behind a disclosure that stays shut until asked.
 */
function unexplainedSection(trust, stepIndexById) {
    const ranges = trust.uncovered.length;
    const byFile = new Map();
    for (const u of trust.uncovered) {
        const entry = byFile.get(u.file) ?? { ranges: 0, lines: 0 };
        entry.ranges += 1;
        entry.lines += u.rows.filter((r) => r.type === "add").length;
        byFile.set(u.file, entry);
    }
    const files = [...byFile.entries()].sort((a, b) => b[1].ranges - a[1].ranges || a[0].localeCompare(b[0]));
    const fileRows = files
        .map(([file, count]) => `<button type="button" class="ds-unexplained-file" data-goto-file="${esc(file)}" title="Open ${esc(file)} in Files">
          <code>${esc(file)}</code>
          <span class="ds-unexplained-file-count">${count.ranges} ${plural(count.ranges, "range")}${count.lines ? ` · ${count.lines} ${plural(count.lines, "line")}` : ""}</span>
        </button>`)
        .join("");
    return `<section class="ds-reviewpage-section ds-unexplained" data-review-section="unexplained" aria-labelledby="ds-reviewpage-unexplained-h" tabindex="-1">
    <h2 class="ds-reviewpage-h" id="ds-reviewpage-unexplained-h"><span class="ds-tri" aria-hidden="true">▲</span>Unexplained changes <span class="ds-option-count">${ranges}</span></h2>
    <p class="ds-unexplained-note">${ranges} changed ${plural(ranges, "range")} across ${files.length} ${plural(files.length, "file")} ${ranges === 1 ? "is" : "are"} in the diff with no story step walking through ${ranges === 1 ? "it" : "them"}. That is a gap in the story, not a verdict on the code — read ${ranges === 1 ? "it" : "them"} yourself, or ask ${esc(APP_BRAND)} to explain.</p>
    <div class="ds-unexplained-files">${fileRows}</div>
    <details class="ds-unexplained-detail" data-unexplained-disclosure>
      <summary><span class="ds-unexplained-summary-label">Show ${ranges === 1 ? "the change" : `all ${ranges} changes`}</span><span class="ds-unexplained-summary-hint">diff, with jump and explain actions</span></summary>
      <div class="ds-unexplained-cards">${trust.uncovered.map((u) => trustCard(u, stepIndexById)).join("")}</div>
    </details>
  </section>`;
}
function excludedFileCard(file) {
    const reason = file.reason === "generated-path"
        ? "Generated or vendored path"
        : file.reason === "large-diff"
            ? "Large diff"
            : file.reason === "binary"
                ? "Binary or non-text change"
                : "Metadata-only change";
    const lines = file.changedLines == null
        ? "Binary or uncounted change"
        : `${file.changedLines} changed ${plural(file.changedLines, "line")}`;
    return `<article class="ds-exclusion-card" data-excluded-file="${esc(file.path)}">
    <div><code>${esc(file.path)}</code><span>${reason} · ${lines}</span></div>
    <button type="button" class="ds-btn ds-btn-ghost" data-inspect-excluded="${esc(file.path)}">Inspect current file</button>
    <div class="ds-exclusion-preview" data-excluded-preview hidden></div>
  </article>`;
}
function trustCard(u, stepIndexById) {
    const intra = intraLineMap(u.rows, (r) => r.type, (r) => r.content);
    const rows = u.rows.length
        ? u.rows
            .map((r) => unifiedRow(r, u.file, u.file, unifiedIntra(r, intra)))
            .join("")
        : `<div class="ds-diffnote">${esc(u.file)}:${u.line}</div>`;
    const stepIdx = u.stepId === undefined ? undefined : stepIndexById.get(u.stepId);
    const jump = stepIdx === undefined
        ? `<button class="ds-btn ds-btn-solid" data-goto-file="${esc(u.file)}">Show ${esc(u.file)}</button>`
        : `<button class="ds-btn ds-btn-solid" data-goto-step="${stepIdx}">Jump to ${esc(u.file)}</button>`;
    return `<div class="ds-trust-card">
    <div class="ds-trust-card-head">
      <span class="ds-trust-card-path">${esc(u.file)}<span class="ds-dim">:${u.line}</span></span>
      <span class="ds-untoured-tag">UNEXPLAINED</span>
    </div>
    <div class="ds-diffbody ds-diffbody-unified">${rows}</div>
    <div class="ds-trust-card-actions">
      ${jump}
      <button class="ds-btn ds-btn-ghost" data-explain data-story-file="${esc(u.file)}" data-story-line="${u.line}">Ask ${esc(APP_BRAND)} to explain</button>
    </div>
  </div>`;
}
// ---- full file (used by the lazy /api/fullfile endpoint) ----
function splitHead(opts) {
    const oldPath = opts.oldFile ?? opts.file;
    // The panel head above already names the file, so repeating the path on both
    // sides is noise. It earns its place only when the sides genuinely differ.
    // New files never reach here: they render as one column under newFileHead.
    const renamed = oldPath !== opts.file;
    return `<div class="ds-diffhead">
    <span class="ds-diffhead-side ds-diffhead-side-l"><span class="ds-diffhead-label">Before</span>${renamed ? `<span class="ds-diffhead-path">${esc(oldPath)}</span>` : ""}</span>
    <span class="ds-diffhead-divider"></span>
    <span class="ds-diffhead-side ds-diffhead-side-r"><span class="ds-diffhead-label">After</span>${renamed ? `<span class="ds-diffhead-path">${esc(opts.file)}</span>` : ""}</span>
  </div>`;
}
export function renderFullFile(rows, opts) {
    if (!rows.length) {
        return `<div class="ds-diffnote">Couldn't read ${esc(opts.file)} from the working tree.</div>`;
    }
    const paired = pairChangeRows(rows);
    const sides = paired.sides;
    const pairedRows = wholeUntoured(paired.rows) ? plainRows(paired.rows) : paired.rows;
    const runs = untouredRuns(pairedRows);
    if (opts.newFile) {
        // Nothing existed before, so there is no second column to keep in step.
        const body = pairedRows
            .map((r) => renderSplitRow(r, { ...fullRowOpts(r, opts, sides), single: true, untouredTag: runs.get(r) ?? null }))
            .join("");
        return `${newFileHead(opts.file)}<div class="ds-diffbody">${body}</div>`;
    }
    const cols = new SplitColumns();
    for (const r of pairedRows)
        cols.row(r, { ...fullRowOpts(r, opts, sides), untouredTag: runs.get(r) ?? null });
    return `${splitHead(opts)}${cols.html()}`;
}
/** One column for a file with no before side; mirrors the story step's head. */
function newFileHead(file) {
    return `<div class="ds-diffhead ds-diffhead-ctx">
      <span class="ds-diffhead-side"><span class="ds-diffhead-label ds-green">New file</span><span class="ds-diffhead-path">${esc(file)}</span></span>
    </div>`;
}
/** The lazily-loaded Split view for one All-files panel: hunks only,
 *  side-by-side, ⋯ gaps between hunks (expandable after Task 6). */
export function renderSplitHunks(blocksIn, opts) {
    const blocks = wholeUntoured(blocksIn.flat()) ? blocksIn.map(plainRows) : blocksIn;
    if (!blocks.length)
        return `<div class="ds-diffnote">No diff to show.</div>`;
    if (opts.newFile) {
        // A new file's whole content is its one hunk; render it as a single column
        // like a new-file story step, not as an empty pane beside a full one.
        const body = blocks
            .map((block, bi) => {
            const { rows: pairedRows, sides } = pairChangeRows(block);
            const runs = untouredRuns(pairedRows);
            const scope = opts.scopes?.[bi];
            return ((bi > 0 ? renderHunkGap() : "") +
                (scope ? `<div class="ds-scoperow"><code>${esc(scope)}</code></div>` : "") +
                pairedRows
                    .map((row) => renderSplitRow(row, { ...fullRowOpts(row, opts, sides), single: true, untouredTag: runs.get(row) ?? null }))
                    .join(""));
        })
            .join("");
        return `${newFileHead(opts.file)}<div class="ds-diffbody">${body}</div>`;
    }
    const hunkRanges = opts.hunkRanges;
    const canExpand = !!opts.canExpand && !!hunkRanges;
    const cols = new SplitColumns();
    const gapBefore = (bi) => {
        if (!canExpand || !hunkRanges) {
            if (bi > 0)
                cols.gap();
            return;
        }
        if (bi === 0) {
            const start = hunkRanges[0]?.[0] ?? 1;
            if (start > 1)
                cols.gap({ file: opts.file, from: 1, to: start - 1 });
            return;
        }
        const prevEnd = hunkRanges[bi - 1][1];
        const nextStart = hunkRanges[bi][0];
        if (nextStart - prevEnd > 1)
            cols.gap({ file: opts.file, from: prevEnd + 1, to: nextStart - 1 });
        else
            cols.gap();
    };
    blocks.forEach((block, bi) => {
        const { rows: pairedRows, sides } = pairChangeRows(block);
        gapBefore(bi);
        const scope = opts.scopes?.[bi];
        // The scope label heads the AFTER column; the columns flow independently,
        // so it is an ordinary row here rather than a sticky one.
        if (scope)
            cols.right(`<div class="ds-scoperow"><code>${esc(scope)}</code></div>`);
        const runs = untouredRuns(pairedRows);
        for (const row of pairedRows)
            cols.row(row, { ...fullRowOpts(row, opts, sides), untouredTag: runs.get(row) ?? null });
    });
    // A new file's whole content is the hunk — nothing is hidden past it (see
    // filePanel's matching guard), so it gets no trailing eof expand affordance.
    if (canExpand && hunkRanges && blocks.length && !opts.newFile) {
        cols.gap({ file: opts.file, from: hunkRanges[hunkRanges.length - 1][1] + 1, to: "eof" });
    }
    return `${splitHead(opts)}${cols.html()}`;
}
/** Compact, single-column rendering for since-story evidence. The drawer's
 * header already carries the path, so this keeps mobile focused on the exact
 * changed lines instead of squeezing two code columns into half a viewport. */
export function renderUnifiedHunks(file) {
    if (!file.hunks.length)
        return `<div class="ds-diffnote">No diff to show.</div>`;
    const body = file.hunks
        .map((hunk, index) => {
        const rows = hunk.lines.map((line) => renderUnifiedRow({
            type: line.type,
            no: line.newNo ?? line.oldNo,
            content: line.content,
        }));
        return `${index ? renderHunkGap() : ""}${rows.join("")}`;
    })
        .join("");
    return `<div class="ds-diffbody ds-diffbody-unified ds-drift-unified">${body}</div>`;
}
/** Rows served by /api/diff/context, wrapped so the client can read the
 *  actually-served range. A story expander may cross another changed hunk, so
 *  row types must survive this response instead of becoming visual holes. */
export function renderContextRows(rows, layout, opts) {
    if (!rows.length)
        return `<div data-ctx-rows data-from="0" data-to="0"></div>`;
    const numberedRows = rows.filter((row) => row.newNo !== undefined);
    const from = opts.servedRange?.[0] ?? numberedRows[0]?.newNo ?? 0;
    const to = opts.servedRange?.[1] ??
        numberedRows[numberedRows.length - 1]?.newNo ??
        from;
    let body;
    if (layout === "split") {
        // Two side fragments the engine drops into the matching columns. Their
        // data-ri are local (0..n); the engine rebases and renumbers on insert.
        const { rows: pairedRows, sides } = pairChangeRows(rows);
        const runs = untouredRuns(pairedRows);
        const cols = new SplitColumns();
        for (const row of pairedRows)
            cols.row(row, { ...fullRowOpts(row, opts, sides), untouredTag: runs.get(row) ?? null });
        const halves = cols.sides();
        body = `<div data-ctx-side="left">${halves.left}</div><div data-ctx-side="right">${halves.right}</div>`;
    }
    else {
        const unifiedRows = rows.map((row) => ({
            type: row.type,
            no: row.type === "del" ? row.oldNo : row.newNo,
            content: row.content,
            untoured: row.untoured,
        }));
        const intra = intraLineMap(unifiedRows, (row) => row.type, (row) => row.content);
        body = unifiedRows
            .map((row) => unifiedRow(row, opts.file, opts.oldFile ?? opts.file, unifiedIntra(row, intra)))
            .join("");
    }
    return `<div data-ctx-rows data-from="${from}" data-to="${to}">${body}</div>`;
}
function fullRowOpts(row, opts, intra) {
    const leftTarget = !opts.newFile && row.oldNo !== undefined
        ? {
            side: "left",
            file: opts.oldFile ?? opts.file,
            line: row.oldNo,
        }
        : undefined;
    const rightTarget = row.newNo === undefined
        ? undefined
        : { side: "right", file: opts.file, line: row.newNo };
    return {
        leftTarget,
        rightTarget,
        sides: intra?.get(row),
    };
}
// ---- shared bits ----
function splitPath(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)];
}
function plural(n, word) {
    return n === 1 ? word : word + "s";
}
function esc(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function nl(s) {
    return s.replace(/\n/g, "<br>");
}
function prose(value) {
    return { html: value.html, text: value.text, speech: value.speech };
}
function beatViews(step) {
    return step.beats.map((beat) => ({
        focusGroup: beat.focusGroup,
        text: prose(beat.text),
        destination: beatDestination(step.file, beat.highlights, beat.oldHighlights),
    }));
}
/**
 * Project one step for the initial document.
 *
 * Everything the step's diff needs — blocks, moves, focus groups, viewport —
 * is deliberately left behind: the panel is a stub until the reviewer walks
 * onto it. What travels is the rail card, the filmstrip label, and the speech
 * projections that let narration plan the story without loading a panel.
 */
function stepView(step) {
    const base = {
        id: step.id,
        kind: step.kind,
        weight: step.weight,
        sceneLayout: step.sceneLayout,
        order: step.order,
        title: prose(step.title),
        kindLabel: step.kindLabel,
        beats: [],
        ...(step.chapter ? { chapter: step.chapter } : {}),
    };
    if (step.kind === "concept") {
        return { ...base, conceptSpeech: conceptSpeechText(step) };
    }
    return {
        ...base,
        file: step.file,
        beats: beatViews(step),
        why: prose(step.why),
        health: { broad: step.health.broad, reasons: step.health.reasons },
    };
}
function fileRow(file) {
    return {
        file: file.file,
        add: file.add,
        del: file.del,
        untoured: file.untoured,
        kind: file.kind === "new"
            ? "new"
            : file.kind === "context"
                ? "context"
                : "changed",
        kindLabel: file.kindLabel,
        status: file.status,
        symbols: file.symbols,
        reviewHash: fileReviewHash(file),
        hasFull: file.hasFull,
        hasHunks: file.hunks.length > 0,
        ...(file.regeneratedBy ? { regeneratedBy: file.regeneratedBy } : {}),
    };
}
function readingOrderLabel(model) {
    if (!model.conceptSteps)
        return `${model.codeSteps} ${plural(model.codeSteps, "step")}`;
    return `${model.codeSteps} ${plural(model.codeSteps, "code step")} + ${model.conceptSteps} ${plural(model.conceptSteps, "primer")}`;
}
/**
 * Build the payload and render the shell.
 *
 * The `buildReviewModel` options here are the 300-step guarantee and must be
 * copied exactly by anything that replaces this call: `files: []` and the two
 * empty detail sets mean no step and no file panel carries a rendered diff, and
 * `trustPending` means coverage is honestly unknown until the lazy check runs.
 */
export function renderReviewShell(input) {
    const { repo, tour, files, baseLabel, comments, headRef } = input;
    const routeBase = input.routeBase ?? "";
    const storyless = input.storyless ?? false;
    const storyDrift = input.storyDrift;
    const storyFreshness = storyless
        ? "current"
        : storyDrift
            ? storyDrift.state === "unverified"
                ? "unverified"
                : storyDrift.state === "story-changed" || storyDrift.state === "mixed"
                    ? "stale"
                    : "current"
            : (input.storyFreshness ?? "current");
    const reviewState = input.reviewState ?? {
        scopeKey: "",
        currentDiffHash: "",
        feedbackHealth: { status: "healthy", source: "missing" },
    };
    const excludedFiles = input.excludedFiles ?? [];
    const indexDivergentFiles = input.stagedWorktreeDivergentFiles ?? [];
    const model = buildReviewModel(repo, tour, files, headRef, {
        storyless,
        detailedStepIndexes: input.fileIndex ? new Set() : new Set([0]),
        detailedFilePaths: new Set(),
        fileIndex: input.fileIndex,
        trustPending: !!input.fileIndex,
        baseRef: tour.base ?? baseLabel,
        storyIdentity: input.storyKey,
    });
    const activeComments = comments.filter((comment) => comment.status !== "resolved");
    const queuedComments = activeComments.filter((comment) => comment.status === "open");
    const openCount = queuedComments.length;
    const blockingOpenCount = queuedComments.filter((comment) => comment.type === "change").length;
    const uncoveredCount = model.trust.uncovered.length;
    // Health lint reads post-change lines; memoize per file so a 300-step story
    // does not re-read the same file per step.
    const healthLines = new Map();
    const health = storyless
        ? { findings: [], errors: 0, warnings: 0, unexplainedRanges: 0 }
        : {
            ...storyHealth(tour, (file) => {
                if (!healthLines.has(file))
                    healthLines.set(file, readWholeFile(repo, file, headRef));
                return healthLines.get(file) ?? null;
            }),
            unexplainedRanges: uncoveredCount,
        };
    const focusedStory = !!tour.storyScope?.excludedFiles?.length;
    const feedbackHealthy = reviewState.feedbackHealth?.status !== "invalid";
    const feedbackRecovery = reviewState.feedbackHealth?.status === "invalid"
        ? reviewState.feedbackHealth.recovery
        : "";
    const trustPending = !!model.trust.pending;
    const reviewClean = !trustPending &&
        feedbackHealthy &&
        blockingOpenCount === 0 &&
        uncoveredCount === 0 &&
        storyFreshness === "current" &&
        excludedFiles.length === 0 &&
        indexDivergentFiles.length === 0 &&
        !focusedStory;
    // No story → no coverage to report, so the coverage row is meaningless; hide it.
    const showTrustPill = !storyless || excludedFiles.length > 0 || indexDivergentFiles.length > 0;
    const trustPillClean = !trustPending &&
        !indexDivergentFiles.length &&
        (storyless || (storyFreshness === "current" && !uncoveredCount));
    const payload = {
        repo,
        repoName: input.repoName ?? routeBase.split("/").pop() ?? "",
        routeBase,
        storyless,
        baseLabel,
        audience: input.audience ?? "newcomer",
        health,
        ...(headRef ? { headRef } : {}),
        ...(tour.base ? { baseRef: tour.base } : {}),
        pageToken: input.reviewPageToken ?? "",
        storyKey: input.storyKey ?? "",
        reviewScope: reviewState.scopeKey,
        viewedScope: `${repo}|${reviewState.scopeKey || baseLabel}|full`,
        currentDiffHash: reviewState.currentDiffHash,
        story: {
            title: prose(model.story.title),
            ...(model.story.summary ? { summary: prose(model.story.summary) } : {}),
            ...(model.story.intent
                ? {
                    intent: {
                        goal: prose(model.story.intent.goal),
                        ...(model.story.intent.design
                            ? { design: prose(model.story.intent.design) }
                            : {}),
                        nonGoals: model.story.intent.nonGoals.map(prose),
                    },
                }
                : {}),
            ...(model.story.verification
                ? {
                    verification: model.story.verification.map((entry) => ({
                        check: entry.check,
                        result: entry.result,
                        ...(entry.detail ? { detail: prose(entry.detail) } : {}),
                    })),
                }
                : {}),
            ...(model.story.arc ? { arc: model.story.arc } : {}),
            ...(model.story.evolution
                ? {
                    evolution: {
                        commitCount: model.story.evolution.commitCount,
                        phases: model.story.evolution.phases.map((phase) => ({
                            title: phase.title,
                            summary: prose(phase.summary),
                            firstCommit: phase.firstCommit,
                            lastCommit: phase.lastCommit,
                            commitCount: phase.commitCount,
                            ...(phase.relatedPanelIndex
                                ? { relatedPanelIndex: phase.relatedPanelIndex }
                                : {}),
                        })),
                    },
                }
                : {}),
        },
        steps: model.steps.map(stepView),
        challengeTargets: challengeTargets(tour, (file) => {
            if (!healthLines.has(file))
                healthLines.set(file, readWholeFile(repo, file, headRef));
            return healthLines.get(file) ?? null;
        }),
        files: model.files.map(fileRow),
        hotspots: model.hotspots.map((spot) => ({
            panelIndex: spot.panelIndex,
            order: spot.order,
            title: prose(spot.title),
            reason: prose(spot.reason),
        })),
        trust: {
            pending: trustPending,
            coveredLines: model.trust.coveredLines,
            uncoveredLines: model.trust.uncoveredLines,
            uncoveredCount,
        },
        totalSteps: model.totalSteps,
        codeSteps: model.codeSteps,
        conceptSteps: model.conceptSteps,
        filesChanged: model.filesChanged,
        contextFiles: model.contextFiles,
        totalAdd: model.totalAdd,
        totalDel: model.totalDel,
        storyFilesChanged: model.storyFilesChanged,
        storyIncludedFiles: tour.storyScope?.includedFiles ?? [],
        storyFreshness,
        ...(storyDrift ? { storyDrift } : {}),
        ...(input.history ? { history: input.history } : {}),
        comments: activeComments,
        // Where each comment's code went since it was written. Only the server can
        // answer this — it re-reads the working tree and searches for the selected
        // text — so it travels rather than being recomputed in the browser.
        commentAnchors: activeComments.map((comment) => commentAnchorView(repo, headRef, comment)),
        excludedFiles,
        stagedWorktreeDivergentFiles: indexDivergentFiles,
        chrome: {
            openCount,
            blockingOpenCount,
            focusedStory,
            feedbackHealthy,
            feedbackRecovery,
            reviewClean,
            showTrustPill,
            trustPillClean,
            readingOrder: readingOrderLabel(model),
        },
    };
    return renderShell({
        surface: "review",
        title: storyless ? "Reviewing the diff" : model.story.title.text,
        payload,
        // `ds-map-bg` must be painted during boot, before React commits, or the
        // page flashes a flat background. `ds-overview-active` is the initial
        // navigation position; the engine owns it from then on.
        bodyClass: `ds-map-bg${storyless ? "" : " ds-overview-active"}`,
    });
}
