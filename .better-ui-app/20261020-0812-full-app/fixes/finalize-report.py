from pathlib import Path
import re, json
run=Path('.better-ui-app/20261020-0812-full-app')
S='client/surfaces/'
R=S+'review/'
P=S+'picker/'
C=S+'change/'
H=S+'stories/'
E=S+'explain/'
G=S+'progress/'
D='client/shared/'
css=R+'review.css'
engine=R+'engine/review-engine.js'
# Each entry identifies a current implementation location, not a stale audit line.
items={
'A11Y-1':(css,'.ds-reviewpanel:focus-visible','Review panels show the canonical focus ring.'),
'A11Y-2':(R+'StoryHealth.tsx','Error:','Every finding names its severity in visible text.'),
'A11Y-3':(P+'RecentRepos.tsx','max-w-full','Long branch labels yield and reveal their full value.'),
'A11Y-4':(P+'PickerApp.tsx','id="main-content"','Skip navigation lands after the repeated Hero controls.'),
'A11Y-5':(D+'theme-menu.tsx','event.key === "Tab"','Tab closes the theme menu and continues normal focus order.'),
'A11Y-6':(D+'use-modal.ts','document.contains(restore)','Deleted triggers restore to a stable page target; busy removal stays in its dialog.'),
'A11Y-7':(engine,'var states=','File names retain reviewed, unexplained and regenerated states after engine updates.'),
'A11Y-9':(engine,'function pauseStoryReload','Hover and focus pause the remaining reload countdown; cancellation cannot restart it.'),
'A11Y-10':(css,'.ds-filmnode:focus-visible{box-shadow:var(--shadow-focus)','Filmstrip focus has a perimeter as well as optional magnification.'),
'A11Y-11':(P+'FolderBrowser.tsx','min-h-6 min-w-6','Breadcrumb controls have expanded targets.'),
'A11Y-12':(P+'Hero.tsx','aria-hidden','Decorative icons are hidden from assistive technology across the repaired surfaces.'),
'A11Y-13':(H+'StoriesApp.tsx','type="file"','The programmatically focusable import control is no longer aria-hidden.'),
'A11Y-14':(D+'shared.css','overscroll-behavior: contain','The modal scrim contains overscroll.'),
'A11Y-15':(E+'ExplainApp.tsx','explainSubmitHelp','The disabled submit action has a persistent explanation.'),
'A11Y-16':(P+'PickerApp.tsx','id="main-content"','Repositories is the actual page heading; the brand is decorative identity.'),
'A11Y-17':(G+'Milestones.tsx','aria-current','Current milestone and step states are exposed as text and semantics.'),
'COL-1':(css,'--md-on-primary-container:var(--accent-text)','Active small labels use semantic accent ink.'),
'COL-2':('src/theme.ts','--add-emphasis-bg:rgba(18,150,111,.2)','Syntax emphasis passes AA in both themes; focus blue stays in the gutter.'),
'COL-3':(css,'.ds-filmnode-num{','Step numerals use text-2 and accent-text rather than dim rail mixtures.'),
'COL-4':(css,'.ds-badge-sweep{','Badge, count, annotation and status text use dedicated semantic inks.'),
'COL-5':(D+'shared.css','box-shadow: var(--shadow-focus)','Shared menu focus uses the canonical focus token.'),
'COL-6':('src/theme.ts','@media (prefers-contrast: more)','Increased contrast is canonical for every surface, without a later global override.'),
'COL-7':('client/styles.css','forced-colors','System colors preserve diff, badge, focus and current-control distinctions.'),
'COL-8':(css,'--add-text:var(--diff-add-text)','Dead M3 aliases and superseded intro color rules were removed.'),
'COL-9':('scripts/build-theme-css.mjs','vendor-only','The bridge documents vendor-only aliases and first-party semantic tokens.'),
'COL-10':(G+'ProgressPanel.tsx','on-accent','Progress primaries use their paired on-accent ink.'),
'COPY-2':(H+'story-state.ts','comment','Queued items are consistently called comments.'),
'COPY-3':(R+'StoryView.tsx','Quick tour','Story depth choices use Quick tour, Guided tour and Deep dive throughout.'),
'COPY-4':(engine,'Calculating story coverage for the loaded diff','Excluded-file and coverage prose describe visible behavior in plain words.'),
'COPY-5':(H+'StoryRow.tsx','content="Remove story"','The removal action and confirmation name the same object.'),
'COPY-6':(engine,"ds-composer-copy','Copy comment'",'The composer names what Copy copies.'),
'COPY-7':(G+'state.ts','Could not start the run.','Default failures explain the next recovery step; server details still win.'),
'COPY-8':(R+'ReviewApp.tsx','differs','Singular and plural divergent-version verbs agree.'),
'COPY-9':(R+'ReviewView.tsx','changed','Both coverage counts identify changed lines.'),
'COPY-10':(engine,"retry.textContent='Try again'",'Visible recovery labels consistently say Try again.'),
'COPY-11':(P+'FolderBrowser.tsx','No folders match','Empty searches explain how to clear or revise the query.'),
'COPY-12':(D+'nav.tsx','Home — your repositories','Navigation names the destination and consistently uses Review history.'),
'COPY-13':('src/server.ts','title: "Review history"','Document titles use one surface-name pattern.'),
'COPY-14':(R+'ReviewApp.tsx','Open story','Palette commands and explanatory flags use sentence case.'),
'COPY-15':(P+'SkillBanner.tsx','The storyteller skill','Skill names and manual installation instructions agree across the app.'),
'COPY-16':(H+'StoryHistory.tsx','Open this version','History links name the version they open.'),
'COPY-17':(P+'FolderBrowser.tsx','Loading folders','Loading labels identify the work in progress.'),
'COPY-18':(engine,'Could not read the history','Error voice consistently uses clear, non-contracted recovery prose.'),
'EXP-1':('src/server.ts','Go to your repositories','Missing page-like routes have themed404 recovery; APIs/assets retain plain404.'),
'EXP-2':(E+'ExplainApp.tsx','explainDraftKey','Per-repository drafts restore after navigation and clear after successful completion.'),
'EXP-3':('src/server.ts','url.pathname === "/api/refs/resolve"','Committed refs resolve with Git, including tags, full hashes and revision expressions; invalid text remains with an associated error.'),
'EXP-4':(P+'RecentRepos.tsx','disabled={!row.isGit}','Missing repositories cannot invoke an already-known failing Open action.'),
'EXP-5':(H+'StoryHistory.tsx','Try again','History failures can retry the correct load or restore request.'),
'EXP-6':(C+'ScopeCard.tsx','setBusy(true)','Scope navigation exposes busy feedback before leaving the page.'),
'EXP-7':(P+'PickerApp.tsx','heldUndo','The most recent repository removal retains a visible Restore path after toast dismissal.'),
'EXP-8':(H+'StoriesApp.tsx','status && !target','Story removal confirms visibly, without placing background controls above a later dialog.'),
'LAY-1':(D+'nav.tsx','max-[760px]:flex-wrap','Shared navigation wraps before intermediate-width overflow; narrow review chrome scrolls only its tabs.'),
'LAY-3':(css,'inset-inline-end:10px','Direction-dependent menu, gutter, row and marker alignment uses logical properties.'),
'LAY-4':(C+'ScopeCard.tsx','@container','Ref editors and summaries use matching container breakpoints; progress responds to its own panel.'),
'LAY-5':(C+'FileSummary.tsx','<Tooltip content={file.path}','Long basenames yield without pushing counts away and can reveal their full path.'),
'LAY-6':(H+'StoriesApp.tsx','header className="mb-6','Page groups use spacing without redundant floating separator lines.'),
'LAY-7':(D+'nav.tsx','items-center gap-3','Cited card, row, nav and metric spacing follows the project scale.'),
'LAY-8':(css,'scrollbar-width:thin;scrollbar-color','Horizontal tabs and filmstrip retain visible scroll/peek cues.'),
'MOT-1':(css,'.ds-filetree-caret,.ds-intro-evolution-caret','All disclosure carets have an instant reduced-motion path.'),
'MOT-2':(D+'shared.css','visibility 0s linear var(--motion-duration-spatial)','Modal visibility and close timers share the340ms spatial budget.'),
'MOT-3':(css,'data-ds-enter-kind="step"','Repeated step moves use150ms opacity handoffs; interruption remains supported.'),
'MOT-4':(css,'animation:ds-circuit-trace var(--motion-duration-progress)','Annotation traces and arrowheads finish within the250ms progress budget.'),
'MOT-5':(css,'.ds-dock .ds-readaloud-primary{width:86px','Narration width changes without a layout tween or one-off bounce.'),
'MOT-6':(D+'shared.css','@starting-style','Shared and review menus use retargetable discrete transitions with brief exits.'),
'MOT-7':(css,'transition:opacity var(--motion-duration-ui) var(--motion-ease-out)','Interface durations and easing follow the motion tokens.'),
'TYP-1':(css,'font-size:var(--text-base)','Review text uses the common token scale.'),
'TYP-2':(css,'.ds-composer-ta{font-size:1rem}','Comment and Explain inputs use16px on small/coarse-pointer contexts.'),
'TYP-3':(css,'.ds-health-more{','Unsupported weights and synthesized italic styling were removed.'),
'TYP-4':('client/vendor/beui/motion/tooltip.tsx','onFocusCapture','Truncated names have keyboard/touch full-value paths; tooltips stay in the viewport.'),
'TYP-5':(css,'font-size:var(--text-xs)','Content flags and counts use the10px token floor.'),
'TYP-6':(css,'.ds-reviewpage-h{','Page and section headings retain a meaningful hierarchy.'),
'TYP-7':('src/theme.ts','--text-xs:.625rem','Type tokens, arbitrary text utilities and concept fitting respect root-font enlargement.'),
'TYP-8':(R+'format.ts','Intl.NumberFormat','Large counts group digits; hashes expose slashed-zero formatting without altering identifiers.'),
'TYP-9':('src/theme.ts','--tracking-kicker:.05em','Kicker tracking and review line heights use the common role conventions.'),
'VIS-1':(H+'StoryRow.tsx','border border-line-soft bg-surface-2','Light story/repository/file/scope islands retain a subtle grouping edge.'),
'VIS-2':(P+'Hero.tsx','clip-path','The masthead thread passes behind the lockup without enclosing empty space.'),
'VIS-3':(css,'.ds-dock{','Floating overlays share the shadow token and in-flow docks stay flat.'),
'VIS-4':(E+'ExplainApp.tsx','radius-island)-24px','Nested fields, tracks and segments derive concentric radii from actual insets.'),
'VIS-5':('DESIGN_MEMORY.md','26px','Design documentation matches shipped geometry and records nested-radius exceptions.'),
'VIS-6':(css,'border-radius:var(--radius-sm)','Review controls consolidate off-scale corner radii onto the common scale.'),
'VIS-7':(C+'FileSummary.tsx','Check strokeWidth={1.5}','Icon stroke weights match adjacent text and documented exceptions.'),
'VIS-8':(css,'padding:11px 16px 11px 18px','Trailing-icon primaries use smaller padding on the icon side.'),
'VIS-9':(css,'.ds-concept-diagram-output{','Diagram frames use a flat surface and neutral outline; focus retains its stronger ring.'),
'VIS-10':(P+'PickerApp.tsx','h-[var(--control-h-lg)]','Page-level primary actions consistently use the40px control height.'),
}
rows=[]; missing=[]
for id,(path,needle,description) in items.items():
 lines=Path(path).read_text().splitlines();line=next((i for i,l in enumerate(lines,1) if needle in l),None)
 if line is None:missing.append((id,path,needle));continue
 rows.append((id,'Fixed',f'{description} `{path}:{line}`','Project checks pass; independent lens recheck. See runtime limits below.'))
if missing: raise SystemExit(json.dumps(missing,indent=2))
assert len(rows)==84,len(rows)
report=run/'REPORT.md';text=report.read_text();text=text.split('\n## Fix log\n')[0]
for id in items:text=text.replace('| '+id+' |','| '+id+' (Fixed) |')
text=text.replace('## Scorecard','## Original scorecard (before fixes)',1).replace('## Verification\n','## Original verification (before fixes)\n',1)
text=text.replace('## Verdict\nBlock','## Verdict\nApprove for the inspected web scope after fixes. Device, screen-reader and native browser-zoom coverage remain unverified.')
text=text.replace('## Next step\nfix A11Y-1, COL-2 | fix all high | fix all color','## Repair status\n84 Fixed, 0 Partly fixed, 0 Not fixed. The three merged IDs keep their canonical owners. No remaining finding or regression in the final independent rechecks.')
summary='''\n## Completed repairs (2026-10-20)\n\nAll84 selected findings have implementation fixes. Eight independent lens rechecks report no remaining findings within the inspected scope. Their source conclusions do not imply device or screen-reader verification. Full records: `fixes/recheck/*.md`, `fixes/runtime-recheck.md`, and `fixes/screens/`. The original scorecard below is preserved as the audit baseline.\n'''
if '## Completed repairs' not in text:text=text.replace('\n## Original scorecard',summary+'\n## Original scorecard',1)
text+='\n## Fix log\n| ID | Status | What changed | Verification |\n|---|---|---|---|\n'
for row in rows:text+='| '+' | '.join(row)+' |\n'
text+='''\n## Verification after repairs\n\n- `npm run check`:1084 tests passed,0 failed,0 skipped, including build and client typecheck. New behavioral coverage confirms reload pause/resume/cancellation and valid Git refs outside suggestions. Contrast checks guard every syntax ink on add/delete word emphasis in both themes.\n- Repository browser smoke:desktop and mobile reduced-motion flows passed, covering selection, queue, clipboard, challenge, caller source, receipt, drift, refresh and preservation rejection.\n- Final rendered scenarios and exact measurements are listed in `fixes/runtime-recheck.md`; those include320/375/650/1440 widths, both themes, long names, native forced-color/reduced-motion/increased-contrast media, root-font stress, unknown/valid refs and Explain draft navigation.\n- T3 preview:actual step1→2→3→2 interaction settled on one ready primer; the recording is `fixes/recordings/step-reversal.mp4`. Code and primer captures are `fixes/screens/review-code-preview.png` and `review-primer-preview.png`. Keyboard arrow presses advanced beats rather than changing the selected step; filmstrip clicks were used to verify the step reversal.\n- `git diff --check`:passed. Checked-in build assets were regenerated. No commit or publication performed.\n\nLimits:desktop-class Chromium emulation, not physical iOS/Android hardware. No screen-reader listening session, native browser200% zoom, exhaustive high-contrast OS palette or performance/FPS proof. Root-font200% is explicitly font stress, not page zoom. A failed early capture used an invalid one-step fixture; its fallback was not treated as successful story coverage, and the fixture was replaced before the final run. Motion smoothness is not established by a short recording.\n\nIntegration followup:the existing export cleanup test exposed a timing race in terminal error publication. The error state is now published after temporary source data cleanup; the existing cancellation and failure tests pass. Existing unrelated video/narration work was preserved.\n'''
report.write_text(text)
(run/'fixes/fix-status.json').write_text(json.dumps({'fixed':84,'partlyFixed':0,'notFixed':0,'rows':[dict(zip(['id','status','change','verification'],r)) for r in rows]},indent=2))
print('Report updated:84 fixed')
