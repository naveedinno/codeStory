// One saved review.
//
// The whole row is a link to `<routeBase>/review?story=<id>` — a real anchor, a
// real URL, and a real document navigation. Opening a story has server-side
// consequences (`applyStoryChoice` writes `session.selectedStory` and persists
// it so a restart resumes there), which is exactly why this is not a click
// handler: the server has to see the request.
//
// The delete control is a sibling of that anchor, not a descendant, because a
// button inside an anchor is invalid HTML and behaves differently across
// browsers. Its tooltip wrapper takes the absolute placement into the card's
// top-right corner, so the button keeps a box the bubble can anchor to, and the
// hit-slop pseudo-element resolves against that same box.
//
// Two facts are gated on live evidence rather than always shown:
//   - `+A −D` only exists when the diff was actually rebuilt. The metadata
//     projection reports zeroes, and "+0 −0" would be a lie, not a placeholder.
//   - the badge itself — see the ordering note in `story-state.ts`.
//
// Three beUI components carry the row: `AnimatedBadge` rolls the state label,
// `Button` supplies the press physics for the destructive control, and
// `Tooltip` replaces the two `title` attributes this row used to lean on. The
// tooltip is the interesting one — the card sets `overflow: hidden` so a
// CSS-positioned bubble would be clipped on three sides, and beUI's portals to
// `document.body` with viewport-fixed coordinates instead. It also gates itself
// on `useHoverCapable()`, so a tap on a touch device does not strand an open
// bubble the way a phantom `:hover` would.

import { ChevronRight, Eye, Trash2 } from "lucide-react";
import { AnimatedBadge, type AnimatedBadgeStatus } from "../../vendor/beui/motion/animated-badge";
import { Button } from "../../vendor/beui/motion/button/base";
import { Tooltip } from "../../vendor/beui/motion/tooltip";
import type { StoryRowView } from "../../../src/payloads";
import { cn } from "../../shared/cn";
import { plural, relativeTime } from "./format";
import { BADGE_CLASS, BLUE_INK, GREEN_INK, RED_INK, storyState, type StoryTone } from "./story-state";
import { StoryHistory } from "./StoryHistory";

/** beUI's semantic status, so the badge picks the icon-free variant it knows. */
const BADGE_STATUS: Record<StoryTone, AnimatedBadgeStatus> = {
  bad: "danger",
  saved: "neutral",
  feedback: "info",
  warn: "warning",
  ready: "success",
};

export interface StoryRowProps {
  story: StoryRowView;
  /** Zero-based position; rendered as a two-digit ordinal. */
  index: number;
  routeBase: string;
  now: number;
  liveEvidence: boolean;
  busy: boolean;
  onRemove: (story: StoryRowView) => void;
  onRestored: (patch: Partial<StoryRowView>) => void;
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-s border-line-soft px-3 first:border-s-0 first:ps-0 max-[460px]:px-2">
      {children}
    </span>
  );
}

/**
 * The scope label, with the raw git command behind it.
 *
 * The row link's tooltip includes this command, so both the full title and
 * scope are available from the same keyboard stop.
 */
function ScopeChip({ scope }: { scope: StoryRowView["scope"] }) {
  return (
    <span
      // Unlike hidden text, the description does not join the row link's
      // accessible name computed from its contents.
      aria-description={scope.command || undefined}
      className="min-w-0 max-w-full break-all rounded-[var(--radius-sm)] bg-fill-3 px-2 py-1 font-mono text-sm tracking-normal text-text"
    >
      {scope.label}
    </span>
  );
}

export function StoryRow({ story, index, routeBase, now, liveEvidence, busy, onRemove, onRestored }: StoryRowProps) {
  const state = storyState(story, liveEvidence);
  // Fallbacks live here, not in the payload: the route ships what the story
  // authored, and an empty field is a presentation question.
  const title = story.title || story.id;
  const summary = story.valid
    ? story.summary || "No summary yet."
    : story.error || "This story file could not be read.";
  const codeStops = Math.max(0, story.steps - story.primers);
  const fileCount = story.liveFiles || story.files;
  const href = `${routeBase}/review?story=${encodeURIComponent(story.id)}`;
  // A code story explains code at one commit: there is no diff to count and
  // nothing to resume reviewing, only a story to read.
  const code = story.subject === "code";

  return (
    <article
      className={cn(
        // `story-row` is the UI-atlas evidence selector for this surface
        // (scripts/capture-ui-atlas.mjs) — a capture only counts as coverage if
        // it can find a real row.
        "story-row relative block overflow-hidden rounded-[var(--radius-island)] border border-line-soft bg-surface-2",
        "transition-[border-color,box-shadow] duration-[var(--motion-duration-fast)] ease-out",
        "focus-within:border-accent-line contrast-more:border-text",
        // Same spatial tier as the page, and no per-row delay: every row lands
        // together, as the vanilla `history-row-in` did.
        "ds-reveal",
      )}
    >
      <Tooltip
        content={story.scope.command ? `${title}\n${story.scope.command}` : title}
        side="top"
        wrapperClassName="block min-w-0"
        className="max-w-[min(52ch,90vw)] rounded-[var(--radius-sm)] border-line-soft bg-surface-3 text-sm whitespace-pre-wrap text-text shadow-signal"
      >
      <a
        href={href}
        className={cn(
          // `group` is on the anchor, not the card: the Resume pill reacts to
          // hovering the link, and hovering the delete button must not make the
          // row look like it is about to open.
          "row-main group relative grid min-h-[132px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4",
          "text-inherit no-underline transition-colors duration-[var(--motion-duration-fast)] ease-out",
          "hover:bg-fill-1 active:bg-fill-2",
          // Inset, because the card clips overflow and an outset ring would be
          // cut off on three sides.
          "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-inset)]",
          "motion-reduce:transition-none",
          "max-[760px]:grid-cols-[24px_minmax(0,1fr)] max-[760px]:gap-3",
        )}
      >
        <span
          aria-hidden="true"
          className="self-start pt-0.5 font-mono text-[0.6875rem] font-semibold tracking-[-.01em] text-[var(--numeral)]"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2 max-[760px]:pe-11 max-[460px]:flex-col max-[460px]:items-start">
              <span className="min-w-0 truncate text-lg font-semibold tracking-[-.01em] max-[460px]:line-clamp-2 max-[460px]:whitespace-normal max-[460px]:leading-[1.28]">
                {title}
              </span>
            <AnimatedBadge
              status={BADGE_STATUS[state.tone]}
              size="sm"
              showIcon={false}
              contentKey={state.label}
              className={cn(
                "ds-story-state h-auto flex-none rounded-[var(--radius-sm)] border-0 px-2 py-1",
                "font-mono text-xs font-semibold tracking-[var(--tracking-kicker)] uppercase",
                BADGE_CLASS[state.tone],
              )}
            >
              {state.label}
            </AnimatedBadge>
          </span>

          <span
            className={cn(
              "line-clamp-2 text-base leading-[1.42]",
              story.valid ? "text-text-2" : RED_INK,
            )}
          >
            {summary}
          </span>

          <span className="mt-1 flex flex-wrap items-center font-mono text-sm text-text-2 max-[460px]:leading-[1.65]">
            {code ? <Fact>Code story</Fact> : null}
            <Fact>
              <b className="text-text tabular-nums">{fileCount}</b> {fileCount === 1 ? "file" : "files"}
            </Fact>
            {liveEvidence && !code ? (
              <Fact>
                <b className={cn("tabular-nums", GREEN_INK)}>+{story.additions}</b>{" "}
                <b className={cn("ms-1 tabular-nums", RED_INK)}>−{story.deletions}</b>
              </Fact>
            ) : null}
            <Fact>
              <b className="text-text tabular-nums">{codeStops}</b> {codeStops === 1 ? "code stop" : "code stops"}
              {story.primers ? ` + ${plural(story.primers, "primer")}` : ""}
            </Fact>
            {story.openComments ? (
              <Fact>
                <b className="text-text tabular-nums">{story.openComments}</b> queued{" "}
                {story.openComments === 1 ? "comment" : "comments"}
              </Fact>
            ) : null}
          </span>

          <span
            className={cn(
              "mt-1 flex flex-wrap items-center gap-2 font-mono text-sm text-text-3",
              "max-[460px]:grid max-[460px]:grid-cols-[minmax(0,1fr)_auto] max-[460px]:items-center max-[460px]:gap-x-2 max-[460px]:gap-y-1",
            )}
          >
            <ScopeChip scope={story.scope} />
            <span className="opacity-55 max-[460px]:hidden" aria-hidden="true">
              ·
            </span>
            <span className="max-[460px]:col-span-2 max-[460px]:row-start-2 max-[460px]:leading-[1.35]">
              {state.detail}
            </span>
            <span className="opacity-55 max-[460px]:hidden" aria-hidden="true">
              ·
            </span>
            <span className="max-[460px]:col-start-2 max-[460px]:row-start-1 max-[460px]:justify-self-start">
              {relativeTime(story.updatedAt, now)}
            </span>
          </span>
        </span>

        <span
          className={cn(
            "story-glance inline-flex min-h-[36px] items-center justify-center gap-2 overflow-hidden rounded-full border border-transparent bg-accent-soft px-3",
            "text-md font-semibold whitespace-nowrap",
            "transition-[background-color,box-shadow,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)]",
            "group-hover:bg-[color-mix(in_srgb,var(--accent-soft)_72%,var(--surface))]",
            "[@media_(hover:hover)_and_(pointer:fine)]:group-hover:-translate-y-px [@media_(hover:hover)_and_(pointer:fine)]:group-hover:shadow-[var(--shadow)]",
            "max-[760px]:col-start-2 max-[760px]:mt-0.5 max-[760px]:justify-self-start",
            "motion-reduce:transform-none motion-reduce:transition-none",
            BLUE_INK,
          )}
        >
          <Eye className="h-3.5 w-3.5 flex-none" strokeWidth={2} aria-hidden="true" />
          {code ? "Read story" : "Resume review"}
          <span
            aria-hidden="true"
            className={cn(
              "story-glance-detail w-0 translate-x-1 overflow-hidden opacity-0",
              "text-[0.6875rem] font-medium whitespace-nowrap text-text-2",
              "transition-[opacity,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)]",
              "[@media_(hover:hover)_and_(pointer:fine)]:group-hover:w-[150px] [@media_(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0 [@media_(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100",
              "group-focus-visible:w-[150px] group-focus-visible:translate-x-0 group-focus-visible:opacity-100",
              "motion-reduce:transition-none max-[760px]:hidden",
            )}
          >
            · {plural(fileCount, "file")} · {plural(codeStops, "stop")}
          </span>
          <ChevronRight
            // The nudge is behind hover:hover — a touch device fires a false
            // hover on tap, so without the gate the chevron jumps on every tap.
            // That gate also makes a motion-reduce override redundant here.
            //
            // The `_` separators are required: they are how Tailwind spells a
            // space inside an arbitrary variant. Written without them the
            // variant emitted `@media (hover:hover)and(pointer:fine)`, which is
            // not a valid media query — Lightning CSS warned and dropped the
            // rule from app.css entirely, so the nudge never fired anywhere.
            className="h-3.5 w-3.5 transition-transform duration-[var(--motion-duration-fast)] ease-out motion-reduce:transition-none [@media_(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-0.5"
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
      </a>
      </Tooltip>

      {/* Outside the anchor, and the handler lives on the button itself — never
          on an ancestor resolving the target with closest(), which is the WebKit
          nested-<svg> bug the recents list was fixed for.

          The tooltip's wrapper span takes the corner placement, so the button
          keeps its own box and the bubble anchors to exactly the 34×34 target.
          Its label duplicates `aria-label`, which is what keeps this honest for
          a reader who never sees the bubble. */}
      <Tooltip
        content="Remove story"
        side="left"
        wrapperClassName="absolute top-3 end-3 z-[2]"
        className="rounded-[var(--radius-sm)] border-line-soft bg-surface-3 text-sm text-text shadow-signal"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          // .97, matching every other small control. A 6% dip made the one
          // destructive button in the app the springiest thing in it — and
          // beUI's own default is .93.
          pressScale={0.97}
          whileHover={undefined}
          disabled={busy}
          aria-busy={busy || undefined}
          aria-label={`Remove ${title}`}
          onClick={() => onRemove(story)}
          className={cn(
            "grid h-[34px] w-[34px] place-items-center",
            "rounded-full border border-transparent bg-transparent text-text-3",
            "after:absolute after:-inset-1 after:content-['']",
            "transition-[border-color,background-color,color] duration-[var(--motion-duration-fast)] ease-out",
            "hover:border-[color-mix(in_srgb,var(--del)_24%,transparent)] hover:bg-del-soft hover:text-danger-text",
            "disabled:opacity-55",
            "contrast-more:border-text",
            "motion-reduce:transition-none",
          )}
        >
          <Trash2 className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
        </Button>
      </Tooltip>

      {/* Sibling of the anchor, like the delete control: a disclosure inside
          the row link would nest interactive content. */}
      <StoryHistory
        storyId={story.id}
        routeBase={routeBase}
        now={now}
        videoExport={story.valid && story.steps > 0 ? { href: `${href}&export=video`, title } : undefined}
        onRestored={onRestored}
      />
    </article>
  );
}
