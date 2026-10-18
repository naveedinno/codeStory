# Story schema: narrative text

This is the normative statement of what may appear in a diffStory story file's
narrative fields. It covers `.diffstory/story.json` and every
`.diffstory/stories/*.json`.

Structural fields (`id`, `order`, `file`, `range`, `viewport`, `highlights`,
`kind`, `calls`, `returnsTo`, `preparesFor`, `diagram`) are documented in
[`src/types.ts`](../src/types.ts). This document is only about the fields that
carry prose.

## Narrative fields are HTML

Story narrative is authored as HTML. It is sanitized before rendering: an
allowlist of elements and attributes is applied, and the output is re-serialized
from a validated parse tree. Anything outside the allowlist is removed.

**Migration rule.** There is no version gate and no per-field format detection.
Every story is read as HTML from this change forward. A story authored before this
change whose text contains Markdown renders that Markdown literally — `**bold**`
appears on screen as `**bold**`, not as bold text. The fix is to regenerate the
story; there is no automatic conversion.

`Tour.version` is unrelated to text format: `1` means code-only steps, `2` permits
concept primers, `3` permits semantic logic moves, and `4` permits page concepts
and lifts concept placement rules. Narrative shape and commit evolution are
optional additions to version 3, so older version 3 stories remain valid and
repairable without either field.

Reviewer comments (`comments.json` — `body`, `reply`, `turns[].text`) are **not**
covered by this document. They are human-authored through the review UI and stay
Markdown.

## Field tiers

Each narrative field belongs to one of three tiers. The tier is fixed by what the
surrounding markup can legally contain, not by editorial preference.

### Tier A — block HTML

| Field | Notes |
| --- | --- |
| `steps[].body` (concept steps only, legacy) | The 60–180 word primer. The only field that may contain tables, lists, headings, or preformatted blocks. Superseded by `steps[].page` for new stories; still valid and rendered for existing ones. |
| `steps[].page` | A complete HTML document: any HTML, CSS, JS, CDN resources. Served sandboxed, never sanitized — none of the rules below apply to it. It has no background of its own: the frame keeps `html` and `body` transparent so the app background shows through. |
| `steps[].narration` | Plain text Aloud reads for a page concept. |

Allowed for `steps[].body` (the two v4 fields above are exempt): the inline set below, plus

```
p  h2  h3  h4  ul  ol  li  blockquote  pre  hr
table  caption  thead  tbody  tr  th  td
dl  dt  dd
```

Headings start at `h2`; the concept document supplies its own `h1` from the step
title.

### Tier B — inline HTML only

| Field | Renders inside |
| --- | --- |
| `steps[].why` | `<p class="ds-why-text">` |
| `steps[].moves[].hidden.what` | The one invisible fact shown by a callout. |
| `steps[].beats[].text` | `<button class="ds-beat">` |
| `summary` | `<p class="ds-intro-lede" data-speech-overview>` |
| `intent.goal` | `<p class="ds-intro-lede" data-speech-overview>` |
| `intent.design` | `<p class="ds-intro-design" data-speech-overview>` |
| `intent.nonGoals[]` | `<li>` |
| `hotspots[].reason` | `<span class="ds-hotspot-reason">` |
| `steps[].diagram.caption` | `<figcaption>` — and it is what the narrator speaks for the figure |
| `evolution.phases[].summary` | A phase explanation inside the commit-evolution disclosure. |
| `verification[].detail` | `<span class="ds-verify-detail">` |

Allowed:

```
code  kbd  strong  em  sup  sub  span  br
```

Block elements are rejected here because these fields render inside elements that
cannot contain them. A block element inside a `<p>` force-closes that `<p>`, and
for `summary` / `intent.goal` / `intent.design` that paragraph *is* the node the
read-aloud narrator queries — the audio breaks silently. A block element inside
the beat `<button>` is invalid markup that browsers reflow, which corrupts both
the two-line clamp and the button's accessible name.

### Tier C — plain text

| Field | Notes |
| --- | --- |
| `title` (story) | Feeds `<title>`, the page header, and a chrome tooltip. |
| `steps[].title` | Feeds nine sites including `aria-label` and `title` attributes. |
| `steps[].moves[].label` | A plain-text annotation tag of at most 24 characters. |
| `steps[].moves[].hidden.tag` | A plain-text callout headline of at most 48 characters. |
| `storyScope.reviewerNote` | Reviewer-authored, prompt-only, no render surface. |
| `storyArc.readingPath` | The quiet overview path. Store ASCII `->`; the UI renders and announces the separators. |
| `evolution.phases[].title` | The phase heading in commit evolution. |
| `evolution.phases[].firstCommit` / `lastCommit` | Hex commit boundaries; generation accepts 7-40 characters and expands unique prefixes. |
| `verification[].check` | What the author ran, as the reviewer would type it. At most 120 characters; rendered in the review-notes verification list. |
| `steps[].landing.symbol`, `.calledBy[]`, `.role.who`, `.role.gate`, `.when` | Author-reported "where am I" facts shown under the step title. At most 80 characters each (`role.who` 40); callers must be symbols the checker can find alongside `symbol`. This is textual co-occurrence, not proof of a call or runtime reachability; the app exposes the matching source for inspection. |

No markup at all. Tags are stripped to their text content. A `<table>` in a
sidebar title is never the right answer, and attribute sinks can only ever show
markup as literal characters.

## Concept pages and privacy

A page concept runs in an iframe with `sandbox="allow-scripts"` and an opaque
origin. The page is sandboxed however it is loaded: its response carries the
same sandbox in its `Content-Security-Policy`, so opening the page URL directly
in a tab does not give it diffStory's origin either. It cannot read diffStory's
storage, call its API, navigate the app, or open popups. Of the keys pressed
inside it, only story navigation keys reach diffStory, and only while the page
is focused on the active step.

The page is offline by default: inline markup, script, and style run, but
every network request is blocked. A page opts into network access with
`"network": true` on its step, and only then does the CDN trade-off apply:

- Opening the story can make your browser contact servers its author chose,
  revealing your IP address and that the story was opened.
- The page is served from `127.0.0.1`, so it can also send requests to other
  services on this machine's loopback, such as a local dev server. diffStory
  itself refuses the page's requests, but any local service that allows
  cross-origin requests, or acts on a simple request without checking where it
  came from, is reachable from the page.

Pages with network access carry a Network badge on the step, so the opt-in is
visible before the page loads.

## Narrative shape and commit evolution

Every newly generated story includes `storyArc`. Its `changeType` and `shape`
use the enums in `src/types.ts`; `readingPath` is non-empty plain text of at most
200 characters. Stage count and editorial quality are judged by the storyteller
evaluation rather than by schema validation.

Fixed `base..head` stories may also include `evolution` when their frozen
first-parent range contains 2-30 commits. The server owns its full 40-character
`baseSha` and `headSha`. The storyteller groups that immutable history into 1-6
ordered phases with non-empty titles and inline-HTML summaries. Phase boundaries
are 7-40 hexadecimal characters during authoring and are expanded to full SHAs
when unique. Optional `relatedSteps` values must resolve to story step ids.

Evolution is supporting context, not a replacement diff. The final diff remains
authoritative, and a recoverable gap or overlap hides the disclosure without
discarding the main story.

## Attribute allowlist

This is the complete list. Every attribute not named here is removed, including
all `on*` event handlers — they are excluded by construction rather than by a
denylist, so a novel handler name has nothing to match against.

| Attribute | Allowed on | Permitted values |
| --- | --- | --- |
| `class` | `span` `code` `td` `th` | exactly one of `ds-bit`, `ds-slot`, `ds-flag`, `ds-val`, `ds-warn` |
| `scope` | `th` | `row`, `col` |
| `colspan` | `td` `th` | integer 1–20 |
| `rowspan` | `td` `th` | integer 1–20 |
| `data-lang` | `pre` | matches `[a-z0-9-]{1,20}` |

**No URL-bearing attribute is allowed anywhere.** There is no `href`, `src`,
`action`, `formaction`, `srcset`, `poster`, or `xlink:href`. Stripping
`javascript:` and `data:` URLs is therefore not a rule the sanitizer applies — it
is a situation that cannot arise, because there is no attribute a URL could
occupy.

`class` accepts a fixed vocabulary rather than arbitrary values, so a story
cannot reach into the page's own stylesheet or defeat theming. `id` is excluded
(DOM clobbering, collisions with the page's own ids). `style` and `title` are
excluded outright.

### The class vocabulary

| Class | For |
| --- | --- |
| `ds-bit` | a single bit or bit range in a layout |
| `ds-slot` | a storage slot, field, or named position |
| `ds-flag` | a boolean or enum flag value |
| `ds-val` | a numeric literal worth setting apart |
| `ds-warn` | the value or row a reviewer should distrust |

## Removed elements

Dropped along with everything inside them:

```
script  style  iframe  object  embed  form  input  textarea  select  button
template  noscript  svg  math  link  meta  base  title  head  body
```

Any other element outside the allowlist is unwrapped: the tag is dropped and its
children are kept.

Comments, CDATA sections, doctypes, and processing instructions are removed
entirely. Nesting deeper than 20 elements is flattened to text.

**There is no inline SVG.** SVG switches the HTML parser into foreign-content
mode, where parsing rules differ — `<style>` becomes raw text, `<foreignObject>`
re-enters HTML, CDATA is recognised. That namespace confusion is the source of
most historical mutation-XSS bypasses. For diagrams, concept steps carry an
optional `diagram` field rendered by local Mermaid, which is already validated
and already themed.

## Tables

A `<table>` must have a `<caption>`. A table without one is dropped.

Where the caption sits is not the author's problem: a caption written anywhere
inside the table is moved to the front, and a second caption is discarded. Only
its **absence** is an error, because an uncaptioned table is a reading hazard —
it is a grid with no statement of what it tabulates, and it is silent to the
read-aloud voice.

The caption is not decorative:

- screen readers need it
- **it is what the read-aloud voice speaks in place of the table** (below)

Each table is rendered wrapped in a scroll container so a wide table scrolls
inside itself and never scrolls the review panel sideways.

```html
<table>
  <caption>Slot 0 packs the three settlement flags into the low byte.</caption>
  <thead>
    <tr><th scope="col">Bits</th><th scope="col">Field</th><th scope="col">Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><span class="ds-bit">0</span></td><td><code>settled</code></td><td>set once funding has moved</td></tr>
    <tr><td><span class="ds-bit">1–2</span></td><td><code>mode</code></td><td>capped, floored, or passthrough</td></tr>
  </tbody>
</table>
```

## Read-aloud

Narration text is derived from the same HTML, projected to a clean speech stream
before it reaches the voice. Markup never reaches the phonemizer.

| Construct | Spoken as |
| --- | --- |
| `p`, `li`, `blockquote`, `h2`–`h4`, `dd` | its own sentence |
| `dt` + `dd` | "term: definition." |
| **`table`** | **its `<caption>`, and nothing else** |
| `pre` | skipped |
| `hr`, `br` | a pause |
| `code`, `kbd`, `strong`, `em`, `span`, `sup`, `sub` | their text, unwrapped |

**Why a table is not read row-wise.** Reading a bit-layout aloud cell by cell
produces "bit 0, field, settled, meaning, set once funding has moved, bits 1 to 2,
field, mode…" — unusable as audio, and long enough to distort the narration
chunking that drives beat highlighting. Speaking the caption instead means the
listener gets the one sentence the table exists to support, and the reader gets
the full table on screen. This puts a real obligation on the author: **write the
caption as the sentence you would say out loud if the table were not there.**

`<pre>` is skipped for the same reason, matching how fenced code has always been
handled.

## Authoring checklist

- concept `body` (v2–v3 generated stories) is 60–180 words of prose (hard
  maximum 220), counted as text with tags excluded
- a table earns its place only when a prose sentence would be worse; it always
  has a caption that stands alone
- `beats[].text` is one spoken sentence — inline markup only, and usually none
- titles are plain text
- in prose fields (everything except a concept `page`): no links, no images,
  no SVG, no inline styles
- if a story needs an element that is not on the allowlist, the story needs
  rewriting; the allowlist does not grow to accommodate one story

## Captured verification and focused refresh

`verification` entries are authored claims. A reported `passed` result never
becomes an app-captured pass merely by appearing in story JSON. The reviewer
can confirm **Run locally…** for the displayed command; diffStory records the
command, output, exit status, time, checkout revision, and review/source
fingerprints in its device-local app home. Receipts are not story fields and
are not included in exported story bundles. Runs time out after two minutes;
a source change during or after execution makes the receipt out of date.
A fixed-ref review requires the checkout to match that revision before a run.

A focused refresh starts from an exact **Since story** observation and changes
only affected steps and their connected explanations. Existing IDs and relative
reading order survive. Independent steps, intent, selected scope, verification
claims, and history remain intact. The server verifies these invariants and
complete changed-range coverage before capturing a new baseline; failure or
interruption restores the original story. Comments are not rewritten.
