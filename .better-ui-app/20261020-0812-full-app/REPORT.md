# UI review: codeStory, whole app

## Scope and coverage
- Mode: full. Lenses: eight core (accessibility, layout, typography, color, copy, visual, motion, experience). Data viz did not run: no chart library or dashboard surface; Mermaid primers are documents, handed to VIS/TYP.
- Scope: all six React surfaces (picker, stories, change, review with review.css, progress, explain), shared chrome, canonical tokens in src/theme.ts. Excluded: macOS shell, Zed extension, eval harness, dist output, server logic except markup it emits.
- Platform: web (React 19, Tailwind v4, motion). Stack: utility TSX plus review.css for server-rendered diff rows.
- Project conventions read: DESIGN_MEMORY.md, DESIGN_PLAN.md, CONTRIBUTING.md, README.md.
- Runtime evidence: captured; desktop class (Chrome headless, desktop emulation at 375/768/320). 68 captures in screens/, light and dark, keyboard order, stress S1, S2, S4, S5. See runtime.md.
- Scenario coverage: long branch/path, long repo name, long diff line and zero counts passed. Not verified: 1 vs 42 step stories, 100+ files, true 200% zoom reflow, loading state, composer and drag paths, forced-colors and increased-contrast captures, any screen-reader run. Claims needing those say Not verified.

## Completed repairs (2026-10-20)

All 84 selected findings have implementation fixes. Eight independent lens rechecks report no remaining findings within the inspected scope. Their source conclusions do not imply device or screen-reader verification. Full records: `fixes/recheck/*.md`, `fixes/runtime-recheck.md`, and `fixes/screens/`. The original scorecard below is preserved as the audit baseline.

## Original scorecard (before fixes)
| Lens | Score | Findings | Key finding |
|---|---|---|---|
| Accessibility | 2/4 | 3 HIGH, 5 MEDIUM, 8 LOW | Review panels focus invisibly (A11Y-1) |
| Layout | 2/4 | 1 HIGH, 3 MEDIUM, 3 LOW | Nav overflows at 375px (LAY-1) |
| Typography | 2/4 | 0 HIGH, 5 MEDIUM, 4 LOW | Review type off token scale (TYP-1) |
| Color | 2/4 | 4 HIGH, 3 MEDIUM, 3 LOW | Syntax fails on diff emphasis (COL-2) |
| Copy | 2/4 | 0 HIGH, 6 MEDIUM, 11 LOW | One item, two names (COPY-2) |
| Visual | 3/4 | 0 HIGH, 3 MEDIUM, 7 LOW | Light islands lose edge (VIS-1) |
| Motion | 2/4 | 1 HIGH, 3 MEDIUM, 3 LOW | Carets ignore reduced motion (MOT-1) |
| Experience | 2/4 | 1 HIGH, 4 MEDIUM, 2 LOW | Bad repo route dead-ends (EXP-1) |

Overall: 17/32

## Findings
| # | ID | Severity | Lens | Location | Before | After | Why |
|---|---|---|---|---|---|---|---|
| 1 | COL-2 (Fixed) | HIGH | COL | `src/theme.ts:165`, `client/surfaces/review/review.css:1112` | Syntax ink 2.88:1 to 4.45:1 on emphasis tints | All tk pairs at 4.5:1 or better | The changed words are the hardest code to read, in both themes |
| 2 | EXP-1 (Fixed) | HIGH | EXP | `src/server.ts:1540` | Bare text Not found, no chrome | Branded 404 with Go to your repositories | A stale repo link strands the user outside the app |
| 3 | A11Y-1 (Fixed) | HIGH | A11Y | `client/surfaces/review/review.css:467` | Panel focus removes outline, no ring | shadow-focus ring on panels | Keyboard focus in the constant review loop is invisible (trigger 2) |
| 4 | A11Y-2 (Fixed) | HIGH | A11Y | `client/surfaces/review/StoryHealth.tsx:85` | Severity only a coloured dot, label unannounced | Visible Error or Warning text per row | Severity by colour alone, screen readers get none (trigger 7) |
| 5 | COL-1 (Fixed) | HIGH | COL | `client/surfaces/review/review.css:49` | accent-hi on accent-soft, 3.24:1 light | Alias points at accent-text, 5.84:1 | Active filter, wrap and read-aloud labels fail in light (trigger 6) |
| 6 | COL-4 (Fixed) | HIGH | COL | `client/surfaces/review/review.css:273` | Rail hues as small ink, 3.87:1 to 4.20:1 light | Canonical diff-add, amber and accent text inks | Badges, counts and eyebrows fail in light; fixes exist one rule away (trigger 6) |
| 7 | COL-3 (Fixed) | HIGH | COL | `client/surfaces/review/review.css:1278` | Dock numerals 3.89:1 and 4.23:1 light | text-2 inactive, accent-text active | Step controls under AA through the whole walkthrough (trigger 6) |
| 8 | MOT-1 (Fixed) | HIGH | MOT | `client/surfaces/review/review.css:720` | Six carets rotate with no reduced path | Carets added to reduce block at line 1457 | Frequent controls ignore reduced motion (trigger 4). Not verified at runtime |
| 9 | LAY-1 (Fixed) | HIGH | LAY | `client/shared/nav.tsx:81`, `client/surfaces/change/ChangeApp.tsx:135` | Bar 384px wide, History clipped, 9px at 375 and 64px at 320 | History collapses under 560px | A page action sits off screen with sideways scroll (trigger 5 at 320) |
| 10 | A11Y-3 (Fixed) | HIGH | A11Y | `client/surfaces/picker/RecentRepos.tsx:112` | Branch span cannot shrink, overflow 320px at 375 | min-w-0 truncate branch span | The checkout identifier is clipped and pushes the page sideways (trigger 5) |
| 11 | A11Y-9 (Fixed) | MEDIUM | A11Y | `client/surfaces/review/engine/review-engine.js:131` | Page reloads in 10s, no pause on hover or focus | Pause countdown in toast, or manual Reload | A timed reload can discard reading position mid-review |
| 12 | A11Y-6 (Fixed) | MEDIUM | A11Y | `client/surfaces/stories/RemoveStoryDialog.tsx:139`, `client/shared/use-modal.ts:161` | Focus drops on disable, restore targets deleted row | Guarded restore with dialog fallback | Removal loses the keyboard user twice |
| 13 | EXP-4 (Fixed) | MEDIUM | EXP | `client/surfaces/picker/RecentRepos.tsx:145` | Missing repo opens, fails, offers same retry | Open disabled for missing rows, Remove is the action | The app sends users into a failure it already knows |
| 14 | EXP-6 (Fixed) | MEDIUM | EXP | `client/surfaces/change/ScopeCard.tsx:310` | Ref click navigates with no busy state | Busy state on scope card before navigation | The central scope action gives no feedback until the next page |
| 15 | COL-5 (Fixed) | MEDIUM | COL | `client/shared/shared.css:232` | Theme and editor rings 1.15:1 to 1.22:1 | Canonical shadow-focus token | Chrome focus rings can vanish on tinted surfaces |
| 16 | TYP-1 (Fixed) | MEDIUM | TYP | `client/surfaces/review/review.css:125` | 26 one-off sizes, 8px to 34px | Sizes mapped to token scale | Same labels read at different sizes by file, slowing the scan |
| 17 | TYP-3 (Fixed) | MEDIUM | TYP | `client/surfaces/picker/Hero.tsx:25`, `client/shared/shared.css:361` | Weights 400, 650, 750, 900 and italic unloaded | Usage moved to loaded 500 to 700 | Synthesized faces smear, worst in the wordmark |
| 18 | VIS-1 (Fixed) | MEDIUM | VIS | `client/surfaces/change/ScopeCard.tsx:530` | border-transparent on near-zero light tonal step | border-line-soft hairline on islands | Light islands stop grouping their contents |
| 19 | VIS-3 (Fixed) | MEDIUM | VIS | `client/surfaces/progress/ProgressPanel.tsx:95`, `client/surfaces/review/review.css:1255` | Five shadow recipes, two on flat islands | One overlay recipe, islands flat | Same elevation reads at different depths per surface |
| 20 | A11Y-5 (Fixed) | MEDIUM | A11Y | `client/shared/theme-menu.tsx:93` | Theme menu stays open on Tab | Tab closes menu like editor menu | Two menus in one bar behave differently for one key. Systemic |
| 21 | A11Y-7 (Fixed) | MEDIUM | A11Y | `client/surfaces/review/Sidebar.tsx:338` | Reviewed state is hidden glyphs and titles | States named in the button aria-label | Screen-reader reviewers cannot tell which files need them |
| 22 | EXP-2 (Fixed) | MEDIUM | EXP | `client/surfaces/explain/ExplainApp.tsx:130` | Typed question lost on any navigation | Per-repo draft persistence or leave guard | One History click discards typed work |
| 23 | EXP-5 (Fixed) | MEDIUM | EXP | `client/surfaces/stories/StoryHistory.tsx:135` | Load error is text only | Try again button re-runs the fetch | A transient failure leaves a dead disclosure |
| 24 | TYP-2 (Fixed) | MEDIUM | TYP | `client/surfaces/explain/ExplainApp.tsx:368`, `client/surfaces/review/review.css:660` | Inputs at 11px to 13px on mobile | 16px small-width idiom, composer included | iOS zooms the page on focus. Not verified on device |
| 25 | TYP-5 (Fixed) | MEDIUM | TYP | `client/surfaces/review/review.css:1205` | 29 labels at 8.5px to 9.5px | Content labels at 10px token or better | Counts and flags lose legibility first in the rail |
| 26 | MOT-2 (Fixed) | MEDIUM | MOT | `client/shared/use-modal.ts:38` | Sheet hidden at 210ms, slide runs 340ms | Timer derived from spatial token | Every dialog exit snaps for its last third. Not verified |
| 27 | COPY-2 (Fixed) | MEDIUM | COPY | `client/surfaces/stories/story-state.ts:48` | Same item called note and comment | Comment everywhere, Note only a composer kind | Readers cannot tell if two backlogs exist. Systemic |
| 28 | COPY-6 (Fixed) | MEDIUM | COPY | `client/surfaces/review/engine/review-engine.js:3397` | Button reads Copy beside Add to queue | Copy comment | The one distinction the footer offers is hidden. Not verified |
| 29 | COL-6 (Fixed) | MEDIUM | COL | `src/theme.ts:145` | Contrast variant only in review, pairs unchanged | One contrast block in sharedTokens | Five surfaces never widen; worst pairs stay worst. Not verified |
| 30 | COL-7 (Fixed) | MEDIUM | COL | `client/styles.css:82` | Forced colors rescues only the focus ring | System-color borders for diff and badge states | Add and delete evidence loses its distinction. Not verified |

## Recommendations
| Location | Purpose and context | Suggested improvement | Evidence limits |
|---|---|---|---|
| `test/theme.test.mjs:44` | Guard the pairs that failed here | Add COL-1 to COL-4 and emphasis pairs to the existing contrast test | Token level only; cannot catch new literals |
| `client/shared/use-modal.ts:141` | Robustness for future dialogs | Move focus inside in the same effect that inerts the background | Runtime shows current consumers recover; suggestion only |
| `client/surfaces/progress/Milestones.tsx:62` | Progress advance reads as a tick | Bring 500ms fill to the 250ms progress tier | No live advance recording exists |

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/ChangeApp.tsx:14` | Missing entrance animation | Documented deliberate constraint; full navigations would replay it |
| `client/surfaces/review/ReviewApp.tsx:469` | Tabs lack arrow keys | Engine binds arrows, Home and End with roving tabindex |
| `client/surfaces/stories/RemoveStoryDialog.tsx:119` | Removal lacks undo | Correct irreversible treatment: named scope, Cancel first, distinct danger action |
| `client/surfaces/picker/PickerApp.tsx:149` | Repo removal is unguarded | Persistent undo toast exists; residual fragility is EXP-7 at LOW |
| `client/surfaces/change/ChangeApp.tsx:156` | Accent kickers break accent-means-interactive | Documented brand voice on every surface; links set apart by shape |

## Original verification (before fixes)
Checked: citation re-open script over every HIGH location, plus runtime.md overflow and capture records -> all HIGH claims hold in current code; one line drift corrected (src/server.ts 1480 to 1540).
Not verified: reduced-motion caret snap, modal exit truncation, 200% zoom reflow, forced-colors rendering, screen-reader announcements (what would verify each is named in its lens file).

## Verdict
Approve for the inspected web scope after fixes. Device, screen-reader and native browser-zoom coverage remain unverified.

## Repair status
84 Fixed, 0 Partly fixed, 0 Not fixed. The three merged IDs keep their canonical owners. No remaining finding or regression in the final independent rechecks.

## Appendix
MEDIUM beyond the cap: A11Y-4 picker has no skip link (`client/surfaces/picker/PickerApp.tsx:207`). COPY-3 depth choice has two name sets (`client/surfaces/review/StoryView.tsx:432`). COPY-4 excluded files in system terms (`client/surfaces/review/ReviewView.tsx:68`). COPY-5 Remove review vs Remove story (`client/surfaces/stories/StoryRow.tsx:281`). COPY-7 progress defaults give no cause (`client/surfaces/progress/state.ts:444`). EXP-3 unknown ref silently ignored, includes the A11Y-8 aria fix (`client/surfaces/change/ScopeCard.tsx:442`). LAY-3 physical properties block RTL (`client/surfaces/change/ChangeApp.tsx:49`). LAY-4 ref grids break at different widths (`client/surfaces/change/ScopeCard.tsx:626`). LAY-5 long basename pushes counts out (`client/surfaces/change/FileSummary.tsx:59`). MOT-3 step moves pay 340ms (`client/surfaces/review/review.css:1406`, Not verified). MOT-4 circuit trace replays 840ms (`client/surfaces/review/review.css:905`, Not verified). TYP-4 truncated names unreachable (`client/surfaces/stories/StoryRow.tsx:157`). VIS-2 masthead loop encloses empty space (`client/surfaces/picker/Hero.tsx:14`).
LOW: A11Y-10 filmstrip focus is scale only. A11Y-11 breadcrumb targets under 24px. A11Y-12 decorative icons not hidden (systemic). A11Y-13 aria-hidden on focusable input. A11Y-14 scrim lacks overscroll contain (systemic). A11Y-15 Explain disabled submit unexplained. A11Y-16 picker h1 is the brand. A11Y-17 milestone current state unexposed. COL-8 dead M3 colour rules. COL-9 one job, three token names. COL-10 on-accent spelled as literal. COPY-8 singular verb differ. COPY-9 lines labelled changes. COPY-10 Retry vs Try again (systemic). COPY-11 empty searches name no exit. COPY-12 History vs Review history. COPY-13 page titles run together. COPY-14 palette case mixes. COPY-15 skill has two names (systemic). COPY-16 bare Open links. COPY-17 visible Loading drops its object. COPY-18 Could not vs contractions (systemic). EXP-7 undo lives only in a dismissible toast. EXP-8 story removal invisible to sighted users. LAY-6 hairline plus large gap groups twice. LAY-7 spacing off scale (systemic). LAY-8 scrollers hide hidden content. MOT-5 narration width bounce off token. MOT-6 menus enter, never exit (systemic). MOT-7 hand-typed durations drift (systemic). TYP-6 heading sizes out of order. TYP-7 pixel type ignores user text size (systemic). TYP-8 hashes and counts lack safeguards. TYP-9 kicker tracking one-offs. VIS-4 nested radii not concentric (systemic). VIS-5 radius scale vs DESIGN_MEMORY drift (systemic). VIS-6 review radii off scale (systemic). VIS-7 icon stroke wanders (systemic). VIS-8 trailing-icon padding symmetric. VIS-9 diagram frame tinted, gradient (Not verified). VIS-10 primary pill at two heights (systemic).

## Fix log
| ID | Status | What changed | Verification |
|---|---|---|---|
| A11Y-1 | Fixed | Review panels show the canonical focus ring. `client/surfaces/review/review.css:464` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-2 | Fixed | Every finding names its severity in visible text. `client/surfaces/review/StoryHealth.tsx:86` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-3 | Fixed | Long branch labels yield and reveal their full value. `client/surfaces/picker/RecentRepos.tsx:112` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-4 | Fixed | Skip navigation lands after the repeated Hero controls. `client/surfaces/picker/PickerApp.tsx:228` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-5 | Fixed | Tab closes the theme menu and continues normal focus order. `client/shared/theme-menu.tsx:94` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-6 | Fixed | Deleted triggers restore to a stable page target; busy removal stays in its dialog. `client/shared/use-modal.ts:170` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-7 | Fixed | File names retain reviewed, unexplained and regenerated states after engine updates. `client/surfaces/review/engine/review-engine.js:2933` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-9 | Fixed | Hover and focus pause the remaining reload countdown; cancellation cannot restart it. `client/surfaces/review/engine/review-engine.js:141` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-10 | Fixed | Filmstrip focus has a perimeter as well as optional magnification. `client/surfaces/review/review.css:1274` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-11 | Fixed | Breadcrumb controls have expanded targets. `client/surfaces/picker/FolderBrowser.tsx:347` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-12 | Fixed | Decorative icons are hidden from assistive technology across the repaired surfaces. `client/surfaces/picker/Hero.tsx:18` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-13 | Fixed | The programmatically focusable import control is no longer aria-hidden. `client/surfaces/stories/StoriesApp.tsx:224` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-14 | Fixed | The modal scrim contains overscroll. `client/shared/shared.css:158` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-15 | Fixed | The disabled submit action has a persistent explanation. `client/surfaces/explain/ExplainApp.tsx:544` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-16 | Fixed | Repositories is the actual page heading; the brand is decorative identity. `client/surfaces/picker/PickerApp.tsx:228` | Project checks pass; independent lens recheck. See runtime limits below. |
| A11Y-17 | Fixed | Current milestone and step states are exposed as text and semantics. `client/surfaces/progress/Milestones.tsx:47` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-1 | Fixed | Active small labels use semantic accent ink. `client/surfaces/review/review.css:49` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-2 | Fixed | Syntax emphasis passes AA in both themes; focus blue stays in the gutter. `src/theme.ts:165` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-3 | Fixed | Step numerals use text-2 and accent-text rather than dim rail mixtures. `client/surfaces/review/review.css:1276` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-4 | Fixed | Badge, count, annotation and status text use dedicated semantic inks. `client/surfaces/review/review.css:273` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-5 | Fixed | Shared menu focus uses the canonical focus token. `client/shared/shared.css:233` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-6 | Fixed | Increased contrast is canonical for every surface, without a later global override. `src/theme.ts:206` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-7 | Fixed | System colors preserve diff, badge, focus and current-control distinctions. `client/styles.css:82` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-8 | Fixed | Dead M3 aliases and superseded intro color rules were removed. `client/surfaces/review/review.css:64` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-9 | Fixed | The bridge documents vendor-only aliases and first-party semantic tokens. `scripts/build-theme-css.mjs:119` | Project checks pass; independent lens recheck. See runtime limits below. |
| COL-10 | Fixed | Progress primaries use their paired on-accent ink. `client/surfaces/progress/ProgressPanel.tsx:432` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-2 | Fixed | Queued items are consistently called comments. `client/surfaces/stories/story-state.ts:12` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-3 | Fixed | Story depth choices use Quick tour, Guided tour and Deep dive throughout. `client/surfaces/review/StoryView.tsx:434` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-4 | Fixed | Excluded-file and coverage prose describe visible behavior in plain words. `client/surfaces/review/engine/review-engine.js:3111` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-5 | Fixed | The removal action and confirmation name the same object. `client/surfaces/stories/StoryRow.tsx:273` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-6 | Fixed | The composer names what Copy copies. `client/surfaces/review/engine/review-engine.js:3446` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-7 | Fixed | Default failures explain the next recovery step; server details still win. `client/surfaces/progress/state.ts:444` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-8 | Fixed | Singular and plural divergent-version verbs agree. `client/surfaces/review/ReviewApp.tsx:132` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-9 | Fixed | Both coverage counts identify changed lines. `client/surfaces/review/ReviewView.tsx:228` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-10 | Fixed | Visible recovery labels consistently say Try again. `client/surfaces/review/engine/review-engine.js:2405` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-11 | Fixed | Empty searches explain how to clear or revise the query. `client/surfaces/picker/FolderBrowser.tsx:452` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-12 | Fixed | Navigation names the destination and consistently uses Review history. `client/shared/nav.tsx:8` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-13 | Fixed | Document titles use one surface-name pattern. `src/server.ts:1630` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-14 | Fixed | Palette commands and explanatory flags use sentence case. `client/surfaces/review/ReviewApp.tsx:257` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-15 | Fixed | Skill names and manual installation instructions agree across the app. `client/surfaces/picker/SkillBanner.tsx:64` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-16 | Fixed | History links name the version they open. `client/surfaces/stories/StoryHistory.tsx:199` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-17 | Fixed | Loading labels identify the work in progress. `client/surfaces/picker/FolderBrowser.tsx:264` | Project checks pass; independent lens recheck. See runtime limits below. |
| COPY-18 | Fixed | Error voice consistently uses clear, non-contracted recovery prose. `client/surfaces/review/engine/review-engine.js:3990` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-1 | Fixed | Missing page-like routes have themed 404 recovery; APIs/assets retain plain 404. `src/server.ts:4675` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-2 | Fixed | Per-repository drafts restore after navigation and clear after successful completion. `client/surfaces/explain/ExplainApp.tsx:107` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-3 | Fixed | Committed refs resolve with Git, including tags, full hashes and revision expressions; invalid text remains with an associated error. `src/server.ts:1142` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-4 | Fixed | Missing repositories cannot invoke an already-known failing Open action. `client/surfaces/picker/RecentRepos.tsx:164` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-5 | Fixed | History failures can retry the correct load or restore request. `client/surfaces/stories/StoryHistory.tsx:159` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-6 | Fixed | Scope navigation exposes busy feedback before leaving the page. `client/surfaces/change/ScopeCard.tsx:320` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-7 | Fixed | The most recent repository removal retains a visible Restore path after toast dismissal. `client/surfaces/picker/PickerApp.tsx:121` | Project checks pass; independent lens recheck. See runtime limits below. |
| EXP-8 | Fixed | Story removal confirms visibly, without placing background controls above a later dialog. `client/surfaces/stories/StoriesApp.tsx:322` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-1 | Fixed | Shared navigation wraps before intermediate-width overflow; narrow review chrome scrolls only its tabs. `client/shared/nav.tsx:88` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-3 | Fixed | Direction-dependent menu, gutter, row and marker alignment uses logical properties. `client/surfaces/review/review.css:1053` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-4 | Fixed | Ref editors and summaries use matching container breakpoints; progress responds to its own panel. `client/surfaces/change/ScopeCard.tsx:557` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-5 | Fixed | Long basenames yield without pushing counts away and can reveal their full path. `client/surfaces/change/FileSummary.tsx:56` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-6 | Fixed | Page groups use spacing without redundant floating separator lines. `client/surfaces/stories/StoriesApp.tsx:167` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-7 | Fixed | Cited card, row, nav and metric spacing follows the project scale. `client/shared/nav.tsx:86` | Project checks pass; independent lens recheck. See runtime limits below. |
| LAY-8 | Fixed | Horizontal tabs and filmstrip retain visible scroll/peek cues. `client/surfaces/review/review.css:1036` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-1 | Fixed | All disclosure carets have an instant reduced-motion path. `client/surfaces/review/review.css:1645` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-2 | Fixed | Modal visibility and close timers share the 340 ms spatial budget. `client/shared/shared.css:161` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-3 | Fixed | Repeated step moves use 150 ms opacity handoffs; interruption remains supported. `client/surfaces/review/review.css:1639` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-4 | Fixed | Annotation traces and arrowheads finish within the 250 ms progress budget. `client/surfaces/review/review.css:902` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-5 | Fixed | Narration width changes without a layout tween or one-off bounce. `client/surfaces/review/review.css:1528` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-6 | Fixed | Shared and review menus use retargetable discrete transitions with brief exits. `client/shared/shared.css:555` | Project checks pass; independent lens recheck. See runtime limits below. |
| MOT-7 | Fixed | Interface durations and easing follow the motion tokens. `client/surfaces/review/review.css:756` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-1 | Fixed | Review text uses the common token scale. `client/surfaces/review/review.css:150` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-2 | Fixed | Comment and Explain inputs use 16 px on small/coarse-pointer contexts. `client/surfaces/review/review.css:1648` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-3 | Fixed | Unsupported weights and synthesized italic styling were removed. `client/surfaces/review/review.css:342` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-4 | Fixed | Truncated names have keyboard/touch full-value paths; tooltips stay in the viewport. `client/vendor/beui/motion/tooltip.tsx:236` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-5 | Fixed | Content flags and counts use the 10 px token floor. `client/surfaces/review/review.css:125` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-6 | Fixed | Page and section headings retain a meaningful hierarchy. `client/surfaces/review/review.css:440` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-7 | Fixed | Type tokens, arbitrary text utilities and concept fitting respect root-font enlargement. `src/theme.ts:174` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-8 | Fixed | Large counts group digits; hashes expose slashed-zero formatting without altering identifiers. `client/surfaces/review/format.ts:9` | Project checks pass; independent lens recheck. See runtime limits below. |
| TYP-9 | Fixed | Kicker tracking and review line heights use the common role conventions. `src/theme.ts:175` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-1 | Fixed | Light story/repository/file/scope islands retain a subtle grouping edge. `client/surfaces/stories/StoryRow.tsx:108` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-2 | Fixed | The masthead thread passes behind the lockup without enclosing empty space. `client/surfaces/picker/Hero.tsx:15` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-3 | Fixed | Floating overlays share the shadow token and in-flow docks stay flat. `client/surfaces/review/review.css:1253` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-4 | Fixed | Nested fields, tracks and segments derive concentric radii from actual insets. `client/surfaces/explain/ExplainApp.tsx:83` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-5 | Fixed | Design documentation matches shipped geometry and records nested-radius exceptions. `DESIGN_MEMORY.md:10` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-6 | Fixed | Review controls consolidate off-scale corner radii onto the common scale. `client/surfaces/review/review.css:173` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-7 | Fixed | Icon stroke weights match adjacent text and documented exceptions. `client/surfaces/change/FileSummary.tsx:105` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-8 | Fixed | Trailing-icon primaries use smaller padding on the icon side. `client/surfaces/review/review.css:1369` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-9 | Fixed | Diagram frames use a flat surface and neutral outline; focus retains its stronger ring. `client/surfaces/review/review.css:1307` | Project checks pass; independent lens recheck. See runtime limits below. |
| VIS-10 | Fixed | Page-level primary actions consistently use the 40 px control height. `client/surfaces/picker/PickerApp.tsx:243` | Project checks pass; independent lens recheck. See runtime limits below. |

## Verification after repairs

- `npm run check`: 1,084 tests passed, 0 failed, 0 skipped, including build and client typecheck. New behavioral coverage confirms reload pause/resume/cancellation and valid Git refs outside suggestions. Contrast checks guard every syntax ink on add/delete word emphasis in both themes.
- Repository browser smoke:desktop and mobile reduced-motion flows passed, covering selection, queue, clipboard, challenge, caller source, receipt, drift, refresh and preservation rejection.
- 47 final captures reported no horizontal overflow and no page errors. Rendered scenarios and exact measurements are listed in `fixes/runtime-recheck.md`; those include 320/375/650/1440 widths, both themes, long names, native forced-color/reduced-motion/increased-contrast media, root-font stress, unknown/valid refs and Explain draft navigation.
- T3 preview:actual step 1→2→3→2 interaction settled on one ready primer; the recording is `fixes/recordings/step-reversal.mp4`. Code and primer captures are `fixes/screens/review-code-preview.png` and `review-primer-preview.png`. Keyboard arrow presses advanced beats rather than changing the selected step; filmstrip clicks were used to verify the step reversal.
- `git diff --check`:passed. Checked-in build assets were regenerated. No commit or publication performed.

Limits:desktop-class Chromium emulation, not physical iOS/Android hardware. No screen-reader listening session, native browser 200% zoom, exhaustive high-contrast OS palette or performance/FPS proof. Root-font 200% is explicitly font stress, not page zoom. A failed early capture used an invalid one-step fixture; its fallback was not treated as successful story coverage, and the fixture was replaced before the final run. Motion smoothness is not established by a short recording.

Integration followup:the existing export cleanup test exposed a timing race in terminal error publication. The error state is now published after temporary source data cleanup; the existing cancellation and failure tests pass. Existing unrelated video/narration work was preserved.
