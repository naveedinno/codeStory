# beUI (vendored)

React component source vendored from **[starc007/ui-components](https://github.com/starc007/ui-components)**
(the source repo behind [beui.dev](https://beui.dev)), MIT licensed. See `LICENSE`
for the upstream copyright notice, which is reproduced verbatim.

| | |
|---|---|
| Upstream | `starc007/ui-components` |
| Commit | `b3966e2604a8e43537a7b78fa3103a6fd72d1388` (`main`) |
| Vendored | 2026-08-09, re-vendored broadly 2026-08-11 |
| Files | 113 — 111 from upstream, plus 2 codeStory-local stand-ins |

Every vendored file carries a header naming its upstream path:

```
// Vendored from starc007/ui-components — components/motion/tabs.tsx (MIT)
```

## What is here

74 files were vendored during the React rewrite and pruned to 6 once the five
surfaces were finished. beUI is now being adopted much more broadly, so the tree
holds the components that plausibly map to a keyboard-first code-review tool,
plus the transitive closure of their in-repo imports:

```
motion/          89 files — overlays, inputs, tabs, motion primitives, table/, swap/
agents/          25 files — the agent-surface set: approvals, tool results, diffs, chat
lib/              7 files — cn(), easing tokens, hooks, and the two stand-ins below
```

Two files are **not** from upstream. They are written here to replace a
dependency this repo refuses, and they say so in their own headers:

```
lib/use-theme.ts          stands in for next-themes; bridges to src/theme.ts
lib/use-smooth-scroll.ts  stands in for lenis; the native-scroll half of
                          motion/smooth-scroll.tsx, which is not vendored
```

Deliberately **not** vendored, as decorative or wrong for this product:
`shader-background`, `cylinder-carousel`, `tilt-card`, `knockout-bracket`,
`knockout-wheel`, `prediction-market`, `wallet-card/`, `availability-scheduler/`,
`infinite-masonry`, `parallax`, `chromatic-text-reveal`, `bloom-menu`,
`not-found/`, `image-generation`, `smooth-scroll` (see modification 3).

`test/vendor-beui.test.mjs` asserts this list is exact, that the subtree is
self-contained, and that the live-region table below is still accurate. Adding a
component is therefore a deliberate act that fails a test until it is written
down — which is the moment to check what the new file announces.

## Live regions: the adoption checklist

Read this before adopting any component below.

A baked-in `aria-live` / `role="status"` / `role="log"` / `role="alert"` is
actively harmful in a diff reviewer. A live region on a diff viewport announces
the entire diff body on every lazy load, context expansion and split↔unified
toggle. The progress panel has six tests asserting what must *not* announce, and
`todo-list` will read a whole plan aloud on every update.

This used to be the record of why components were rejected. Now that they are
being adopted, it is a checklist: **adopting one of these means wrapping it to
strip or gate the live region — never editing the vendored file**, because the
next update would silently undo that and nothing would catch it.

Measured across all 113 files at the pinned commit. Every file not listed here
carries none, and the test enforces that too.

| Component | Carries | Line | Notes |
|---|---|---|---|
| `agents/file-diff.tsx` | `aria-live="polite"` | 214 | **on the diff viewport** (`data-slot="file-diff-viewport"`) — the worst case for this product |
| `agents/code-block.tsx` | `aria-live={streaming …}`, `role={streaming ? "log" …}` | 159–160 | conditional, on the scroll viewport; safe only with `streaming` unset |
| `agents/tool-result.tsx` | `aria-live="polite"` + `role="log"` | 312–313 | |
| `agents/message-scroller.tsx` | `aria-live="polite"` + `role="log"` | 441–442 | plus `aria-relevant="additions text"` on the scroll content |
| `agents/todo-list.tsx` | `aria-live="polite"` | 316 | on the `<ol>`, so the whole plan re-announces |
| `agents/ai-sidebar.tsx` | `aria-live="polite"` | 837 | an `sr-only` announcer span — the cheapest one here to neutralise |
| `agents/streaming-response.tsx` | `aria-live={announce …}` | 167 | conditional; `announce` off means `"off"` |
| `agents/agent-activity/index.tsx` | `role="status"` | 201 | |
| `agents/loading-states/agent-progress.tsx` | `role="status"` | 63 | |
| `agents/loading-states/reasoning-text.tsx` | `aria-live="polite"` + `role="status"` | 237–238 | |
| `motion/dynamic-island.tsx` | `role="status"` + `aria-live="polite"` | 154–155 | |
| `motion/loader.tsx` | `role="status"` | 64 | |
| `motion/animated-toast-stack.tsx` | `aria-live="polite"` | 282 | `aria-atomic="false"`, so only new toasts announce |
| `motion/button/stateful.tsx` | `aria-live="polite"` | 205 | |
| `motion/attachment-upload.tsx` | `role="status"` ×3 | 196, 213, 238 | per-item complete / removing / failed badges, each `aria-label`led |
| `motion/pull-to-refresh.tsx` | `aria-live="polite"` | 465 | `aria-atomic="true"` on the indicator |
| `motion/otp-input.tsx` | `aria-live="polite"` | 367 | the validation message only |
| `motion/slide-action-button.tsx` | `aria-live="polite"` | 153 | the completion label only |
| `motion/input.tsx` | `role="alert"` | 212 | the error message only — assertive, so it interrupts |
| `motion/feedback-widget.tsx` | `role="alert"` | 344 | the error view — assertive |

The last six are narrow: they announce one short string on an explicit user
action, which is what a live region is for. The first eleven wrap content, and
those are the ones that need a wrapper.

`motion/context-menu.tsx` has a dynamic `role={role}` at line 549 that looks like
a carrier and is not — the prop is typed to
`"menuitem" | "menuitemcheckbox" | "menuitemradio"`.

## Other reasons to look before adopting

**Semantics that may not match.** `morphing-tabs` collapses selection and
disclosure into one state, which is wrong for the scope picker, where one
segment is a real `<a href>` and two are disclosures. `table/` brings sorting,
resizing and selection. `swipeable-list` puts a destructive, undo-less delete
behind a swipe.

**Placement is specified behaviour.** The change page's ref combobox has an exact
anchoring rule; `select` / `popover` own their own placement via
`popover-position.ts`.

The review page uses no beUI: its interaction layer was ported wholesale rather
than rebuilt, because the ordering of its delegated click table *is* the
behaviour.

## Why vendored rather than installed

beUI is distributed as copy-in source, not as an npm package — there is nothing
to install. Vendoring also lets us de-Nextify the components once, in place, and
keep the result under review like the rest of the codebase.

## Layout

Upstream's `components/` prefix is dropped; everything else keeps its shape.
Upstream's `@/components/...` and `@/lib/...` path aliases are rewritten to
relative imports so this tree resolves with no tsconfig `paths` entry.

## Deliberate modifications

Considered divergences from upstream, not accidents. Each is also commented at
the site of the change.

1. **`'use client'` directives removed** — every file. There is no server
   component boundary here; the whole client bundle is client-side.

2. **`next-themes` replaced by `lib/use-theme.ts`.** Written for this repo, it
   exposes the same `{ theme, resolvedTheme, systemTheme, setTheme }` surface but
   reads and writes codeStory's own theme plumbing: the `ds-theme` localStorage
   key, `data-theme` / `data-theme-mode` on `<html>`, `html.style.colorScheme`,
   the `meta[data-ds-theme-color]` tag, and the `ds-theme-change` document event.
   That contract is defined by `src/theme.ts`, which stays the canonical owner —
   its inline pre-paint bootstrap script still performs the first write. The two
   can coexist on one page; each listens for the other's changes.
   Only `motion/theme-toggle.tsx` imports it.

3. **`lenis` not adopted**, and `motion/smooth-scroll.tsx` not vendored.
   Hijacked smooth scrolling is hostile in a diff viewer. But `scroll-progress`
   and `scroll-to` both import `useSmoothScroll` from it, and that hook already
   has a complete native path — upstream calls it the "no-provider fallback" and
   uses it for reduced motion. `lib/use-smooth-scroll.ts` is that path, lifted:
   same `scrollY` / `progress` / `velocity` motion values fed by a native
   `scroll` listener, same `scrollTo`, minus the `lenis` field (which had no
   consumer) and minus the lerped provider. The two components import it unchanged
   otherwise. What they lose is the Lenis smoothing, which is the point.

4. **`shiki` not adopted.** `src/highlight.ts` already highlights synchronously
   in this app's palette, and shiki is a multi-megabyte async WASM highlighter.
   `agents/agent-code.tsx` was the only importer, and three components read its
   tokens (`agent-code` itself, `code-block`, `file-diff`), so it grew two seams
   in place of the highlighter:

   - `setAgentCodeTokenizer(fn)` — install a tokenizer once, app-wide, and
     `useAgentCodeTokens()` keeps working for every consumer. The tokenizer may
     be sync or async. Nothing is installed by default.
   - `highlightedHtml` on `AgentCode` and `AgentCodeLine` — hand a component
     markup that is already highlighted, e.g. straight from `src/highlight.ts`.
     The caller owns escaping; `src/highlight.ts` escapes.

   With neither seam used, these components render plain, unhighlighted text
   rather than breaking.

5. **`motion/theme-toggle.tsx` rendered on the first paint** rather than gating
   on a `mounted` effect, because our hook can read what the pre-paint bootstrap
   already wrote. `mounted` stays in `useThemeToggle()`'s return shape as a
   constant so callers still typecheck against upstream.

Not modified: no `next/image`, `next/link`, `@vercel/*`, analytics or
beui.dev-site-specific imports appear anywhere in this subtree, so there is
nothing to strip. `test/vendor-beui.test.mjs` asserts that stays true.

## Runtime dependencies

Across all 113 files: `react`, `react-dom`, `motion` (imported as
`motion/react`), `clsx`, `tailwind-merge`, `lucide-react`, and
`@tanstack/react-virtual` (only `motion/table/index.tsx`). All seven are already
in `package.json`; vendoring this set added no new package.

## Styling: the shadcn names, and the one that lies

This section previously claimed the `@theme` bridge supplies the shadcn-style
variable names beUI reaches for. For most of the rewrite that was false — the
bridge emitted the Signal palette (`surface`, `text`, `line`, `accent`, `fill-1`,
…) and nothing else, so `text-foreground`, `bg-card`, `ring-ring` and friends
compiled to nothing. A component styled entirely with them rendered unstyled
rather than wrong, which is easy to miss on a dark background, and any component
pairing them with `outline-none` shipped with **no focus indication at all**.

**That is fixed.** `SHADCN_ALIASES` in `scripts/build-theme-css.mjs` now maps the
shadcn names onto Signal values, so a vendored component is legible and
keyboard-safe out of the box:

| shadcn | Signal | | shadcn | Signal |
|---|---|---|---|---|
| `foreground` | `text` | | `muted` | `fill-1` |
| `background` | `bg` | | `muted-foreground` | `text-2` |
| `card` / `card-foreground` | `surface` / `text` | | `destructive` | `del` |
| `popover` / `popover-foreground` | `surface-2` / `text` | | `destructive-foreground` | `on-accent` |
| `primary` / `primary-foreground` | `accent` / `on-accent` | | `input` | `line` |
| `secondary` / `secondary-foreground` | `fill-2` / `text` | | `ring` | `accent-line` |

`on-accent` serves as the foreground for both `primary` and `destructive`
because it is the ink that sits on a saturated fill, and it inverts with the
theme (`#06121c` dark / `#ffffff` light) on the same axis as `--accent` and
`--del` do.

**`accent` is the exception, and it lies.** shadcn means a quiet hover fill by
it; Signal means signal blue. `--color-accent` is bound to Signal's, and ~20 live
call sites across `client/surfaces/` depend on that (`bg-accent`, `text-accent`,
`bg-accent-soft`, `hover:bg-accent-hi`), so the Signal meaning wins and the
collision stands. **A vendored component writing `bg-accent` for a subtle hover
gets a bright blue block** — override it at the call site. `accent-foreground`
*is* mapped, to `on-accent`, so `bg-accent text-accent-foreground` at least lands
on legible ink.

Two things this does not fix:

- **Raw `var()` references.** `@theme` defines `--color-foreground`, not
  `--foreground`. `lib/text-shimmer.ts` builds its gradient from
  `var(--muted-foreground)` / `var(--foreground)` inside an arbitrary value,
  which still resolves to nothing. The caller has to declare those two
  properties locally — `client/surfaces/progress/ActivityText.tsx` does exactly
  that with `[--foreground:var(--pp-text)]
  [--muted-foreground:var(--pp-faint)]`, and is the pattern to copy.
- **Anything outside the colour namespace.** A vendored component can still reach
  for a spacing, radius or font key this bridge does not emit.

Beyond that, styling assumes Tailwind v4.

**A note on bundle size.** Vendoring adds nothing to the JS bundles until
something imports it — esbuild follows the import graph. Tailwind does not:
`client/styles.css` declares `@source "./**/*.{ts,tsx}"`, which is path-based, so
every class name in this tree is compiled into `dist/client/app.css` whether or
not the component is used. Re-vendoring took that file from 218.6 kB to 265.1 kB
(38.2 kB → 45.3 kB gzipped), and supplying the shadcn aliases above added a
further 25.2 kB to 291.8 kB (45.5 kB → 47.6 kB gzipped, +4.6%) — 83 utility
classes that previously compiled to nothing now emit rules, all of them in this
tree. Most of it becomes legitimate as the surfaces adopt these components; if a
large part of the tree is still unused once adoption settles, narrowing the
`@source` glob is the lever.

## Updating, or adding a component

Re-fetch from the pinned commit above, de-Nextify per the list, and add the file
to the allowlist in `test/vendor-beui.test.mjs`. **Check it for a live region
first** — the table above is the measured record at this commit, and a vendor
update can add more. The test compares the whole tree against that table in both
directions, so a component that gains a live region fails loudly rather than
shipping silently. Do not edit vendored files for styling or for accessibility;
prefer wrapper components in `client/` so the next update stays mechanical.
