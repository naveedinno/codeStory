// Detect and drive the user's coding agent (Claude Code / Codex) headlessly to
// generate the story. The spawn itself is integration-only; the pure helpers
// (onPath, storyPrompt, agentCommand) are unit-tested.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';
import { codexTaskBinary } from './codex-tasks.js';
import { fileEvent, commandEvent, activityEvent, toolEvent, textEvent, planEvent, } from './progress.js';
export function normalizeStoryMode(mode) {
    return mode === 'brief' || mode === 'detailed' ? mode : 'guided';
}
/** Whether `cmd` resolves on PATH (POSIX `command -v`). */
export function onPath(cmd) {
    return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}
/** Which agent CLIs are installed, in preference order. */
export function availableAgents() {
    const agents = [];
    if (onPath('claude'))
        agents.push('claude');
    if (onPath(codexTaskBinary()))
        agents.push('codex');
    return agents;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/** Git pathspecs that include selected files and hide generated/oversized files from the agent's own diff. */
function pathspecArgs(includePaths, excludePaths) {
    return [
        ...includePaths.map((p) => shellQuote(p)),
        ...excludePaths.map((p) => shellQuote(`:(exclude)${p}`)),
    ].map((p) => ` ${p}`).join('');
}
function storyScopeJson(scope) {
    return JSON.stringify({
        includedFiles: scope.includedFiles,
        ...(scope.excludedFiles?.length ? { excludedFiles: scope.excludedFiles } : {}),
        ...(scope.reviewerNote?.trim() ? { reviewerNote: scope.reviewerNote.trim() } : {}),
    });
}
function storyStructureContract(manifest) {
    const arc = `Story structure contract:\n` +
        `- Add top-level "storyArc" with exactly "changeType", "shape", and "readingPath".\n` +
        `- "changeType" is feature|bug-fix|refactor|security|performance|migration|maintenance|mixed.\n` +
        `- "shape" is cause-effect|entry-implementation|before-after|core-supporting|rule-instances.\n` +
        `- "readingPath" is plain text, at most 200 characters, with useful stages separated by ASCII " -> ". It must describe the actual step order.\n`;
    if (!manifest?.eligible) {
        return `${arc}- Do not add "evolution". This review has no eligible fixed first-parent history.\n\n`;
    }
    const commits = manifest.commits.map((commit, index) => ({
        order: index + 1,
        sha: commit.sha,
        subject: commit.subject,
        parents: commit.parentCount,
        added: commit.added,
        removed: commit.removed,
        files: commit.files,
        ...(commit.omittedFiles ? { omittedFiles: commit.omittedFiles } : {}),
    }));
    return (`${arc}` +
        `- Add top-level "evolution" with "phases" only. The server owns and adds "baseSha" and "headSha" after you finish.\n` +
        `- Each phase has exactly "title", "summary", "firstCommit", "lastCommit", and optional "relatedSteps".\n` +
        `- Use 1-6 contiguous phases in first-parent order. Commit boundaries may use unique prefixes of at least 7 hex characters.\n` +
        `- Phase prose explains how the implementation developed, but every behavior claim must agree with the final diff. Commit messages are context, not proof.\n` +
        `- Frozen first-parent manifest, in review order:\n${JSON.stringify(commits, null, 2)}\n\n`);
}
/** The story checker bundled with this build's copy of the storyteller skill. */
export const STORY_CHECKER = fileURLToPath(new URL('../skills/diffstory-storyteller/scripts/check-story.mjs', import.meta.url));
/**
 * Tells the agent to verify its own story before finishing. The app's finish
 * gate rejects contract failures but never checks coverage or prose; the
 * checker does both, and the agent can still fix what it finds.
 */
function checkerInstruction() {
    return existsSync(STORY_CHECKER)
        ? `Before you finish, run the checker that ships with the skill, from the repository root: node "${STORY_CHECKER}". ` +
            `Fix every ERROR, fix or justify every WARNING, and rerun until it prints "RESULT: READY".\n\n`
        : '';
}
/** The instruction handed to the agent — triggers the producer skill, pins the exact diff. */
export function storyPrompt(baseRef, headRef, mode = 'guided', excludePaths = [], storyScope, evolutionManifest, storyRefs, options) {
    const storyMode = normalizeStoryMode(mode);
    const includePaths = storyScope?.includedFiles ?? [];
    const pathspecs = pathspecArgs(includePaths, excludePaths);
    const diff = headRef ? `git diff ${baseRef}..${headRef} --${pathspecs}` : `git diff ${baseRef} --${pathspecs}`;
    const authoredBase = storyRefs?.base ?? baseRef;
    const authoredHead = storyRefs?.head ?? headRef;
    const headField = authoredHead ? ` and its "head" field to "${authoredHead}"` : '';
    const storyScopeContract = storyScope
        ? `Story scope contract:\n` +
            `- Only create changed or new-file story steps for these selected files: ${storyScope.includedFiles.join(', ')}.\n` +
            (storyScope.excludedFiles?.length
                ? `- These changed files are intentionally outside this story scope: ${storyScope.excludedFiles.join(', ')}.\n`
                : '') +
            `- Set top-level "storyScope" in ${DATA_DIR}/story.json to exactly this JSON object: ${storyScopeJson(storyScope)}.\n` +
            `- Do not create coverage steps for files outside "storyScope.includedFiles"; the app treats them as intentionally skipped for this story.\n` +
            (storyScope.reviewerNote?.trim()
                ? `- Reviewer guidance: ${storyScope.reviewerNote.trim()}\n` +
                    `- Treat this user-supplied guidance as task evidence when it describes the original request; cite "reviewer guidance" in intent.sources, verify it against the code, and surface any mismatch. Also use it to decide where to slow down.\n`
                : '') +
            `\n`
        : '';
    const scopeContract = excludePaths.length
        ? `Scope contract:\n` +
            `- These files are generated or oversized artifacts (regenerated ABIs, lockfiles, built bundles) and are intentionally excluded from this review: ${excludePaths.join(', ')}.\n` +
            `- Do not read, narrate, or write steps for them. The coverage gate already excludes them, so it will not ask you to cover them — adding them back only bloats the story.\n\n`
        : '';
    // Newcomer guidance is the skill default, so only a familiar reader changes
    // the prompt. The default path stays byte-identical. Kept to a pointer: the
    // prompt ceiling buys correctness, not verbosity, and the rules live in the
    // reference.
    const audienceContract = options?.audience === 'familiar'
        ? `Audience contract: a familiar reader. See references/audience.md: ` +
            `terse landings, primers only for ideas this change introduces.\n\n`
        : '';
    return (`Use the diffstory-storyteller skill to create a diffStory for exactly this change: ${diff}.\n\n` +
        `Write ${DATA_DIR}/story.json, set its "version" field to 4, set its "base" field to "${authoredBase}"${headField}, and set its "mode" field to "${storyMode}". The story is for a human ` +
        `reviewer, not a changelog.\n\n` +
        audienceContract +
        storyStructureContract(evolutionManifest) +
        storyScopeContract +
        scopeContract +
        `The skill owns the craft. Follow its workflow in order — recover the why, reconstruct the app path, storyboard the camera, then write the steps — and honor every contract it defines: ` +
        `coverage, ranges, viewport/highlight camera limits, beats, hotspots, non-goals, truth, and the "${storyMode}" detail level. ` +
        `The app validates the finished story against those contracts and flags violations, so do not improvise a different format or looser limits.\n\n` +
        // The craft lives in the skill, but these exact field names do not survive
        // being read as prose: real runs paraphrased "text" into "body" and "prose",
        // and dropped "order" from every step. Machine-checked names get pinned here,
        // closest to the moment of writing, where they cannot be reworded.
        `Exact field names (never paraphrase):\n` +
        `- Top level: "version", "title", "summary", "base", "mode", "intent", "storyArc", "steps"; "title", "summary", and "storyArc" are required.\n` +
        `- Optional fixed-range history: "evolution" with "phases"; each phase uses "title", "summary", "firstCommit", "lastCommit", and optional "relatedSteps". Never author server-owned "baseSha" or "headSha".\n` +
        `- Every step: "id", "order" (number 1..N), "title", "kind".\n` +
        `- Code steps: "file", "range", "viewport", "highlights", "why", "beats"; optional TOP-LEVEL "ranges" only when "tags" includes "skim", "sweep", or "mechanical".\n` +
        `- Optional moves (max 6): "id", "kind", "before"/"after" {"file","range"}, "label" (tag, max 24), "hidden" {"as":path|destination|consequence, "tag" max 48, "what" max 120}; kinds are moved/extracted/inlined/wrapped/unwrapped/condition-changed/reordered/flow.\n` +
        `- Every beat: "text" (not "body" or "prose") and "highlights"/"oldHighlights". "body" is concept-only.\n` +
        `- Page concept steps: "id", "order", "title", "kind": "concept", "page", "narration"; optional "preparesFor", "tags", "chapter", "network". "page" is a complete HTML document (any HTML, CSS, SVG, canvas, JavaScript; offline unless "network": true opts into CDN libraries). "narration" is plain text with no tags. Add as many as teach the change, anywhere in the path.\n` +
        // The format is validator-enforced, so it is pinned here rather than left to
        // the skill: prose about a format does not survive being read as reliably as
        // a field name does, and a Markdown-shaped story now renders its asterisks
        // literally instead of failing loudly.
        `Prose is restricted HTML, never Markdown ("**bold**" renders as literal asterisks):\n` +
        `- A legacy concept "body" takes block tags: p, h2-h4, ul, ol, li, blockquote, pre, hr, table, caption, thead, tbody, tr, th, td, dl, dt, dd. New concept steps use "page" instead.\n` +
        `- "why", beat "text", "summary", "intent.goal"/"design"/"nonGoals", "hotspots[].reason", move "hidden.what" take INLINE tags only: code, kbd, strong, em, sup, sub, span, br.\n` +
        `- "title", move "label"/"hidden.tag", and "storyScope.reviewerNote" are plain text with no tags.\n` +
        `- Every <table> needs a <caption>; a table without one is rejected. The caption is what the read-aloud voice speaks instead of the table.\n` +
        `- Outside "page": no links, images, SVG, id, or style. Writing about a tag means escaping it: &lt;script&gt;.\n` +
        // The self-check list is what actually gets verified, so it names every
        // required field rather than a sample: a run that checked only order/text/
        // highlights shipped 55 code steps with no "why" at all.
        `Before writing, check EVERY step: every code step has all ten always-required fields ` +
        `"id", "order", "title", "kind", "file", "range", "viewport", "highlights", "why", "beats"; and every beat has "text" plus highlights on one side. ` +
        `One omission invalidates the story.\n\n` +
        // Coverage fails the same way fields did — silently, and only a pass over the
        // finished JSON catches it. One diff hunk often holds several separate
        // clusters of changed lines; runs reliably claimed the cluster they narrated
        // and left the rest of the same hunk uncovered.
        `Coverage pass:\n` +
        `- Re-read every changed (+/-) line, including separate clusters inside one hunk.\n` +
        `- A changed/new-file step claims TOP-LEVEL "ranges" when present, otherwise "range". Legacy "focus.ranges" only points at code; it never claims coverage.\n` +
        `- Only on a "skim"/"sweep"/"mechanical" step for one repeated sweep in one file: narrate one representative "range"; put it and every other full changed span in "ranges". Other entries may be outside "viewport". "range" must be contained in one entry, never a bounding box across gaps.\n` +
        `- Anything outside all claims is unexplained.\n\n` +
        // A run named "DESIGN_MEMORY" in its goal while sources listed only the
        // commit, leaving the reviewer's one verifiable claim unverifiable.
        `Finally, check "intent": every document, ticket, or discussion you name in "goal" or "design" must also appear in "sources". ` +
        `An uncited claim reads as invented; if you cannot cite it, do not name it.\n\n` +
        // Same lesson as the field names: numeric limits the validator enforces do
        // not survive being read as prose deep inside the skill. The app rejects the
        // story on any of these, so they are pinned here rather than described there.
        `Hard limits the app enforces — a story violating any of these is rejected:\n` +
        `- Each claimed span covers its FULL changed cluster. "range" is framed and inside "viewport"; other "ranges" entries need not be.\n` +
        `- Each beat highlight: at most 12 lines, ideally 1-8. A wide "range" does NOT permit a wide highlight.\n` +
        `- One beat's highlights stay local: at most 10 lines apart.\n` +
        `- "viewport": at most ${storyMode === 'detailed' ? '60' : '40'} lines in ${storyMode} mode; only a changed/new-file step with a larger "range" may use its length plus at most 12 context lines.\n` +
        `- At most ${storyMode === 'detailed' ? '5' : '3'} beats per step in ${storyMode} mode; split the step instead of adding more.\n` +
        `- Top-level "highlights" must equal the union of that step's NEW-side beat highlights.\n` +
        `- Beat text must not open by naming line numbers ("Line 742 ...") and must not narrate a value transition ("650 -> 600"). The diff already shows both; say why they matter instead.\n` +
        // Heard aloud, a step that opens on the change makes the listener replay.
        `- A step's FIRST beat lands the listener: name the function/rule, who reaches it and when, then the change. Never open on the change.\n\n` +
        checkerInstruction() +
        `Live progress notes (streamed to the reviewer while you work):\n` +
        `- Announce each phase as you enter it by printing its marker alone on its own line, exactly: ">> Recovering the why", then ">> Reconstructing the app path", then ">> Storyboarding the camera", then ">> Writing the steps".\n` +
        `- Print every phase note as its own line starting with ">> " — for example ">> Goal: enable keepers to cap the fee" or ">> Arc: the cap is stored, then enforced, then tested".\n` +
        `- Keep each note to one short, concrete sentence. These lines are shown live in the review UI, so no filler and no markdown.\n\n` +
        `Do not ask questions. Generate it directly.`);
}
const WORKTREE_LIST_CAP = 40;
/**
 * The instruction for a code story: the same skill and reader, but no diff.
 * It shares the storyteller's field names and limits with `storyPrompt` by
 * restating them, deliberately, so the diff prompt's bytes never move when
 * this one is tuned.
 */
export function codeStoryPrompt(input) {
    const storyMode = normalizeStoryMode(input.mode);
    const commit = input.commit;
    const named = input.ref?.trim() && input.ref.trim() !== commit ? ` (${input.ref.trim()})` : '';
    const question = input.question?.trim();
    const paths = (input.paths ?? []).map((path) => path.trim()).filter(Boolean);
    const ask = question
        ? `The reader asked: "${question}"\nAnswer that question with the walkthrough: the parts it needs, in the order they run, and nothing the answer does not need.\n\n`
        : `The reader did not ask a specific question. Write a guided tour of this codebase: what it is for, its main parts and how they connect, then one representative path through them.\n\n`;
    const focus = paths.length
        ? `Start from these paths, and leave them only when the explanation needs a caller, a type, a config, or a test that lives elsewhere: ${paths.join(', ')}.\n\n`
        : '';
    const differs = input.worktreeDiffers;
    const shown = differs.slice(0, WORKTREE_LIST_CAP);
    const worktree = differs.length
        ? `The working tree differs from this commit in ${differs.length} ${differs.length === 1 ? 'file' : 'files'}. ` +
            `The app shows the story at the commit, so read ${differs.length === 1 ? 'it' : 'them'} from git, never from disk, or every line number drifts: ` +
            shown.map((path) => `git show ${commit}:${path}`).join(', ') +
            (differs.length > shown.length
                ? `, and ${differs.length - shown.length} more (git diff --name-only ${commit} lists them all)`
                : '') +
            `.\n\n`
        : `The working tree matches this commit for tracked files, so read files from disk as usual.\n\n`;
    const audienceContract = input.audience === 'familiar'
        ? `Audience contract: a familiar reader. See references/audience.md: ` +
            `terse landings, primers only for ideas this code introduces that such a reader would not know.\n\n`
        : '';
    const viewportCap = storyMode === 'detailed' ? '60' : '40';
    const beatCap = storyMode === 'detailed' ? '5' : '3';
    const checker = existsSync(STORY_CHECKER)
        ? `Before you finish, run the checker that ships with the skill, from the repository root: node "${STORY_CHECKER}" "${input.storyFile}". ` +
            `Fix every ERROR, fix or justify every WARNING, and rerun until it prints "RESULT: READY".\n\n`
        : '';
    return (`Use the diffstory-storyteller skill to write a code story: a guided walkthrough that explains existing code. ` +
        `There is no diff. The story explains the code at commit ${commit}${named}, and the reader is learning it, not reviewing a change.\n\n` +
        ask +
        focus +
        worktree +
        `Write ${input.storyFile}, set its "version" field to 4, set its "subject" field to "code", set its "head" field to "${commit}", ` +
        `and set its "mode" field to "${storyMode}". Do not write "base", "storyScope", "evolution", or "codeScope"; the app owns them. Write no other story file.\n\n` +
        audienceContract +
        `Code story contract:\n` +
        `- Every code step is "kind": "context": unchanged code at this commit. Never "changed" or "new-file", and never "oldHighlights".\n` +
        `- Add top-level "storyArc" with exactly "shape" and "readingPath", and no "changeType".\n` +
        `- "shape" is entry-implementation|lifecycle|data-flow|map-then-path|core-supporting|rule-instances|cause-effect.\n` +
        `- "readingPath" is plain text, at most 200 characters, with stages separated by ASCII " -> ". It must describe the actual step order.\n` +
        `- "intent.goal" says what the reader will understand by the end. "intent.design" gives the short answer: the path this story walks and what it shows. ` +
        `"intent.sources" names what you read to answer ("code-derived", a README, a doc). "intent.nonGoals" lists what the story deliberately leaves out.\n` +
        `- "hotspots" (at most 3) mark where the code is subtle or your explanation is least certain, each anchored to a code step.\n\n` +
        `The skill owns the craft. Follow its code-story workflow in references/code-stories.md in order — frame the question, map the code, design the reading path, storyboard the camera, then write the steps — ` +
        `and honor every contract it defines: ranges, viewport/highlight camera limits, beats, landings, hotspots, truth, and the "${storyMode}" detail level. ` +
        `The app validates the finished story against those contracts, so do not improvise a different format or looser limits.\n\n` +
        `Exact field names (never paraphrase):\n` +
        `- Top level: "version", "subject", "head", "mode", "title", "summary", "intent", "storyArc", "steps"; every one is required.\n` +
        `- Every step: "id", "order" (number 1..N), "title", "kind".\n` +
        `- Code steps: "file", "range", "viewport", "highlights", "why", "beats", and "landing" {"symbol", "calledBy" (1-3 names) or "role" {"who", "gate"}, "when"}.\n` +
        `- Every beat: "text" (not "body" or "prose") and "highlights". "body" is concept-only.\n` +
        `- Page concept steps: "id", "order", "title", "kind": "concept", "page", "narration"; optional "preparesFor", "tags", "chapter", "network". ` +
        `"page" is a complete HTML document (any HTML, CSS, SVG, canvas, JavaScript; offline unless "network": true opts into CDN libraries). ` +
        `"narration" is plain text with no tags. Use pages for the maps, lifecycles, and models the code needs, anywhere in the path.\n` +
        `Prose is restricted HTML, never Markdown ("**bold**" renders as literal asterisks):\n` +
        `- "why", beat "text", "summary", "intent.goal"/"design"/"nonGoals", and "hotspots[].reason" take INLINE tags only: code, kbd, strong, em, sup, sub, span, br.\n` +
        `- Every "title" is plain text with no tags.\n` +
        `- Outside "page": no links, images, SVG, id, or style. Writing about a tag means escaping it: &lt;script&gt;.\n` +
        `Before writing, check EVERY step: every code step has all ten always-required fields ` +
        `"id", "order", "title", "kind", "file", "range", "viewport", "highlights", "why", "beats"; and every beat has "text" plus "highlights". ` +
        `One omission invalidates the story.\n\n` +
        `Hard limits the app enforces — a story violating any of these is rejected:\n` +
        `- "range" is the tight anchor of what the step explains, inside "viewport". Every line number is a line at ${commit.slice(0, 7)}.\n` +
        `- Each beat highlight: at most 12 lines, ideally 1-8.\n` +
        `- One beat's highlights stay local: at most 10 lines apart.\n` +
        `- "viewport": at most ${viewportCap} lines in ${storyMode} mode.\n` +
        `- At most ${beatCap} beats per step in ${storyMode} mode; split the step instead of adding more.\n` +
        `- Top-level "highlights" must equal the union of that step's beat highlights.\n` +
        `- Beat text must not open by naming line numbers ("Line 742 ..."); the highlight already points there. Say what the lines do and why it matters.\n` +
        `- A step's FIRST beat lands the listener: name the function or rule, the file whenever the camera changed files, who reaches it and when. Only then explain it.\n\n` +
        checker +
        `Live progress notes (streamed to the reader while you work):\n` +
        `- Announce each phase as you enter it by printing its marker alone on its own line, exactly: ">> Framing the question", then ">> Mapping the code", then ">> Designing the reading path", then ">> Writing the steps".\n` +
        `- Print every phase note as its own line starting with ">> " — for example ">> Entry: openPosition() is where PartyB accepts a quote" or ">> Arc: request -> lock -> open -> settle".\n` +
        `- Keep each note to one short, concrete sentence. These lines are shown live in the app, so no filler and no markdown.\n\n` +
        `Do not ask questions. Write it directly.`);
}
/** A narrow story edit: preserve the good walkthrough and repair only one weak stop. */
export function storyRepairPrompt(input) {
    if (input.codeCommit)
        return codeStoryRepairPrompt({ ...input, codeCommit: input.codeCommit });
    const target = input.stepId
        ? `story step "${input.stepId}"${input.file ? ` in ${input.file}` : ''}`
        : input.file
            ? `${input.file}${input.line ? ` around line ${input.line}` : ''}`
            : 'the selected story area';
    const instruction = input.action === 'explain'
        ? `Add or repair the smallest story step needed to explain the uncovered change at ${target}.`
        : input.action === 'rewrite'
            ? `Rewrite ${target} around sharper beat narration and the same exact code evidence.`
            : input.action === 'shorten'
                ? `Rewrite ${target} to be shorter and sharper without dropping its review risk or causal link.`
                : `Split ${target} into two or more locally focused steps so no step jumps between distant code islands.`;
    const diff = input.head ? `${input.base}..${input.head}` : `${input.base}..working tree`;
    return (`Use the diffstory-storyteller skill to make one targeted repair to ${DATA_DIR}/story.json for ${diff}.\n\n` +
        `${instruction}\n\n` +
        `Preservation contract:\n` +
        `- Read the existing story and the real diff before editing. Preserve every unaffected step, the recovered intent, story scope, tone, and useful beat/highlight detail.\n` +
        `- Preserve every unaffected concept step exactly, including its page, narration, body, preparesFor links, diagram, tags, chapter, and position. Concept steps do not claim coverage.\n` +
        (input.hasStoryArc
            ? `- Preserve "storyArc" exactly. A targeted repair must not change its change type, shape, or reading path.\n`
            : `- Do not add "storyArc" to this older story during a targeted repair.\n`) +
        (input.hasEvolution
            ? `- Preserve "evolution.baseSha", "evolution.headSha", and every phase title, summary, firstCommit, and lastCommit exactly. Only "relatedSteps" may change when replaced or split step ids require it.\n`
            : `- Do not add "evolution" to this story during a targeted repair.\n`) +
        `- Preserve legacy version 1 or 2 when the repair does not add semantic moves. Upgrade to version 2 when a v1 repair introduces a concept primer and to version 3 whenever the repair adds moves or pairedView. Upgrade to version 4 whenever the repair adds a page concept. Preserve version 3 or 4 once present.\n` +
        `- Do not regenerate the walkthrough from scratch and do not reorder unrelated steps.\n` +
        `- Keep the story causal and review-oriented, in the voice of the steps around the repair.\n` +
        `- A step's FIRST beat lands the listener: name the function/rule, who reaches it and when, then the change. Never open on the change.\n` +
        // Same reason the generation prompt pins it: the repair path is a second
        // authoring entry point, and a repair written in Markdown renders literally.
        `- Prose is restricted HTML, never Markdown. A concept "page" is free HTML; a legacy concept "body" takes block tags; "why", beat "text", "summary", "intent", and "hotspots[].reason" take inline tags only (code, kbd, strong, em, sup, sub, span, br); every "title" is plain text. Every <table> needs a <caption>. Outside "page": no links, images, SVG, id, or style.\n` +
        `- Renumber order fields and repair calls/returnsTo/preparesFor only where the targeted edit requires it.\n` +
        `- Validate every chapter, range, viewport, highlight, beat, concept page/narration/body, preparesFor target, id, and full-diff coverage before finishing.\n` +
        `- Write the repaired JSON back to ${DATA_DIR}/story.json. Do not ask questions.\n\n` +
        checkerInstruction());
}
/**
 * A targeted repair to a code story: the same preservation discipline as a diff
 * repair, but against code at one commit, with no coverage to keep and the
 * story's own file as the write target.
 */
function codeStoryRepairPrompt(input) {
    const storyFile = input.storyFile ?? `${DATA_DIR}/stories/code-story.json`;
    const short = input.codeCommit.slice(0, 7);
    const target = input.stepId
        ? `story step "${input.stepId}"${input.file ? ` in ${input.file}` : ''}`
        : input.file
            ? `${input.file}${input.line ? ` around line ${input.line}` : ''}`
            : 'the selected story area';
    const instruction = input.action === 'shorten'
        ? `Rewrite ${target} to be shorter and sharper without dropping what it teaches or its link to the next stop.`
        : input.action === 'split'
            ? `Split ${target} into two or more locally focused steps so no step jumps between distant code islands.`
            : `Rewrite ${target} around sharper beat narration and the same code evidence.`;
    const checker = existsSync(STORY_CHECKER)
        ? `Before you finish, run the checker that ships with the skill, from the repository root: node "${STORY_CHECKER}" "${storyFile}". ` +
            `Fix every ERROR, fix or justify every WARNING, and rerun until it prints "RESULT: READY".\n\n`
        : '';
    return (`Use the diffstory-storyteller skill to make one targeted repair to the code story ${storyFile}, which explains the code at commit ${input.codeCommit}. There is no diff.\n\n` +
        `${instruction}\n\n` +
        `Preservation contract:\n` +
        `- Read the existing story and the code it shows at ${short} before editing; when the working tree differs, read files with git show ${input.codeCommit}:<path>. ` +
        `Preserve every unaffected step, the intent, tone, and useful beat/highlight detail.\n` +
        `- Preserve "subject", "head", "base", and "codeScope" exactly; the app owns them.\n` +
        `- Preserve every unaffected concept step exactly, including its page, narration, body, preparesFor links, diagram, tags, chapter, and position.\n` +
        (input.hasStoryArc
            ? `- Preserve "storyArc" exactly. A targeted repair must not change its shape or reading path.\n`
            : `- Do not add "storyArc" during a targeted repair.\n`) +
        `- Every code step stays "kind": "context". Never "changed" or "new-file", and never "oldHighlights".\n` +
        `- Do not regenerate the walkthrough from scratch and do not reorder unrelated steps.\n` +
        `- Keep the story explanatory, in the voice of the steps around the repair.\n` +
        `- A step's FIRST beat lands the listener: name the function/rule, who reaches it and when, then explain it.\n` +
        `- Prose is restricted HTML, never Markdown. A concept "page" is free HTML; "why", beat "text", "summary", "intent", and "hotspots[].reason" take inline tags only (code, kbd, strong, em, sup, sub, span, br); every "title" is plain text. Outside "page": no links, images, SVG, id, or style.\n` +
        `- Renumber order fields and repair calls/returnsTo/preparesFor only where the targeted edit requires it.\n` +
        `- Validate every chapter, range, viewport, highlight, beat, concept page/narration/body, preparesFor target, and id before finishing. Every line number is a line at ${short}.\n` +
        `- Write the repaired JSON back to ${storyFile}. Do not ask questions.\n\n` +
        checker);
}
/** Broadly-available default so a plan-gated default model (e.g. Fable) can't break `story`. */
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export function normalizeCodexRunOptions(input) {
    const sandbox = ['full-auto', 'workspace-write', 'read-only', 'danger-full-access'].includes(input.codexSandbox)
        ? input.codexSandbox
        : 'full-auto';
    const provider = ['default', 'lmstudio', 'ollama'].includes(input.codexProvider)
        ? input.codexProvider
        : 'default';
    const profile = typeof input.codexProfile === 'string' && input.codexProfile.trim() ? input.codexProfile.trim() : undefined;
    const rawConfig = Array.isArray(input.codexConfig)
        ? input.codexConfig
        : typeof input.codexConfig === 'string'
            ? input.codexConfig.split('\n')
            : [];
    const config = rawConfig
        .map((line) => String(line).trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .slice(0, 20);
    return { sandbox, provider, profile, config };
}
function codexArgs(prompt, model, opts = {}) {
    const args = ['exec'];
    const sandbox = opts.sandbox ?? 'full-auto';
    if (sandbox === 'full-auto')
        args.push('--full-auto');
    else if (sandbox === 'danger-full-access')
        args.push('--dangerously-bypass-approvals-and-sandbox');
    else
        args.push('--sandbox', sandbox);
    if (opts.provider === 'lmstudio' || opts.provider === 'ollama')
        args.push('--oss', '--local-provider', opts.provider);
    if (opts.profile)
        args.push('--profile', opts.profile);
    for (const cfg of opts.config ?? [])
        args.push('-c', cfg);
    if (model)
        args.push('--model', model);
    args.push(prompt);
    return args;
}
/** The headless command + args for an agent. Flags verified against each CLI's --help. */
export function agentCommand(agent, prompt, model, options = {}) {
    if (agent === 'claude') {
        return ['claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--model', model ?? DEFAULT_CLAUDE_MODEL]];
    }
    // Discovery and execution must use the same runtime. On macOS the Desktop
    // app can bundle a newer Codex than the one on PATH; detecting the former
    // and launching the latter makes valid Desktop models fail at run time.
    return [options.codex?.binary ?? codexTaskBinary(), codexArgs(prompt, model, options.codex)];
}
/**
 * Run the agent in `repo`, capturing its (often noisy) output instead of dumping
 * it to the terminal. stdin is closed so an unexpected prompt can't hang us.
 * Returns the exit-ok flag and the captured output (shown only on failure).
 */
export function runAgent(agent, repo, prompt, model, options = {}) {
    const [cmd, args] = agentCommand(agent, prompt, model, options);
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const cap = (b) => {
            output += b.toString();
            if (output.length > 200_000)
                output = output.slice(-200_000); // cap memory
        };
        child.stdout?.on('data', cap);
        child.stderr?.on('data', cap);
        child.on('error', (e) => resolve({ ok: false, output: `${output}\n${String(e)}` }));
        child.on('close', (code) => resolve({ ok: code === 0, output }));
    });
}
// ---- live story-generation progress ----
/** The streaming command + args for an agent. Flags verified against each CLI's --help. */
export function streamCommand(agent, prompt, model, options = {}) {
    if (agent === 'claude') {
        return [
            'claude',
            ['-p', prompt, '--output-format', 'stream-json', '--verbose',
                '--permission-mode', 'acceptEdits', '--model', model ?? DEFAULT_CLAUDE_MODEL],
        ];
    }
    return [options.codex?.binary ?? codexTaskBinary(), codexArgs(prompt, model, options.codex)];
}
/** A readable one-line summary of a tool call for the activity feed. */
export function toolSummary(name, input) {
    if (name === 'Bash') {
        const cmd = String(input?.command ?? '').replace(/\s+/g, ' ').trim();
        return cmd ? `$ ${cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd}` : '$ …';
    }
    const target = input?.file_path ?? input?.path ?? input?.pattern ?? '';
    return target ? `${name} ${target}` : name;
}
/** Normalize a TodoWrite `todos` array into the agent's plan checklist. */
export function planItems(todos) {
    if (!Array.isArray(todos))
        return [];
    return todos
        .map((t) => {
        const status = t?.status === 'in_progress' ? 'active' : t?.status === 'completed' ? 'done' : 'pending';
        const raw = status === 'active' ? (t?.activeForm ?? t?.content) : t?.content;
        return { text: String(raw ?? '').trim(), status };
    })
        .filter((i) => i.text);
}
/** Normalize one agent tool call into the most specific progress event. */
export function classifyTool(name, input) {
    const file = input?.file_path ?? input?.path;
    switch (name) {
        case 'Read':
            return file ? fileEvent('read', name, String(file)) : toolEvent(name, name);
        case 'Write':
            return file ? fileEvent('write', name, String(file)) : toolEvent(name, name);
        case 'Edit':
        case 'MultiEdit':
        case 'NotebookEdit':
            return file ? fileEvent('edit', name, String(file)) : toolEvent(name, name);
        case 'Bash':
            return commandEvent(String(input?.command ?? ''));
        case 'Grep':
        case 'Glob':
            return activityEvent('search', toolSummary(name, input));
        case 'TodoWrite':
            return planEvent(planItems(input?.todos));
        case 'WebFetch':
        case 'WebSearch':
            return activityEvent('web', toolSummary(name, input));
        case 'Task':
            return activityEvent('task', 'Running a subtask');
        default:
            return toolEvent(toolSummary(name, input), name, file ? String(file) : undefined);
    }
}
/** Parse one line of Claude's stream-json into normalized events (non-JSON → none). */
export function parseClaudeStreamLine(line) {
    const s = line.trim();
    if (!s)
        return [];
    let obj;
    try {
        obj = JSON.parse(s);
    }
    catch {
        return [];
    }
    if (obj?.type !== 'assistant' || !Array.isArray(obj.message?.content))
        return [];
    const out = [];
    for (const block of obj.message.content) {
        if (block?.type === 'text' && block.text)
            out.push(textEvent(block.text));
        else if (block?.type === 'tool_use')
            out.push(classifyTool(block.name, block.input));
    }
    return out;
}
/** Extract a useful message from one Codex CLI error line, including `ERROR: {json}`. */
export function codexErrorMessage(line) {
    const raw = line.trim();
    if (!raw)
        return undefined;
    const prefixed = /^ERROR:\s*/i.test(raw);
    const candidate = prefixed ? raw.replace(/^ERROR:\s*/i, '') : raw;
    try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== 'object')
            return undefined;
        const nested = parsed.error;
        const message = (nested && typeof nested === 'object' && typeof nested.message === 'string' && nested.message) ||
            (typeof nested === 'string' && nested) ||
            (typeof parsed.message === 'string' && parsed.message);
        return message ? String(message).trim() : undefined;
    }
    catch {
        return prefixed && candidate.trim() ? candidate.trim() : undefined;
    }
}
function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
        const clean = value.trim();
        if (!clean || seen.has(clean))
            return false;
        seen.add(clean);
        return true;
    });
}
function compactFailureText(value, max = 420) {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
/** Turn noisy stdout/stderr into one actionable failure plus deduplicated diagnostics. */
export function summarizeAgentFailure(output, failure = 'execution') {
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const messages = unique(lines.map(codexErrorMessage).filter((message) => !!message));
    const upgradeMessage = messages.find((message) => /\bmodel requires a newer version of Codex\b/i.test(message));
    if (upgradeMessage) {
        const model = /The ['"]([^'"]+)['"] model requires a newer version of Codex/i.exec(upgradeMessage)?.[1];
        return {
            label: model ? `Codex needs an update for ${model}` : 'Codex needs an update for this model',
            detail: 'The Codex runtime diffStory started cannot use this model. Update Codex, or choose another model and try again.',
            technicalDetail: upgradeMessage,
        };
    }
    const diagnosticLines = messages.length ? messages : unique(lines).slice(-12);
    const lastMessage = diagnosticLines.at(-1);
    return {
        label: failure === 'startup' ? 'The agent could not start' : 'The agent stopped before finishing',
        detail: lastMessage
            ? compactFailureText(lastMessage)
            : failure === 'startup'
                ? 'Check that the selected agent is installed, then try again.'
                : 'Try again. If it fails again, open the technical details below.',
        technicalDetail: diagnosticLines.join('\n'),
    };
}
/** Codex exec streams human-readable text or JSONL when a reusable task is requested. */
export function parseCodexStreamLine(line) {
    const s = line.replace(/\s+$/, '');
    if (!s.trim())
        return [];
    // Terminal JSON errors are summarized once after the process exits. Sending
    // them as live text too produces the duplicated raw wall the user saw.
    if (codexErrorMessage(s))
        return [];
    try {
        const event = JSON.parse(s);
        const item = event?.item;
        if (event?.type !== 'item.completed' || !item)
            return [];
        if (item.type === 'agent_message' && item.text)
            return [textEvent(String(item.text))];
        if (item.type === 'command_execution' && item.command)
            return [commandEvent(String(item.command))];
        if (item.type === 'web_search')
            return [activityEvent('web', String(item.query ?? 'Searching the web'))];
        if (item.type === 'mcp_tool_call')
            return [toolEvent(String(item.tool ?? item.name ?? 'MCP tool'), 'MCP')];
        if (item.type === 'file_change')
            return [activityEvent('other', 'Updating files')];
        return [];
    }
    catch {
        // Human-readable Codex output follows the legacy path below.
    }
    const m = s.match(/^\s*\$\s+(.+)$/);
    if (m)
        return [commandEvent(m[1])];
    return [textEvent(s)];
}
function lineParser(agent) {
    return agent === 'claude' ? parseClaudeStreamLine : parseCodexStreamLine;
}
/**
 * Spawn the agent and stream normalized events as output arrives, calling `onEvent`
 * per parsed event. Resolves with ok/output and a `failure` discriminator the server
 * uses to stage errors. The spawn itself is integration-only — parsers are unit-tested.
 */
export function streamAgent(agent, repo, prompt, onEvent, model, signal, options = {}) {
    const [cmd, args] = streamCommand(agent, prompt, model, options);
    const parse = lineParser(agent);
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], signal });
        let output = '';
        let buf = '';
        const feed = (b) => {
            const text = b.toString();
            output += text;
            if (output.length > 200_000)
                output = output.slice(-200_000); // cap memory
            buf += text;
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const ln of lines)
                for (const e of parse(ln))
                    onEvent(e);
        };
        child.stdout?.on('data', feed);
        child.stderr?.on('data', feed);
        child.on('error', (e) => resolve({ ok: false, output: `${output}\n${String(e)}`, failure: 'startup' }));
        child.on('close', (code) => {
            if (buf)
                for (const e of parse(buf))
                    onEvent(e); // flush the last partial line
            resolve(code === 0 ? { ok: true, output } : { ok: false, output, failure: 'execution' });
        });
    });
}
function agentLabel(agent) {
    return agent.charAt(0).toUpperCase() + agent.slice(1);
}
/** Resolve an optional user-selected agent without silently falling back. */
export function selectAvailableAgent(requested, agents, fallback) {
    if (requested === undefined || requested === null || requested === '')
        return { ok: true, agent: fallback };
    if (requested !== 'claude' && requested !== 'codex') {
        return {
            ok: false, status: 400, stage: 'preflight',
            label: 'Selected agent is not available',
            detail: 'Choose an installed agent: Claude, Codex.',
        };
    }
    if (!agents.includes(requested)) {
        const installed = agents.length ? agents.map(agentLabel).join(', ') : 'none';
        return {
            ok: false, status: 400, stage: 'preflight',
            label: 'Selected agent is not available',
            detail: `Pick an installed agent before addressing comments. Installed agents: ${installed}.`,
        };
    }
    return { ok: true, agent: requested };
}
/** Guard a would-be agent run: one-at-a-time, a repo open, an agent installed. */
export function agentPreflight(a) {
    if (a.busy) {
        return {
            ok: false, status: 409, stage: 'preflight',
            label: 'An agent run is already in progress',
            detail: 'Wait for the current run to finish, or stop it, before starting another.',
        };
    }
    if (!a.repo) {
        return {
            ok: false, status: 409, stage: 'preflight',
            label: 'No repository is open',
            detail: 'Pick a repository before starting an agent run.',
        };
    }
    if (a.agents.length === 0) {
        return {
            ok: false, status: 400, stage: 'preflight',
            label: 'No agent CLI found',
            detail: 'Install "claude" or "codex" on your PATH to run the agent.',
        };
    }
    return { ok: true, agent: a.agents[0] };
}
