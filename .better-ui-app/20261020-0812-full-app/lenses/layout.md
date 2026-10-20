# Layout findings
Scope inspected: All six React surfaces (picker, stories, change, review including review.css, progress, explain), shared chrome in client/shared/nav.tsx, brand and menus, and canonical tokens in src/theme.ts sharedTokens(). Read in full or in relevant part: ChangeApp, ScopeCard, RefPicker, refs, FileSummary, PickerApp, RecentRepos, Hero, FolderBrowser, StoriesApp, StoryRow, StoryHistory, EmptyHistory, RemoveStoryDialog, ReviewApp, ReviewView, Sidebar, StoryView, ProgressPanel, Milestones, PlanList, ExplainApp, nav, shared.css, styles.css, theme.ts, and review.css (1,605 lines). Runtime evidence checked against screens/change-375x812-dark.png, screens/change-320-dark.png, screens/change-1440x900-dark.png, screens/picker-375x812-dark.png, screens/review-320-dark.png, screens/stress-S1-change-longbranch-375x812-dark.png, and screens/stress-S2-picker-longrepo-375x812-dark.png, plus the overflow values in runtime.md lines 10, 11, 47, and 69. Rule coverage: rule 1 grouping checked on stories header, ReviewPath, and file lists. Rule 2 control signals checked on disclosures, tabs, and text actions. Rule 3 alignment checked on nav, cards, file rows, and tables. Rule 4 spacing scale checked across TSX utilities and review.css. Rule 5 logical properties swept with search for physical direction properties in all surfaces. Rule 6 reading order checked on picker, stories, change, and review overview. Rule 7 control placement checked on scope, file, and progress controls. Rule 8 hidden content checked on review tabs, filmthread, scope chips, and ref listbox. Rule 9 target clearance checked on nav, tabs, filters, and footers. Rule 10 edge inset and safe area checked on toasts, floating panel, sheets, and full width actions. Rule 11 bleed and floating chrome checked on review frame, hero backdrop, and dock. Rule 12 breakpoints and container queries checked in TSX and review.css. Rule 13 growth and clipping checked against S1, S2, S4, and the 375 and 320 captures.
Not inspected: Live RTL mirroring with dir="rtl" (no RTL locale or capture exists in the run, code inspection only), 200 percent zoom reflow (runtime.md line 121 records that CDP scaling did not change layout, so those files do not verify zoom), S3 42 step filmthread rendering (runtime.md line 113, fixture could not be injected), S4 100 plus file inventory (runtime.md line 114, only 8 files injected), physical device safe areas and browser bars (desktop emulation only, runtime.md line 109)
Score: 2/4, Two HIGH overflow defects block actions and content at 375px, and the 320px cases share the same roots.

## Findings

### LAY-1: Shared nav intrinsic width overflows the change page at 375px and clips History
- Rule: 13 Plan for growth and clipping, and 12 Hold structure until it breaks
- Severity: HIGH
- Confidence: high
- Locations: `client/shared/nav.tsx:81`, `client/shared/nav.tsx:37`, `client/surfaces/change/ChangeApp.tsx:135`
- Evidence: Current code at nav.tsx line 81 is `"sticky top-2.5 z-30 mx-3 mt-2.5 flex h-[50px] items-center gap-[11px] px-4"`. The action shape at line 37 includes `flex-none` and `whitespace-nowrap`. ChangeApp lines 135 to 145 put ReloadButton, Explain code, and History in that right slot with no small width collapse. Runtime evidence: screens/change-375x812-dark.png shows History cut at the right edge, overflowX=9px (runtime.md line 11). At 320px the same page reports overflowX=64px (runtime.md line 10). Both widths imply the same 384px intrinsic bar (375 plus 9, and 320 plus 64), so the bar, not the scope card, is the box that does not shrink. The scope target values truncate correctly in the same capture (screens/stress-S1-change-longbranch-375x812-dark.png), which confirms the overflow is in the chrome. The 320px part of this symptom is escalation trigger 5 and is handed to A11Y below. The 375px part is owned here.
- Fix: Collapse one secondary action at small widths in the project idiom. Give the History link in ChangeApp the same treatment Reload already uses for its label at ScopeCard line 789 (`max-[480px]:hidden` on the text): wrap the link text so it hides below 560px, or hide the whole History link below 560px with `max-[560px]:hidden` since review history stays reachable from the picker and stories nav. Also add `min-w-0` to the breadcrumb nav at nav.tsx line 114 is already present, so no change there. Do not give the header `overflow-x: auto`, which would hide the clipped action inside a scroller with no cue (rule 8).
- Why: At 375px a page action is partly off screen and the document gains horizontal scroll on a surface that already claims `max-[600px]` small viewport behaviour. A reviewer on a narrow window cannot reach History without scrolling the whole page sideways.
- Verified: yes (screens/change-375x812-dark.png and screens/change-320-dark.png read directly, overflow values in runtime.md lines 10 and 11, intrinsic width arithmetic 384px at both viewports)
- Systemic: yes

### LAY-2: Long branch name in a recent repo row overflows 320px at 375px
- Rule: 13 Plan for growth and clipping
- Severity: HIGH
- Confidence: high
- Locations: `client/surfaces/picker/RecentRepos.tsx:110`, `client/surfaces/picker/RecentRepos.tsx:218`
- Evidence: Current code at line 112 is `<span key="branch" className="inline-flex items-center gap-1">` with the raw `{row.currentBranch}` text at line 114 and no `min-w-0`, `max-w-full`, or `truncate`. Its parent at line 218 is `flex flex-wrap items-center gap-[7px]`, whose items size to min-content, so one unbroken 85 character branch sets the row width. The repo name and path in the same card do truncate (lines 188 and 214), which is why only the meta line escapes. Runtime evidence: screens/stress-S2-picker-longrepo-375x812-dark.png shows the branch line running past the card and viewport edge, overflowX=320 at a 375px viewport (runtime.md line 69, scenario S2). The normal picker at the same width reports overflowX=0 (screens/picker-375x812-dark.png), so the defect needs the long string, exactly the S2 boundary in brief.md.
- Fix: Make the branch the yielding field. Change the branch span to `inline-flex min-w-0 max-w-full items-center gap-1`, mark the icon `flex-none`, and wrap the branch text in `<span className="min-w-0 truncate">{row.currentBranch}</span>`. Add `min-w-0` to the meta row at line 218. This matches the truncation idiom already used for name and path in the same file.
- Why: An 80 plus character branch is a stated data boundary (brief S1 and S2). It pushes the card, the remove control, and the page 320px sideways at 375px, so the row action and the next rows sit off screen.
- Verified: yes (screens/stress-S2-picker-longrepo-375x812-dark.png read directly, runtime.md line 69 and scenario S2 at line 81, code at RecentRepos lines 110 to 121 and 218)
- Systemic: no

### LAY-3: Physical direction properties will not mirror under RTL
- Rule: 5 Logical properties and RTL mirroring
- Severity: MEDIUM
- Confidence: medium
- Locations: `client/surfaces/change/ChangeApp.tsx:49`, `client/surfaces/change/FileSummary.tsx:57`, `client/surfaces/change/FileSummary.tsx:75`, `client/surfaces/picker/RecentRepos.tsx:163`, `client/shared/shared.css:254`, `client/shared/shared.css:389`, `src/theme.ts:39`, `client/surfaces/review/review.css:227`, `client/surfaces/review/review.css:580`, `client/surfaces/review/review.css:918`, `client/surfaces/review/review.css:1025`
- Evidence: ChangeApp line 49 uses `border-l` for the metric dividers. FileSummary lines 57 and 75 and RecentRepos line 163 use `text-right`. shared.css lines 254 and 389 anchor the theme and editor menus with `right: 0`, and src/theme.ts line 39 does the same with `right:0` plus `text-align:left` at line 41. review.css line 227 puts the rail resizer at `right:0`, line 580 and line 1389 put the comment pin at `right:8px`, lines 918 and 919 use `margin-right:auto` and `margin-left:auto` for split callouts, and line 1025 uses `text-align:right` with `border-right` for line numbers. The same files already use logical forms elsewhere (`ms-`, `ps-`, `inset-inline-end` at review.css line 191), so the physical set is drift, not a convention. Numbers keep digit order either way. That part belongs to typography and is not claimed here.
- Fix: Swap each direction dependent declaration for its logical twin in place: `border-s`, `text-end`, `inset-inline-end: 0` for the menus and resizer, `inset-inline-end: 8px` for the comment pin, and `margin-inline-start:auto` or `margin-inline-end:auto` for the callouts, matching which side each callout must hug in LTR today. Keep genuinely physical geometry (`left: 50%` centring in the toast at review.css line 810 and the film node dot at line 1284). No RTL capture exists, so verify after the swap with `dir="rtl"` on picker, change, and review.
- Why: The app has no i18n catalogue today (brief.md line 20), but the layout already pays for logical properties in most places. The remaining physical set means menus, the resizer, the comment pin, and trailing number columns stay on the LTR side if a locale or an embedded RTL context ever sets direction, which reads as broken alignment rather than a missing translation.
- Verified: no (no RTL capture or locale in the run; would verify by rendering picker, change, and review with dir="rtl" and comparing menu, resizer, and pin sides)
- Systemic: yes

### LAY-4: Editor and summary layouts for the same two refs break at different widths, and panel breaks read the viewport instead of the container
- Rule: 12 Hold structure until it breaks
- Severity: MEDIUM
- Confidence: medium
- Locations: `client/surfaces/change/ScopeCard.tsx:626`, `client/surfaces/change/ScopeCard.tsx:672`, `client/surfaces/change/ScopeCard.tsx:704`, `client/surfaces/progress/ProgressPanel.tsx:201`
- Evidence: The branch and compare editors stack at `max-[700px]` (ScopeCard lines 626 and 672, `grid-cols-[minmax(0,1fr)]`), but the resolved comparison summary that shares their grid only tightens at `max-[600px]` (line 704, `grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)]`). Between 601px and 700px the editor is one column while the summary stays side by side and squeezes both refs. Both read the viewport, yet the card sits inside a `max-w-[960px]` centred main (ChangeApp line 151), so viewport and card width part company on wide screens with narrow windows and on any future embedding. ProgressPanel line 201 grids its header at `max-[520px]` viewport width while the panel itself is `w-[min(460px,calc(100vw-36px))]` when floating and full container width in stage variant (line 95 and ExplainApp main at line 297), so the same header breaks at different panel widths per variant. review.css shows the project already knows the fix: `.ds-filedetail` and `.ds-railfiles` use `container-type: inline-size` with `@container` blocks at lines 668 and 711.
- Fix: Put the shared ref grid on one break. Either stack the summary at the same 700px step as the editors, or keep both side by side down to 600px. Prefer the container form the review surface uses: add `container-type: inline-size` to the ScopeCard section and convert the three `max-[700px]` and `max-[600px]` grid variants to `@container` variants (Tailwind v4 `@max-[700px]:` on children of a `@container` parent). Apply the same move to the ProgressPanel header, keyed to the panel root instead of the viewport.
- Why: One object (the two ref pair) changes shape at two widths a few dozen pixels apart, so a reviewer resizing through that band sees the summary jump sideways while the editor does not. Viewport breaks on embedded panels break at the wrong size whenever the host stage is narrower than the window.
- Verified: no (no capture lands between 601px and 700px on the change page and no narrow stage variant capture exists; would verify with 650px and 550px change captures and a stage progress capture at a narrow host width)
- Systemic: yes

### LAY-5: File basename in a changed file row cannot shrink, so a long name pushes the counts out
- Rule: 13 Plan for growth and clipping
- Severity: MEDIUM
- Confidence: medium
- Locations: `client/surfaces/change/FileSummary.tsx:55`, `client/surfaces/change/FileSummary.tsx:59`, `client/surfaces/change/FileSummary.tsx:75`
- Evidence: Current code at line 55 is `<span className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono" title={file.path}>`. Inside it the directory truncates (line 57, `min-w-0 flex-[0_1_auto] truncate`) but the basename at line 59 is `<span className="flex-none font-medium text-text">{name}</span>` with no shrink or truncation. The row then reserves `min-w-[78px]` for counts at line 75 plus a 42px bar. A long unbroken basename (the S1 boundary is an 80 plus character path, brief.md line 12) therefore keeps its full min-content width and pushes the bar and counts past the card edge. The S1 capture passed because that fixture put the length in the directory part, which does truncate (runtime.md line 80).
- Fix: Let the basename yield after the directory. Change line 59 to `min-w-0 flex-[0_1_auto] truncate font-medium text-text`, keeping `title={file.path}` on line 55 as the full path reveal. The counts cell keeps its fixed measure because numbers must stay aligned (rule 3).
- Why: File names with generated or hashed segments are normal in diffs. When one appears, the row loses its change counts off the right edge, which is the part of the row that says how big the change is.
- Verified: no (the injected S1 fixture lengthened the directory, not the basename; would verify with a file whose basename alone is 60 plus unbroken characters in the change file list at 375px and 1440px)
- Systemic: no

### LAY-6: Hairline separators paired with large gaps do the grouping twice
- Rule: 1 Group with space, not lines
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/stories/StoriesApp.tsx:156`, `client/surfaces/change/ChangeApp.tsx:74`
- Evidence: StoriesApp line 156 is `mb-[22px] flex items-end justify-between gap-7 border-b border-line-soft pb-[22px]`. The header already sits 22px below its rule and 22px above the list, so the hairline adds a second grouping signal on top of 44px of space. ChangeApp line 74 gives ReviewPath `border-y` with `py-2.5` inside an 18px top margin, a milder case of the same pairing. Dense lists are exempt: the file rows and story rows that use `border-b` per row were checked and rejected below.
- Fix: Drop the rule and keep the space. Remove `border-b border-line-soft` from the stories header and keep `pb-[22px]`, or keep the hairline and cut the padding to `pb-3`. Keep one signal per boundary across the page.
- Why: A rule plus a large gap reads as two boundaries, which makes the heading group look detached from the list it labels. Space alone already separates these groups at well over the 2x ratio rule 1 asks for.
- Verified: yes (screens/stories-1440x900-dark.png shows the header rule floating in space above the first row; code at StoriesApp line 156)
- Systemic: no

### LAY-7: Spacing values sit off the project scale across surfaces
- Rule: 4 Spacing comes from a scale
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/ChangeApp.tsx:49`, `client/surfaces/change/ChangeApp.tsx:87`, `client/surfaces/change/FileSummary.tsx:50`, `client/shared/nav.tsx:81`, `client/surfaces/stories/StoryRow.tsx:138`
- Evidence: Canonical spacing tokens are `--sp-1:4px` through `--sp-10:40px` at src/theme.ts line 177 (4, 8, 12, 16, 20, 24, 32, 40). Current code uses `gap-[3px]` and `py-[3px]` (ChangeApp line 49), `mx-[13px]` (line 87), `px-[15px] py-[9px]` (FileSummary line 50), `gap-[11px]` (nav.tsx line 81), and `px-[19px] py-[15px]` (StoryRow line 138). Each value is defensible alone. Together they are decisions nobody made twice, and the 15px versus 16px card insets (FileSummary line 50 against ScopeCard `p-4` at line 530) leave sibling cards one pixel off a shared edge.
- Fix: Round to the nearest scale step when each file is next touched: 15px insets to `px-4`, 9px row padding to `py-2`, 3px gaps to `gap-1`, and 13px separators to `mx-3`. Name and reuse any deliberate exception (the 44px target sizes) instead of adding new one off values.
- Why: Off scale values accumulate into stray edges that read as noise (rule 3) and make density changes a per file hunt instead of a token change.
- Verified: yes (token scale at src/theme.ts line 177 read against the quoted utilities; no capture needed for a code level claim)
- Systemic: yes

### LAY-8: Horizontal scrollers hide their scrollbar and give no peek at hidden content
- Rule: 8 Hint at hidden content
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/review/review.css:454`, `client/surfaces/review/review.css:1273`, `client/surfaces/review/review.css:394`
- Evidence: `.ds-reviewtabs` at line 454 is `overflow-x:auto` with `scrollbar-width:none`, and line 455 hides the webkit scrollbar. `.ds-filmthread-scroll` at line 1273 repeats the pattern for the step numerals, which are fixed 50px nodes (line 1276) in a `width:max-content` row (line 1275). `.ds-storyscope-actions` at line 394 scrolls scope chips with no fade or peek sizing. When a row happens to end flush with the edge it reads as complete, so a reviewer may never learn more tabs, steps, or chips exist.
- Fix: Size the first group so the next item peeks 16 to 32px past the edge, or add a trailing fade with `mask-image` on the scroll container in the project token colours. Keep the hidden scrollbar if a visible cue replaces it. The filmthread already centres numerals, so peeking the next numeral at narrow widths is the smallest change.
- Why: The filmthread is the whole step navigation in story view (Sidebar rail hides outside files view, review.css line 1230). Steps past the edge with no cue are steps a reviewer can miss entirely on a long story.
- Verified: no (S3 42 step rendering was not captured, runtime.md line 113, and the demo story has 8 steps which fit; would verify with a 20 plus step story at 375px and 1440px checking whether the next numeral peeks)
- Systemic: no

## Recommendations
- Add a narrow capture pair (375px and 650px) for the change page to the atlas set, since the 601 to 700px band and the nav intrinsic width are currently only caught by this run. Purpose: keep LAY-1 and LAY-4 from regressing. Evidence limits: no such captures exist today.
- Consider a container query pilot on the ScopeCard section only. Purpose: prove the `@container` pattern in a Tailwind surface before rolling it to progress and stories. Context: review.css already runs container queries in production at lines 668 and 711, so the risk is low. Evidence limits: not needed to close any finding above.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/FileSummary.tsx:50` | Per row `border-b` separators break rule 1 | Dense data list. Rule 1 exempts dense data such as tables and long lists, and row gaps here are 9px, not large gaps paired with rules. |
| `client/surfaces/review/review.css:247` | File filter pills sit 5px apart, under the 12px clearance in rule 9 | Compact professional tool density. Hit areas stay distinct at 27px height with pill shapes and never overlap. The lens exemption for established compact density applies. |
| `client/surfaces/stories/StoriesApp.tsx:171` | Three header actions compete with the one primary action (rule 6) | Only Start review carries the accent fill. Explain code and Import bundle are bordered secondary actions at the same height, which is a clear one primary pattern. |
| `client/surfaces/review/review.css:810` | Toast centred with `left:50%` is a physical property (rule 5) | Genuinely physical geometry. Centring is exempt in rule 5, and the toast pairs it with `env(safe-area-inset-bottom)`. |
| `client/surfaces/change/ScopeCard.tsx:106` | Segment track uses 4px gaps between controls (rule 9) | The four segments are compartments inside one recessed track, not adjacent bordered controls. The track reads as one control, which is the intent recorded at ScopeCard lines 99 to 104. |

## Handoffs
- A11Y: Clipping at 320px on the change page (overflowX=64px, runtime.md line 10, screens/change-320-dark.png) and on the review page (overflowX=6px, runtime.md line 47, screens/review-320-dark.png) is escalation trigger 5 and is A11Y owned. Layout root cause for change: the shared nav intrinsic width of 384px detailed in LAY-1 (`client/shared/nav.tsx:81`, `client/surfaces/change/ChangeApp.tsx:135`), which still overflows a 320px viewport by 64px after the 375px fix unless History collapses there too. Layout root cause for review: `.ds-reviewchrome` at `client/surfaces/review/review.css:1465` is a flex row with `gap:8px` whose actions island is `flex:none` (line 1470) holding a nowrap tab strip (`client/surfaces/review/review.css:1494`, tabs `flex:none` and `white-space:nowrap`), a 44px theme toggle, and a close control, beside a where island that carries the 44px mobile nav toggle (line 1480). The `max-width:340px` block at line 1548 trims padding and gaps to 0 and still lands 6px wide, so one tab or the close control must shrink or the viewtoggle must scroll at that width. Fix on the layout side belongs with the A11Y fix so both land together.
- A11Y: Target size on rail rows (`.ds-fileitem` and `.ds-filetree-dir>summary` at `client/surfaces/review/review.css:715` and line 728 are 28px tall until the 720px block at line 750 raises them to 44px). LAY owns only the clearance between them, which is fine. A11Y owns the size itself.
- TYP: Truncation mechanics for the yielding fields in LAY-2 and LAY-5. LAY picks which field shrinks. Ellipsis behaviour, `overflow-wrap`, and whether a truncated branch should wrap instead belong to TYP (`client/surfaces/picker/RecentRepos.tsx:218`, `client/surfaces/change/FileSummary.tsx:59`).
- VIS: Text only disclosures that read as plain text rather than controls, for example Earlier versions at `client/surfaces/stories/StoryHistory.tsx:109` and All files at `client/surfaces/review/StoryView.tsx:421`. LAY checked placement (both sit next to what they open, rule 7 holds). Whether they signal interactivity strongly enough is a VIS and A11Y name question.
- EXP: The S3 fixture fell back to the scope page when a sibling story file was requested (runtime.md line 82), so 1 step versus 42 step layout could not be exercised. If that fallback is the shipped behaviour for a stale story link, whether it explains itself belongs to EXP. The layout consequence is only that LAY-8 stays unverified.
