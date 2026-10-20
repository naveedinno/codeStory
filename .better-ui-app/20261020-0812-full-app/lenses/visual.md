# Visual findings
Scope inspected: Signal / Thread-Ledger system in DESIGN_MEMORY.md and src/theme.ts sharedTokens(); all six surfaces (picker, stories, change, review/diff including StoryView filmstrip and Sidebar, progress floating panel, explain) in dark and light 1440x900 captures, plus picker modal, review step, review all-files, progress running, and change light captures listed in runtime.md; icon code in client/shared (brand, theme-menu, editor-menu, nav) and client/surfaces (Lucide props and inline SVGs); islands, thread and numeral usage, elevation, and Mermaid concept-diagram treatment in client/surfaces/review/review.css and src/render.ts. Screens read at full size: picker, change, review, diff, stories, explain (dark and light), picker-modal, review-step, review-allfiles, progress-running.
Not inspected: Rule 9 RTL flipping (no RTL locale, no dir attribute, and no RTL capture exists in the brief, brief.md:20 says i18n none found); Mermaid primer diagram as rendered (no concept-primer capture in screens/, code inspection only); hover, selected, disabled and loading visual states beyond the captured focus, modal, empty and running states (no captures for those states; code inspected only); translucent-material stacking inside fullscreen Mermaid (no fullscreen capture); beUI vendor components under client/vendor/beui (vendored library, not a shipped surface in the brief).
Score: 3/4, good and disciplined overall, with light-theme island definition, elevation drift and one decorative masthead as the notable gaps. No HIGH.

## Findings

### VIS-1: Light-theme islands lose their edge
- Rule: 4 Shadows for elevation, borders for structure; 13 Components stay consistent
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/change/ScopeCard.tsx:530`, `client/surfaces/change/FileSummary.tsx:96`, `client/surfaces/change/FileSummary.tsx:172`, `client/surfaces/explain/ExplainApp.tsx:334`, `client/surfaces/picker/RecentRepos.tsx:153`, `client/surfaces/stories/StoryRow.tsx:124`
- Evidence: `rounded-[var(--radius-island)] border border-transparent bg-surface-2` (ScopeCard:530; the same border-transparent plus bg-surface-2 shape repeats at every location listed). In light, `--surface-2:#eef1f5` sits on `--bg:#edf0f4` (src/theme.ts:187), a near-zero tonal step, so with no border and no shadow the island has almost no edge. screens/stories-1440x900-light.png shows the saved-review card as floating text with only a faint bottom line; screens/picker-1440x900-light.png shows the repo cards barely separated from the dot field. The nav island by contrast uses `border border-line-soft bg-surface` (client/shared/nav.tsx:82) and stays defined in both themes, and the dark captures (screens/stories-1440x900-dark.png) read clearly because `#181b20` on `#0a0c0f` is a real step.
- Fix: give islands the structural hairline the nav already uses: change `border-transparent` to `border-line-soft` on the island classes listed (keeping `contrast-more:border-text`), or adopt a `--shadow-border` token (0 0 0 1px line, plus the existing soft shadow) in src/theme.ts sharedTokens() and apply it to islands. Do not add drop shadows; DESIGN_MEMORY.md:10 says shadow only on overlays.
- Why: an island that cannot be seen as a surface in light mode stops grouping its contents. The story card, scope card and repo cards rely on that grouping to read as one tappable or scannable unit.
- Verified: yes (screens/stories-1440x900-light.png and screens/picker-1440x900-light.png against their dark pairs)
- Systemic: yes

### VIS-2: Picker masthead thread loop encloses empty space and competes with the wordmark
- Rule: 11 Spend boldness in one place; 1 One focal point per screen
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/picker/Hero.tsx:14`, `client/surfaces/picker/Hero.tsx:15`, `client/shared/brand.tsx:18`
- Evidence: Hero renders `min-h-[168px]` with `<ThreadBackdrop className="pointer-events-none absolute inset-0 z-0 h-full w-full ...">` (Hero.tsx:14-15) over path `M-30 38H560c46 0 46 62 0 62H210c-46 0-46 62 0 62H930` (brand.tsx:18). In screens/picker-1440x900-dark.png and screens/picker-1440x900-light.png the path closes into a large empty pill outline across the top of the masthead. The wordmark sits on a `--bg` plate at the left (Hero.tsx:17) and the editor and theme controls sit outside the loop at the right, so most of the enclosed area holds nothing. Squinted, the loop is the largest drawn object on the screen and reads as an empty outlined field rather than as a thread passing behind the brand.
- Fix: in project idiom, either shorten the backdrop so the thread passes behind the lockup and exits (crop the viewBox or end the path after the second node in brand.tsx THREAD_BACKDROP_D), or drop the closing return stroke so it reads as an open thread line like the atmosphere thread in client/shared/shared.css:34-59. Keep the 480px hide (Hero.tsx:15) and the reduced-motion branch.
- Why: decoration that encloses a big empty pill competes with "Repositories" and the Add repository action below it, and a closed rounded outline is the shape this app uses for fields and pills, so the static thread borrows an interactive shape.
- Verified: yes (screens/picker-1440x900-dark.png, screens/picker-1440x900-light.png)
- Systemic: no

### VIS-3: Elevation is not one scale; non-overlay surfaces carry shadows and overlays invent their own
- Rule: 4 Shadows for elevation, borders for structure; 13 Components stay consistent
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/change/RefPicker.tsx:420`, `client/surfaces/progress/ProgressPanel.tsx:95`, `client/surfaces/stories/StoryRow.tsx:235`, `client/surfaces/review/review.css:1255`, `client/surfaces/review/review.css:1272`, `client/surfaces/review/review.css:825`, `client/surfaces/review/review.css:649`
- Evidence: the token is one recipe, `--shadow:0 1px 2px rgba(0,0,0,.34),0 8px 28px rgba(0,0,0,.28)` (src/theme.ts:169), and menus and sheets use it (client/shared/shared.css:261, client/surfaces/picker/FolderBrowser.tsx:293). Around it sit unrelated recipes for the same job: RefPicker listbox `shadow-[0_18px_44px_rgba(0,0,0,.28),0_2px_8px_rgba(0,0,0,.18)]` (RefPicker.tsx:420), progress panel `shadow-[0_18px_50px_rgba(0,0,0,0.5)]` (ProgressPanel.tsx:95), story-card hover `group-hover:shadow-[0_8px_22px_rgba(0,0,0,.18)]` (StoryRow.tsx:235), command palette `box-shadow:0 24px 80px rgba(0,0,0,.48)` (review.css:825), composer `box-shadow:0 8px 24px rgba(0,0,0,.22)` (review.css:649). Two in-flow chrome surfaces also carry shadows although DESIGN_MEMORY.md:10 says "Flat, no gradients, no glass; shadow only on overlays": the beat dock `box-shadow:0 2px 7px rgba(0,0,0,.08),0 18px 44px rgba(0,0,0,.16)` (review.css:1255) and the storyless filmthread `box-shadow:0 8px 26px rgba(0,0,0,.09)` (review.css:1272). A second unused scale also ships in the generated bridge (`--shadow-sm` through `--shadow-xl`, client/generated/theme.css:212-215), so three elevation vocabularies coexist.
- Fix: pick the Signal `--shadow` as the overlay recipe and the beUI bridge scale as the named steps, then move RefPicker, ProgressPanel, the command palette and the composer onto those steps (for example `shadow-[var(--shadow)]` or a `--shadow-lg` alias generated from src/theme.ts). Remove the shadow from .ds-dock and .ds-filmthread.is-storyless so in-flow islands stay flat tonal surfaces, matching ScopeCard and FileSummary.
- Why: the same elevation (a floating panel over the page) casts a different shadow on each surface, and two flat islands float anyway. The eye reads shadow strength as height, so identical layers appear to sit at different depths.
- Verified: yes for the dark recipes (screens/progress-running-1440x900-dark.png, screens/review-step-1440x900-dark.png dock); no for the progress shadow in a light host (no light progress capture; the 0.5 black recipe at ProgressPanel.tsx:95 is theme-independent in code)
- Systemic: yes

### VIS-4: Nested radii do not follow the concentric rule
- Rule: 2 Concentric radius
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/ScopeCard.tsx:106`, `client/surfaces/change/ScopeCard.tsx:113`, `client/surfaces/change/ScopeCard.tsx:530`, `client/surfaces/change/ScopeCard.tsx:185`, `client/surfaces/explain/ExplainApp.tsx:89`, `client/surfaces/explain/ExplainApp.tsx:83`, `client/surfaces/explain/ExplainApp.tsx:334`, `client/surfaces/explain/ExplainApp.tsx:77`
- Evidence: segment track `rounded-[var(--radius-lg)] border border-line-soft bg-fill-1 p-1` (18px radius, 4px padding, ScopeCard.tsx:106; identical TRACK at ExplainApp.tsx:89) holds segments at `rounded-[var(--radius)]` (12px, ScopeCard.tsx:113 and ExplainApp.tsx:83). Concentric expects 18 minus 4 = 14px inside. One level up, the island at `rounded-[var(--radius-island)] ... p-4` (26px, 16px padding, ScopeCard.tsx:530) and `p-5` (20px padding, ExplainApp.tsx:334) holds slots and fields at `rounded-[var(--radius-lg)]` (18px, ScopeCard.tsx:185, ExplainApp.tsx:77). Concentric expects 10px and 6px. The inner corners are therefore rounder than the gap that contains them, visible as a varying corner gap in screens/change-1440x900-dark.png (source and target tiles inside the scope island) and screens/explain-1440x900-dark.png (depth and audience tracks inside the form island).
- Fix: add the derived steps where the nesting is real: segments to 14px (a `--radius` calc or a new token in src/theme.ts, for example `--radius-segment: calc(var(--radius-lg) - 4px)`), and island children to `calc(var(--radius-island) - 16px)` / `- 20px`, or reduce island padding. Keep pill actions at --radius-pill; they are independent surfaces.
- Why: equal or oversized inner radii make the corner gap pinch and swell, the common "slightly off" feel on the two most-used chooser surfaces (scope segments, explain depth and audience).
- Verified: yes (screens/change-1440x900-dark.png, screens/explain-1440x900-dark.png)
- Systemic: yes

### VIS-5: Radius tokens in code have drifted from the DESIGN_MEMORY scale
- Rule: 13 Components stay consistent
- Severity: LOW
- Confidence: medium
- Locations: `src/theme.ts:178`, `DESIGN_MEMORY.md:10`, `DESIGN_MEMORY.md:34`
- Evidence: DESIGN_MEMORY.md:10 specifies islands at `--radius-island` 16px and DESIGN_MEMORY.md:34 specifies controls at 6/9/12px "to harmonize with 16px islands". The shipped token is `--radius-sm:8px;--radius:12px;--radius-lg:18px;--radius-island:26px` (src/theme.ts:178). Every island in the captures is drawn at 26px (screens/picker-1440x900-dark.png repo cards, screens/review-1440x900-dark.png stage island), roughly 1.6x the documented island radius, and small controls sit on 8/12/18 rather than 6/9/12.
- Fix: move one source. Either set the scale back in src/theme.ts sharedTokens() (`--radius-island:16px` with 6/9/12 controls) and regenerate client/generated/theme.css, or amend DESIGN_MEMORY.md:10 and DESIGN_MEMORY.md:34 to record 26px islands and the 8/12/18 control scale as the approved choice. Do not leave both claiming authority.
- Why: two documents both calling themselves the source of truth for the same geometry means the next surface built from memory will not match the shipped one.
- Verified: yes (screens/picker-1440x900-dark.png, screens/review-1440x900-dark.png against src/theme.ts:178)
- Systemic: yes

### VIS-6: Review stylesheet bypasses the radius scale with off-scale hard values
- Rule: 13 Components stay consistent; 2 Concentric radius
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/review/review.css:161`, `client/surfaces/review/review.css:346`, `client/surfaces/review/review.css:375`, `client/surfaces/review/review.css:390`, `client/surfaces/review/review.css:1309`, `client/surfaces/review/review.css:1178`
- Evidence: the token scale is 8/12/18/26 (src/theme.ts:178), but review.css hard-codes at least 137 radii off that scale, including `border-radius:10px` (.ds-feedback-health-alert, review.css:161), `border-radius:14px` (.ds-storygen-card, review.css:346), `border-radius:10px` (.ds-choice, review.css:375), `border-radius:9px` (.ds-storyfile-search, review.css:390), `border-radius:14px` (.ds-concept-diagram-output, review.css:1309) and `border-radius:7px` (.ds-tab, review.css:1178), alongside 23 uses of 8px, 15 of 9px, 15 of 7px and 14 of 5px in the same file. The TSX surfaces use `rounded-[var(--radius-*)]` throughout (client/surfaces/change/ScopeCard.tsx:106, client/shared/nav.tsx:82).
- Fix: map the review values onto the scale (5 and 7 to --radius-sm, 9 and 10 to --radius, 14 to --radius-lg, diagram frame to --radius-lg) in review.css, keeping true dots and pins at 50% / 999px. Small keycap and badge radii (review.css:176, review.css:267) can stay if recorded as a micro step in src/theme.ts.
- Why: the review surface is the constant-use loop (brief.md:48). Its cards, tabs and diagram frame round differently from the same shapes on the change and explain surfaces, so moving between surfaces feels like a different product.
- Verified: no (no capture isolates a 9px versus 12px corner; this is a code-consistency claim. Screens/review-step-1440x900-dark.png shows the review surface at full size but corner deltas of 2 to 4px are not measurable from it)
- Systemic: yes

### VIS-7: Icon stroke weight wanders instead of matching the adjacent text
- Rule: 6 Icon stroke matches text weight
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/picker/RecentRepos.tsx:175`, `client/shared/editor-menu.tsx:24`, `client/surfaces/change/FileSummary.tsx:102`, `client/shared/shared.css:247`, `client/surfaces/review/review.css:719`
- Evidence: `Folder className="h-5 w-5" strokeWidth={1.7}` (RecentRepos.tsx:175) sits beside the semibold repo name (`font-semibold`, RecentRepos.tsx:188), which the table pairs with 2px on a 24px grid. `Code2 ... strokeWidth={1.8}` (editor-menu.tsx:24) sits beside the editor label set at font-weight 650 (client/shared/shared.css:361), also a 2px pairing. In the other direction, the "reviewed" chip carries `Check strokeWidth={2.4}` (FileSummary.tsx:102) beside 11px medium mono text (`text-[11px] font-medium`, FileSummary.tsx:103), a weight the table reserves for bold or emphasized standalone icons. The theme glyphs use `stroke-width:1.45` (shared.css:247) and the rail tree uses `stroke-width:1.25` on a 16px grid (review.css:719), so four conventions (1.25 at 16, 1.45 at 20, 1.7 to 1.9 and 2.4 at 24) run across surfaces. DESIGN_MEMORY.md (Repo Conventions) also records "use Lucide (1.5 stroke)", which none of the listed Lucide call sites follows.
- Fix: set the pairings by the table and record the choice in src/theme.ts: semibold-adjacent Lucide icons to strokeWidth 2 (Folder, Code2, and the GitBranch set in ScopeCard.tsx:605-692), the FileSummary chip Check to 1.5, and keep the 16px rail glyphs at 1.25 (equivalent to about 1.9 at 24). Then update the DESIGN_MEMORY 1.5 note to the weight-matched rule so the two documents agree.
- Why: an icon lighter than its label reads as disabled or decorative; one heavier reads as the label. The folder is the repo card's identity glyph, so its light stroke is the most visible case (screens/picker-1440x900-dark.png).
- Verified: yes (screens/picker-1440x900-dark.png folder glyphs against the semibold names)
- Systemic: yes

### VIS-8: Trailing-icon primary buttons keep symmetric padding
- Rule: 3 Optical alignment
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/change/FileSummary.tsx:189`, `client/surfaces/explain/ExplainApp.tsx:492`, `client/surfaces/review/review.css:327`
- Evidence: `px-[15px]` with a trailing 15px ArrowRight (FileSummary.tsx:189-194), `px-4` with a trailing 15px ArrowRight (ExplainApp.tsx:492-498), and `.ds-intro-start{padding:14px 22px}` with the arrow glyph in the main row (review.css:327-331). All three give the icon side the same inset as the text side, so the arrow crowds the pill edge and the label sits slightly left of optical center, visible on the "Review 6 files" pill (screens/change-1440x900-dark.png), the "Start the walkthrough" pill (screens/review-1440x900-dark.png) and the explain submit (screens/explain-1440x900-dark.png).
- Fix: reduce the icon side by about 2px in each idiom: `ps-[15px] pe-[13px]` (FileSummary), `ps-4 pe-[14px]` (Explain), `padding:14px 20px 14px 22px` for .ds-intro-start (review.css:327), using logical properties so RTL mirrors correctly.
- Why: geometric symmetry with an asymmetric glyph (text plus arrow) leaves the combined unit off-center; the arrow also sits closer to the edge it points at, which tightens the exit affordance.
- Verified: yes (screens/change-1440x900-dark.png, screens/review-1440x900-dark.png)
- Systemic: no

### VIS-9: Mermaid diagram frame uses a tinted border and a gradient wash instead of a neutral image outline
- Rule: 5 Image outlines; 11 Spend boldness in one place
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/review/review.css:1309`, `client/surfaces/review/review.css:1334`
- Evidence: `.ds-concept-diagram-output{...border:1px solid color-mix(in srgb,var(--line) 78%,transparent);border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 3%,var(--panel3)),var(--panel3) 54%);box-shadow:inset 0 1px 0 ...}` (review.css:1309). The edge is the tinted `--line` (a cool slate alpha, src/theme.ts:152 and src/theme.ts:189), not pure black at 10% in light or white at 10% in dark with outline-offset -1px, and the surface carries a 145 degree accent gradient although DESIGN_MEMORY.md:10 says "Flat, no gradients". A second rule then flattens the background to --surface in diagram scenes (review.css:1334), so the frame treatment differs by scene.
- Fix: give the diagram the image treatment: `outline:1px solid oklch(0 0 0 / 0.1); outline-offset:-1px` with the dark pair `oklch(1 0 0 / 0.1)` under `[data-theme="dark"]`, drop the gradient to flat `background:var(--panel3)`, and take the radius from --radius-lg. Keep the focus ring on the same element as is (review.css:1309).
- Why: a tinted outline picks up the surface under it and reads as dirt on the edge, and a decorative gradient inside a document diagram competes with the diagram itself, which is the one bold thing in a primer.
- Verified: no (no concept-primer or diagram capture exists in screens/; runtime.md lists none. Code-supported only; a primer capture in both themes would verify it)
- Systemic: no

### VIS-10: The page-primary pill renders at two heights
- Rule: 13 Components stay consistent
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/FileSummary.tsx:189`, `client/surfaces/picker/PickerApp.tsx:230`, `client/surfaces/stories/StoriesApp.tsx:175`, `client/surfaces/explain/ExplainApp.tsx:492`
- Evidence: the same accent pill (rounded-full, bg-accent, semibold, on-accent text) is `h-[var(--control-h)]` (34px) for "Review 6 files" (FileSummary.tsx:189) and "Add repository" (PickerApp.tsx:230), but `h-[var(--control-h-lg)]` (40px) for "Start review" (StoriesApp.tsx:175) and the explain submit (ExplainApp.tsx:492). The token pair lives at src/theme.ts:178 (`--control-h:34px;--control-h-lg:40px`), so both heights are sanctioned tokens, but no surface-level rule decides which one a primary gets. Compare screens/change-1440x900-dark.png ("Review 6 files") with screens/stories-1440x900-dark.png ("Start review").
- Fix: record one rule and apply it: page primaries at --control-h-lg, bar and card actions at --control-h (the nav already fixes the bar at --control-h, client/shared/nav.tsx:37). That moves FileSummary.tsx:189 and PickerApp.tsx:230 to control-h-lg, or the reverse if 34px is chosen; either way one height per role.
- Why: things that look alike must act and size alike. A primary action that changes height between the scope page and the history page makes the shared component read as two components.
- Verified: yes (screens/change-1440x900-dark.png, screens/stories-1440x900-dark.png, screens/explain-1440x900-dark.png)
- Systemic: yes

## Recommendations
none

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| client/surfaces/picker/RecentRepos.tsx:167, client/surfaces/stories/StoryRow.tsx:150 | Zero-padded 01, 02 markers on repo and story lists as templated numbering on non-sequence content (Rule 12) | DESIGN_MEMORY.md (Typography) makes zero-padded numerals the ledger structure of the product, and recency order is a real sequence. The brand direction calls for them. |
| client/shared/nav.tsx:37, client/surfaces/stories/StoriesApp.tsx:162 | Tracked uppercase mono kicker above every heading, arrows appended to links (Rule 12 template chrome) | DESIGN_MEMORY.md (Brand Tone and Typography) explicitly specifies uppercase mono kickers and the thread direction. Brief asks for them; exempt. |
| client/surfaces/progress/ProgressPanel.tsx:170 | Dark panel forced with data-theme="dark" inside a light host | Documented at ProgressPanel.tsx:20-26 and ProgressPanel.tsx:77-79 as a deliberate dark console in both themes, with radii and pill shape borrowed from Signal. Established product choice; only its shadow is in VIS-3. |
| client/surfaces/review/review.css:1285, client/surfaces/review/review.css:1308 | backdrop-filter blur on the filmthread tooltip and diagram tools as stacked translucent material (Rule 10) | Each is a single translucent layer over content, and review.css:1458 supplies the prefers-reduced-transparency fallback to solid --panel3. Passes the rule. |
| client/shared/brand.tsx:39 | BrandMark stroke 2.7 against the 1.5 Lucide convention | The table allows 2.5 for an emphasized standalone icon; the thread mark is the brand glyph at 22 to 34px, not text-adjacent. Exempt as a brand choice. |
| client/shared/theme-menu.tsx:35 | System theme icon drawn half-filled while other icons are outline-only (Rule 7) | The half fill is the glyph's meaning (system equals half light, half dark), not a state fill. State is still carried by currentColor and the aria-checked check (shared.css:298-300). |

## Handoffs
- COL: `--numeral-dim` and `--text-3` legibility of inactive filmstrip numerals and thread nodes at client/shared/shared.css:54-59 and StoryView filmstrip (screens/review-step-1440x900-dark.png bottom thread) is a contrast pairing, not assessed here.
- A11Y: icon accessible names and alt equivalents for the inline SVGs at client/surfaces/review/Sidebar.tsx:27-42 and client/surfaces/review/ReviewApp.tsx:53-67, and the dir/RTL behaviour of ChevronRight and ArrowRight at client/surfaces/picker/RecentRepos.tsx:232 and client/surfaces/change/FileSummary.tsx:194 if an RTL locale is ever added.
- MOT: chevron and icon swap transitions at client/surfaces/stories/StoryRow.tsx:266 and the theme icon crossfade behaviour, owned by motion.
- EXP: the progress panel overlapping the review island and bottom dock while running (screens/progress-running-1440x900-dark.png) as a state and dismissal question; visually it is an intentional floating console (ProgressPanel.tsx:92-95).
