# Code stories: explaining code with no diff

Date: 2026-10-19. Status: decided in session. The user asked for this ("diff story can
be code story too, there is no diff, I just want AI to explain me the codebase"),
opted out of design questions, and said go. Every call below is the builder's call,
made to fit what diffStory already is.

## Intent

diffStory tells the story of a change. The same reader works for code nobody changed:
a guided, read-aloud walk through real source with a moving camera, beat-synced
highlights, and concept pages. A code story answers a question ("How does a quote
become an open position?") or gives a tour of the codebase, and it lives next to diff
stories in Review history.

## Goals

1. Ask for a code story from the app (a new Explain code page) or from any agent through
   the storyteller skill.
2. Read it in the existing story reader, framed for explanation: no diff, coverage, or
   "what changed" language.
3. Keep it trustworthy. The story is pinned to one commit, so its line numbers never
   drift. The checker verifies files, lines, and landings at that commit. The reader
   shows when the code a story visits has changed since.
4. Leave diff stories exactly as they are.

## Non-goals (this round)

- Explaining uncommitted code. A code story explains a commit. When the working tree
  differs, the agent is told which files to read with `git show <sha>:<path>`.
- Focused refresh of a code story. "Rewrite at current code" re-runs the same question.
- A Zed MCP code-story mode, and story-eval cases for code stories.
- A chat loop. Questions queue as comments and copy out, as today.

## Anti-goals

- Any change to diff-story prompts, validation, coverage, or rendering.
- A code story overwriting `.diffstory/story.json`.

## File contract

```jsonc
{
  "version": 4,
  "subject": "code",                // absent or "diff" means a diff story
  "head": "<40-hex commit id>",     // required: the code this story explains
  "base": "<same id>",              // optional; must equal head; the loader fills it
  "codeScope": {                    // optional, plain text, written by whoever asked
    "ref": "main",                  // the name the reader picked (<= 200 chars)
    "question": "How does …?",      // the request as typed (<= 4000 chars)
    "paths": ["contracts/facets"]   // <= 50 safe repo-relative files or directories
  },
  "mode": "guided",
  "title": "…", "summary": "…",
  "intent": { "goal": "…", "design": "…", "sources": ["code-derived"], "nonGoals": ["…"] },
  "storyArc": { "shape": "entry-implementation", "readingPath": "a -> b -> c" },
  "hotspots": [{ "step": "s3", "reason": "…" }],
  "steps": [/* only "context" and "concept" steps */]
}
```

- `base` equal to `head` makes every diff path in the app see an empty diff: coverage is
  trivially complete, the changed-file index is empty, and context steps render from the
  pinned commit. Nothing diff-shaped needs a special case beyond refusing scope overrides.
- `storyArc` has no `changeType`. Code shapes: `entry-implementation`, `lifecycle`,
  `data-flow`, `map-then-path`, `core-supporting`, `rule-instances`, `cause-effect`.
- Code stories may not carry `storyScope` or `evolution`.
- Intent reads as explanation: `goal` is what the reader will understand, `design` is the
  short answer, `nonGoals` is what the story leaves out. Hotspots mark where the code is
  subtle or the explanation least certain.
- App-written code stories live at `.diffstory/stories/code-<slug>.json`.

## Reader

- Overview: "The story of this code", "Explains main at 1a2b3c4", and a drift line that is
  quiet when visited files match the commit and says "N story files changed since 1a2b3c4 ·
  Rewrite at current code" otherwise.
- Steps label their kind "Code", not "Context". The Files tab lists the files the story
  visits. The Review page drops Coverage and Challenge and opens on Comments.
- Step repair (rewrite, shorten, split) works on code stories and writes back to the
  story's own file.

## Explain code page

`/repo/<name>/explain`: a question box, optional focus paths, the ref to explain (default:
current branch), depth, audience, and writer. It streams progress with the shared
progress panel and opens the finished story. `?story=<id>` pre-fills it from an existing
code story to rewrite that story at the current code.

## History

Code stories show "Code story" in the facts line, a `main @ 1a2b3c4` scope chip, "Read
story" instead of "Resume review", and "Code changed" when visited files moved on.
