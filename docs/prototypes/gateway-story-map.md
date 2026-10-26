# Gateway story-map prototype

The owner wants connected story cards with the quality of the Ivy documentation
map, while preserving CodeStory's native code and diff viewers. The earlier
scrolling-card implementation copied motion timings but missed Ivy's balanced
world, camera and visual hierarchy. Variant A now replaces that outer structure.
The owner approved the animation feel; card presentation is the current
review question. The branch has now been merged into main. Normal saved-story
reviews use the complete Story map by default, with leased native viewers;
the toolbar's Walkthrough link opens the previous view and story overview.
The standalone runner below remains a read-only gateway comparison fixture.

Run from this checkout:

```sh
npm run prototype:story-map -- --repo /path/to/core --story stories/code-complete-tour.json
```

The runner serves the existing review route on port 7799, refuses production
mode, uses a temporary app home, and rejects mutations except local narration.
It reads the real story and its pinned source; it never rewrites story bytes.
Map options retains the comparison layouts: A is the Ivy canvas, B is the
reading tree, and C is focused cards.

## Complete original tour

Add `&scope=full&variant=A` to the review URL to try the complete original story:

```text
http://localhost:7799/repo/core/review?story=stories%2Fcode-complete-tour.json&scope=full&variant=A
```

This view keeps all 129 authored steps, their 32 chapters and pinned source at
`6399ecf`. Seven section branches group the existing chapter boundaries; they
add navigation, not new protocol claims. Step cards retain their authored order,
and explanation leaves retain the original step/beat ownership. The original
story file is never rewritten. The smaller curated gateway view remains the
default without `scope=full`.

Only opened media request a native viewer. Hidden, unopened cards are not
measured for layout. The six authored HTML diagrams use the native sandboxed,
leased concept-page endpoint, preserving their interactions. Focus/fullscreen
and layout handoffs reuse the live iframe with state-preserving DOM moves when
the browser supports them. Its F/Escape bridge accepts messages only from the
focused, visible frame for the active story panel. Ordinary review-frame keys
and lifecycle remain unchanged.

Sections and chapters remain selected while browsing their summaries. Starting
narration hands selection to their first authored step; progress follows actual
steps and explanations without narrowing the reading path. Follow whole tour
queues the original order; Follow this branch scopes playback to that branch.
The dock shows the original step position out of 129. Full-tour source cards
stay source cards; the historical gateway demonstration diff is not invented
for the original source-only tour.

`story-map-full-smoke.mjs` checks the complete hierarchy, zero embedded-viewer
requests at overview, keyboard paths through chapters, original interactive
diagrams, F/Escape and layout state, live source identity, caller returns and
the last sibling boundary across desktop and phones. A silent narration fixture
checks the whole-tour queue, selection/Focus synchronization and transport;
it does not verify audible synthesis.

Every card has a number derived from its branch: the root is `01`, the gateway's
chapters are `02`–`07`, and their children are `02.1`, `02.2`, and so on. The full
tour uses the same rule through sections, chapters, steps and explanations. Numbers stay the
same through expansion, selection, Focus and layout changes. The number links
back to the parent. Quiet dots show the card's position among its siblings;
previous/next controls appear in the selected header. No navigation row splits
the prose from the title. A count at the branch edge folds/unfolds children in
the canvas/tree, or enters the first child in Focus and layout C. Leaves have
no branch control. On phones the count stays within the header. Overview counts
are passive until selection restores reading scale. Focus navigation keeps
the dialog open and moves focus to the destination title.

Visual references: [Xmind's node-edge fold control](https://xmind.com/user-guide/fold-unfold-subtopic-new)
and [Whimsical's mind-map examples](https://whimsical.com/learn/get-started/mind-maps).
The references inform disclosure and hierarchy; native viewers, input ownership
and the approved animation curves/durations remain unchanged.

Reading cards use a single frame, a restrained number label and a semantic
heading. The method is a readable 13–14px code label; prose is 16px with a
comfortable line length. Keyboard focus is shown on the card, never as a box
around the title. Selected numbers retain the accent; other metadata stays
secondary. These are presentation changes, not changes to the authored story.

## Ivy canvas

Reference: `core/docs/site/assets/map.js` (`layoutWorld`, `reflow`, camera and
input handlers) and `map.css`. `story-map-canvas.prototype.ts` adapts their
geometry and motion to the existing React cards:

- One clipped viewport, one absolutely positioned world, one transform camera.
- Measured subtree sizes; parents centred beside children; 180px root gaps,
  100px deeper gaps and a vertical outline below 1120px.
- Distinct root, numbered chapter and explanation-leaf shapes, inset frames,
  larger overview titles and heavier root connectors. CodeStory keeps its own
  fonts, surfaces and signal-blue accent; no unauthored actor colours.
- Whole-map overview shows compact topic cards. Selecting a code/diff topic
  reveals the actual native viewer at readable scale. Open code/diff cards grow
  with the available canvas up to 1600px; narrow screens retain their existing
  fit. The root expands to code width when its source disclosure opens.
  Fit restores the overview;
  Find returns to the current reading card. This is selection-based disclosure,
  not a second rendering of code at each zoom tier.
- Camera framing preserves space beyond edge cards so they can centre. Tall
  cards start at the heading. Background drag and ordinary wheel pan; Ctrl/Cmd
  wheel or the Map options controls zoom around the pointer. Native viewers
  retain their own scrolling and resize gestures. Mouse text selection remains
  available in prose and source.
- Children enter from the parent side at 94% scale and zero opacity over 440ms
  after a 230ms delay; existing cards translate over 440ms. Exits take 220ms.
  SVG paths morph directly and draw over 520ms or retract over 320ms, using
  `cubic-bezier(.22,.8,.22,1)`. Camera travel during a reflow shares that 440ms
  curve and start time with card translation and reveal. Travel without a
  geometry change keeps the 350ms `cubic-bezier(.25,.7,.15,1)` transition.
  There is no per-frame DOM geometry polling or
  temporary scroll extent in variant A. New gestures sample the presented
  camera before taking over. Reduced motion makes durations/delays zero.

Moving to another card changes selection, focus and source immediately, while
the outgoing reading surface keeps its size through camera travel. It compacts
after motion settles and it is completely outside the map viewport. Context
that is still visible remains open until a subsequent pan moves it out of view.
Cleanup compensates around the destination without launching another centering
flight, preserving its screen position and zoom. Native inspection focus defers
cleanup. This presentation hold is separate from the actual reading selection;
Fit and reduced motion clear it immediately. Live viewers remain cached.

Incoming reading cards reveal their measured additional area through a clip;
native code uses its final dimensions and is not scaled. Interrupted reveals
sample their current clip. Unchanged connectors do not restart animations.
The second native selection acknowledgement preserves an existing flight,
rather than cancelling it before the next paint. An outgoing explanation keeps
its last prose and highlights until it is revisited.
Tab or pointer focus inside a card's controls takes inspection ownership:
linked card/connector/reveal movement settles before the control is framed,
and that card becomes the geometry anchor. Native scrolling and its requested
offsets stay independent. Map-title focus used for navigation keeps the motion.

External interaction references, checked 2026-10-25:

- [MindNode](https://www.mindnode.com/features) separates focus dimming from
  folding, preserving surrounding context while directing attention.
- [MindMeister navigation](https://support.mindmeister.com/hc/en-us/articles/360017469020-Navigate-a-Mind-Map)
  separates selection/navigation, recentering and visible depth.
- [Xmind folding](https://xmind.com/user-guide/fold-unfold-subtopic-new) keeps
  explicit branch controls and counts at the topic edge.

These inform interaction policy, not copied animation timings. Selection leaves
an already readable, unchanged card stationary; Enter/Find explicitly centres
it. CodeStory retains its native code/diff viewers and the Ivy spatial hierarchy.
The runner now uses optimized React by default; `--react-development` enables
development diagnostics. Transport polling deduplicates unchanged UI state.
An instrumented local desktop comparison of three source navigations measured
272–285ms navigation long tasks with development React and no long tasks over
50ms with the optimized runtime. These are bounded browser observations, not
a device frame-rate guarantee.

## Native content and navigation

Cards combine authored prose, small diagrams, code and historical diffs. The
code/diff blocks still come from `renderStoryStepPanel`: syntax/word highlights,
Split/Unified/Full file, wrapping, caller/helper panes, resizing, source links
and Return to caller. One cached live panel exists per viewer ID. Reflow,
overview/reading disclosure and Focus reuse that element; none clone or rebuild
it. Inspection offsets are saved before layout changes, with scroll anchoring
suspended through restoration. The existing per-axis requested/applied tracking
preserves positions clamped by a larger Focus viewport.

Embedded viewers share one full-width toolbar above both caller/helper panes.
File/revision, flat underlined view tabs and one options disclosure remain in
the bar. Wrap, caller visibility, Source references and story repair use labeled
rows inside that disclosure. The floating options layer stays reachable above
the canvas/dock at short phone heights. Escape dismisses repair, then options, then the
viewer; outside pointer input also closes options. It uses one 44px control row
on wide cards and two rows on narrow cards. These are the original native
controls; an explicit owner links the relocated mode toolbar to its original
diff holder. The caller retains a compact method/Return row;
its full path remains in the method tooltip and pane label. The native file
control also retains its full path in its accessible name and tooltip. Source
relationships remain in the Source popover. Repeated Code/path/revision rows
are omitted. Explanation prose uses the card's complete content width.

Press **F** on a code, diff or diagram card to fill the viewport with that
content. Inside a viewer or diagram, F enlarges that particular block. The
same live native viewer and its inspection state survive the change. F or
Escape returns to the previous map or Focus view; native menus and Source
popovers consume Escape first. Typing fields and Ctrl/Cmd+F retain their native
behavior. Text-only cards keep the ordinary Focus view. This is a viewport
inspection mode, not browser/OS fullscreen.

Changing the explanation releases restoration for its active viewer so the
native controller can reveal its highlighted lines. Fit/Find/Focus of the same
explanation preserve inspection coordinates. Source-card prose reserves the
tallest authored passage so narration does not keep resizing the canvas.
Embedded viewers have an independent centering request, so hidden narrative
activation cannot cancel their scroll. It uses displayed row geometry converted
back to local scroll pixels, including canvas zoom and Focus changes.

Source cards read `6399ecf`. The Call/SignedCall diff compares `d8a23d4` to
`6399ecf`, including complete-file mode and context expansion through the
historical endpoint. These are pinned revisions, not fabricated examples or a
working-tree comparison. The map organises authored explanations; it does not
claim compiler-resolved call relationships.

Body/background/prose arrows navigate from first load. Right enters the first
child; Left folds the level being left and returns to its parent. Up/Down move
among siblings without wrapping; Home returns to the gateway. Selection/focus
update immediately. Visual keyboard travel, Enter and Find follow the camera
curves above; new commands retarget the presented position. Sibling selection
keeps card dimensions stable and leaves unfinished branch entrances running.
Enter/Find centres the current card. Native code arrows
scroll code; Escape returns to the map without resetting the explanation.
Open native menus close first, including inside Focus. Inputs, tabs, popovers
and separators retain their own keys. Tab focus brings offscreen controls into
the canvas camera rather than leaving an independent browser scroll offset.

Selection and narration still use the existing source step/beat controller.
Manual selection stops the previous playback and scopes reading to the chosen
branch; explanation leaves keep their helper scope. Narration selects the
corresponding card and Focus follows it. Caller Return reaches the actual
caller, including the executeSigned submission card. Hidden native step/mode
updates bypass workspace snapshot animations; Story/Files changes retain them.
The compact native narration strip keeps its optional transcript and mirrored
explanation navigation. The map header retains breadcrumbs, Fit, Find, Focus
and Map options; layout/voice details remain out of the main reading surface.

## Verification

`story-map-canvas-smoke.mjs` checks variant A's balanced overview, native source
identity and real nonzero offsets, branch growth, camera interruption/zoom,
Focus, native arrows/Escape, phones and reduced motion.
`story-map-input-smoke.mjs` covers input ownership across all three layouts.
`story-map-fullscreen-smoke.mjs` checks compact header geometry, media targeting,
F/Escape return paths, native menus and exact inspection-state preservation.
On a transform canvas, it uses focus (the Tab path) before activating an
offscreen native control: locator auto-scroll cannot operate a camera.
`story-map-growth-smoke.mjs` retains the older reading-tree motion coverage for B.
These browser checks are distinct from full-suite checks, audible synthesis,
physical touch performance or native-app installation. Capture the implemented
canvas and compare with the actual Ivy map at matching viewport/theme before
calling a visual iteration complete.

`story-map-motion-smoke.mjs` checks continuous keyboard camera travel, retained
entrances during fast sibling input, reversal, connector attachment while cards
resize, reduced motion and background gesture interruption. It also checks
source synchronization after reselection and reading widths for code leaves.
A captured Chromium
comparison exposed the previous 30-layout sibling step; cached dimensions,
batched measurement and highlight-only native refreshes reduce that steady
step to 2 layouts on desktop/390px and under reduced motion at 320px. SVG path
animation is measured separately because it legitimately performs layout work.
These are browser measurements, not a physical-device frame-rate guarantee.

`story-map-handoff-smoke.mjs` checks outgoing card dimensions during navigation,
offscreen folding, destination anchoring, fast reversal, native media reuse and
Focus/F/Escape across large source/diagram cards, phones and reduced motion.
It also samples actual painted frames for prompt feedback, maintained sibling
spacing during clipped growth and landing without overshoot.
