# Copy findings
Scope inspected: All six surfaces in client code (picker, stories, change, review including Sidebar, StoryView, ReviewView, StoryHealth and engine composer, queue and toast strings, progress, explain), shared chrome (nav, theme menu, editor menu, brand, api fallbacks), the four format.ts helpers and their count call sites, server page titles and the plain text Not found response in src/server.ts, and the runtime captures listed in runtime.md including stories-badrepo, change-empty, picker, stories, review, diff, explain and progress-running.
Not inspected: Server-rendered step panel chrome inside lazy step and file panels (source in the server renderer, outside the client surface files named in the brief; runtime stills show the panels but their label source was not line-read), comment composer and queue interaction states at runtime (listed under Not captured in runtime.md; code was read, pixels were not), progress blocked, failed and stopped states at runtime (only running and complete fixtures were captured), S3 one-step and 42-step rendering, S5 missing-metadata variant and file counts over 100 (not injected per runtime.md), loading spinner state (no capture), translated labels (no i18n catalogue exists, single locale per brief.md), dist build output (excluded per brief.md), vendored beUI default strings except where a surface adopts and re-labels the component.
Score: 2/4, one unresolved HIGH caps the score; the rest of the voice is consistent and specific.

## Findings

### COPY-1: Bad repository route answers with bare Not found and no way forward
- Rule: 10. Errors say what happened and how to fix it
- Severity: HIGH
- Confidence: high
- Locations: `src/server.ts:1480`, `src/server.ts:1481`
- Evidence: The request handler fallthrough ends with `res.statusCode = 404;` and `res.end("Not found");`. The capture screens/stories-badrepo-1440x900-dark.png shows the whole page as the words Not found at the top left on a black field, with no app chrome, no cause and no link. Scenario: error-bad-repo-route in runtime.md.
- Fix: For page-like GET routes that match no repository or screen, return a small branded HTML page in the errorPage idiom at src/server.ts:4521: a sentence-case heading such as Page not found, one line such as That repository or page could not be found, and one action link labelled Go to your repositories pointing at /repos. Keep the bare text response only for asset and API style routes where no person reads it.
- Why: Rule 10 requires an error to say what happened and what to do next. This page says neither, so a mistyped or stale repository link ends in a dead end with no recovery. That blocks the task of opening a repository.
- Verified: yes (screens/stories-badrepo-1440x900-dark.png; code at the cited lines)
- Systemic: no

### COPY-2: One queued item is called both a comment and a note
- Rule: 1. Learn the existing voice first; 2. One voice, flexible tone; 6. One vocabulary per flow
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/stories/story-state.ts:48`, `client/surfaces/stories/StoriesApp.tsx:248`, `client/surfaces/stories/StoryRow.tsx:201`, `client/surfaces/review/engine/review-engine.js:3418`
- Evidence: The badge detail reads `${plural(story.openComments, "open note")} waiting`. The history header counts the same state as `{openNotes === 1 ? "review has" : "reviews have"} open comments`. The row fact reads `queued {story.openComments === 1 ? "comment" : "comments"}`. The queue remove confirmation says the file and line `will lose this queued note`.
- Fix: Pick comment as the one noun, since the composer, the queue, the API and most counts already use it. Change the badge detail to the counted form, for example `2 open comments waiting`, and change the remove confirmation body to `will lose this queued comment`. Keep Note only as the name of the nit comment type in the composer, where it labels a kind, not the queued object.
- Why: Rules 1, 2 and 6 keep one name for one thing through a flow. A reader counting open notes in the badge and open comments in the header has to decide whether two different backlogs exist.
- Verified: no (demo captures show no open comment count; the strings are code-verified at the cited lines)
- Systemic: yes

### COPY-3: The same story depth choice has two different names
- Rule: 1. Learn the existing voice first; 6. One vocabulary per flow
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/StoryView.tsx:432`, `client/surfaces/explain/ExplainApp.tsx:47`
- Evidence: In StoryView.tsx the DEPTHS rows are `["brief", "Compact", ...]`, `["guided", "Guided review", ...]` and `["detailed", "Deep review", ...]`. In ExplainApp.tsx the same StoryMode values are `title: "Quick tour"`, `title: "Guided tour"` and `title: "Deep dive"`. The badges match (Shortest, Recommended, Most detail) while the choice names do not.
- Fix: Use one title set for the three mode values in both generators. Keep the ExplainApp set (Quick tour, Guided tour, Deep dive) or the StoryView set, and apply it in both files, with the same one-line description for each value.
- Why: Rule 6 keeps one set of words for one flow. A person who picked Guided review for a diff story and later meets Guided tour for a code story cannot tell from the words whether it is the same depth.
- Verified: no (the ExplainApp names are visible in screens/explain-1440x900-dark.png; the storyless generator in StoryView was not captured)
- Systemic: yes

### COPY-4: Excluded files are described in system terms: kept lazy and bounded renderer
- Rule: 4. Plain words in the user's vocabulary
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/ReviewView.tsx:68`, `client/surfaces/review/ReviewView.tsx:287`, `client/surfaces/review/Sidebar.tsx:518`, `client/surfaces/review/StoryView.tsx:585`
- Evidence: Titles read `Large file kept lazy` and `${files.length} ${plural(files.length, "file")} kept lazy`. The section heading reads `Outside the bounded renderer`. The sidebar count reads `· ${excludedFiles.length} kept lazy`. The storyless intro reads `Read the bounded diff under All files.`
- Fix: Name the state, not the loading strategy. For example, title `Large file not loaded in this view`, heading `Files left out of this view`, count `· 2 files not loaded`, and intro `Read the diff under All files.` Keep the existing explanation that the page stays fast, which already gives the reason in plain words at ReviewView.tsx:86.
- Why: Rule 4 names things by what users understand, not by how the system is built. Lazy and bounded describe the renderer. A reviewer deciding whether it is safe to finish has to decode implementation words at the exact moment the text asks for a careful check.
- Verified: no (the demo story has no excluded file, so no capture shows these strings; code-verified at the cited lines)
- Systemic: yes

### COPY-5: The remove flow starts as Remove review and confirms as Remove story
- Rule: 2. One voice, flexible tone
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/stories/StoryRow.tsx:281`, `client/surfaces/stories/RemoveStoryDialog.tsx:117`, `client/surfaces/stories/RemoveStoryDialog.tsx:157`
- Evidence: The row control tooltip reads `content="Remove review"`. The dialog it opens is titled `Remove this story?`, its body says the story file is deleted, and its destructive button reads `Remove story`.
- Fix: Change the row tooltip to Remove story so the control, the question and the confirming button use one action name. The aria-label at StoryRow.tsx:297 already names the object, so only the visible tooltip needs to change.
- Why: Rule 2 keeps an action name through the whole flow: the button that starts an action and the confirmation that completes it must use the same words. Here the first label promises one object and the dialog deletes another named object.
- Verified: no (the remove dialog was not captured; code-verified at the cited lines)
- Systemic: no

### COPY-6: Composer Copy button does not name what it copies or that nothing is queued
- Rule: 5. Buttons name the action
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/review/engine/review-engine.js:3397`
- Evidence: The composer footer builds two buttons side by side: `'Add to queue'` and `'Copy'`. The first queues the comment on the server. The second copies the draft text to the clipboard and closes the composer without queueing, as copyDraft at the same location shows.
- Fix: Label the second button Copy comment, matching the toast it already produces (`Comment copied.`) and the Copy all label in the review queue. Keep Add to queue as the paired action so the choice reads queue or copy.
- Why: Rule 5 requires a verb that names the specific action and its object. Copy alone hides the one distinction the footer exists to offer, so a reviewer can copy a comment they meant to queue and lose the queue state they expected.
- Verified: no (the composer requires a code selection flow and was not exercised in this run per runtime.md; code-verified at the cited line)
- Systemic: no

### COPY-7: Progress failure defaults say Cannot start and Try again with no cause or fix
- Rule: 10. Errors say what happened and how to fix it
- Severity: MEDIUM
- Confidence: high
- Locations: `client/surfaces/progress/state.ts:444`, `client/surfaces/progress/state.ts:454`, `client/surfaces/progress/run-progress.ts:44`, `client/surfaces/progress/ProgressPanel.tsx:378`
- Evidence: A blocked run gets `title: "Cannot start"` with default `label: error.label || "Could not start."` and `detail: error.detail ?? "Try again."`. The stream pump falls back to `{ label: "Could not start." }`. The panel error card falls back to `state.error.label || "The run failed"`.
- Fix: Give the no-detail default a cause and a next step in the same calm tone as the good defaults elsewhere in this file, for example label `Could not start the run.` and detail `Check that Claude or Codex is installed, then try again.` Keep server-supplied labels ahead of the default, as the code already does.
- Why: Rule 10 pairs what failed with how to recover. When the server sends no reason, the default text repeats the failure as its own remedy. Trying again is the only instruction, even when the cause is a missing writer that a retry cannot fix.
- Verified: no (progress failed and blocked states were not captured; only running and complete fixtures were, per runtime.md)
- Systemic: no

### COPY-8: Singular divergent count keeps the plural verb differ in the Review tab name
- Rule: 4. Plain words in the user's vocabulary (plural and sentence wording; S5 count edge)
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/review/ReviewApp.tsx:128`
- Evidence: The tab name is built as `` `, ${divergent.length} staged and working-tree ${plural(divergent.length, "version")} differ` ``. The plural helper correctly returns version at a count of one, but the verb stays differ, so a count of one reads `1 staged and working-tree version differ`.
- Fix: Choose the verb with the count at the same call site: `divergent.length === 1 ? "differs" : "differ"`. Apply the same check to any other hand-built verb next to a counted noun.
- Why: Rule 4 and scenario S5 own zero and one counts. The plural helper handles the noun, and this sentence shows why the verb next to it needs the same care. The string is the Review tab accessible name, so it is read as a sentence.
- Verified: no (the demo has no divergent file; the count-one case follows directly from the cited code)
- Systemic: no

### COPY-9: Coverage stats count lines but label them changes
- Rule: 4. Plain words in the user's vocabulary (plural wording)
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/review/ReviewView.tsx:228`, `client/surfaces/review/ReviewView.tsx:232`
- Evidence: The first stat pairs `trust.coveredLines` with `changed {plural(trust.coveredLines, "line")} covered by a step`. The second pairs `trust.uncoveredLines` with `{plural(trust.uncoveredLines, "change")} no step explains`. One number counts lines in both stats, while the nouns differ.
- Fix: Use one unit in the pair. For example, `changed lines covered by a step` and `changed lines no step explains`, keeping the separate uncovered change count for the pill and the tab flag, which already count ranges.
- Why: Rule 4 keeps the counted noun true to the number beside it. Two side-by-side stats that switch units make the uncovered figure read as a different, smaller kind of debt than it is.
- Verified: no (the Coverage tab was not opened in the captures; code-verified at the cited lines)
- Systemic: no

### COPY-10: The same recovery action is called Retry in two surfaces and Try again everywhere else
- Rule: 6. One vocabulary per flow
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/refs.ts:112`, `client/surfaces/review/engine/review-engine.js:194`, `client/surfaces/picker/FolderBrowser.tsx:437`, `client/surfaces/picker/PickerApp.tsx:97`
- Evidence: The failed ref list offers a row labelled `Retry`, and the lazy-load helper builds a button whose text is `Retry`. The folder browser error, the picker status toast, the remove dialog and the progress footer all use `Try again` for the same action.
- Fix: Use Try again for the button and row labels in refs.ts and in reviewLazyAction in the engine. The fuller aria-labels such as `Retry loading the full file` can keep their descriptive form.
- Why: Rule 6 keeps one word for one action. Two recovery verbs for one gesture make readers pause over whether the buttons do different things, for no benefit.
- Verified: no (no failed ref load or lazy load error was captured; code-verified at the cited lines)
- Systemic: yes

### COPY-11: Search and filter empty states name the dead end but not the way out
- Rule: 11. Empty states point forward
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/FolderBrowser.tsx:442`, `client/surfaces/change/RefPicker.tsx:424`
- Evidence: The folder list shows `` `No folders match “${trimmed}”.` `` with no next step in the wording. The ref listbox shows `No matching refs` with neither the query nor a way out.
- Fix: Add the exit to the sentence. For example, `No folders match “{query}”. Clear the filter to see every folder.` and `No refs match “{query}”. Try a branch name, tag, or commit.` The clear control already exists beside the folder field, so the words only need to point at it.
- Why: Rule 11 asks a search empty state to name the query and offer a way out. Both states do half of that job in text, even though the controls nearby can complete it.
- Verified: no (no filtered-to-empty capture was taken; code-verified at the cited lines)
- Systemic: no

### COPY-12: The same destination is History in one bar and Review history everywhere else, and Home hides the destination
- Rule: 7. Links describe their destination; 13. Specific navigation labels
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/ChangeApp.tsx:142`, `client/surfaces/stories/StoriesApp.tsx:132`, `client/shared/nav.tsx:92`
- Evidence: The change page bar links to the stories route with the text `History`. The stories page crumb, its heading and the empty-state action in FileSummary.tsx call the same place `Review history`. The wordmark link carries `aria-label="Home"` while its own title at nav.tsx:91 reads `Home — your repositories`.
- Fix: Use Review history for the text link on the change page, and set the wordmark accessible name to Home — your repositories so it matches its title and names the picker it opens.
- Why: Rules 7 and 13 make a destination predictable before the click and keep one name per place. History is the umbrella word the lens warns against, and Home alone does not say that the link lists repositories.
- Verified: yes (screens/change-1440x900-dark.png shows History; screens/stories-1440x900-dark.png shows Review history for the same route)
- Systemic: no

### COPY-13: Page titles follow two patterns, and two of them run the repo name into the surface name
- Rule: 8. One capitalization policy (one naming pattern per element type)
- Severity: LOW
- Confidence: high
- Locations: `src/server.ts:1503`, `src/server.ts:1554`, `src/server.ts:1733`, `src/server.ts:1790`
- Evidence: Titles are `"Pick a repository"` and `"Choose review scope"` for two surfaces, and `` `${repoName} Review history` `` and `` `${repoName} Explain code` `` for two others. Rendered, that gives `codeStory — codestory-demo-cap Review history` in runtime.md, where the repo name and the surface name run together with no separator.
- Fix: Use the surface name alone for all four, matching the picker and change titles: Review history and Explain code. The repo name is already the first crumb on both pages, so the title loses nothing.
- Why: Rule 8 keeps one policy per element type. Browser titles are one element type, and the mixed pattern makes two tabs read as one long repo name.
- Verified: yes (titles recorded per capture in runtime.md)
- Systemic: no

### COPY-14: Command palette mixes title case and sentence case, and Unexplained is capitalised mid-sentence
- Rule: 8. One capitalization policy
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/review/ReviewApp.tsx:253`, `client/surfaces/review/StoryView.tsx:723`
- Evidence: The command list reads `Open Story`, `Open All files`, `Open Review` beside `Next unreviewed file`, `Toggle current file reviewed` and `Toggle read aloud` in the same list. The generator note reads `gaps are flagged as Unexplained` with a capital U mid-sentence, while the same state is written lowercase as unexplained changes in Sidebar.tsx and StoryHealth.tsx.
- Fix: Sentence case the three command titles (Open story, Open all files, Open review, keeping the tab names themselves unchanged where they appear as tabs), and write `flagged as unexplained` in the generator note.
- Why: Rule 8 and the brand tone in DESIGN_MEMORY.md settle on sentence case. Mixed case inside one list reads as carelessness, and the capitalised state word looks like a proper name the rest of the app never uses.
- Verified: no (the command palette was not opened in the captures; code-verified at the cited lines)
- Systemic: no

### COPY-15: The story skill has two names, and the same update failure gives two different manual fixes
- Rule: 1. Learn the existing voice first; 10. Errors say what happened and how to fix it
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/SkillBanner.tsx:63`, `client/surfaces/picker/SkillBanner.tsx:69`, `client/surfaces/explain/ExplainApp.tsx:239`, `client/surfaces/explain/ExplainApp.tsx:469`
- Evidence: The picker calls it the `Story-generation skill` and, after a failed update, says `Run scripts/install-skills.sh from this repo, or re-run the codeStory installer.` The explain page calls the same thing `the storyteller skill` and, after the same failed update, says `Run scripts/install-skills.sh from a codeStory clone.` with no installer option.
- Fix: Use one skill name in both places, storyteller skill to match the installed skill name codestory-storyteller, and one manual fix sentence in both error strings.
- Why: Rules 1 and 10 keep product terms stable and recovery steps exact. A person who reads the picker warning and later the explain warning meets what looks like a second skill and a second remedy.
- Verified: no (skills were current in the captures, so neither banner state was shown; code-verified at the cited lines)
- Systemic: yes

### COPY-16: Earlier-version rows offer a bare Open link
- Rule: 7. Links describe their destination
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/stories/StoryHistory.tsx:169`
- Evidence: Every expanded history row renders a link whose whole text is `Open`, pointing at the read-only review for that snapshot. The Restore button beside it names its action; the link does not name its destination.
- Fix: Label the link Open this version. The row title above it supplies which version, and the link text then stands on its own in a list of links.
- Why: Rule 7 requires link text to make sense out of context, because screen-reader users navigate by a list of links. A history with ten versions produces ten identical Open links.
- Verified: no (earlier versions were collapsed in the captures; code-verified at the cited line)
- Systemic: no

### COPY-17: Folder browser loading rows show a bare Loading while the spoken status names the work
- Rule: 2. One voice, flexible tone (loading copy says what is loading)
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/picker/FolderBrowser.tsx:259`, `client/surfaces/picker/FolderBrowser.tsx:421`, `client/surfaces/picker/FolderBrowser.tsx:490`
- Evidence: The screen-reader status at line 259 reads `Loading folders…`, while the two visible loading rows at lines 421 and 490 show only `Loading…`. Every other loading string in the app names its object: Loading refs…, Loading this review step…, Loading file review…, Checking available writers….
- Fix: Change both visible rows to Loading folders… so the sighted text matches the announced text the surface already writes.
- Why: Rule 2 asks loading copy to say what is loading. This surface already wrote the right sentence for one audience and a bare one for the other.
- Verified: no (the folder browser was captured in its loaded state only; code-verified at the cited lines)
- Systemic: no

### COPY-18: Error voice splits between Could not and contracted forms
- Rule: 1. Learn the existing voice first
- Severity: LOW
- Confidence: high
- Locations: `client/surfaces/change/refs.ts:111`, `client/surfaces/progress/state.ts:400`, `client/surfaces/review/StoryView.tsx:131`, `client/surfaces/change/ChangeApp.tsx:183`
- Evidence: Most failures use the full form: Could not open that path, Could not remove story, Could not load story history. Four strings contract it: `Couldn't load refs`, the progress title `Couldn't finish`, `Can’t compare with {commit} in this checkout`, and the notice lead `That review couldn’t be loaded.`
- Fix: Write the four in the full form used by the rest of the app: Could not load refs, Could not finish, Cannot compare with {commit} in this checkout, and That review could not be loaded.
- Why: Rule 1 keeps the established voice. The full form is the calm, plain error voice this app uses everywhere else, and the contractions stand out only because the pattern is otherwise uniform.
- Verified: no (none of the four states was captured; code-verified at the cited lines)
- Systemic: yes

## Recommendations
- Promote one plural and one relativeTime helper into client/shared and delete the four per-surface copies in the format.ts files. The strings agree today, but two signatures for one job (one returns the counted phrase, one returns only the noun) is how a future call site ships a wrong count sentence. Purpose: keep S5 counts correct as surfaces grow.
- Add the count-one verb case to the existing render tests: render the Review tab name with one divergent file and one uncovered change and assert the full sentence. Purpose: the noun-only plural tests cannot catch a stale verb.

## Considered but rejected
| Location | Candidate | Rejected because |
|---|---|---|
| `client/surfaces/review/engine/review-engine.js:3371` | Bare Save button in the queued comment editor | The editor sits inside the comment card it edits, so the object is obvious from context, which Rule 5 allows for Save and Cancel. |
| `client/surfaces/stories/RemoveStoryDialog.tsx:157` | Confirmation wording of the story delete | It passes Rule 5 and Rule 10: the question, the body naming the file deletion, and the Remove story button repeat the consequence. The defect is only the tooltip that leads into it (COPY-5). |
| Counts built with template literals across surfaces | Concatenated count sentences that cannot be translated | The project keeps no translation catalogue and ships one locale (brief.md), so full ICU templates have no consumer. The English output was checked at 0, 1 and plural instead; the one real agreement defect is COPY-8. |
| `client/surfaces/picker/format.ts:16` and `client/surfaces/stories/format.ts:10` | Duplicated relativeTime implementations | The two copies are identical today and produce correct just now, min, hr, yesterday and days forms. No user-facing defect; centralising is a Recommendation, not a finding. |
| `client/surfaces/change/ChangeApp.tsx:44` | Decide as the fourth workflow stage | DESIGN_MEMORY.md keeps the Scope, Read, Resolve, Decide workflow as product vocabulary. The word is intentional, not drift. |

## Handoffs
- TYP: Large counts render without locale grouping (no Intl.NumberFormat anywhere in client code), for example the scope ledger at `client/surfaces/change/ChangeApp.tsx:173`. Numeric display and unavailable-value form belong to TYP. S5 large counts were not injected, so no copy claim is made from them.
- TYP: Badge and kicker casing is applied by case transforms and token classes, for example the lowercase badge text working tree clean at `client/surfaces/change/FileSummary.tsx:105` rendering beside uppercase mono badges elsewhere. How case renders belongs to TYP; COPY checked source wording only.
- A11Y: Whether error and status text is announced and associated (live regions, alert roles, describedby wiring) in the picker toast, the remove dialog and the engine toast at `client/surfaces/review/engine/review-engine.js:3803`. COPY owns the words only.
- EXP: Whether an empty or error state exists and offers a next step at all, for example the bare Files empty panels at `client/surfaces/review/ReviewView.tsx:56`. COPY-11 covers wording where a way out already exists.
- LAY: Whether long action labels such as Review history (COPY-12) still fit at 320px and in the compact nav. COPY owns the chosen words; clipping belongs to LAY.
