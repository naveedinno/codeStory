# Cards for map exploration and narrated reading

Part of the codestory-storyteller skill. Read before planning chapters, cards
and media for either a code story or a diff story. The same story should support
direct exploration and a coherent default reading path.

## Author the explanation, leave layout to the reader

Use the existing version 4 story format in `references/schema.md`. The full-story
map prototype derives chapter groups, step cards and later-beat explanation
children from `chapter`, steps and `beats`. Higher-level sections, card numbers,
positions, sizing, folding and camera motion belong to the reader. Map support
does not require migrating an existing story or changing its pinned scope.

Do not write prototype `nodes`, `children`, `content`, `viewerId` or camera
fields into story JSON. Do not manually number titles. Keep step IDs stable
when revising an existing story so its references still resolve. The prototype
is a presentation of the story, not a new authoring schema or proof that every
installed app already offers the map.

`calls`, `returnsTo`, `landing.calledBy` and `callSite` describe code context.
They do not define the chapter tree or cause an arbitrary helper subtree to
appear. A visual parent/child relationship is explanatory organization, not
proof of a call. Inspect the actual source before authoring a code relationship.

## Organize around the reader's questions

Make a private plan: chapter/question, card purpose, evidence/media and the
question it hands onward. Use questions such as "Can this call proceed?" and
"Who authorized it?" when they distinguish decisions; a short concept name
can be clearer for a chapter. Avoid groups named only for files or directories.

- Give siblings distinct jobs at a comparable level of detail. Separate route
  eligibility from signature authorization when each needs its own evidence.
- Give details the job of answering a question raised by their enclosing card.
  Use a beat for one local decision; use another code step for a different
  function or viewport. Keep the existing mode, beat and camera limits.
- Keep an overview short, then follow the important helpers into their actual
  decisions and consequences (`references/helper-depth.md`). A helper name is
  not an explanation, and a map is not a reason to tour every private function.
- Keep chapters contiguous and follow the existing chapter-size rules. Do not
  repeat an overview under every branch or split one story just to create nodes.

For a gateway, a scratch plan might group route eligibility, signatures and
replay protection as separate questions after an execution overview. Within
route eligibility, explain its common guard, wallet route, self-call route and
external target rule. Return to the caller's use of the result. Translate that
plan into ordinary chapters, steps, beats and verified caller links; it is not
a JSON tree to paste into the file.

## Make openings survive direct entry

Read a card's title and opening without the preceding card. The reader should
know the subject, what decision is being explained and why it matters. Code
cards still need the full landing in their first beat; do not repeat the whole
file/caller introduction in every subsequent beat.

Later beats update the explanation and highlights inside the same code card;
they do not create child cards. Put their useful
subject and decision early: "The wallet route rejects an approver, so it does
not enter the timelock path." Avoid an isolated "Otherwise, it rejects it."
Name the route or value instead of relying on the preceding screen. Keep
counterexamples and consequences source-supported.

Preserve continuity in the default `order` and `storyArc.readingPath`: after
orientation, follow the decision to its consequence and proof. A chapter seam
can connect through named concepts while still explaining the destination to
someone who skipped the previous chapter. Use semantic names for destinations,
not "the card on the right", "step 25" or "the next blue card".

## Choose content by what the reader needs to inspect

| Need | Author with the existing format |
| --- | --- |
| A concise explanation without source | A `concept` step with a small HTML `page` and plain-text `narration`. A text-only page is valid when it teaches a concrete rule or model. |
| Relationships, a lifecycle or a worked example | A `concept` page with a static diagram, table or useful interaction. Read `references/primers.md`; its initial state must carry the explanation. |
| How existing code works | A `context` step with the real file, local viewport, landing and highlighted beats. A code story pins one commit and has no diff. |
| What changed and why | A `changed` or `new-file` step in a diff story, anchored to the real comparison and coverage ledger. Use the viewer's source/diff modes. |
| Caller and helper together | The helper's own code step plus a verified `callSite` crop of an earlier caller. This is source context at one revision, not a before/after comparison. |

These are content choices, not new `kind` values. A code card already combines
prose and native evidence; do not add a concept page merely to duplicate its
beat. Never copy source into an HTML page, draw a fake diff, invent historical
changes for a code story, or use `callSite` as a substitute for a real diff.
`moves` / `pairedView` retain their supported comparison contracts.

Keep native inspection in charge of code scrolling, split/full-file modes,
caller context and fullscreen. Author explanation and precise source spans;
do not add competing toolbars, navigation controls or fullscreen scripts to
concept pages. Large cards do not justify whole-file viewports or broad glows.
Keep essential detail in narrated beats or concept narration so exploration,
ordinary playback and exports teach the same decisions.

## Worked example: text, static diagram, native code

This code story explains the prototype adapter at a real pinned revision of
the codeStory repository. Run its checker from that repository, not from an
unrelated project. Adapt the evidence and commit when writing a different story.
It has no old side; a diff story instead uses its actual base/head and ledger.

```json
{
  "version": 4,
  "subject": "code",
  "head": "a7125fe15baf1292435c56905d15c76c695e47e2",
  "mode": "guided",
  "title": "How an authored tour becomes map cards",
  "summary": "First distinguish a card from its viewer, then inspect how each authored step keeps its narration and highlights in place.",
  "intent": {
    "goal": "Understand how the full-story map organizes a tour while retaining native code and page content.",
    "design": "The adapter derives cards from authored steps and points their media at native viewers; beats advance inside the same card.",
    "sources": ["code-derived"]
  },
  "storyArc": { "shape": "map-then-path", "readingPath": "card and viewer -> chapter hierarchy -> adapter source" },
  "steps": [
    {
      "id": "card-and-viewer",
      "order": 1,
      "chapter": "From tour to map",
      "kind": "concept",
      "title": "A card points to content in a native viewer",
      "page": "<!doctype html><html><head><style>body{margin:0;padding:20px;font:16px/1.6 system-ui;color:var(--ds-text)}h2{font-size:20px}</style></head><body><h2>Card and viewer</h2><p>The card identifies an authored step. Its code or concept page remains native viewer content, rather than a copy of source pasted into the map.</p></body></html>",
      "narration": "A map card identifies an authored step. The code or concept page stays native viewer content, so the map does not need its own copy of the source.",
      "preparesFor": ["adapter"]
    },
    {
      "id": "card-hierarchy",
      "order": 2,
      "chapter": "From tour to map",
      "kind": "concept",
      "title": "Chapters group steps, and beats stay inside each step",
      "page": "<!doctype html><html><head><style>body{margin:0;padding:20px;font:16px/1.5 system-ui;color:var(--ds-text)}ol{list-style:none;margin:0;padding:0;display:grid;gap:20px}li{position:relative;padding:12px;border:1px solid var(--ds-line);border-radius:8px}li+li:before{content:'↓';position:absolute;top:-23px;left:18px}small{display:block;color:var(--ds-text-2)}</style></head><body><ol aria-label=\"Map hierarchy\"><li>Chapter<small>Groups authored step cards</small></li><li>Step<small>Retains its native viewer, explanation, and highlights</small></li></ol></body></html>",
      "narration": "A chapter groups authored steps. Each step keeps its native viewer. Narration and highlight changes advance inside that step's card.",
      "preparesFor": ["adapter"]
    },
    {
      "id": "adapter",
      "order": 3,
      "chapter": "From tour to map",
      "kind": "context",
      "title": "The adapter preserves step identity and narrated highlights",
      "file": "scripts/story-map-full-data.mjs",
      "range": [29, 33],
      "viewport": [13, 38],
      "highlights": [[13, 18], [29, 31], [31, 33]],
      "landing": { "symbol": "fullStoryMap()", "role": { "who": "prototype server" }, "when": "when opening a full tour" },
      "why": "Keeping beat text and highlights attached to the step lets the reader follow the code without changing cards.",
      "beats": [
        { "text": "In <code>story-map-full-data.mjs</code>, <code>fullStoryMap()</code> is what the prototype server uses to organize an authored tour into cards while retaining its step order.", "highlights": [[13, 18]] },
        { "text": "Each authored step receives a viewer identity and panel index; concept pages and code keep distinct native content references.", "highlights": [[29, 31]] },
        { "text": "The code card retains its beat count and highlight ranges, so narration advances in the same viewer without adding child cards.", "highlights": [[31, 33]] }
      ]
    }
  ]
}
```

## Before handing back

Check a middle card and a later explanation by direct entry, then read the
default path aloud. Both should make sense without duplicate introductions.
Check caller crops and source revisions, keep the diff ledger complete, and
run the bundled story checker. Passing schema validation does not prove the
explanation is useful. If you inspect the rendered map, distinguish that
evidence from checks of the JSON alone; do not claim Focus, keyboard or video
behavior you did not exercise.
