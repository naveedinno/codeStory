# Color findings
Scope inspected: canonical palette in src/theme.ts sharedTokens() (dark default :root and :root[data-theme="light"]), generated bridge client/generated/theme.css, all six surfaces (picker, stories, change, review, progress, explain), client/shared chrome, client/styles.css, client/shared/shared.css, client/surfaces/review/review.css (1,605 lines), vendored beUI usage seams, DESIGN_MEMORY.md color rules, test/theme.test.mjs, runtime.md and its dark/light screenshots at 1440/768/375. Every foreground/background pair below was measured with a WCAG 2 script from the cited token values, resolving rgba and color-mix composites over the stated surface. The project's own gate is WCAG AA (4.5:1 normal text, 3:1 large text and UI graphics), per DESIGN_MEMORY.md:40 and test/theme.test.mjs:127.
Not inspected: APCA Lc values for the uncovered pairs in COL-1 to COL-4 (used the project's WCAG gate; the pairs fail WCAG, so the APCA tiebreaker cannot pass them), rule 14 color across cultures (single locale ships, no locale catalogue in brief, so no load-bearing meaning to verify per locale), Mermaid diagram internals (handed to VIS/TYP per brief), forced-colors and prefers-contrast runtime captures (none exist in runtime.md; COL-6 and COL-7 are code findings with that limit stated)
Score: 2/4, core text and diff inks pass in both themes, but light-theme active and emphasis pairs fail systemically

## Findings

### COL-1: Light active-state text uses accent-hi on accent-soft at 3.24:1
- Rule: 9 Measure the rendered pair; 10 Dark mode is tuned, not mirrored
- Severity: HIGH (Trigger: Body or control text whose rendered contrast pair fails its required ratio; A11Y classifies the requirement, COL owns the pair)
- Confidence: high
- Locations: `client/surfaces/review/review.css:49`, `client/surfaces/review/review.css:50`, `client/surfaces/review/review.css:248`, `client/surfaces/review/review.css:1486`, `client/surfaces/review/review.css:1505`
- Evidence: `--md-on-secondary-container:var(--accent-hi)` (review.css:50) on `--md-secondary-container:var(--accent-soft)`. Light accent-hi is `#0086f0` (src/theme.ts:191) on the accent-soft composite over surface `#e6f1fb` measures 3.24:1, under the 4.5:1 normal-text threshold. Live text cases: active file-filter pill `.ds-filefilters button.is-active` (review.css:248), active line-wrap toggle `.ds-linewrap-toggle.is-active` (review.css:1486), active read-aloud label `.ds-dock .ds-readaloud-primary.is-active` (review.css:1505). Dark measures 9.67:1, so only light fails. The file already documents the cause at review.css:56-62: in light, "hi" is brighter exactly where ink needs to be darker. Earlier tab and intro-card rules using the same alias are overridden later (review.css:1178, review.css:1207, review.css:1497) and are not counted here.
- Fix: In the alias block of client/surfaces/review/review.css, point `--md-on-primary-container` and `--md-on-secondary-container` at `var(--accent-text)`, the canonical small-text ink. Measured on the same tint: 5.84:1 light, 7.47:1 dark. Change the alias only; do not edit client/generated/theme.css.
- Why: Active filter, wrap and read-aloud labels are core review controls used constantly. At 3.24:1 the current state is hard to read in the light theme, and the alias makes every future container label fail the same way.
- Verified: yes (WCAG script on cited token values, composites resolved; same method as test/theme.test.mjs:44-48)
- Systemic: yes

### COL-2: Syntax colors fail on word-level diff emphasis backgrounds in both themes
- Rule: 9 Measure the rendered pair
- Severity: HIGH (Trigger: Body or control text whose rendered contrast pair fails its required ratio; A11Y classifies the requirement, COL owns the pair)
- Confidence: high
- Locations: `src/theme.ts:165`, `src/theme.ts:186`, `client/surfaces/review/review.css:1112`, `src/highlight.ts:76`
- Evidence: `renderToken` paints one span with both classes, for example `tk-c changed` (src/highlight.ts:76-77), so syntax ink sits on `--add-emphasis-bg` / `--del-emphasis-bg` (review.css:1112-1113). The light block (src/theme.ts:186-205) never redefines the emphasis tokens, so light inherits the dark `rgba(18,150,111,.38)` / `rgba(224,68,94,.36)`. Measured on the add-emphasis composite: light `--tk-k` 4.31:1, `--tk-t` 3.72:1, `--tk-f` 3.94:1, `--tk-s` 3.62:1, `--tk-n` 3.79:1, `--tk-c` 4.00:1, all under 4.5:1; delete-emphasis is 3.51:1 to 4.17:1. Dark add-emphasis: `--tk-c` 2.88:1, `--tk-k` 4.12:1, `--tk-f` 4.37:1, `--tk-n` 4.45:1. Plain code text `--text` passes on the same backgrounds (7.99:1 dark, 10.55:1 light), and test/theme.test.mjs:131-153 verifies syntax only on plain and line-tint backgrounds, not emphasis. The changed highlights are visible in screens/diff-1440x900-light.png.
- Fix: In `sharedTokens()` in src/theme.ts, add light values for `--add-emphasis-bg` and `--del-emphasis-bg` (lighter tints of the same hues) and lower the dark emphasis alpha or darken `--tk-c`, keeping hue and changing lightness only. Remeasure every `--tk-*` plus `--text` on both emphasis composites to at least 4.5:1, then regenerate the bridge with `node scripts/build-theme-css.mjs`. Do not hand-edit the generated file.
- Why: The diff is the constant core loop. The exact words that changed are the words a reviewer must read, and they are the lowest-contrast code text in the app.
- Verified: yes (WCAG script on cited token values, two-layer composites resolved; pair class nesting read in src/highlight.ts)
- Systemic: yes

### COL-3: Film-dock step numerals fail in light (inactive 3.89:1, active 4.23:1)
- Rule: 9 Measure the rendered pair; 5 A token only in its role
- Severity: HIGH (Trigger: Body or control text whose rendered contrast pair fails its required ratio; A11Y classifies the requirement, COL owns the pair)
- Confidence: high
- Locations: `client/surfaces/review/review.css:1278`, `client/surfaces/review/review.css:1284`, `src/theme.ts:202`
- Evidence: `.ds-filmnode-num` is the only visible label of its button (`.ds-filmnode-label` is visually hidden, review.css:1279). Inactive color is `color-mix(in srgb,var(--text-2) 72%,var(--numeral-dim))`; with light `--numeral-dim:#c3ccd9` (src/theme.ts:202) the rendered mix on the dock `--surface-2` measures 3.89:1. Active uses raw `color:var(--accent)` (review.css:1284), `#0072d6` on `--surface-2`, 4.23:1. The numerals are 17px bold, under the 18.5px bold large-text threshold, so 4.5:1 applies. Dark passes (inactive 7.30:1, active 7.81:1). The change surface already rejected this token for the same reason at client/surfaces/change/ChangeApp.tsx:100-107 (1.42:1 light / 1.93:1 dark for numeral-dim alone).
- Fix: In client/surfaces/review/review.css, paint inactive numerals with `var(--text-2)` (6.27:1 on `--surface-2` light, 11.25:1 dark) and the active numeral with `var(--accent-text)` (5.90:1 light, 8.78:1 dark). Drop the `--numeral-dim` mix from this rule.
- Why: The dock is visible through the whole walkthrough and its numerals are the step controls. In light, both the current step and the steps ahead fall under AA.
- Verified: yes (WCAG script on cited token values, color-mix resolved)
- Systemic: no

### COL-4: Light small text bypasses the *-text ink split (accent, add and amber rail hues)
- Rule: 9 Measure the rendered pair; 5 A token only in its role
- Severity: HIGH (Trigger: Body or control text whose rendered contrast pair fails its required ratio; A11Y classifies the requirement, COL owns the pair)
- Confidence: high
- Locations: `client/surfaces/review/review.css:273`, `client/surfaces/review/review.css:666`, `client/surfaces/review/review.css:316`, `client/surfaces/review/review.css:1289`, `client/surfaces/review/review.css:1298`, `src/theme.ts:199`, `src/theme.ts:200`
- Evidence: The palette ships darker ink variants for small text (`--accent-text:#005cae`, `--diff-add-text:#116f43`, `--amber-text:#875200` at src/theme.ts:196-200), and sibling rules use them (`.ds-badge-changed` accent-text at review.css:270, `.ds-stat-del` danger-text at review.css:667). These rules use rail hues instead. Measured light: `.ds-badge-sweep` raw accent on its 13% tint 4.02:1 (review.css:273, rendered from src/render.ts:154), `.ds-badge-concept` raw accent on accent-soft 4.19:1 (review.css:1289), `.ds-concept-eyebrow` raw accent on `--bg` 4.20:1 at 10px (review.css:1298, rendered from src/render.ts:457), `.ds-stat-add` raw `--add` on `--surface-2` 3.87:1 (review.css:666, rendered from client/surfaces/review/Sidebar.tsx:317), verification `not-run` raw `--amber` on `--bg` 3.94:1 at 11.5px (review.css:316). All are normal text under 4.5:1. Dark passes because dark rail hues double as the inks.
- Fix: Swap each cited rule to the canonical ink that already exists: `var(--accent-text)` for review.css:273, 1289 and 1298, `var(--diff-add-text)` for review.css:666, `var(--amber-text)` for review.css:316. Keep the fills and hues unchanged.
- Why: Badges, file counts, concept eyebrows and verification states are evidence text. The correct tokens exist and are used one rule away, so each miss is a one-word fix with no repaint risk.
- Verified: yes (WCAG script on cited token values, tint composites resolved)
- Systemic: yes

### COL-5: Theme and editor focus rings use only accent-soft at about 1.2:1
- Rule: 9 Measure the rendered pair
- Severity: MEDIUM
- Confidence: high
- Locations: `client/shared/shared.css:232`, `client/shared/shared.css:384`, `client/generated/theme.css:217`, `client/surfaces/progress/ProgressPanel.tsx:106`
- Evidence: The canonical ring `--shadow-focus: 0 0 0 2px var(--accent), 0 0 0 5px var(--accent-soft)` (client/generated/theme.css:217) measures 8.13:1 dark and 4.80:1 light for its solid part against surface. The theme and editor toggles override it with `box-shadow: 0 0 0 3px var(--accent-soft)` only (shared.css:232, shared.css:384). The rendered soft ring against surface measures 1.22:1 dark and 1.15:1 light, under the 3:1 UI component threshold. Progress actions repeat the pattern with `color-mix(in srgb,var(--pp-blue) 12%,transparent)` (ProgressPanel.tsx:106). runtime.md:104 reports a ring was visible at sampled stops, so an indicator exists; the measured pair is still under threshold.
- Fix: Replace the three soft-only shadows with `box-shadow: var(--shadow-focus)`, the token other controls already use in client/shared/nav.tsx:39 and client/styles.css:54. In ProgressPanel, use the same solid-plus-soft form with `--pp-blue`.
- Why: Theme and editor controls sit in every surface's chrome. A ring that measures near the background luminance can disappear on the exact surfaces (tinted menus, diff highlights) where keyboard users need it. A11Y classifies the focus requirement; COL owns this pair.
- Verified: yes (WCAG script on cited token values, alpha composite resolved)
- Systemic: yes

### COL-6: Increased-contrast support exists only inside review.css and leaves the failing pairs unchanged
- Rule: 11 An increased-contrast variant
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/review.css:1459`, `client/surfaces/review/review.css:1551`, `src/theme.ts:145`, `src/theme.ts:186`
- Evidence: `sharedTokens()` has no `prefers-contrast` block in either theme (src/theme.ts:145-205), so picker, stories, change, explain and progress tokens never widen. The review override (review.css:1459) sets `--text-2` and `--text-3` to the same `color-mix(in srgb,var(--text) 88%,transparent)`, collapsing the secondary and tertiary tiers into one value, and review.css:1551 only strengthens island borders. It does not touch `--accent-hi`, `--accent`, `--add` or `--amber`, so COL-1, COL-3 and COL-4 measure the same under `prefers-contrast: more`. Other surfaces instead scatter `contrast-more:` utilities on individual borders and labels, which cannot widen token pairs. No capture in runtime.md exercises `prefers-contrast: more`.
- Fix: Add one `@media (prefers-contrast: more)` block in `sharedTokens()` in src/theme.ts that widens the canonical pairs (solid `--text` on `--bg`, stronger `--line`, and the COL-1/COL-3/COL-4 inks moved to their darkest step), then remeasure those pairs. Keep review.css:1459 only for review-local rules that still need it.
- Why: A user who asks the OS for more contrast gets it on one surface and not on the other five, and still gets the lowest pairs unchanged there.
- Verified: no (code and token inventory confirm the gap; confirm with a `prefers-contrast: more` emulation capture on picker and review)
- Systemic: yes

### COL-7: Forced-colors mode rescues only the focus ring
- Rule: 10 Dark mode is tuned, not mirrored (rendering-mode variants); forced-colors behaviour in scope
- Severity: MEDIUM
- Confidence: medium
- Locations: `client/styles.css:82`, `client/shared/shared.css:554`, `client/surfaces/review/review.css:1595`, `client/surfaces/review/review.css:972`
- Evidence: The only forced-colors rules in the app are three copies of the same focus outline (`client/styles.css:82`, `client/shared/shared.css:554`, `client/surfaces/review/review.css:1595`). Nothing else adapts. Under forced colors the UA overrides the backgrounds that carry meaning: `--add-bg` / `--del-bg` row tints, `--amber-soft` and `--accent-soft` badges, and the inset `box-shadow` add/del rails at review.css:972-973 (box-shadow does not render in forced colors). No rule restores a CanvasText, Highlight or border distinction for those states. runtime.md lists no forced-colors capture.
- Fix: Add a `@media (forced-colors: active)` block in client/surfaces/review/review.css that gives add, delete, untoured and active states a system-color border or outline (for example `border-color: Highlight` for the active state and forced-color-adjust aware outlines for the diff rails), and check the badge classes in client/surfaces/stories/story-state.ts against ButtonText and Highlight. Keep the existing focus rules.
- Why: In forced-colors mode the diff's add/delete evidence and status badges lose the hue that distinguishes them, with no fallback. A11Y owns the state-by-color requirement; COL owns how the tokens behave in this rendering mode.
- Verified: no (code inventory confirms no other forced-colors rules; confirm with a forced-colors emulation capture of the diff and stories list)
- Systemic: yes

### COL-8: Dead color rules and unused aliases left from the M3 layer
- Rule: 15 Audit before restructuring; 4 Primitives by hue, semantics by role
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/review/review.css:287`, `client/surfaces/review/review.css:66`, `client/surfaces/review/review.css:51`, `client/surfaces/review/review.css:1207`
- Evidence: `.ds-stepcard.is-intro.is-active .ds-intro-cardsub{color:rgba(232,222,248,0.72)}` (review.css:287) is a lavender literal in no ramp. It never paints: the later rule at review.css:1207 sets the same selector to `color:var(--muted)`, and the same happens to the accent-hi intro rules at review.css:283-285. Defined and never consumed (searched client and src): `--green-hi` (review.css:66), `--md-tertiary` (review.css:51), `--add-bd` (review.css:64) and `--text-minimum` (review.css:68).
- Fix: Delete review.css:283-287 and the unused aliases at review.css:51, 64, 66 and 68. Keep review.css:1207 as the single intro-card rule.
- Why: Dead rules that look live are how COL-1 style bugs get reintroduced: the next editor changes the alias and reasonably expects the intro card to respond.
- Verified: yes (cascade order read in file; zero consumers found by search)
- Systemic: no

### COL-9: The generated bridge gives one job three names
- Rule: 4 Primitives by hue, semantics by role (one word per concept)
- Severity: LOW
- Confidence: high
- Locations: `client/generated/theme.css:105`, `client/generated/theme.css:151`, `client/generated/theme.css:160`, `scripts/build-theme-css.mjs:202`
- Evidence: `--color-text` (line 105), `--color-fg` (line 153) and `--color-foreground` (line 160) all point at `var(--text)`; `--color-canvas` and `--color-background` repeat `--color-bg`; `--color-panel` and `--color-card` repeat `--color-surface`. The vendored beUI tree needs the shadcn names, but first-party surfaces can pick any of the three and still be "on token".
- Fix: In scripts/build-theme-css.mjs (section at line 202), keep the shadcn names the vendor requires, mark them vendor-only in the section comment, and document `--color-text`, `--color-surface`, `--color-bg` and `--color-accent` as the first-party names. Regenerate; do not edit client/generated/theme.css by hand.
- Why: Three names for one job makes reviews and searches miss usages, and lets new code drift onto a vendor name that a vendor refresh could rename.
- Verified: yes (bridge and generator read)
- Systemic: no

### COL-10: Progress primary action spells the on-accent ink as a literal
- Rule: 5 A token only in its role; 15 Audit before restructuring
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/progress/ProgressPanel.tsx:432`, `client/surfaces/progress/ProgressPanel.tsx:170`, `src/theme.ts:155`
- Evidence: `"bg-[var(--pp-blue)] text-[#06121c]"` (ProgressPanel.tsx:432). `#06121c` is the dark `--on-accent` value spelled out (src/theme.ts:155). The panel pins `data-theme="dark"` (ProgressPanel.tsx:170), so `--pp-blue` resolves to dark `--accent:#49b7ff` and the pair measures 8.55:1 today. It passes only because the literal happens to equal the token; a future `--on-accent` retune would leave this button behind, and read as written it also looks like a light-theme bug (against light `--accent:#0072d6` it would be 3.94:1).
- Fix: Replace `text-[#06121c]` with `text-[var(--on-accent)]` in ProgressPanel.tsx:432.
- Why: One-word change, no visual change today, and the recovery action then follows the canonical ink like every other accent fill.
- Verified: yes (WCAG script on cited values in the pinned dark theme)
- Systemic: no

## Recommendations
- Add the COL-1, COL-3 and COL-4 pairs and the emphasis pairs from COL-2 to test/theme.test.mjs, using its existing contrastRatio helper at test/theme.test.mjs:44. Purpose: the test already guards diff ink and syntax on plain surfaces; these are the same pairs one tint deeper. Benefit: light-theme regressions fail in `npm run check` instead of in a review. Evidence limits: token-level only, it cannot catch a new hard-coded literal, so pair it with a literal search in review.
- Consider one `--accent-text` rule for static kickers only if user testing shows click confusion; see Considered but rejected for why this is not a finding now.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/ChangeApp.tsx:156`, `client/surfaces/picker/Hero.tsx:29`, `client/surfaces/explain/ExplainApp.tsx:300` | Accent-text on static kickers and eyebrows breaks rule 7 (accent means interactive) | It is the documented brand voice (DESIGN_MEMORY.md:23, brief personality), identical on every surface, and links are set apart by underline, hover fill or pill shape in the same views (screens/change-1440x900-light.png, screens/picker-1440x900-light.png). No capture shows a kicker styled as a control. Candidate only, per dispatch guidance on craft defaults. |
| `client/vendor/beui/motion/animated-badge.tsx:49` | Vendored STATUS_CLASS paints emerald-500 and amber-500 primitives | Every adopted usage overrides background and text through cn, and tailwind-merge keeps the later class: FileSummary.tsx:103, RecentRepos.tsx:197, StoryRow.tsx:165-168. The primitives never paint. Editing vendor files also breaks the vendor-refresh seam in client/shared/quiet.ts:10-13. |
| `src/brand.ts:63` | Favicon colors switch on prefers-color-scheme, not data-theme (mixed mechanism, rule 10) | Brand marks are exempt in this lens, and browser chrome follows the OS scheme, so the favicon matching the OS is the consistent choice. In-app marks use data-theme tokens (client/shared/nav.tsx:102). |
| `client/surfaces/review/review.css:1079` | White on light `--amber:#a96800` for the untoured tag measures 4.4996:1 | Within rounding of 4.5:1, the text also names its state, and the dark pair is 9.79:1. Not counted as a failure. |
| `client/surfaces/review/review.css:1309` | Concept diagram gradient lacks an interpolation space (rule 13) | The gradient runs from a 3% accent tint to the same panel color, near-solid, with no text painted over its worst region. No banding is visible in screens/review-1440x900-dark.png. |

## Handoffs
- A11Y: COL-1, COL-3 and COL-4 hand you the failing pairs; the requirement classification (normal vs large text, control labels) is yours to confirm, including the 17px bold dock numerals in COL-3.
- A11Y: COL-7 hands you the forced-colors state distinction (add/delete, badges, active state) once the token fallback exists; state shown only by color is your rule.
- VIS: review.css keeps dark `rgba(0,0,0,...)` shadows in light (for example the command palette shadow at client/surfaces/review/review.css:825 and composer shadow at review.css:649); shadow weight per theme is yours.
- VIS: `.ds-filmnode.is-active .ds-filmnode-num` adds `text-shadow:0 0 12px var(--accent-glow)` (review.css:1284); glow legibility of the numeral itself is measured in COL-3, the effect choice is yours.
