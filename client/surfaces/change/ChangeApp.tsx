// The scope picker — "Choose what to review".
//
// Two things about this surface are worth knowing before changing it.
//
// FIRST: it is also the review page's error surface. `reviewScreen()` falls
// through to `changeScreen(…, notice)` whenever the selected story is missing
// or will not parse, and `payload.notice` is then the ONLY explanation the
// reviewer ever sees for why they are looking at a scope picker instead of
// their review. It renders above the fold, in the amber tone this app reserves
// for "this needs your attention", and it names the way forward. Losing it
// turns a broken story into a blank page.
//
// SECOND: it must not animate on arrival. Every scope change here is a full
// navigation, so a page-level entrance would replay on every keystroke-driven
// ref change and make the surface feel like it is fighting the user. That is
// why there is no `ds-reveal` on this page (the repo picker uses one), no
// animated counters on the ledger, and no layout animation on the segments:
// `surface-inventory.md` ranks the absence at #8 in "At risk" and the vanilla
// stylesheet had three `doesNotMatch` assertions guarding it. The only motion
// on the surface is the ref listbox's entrance and the press feedback on
// controls.
//
// That is also why this file imports no beUI at all. `AnimatedNumber` and
// `NumberTicker` animate on mount unconditionally (`fromRef.current = 0`,
// `initial={{ y: 0 }}`), so the ledger below would count up from zero on every
// scope change — and every scope change here is a full page load. The obvious
// alternative, `ActionSwapText`, is for a value that changes in place, and
// nothing on this surface does: the ledger is rendered from the payload and the
// payload only ever arrives with the document. A static number is the honest
// one. `scroll-reveal` and `text-reveal` are out for the same reason.

import { Fragment } from "react";
import { Nav, navActionClass } from "../../shared/nav";
import { cn } from "../../shared/cn";
import { History } from "lucide-react";
import type { ChangePayload } from "../../../src/payloads";
import { FileSummary } from "./FileSummary";
import { ReloadButton, ScopeCard } from "./ScopeCard";
import { formatCount, plural, scopeQuery, totals } from "./format";

const STAGES: [string, string][] = [
  ["01", "Scope"],
  ["02", "Read"],
  ["03", "Resolve"],
  ["04", "Decide"],
];

function Metric({ value, label, tone }: { value: string; label: string; tone?: "add" | "del" }) {
  return (
    <span className="flex min-w-[76px] flex-col gap-1 border-s border-line-soft px-3.5 py-1 first:border-s-0 contrast-more:border-text">
      {/* `--diff-*-text`, not `--add`/`--del`: those two are the rail-and-fill
          hues, and the light theme deliberately ships darker ink variants for
          small text (see the comment above the light block in src/theme.ts).
          Using the rail hue here read at 3.83:1 in light; the ink variant reads
          5.47:1. In dark the two tokens are the same value, so nothing moves. */}
      <b
        className={cn(
          "font-display text-lg leading-none font-bold tabular-nums",
          tone === "add" ? "text-diff-add-text" : tone === "del" ? "text-diff-del-text" : "text-text",
        )}
      >
        {value}
      </b>
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

function ReviewPath() {
  return (
    <div
      role="list"
      aria-label="Review workflow"
      className={cn(
        "mt-5 flex items-center  py-2.5",
        "font-mono text-[0.625rem] font-medium tracking-[var(--tracking-kicker)] text-text-3 uppercase contrast-more:text-text",
        "max-[600px]:mt-4 max-[600px]:w-full max-[600px]:py-2 contrast-more:border-text",
      )}
    >
      {STAGES.map(([numeral, label], index) => {
        const active = index === 0;
        return (
          <Fragment key={numeral}>
            {index > 0 ? (
              <b
                aria-hidden="true"
                className={cn(
                  "mx-3 h-px min-w-[18px] flex-1 bg-line-soft max-[600px]:mx-2 max-[600px]:min-w-[10px]",
                  index === 1 && "bg-gradient-to-r from-accent-line to-line-soft",
                )}
              />
            ) : null}
            <span
              role="listitem"
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap",
                active ? "text-accent-text max-[600px]:gap-2 max-[600px]:text-xs" : "max-[600px]:flex-none max-[600px]:gap-0 max-[600px]:text-[0rem]",
              )}
            >
              {/* An upcoming stage inherits the row's --text-3 rather than
                  taking --numeral-dim. That token is tuned for the review
                  page's decorative step numerals, and on this rail it read
                  1.42:1 in light / 1.93:1 in dark — while the LABEL beside it
                  sat at --text-3 and was perfectly legible. Numeral and label
                  are one wayfinding unit ("02 READ"); below 600px the label is
                  collapsed to text-[0rem] and the numeral is the only marker
                  left, so it is the half that cannot afford to be invisible. */}
              <i
                className={cn(
                  "font-display text-sm leading-none font-bold tracking-[var(--tracking-numeral)] not-italic max-[600px]:text-[0.8125rem]",
                  active && "text-accent-text",
                )}
              >
                {numeral}
              </i>
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function ChangeApp({ payload }: { payload: ChangePayload }) {
  const { repoName, routeBase, base, head, files, notice, scopeNotice } = payload;
  const total = totals(files);
  const diffHref = `${routeBase}/diff${scopeQuery(base, head)}`;

  return (
    <>
      <Nav
        home="/repos"
        crumbs={[{ label: repoName, href: `${routeBase}/change` }, { label: "Scope" }]}
        right={
          <>
            <ReloadButton />
            <a className={navActionClass} href={`${routeBase}/explain`}>
              Explain code
            </a>
            <a className={navActionClass} href={`${routeBase}/stories`} aria-label="Review history">
              <History className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
              <span className="max-[560px]:hidden">Review history</span>
            </a>
          </>
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[960px] px-6 pt-6 pb-10 max-[600px]:px-3.5 max-[600px]:pt-5 max-[600px]:pb-[26px]"
      >
        <header className="mb-5 max-[600px]:mb-4">
          <div className="m-0 flex items-center justify-between gap-8 max-[600px]:block">
            <div>
              <p className="m-0 mb-2 font-mono text-xs font-medium tracking-[var(--tracking-kicker)] text-accent-text uppercase">
                Review session
              </p>
              <h1 className="m-0 font-display text-[1.625rem] font-bold tracking-[-.02em] text-balance max-[600px]:text-2xl">
                Choose what to review
              </h1>
              <p className="m-0 mt-2 max-w-[62ch] text-sm leading-[1.45] text-pretty text-text-2 contrast-more:text-text">
                Set the exact Git scope, confirm the changed files, then start with the real diff. A guided story stays
                optional.
              </p>
            </div>
            {/* The ledger is supporting detail; below 980px it makes way for the
                scope controls rather than wrapping under the heading. */}
            <div
              aria-label="Current scope summary"
              className="flex flex-none items-center text-[0.78125rem] text-text-2 contrast-more:text-text max-[980px]:hidden"
            >
              <Metric value={formatCount(files.length)} label={plural(files.length, "file", "files")} />
              <Metric value={`+${formatCount(total.added)}`} label="added" tone="add" />
              <Metric value={`−${formatCount(total.removed)}`} label="removed" tone="del" />
            </div>
          </div>
          <ReviewPath />
        </header>

        {notice ? (
          <div className="mb-4 rounded-[var(--radius-lg)] border border-amber bg-amber-soft px-4 py-3 [overflow-wrap:anywhere] text-base leading-[1.5] text-text contrast-more:border-text">
            <b className="font-semibold">That review could not be loaded.</b> {notice} Start the review below,
            then generate a fresh story from the Story tab.
          </div>
        ) : null}

        {scopeNotice ? (
          <div className="mb-4 rounded-[var(--radius-lg)] border border-amber bg-amber-soft px-4 py-3 [overflow-wrap:anywhere] text-base leading-[1.5] text-text contrast-more:border-text">
            {scopeNotice}
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5">
          <ScopeCard payload={payload} />
          <FileSummary files={files} routeBase={routeBase} diffHref={diffHref} />
        </div>
      </main>
    </>
  );
}
