# Gateway content-card prototype

Question: can the story itself live in connected cards, with prose, diagrams,
source code and real code diffs inside the map?

The owner clarified that the map is the reading surface. Each topic now owns
`content` blocks: `text`, `diagram`, `code`, or `diff`. A card can combine blocks.
The former permanent code pane is hidden in this prototype; the existing lazy
panels remain as the narration state engine. Focus card opens the same content
in a larger native dialog, including caller context where available.

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

Compare three content layouts using the floating design bar:

- `?variant=A`: connected cards with their content visible inside the map.
- `?variant=B`: an expandable reading tree containing the same rich cards.
- `?variant=C`: branch selection and one focused content card.

The gateway overview combines prose with a small validation-order diagram.
Route/signature cards contain pinned source with line numbers and beat-based
highlights. Caller context can expand inside the code card. Replay and other
explanation cards contain prose. The Call/SignedCall card contains a real
historical diff of `SymmioGatewayTypes.sol`, from `d8a23d4` to the story's
`6399ecf`. Its old/new revisions and historical scope are labeled explicitly;
it is not a working-tree diff or a fabricated example.

Buttons retain keyboard behavior. Layout arrow shortcuts apply only to the
design bar or the page itself. A focused card is a modal dialog with native
Escape, Tab containment, and a Close card action. The source and diff regions
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
reflow into content cards. Scrolling is instant; no animated camera was added.
The topology organizes authored explanations and does not claim to be a
compiler-resolved call graph.

Implementation: `story-map.prototype.tsx`, `story-map.prototype.css`, and
`scripts/story-map-prototype.mjs`. State stays in memory; only the layout key is
stored in the URL. No variant has been promoted to the application. Keep this
prototype off main and implement the chosen direction after owner feedback.

Verification: `npm run check` passes 1,123 existing tests and client typecheck
passes. Browser checks cover all three layouts, 390px and 320px widths, inline
code/diff inspection, focused reading and branch links. Every displayed source
line and changed diff row matches the pinned Git data; story bytes are unchanged.
Mocked narration checks cover gateway/branch scoping, progress into focused
diff/code cards, Pause/Resume/Stop, and source keyboard scrolling without story
navigation. Audible synthesis and native installation were not tested for this
prototype.
