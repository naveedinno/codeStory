# Gateway story-map prototype

The owner wants connected story cards with the quality of the Ivy documentation
map, while preserving CodeStory's native code and diff viewers. The earlier
scrolling-card implementation copied motion timings but missed Ivy's balanced
world, camera and visual hierarchy. Variant A now replaces that outer structure.
The owner approved the animation feel; card presentation is the current
review question. This is a local prototype on
`prototype/story-map-gateway`; main and the installed app are unchanged.

Run from this checkout:

```sh
npm run prototype:story-map -- --repo /path/to/core --story stories/code-complete-tour.json
```

The runner serves the existing review route on port 7799, refuses production
mode, uses a temporary app home, and rejects mutations except local narration.
It reads the real story and its pinned source; it never rewrites story bytes.
Map options retains the comparison layouts: A is the Ivy canvas, B is the
reading tree, and C is focused cards.

Every card has a number derived from its branch: the root is `01`, its chapters
are `02`–`07`, and their children are `02.1`, `02.2`, and so on. Numbers stay the
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
  reveals the actual native viewer at readable scale. Fit restores the overview;
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
  `cubic-bezier(.22,.8,.22,1)`. The camera uses a 350ms transform transition with
  `cubic-bezier(.25,.7,.15,1)`. There is no per-frame DOM geometry polling or
  temporary scroll extent in variant A. New gestures sample the presented
  camera before taking over. Reduced motion makes durations/delays zero.

## Native content and navigation

Cards combine authored prose, small diagrams, code and historical diffs. The
code/diff blocks still come from `renderStoryStepPanel`: syntax/word highlights,
Split/Unified/Full file, wrapping, caller/helper panes, resizing, source links
and Return to caller. One cached live panel exists per viewer ID. Reflow,
overview/reading disclosure and Focus reuse that element; none clone or rebuild
it. Inspection offsets are saved before layout changes, with scroll anchoring
suspended through restoration. The existing per-axis requested/applied tracking
preserves positions clamped by a larger Focus viewport.
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
update immediately. Visual keyboard travel, Enter and Find follow Ivy's 350ms
camera curve; new commands retarget the presented position. Sibling selection
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
step to 3 layouts on desktop/390px (4 under reduced motion at 320px). SVG path
animation is measured separately because it legitimately performs layout work.
These are browser measurements, not a physical-device frame-rate guarantee.
