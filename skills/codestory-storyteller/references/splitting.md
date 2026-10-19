# Splitting a change into scoped stories

Part of the codestory-storyteller skill. Read before writing anything under `.codestory/stories/`.

### The splitting test

Write **one** story unless *all four* hold:

1. **Independent concerns.** A reviewer could accept or reject each on its own.
2. **No narrative crossing.** No `calls`/`returnsTo` you would want crosses a
   concern boundary. If the reading path flows from one into the other, it is
   one story.
3. **Clean file ownership.** Each concern owns most of its files outright.
4. **Length that costs the reviewer.** One combined story would run roughly 40+
   steps or 25+ files.

Any doubt: one story. Good `chapter` values beat a picker.

### If you split

- One file per concern, named for the concern
  (`transient-execution-context.json`), each a complete story with its own
  `title`, `summary`, `intent`, `base`.
- `storyScope.includedFiles` lists exactly the files that story's steps touch.
  Straddling files go in both stories; each narrates only its own hunks and
  says so in `why`. Use `storyScope.reviewerNote` to name what is reviewed
  elsewhere.
- Every changed hunk is claimed by exactly one story; run the coverage ledger
  per story and check the union.
- Do not also write `.codestory/story.json`. If a stale one exists, say so
  rather than deleting it.

### Do not split

By directory, package, language, or file type; to separate tests, docs, or
generated files from the behavior they support; or to make a long story
shorter — cut narration and group mechanical hunks instead.
