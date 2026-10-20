import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeTextAtomic } from './atomic-json.js';
import { DATA_DIR } from './config.js';
const defaults = () => ({ version: 1, engine: 'kokoro', voice: 'af_heart', rate: 1, voicesByEngine: {} });
export const narrationPreferencesFile = (home) => join(home, DATA_DIR, 'narration.json');
export function loadNarrationPreferences(home) {
    try {
        const value = JSON.parse(readFileSync(narrationPreferencesFile(home), 'utf8'));
        if (value?.version !== 1 || typeof value.engine !== 'string' || typeof value.voice !== 'string')
            return defaults();
        const voicesByEngine = value.voicesByEngine && typeof value.voicesByEngine === 'object' && !Array.isArray(value.voicesByEngine)
            ? Object.fromEntries(Object.entries(value.voicesByEngine).filter(([, voice]) => typeof voice === 'string')) : {};
        return { version: 1, engine: value.engine, voice: value.voice,
            rate: typeof value.rate === 'number' && value.rate >= 0.6 && value.rate <= 1.5 ? value.rate : 1, voicesByEngine };
    }
    catch {
        return defaults();
    }
}
export function saveNarrationPreferences(home, settings) {
    const previous = loadNarrationPreferences(home);
    const next = { ...previous, ...settings,
        voicesByEngine: { ...previous.voicesByEngine, [previous.engine]: previous.voice, [settings.engine]: settings.voice } };
    const file = narrationPreferencesFile(home);
    mkdirSync(dirname(file), { recursive: true });
    writeTextAtomic(file, JSON.stringify(next, null, 2) + '\n');
}
export class NarrationSettingsError extends Error {
    statusCode = 422;
}
export function resolveNarrationSettings(models, patch, current, preferences) {
    const model = models.find((model) => model.id === (patch.engine ?? current.engine));
    if (!model?.ready)
        throw new NarrationSettingsError('Choose a downloaded voice model. Manage downloads in Lino → Settings → Read Aloud.');
    if (!model.languages.includes('en'))
        throw new NarrationSettingsError('This model does not support English story narration.');
    const remembered = model.id === current.engine ? current.voice : preferences.voicesByEngine[model.id];
    const voice = patch.voice ?? (typeof remembered === 'string' && model.voices.some((voice) => voice.id === remembered)
        ? remembered : model.voices[0].id);
    if (!model.voices.some((choice) => choice.id === voice))
        throw new NarrationSettingsError('Choose a voice from the selected model.');
    const rate = patch.rate ?? current.rate ?? preferences.rate;
    if (!Number.isFinite(rate) || rate < 0.6 || rate > 1.5)
        throw new NarrationSettingsError('Choose a playback speed from 0.6× to 1.5×.');
    return { engine: model.id, voice, rate };
}
