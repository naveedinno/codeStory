# Gateway story map prototype

Question: can a reader understand the gateway by expanding a map of meaningful
questions beside the existing code, then choose how deeply to read each branch?

Status: runnable design prototype; owner comparison pending. No variant has
been promoted to the application. Capture branch: `prototype/story-map-gateway`,
based on `ce912c9` in the CodeStory repository. Main and the installed app retain
the existing viewer.

Run from this checkout:

```sh
npm run prototype:story-map -- --repo /path/to/core --story stories/code-complete-tour.json
```

The development runner prints the local review URL on port 7799. It uses the
real existing story at its pinned revision, an isolated temporary app home,
and the normal lazy source renderer. It injects the prototype only through
this runner; `NODE_ENV=production` refuses to start it. No generated story is
written or committed. The proxy refuses mutations except the local narrator.

Compare three layouts on the same review route:

- `?variant=A`: connected left-to-right map with four question branches;
  Overview/Detail changes the selected card from a label to its real explanation.
  On phones the branches reflow vertically at readable text sizes.
- `?variant=B`: expandable tree with nested explanations.
- `?variant=C`: focused question and detail columns.

The floating design bar cycles layouts and preserves the selected topic.
Left/right keys also cycle while the design bar or the page itself has focus.
Application widgets retain their keyboard behavior. Buttons support normal
Tab/Enter/Space.

Selecting a node opens the real step and updates the reading branch; explanation
nodes select its actual highlighted beat. Manual selection stops playback so
the old branch cannot override the new topic. Play reads the new function from
its introduction. The map follows source navigation and narration. Breadcrumbs
return to ancestors. Focus code collapses the map. Follow this branch changes
the existing Play transport's reading path to that branch. Follow gateway
restores the curated chapter path. Branches organize the authored story;
connections do not claim a compiler-resolved runtime call graph.

Prototype state stays in memory; only the layout key is placed in the URL.
The existing viewer continues using its normal reading-position preferences.
Playback uses the existing local narrator; new audio synthesis is not part of
this prototype. Browser checks inspect the planned narration separately from
audible playback.

Source locations: `story-map.prototype.tsx`, `story-map.prototype.css`, and
`scripts/story-map-prototype.mjs`. The engine's path hooks are
throwaway integration code on this branch, activated only by the prototype.
The loading placeholder also retains its speech cache so prefetching cannot
drop a helper from the narration plan. Narration reveals a freshly loaded
helper panel even when its lazy placeholder was already the active step.

Reference: the core docs map at `core/docs/site/assets/map.js` and `map.css`.
Its key ideas carried here are semantic levels of detail, connected expansion
from parents to children, parent breadcrumbs, readable mobile reflow, and
centering the selected topic without moving the source reader. This prototype
uses instant native scrolling and discrete detail levels; it does not add the
docs site's animated pan/zoom camera.

Verification: `npm run check` passes 1,123 existing tests. Manual browser checks
cover all three layouts, 390px/320px mobile widths, 1024px focus-code collapse,
keyboard tab navigation, unselected branch expansion, branch endpoints, map
reopening, original story bytes, and local read-only request guards. Mocked
playback requests/progress cover the gateway path, delayed helper loading,
route-only reading, and switching to signatures during playback. Audible Lino
synthesis and screen-reader behavior have not been tested for this prototype.
The final focused independent recheck has no remaining concrete findings.
Keep the prototype and layout switcher off main; implement a chosen direction
properly after owner feedback.
