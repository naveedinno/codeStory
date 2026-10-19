#!/usr/bin/env python3
"""One-shot, verbatim split of the storyteller SKILL.md into a core + references/.

Moves whole sections by their exact heading lines and leaves a short pointer
where each section was. No rule text is edited. Run once from the repo root:

    python3 scripts/split-storyteller-skill.py

It refuses to run twice (it checks that references/ does not exist yet).
"""
import pathlib
import sys

ROOT = pathlib.Path("skills/codestory-storyteller")
SKILL = ROOT / "SKILL.md"
REFS = ROOT / "references"

if REFS.exists():
    sys.exit("references/ already exists; the split has already run.")

lines = SKILL.read_text().split("\n")


def at(heading):
    hits = [i for i, line in enumerate(lines) if line == heading]
    if len(hits) != 1:
        sys.exit(f"expected exactly one line {heading!r}, found {len(hits)}")
    return hits[0]


# (start heading, end heading exclusive, destination file, pointer left in core)
MOVES = [
    ("### The splitting test", "## Detail levels", "splitting.md",
     "Split into scoped stories only when the diff passes every test in\n"
     "`references/splitting.md`; read it before writing anything under\n"
     "`.codestory/stories/`. Any doubt: one story.\n"),
    ("### 3.6. What good looks like: the same diff, told twice", "### 3.75. Test for concept gaps", "examples.md",
     "### 3.6. What good looks like\n\n"
     "Before your first story in a session, read `references/examples.md`: the\n"
     "same small diff told as a changelog and as a story.\n"),
    ("### 3.75. Test for concept gaps", "#### Narrative fields are HTML", "primers.md",
     "### 3.75. Test for concept gaps\n\n"
     "Before each code stop, ask whether the reviewer can already explain the\n"
     "terms, roles, and state the next lines need. When and how to write a concept\n"
     "primer is in `references/primers.md`.\n"),
    ("#### Narrative fields are HTML", "### 4. Plan the reading path", "schema.md",
     "Narrative fields are restricted HTML, not Markdown. The allowed tags for each\n"
     "field are in `references/schema.md`.\n"),
    ("### 5. Storyboard the camera", "### 5.4. Record semantic logic moves", "camera-and-coverage.md",
     "### 5. Storyboard the camera\n\n"
     "Every code step is one steady camera shot. Read\n"
     "`references/camera-and-coverage.md` for the viewport, highlight, `range`, and\n"
     "top-level `ranges` contracts before choosing any line numbers.\n"),
    ("### 5.4. Record semantic logic moves", "### 5.6. Split code narration into read-aloud beats", "moves.md",
     "### 5.4. Record semantic logic moves\n\n"
     "When logic moved, was extracted or inlined, or gained or lost a guard, read\n"
     "`references/moves.md` and record it in the step's `moves`.\n"),
    ("### 6.25. Write concept primers with the exact fileless shape", "### 6.5. Put necessary context in the visible story", "primers.md",
     "### 6.25. Write concept primers with the exact fileless shape\n\n"
     "The exact concept-step shape is in `references/primers.md`.\n"),
    ("## Hard quality gates", "### Coverage ledger", None,
     "## Hard quality gates\n\n"
     "Coverage is necessary, not sufficient. Build the coverage ledger\n"
     "(`references/camera-and-coverage.md`) before writing, and run the truth,\n"
     "narrative, and camera audits (`references/audits.md`) before handing back.\n"),
    ("### Coverage ledger", "### Truth audit", "camera-and-coverage.md", None),
    ("### Truth audit", "## Schema", "audits.md", None),
    ("## Schema", "## Save and verify", "schema.md",
     "## Story file shape\n\n"
     "Immediately before writing JSON, even if you read it earlier in this session,\n"
     "read `references/schema.md`: the exact schema with a valid example, the HTML\n"
     "rules for every field, and the concept-step shape. Long sessions get\n"
     "compacted, and the schema is the first thing lost.\n"),
]

HEADERS = {
    "splitting.md": ("Splitting a change into scoped stories", "Read before writing anything under `.codestory/stories/`."),
    "examples.md": ("Worked examples", "Read once per session, before your first story."),
    "primers.md": ("Concept primers", "Read when a code stop needs a mental model the reviewer does not have yet."),
    "schema.md": ("Story file schema and narrative markup", "Read immediately before writing or editing story JSON."),
    "camera-and-coverage.md": ("Camera and coverage contracts", "Read before choosing `range`, `ranges`, `viewport`, or `highlights`, and before the final coverage pass."),
    "moves.md": ("Semantic logic moves", "Read when logic moved, was extracted or inlined, or a guard was added or removed."),
    "audits.md": ("Self-review audits", "Run every audit before handing a story back."),
}

spans = []
for start_h, end_h, dest, pointer in MOVES:
    start, end = at(start_h), at(end_h)
    if end <= start:
        sys.exit(f"{start_h!r} must come before {end_h!r}")
    spans.append((start, end, dest, pointer))

bodies = {name: [] for name in HEADERS}
core = []
cursor = 0
for start, end, dest, pointer in sorted(spans):
    if start < cursor:
        sys.exit("overlapping sections")
    core.extend(lines[cursor:start])
    if dest:
        bodies[dest].append("\n".join(lines[start:end]).rstrip() + "\n")
    if pointer:
        core.extend(pointer.rstrip("\n").split("\n"))
        core.append("")
    cursor = end
core.extend(lines[cursor:])

REFS.mkdir()
for name, (title, when) in HEADERS.items():
    text = f"# {title}\n\nPart of the codestory-storyteller skill. {when}\n\n" + "\n".join(bodies[name])
    (REFS / name).write_text(text.rstrip() + "\n")
SKILL.write_text("\n".join(core).rstrip() + "\n")
print(f"SKILL.md: {len(lines)} -> {len(core)} lines")
for name in HEADERS:
    print(f"references/{name}: {len((REFS / name).read_text().splitlines())} lines")
