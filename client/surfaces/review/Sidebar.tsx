// The review sidebar: resume, overview card, reading progress, the file
// toolbar, the story rail, the file tree, and the two resize affordances.
//
// A literal port of `storyRail()` / `railFileTree()` and their neighbours in
// `src/render.ts`. It renders once and never re-renders: every runtime change
// on this surface — `is-active` on a rail card, `is-viewed` on a file item, the
// `scaleX` progress fill, the filtered/hidden state of a tree row — is written
// by the engine's `activateStep()`, `syncViewed()` and `applyFileFilters()`,
// which are the same functions that wrote them when this markup came from a
// template string. React owning that state as well would mean two writers for
// one attribute.
//
// Two things here are performance measures, not layout choices:
//
//   * Over 10 steps the rail collapses into `<details>` chapters AND drops
//     every beat tree. The comment in the original cites ~1 MB of narration in
//     the initial DOM for a real 245-step story.
//   * `data-filter-path` folds the path and its changed declarations into one
//     lowercased string, so the search box can prefilter client-side before
//     `/api/review/file-search` is asked anything.

import { BrandMark } from "../../shared/brand";
import type { ReviewFileRow, ReviewPayload, ReviewStepView } from "../../../src/payloads";
import { html, isTestPath, numeral, plural, railBeatLabel, splitPath } from "./format";
import { groupSkimRuns } from "./skim";

const CHEVRON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m5.75 3.75 4.25 4.25-4.25 4.25" />
  </svg>
);
const FOLDER = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.75 4.25h4.1l1.4 1.5h7v7.5H1.75z" />
  </svg>
);
const FILE_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.75 1.75h5.1l3.4 3.4v9.1h-8.5z" />
    <path d="M8.75 1.75v3.5h3.5" />
  </svg>
);

export function StoryMark() {
  return <BrandMark className="ds-storymark" size={18} tone="mono" />;
}

/** The repair menu, on a rail beat list and on every code step's title row. */
export function StoryRepairMenu({ step, iconOnly = true }: { step: ReviewStepView; iconOnly?: boolean }) {
  const healthTitle = step.health?.broad ? ` Broad step: ${step.health.reasons.join(" · ")}.` : "";
  const actions: [string, string, string][] = [
    ["rewrite", "Rewrite explanation", "Make the claim and evidence sharper without changing the review path."],
    ["shorten", "Make shorter", "Condense this explanation without dropping its risk."],
    ["split", "Split into smaller stops", "Give each decision its own stop."],
  ];
  return (
    <details className={`ds-story-tune${iconOnly ? " is-icon" : ""}`}>
      <summary aria-label="Repair this story step" title={`Story repair options.${healthTitle}`}>
        {iconOnly ? (
          <span className="ds-story-tune-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z" />
            </svg>
          </span>
        ) : (
          <span>Repair step</span>
        )}
      </summary>
      <div className="ds-story-tune-pop">
        {actions.map(([action, title, detail]) => (
          <button
            key={action}
            type="button"
            data-story-repair={action}
            data-story-step={step.id}
            data-story-file={step.file ?? ""}
          >
            <strong>{title}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
    </details>
  );
}

function RailBeats({ step, stepIndex }: { step: ReviewStepView; stepIndex: number }) {
  if (!step.beats.length) return null;
  return (
    <div className="ds-railbeats">
      <div className="ds-railbeats-head">
        <span>Review beats</span>
        {step.health?.broad ? (
          <span className="ds-railbeats-health" title={step.health.reasons.join(" · ")}>
            <i aria-hidden="true" />
            Broad
          </span>
        ) : null}
        <span className="ds-railbeats-count" data-rail-current>
          1 / {step.beats.length}
        </span>
        <StoryRepairMenu step={step} />
      </div>
      <div className="ds-railbeat-list">
        {step.beats.map((beat) => (
          <button
            key={beat.focusGroup}
            type="button"
            className="ds-railbeat"
            data-rail-beat
            data-rail-step-index={stepIndex}
            data-focus-group={beat.focusGroup}
            aria-pressed="false"
            title={beat.text.text}
            aria-label={`Beat ${beat.focusGroup + 1}: ${beat.text.text}`}
          >
            <span className="ds-railbeat-marker">{numeral(beat.focusGroup + 1)}</span>
            <span className="ds-railbeat-text">{railBeatLabel(beat.text.text)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RailCard({ step, index, includeBeats }: { step: ReviewStepView; index: number; includeBeats: boolean }) {
  const stepIndex = index + 1;
  if (step.kind === "concept") {
    return (
      <div className="ds-railstory-node" data-story-step-node={stepIndex} data-weight={step.weight}>
        <button className="ds-stepcard is-concept" data-step-index={stepIndex} data-step-id={step.id}>
          <span className="ds-num">{numeral(stepIndex)}</span>
          <span className="ds-stepcard-body">
            <span className="ds-stepcard-title" dangerouslySetInnerHTML={html(step.title.html)} />
            <span className="ds-stepcard-fileline">
              <span className="ds-stepcard-file">Concept primer</span>
            </span>
          </span>
        </button>
      </div>
    );
  }
  const base = splitPath(step.file ?? "")[1];
  return (
    <div className="ds-railstory-node" data-story-step-node={stepIndex} data-weight={step.weight}>
      <button className="ds-stepcard" data-step-index={stepIndex} data-step-id={step.id}>
        <span className="ds-num">{numeral(stepIndex)}</span>
        <span className="ds-stepcard-body">
          <span className="ds-stepcard-title" dangerouslySetInnerHTML={html(step.title.html)} />
          <span className="ds-stepcard-fileline">
            <span className="ds-stepcard-file" title={step.file}>
              {base}
            </span>
            {/* "Changed" on every card is noise, so only the exceptions badge. */}
            {step.kind === "changed" ? null : (
              <span className={`ds-railbadge ds-badge-${step.kind === "new-file" ? "new" : "context"}`}>
                {step.kindLabel}
              </span>
            )}
          </span>
        </span>
      </button>
      {includeBeats ? <RailBeats step={step} stepIndex={stepIndex} /> : null}
    </div>
  );
}

interface RailGroup {
  label: string;
  items: { step: ReviewStepView; index: number }[];
}

/** The >10-step compaction. See the note at the top of this file. */
function chapterGroups(steps: ReviewStepView[]): RailGroup[] {
  const groups: RailGroup[] = [];
  if (steps.some((step) => step.chapter)) {
    steps.forEach((step, index) => {
      const label = step.chapter || "More to review";
      const previous = groups[groups.length - 1];
      if (previous?.label === label) previous.items.push({ step, index });
      else groups.push({ label, items: [{ step, index }] });
    });
    return groups;
  }
  const size = 6;
  for (let start = 0; start < steps.length; start += size) {
    const groupIndex = groups.length;
    const end = Math.min(steps.length, start + size);
    const label =
      groupIndex === 0 ? "Start here" : end === steps.length ? "Boundaries and proof" : `Follow the flow · ${groupIndex + 1}`;
    groups.push({ label, items: steps.slice(start, end).map((step, offset) => ({ step, index: start + offset })) });
  }
  return groups;
}

function RailItems({
  items,
  includeBeats,
}: {
  items: { step: ReviewStepView; index: number }[];
  includeBeats: boolean;
}) {
  return (
    <>
      {groupSkimRuns(items).map((group, groupIndex) =>
        group.kind === "step" ? (
          <RailCard key={group.step.id} step={group.step} index={group.index} includeBeats={includeBeats} />
        ) : (
          <details key={`skim-${groupIndex}`} className="ds-railskim" data-weight="skim">
            <summary>
              <span>Skim</span>
              <small>
                {group.steps.length} {plural(group.steps.length, "step")}
              </small>
            </summary>
            <div className="ds-railskim-steps">
              {group.steps.map(({ step, index }) => (
                <RailCard key={step.id} step={step} index={index} includeBeats={includeBeats} />
              ))}
            </div>
          </details>
        ),
      )}
    </>
  );
}

function StoryRail({ steps }: { steps: ReviewStepView[] }) {
  if (steps.length <= 10) {
    return <RailItems items={steps.map((step, index) => ({ step, index }))} includeBeats />;
  }
  return (
    <>
      {chapterGroups(steps).map((group, index) => (
        <details key={`${group.label}-${index}`} className="ds-railchapter" data-story-chapter open={index === 0}>
          <summary>
            <span>{group.label}</span>
            <small>
              {group.items.length} {plural(group.items.length, "step")}
            </small>
          </summary>
          <div className="ds-railchapter-steps">
            <RailItems items={group.items} includeBeats={false} />
          </div>
        </details>
      ))}
    </>
  );
}

// ---- file tree -------------------------------------------------------------

interface TreeDir {
  kind: "dir";
  name: string;
  path: string;
  children: TreeChild[];
  dirs: Map<string, TreeDir>;
  count: number;
  add: number;
  del: number;
  untoured: number;
}
interface TreeFile {
  kind: "file";
  file: ReviewFileRow;
  index: number;
}
type TreeChild = TreeDir | TreeFile;

function newDir(name: string, path: string): TreeDir {
  return { kind: "dir", name, path, children: [], dirs: new Map(), count: 0, add: 0, del: 0, untoured: 0 };
}

function buildTree(files: ReviewFileRow[]): TreeDir {
  const root = newDir("", "");
  files.forEach((file, index) => {
    const parts = file.file.split("/").filter(Boolean);
    parts.pop();
    let node = root;
    const tally = (dir: TreeDir) => {
      dir.count += 1;
      dir.add += file.add;
      dir.del += file.del;
      dir.untoured += file.untoured;
    };
    tally(node);
    let path = "";
    for (const part of parts) {
      path += `${part}/`;
      let dir = node.dirs.get(part);
      if (!dir) {
        dir = newDir(part, path);
        node.dirs.set(part, dir);
        node.children.push(dir);
      }
      tally(dir);
      node = dir;
    }
    node.children.push({ kind: "file", file, index });
  });
  return root;
}

function Stat({ add, del }: { add: number; del: number }) {
  if (!add && !del) return <span className="ds-dim">·</span>;
  return (
    <>
      {add ? <span className="ds-stat-add">+{add}</span> : null}
      {del ? <span className="ds-stat-del">−{del}</span> : null}
    </>
  );
}

function FileItem({
  file,
  index,
  depth,
  commented,
}: {
  file: ReviewFileRow;
  index: number;
  depth: number;
  commented: boolean;
}) {
  const [dir, base] = splitPath(file.file);
  const declarations = file.symbols.length ? ` · Changed: ${file.symbols.slice(0, 2).join(", ")}` : "";
  const regenerated = file.regeneratedBy ? ` · Regenerated by ${file.regeneratedBy}` : "";
  return (
    <button
      className={`ds-fileitem${file.untoured ? " is-untoured" : ""}`}
      data-file-index={index}
      data-file-path={file.file}
      data-goto-file={file.file}
      data-review-hash={file.reviewHash}
      data-filter-path={`${file.file} ${file.symbols.join(" ")}`.toLowerCase()}
      data-filter-status={file.status}
      data-filter-test={isTestPath(file.file) ? "1" : "0"}
      data-filter-comments={commented ? "1" : "0"}
      data-filter-unexplained={file.untoured ? "1" : "0"}
      // `sinceFiles` has always been empty at this call site; the attribute is
      // kept so the filter code keeps one shape for every row.
      data-filter-since="0"
      style={{ "--tree-indent": `${depth * 14}px` } as React.CSSProperties}
      title={`${file.file} — ${file.kindLabel}${declarations}${regenerated}`}
    >
      <span className="ds-fileitem-spacer" aria-hidden="true" />
      <span className={`ds-fileitem-icon k-${file.kind}`} aria-hidden="true">
        {FILE_ICON}
      </span>
      <span className="ds-fileitem-path">
        <span className="ds-fileitem-base">{base || dir}</span>
      </span>
      <span className="ds-fileitem-meta">
        {file.untoured ? (
          <span className="ds-fileitem-flag" aria-hidden="true" title={`${file.untoured} unexplained ${plural(file.untoured, "change")}`}>
            ▲
          </span>
        ) : null}
        {file.regeneratedBy ? (
          <span className="ds-fileitem-regen" aria-hidden="true" title={`Regenerated by ${file.regeneratedBy}`}>
            ↻
          </span>
        ) : null}
        <span className="ds-fileitem-viewed" aria-hidden="true">
          ✓
        </span>
        <span className="ds-fileitem-stat">
          <Stat add={file.add} del={file.del} />
        </span>
      </span>
    </button>
  );
}

function TreeChildren({ children, depth, commented }: { children: TreeChild[]; depth: number; commented: Set<string> }) {
  return (
    <>
      {children.map((child) =>
        child.kind === "dir" ? (
          <details
            key={`d:${child.path}`}
            className="ds-filetree-dir"
            data-filetree-path={child.path}
            style={{ "--tree-depth": depth } as React.CSSProperties}
            open
          >
            <summary
              className="ds-filetree-summary"
              style={{ "--tree-indent": `${depth * 14}px` } as React.CSSProperties}
              title={child.path}
            >
              <span className="ds-filetree-caret" aria-hidden="true">
                {CHEVRON}
              </span>
              <span className="ds-filetree-folder" aria-hidden="true">
                {FOLDER}
              </span>
              <span className="ds-filetree-name">{child.name}</span>
              <span className="ds-filetree-meta">
                <span className="ds-filetree-count">
                  {child.count} {plural(child.count, "file")}
                </span>
                {child.untoured ? (
                  <span
                    className="ds-fileitem-flag"
                    aria-hidden="true"
                    title={`${child.untoured} unexplained ${plural(child.untoured, "change")}`}
                  >
                    ▲
                  </span>
                ) : null}
                <span className="ds-filetree-stat">
                  <Stat add={child.add} del={child.del} />
                </span>
              </span>
            </summary>
            <div className="ds-filetree-children">
              <TreeChildren children={child.children} depth={depth + 1} commented={commented} />
            </div>
          </details>
        ) : (
          <FileItem
            key={`f:${child.file.file}`}
            file={child.file}
            index={child.index}
            depth={depth}
            commented={commented.has(child.file.file)}
          />
        ),
      )}
    </>
  );
}

/**
 * One row per generator whose outputs the story claims as regenerated: the
 * command that explains them, and how many changed files it covers. The files
 * themselves stay in the tree below (marked ↻) so the diff stays complete;
 * these rows say why no story step walks them.
 */
function RegeneratedRows({ files }: { files: ReviewFileRow[] }) {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    if (!file.regeneratedBy) continue;
    const list = groups.get(file.regeneratedBy) ?? [];
    list.push(file.file);
    groups.set(file.regeneratedBy, list);
  }
  if (!groups.size) return null;
  return (
    <div className="ds-regen-rows" role="note" aria-label="Regenerated files">
      {[...groups].map(([by, paths]) => (
        <div key={by} className="ds-regen-row" title={paths.join("\n")}>
          <span className="ds-regen-badge" aria-hidden="true">
            ↻
          </span>
          <code className="ds-regen-command">{by}</code>
          <span className="ds-regen-count">
            {paths.length} {plural(paths.length, "file")}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The excluded-file escape hatch.
 *
 * `compact` is the sidebar form (a list of jumps into the Coverage tab); the
 * wide form is the notice that replaces the whole file list when the scope
 * contains nothing BUT excluded files, which is the one case where a reviewer
 * would otherwise see an empty page and conclude there was no change.
 */
export function ExcludedScopeNotice({
  files,
  compact,
}: {
  files: ReviewPayload["excludedFiles"];
  compact: boolean;
}) {
  if (compact) {
    return (
      <div className="ds-excluded-rail-list">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className="ds-excluded-rail-file"
            data-goto-review="exclusions"
            data-goto-excluded={file.path}
            aria-label={`${file.path}, inspect bounded preview`}
          >
            <span className="ds-excluded-rail-file-icon" aria-hidden="true">
              {FILE_ICON}
            </span>
            <code>{file.path}</code>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    );
  }
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

export function Sidebar({ payload }: { payload: ReviewPayload }) {
  const { steps, files, excludedFiles, storyless, chrome } = payload;
  const exactFiles = files.length + excludedFiles.length;
  const excludedOnly = files.length === 0 && excludedFiles.length > 0;
  const commented = new Set(payload.comments.filter((c) => c.status !== "resolved").map((c) => c.file));
  const tree = files.length ? buildTree(files) : null;
  // A code story's files are code to read, not changes to review or explain.
  const codeStory = payload.subject === "code";
  const fileFilters: [string, string][] = codeStory
    ? [
        ["all", "All"],
        ["reviewed", "Read"],
        ["unreviewed", "Unread"],
        ["comments", "Comments"],
        ["tests", "Tests"],
      ]
    : [
        ["all", "All"],
        ["reviewed", "Reviewed"],
        ["unreviewed", "Unreviewed"],
        ["comments", "Comments"],
        ["unexplained", "Unexplained"],
        ["tests", "Tests"],
      ];

  return (
    <>
      <aside className="ds-rail" aria-label="Review navigation">
        <div className="ds-railpad">
          <button className="ds-resume-review" data-resume-review type="button" hidden>
            <span aria-hidden="true">↩</span>
            <span data-resume-review-label>Resume where you stopped</span>
          </button>
        </div>

        {/* Navigation index 0: the calm entry point, above the numbered steps. */}
        <button
          className="ds-stepcard is-intro is-active"
          data-rail="tour"
          data-intro
          data-step-index="0"
          title={
            codeStory
              ? "The code at a glance, before the walkthrough"
              : "The whole change at a glance, before the walkthrough"
          }
        >
          <span className="ds-num">
            <StoryMark />
          </span>
          <span className="ds-stepcard-body">
            <span className="ds-stepcard-title">Overview</span>
            <span className="ds-intro-cardsub">
              {codeStory ? "The code at a glance" : "The change at a glance"}
              {payload.totalSteps ? ` · ${chrome.readingOrder}` : ""}
            </span>
          </span>
        </button>

        <div className="ds-readhead" data-rail="tour">
          <div className="ds-readhead-row">
            <span className="ds-readhead-label">Reading order</span>
            <span className="ds-readhead-count" id="ds-progress-text">
              {storyless ? "No story yet" : chrome.readingOrder}
            </span>
          </div>
          <div className="ds-readhead-track">
            <div className="ds-readhead-fill" id="ds-progress-fill" />
          </div>
          {/* Uncontrolled, like everything else here: the engine reads the body
              attribute, and this surface never re-renders. */}
          {steps.some((step) => step.weight === "skim") ? (
            <label className="ds-mustonly">
              <input
                type="checkbox"
                data-must-only-toggle
                onChange={(event) =>
                  document.body.toggleAttribute("data-must-only", event.target.checked)
                }
              />
              Must-read only
            </label>
          ) : null}
        </div>

        <div className="ds-readhead" data-rail="files" hidden>
          <div className="ds-readhead-row">
            <span className="ds-readhead-label">Files</span>
            <span className="ds-readhead-count" data-viewed-progress data-excluded-count={excludedFiles.length}>
              {exactFiles} {plural(exactFiles, "file")}
              {excludedFiles.length && files.length ? ` · ${excludedFiles.length} kept lazy` : ""}
            </span>
          </div>
          {files.length ? (
            <div className="ds-filetools">
              <label className="ds-file-search">
                <span aria-hidden="true">⌕</span>
                <input
                  data-file-search
                  type="search"
                  placeholder={codeStory ? "Search paths, symbols, or code" : "Search paths, symbols, or changed code"}
                  aria-label={
                    codeStory
                      ? "Search file paths, declarations, and code"
                      : "Search changed file paths, declarations, and code"
                  }
                />
              </label>
              <details className="ds-filefilter-menu">
                <summary>
                  Filter: <strong data-file-filter-label>All</strong>
                  <span aria-hidden="true">⌄</span>
                </summary>
                <div className="ds-filefilters" role="group" aria-label="File filters">
                  {fileFilters.map(([id, label]) => (
                    <button
                      key={id}
                      className={id === "all" ? "is-active" : undefined}
                      data-file-filter={id}
                      aria-pressed={id === "all"}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
              <button className="ds-next-unviewed" data-next-unviewed type="button">
                {codeStory ? "Next unread" : "Next unreviewed"} <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="ds-railscroll">
          <div className="ds-railsteps" data-rail="tour">
            <div className="ds-spine" />
            <StoryRail steps={steps} />
          </div>
          <div className="ds-railfiles" data-rail="files" hidden>
            <RegeneratedRows files={files} />
            {tree ? (
              <div className="ds-filetree">
                <TreeChildren children={tree.children} depth={0} commented={commented} />
              </div>
            ) : excludedOnly ? (
              <ExcludedScopeNotice files={excludedFiles} compact />
            ) : (
              <div className="ds-empty ds-empty-rail">
                {codeStory ? "No files in this story." : "No files in this change."}
              </div>
            )}
          </div>
        </div>

        <div
          className="ds-rail-resizer"
          data-sidebar-resizer
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          title="Resize sidebar"
        />
      </aside>
      <div className="ds-rail-scrim" data-sidebar-scrim aria-hidden="true" />
    </>
  );
}
