# Pele for codeStory: replacement assessment

Checked 2026-10-20 against the working checkout. Recommendation: adopt Pele as the preferred Mermaid-syntax renderer through a staged migration. Keep an explicit rollback while comparing real historical stories. This evaluation changed no application code or dependencies.

The separate [upstream investigation](./pele-upstream-evaluation-2026-10.md) covers licensing, exact release artifacts, maintenance, testing, security probes, and known issues.

## Where the replacement applies

The current package uses Mermaid **11.16.0**. It is bundled separately and imported on demand for concept diagrams:
- [browser asset build](../../scripts/build-browser-assets.mjs)
- [rendering, theme configuration, sanitization, and interaction](../../client/surfaces/review/engine/review-engine.js)
- [asset serving](../../src/server.ts)
- [diagram validation](../../src/tour.ts)

Only `flowchart` (five allowed directions), `sequenceDiagram`, and `stateDiagram-v2` are accepted. Sources are limited to 8,000 characters and 80 lines, and the renderer is limited to 120 edges. Directives, links, URLs, HTML tags, image directives, and authored styling are denied before rendering. Pele supports all three allowed families.

The optional `diagram` field belongs to legacy body-based concept steps. Newer v4 `page` concepts use a separate HTML/iframe path; they cannot also carry `diagram`. Replacing Mermaid changes the legacy renderer and does not redesign the newer concept pages.

Keep `type: 'mermaid'` in stored stories: it describes the input syntax. An engine swap does not require a story-schema migration or new authoring language.

## Independently measured bundle sizes

Published **pele@1.7.0** was installed in an isolated temporary directory with scripts disabled; the app's package and lockfile were unchanged. The same esbuild settings as the checked-in Mermaid asset were used: ESM, browser, ES2022, minified, bundled, legal comments at end.

| Asset | Bytes | gzip bytes |
| --- | ---: | ---: |
| Current Mermaid asset | 3,521,949 | 964,847 |
| Pele, all public exports / all types | 678,997 | 251,516 |
| Pele core + flowchart, sequence, state; render/parse/PeleError exports | 187,415 | 69,986 |

The narrow bundle is **92.75% smaller compressed** and **94.68% smaller uncompressed** than the actual current asset. These are reductions in the diagram asset, not in the whole application. Mermaid already loads conditionally.

The current server sends the asset directly with Content-Length and a one-hour cache header; it does not gzip this route itself. Uncompressed asset size therefore matters for direct local serving. A proxy may compress it independently.

## Browser comparison

An isolated local browser harness imported the current checked-in Mermaid bundle and the freshly bundled published Pele package. It loaded the app's IBM Plex Sans font. Chromium **154** was used. Both engines used 14px text; Mermaid used the app's existing layout and sequence configuration. Pele used controlled limits and disabled links/images. The existing application SVG sanitizer processed both outputs.

Collected 12 distinct diagram strings from local tests, plus 9 added probes:
- **7 valid local test examples** rendered in both engines.
- **8 valid, permitted additional probes** rendered in both engines: budget flowchart, nested subgraph, state lifecycle, sequence with activation/alternative branches, long protocol identifiers, entity-encoded comparisons, multiline Markdown labels, and a cycle.
- **3 intentional syntax failures** from local tests failed in both engines: unquoted parentheses in node/edge labels and an unescaped sequence semicolon.
- **3 additional safety/portability probes** were outside the application's allowed-source policy: script-shaped label, remote image, and literal generic-type tag.

Thus **15/15 valid examples rendered**, with **3/3 intentional syntax errors rejected by both**. This is a focused sample, not an audit of every historical story. The local story and example JSON inspected did not provide additional diagram sources.

The current sanitizer accepted Pele's SVGs and retained visible labels and shapes in these cases. This verifies the sampled integration boundary, not all possible SVG or security behavior.

### Timing

For seven examples, two warmups followed by ten render calls per engine:

| Example | Pele median ms | Mermaid median ms |
| --- | ---: | ---: |
| Request flow | ~0.1 | 4.3 |
| Budget flow | ~0.1 | 6.3 |
| Nested subgraph | ~0.2 | 8.5 |
| State lifecycle | ~0.1 | 9.0 |
| Sequence review | ~0.1 | 3.5 |
| Long identifiers | below 0.1ms resolution | 2.0 |
| Cycle | ~0.1 | 6.4 |

The timing starts just before the render API and stops when it returns/resolves. It excludes module loading, application sanitization, final DOM insertion, and painting. The small numbers approach the browser timer's resolution; a precise speedup multiple would be misleading. First calls were about 10.4ms for Pele and 23.9ms for Mermaid in this particular harness; that is not a controlled cold-load measurement.

### Responsive layout, theming, and limits

- Additional rendering at target widths **320, 640, 960px** retained the labels in the six tested diagrams. Pele could rearrange a horizontal flow vertically and wrap sequence labels. A 320px budget diagram still had a natural width of 357px: maxWidth is an adaptive target rather than an absolute guarantee.
- Changing `--pele-surface` and `--pele-fg` changed computed fill/text colors while retaining identical SVG child markup and DOM nodes. Color-only theme switching does not require re-rendering. Font changes still require measurement/rendering.
- `limit:8000`, `maxEdges:120`, and an output limit each rejected over-limit probes with a structured `limit` error. Exactly 120 edges were accepted and 121 rejected.
- Syntax errors carried a code, line, column, and snippet. The current error UI parses line numbers from messages; adopting the structured fields would be more robust.
- Sequence footer actors disappear with `config.sequence.mirrorActors:false`. Default Pele options otherwise differ from the current Mermaid setup. Per-role font settings are not all portable; see the upstream report.

### Label caveat in context

An unencoded quoted `List<T>` became `List` in both tested renderers. The app already rejects this source as an HTML-tag pattern, so the upstream angle-bracket issue is not evidence of a new regression in our allowed corpus. Entity-encoded comparison/generic labels survived in Pele. Errors-only fallback cannot detect silent content changes in general.

## Concrete migration scope

1. Pin the tested Pele version and build a same-origin diagram asset containing only the three accepted types. Use an engine-neutral adapter and asset name rather than scattering library-specific calls.
2. Replace the async Mermaid-specific render call with a wrapper around Pele's synchronous render result. Keep the existing figure, caption, source fallback, health reporting, fullscreen, pan/zoom, and SVG sanitization.
3. Pass controlled `limit:8000`, `maxEdges:120`, `links:false`, `images:false`, a bounded outputLimit, a unique idPrefix per figure, and actual font settings. Preserve the existing source validation and 80-line rule.
4. Map application theme tokens to Pele CSS variables. Existing Mermaid selectors such as `.node .label text`, `rect.basic`, and `.edgeLabel` need replacement. The Mermaid-specific tspan line-spacing workaround can be reconsidered against actual Pele output.
5. Handle width/font changes explicitly. `render()` keeps our existing SVG insertion and interaction lifecycle straightforward, but requires resize/font hooks. `mount()` supplies those hooks while introducing its own observer/zoom lifecycle and sanitization callback; avoid competing pan/zoom implementations. An open upstream observer-loop report deserves a regression check if mount is chosen.
6. Preserve robust inline error handling and source fallbacks. Keep an explicit renderer switch/rollback during corpus comparison. An error fallback helps with thrown errors but cannot detect wrong labels, overlaps, or ignored settings.
7. Update bundle-route, release-asset, typography, sanitizer, error, and interaction checks; rebuild the checked-in dist assets. Visually exercise real stories in both themes and widths, plus fullscreen/zoom and fonts loading late, before removing the previous engine.

Potential additional value: Pele's parser/render API runs in Node without a browser DOM, so authoring/generation could validate syntax earlier and reduce late browser-only failures. This is a possible follow-up, not implemented here.

## Decision

Pele is an unusually good fit for the restricted syntax and local rendering policy already present here. Smaller distribution, much faster sampled rendering, direct CSS theming, and adaptive layout are substantive gains. MIT licensing and first-party Obsidian ownership are favorable; the upstream report records those sources and caveats.

The main remaining uncertainty is fidelity across the real story corpus and lifecycle behavior inside the application. The renderer is about two weeks old, and the upstream issue tracker contains wrapping, overlap, and resize reports. A staged switch is justified; immediate deletion of the existing renderer would get ahead of the evidence.

No npm dependency change, lockfile change, app implementation, commit, or publication was performed. New research notes are the only repository additions.
