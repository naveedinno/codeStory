# Design Memory

## Approved Direction — "Signal / Thread-Ledger" (option 3b)

Chosen by the owner (July 2026), superseding the earlier Apple-HIG / graphite direction. An instrument-grade, developer-native evolution of the original graphite + system-blue UI: colder **ink** surfaces, one electric **signal-blue** accent, mono-typed data everywhere, and oversized **Space Grotesk** step numerals that double as the "thread" navigation nodes.

The imported mockup (source of truth for values and per-screen layouts) was removed from the tree in October 2026; it is still in git history at `.claude-design/lab/diffstory-ds/` (last present in commit `2041d10`), and its `readme.md` is the full design brief.

- **Workflow:** Scope → Read → Resolve → Decide. Git provides evidence; the story provides reading order; the review loop records human judgment.
- **Surfaces = islands:** app chrome floats as rounded panels (`--radius-island` 26px) on a deeper page background, separated by 12px gutters. Flat, no gradients, no glass; shadow only on overlays.
- **The thread:** a 2px vertical line connects step numerals — solid accent up to the current position, `--thread-dim` beyond. It is the brand mark made structural.
- **Read views:** raw diff (`AllFilesDiff`) is the ground truth and is kept as-is; the guided walkthrough (`CodeWalkthrough`) is a one-step-at-a-time filmstrip with a horizontal numeral thread. The Atlas map overview was cut — the filmstrip IS the overview.
- **Feedback = Notes (one-shot, no rounds):** note → send. No versioned rounds/verdicts; the agent rewrites, the story regenerates, the next review starts clean. (This replaces the old `review-state.ts` rounds model — a later port sub-project.)

## Brand Tone

- **Aim for:** Minimal, premium, calm, precise, developer-native. No hype, no exclamation points, no emoji.
- **Casing:** sentence case everywhere except uppercase mono kickers ("READING ORDER", "THE STORY OF THIS CHANGE").
- **Avoid:** pill-heavy chrome, warning color on neutral actions, duplicated identity, equal emphasis on every control, decorative progress metaphors, glass/gradients.

## Color

- One interactive accent — **signal blue** `#3fb2ff` (dark) / `#0072d6` (light). Semantic color belongs to evidence + state only: amber = attention/blockers, green = add/ready, red = del/errors, blue = follow-up info.
- Neutral actions (Reload) never borrow warning color. Use `--text-2` (muted), not faint text, for repo/base metadata.

## Typography

- **IBM Plex Sans** for UI text; **IBM Plex Mono** for code, refs, hashes, data, and uppercase kickers (tracking `--tracking-kicker`); **Space Grotesk** for oversized numerals and page display titles only. Hashes use slashed-zero numerals; totals of 10,000 or more use locale grouping while smaller counts keep their compact form.
- Numerals as structure: zero-padded ("01"–"06"), active = accent, inactive = `--numeral-dim`. Oversized numerals are reserved for steps; sub-step beats use small segment dots, never a second counter.

## Layout & Spacing

- Comfortable density, hierarchy-first — not marketing spacing. 48px chrome rows, 316px rail (`--ds-rail-width` / `--rail-width`).
- Controls round at 8/12/18px (`--radius-sm`/`--radius`/`--radius-lg`) to harmonize with 26px islands. Thin 1px hairlines (`--line`, `--line-soft`). Page primary actions use `--control-h-lg` (40px); bar and card actions use `--control-h` (34px).
- Spacing follows the 4px scale (`--sp-1` through `--sp-10`: 4, 8, 12, 16, 20, 24, 32, 40px). Derive nested control radii from their container radius minus the inset; retain exceptions only where target size or optical alignment requires them.

## Accessibility Rules (retained from HIG rigor)

- Compact interactive targets ≥ 44×44px. Controls keep stable accessible names when labels collapse to icons.
- Popovers/drawers sync ARIA state and return focus on close; the compact sidebar makes covered content inert.
- 3px `--accent-soft` focus-visible ring (box-shadow, no outline). **WCAG AA (4.5:1) in light and dark** — note: `--text-3` is lifted from the mockup's dim `#5c6675`/`#8b95a5` to `#8792a2`/`#5f6976` so the faint tier still clears AA on elevated surfaces (don't sync it back down). Verified by `test/render-page.test.mjs`.
- Respect reduced motion, reduced transparency, increased contrast.

## Repo Conventions

- **Canonical tokens live in `src/theme.ts` `sharedTokens()`** (the 3b block for both schemes + `@font-face`). Page-local names (`--app-*`, `--md-*`, `--panel*`, story-picker/picker/nav vars) ALIAS onto the canonical tokens — keep aliases one-directional (name → canonical) so no `var()` cycle forms.
- **Fonts are self-hosted** woff2 under `assets/fonts/`, copied to `dist/assets/fonts/` by `scripts/build-browser-assets.mjs`, served same-origin via the `/assets/fonts/*.woff2` route in `src/server.ts` (satisfies the `font-src 'self'` CSP — do not add Google Fonts).
- Review markup is server-rendered in `src/render.ts`; review CSS + client JS in the inline string in `src/page-assets.ts`; other routes in `src/picker.ts`, `src/change-page.ts`, `src/story-picker.ts`.
- Edit `src/` only; `dist/` is generated by the build and committed. After editing the client JS template (`PAGE_JS`), `node --check` the emitted JS.
- The app draws its own inline stroke SVGs; match icon stroke to the adjacent text. Use Lucide at stroke width 2 beside semibold labels, 1.5 beside small medium-weight chips, and retain 1.25 for the 16px rail glyphs. The old blue rounded-square app icon is retired in the design (use the Thread-Path mark + wordmark) — brand swap is a later sub-project.

## Port Status (as of 2026-07-17)

**Done (shipped on `main`, both themes):**
- **Foundation** — canonical 3b token layer + self-hosted woff2 across all routes. Spec: `docs/superpowers/specs/2026-07-17-diffstory-signal-foundation-design.md`.
- **Islands** — `/review` shell (chrome, ledger, rail, main/stage) as floating `--surface` islands on the ink page. Spec: `…-islands-review-design.md`.
- **Brand** — retired the blue app-icon square; Thread-Path mark + wordmark throughout; favicon retinted to signal blue.
- **Filmstrip** — CodeWalkthrough: centered numeral stage + bottom numeral thread + ghost prev/next, replacing the beat-tree rail. Spec: `…-filmstrip-walkthrough-design.md`.
- **Content routes** — WorkspacePicker (picker.ts), ChangeScope (change-page.ts), ReviewHistory (story-picker.ts): Space Grotesk display headings, flat islands (now 26px), mono via `--font-mono`, on-accent primary buttons, the wordmark + "the story of this change" kicker, and the Scope→Read→Resolve→Decide stage numerals.
- **Fidelity sweep (2026-07-18)** — removed the pre-3b remnants across all routes + shared chrome (nav.ts, theme.ts, progress-ui.ts, diff-assets.ts): `--on-accent` everywhere (no `#fff` on accent), 1px hairlines (no `.5px`), 3px `--accent-soft` focus rings (no outlines, no 4px color-mix), canonical amber/red (no Apple systemOrange / M3 purple literals), mono kickers at `--tracking-kicker`, token radii (no 999px pills except true dots/pins), loaded font weights only (400/500/600/700), motion tokens, flat surfaces (glass/backdrop-filter and decorative gradients removed; nav is a flat floating island), zero-padded numerals ("01"), ChangeScope stage strip as bare Space Grotesk numerals + 2px thread, filmstrip thread fill anchored to the active numeral, ghost cards labeled with the target step's file.

**Done (2026-07-18, owner-approved):**
- **Notes / one-shot model** — versioned rounds + verdicts removed. `review-state.ts` is now a slim module (scope key + diff fingerprint + feedback health); `/api/review/verdict`, `/api/review/checkpoint`, the review timeline, "Since review" mode, snapshots, and approval gating are gone from server, render, and client. Per-note statuses survive (open → addressed → resolved via accept-fix / re-note, matching the mockup FeedbackThread); trust/coverage and story-freshness stay as evidence. History cards show note-based states ("In review" / "Current"); nothing says Round or Decide anymore. The old `review-state.json` is simply ignored.
- **SystemStates** — ProgressPanel narrated loading (thread of milestone nodes with accent fill + mono log-line plan items), ChangeScope clean-tree island, shimmer skeletons on lazy step panels, mono error chips.
- **Rail numerals + storyless escape** — rail step cards use bare Space Grotesk numerals (no circle badges); storyless Story view keeps an "All files →" thread bar so it is never a dead end.

Concentric children derive their radius from the enclosing island minus its inset. Nested track segments subtract the track padding again; these derived radii are deliberate exceptions to the standalone control scale.
