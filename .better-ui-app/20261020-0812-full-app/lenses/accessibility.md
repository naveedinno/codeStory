# Accessibility findings
Scope inspected: All six React surfaces (picker, stories, change, review including review.css diff rows, progress, explain), shared chrome (client/shared/nav.tsx, theme-menu.tsx, editor-menu.tsx, use-modal.ts, brand.tsx, mount.tsx, shared.css), client/styles.css, canonical tokens in src/theme.ts, the shell in src/shell.ts, diff row markup in src/diff-render.ts, keyboard and modal handling in client/surfaces/review/engine/review-engine.js, and runtime.md with its screenshots in screens/. Code sweeps covered clickable non-native elements, focus removal, positive tabindex, aria-hidden over focusables, missing names and labels, disabled submit buttons, timers, autoplay, viewport limits, and fixed heights on text.
Not inspected: Rule 14 at a true 200 percent zoom (runtime.md records that the CDP scale did not change the layout, so the zoom captures do not verify reflow; the 320px captures are the narrow width evidence), Rule 10 announcements with a real screen reader (no assistive technology run exists; live region behaviour is code-supported only), the comment composer and split divider drag path (runtime.md lists them as not exercised), the ref picker listbox open state (runtime.md lists it as not captured), progress failed, stopped and blocked states (only running and complete fixtures were captured), 1 step versus 42 step story rendering and 100 plus file counts (fixtures could not be injected), physical touch hardware and mobile browser chrome (desktop emulation only, and mobile is secondary in the brief), contrast ratios (owned by COL, classified here only).
Score: 2/4, three HIGH findings remain, including a keyboard reachable region with no focus indicator and severity shown by colour alone.

## Findings

### A11Y-1: Review tab panels are Tab reachable with no visible focus indicator
- Rule: 3. Visible focus, and 4. Full keyboard support
- Severity: HIGH (Trigger: A keyboard-reachable control with no visible focus indicator)
- Confidence: high
- Locations: `client/surfaces/review/ReviewView.tsx:438`, `client/surfaces/review/ReviewView.tsx:450`, `client/surfaces/review/ReviewView.tsx:501`, `client/surfaces/review/ReviewView.tsx:552`, `client/surfaces/review/review.css:467`
- Evidence: Each panel carries `tabIndex={0}`, for example `tabIndex={0}` on the coverage panel, while the stylesheet carries `.ds-reviewpanel:focus-visible{outline:none}` with no box-shadow or other replacement on that rule. The global rule at review.css:1395 does not rescue it because the panel rule removes the outline and sets nothing in its place for this class.
- Fix: Give the panels the project focus token like neighbouring controls, for example `.ds-reviewpanel:focus-visible{outline:none;box-shadow:var(--shadow-focus)}` in review.css, matching `.ds-reviewpage-section:focus-visible` in the same file.
- Why: A keyboard user who tabs into the active Review panel gets no visible sign of where focus is, so the next keypress acts on an unseen target. This is the constant review loop in the frequency map.
- Verified: no (tab to an active Review panel in a browser and confirm no ring is drawn; stills in screens/review-tab-focus-1440x900-dark.png only sample the editor button stop)
- Systemic: no

### A11Y-2: Story health severity is carried by a coloured dot whose label is never announced
- Rule: 13. Color is never the only signal, and 2. Accessible names everywhere
- Severity: HIGH (Trigger: State or meaning carried by color alone)
- Confidence: high
- Locations: `client/surfaces/review/StoryHealth.tsx:85`, `client/surfaces/review/review.css:342`
- Evidence: The row renders `<span className={...} aria-label={finding.severity === "error" ? "Error" : "Warning"} />` on a plain span with no role, which screen readers ignore, and the stylesheet separates the states only by fill: `.ds-health-dot.is-error{background:var(--del)}` and `.ds-health-dot.is-warning{background:var(--amber)}` at the same 7px size and shape. The visible message text does not repeat the severity.
- Fix: Add visible severity text beside the message, or give the marker `role="img"` with its label and keep the text in the row copy, for example prefix the message with `Error: ` or `Warning: ` in StoryHealth.tsx so sighted and screen reader users get the same second cue.
- Why: A reviewer scanning findings cannot tell an error from a warning without hue, and a screen reader user gets no severity per row at all. The summary count at the top does not say which row is which.
- Verified: no (open a story with mixed errors and warnings and read one row with a screen reader, or in greyscale; code shows no other per row cue)
- Systemic: no

### A11Y-3: A long branch name overflows the repository card and is clipped at 375px
- Rule: 14. Zoom, reflow and text resize
- Severity: HIGH (Trigger: Content or a control clipped, overlapped or unreachable at 320px width or 200% zoom)
- Confidence: medium
- Locations: `client/surfaces/picker/RecentRepos.tsx:112`, `client/surfaces/picker/RecentRepos.tsx:218`
- Evidence: screens/stress-S2-picker-longrepo-375x812-dark.png (scenario S2 very long repo name) shows the branch line `feat/xxxx...` running past the right edge of the card with no ellipsis, and runtime.md records overflowX=320 for that capture. The branch is rendered as `<span className="inline-flex items-center gap-1">` holding the raw branch string inside a wrapping flex row, with no min-w-0 or truncate on that span, unlike the repo name and path above it which do truncate.
- Fix: Let the branch span shrink and truncate in the project idiom, for example add `min-w-0` to the meta row spans and `truncate` to the branch text span in RecentRepos.tsx, keeping the existing tooltip pattern used for the name and path so the full value stays reachable.
- Why: At small widths the branch, which is how a reviewer confirms they are opening the right checkout, is cut off and pushes the page sideways. Mobile is secondary for this desktop-first tool, which lowers reach but does not remove the clipping.
- Verified: yes (screens/stress-S2-picker-longrepo-375x812-dark.png; scenario S2)
- Systemic: no

### A11Y-4: The picker has no skip link and its main has no target id
- Rule: 7. Structure is navigation
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/picker/PickerApp.tsx:207`, `client/shared/nav.tsx:61`, `client/shared/nav.tsx:87`
- Evidence: PickerApp renders `<main ref={main} className="mx-auto ...">` with no `id` and no `tabIndex`, and it uses Hero instead of Nav, so the shared `SkipLink` (defined at nav.tsx:61 and rendered by Nav at nav.tsx:87) never appears. Runtime keyboard evidence in runtime.md records the picker tab order starting at `BUTTON:'VS Code'` with no skip link first, while the review surface starts with `A:'Skip to content'`.
- Fix: Render `<SkipLink />` at the top of PickerApp and give the main `id="main-content"` and `tabIndex={-1}`, matching ChangeApp.tsx:149 and StoriesApp.tsx:152.
- Why: Every other surface lets a keyboard user jump past the editor and theme menus in one stop. On the front door they must tab through both menus on every visit before reaching Repositories.
- Verified: yes (runtime.md keyboard order for picker; screens/picker-1440x900-dark.png shows no skip link)
- Systemic: no

### A11Y-5: The theme menu does not close on Tab
- Rule: 4. Full keyboard support (menu button pattern)
- Severity: MEDIUM
- Confidence: high
- Locations: `client/shared/theme-menu.tsx:93`, `client/shared/editor-menu.tsx:109`
- Evidence: ThemeMenu `onMenuKeyDown` handles Escape, ArrowDown, ArrowUp, Home and End and returns early for every other key, so Tab falls through with the menu still open and each of the three menuitemradio buttons still in the tab order. The sibling control proves the intended behaviour: EditorMenu handles `if (event.key === "Tab") { close(false); return; }` at editor-menu.tsx:109.
- Fix: Add the same Tab branch to `onMenuKeyDown` in theme-menu.tsx, calling `close(false)` without preventing default so focus continues to the next control and the menu closes behind it.
- Why: A keyboard user who opens the theme menu and tabs onward leaves an open menu floating over the page and must discover it again later. The two menus in the same chrome bar also behave differently for the same key.
- Verified: no (open the theme menu by keyboard, press Tab repeatedly, and check whether the menu stays visible; runtime only exercised rapid pointer toggles)
- Systemic: yes

### A11Y-6: Focus is lost while a story removal runs and after it succeeds
- Rule: 5. Trap and restore focus, and 17. Disabled states
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/stories/RemoveStoryDialog.tsx:139`, `client/surfaces/stories/RemoveStoryDialog.tsx:153`, `client/shared/use-modal.ts:161`, `client/surfaces/stories/StoriesApp.tsx:76`, `client/surfaces/stories/StoriesApp.tsx:81`
- Evidence: Both dialog buttons carry `disabled={busy}`, so the focused Cancel or Remove control becomes disabled mid-task and focus drops to the body inside a still trapped dialog. On success the app runs `setTarget(null)` and `setStories((rows) => rows.filter(...))` in the same update, deleting the row that held the trigger button, while use-modal.ts restores with only `restore?.focus?.()` and no check that the node is still in the document, unlike the review engine restore which checks `document.contains(target)`.
- Fix: Keep the buttons focusable while busy by using the busy styling without `disabled` on the focused control, or move focus to the dialog heading (the `tabIndex={-1}` dialog at RemoveStoryDialog.tsx:107) when busy starts. In use-modal.ts, guard the restore with a document containment check and fall back to focusing the dialog root, then on success let StoriesApp focus the saved reviews heading.
- Why: A keyboard or screen reader user who confirms a removal loses their place twice, first when the control disables under them and again when the dialog closes to a deleted trigger and focus restarts at the top of the page. Only the sr-only status text tells them the removal worked.
- Verified: no (remove a story by keyboard and track document.activeElement during the busy state and after close)
- Systemic: no

### A11Y-7: File rows do not announce reviewed, unexplained or regenerated state
- Rule: 13. Color is never the only signal, and 2. Accessible names everywhere
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/Sidebar.tsx:338`, `client/surfaces/review/Sidebar.tsx:364`, `client/surfaces/review/Sidebar.tsx:369`, `client/surfaces/review/Sidebar.tsx:373`, `client/surfaces/review/review.css:1123`
- Evidence: The file button renders the unexplained flag, the regenerated mark and the viewed check all as `aria-hidden="true"` spans, with the counts kept only in `title` attributes on those hidden spans. The button has no aria-label, so its accessible name is the file base name plus the add and delete numbers. The viewed state itself is opacity only: `.ds-fileitem.is-viewed .ds-fileitem-viewed{opacity:1}` over a check that is hidden from assistive technology.
- Fix: Extend the button name in Sidebar.tsx with the states as text, for example build an `aria-label` of file path plus `reviewed`, `N unexplained changes` and `regenerated by X` when present, following the existing `aria-label` pattern on the rail beat buttons at Sidebar.tsx:123. Keep the glyphs aria-hidden as the visual cue.
- Why: Reviewed state drives the core loop (Next unreviewed, the Reviewed and Unexplained filters). A screen reader user stepping through the tree cannot tell which files still need them, and must open each one to find out.
- Verified: no (read a viewed and an unviewed file row with a screen reader and compare the announced names)
- Systemic: no

### A11Y-8: A mistyped ref fails silently with no invalid state or message
- Rule: 9. Errors that announce, and 8. Label and type every control
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/change/ScopeCard.tsx:442`, `client/surfaces/change/ScopeCard.tsx:447`, `client/surfaces/change/RefPicker.tsx:293`
- Evidence: Navigation only happens when the text exactly matches a cached ref: `isCachedRef` returns false for anything else and `commitIfKnown` then does nothing, including on blur. The combobox props returned at RefPicker.tsx:293 set role, aria-expanded and aria-activedescendant but never `aria-invalid` or `aria-describedby`, and no error element exists near the four fields. Typing a wrong branch and leaving the field produces no text, no announcement and no navigation.
- Fix: Add an inline error under each field in ScopeCard.tsx, point the field at it with `aria-describedby`, set `aria-invalid="true"` when a committed value matches no cached ref, and keep the existing help line as the describedby target when valid. Announce through the focus move to the field, as Rule 9 sets out.
- Why: The scope fields are how every review starts. A typo currently reads as the app ignoring the user, and there is no cue about whether to keep typing, pick from the list, or check the spelling.
- Verified: no (type a nonexistent ref, press Enter and blur, and check for any message or aria-invalid in the accessibility tree)
- Systemic: no

### A11Y-9: The story reload toast reloads the page after 10 seconds with no pause on hover or focus
- Rule: 15. Timed content and autoplay
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/ReviewApp.tsx:600`, `client/surfaces/review/engine/review-engine.js:131`, `client/surfaces/review/engine/review-engine.js:136`
- Evidence: The toast says `Story updated. Reloading in 10 seconds.` with a Cancel button, and the engine runs `storyReloadTimer=setTimeout(function(){... location.reload();},10000)` in `scheduleStoryReload`. No code pauses that timer on hover or focus, and the toast is rendered near the end of the document, far from wherever focus is during a review.
- Fix: Pause the countdown while the toast is hovered or contains focus, and restart it on leave, or drop the automatic reload and keep the toast until dismissed with a Reload button. Keep `role="status"` and do not move focus to the toast.
- Why: A keyboard user who hears the announcement may need more than 10 seconds to reach Cancel at the end of the tab order, and a reload mid-read discards scroll and reading position. Timed actions need a pause, not only a cancel that exists somewhere on the page.
- Verified: no (trigger a story update, hover and then focus the toast, and check whether the reload still fires at 10 seconds)
- Systemic: no

### A11Y-10: The filmstrip focus indicator is a scale change shared with neighbouring nodes
- Rule: 3. Visible focus
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/review/review.css:1276`, `client/surfaces/review/review.css:1280`, `client/surfaces/review/review.css:1281`
- Evidence: `.ds-filmnode:focus-visible{box-shadow:none}` removes the ring, and the replacement is `--ds-dock-scale:1.36` with an 8px lift on the focused node, while the immediate neighbours also scale to 1.14 and the next pair to 1.05 by the `:has()` rules on the following lines. Three sizes change at once and none draws a perimeter.
- Fix: Keep the magnification if it is wanted, but add the standard ring on the focused node in review.css, for example `box-shadow:var(--shadow-focus)` on `.ds-filmnode:focus-visible`, so the focused step is distinct from its scaled neighbours.
- Why: In a strip of near identical numerals, a bigger neighbour on each side makes the focused step harder to pick out, especially at a glance or with low vision.
- Verified: no (tab into the filmstrip and screenshot the focused node at 200 percent; runtime stills do not capture this stop)
- Systemic: no

### A11Y-11: Folder browser breadcrumb targets are below the 24px floor
- Rule: 12. Hit areas and touch
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/picker/FolderBrowser.tsx:335`
- Evidence: Non-current crumbs render a beUI Button with `className="h-auto ... px-[5px] py-0.5 text-[inherit]"` over 12.5px text, which gives a target roughly 21px tall with no hit-slop pseudo-element, unlike the close button at FolderBrowser.tsx:304 and the clear button at :381 which both add an `after:-inset` expansion.
- Fix: Add the same expansion the sheet already uses, for example `relative after:absolute after:-inset-1 after:content-['']` on the crumb button, or raise its vertical padding to reach 24px, keeping the visible crumb size unchanged.
- Why: Breadcrumbs are the only way back up a deep folder path in the modal. Small targets in a row of short labels are easy to miss with a pointer and harder with tremor or a trackpad.
- Verified: no (measure the crumb button box in the open folder browser)
- Systemic: no

### A11Y-12: Many decorative Lucide icons are not hidden from assistive technology
- Rule: 11. Alt text by purpose
- Severity: LOW
- Confidence: medium
- Locations: `client/surfaces/picker/PickerApp.tsx:232`, `client/surfaces/picker/RecentRepos.tsx:175`, `client/surfaces/picker/RecentRepos.tsx:270`, `client/surfaces/stories/StoryRow.tsx:310`, `client/surfaces/change/FileSummary.tsx:194`
- Evidence: Icons inside named buttons render with no `aria-hidden`, for example `<Plus className="h-[15px] w-[15px]" strokeWidth={2} />` in the Add repository button and `<Trash2 ... />` in the remove buttons, while other call sites in the same files do pass `aria-hidden="true"` (FolderBrowser.tsx:306, ScopeCard.tsx:605). BrandMark and ThreadBackdrop in brand.tsx set `aria-hidden="true"` and `focusable="false"`, so the convention exists and is applied unevenly.
- Fix: Add `aria-hidden="true"` to decorative Lucide icons at the call sites, or set it once where the shared Button renders its children, keeping icons that are the only content of a named button hidden so the button label is the single name.
- Why: Unlabelled inline SVG can be exposed as an unnamed image or add stray stops in some assistive technology and browser combinations, which adds noise inside controls whose names are otherwise correct.
- Verified: no (inspect the accessibility tree for the Add repository and Remove buttons in two browsers)
- Systemic: yes

### A11Y-13: The hidden file input carries aria-hidden while remaining programmatically focusable
- Rule: 1. Native elements first (never put aria-hidden on a focusable element)
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/stories/StoriesApp.tsx:211`
- Evidence: The import input renders `type="file"` with `className="ds-sr-only"`, `tabIndex={-1}` and `aria-hidden="true"` together. tabIndex -1 removes it from the tab order but it stays focusable from script, which is exactly the combination the lens rule forbids, and the code itself relies on script driving it through `fileInput.current?.click()`.
- Fix: Drop `aria-hidden="true"` and keep the visually hidden class plus `tabIndex={-1}`, so the control is out of the tab order and the tree by presentation rather than by an aria-hidden on a focusable node. The Import bundle button already supplies the accessible name and action.
- Why: aria-hidden on a focusable element can strand focus inside a hidden subtree when the file dialog returns or when script focuses the input, and validators flag it as a failure even when the workaround usually works.
- Verified: no (focus the input from script and read the tree, or run an aria-hidden-focusable check)
- Systemic: no

### A11Y-14: The modal scrim does not contain overscroll
- Rule: 5. Trap and restore focus
- Severity: LOW
- Confidence: high
- Locations: `client/shared/shared.css:146`
- Evidence: `.ds-scrim` sets position, inset, display, background, opacity and transitions, with no `overscroll-behavior`. The folder list inside scrolls with `overflow-y-auto` at FolderBrowser.tsx:416, so a wheel or trackpad scroll at the end of the list can chain to the page behind the inert background.
- Fix: Add `overscroll-behavior: contain` to `.ds-scrim` in shared.css, which also covers RemoveStoryDialog since both sheets share the class.
- Why: Scrolling the inert page behind a modal moves content the user cannot interact with and loses their place for when the sheet closes, even though focus itself is correctly trapped.
- Verified: no (open the folder browser, scroll to the end of a long folder list, keep scrolling, close, and check the page position)
- Systemic: yes

### A11Y-15: The Explain submit button disables with no reason attached to it
- Rule: 9. Errors that announce, and 17. Disabled states
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/explain/ExplainApp.tsx:280`, `client/surfaces/explain/ExplainApp.tsx:488`
- Evidence: `const ready = !!writer && !!headCommit && !running;` gates `disabled={!ready}` on the submit button. The reasons live elsewhere (the writer alert inside the Writer fieldset and the no-commits banner above the form) and nothing points the button at them with `aria-describedby`, so a user who reaches the disabled button hears only its label and its state.
- Fix: Add `aria-describedby` on the submit button pointing at a short persistent line beside it that names the blocker, for example reuse the existing help text slot pattern at ExplainApp.tsx:350 and render `Install Claude or Codex to write a story.` or `This repository has no commits yet.` next to the button while it is disabled.
- Why: Disabled controls cannot be focused, so the explanation has to be findable in reading order near the action. At present the connection between the banner and the greyed button has to be inferred.
- Verified: no (load Explain with no writer installed and read the submit region with a screen reader)
- Systemic: no

### A11Y-16: The picker page heading is the brand, not the page purpose
- Rule: 7. Structure is navigation
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/Hero.tsx:25`, `client/surfaces/picker/PickerApp.tsx:215`
- Evidence: The only h1 is `<h1 ...><span>code</span><span>Story</span></h1>` in the masthead, and the page task is an h2, `Repositories`, at PickerApp.tsx:215. The document title does say Pick a repository, but heading navigation lands on the wordmark first.
- Fix: Demote the masthead wordmark to a plain span or paragraph in Hero.tsx and promote `Repositories` to the h1 in PickerApp.tsx, keeping the same classes so the appearance is unchanged, as ChangeApp and StoriesApp already put the task in the h1.
- Why: Heading navigation is how screen reader users survey a page. Hearing the brand as the top heading and the actual task one level down adds a step on the most visited surface.
- Verified: no (list headings on the picker with a screen reader rotor)
- Systemic: no

### A11Y-17: The progress milestone strip does not expose which milestone is current
- Rule: 13. Color is never the only signal, and 10. Announce dynamic content
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/progress/Milestones.tsx:40`
- Evidence: Each milestone is a plain `<li>` whose state lives only in `data-tone` and tone classes (`text-[var(--pp-muted)]`, `text-[var(--pp-text)]`, error and faint variants) plus a filled segment bar. No item carries `aria-current` or sr-only state text, unlike PlanList.tsx which prefixes each item with an sr-only `Done: `, `In progress: ` or `To do: `.
- Fix: Add `aria-current="step"` to the active item and an sr-only state prefix per item in Milestones.tsx, mirroring the PlanList pattern in the same surface, while leaving the single live announcer in ProgressPanel.tsx as the only speaking region.
- Why: A screen reader user who tabs into the panel can read the milestone labels but cannot tell where the run is, which is the one question the strip exists to answer. Sighted users get it from colour and fill.
- Verified: no (read the milestone list during a running fixture with a screen reader)
- Systemic: no

## Recommendations
- Harden the open sequence in use-modal.ts: the background is inerted and given aria-hidden at use-modal.ts:141 while focus is still on the trigger inside it, and focus only moves when the consumer effect runs after `modal.shown`. Runtime evidence shows the folder filter does end up focused, so this is a robustness suggestion, not a finding. Moving focus to the first focusable inside the same effect that inerts the background would remove the transient hidden-focus window for any future consumer that forgets its own focus effect.
- Add a second heading check to the browser smoke script: assert one h1 per surface and that the picker main carries id main-content. The repo has no axe or jsx-a11y tooling per brief.md, so a small assertion in the existing smoke run is the cheapest guard for A11Y-4 and A11Y-16.
- Give the Story health summary at StoryHealth.tsx:168 a text severity word in the summary line itself, for example `2 errors, 1 warning`, which it already computes. It does this today in words, so keep it and extend the same wording into each row per A11Y-2 rather than adding a legend.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/change/ScopeCard.tsx:594` | aria-hidden on closed scope panels that contain focusable inputs | Each panel pairs `aria-hidden` with `inert` on the same element, so the inputs are removed from focus and interaction at the same time. The pair matches the modal background pattern in use-modal.ts and is not hidden-but-focusable. |
| `client/surfaces/change/RefPicker.tsx:403` | aria-hidden on the closed ref listbox | It is paired with `inert` and with `hidden` once the exit finishes, and its options are `tabIndex={-1}` driven by aria-activedescendant, so nothing inside is tab reachable while hidden. |
| `client/surfaces/picker/FolderBrowser.tsx:504` | Disabled Open button contrast and discoverability | The disabled state drops the accent fill for a full opacity neutral pill and the label itself becomes the reason, `Not a Git repo`. That is persistent text beside the point of action, which Rule 17 asks for. |
| `client/surfaces/review/review.css:247` | File filter buttons at 27px tall | 27px passes the 24px WCAG floor in Rule 12 and the row wraps with gaps, so the spacing exception is not needed. Density on a desktop-first tool is a layout choice, handed to LAY if it wants the 40px guideline. |
| `client/surfaces/review/ReviewApp.tsx:469` | Tabs missing arrow key support | The engine binds ArrowLeft, ArrowRight, Home and End for both the view tabs and the review section tabs with a roving tabindex, at review-engine.js:4120 and :4126. Names, selected state and panels are all present in ReviewApp.tsx and ReviewView.tsx. |
| `client/surfaces/picker/PickerApp.tsx:62` | Picker toast uses polite instead of alert for errors | The region is rendered empty from the start and only its text changes, focus never moves to it, and the action beside the message (Undo, Try again) stays until dismissed. That matches the Rule 10 decision order for a non-urgent update tied to a control the user just used. |

## Handoffs
- COL: Whether `--shadow-focus`, the `0 0 0 3px var(--accent-soft)` ring on .ds-theme-toggle and .ds-editor-toggle at client/shared/shared.css:229, and the accent-soft filmstrip magnification meet the required ratios against every adjacent fill. A11Y-1, A11Y-10 and A11Y-12 classify the requirement and the missing indicator only.
- COL: Diff row tint pairs (`ds-cell-add`, `ds-cell-del`, `ds-cell-moved`) and the amber trust pill text in client/surfaces/review/review.css. The row meaning itself is safe for assistive technology because src/diff-render.ts:50 gives each row an aria-label starting with Added, Deleted, Moved or Changed.
- EXP: Validation timing for the scope ref fields in A11Y-8 (when the unmatched state should appear, while typing or on commit) and whether the 10 second reload in A11Y-9 should exist as a timed action at all. Announcement and association stay with A11Y.
- EXP: The destructive removal flow in A11Y-6 beyond focus, including whether success should offer an undo in place of the current sr-only status at client/surfaces/stories/StoriesApp.tsx:305.
- MOT: Reduced motion handling inside the filmstrip magnification, the thread pulse at client/shared/shared.css:73 and the progress segment breathe at client/surfaces/progress/Milestones.tsx:58. A11Y-10 covers only the focus indicator that the magnification replaces.
- LAY: Page level overflow beyond the branch span in A11Y-3, including the 64px overflowX recorded for screens/change-320-dark.png and the 9px at 375px on the change surface. Clipping at 320px stays with A11Y, other widths with LAY.
- TYP: Truncation mechanics for the branch and path spans once they can shrink (A11Y-3), and heading appearance for the picker h1 change in A11Y-16. Heading level and outline stay with A11Y.
- COPY: Wording for the new scope field error (A11Y-8) and the disabled submit reason (A11Y-15). Association and announcement stay with A11Y.
