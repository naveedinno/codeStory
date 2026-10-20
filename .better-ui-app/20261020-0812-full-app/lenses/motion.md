# Motion findings
Scope inspected: motion tokens in `src/theme.ts` `sharedTokens()` and `client/shared/motion.ts`; `client/shared/shared.css` keyframes and scrim/sheet/theme/editor menus; `client/shared/theme-menu.tsx` theme-swap suppression and `client/shared/use-modal.ts` close timing; review engine workspace transitions, concept entrances, circuit trace and film magnification in `client/surfaces/review/engine/review-engine.js` with `client/surfaces/review/review.css`; Change `ScopeCard` panels and `RefPicker` listbox, Stories list exit, Progress panel and milestones, picker/stories/nav press and hover behaviour; runtime stills and scenario outcomes in `runtime.md` (no recordings, so smoothness, reversal feel and timing were not verified from runtime).
Not inspected: Rule 7 springs and Rule 8 pointer gestures beyond sidebar/split resize batching (no drag, flick or rubber-band surface exercised in runtime; dismiss-during-entry and split-divider drag listed as not verified in `runtime.md`), Rule 17 multimodal feedback (no sound or haptics surface found in scope), Rule 16 sequential tooltip delay (no toolbar tooltip sequence captured), frame rate or jank under load (no recording or performance trace).
Score: 2/4, one reduced-motion escalation caps the lens at 2 despite disciplined tokens, origins and interruptible workspace handoffs elsewhere.

## Findings

### MOT-1: Disclosure caret rotations keep running under reduced motion in the review surface
- Rule: 12 Reduced motion
- Severity: HIGH (Trigger: Motion or autoplaying content that ignores the reduced-motion preference)
- Frequency: frequent (assumption from `brief.md` frequency map: sidebar file and step selection tens to 100+ per session; the file-tree caret is part of that loop)
- Confidence: high
- Locations: `client/surfaces/review/review.css:333`, `client/surfaces/review/review.css:388`, `client/surfaces/review/review.css:720`, `client/surfaces/review/review.css:1195`, `client/surfaces/review/review.css:1199`, `client/surfaces/review/review.css:1374`
- Evidence: `client/surfaces/review/review.css:720` ".ds-filetree-caret{transform-origin:center;transition:transform .12s ease}" with `client/surfaces/review/review.css:721` rotating to 90deg on open, and the same pattern at `client/surfaces/review/review.css:333` ".ds-intro-evolution-caret{...transition:transform var(--motion-duration-fast) var(--motion-ease-in-out)}", `client/surfaces/review/review.css:388` ".ds-storyscope-caret{...transition:transform var(--motion-duration-fast) var(--motion-ease-in-out)}", `client/surfaces/review/review.css:1195` and `client/surfaces/review/review.css:1199` rail carets, and `client/surfaces/review/review.css:1374` ".ds-intro-notes-caret{...transition:transform var(--motion-duration-fast) var(--motion-ease-in-out)}". The two reduced-motion blocks at `client/surfaces/review/review.css:1170` and `client/surfaces/review/review.css:1457` suppress `.ds-fileitem`, `.ds-tab`, `.ds-filmnode-num` and others but name none of these six caret selectors, and no global reduced-motion fallback exists in `client/styles.css`. Two sibling carets do it correctly, at `client/surfaces/review/review.css:490` and `client/surfaces/review/review.css:536`, which proves the omission is drift, not a house rule.
- Fix: add the six caret selectors to the existing `client/surfaces/review/review.css:1457` reduced-motion block in project idiom, for example `.ds-filetree-caret,.ds-intro-evolution-caret,.ds-storyscope-caret,.ds-intro-notes-caret,.ds-railskim>summary::before,.ds-railchapter>summary::before{transition:none!important}` so the caret snaps to its open or closed angle with the static rotation state still showing direction.
- Why: Rule 12 requires every moving animation to have a reduced path, and the report escalation makes motion that ignores `prefers-reduced-motion` HIGH on sight. A rotating caret is small, but it is transform motion on a frequent control with no opt-out, while the rest of the app carefully gates the same class of motion.
- Verified: no (code proves the transitions are unguarded; confirming the rendered snap needs a `prefers-reduced-motion: reduce` emulation pass toggling a file-tree folder, an evolution disclosure and a rail chapter)
- Systemic: yes

### MOT-2: Modal close timer hides the sheet before its own exit transition finishes
- Rule: 3 Duration budgets, 6 Interruptible by default
- Severity: MEDIUM
- Frequency: occasional (folder-browser and remove-story dialogs, a few per session per `brief.md`)
- Confidence: high
- Locations: `client/shared/use-modal.ts:38`, `client/shared/shared.css:172`
- Evidence: `client/shared/use-modal.ts:38` "export const MODAL_CLOSE_MS = 210;" documented as the sheet exit budget, while `client/shared/shared.css:176` to `client/shared/shared.css:178` give the sheet "transform var(--motion-duration-spatial) var(--motion-ease-drawer), opacity var(--motion-duration-ui) ease" and `src/theme.ts:181` sets "--motion-duration-spatial:340ms". The 210ms timer in `client/shared/use-modal.ts:164` therefore re-applies `hidden` about 130ms before the 340ms slide finishes, so the fade completes and the last third of the slide is cut. `runtime.md` lists dismiss-during-entry as not verified, and the stills cannot show the truncation.
- Fix: derive the timer from the same token the sheet animates with, for example set `MODAL_CLOSE_MS` to the spatial duration (340ms, or 324ms allowing one frame) in `client/shared/use-modal.ts:38`, keeping the existing `prefersReducedMotion() ? 0` branch, so the comment at `client/shared/use-modal.ts:37` becomes true.
- Why: An exit that is hidden mid-flight reads as a snap on every dialog dismissal. The choreography is otherwise exemplary (rAF entry, re-entrancy guards, reopen cancels the timer), so this is a single mismatched constant, not a redesign.
- Verified: no (a slowed dismissal recording of the folder browser at 10% speed would show whether the slide completes)
- Systemic: yes

### MOT-3: Constant step navigation pays a 340ms spatial transition on every move
- Rule: 1 Purpose and frequency decide, 3 Duration budgets
- Severity: MEDIUM
- Frequency: constant (100+ per session assumed in `brief.md`: step and beat navigation is the core review loop)
- Confidence: medium
- Locations: `client/surfaces/review/engine/review-engine.js:668`, `client/surfaces/review/review.css:1406`
- Evidence: `client/surfaces/review/engine/review-engine.js:668` "function runWorkspaceTransition(kind,direction,update)" routes `view`, `file`, `step` and `mode` moves through `document.startViewTransition`, and `client/surfaces/review/review.css:1406` to `client/surfaces/review/review.css:1407` set "::view-transition-group(ds-workspace-surface){animation-duration:var(--motion-duration-spatial);animation-timing-function:var(--motion-ease-drawer)}" where `src/theme.ts:181` defines spatial as 340ms. The fallback path at `client/surfaces/review/review.css:1404` uses the same 340ms. Interruption is handled well (`skipTransition()` at `client/surfaces/review/engine/review-engine.js:671` and reduced-motion bypass at `client/surfaces/review/engine/review-engine.js:670`), and `runtime.md` scenario "Motion: rapid step navigation" settled coherently after ArrowRight x6, but a still cannot prove the 340ms cross-slide does not tax rapid stepping.
- Fix: keep the spatial transition for `view` switches (frequent tab moves) and shorten or drop it for `step` moves in the token idiom, for example a step-scoped duration at the fast tier (150ms) or an opacity-only crossfade, leaving `runWorkspaceFallback` with the same split.
- Why: Rule 1 reserves full spatial motion for occasional surfaces and asks constant interactions to prefer instant state changes, with at most a 100 to 150ms opacity or color change for frequent ones. Step stepping is the one constant animated loop in the app, so it is the one place the otherwise sound 340ms token works against frequency. This is a candidate to verify in context, not proof of delay, because the transition is interruptible and never blocks input.
- Verified: no (a normal-speed and 10% slowed replay of ArrowRight stepping through a long story, checking whether the next step is readable before the slide settles, would confirm or clear it)
- Systemic: no

### MOT-4: Circuit trace replays a 620ms keyframe sequence on step changes
- Rule: 1 Purpose and frequency decide, 6 Interruptible by default
- Severity: MEDIUM
- Frequency: constant (assumption: annotation tracing is tied to the same step navigation classed constant in `brief.md`)
- Confidence: medium
- Locations: `client/surfaces/review/review.css:905`
- Evidence: `client/surfaces/review/review.css:905` ".ds-annot.is-tracing .ds-annot-box:not(.is-dashed),.ds-annot.is-tracing .ds-annot-arrow:not(.is-dashed){stroke-dasharray:1;stroke-dashoffset:1;animation:ds-circuit-trace 620ms var(--motion-ease-out) forwards}" with heads at 660ms delay and dashed traces at "760ms linear 120ms both", so a full trace spans about 840ms. It is a `@keyframes` sequence, so stepping again before it finishes restarts from zero rather than retargeting, unlike the transition-based workspace handoff. Reduced motion is handled at `client/surfaces/review/review.css:1457` (".ds-annot *{animation:none!important}"), so this is a frequency and interruptibility concern, not a reduced-motion one.
- Fix: shorten the trace for repeat steps in the token idiom (for example the progress tier at 250ms with delays compressed proportionally), or trace only on first visit to a step and show the finished annotation statically on revisits, keeping the one explanatory play where it teaches.
- Why: The trace has a real purpose (explaining which code the annotation binds), which earns it room on a first encounter. On the constant stepping loop the same 840ms replay becomes decoration that the reader must wait past, and its keyframe form cannot be grabbed or reversed mid-flight as Rule 6 asks of repeatedly triggered motion.
- Verified: no (stepping rapidly between two annotated steps while watching whether the trace restarts, and whether the annotation is legible before it completes, would confirm the cost)
- Systemic: no

### MOT-5: Narration button animates width with an off-token bounce
- Rule: 2 Easing by job, 11 Performance, 15 Cohesion and tokens
- Severity: LOW
- Frequency: occasional (narration play, pause and loading states in the review dock, a few per session assumed)
- Confidence: high
- Locations: `client/surfaces/review/review.css:1519`
- Evidence: `client/surfaces/review/review.css:1519` ".ds-dock .ds-readaloud-primary{width:86px;overflow:hidden;transition:width var(--motion-duration-ui) cubic-bezier(.34,1.36,.64,1),...}" growing to 119px and 126px in its active, loading and paused states. That is a layout property animated every frame, eased with a one-off overshoot curve that appears nowhere in the `--motion-*` tokens at `src/theme.ts:180`, in a calm instrument-grade product where every other curve is one of three Signal tokens.
- Fix: keep the label swap and drop the width leg, or express the growth as a `transform: scaleX` on an inner track; if the width must stay, ease it with `var(--motion-ease-out)` so the control at least speaks the house curves.
- Why: Rule 11 prefers `transform` and `opacity` because width animation forces layout each frame, and Rule 15 treats a single bouncy curve in a crisp product as token drift. The dock sits next to streaming diff content, so the layout work lands exactly when the main thread is busiest. Impact is isolated polish, hence LOW.
- Verified: no (a dock recording across Play, loading and Pause at normal speed, plus a layout-thrash check in performance tooling, would size the cost)
- Systemic: no

### MOT-6: Anchored menus animate in with keyframes and snap out with no exit
- Rule: 3 Duration budgets, 6 Interruptible by default, 9 Entrances, exits and stagger
- Severity: LOW
- Frequency: occasional (theme menu, editor menu, story-tune and file-filter pops, a few per session per `brief.md`)
- Confidence: high
- Locations: `client/shared/shared.css:303`, `client/shared/shared.css:496`, `client/surfaces/review/review.css:1402`
- Evidence: `client/shared/shared.css:304` ".ds-theme-menu:not([hidden]){animation: ds-anchored-pop var(--motion-duration-ui) var(--motion-ease-out) backwards}" and the identical pattern for the editor menu at `client/shared/shared.css:498` and review pops at `client/surfaces/review/review.css:1402`, all `@keyframes` entrances at `client/shared/shared.css:315`. Closing only toggles `hidden` (for example `client/shared/theme-menu.tsx:147` flipping state), so there is no exit motion at all: the pop plays in over 200ms and vanishes instantly, and reopening inside 200ms restarts the keyframe from zero instead of retargeting. Origins are correct throughout (`client/shared/shared.css:262` "transform-origin:calc(100% - 17px) -7px"), and `runtime.md` scenario "Motion: rapid theme-menu toggle" settled with no stuck menu, which bounds the harm.
- Fix: leave the entrances as they are, or, if an exit is wanted, move these three pops to the transition plus `@starting-style` form the lens prescribes so open and close retarget from the current value with a shorter exit (about 150ms against the 200ms entrance) using the existing `--motion-duration-ui` and `--motion-ease-out` tokens.
- Why: Asymmetry itself is correct (exits should be shorter and softer), but an instant cut after a 200ms entrance is the limiting case, and keyframes are the one mechanism here that cannot retarget on rapid re-trigger. With correct origins, token timings and a clean rapid-toggle outcome, this is polish, not a feel defect, hence LOW.
- Verified: no (rapidly reopening the theme menu inside its entrance at slowed speed would show whether the restart is visible in practice)
- Systemic: yes

### MOT-7: Hand-typed durations and eases drift from the motion tokens in the review stylesheet
- Rule: 15 Cohesion and tokens
- Severity: LOW
- Frequency: frequent (the drifted transitions sit on tabs, rows, carets and step cards used tens of times per session; the finding is about the token system, not one control)
- Confidence: high
- Locations: `client/surfaces/review/review.css:228`, `client/surfaces/review/review.css:235`, `client/surfaces/review/review.css:720`, `client/surfaces/review/review.css:812`, `client/surfaces/review/review.css:1200`, `client/surfaces/review/review.css:1370`
- Evidence: against the five durations and three curves at `src/theme.ts:180` to `src/theme.ts:181`, the review stylesheet hand-types `client/surfaces/review/review.css:228` "transition:background .12s", `client/surfaces/review/review.css:235` "transition:background .16s,color .16s", `client/surfaces/review/review.css:720` "transition:transform .12s ease", `client/surfaces/review/review.css:812` "transition:opacity var(--motion-duration-ui),transform var(--motion-duration-ui)" with no easing token at all, `client/surfaces/review/review.css:1200` "transition:background .12s ease,color .12s ease", and `client/surfaces/review/review.css:1370` "transition:background-color 120ms ease-out,transform 100ms ease-out" for `.ds-intro-start`. Each value is individually inside budget; together they are the five almost-matching curves Rule 15 calls one consolidation finding, and they will drift further because nothing ties them to the tokens.
- Fix: consolidate onto the existing tiers in place, mapping `.12s` and the 100 to 120ms literals to `var(--motion-duration-press)`, `.16s` to `var(--motion-duration-fast)`, and bare `ease` on interface motion to `var(--motion-ease-out)`, leaving explanatory and progress motion on `var(--motion-ease-in-out)` as now.
- Why: The token layer is the app's stated source of truth (`client/shared/motion.ts:3` to `client/shared/motion.ts:6` exists precisely to stop hand-typed beziers), and the React surfaces honour it. The server-rendered review surface is the one place the discipline lapses, so a future timing change would silently miss the busiest surface.
- Verified: yes (side-by-side reading of `src/theme.ts:180` against each cited rule; no runtime claim is made about feel)
- Systemic: yes

## Recommendations
- Location `client/surfaces/progress/Milestones.tsx:62`, purpose and context: the milestone segment fill is the progress panel's honest "how far through" signal (occasional, system-driven). Suggested improvement: bring "after:duration-500" down to the progress tier the tokens already define (250ms) so a milestone advance reads as a tick rather than a sweep. Evidence limits: no recording of a live run advancing milestones exists, so the 500ms fill has not been seen in context; this does not reduce the score.
- Location `client/shared/shared.css:120`, purpose and context: the picker and stories entrances (rare to occasional page arrivals). Suggested improvement: none needed beyond noting the 20ms and 70ms `ds-reveal` delays at `client/shared/shared.css:124` and `client/shared/shared.css:127` already sit inside the 30 to 80ms stagger band in spirit and land well; keep them. Evidence limits: stills only, entrance feel not verified.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/ChangeApp.tsx:14` | Missing entrance animation on the change page | Documented deliberate constraint, restated in the file header and protected by assertions: every scope change is a full navigation, so a replayed entrance would fight the user. Treated as intentional per instructions, and no runtime evidence shows harm. |
| `client/surfaces/change/ScopeCard.tsx:503` | Panel unfold animates `height` (a layout property) | Small isolated disclosure on an occasional surface, interruptible through Motion with `initial: false`, asymmetric opacity (0.2s in, 0.14s out), and a subtle 0.992 scale. Rule 11 permits a small isolated layout animation that performs well; no jank was observed. |
| `client/surfaces/change/refs.ts:175` | Ref listbox `transform-origin` at 50% | `placePicker` sets "50% 100%" or "50% 0%" by placement and the listbox is exactly the field's width, so the horizontal centre is the trigger's centre. Origin-aware for this geometry; the clip-path reveal carries the anchoring. |
| `client/surfaces/review/review.css:145` | Looping spinners and pulses (`ds-tri-spin`, `dsSpin`, shimmer, waveform) ignore reduced motion | Each one is in fact suppressed: `client/surfaces/review/review.css:147`, `client/surfaces/review/review.css:1385`, `client/surfaces/review/review.css:1457` and the `motion-reduce:animate-none` utilities in `client/surfaces/progress/PlanList.tsx:66` and `client/surfaces/picker/PickerApp.tsx:81`. Spinners also correctly keep a static state under reduce elsewhere via instant rendering. |
| `client/shared/theme-menu.tsx:126` | Theme switch smears every color transition | Both the React control and the bootstrap at `src/theme.ts:79` inject "transition:none !important", force a reflow and remove the override on the next frame, exactly as Rule 14 prescribes. The rapid-toggle scenario settled cleanly. |

## Handoffs
- A11Y: none from this lens. Reduced-motion handling inside animations is owned here (MOT-1); no autoplay or timed-content issue was found that belongs to accessibility.
- EXP: none. No missing loading or success state was judged from motion evidence; the unexercised composer and loading scenarios in `runtime.md` are coverage gaps, not motion defects.
