import { orderedSteps } from './tour.js';
import { isCodeStep } from './types.js';
import { matchGlob } from './noise.js';
import { landingSearchName } from './landing-verify.js';
export function planStoryRefresh(tour, changes) {
    const changed = new Set(changes.filter((change) => change.inStory).flatMap((change) => [change.path, ...(change.oldPath ? [change.oldPath] : [])]));
    const steps = orderedSteps(tour);
    const bySymbol = new Map(steps.filter(isCodeStep).filter((step) => step.landing).map((step) => [landingSearchName(step.landing.symbol), step.id]));
    const affected = new Set(steps.filter((step) => isCodeStep(step) &&
        (changed.has(step.file) || (step.kind !== 'context' && (step.moves?.some((move) => changed.has(move.before.file) || changed.has(move.after.file)) || step.files?.some((pattern) => [...changed].some((file) => matchGlob(pattern, file)))))))
        .map((step) => step.id));
    // Refresh connected explanations and the primers that prepare them. All
    // independent stops remain locked, even when the agent prefers a rewrite.
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const step of steps) {
            const links = step.kind === 'concept' ? step.preparesFor ?? [] : [...(step.calls ?? []), ...(step.returnsTo ? [step.returnsTo] : []), ...(step.landing?.calledBy ?? []).flatMap((caller) => { const id = bySymbol.get(landingSearchName(caller)); return id ? [id] : []; })];
            if (affected.has(step.id) || links.some((id) => affected.has(id))) {
                for (const id of [step.id, ...links])
                    if (!affected.has(id)) {
                        affected.add(id);
                        expanded = true;
                    }
            }
        }
    }
    return { changedFiles: [...changed].sort(), stepIds: steps.filter((step) => affected.has(step.id)).map((step) => step.id) };
}
function canonical(value) {
    const sort = (item) => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sort(val)])) : item;
    return JSON.stringify(sort(value));
}
/** Enforce the preservation contract independently of an agent's prompt. */
export function validateStoryRefresh(before, after, plan) {
    const errors = [];
    const allowed = new Set(plan.stepIds);
    const original = orderedSteps(before), next = orderedSteps(after);
    const byId = new Map(next.map((step) => [step.id, step]));
    for (const step of original) {
        const updated = byId.get(step.id);
        if (!updated) {
            errors.push(`Existing step ${step.id} must retain its id.`);
            continue;
        }
        const { order: _oldOrder, ...oldFields } = step;
        const { order: _newOrder, ...newFields } = updated;
        if (!allowed.has(step.id) && canonical(oldFields) !== canonical(newFields))
            errors.push(`Unaffected step ${step.id} was changed.`);
    }
    const originalIds = new Set(original.map((step) => step.id));
    if (canonical(original.map((step) => step.id)) !== canonical(next.filter((step) => originalIds.has(step.id)).map((step) => step.id)))
        errors.push('Existing steps must retain their relative reading order.');
    for (const step of next.filter((step) => !originalIds.has(step.id))) {
        if (isCodeStep(step) ? !plan.changedFiles.includes(step.file) : !(step.preparesFor?.length && step.preparesFor.every((id) => allowed.has(id)))) {
            errors.push(`New step ${step.id} is outside the affected scope.`);
        }
    }
    const metadata = ({ steps: _steps, diffFingerprint: _diff, storySnapshot: _snapshot, ...rest }) => rest;
    if (canonical(metadata(before)) !== canonical(metadata(after)))
        errors.push('Story intent, scope, verification claims, and history must stay unchanged.');
    return errors;
}
export function storyRefreshPrompt(plan, storyFile, base, head) {
    return `Use the codestory-storyteller skill to refresh affected stops in ${JSON.stringify(storyFile)} for ${JSON.stringify(base)}..${JSON.stringify(head ?? 'working tree')}.\n` +
        `Changed files: ${JSON.stringify(plan.changedFiles)}. Editable existing step ids: ${JSON.stringify(plan.stepIds)}.\n` +
        `Read the existing story and current source. Update explanations, ranges, highlights, and dependent primers only where these changes require it.\n` +
        `Preserve ALL existing step ids and their relative reading order. Preserve every unaffected step exactly (only its order number may shift). Add a stop only for uncovered changed code in the changed files.\n` +
        `Preserve all other story fields, including intent, scope, verification claims, storyArc, evolution, mode, audience, and version. Do not replace the walkthrough.\n` +
        `Write ONLY the selected story JSON file. Do not edit code, comments, snapshots, or any other artifact. Do not stamp a new baseline: the app does that after validating preservation and full changed-range coverage.\n` +
        `Use restricted HTML in prose; titles remain plain text. Re-read the current code before choosing each range. Validate with the bundled check-story.mjs checker. Do not ask questions.\n`;
}
