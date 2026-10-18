import { narrativeText } from './narrative.js';
import { orderedSteps } from './tour.js';
import { isCodeStep } from './types.js';
/** Transparent review cues, not a security verdict. Ties retain story order. */
export function challengeTargets(tour, readLines) {
    const hotspots = new Set((tour.hotspots ?? []).map((spot) => spot.step));
    return orderedSteps(tour).flatMap((step, index) => {
        if (!isCodeStep(step))
            return [];
        const prose = narrativeText([step.title, step.why, ...(step.beats ?? []).map((beat) => beat.text), ...(step.tags ?? [])].join(' '));
        const lines = readLines?.(step.file);
        const code = lines?.slice(Math.max(0, step.range[0] - 1), step.range[1]).join('\n') ?? '';
        const text = `${prose}\n${code}`;
        const reasons = [];
        let score = 0;
        if (hotspots.has(step.id)) {
            reasons.push('Author-flagged doubt');
            score += 100;
        }
        if (step.landing?.role?.gate || /\b(auth(?:oriza?tion|enticate|orize)?|permissions?|onlyOwner|onlyRole|requireAccountInScope|msg\.sender|access control)\b/i.test(text)) {
            reasons.push('Permission or trust boundary');
            score += 30;
        }
        if (/\b(transfer\w*|balances?|storage|persist\w*|mutat\w*|debit|credit|withdraw\w*|settle\w*|writes?|rollback|retry|retries)\b|\.push\s*\(|\b(?:delete|insert|update)\b/i.test(text)) {
            reasons.push('State or value movement');
            score += 25;
        }
        if (/\b(boundary|equal\w*|missing test|untested|not tested|no test|edge case|overflow|rounding|revert\w*|fails?|failure)\b|[<>]=?/i.test(text)) {
            reasons.push('Boundary or failure case');
            score += 20;
        }
        if (/(^|\/)(test|tests|spec|__tests__)\/|\.(test|spec)\.|\.t\.sol$/i.test(step.file) || step.tags?.includes('test')) {
            reasons.push('Regression proof');
            score += 10;
        }
        return [{ stepId: step.id, panelIndex: index + 1, reasons: reasons.length ? reasons : ['Core reading path'], score }];
    }).sort((a, b) => b.score - a.score || a.panelIndex - b.panelIndex)
        .slice(0, 5).map(({ score: _score, ...target }) => target);
}
