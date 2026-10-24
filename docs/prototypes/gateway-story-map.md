# Gateway content-card prototype

Question: can the story itself live in connected cards, with prose, diagrams,
source code and real code diffs inside the map?

The owner clarified that the map is the reading surface. Each topic now owns
`content` blocks: `text`, `diagram`, `code`, or `diff`. A card can combine blocks.
The map changes navigation and composition. Code and diff blocks embed the
existing CodeStory viewers, produced by `renderStoryStepPanel`, with the same
syntax highlighting, word diffs, split/unified/full-file modes, wrapping and
resizing controls. Caller/helper blocks keep the native paired source windows.
Focus card reparents the same live viewer element, preserving its display mode,
pane visibility/widths, loaded context and inspection position. It does not
reconstruct the viewer when entering or leaving Focus.
The underlying lazy story panels still own narration state; embedded viewer
fragments are not duplicate narrative steps.

Status: owner comparison pending. Captured on `prototype/story-map-gateway`,
based on `ce912c9`; the earlier navigation-only version is commit `4f8d37e`.
Main and installed CodeStory remain unchanged.

Run from this checkout:

```sh
npm run prototype:story-map -- --repo /path/to/core --story stories/code-complete-tour.json
```

The development runner prints the local URL on port 7799 and injects this
prototype on the existing review route. `NODE_ENV=production` refuses to run.
It reads the real story and its pinned Git revision, uses a temporary app home,
and rejects mutations except local narration. It never writes a story file.

Compare three content layouts in Map options (the top-right ••• button):

- `?variant=A`: connected cards with their content visible inside the map.
- `?variant=B`: an expandable reading tree containing the same rich cards.
- `?variant=C`: branch selection and one focused content card.

The gateway overview combines prose with a small validation-order diagram.
Route/signature cards contain pinned source with native beat-based highlights.
Their native caller/helper panes support Hide/Show, resizing and Return to caller.
The overview also offers its native `_executeCall()` viewer in a disclosure.
Its caller, `executeSigned()`, has a submission card so returning up the call
chain stays inside the map, including Focus and its guided reading scope.
Replay and other explanation cards contain prose. The Call/SignedCall card contains a real
historical diff of `SymmioGatewayTypes.sol`, from `d8a23d4` to the story's
`6399ecf`. Its old/new revisions and historical scope are labeled explicitly;
it is not a working-tree diff or a fabricated example. Its complete-file mode
uses `buildFullFileRows` and `renderFullFile` for the same historical comparison.
Native context expansion is routed through `/_prototype/context` with that same
historical dataset, so old and new line numbers keep the correct revisions.

The two-row header retains the story identity and native Story/Files/Review
choices, then one map command row with breadcrumbs, Find current, Focus and
Map options. The large floating layout switcher, repeated Gateway heading and
guided-reading footer are removed. A/B/C and content density live in Map options.
One compact native narration strip shows playback, current explanation and
previous/next controls. Transcript text is optional in Map options; the story
cards already contain the explanation. Follow gateway/branch remains there too.

The map owns navigation from initial page focus, its background and card text;
card titles keep roving Tab focus. Clicking card text selects and focuses its
card without stealing interactions from the embedded viewers. Right opens and enters
the first child in one command; Left folds the level being left and returns
to its parent in one command. Down from the overview enters its first topic. Up/Down move among
siblings without wrapping. Home returns to the gateway. Escape goes up one level,
and Enter explicitly centers the current card. Keyboard focus and selection
update together; only obscured headers are revealed, immediately. Native tabs,
inputs, code/diff scroll regions and resize handles keep their own keys. Code inspection retains native arrow scrolling; Escape returns to the current
map explanation without resetting its beat or reading position. Open native
menus close first, including inside Focus. Page arrows navigate the selected map branch, never layouts or slides. A focused card is a
modal dialog with native Escape, Tab containment, and a Close card action. The source and diff regions
are independently scrollable without selecting the card or changing playback.
Focus preserves the active explanation and follows narration into the next
card. Its header mirrors the existing Play/Pause/Resume and Stop controls.

Selecting a card updates the existing step/beat and scopes reading to its
function branch, stopping old playback. Explanation leaves use their parent's
helper scope. Narration progress selects the corresponding card without
triggering manual rescoping. Follow branch resets to its introduction; Follow
gateway restores the curated reading path. The engine preserves speech caches
during lazy loading and reveals a freshly loaded narration target.

Reference: `core/docs/site/assets/map.js` and `map.css`. This iteration carries
its semantic detail, parent-child expansion, current path and readable mobile
reflow into content cards. Pointer selection, Find current and explicit centering
use one interruptible 220ms outer-scroll controller with a short
`cubic-bezier(0.23,1,0.32,1)` ease-out curve. An already-visible heading stays stationary; other selections reveal a
stable opening area rather than the entire tall card. Explicit Find centers it.
No code scaling is involved. Wheel, touch, pointer interaction,
resizing or another command cancels at the current offsets. Reduced motion uses
immediate framing. All keyboard paths, including Enter and keyboard-activated
Find/breadcrumbs, settle immediately. Hidden native source-step and mode changes
bypass workspace snapshot/fallback animations so they cannot freeze or crossfade
the visible map. Genuine Story/Files workspace transitions retain native behavior.
Narration follows headers without moving an actively inspected
native viewer. Keyboard disclosure has no height animation.
The topology organizes authored explanations and does not claim to be a
compiler-resolved call graph.

Implementation: `story-map.prototype.tsx`, `story-map.prototype.css`, and
`scripts/story-map-prototype.mjs`. State stays in memory; only the layout key is
stored in the URL. No variant has been promoted to the application. Keep this
prototype off main and implement the chosen direction after owner feedback.

`npm run check` passes all 1,123 tests, including build and client typecheck.
Native-viewer browser checks pass for all three layouts plus 390px and 320px
widths: syntax tokens, split/unified/full-file modes, wrapping, caller Hide/Show,
resizing, caller Return and focus-mode retention. The source full-file request
uses the pinned story commit; historical Full file retains its additions and
removals. Story bytes stay unchanged. Mocked narration checks pass for progression
from overview to diff to helper, matching prose/highlights, Pause/Resume/Stop,
independent keyboard scrolling and the return chain back through `executeSigned()`.
The embedded viewer owns its focus paint, so native narrative-step cleanup cannot
erase its highlights. The narration dock is compact on phones; its optional
transcript retains scrollable text below the complete playback row. Focus
preserves caller visibility and widths in both directions; historical expansion verifies old line 68 against new line 76.
Native wheel checks retain 600px when opening Focus, 1,150px when closing it,
and the same position after Escape across A/B/C and both phone widths. Scroll
offsets are captured before detach and restored after layout; native scroll
anchoring is suspended only for that handoff and then restored.
If Focus's larger viewport clamps a coordinate, the original requested offset
survives until the reader actually scrolls that axis. Boundary probes cover
`(300,500)` clamping to `(165,273)` and restoring on Close/Escape, while explicit
horizontal movement updates only the horizontal coordinate.
Audible synthesis and native installation are outside this
prototype's verification scope.

Chrome/navigation verification for this revision: browser probes cover A/B/C
hierarchy keys, sibling boundaries, same-selection Home focus, roving Tab entry,
native Story/Files tab arrows, transcript toggle, mirrored Previous/Next and
44px phone targets. Normal-motion framing has intermediate rendered offsets;
wheel input and opening Map options cancel it without a destination snap.
Reduced motion frames immediately. Fresh 1440px, 390px and 320px captures show
no page overflow. Follow actions retain focus on the Map options trigger through
native activation, including when the transcript is visible. Source and UI
review findings were patched and rechecked.
The native viewer, historical-context, clamped-scroll and mocked narration
checks remain separate from audible synthesis or native installation.

Input regression after owner feedback: the earlier title-focused/reduced-motion
checks missed initial-body and prose focus, and normal-motion native workspace
snapshots. `node scripts/story-map-input-smoke.mjs` against the running prototype
covers those paths with normal motion, held arrows, code inspection/Escape,
keyboard Find and native widget ownership across A/B/C and phone widths.
The same initial-body/prose and snapshot assertions were run failing before
this fix. A separate code-row reproduction confirmed native horizontal scrolling
and failed Escape-to-map before the handoff fix.

The map owner also accepts arrows from its own toolbar, card-footer Focus and
root-link controls, so returning from Focus does not strand keyboard navigation.
Keyboard immediacy and focus destination are separate: layout selection retains
its native select focus, and Follow restores the options trigger.
