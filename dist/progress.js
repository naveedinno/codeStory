// The app-owned live-progress protocol. Every agent workflow streams these
// normalized events as NDJSON; the app owns the spine (run_started, context,
// phase, heartbeat, run_done) and agent output only enriches it. Pure module:
// helpers are timestamp-free and deterministic, so they unit-test cleanly.
/** Default human labels for each phase; callers may override per emit. */
export const PHASE_LABELS = {
    idle: 'Idle',
    preflight: 'Checking preconditions',
    resolving_context: 'Resolving the change',
    preparing_prompt: 'Preparing the prompt',
    starting_agent: 'Starting the agent',
    agent_running: 'Agent is working',
    reading_changes: 'Reading the change',
    recovering_why: 'Recovering the why',
    designing_path: 'Designing the reading path',
    writing_output: 'Writing output',
    validating_output: 'Validating output',
    applying_results: 'Applying results',
    complete: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
};
// Monotonic ordering so the displayed phase never moves backward.
const PHASE_ORDER = [
    'idle', 'preflight', 'resolving_context', 'preparing_prompt', 'starting_agent',
    'agent_running', 'reading_changes', 'recovering_why', 'designing_path',
    'writing_output', 'validating_output', 'applying_results', 'complete',
];
export function phaseRank(phase) {
    if (phase === 'failed' || phase === 'stopped')
        return PHASE_ORDER.length;
    const i = PHASE_ORDER.indexOf(phase);
    // Fail loud if the Phase union grows without PHASE_ORDER being updated.
    if (i < 0)
        throw new RangeError(`phaseRank: unknown phase "${phase}"`);
    return i;
}
export function runStarted(workflow, label) {
    return { type: 'run_started', workflow, label };
}
export function contextEvent(ctx) {
    return { type: 'context', ...ctx };
}
export function phaseEvent(phase, label, detail) {
    return { type: 'phase', phase, label: label ?? PHASE_LABELS[phase], ...(detail ? { detail } : {}) };
}
export function fileEvent(action, rawTool, target) {
    const verb = action === 'read' ? 'Reading' : action === 'write' ? 'Writing' : 'Editing';
    return { type: 'file', action, rawTool, target, label: `${verb} ${target}` };
}
export function commandEvent(command, label) {
    const c = command.replace(/\s+/g, ' ').trim();
    const short = c.length > 100 ? c.slice(0, 100) + '…' : c;
    return { type: 'command', command: c, label: label ?? (short ? `$ ${short}` : '$ …') };
}
export function activityEvent(kind, label, detail) {
    return { type: 'activity', kind, label, ...(detail ? { detail } : {}) };
}
export function toolEvent(label, rawTool, target) {
    return { type: 'tool', label, rawTool, ...(target ? { target } : {}) };
}
export function planEvent(items) {
    return { type: 'plan', items };
}
export function textEvent(data) {
    return { type: 'text', data };
}
export function heartbeatEvent(quietMs) {
    return { type: 'heartbeat', quietMs };
}
export function warningEvent(label, detail, stage) {
    return { type: 'warning', label, ...(detail ? { detail } : {}), ...(stage ? { stage } : {}) };
}
export function errorEvent(stage, label, detail, technicalDetail) {
    return {
        type: 'error',
        stage,
        label,
        ...(detail ? { detail } : {}),
        ...(technicalDetail ? { technicalDetail } : {}),
    };
}
export function doneEvent(status, result) {
    return { type: 'run_done', status, ...(result ? { result } : {}) };
}
/**
 * The phase an agent-derived event *proves* we've reached, or null. The server
 * passes isTargetWrite (it knows the run's output path), keeping this pure.
 */
export function observedPhase(event, isTargetWrite) {
    if (event.type === 'file') {
        if (event.action === 'read')
            return 'reading_changes';
        if (isTargetWrite)
            return 'writing_output';
        return null;
    }
    // Intent-evidence commands (the story prompt's Phase 1) prove the agent is
    // recovering the why; keep the pattern narrow so ordinary git use doesn't match.
    if (event.type === 'command' && /\bgit log\b|\bgh pr view\b/.test(event.command)) {
        return 'recovering_why';
    }
    if (event.type === 'activity' && event.kind === 'search')
        return 'reading_changes';
    return null;
}
// Exact phase markers the story prompt tells the agent to print (matched
// case-insensitively after trimming; trailing `.`/`!` ignored, since agents
// like to punctuate). Anything else after ">> " is narration.
// The code-story prompt prints its own words for the same two phases, and the
// panel should show the words the reader saw in the agent's output.
const NOTE_MARKERS = [
    ['recovering the why', 'recovering_why'],
    ['framing the question', 'recovering_why', 'Framing the question'],
    ['designing the reading path', 'designing_path'],
    ['mapping the code', 'designing_path', 'Mapping the code'],
    ['writing the steps', 'writing_output'],
];
const NARRATION_CAP = 300;
/**
 * Parse one stdout line as an agent note: ">> <marker>" advances a phase,
 * ">> <anything else>" is live narration for the panel. Non-note lines → null.
 */
export function parseAgentNoteLine(line) {
    const m = /^\s*>>\s*(.+?)\s*$/.exec(line);
    if (!m)
        return null;
    const text = m[1];
    if (!text.trim())
        return null;
    const low = text.toLowerCase().replace(/[.!\s]+$/, '');
    for (const [marker, phase, label] of NOTE_MARKERS) {
        if (low === marker)
            return phaseEvent(phase, label);
    }
    const clipped = text.length > NARRATION_CAP ? text.slice(0, NARRATION_CAP) + '…' : text;
    return activityEvent('narration', clipped);
}
/** All note events found in a (possibly multi-line) agent text chunk. */
export function noteEventsFromText(data) {
    const out = [];
    for (const line of data.split('\n')) {
        const e = parseAgentNoteLine(line);
        if (e)
            out.push(e);
    }
    return out;
}
function relPath(target, repoPath) {
    const root = repoPath.endsWith('/') ? repoPath : repoPath + '/';
    return target.startsWith(root) ? target.slice(root.length) : target;
}
// The suffix match tolerates agents that report paths under an unexpected
// prefix (absolute paths outside repoPath, worktree copies). Deliberate
// trade-off, pinned in tests: an unrelated deeper file with the same tail
// (vendor/a.ts when a.ts changed) also counts as a changed-file read.
function matchChanged(rel, changed) {
    for (const c of changed) {
        if (rel === c || rel.endsWith('/' + c))
            return c;
    }
    return null;
}
/**
 * Stateful enricher for file events: rewrites targets repo-relative and counts
 * distinct changed files the agent has read, so the panel can say "3 of 8"
 * honestly. Every other event passes through untouched.
 */
export function createFileEnricher(scope) {
    const seen = new Set();
    return (ev) => {
        if (ev.type !== 'file')
            return ev;
        const rel = relPath(ev.target, scope.repoPath);
        const verb = ev.action === 'read' ? 'Reading' : ev.action === 'write' ? 'Writing' : 'Editing';
        const hit = ev.action === 'read' ? matchChanged(rel, scope.changedFiles) : null;
        if (!hit)
            return { ...ev, rel, label: `${verb} ${rel}` };
        seen.add(hit);
        return {
            ...ev,
            rel,
            changedIndex: seen.size,
            changedTotal: scope.changedFiles.length,
            label: `Reading changed files · ${seen.size} of ${scope.changedFiles.length} · ${rel}`,
        };
    };
}
