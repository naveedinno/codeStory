// The Overview's "Story health" row: contract errors, lint findings grouped
// by rule, a link to unexplained changes, and runtime Mermaid failures.
//
// Server findings arrive in the payload. Diagram failures happen later, in
// the browser, when a concept panel renders: the engine stashes them on
// `window.__dsDiagramErrors` and dispatches `ds-diagram-error` (see B8), and
// this component drains the stash and subscribes. Keyed by step+message so a
// failure seen both ways renders once.
//
// Repair buttons reuse the delegated `[data-story-repair]` handler — the same
// flow as each step's Repair menu — so no engine change was needed. After a
// repair the reviewer reloads the story and the row recomputes.

import { useEffect, useState } from "react";
import type { StoryHealthFinding, StoryHealthView } from "../../../src/payloads";
import { capHealthRows } from "./engine/health-cap";
import { formatCount, plural } from "./format";

interface DiagramFailure {
  step: string;
  panel: number;
  message: string;
  line: number;
}

declare global {
  interface Window {
    __dsDiagramErrors?: DiagramFailure[];
  }
}

function diagramFinding(failure: DiagramFailure): StoryHealthFinding {
  const line = failure.line > 0 ? ` (line ${failure.line})` : "";
  return {
    kind: "diagram",
    severity: "error",
    where: failure.step ? `steps[${failure.step}]` : "story",
    message: `Diagram failed to draw${line}: ${failure.message}`,
    fix: "Fix the Mermaid source, or repair the step with the agent.",
    ...(failure.step ? { stepId: failure.step } : {}),
    ...(failure.panel > 0 ? { panelIndex: failure.panel } : {}),
  };
}

const RULE_LABELS: Record<string, string> = {
  "beat-too-long": "Overlong beats",
  "beats-long-on-average": "Beat length",
  "chapter-missing": "Missing chapters",
  "chapter-pingpong": "Chapter order",
  "chapter-seam": "Chapter seams",
  "chapter-too-long": "Long chapters",
  "copied-beat": "Copied beats",
  "detailed-without-primer": "Missing primers",
  "formulaic-opener": "Formulaic openers",
  "hotspot-is-verification": "Misfiled hotspots",
  "hotspot-not-a-doubt": "Vague hotspots",
  "import-only-highlight": "Import-only highlights",
  "landing-bare-opener": "Bare openers",
  "landing-field-missing": "Explain where this code fits",
  "landing-missing-symbol": "Name the code being explained",
  "line-pointer": "Line-number narration",
  "markdown-residue": "Markdown residue",
  "mermaid-label": "Diagram labels",
  "no-hotspots": "Missing hotspots",
  "numbered-series": "Numbered series",
  "offscreen-claim": "Off-screen claims",
  "prose-value-transition": "Value transitions",
  "tests-at-tail": "Tests at the tail",
  "why-copies-beats": "Why copies beats",
};

function FindingRow({ finding }: { finding: StoryHealthFinding }) {
  const message = finding.rule === "landing-field-missing"
    ? "Explain the function, its caller, and when this code runs."
    : finding.rule === "landing-missing-symbol"
      ? "Start by naming the function or rule on screen."
      : finding.message;
  const fix = finding.rule === "landing-field-missing" || finding.rule === "landing-missing-symbol"
    ? "Use Improve this step to add the missing context."
    : finding.fix;
  return (
    <li className="ds-health-finding">
      <span className={`ds-health-dot is-${finding.severity}`} aria-hidden="true" />
      <div className="ds-health-copy">
        <span className="ds-health-message">
          {finding.severity === "error" ? "Error: " : "Warning: "}
          {message}
        </span>{" "}
        <details className="ds-health-location"><summary>Technical details</summary><code>{finding.where}: {finding.message}</code></details>
        {fix ? <span className="ds-health-fix">{fix}</span> : null}
      </div>
      <span className="ds-health-actions">
        {finding.panelIndex ? (
          <button type="button" data-goto-step={finding.panelIndex}>
            Step {finding.panelIndex} <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <button
          type="button"
          data-story-repair="rewrite"
          data-story-step={finding.stepId}
          data-story-file={finding.file}
        >
          Improve this step
        </button>
      </span>
    </li>
  );
}

function CappedFindings({ rows }: { rows: StoryHealthFinding[] }) {
  const { shown, rest } = capHealthRows(rows);
  return (
    <ul>
      {shown.map((finding, index) => (
        <FindingRow key={`${finding.where}-${index}`} finding={finding} />
      ))}
      {rest ? (
        <li className="ds-health-more">
          …and {formatCount(rest)} more {plural(rest, "finding")} in this section.
        </li>
      ) : null}
    </ul>
  );
}

export function StoryHealthRow({ health }: { health: StoryHealthView }) {
  const [diagrams, setDiagrams] = useState<DiagramFailure[]>(() =>
    Array.isArray(window.__dsDiagramErrors) ? [...window.__dsDiagramErrors] : [],
  );

  useEffect(() => {
    const seen = new Set(diagrams.map((d) => `${d.step}·${d.message}`));
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<DiagramFailure>).detail;
      if (!detail || typeof detail.message !== "string") return;
      const key = `${detail.step}·${detail.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      setDiagrams((rows) => [...rows, detail]);
    };
    document.addEventListener("ds-diagram-error", onError);
    return () => document.removeEventListener("ds-diagram-error", onError);
    // The stash is drained once into state; the listener owns later failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diagramFindings = diagrams.map(diagramFinding);
  const findings = [...health.findings, ...diagramFindings];
  const contract = findings.filter((f) => f.kind === "contract");
  const lint = findings.filter((f) => f.kind === "lint");
  const rules = new Map<string, StoryHealthFinding[]>();
  for (const finding of lint) {
    const list = rules.get(finding.rule ?? "lint") ?? [];
    list.push(finding);
    rules.set(finding.rule ?? "lint", list);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const total = findings.length;

  const summary = total
    ? `${formatCount(errors)} ${plural(errors, "error")} · ${formatCount(warnings)} ${plural(warnings, "warning")}`
    : "No issues found";

  return (
    <details className="ds-health" data-story-health open={errors > 0}>
      <summary>
        <span>Story health</span>
        <small>
          <span aria-hidden="true">·</span> {summary}
        </small>
        <span className="ds-intro-evolution-caret" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="ds-health-body">
        {health.unexplainedRanges > 0 ? (
          <p className="ds-health-unexplained">
            {formatCount(health.unexplainedRanges)} {plural(health.unexplainedRanges, "change")} no step
            explains.{" "}
            <button type="button" data-goto-review="unexplained">
              See evidence <span aria-hidden="true">→</span>
            </button>
          </p>
        ) : null}
        {!total && !health.unexplainedRanges ? (
          <p className="ds-health-clean">
            The story passes its contract and lint checks. Unexplained changes would appear here
            too.
          </p>
        ) : null}
        {contract.length ? (
          <section aria-label="Contract errors">
            <h3>Contract errors</h3>
            <CappedFindings rows={contract} />
          </section>
        ) : null}
        {[...rules].map(([rule, rows]) => (
          <section key={rule} aria-label={RULE_LABELS[rule] ?? rule}>
            <h3>{RULE_LABELS[rule] ?? rule}</h3>
            <CappedFindings rows={rows} />
          </section>
        ))}
        {diagramFindings.length ? (
          <section aria-label="Diagram failures">
            <h3>Diagrams that failed to draw</h3>
            <CappedFindings rows={diagramFindings} />
          </section>
        ) : null}
      </div>
    </details>
  );
}
