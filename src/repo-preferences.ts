// Standing reviewer preferences for one repository (`.codestory/preferences.json`).
//
// These are local conventions the reviewer sets once — which files stories
// cover, how deep they go, and who they are written for — so generation reads
// them instead of asking every time. Missing, malformed, and future files all
// fall back without blocking review.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataDir } from './config.js';
import { join } from 'node:path';
import type { StoryAudience } from './types.js';

export type { StoryAudience };

export const DEFAULT_AUDIENCE: StoryAudience = 'newcomer';

export interface RepoPreferences {
  defaultMode?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  notes?: string;
  audience?: StoryAudience;
}

export const PREFERENCES_FILENAME = 'preferences.json';

export function isStoryAudience(value: unknown): value is StoryAudience {
  return value === 'newcomer' || value === 'familiar';
}

/** Unknown and absent values read as newcomer: full guidance is the safe default. */
export function normalizeAudience(value: unknown): StoryAudience {
  return isStoryAudience(value) ? value : DEFAULT_AUDIENCE;
}

function preferencesPath(repo: string): string {
  return join(dataDir(repo), PREFERENCES_FILENAME);
}

/** Standing preferences, or `{}` when the file is missing or unreadable. */
export function loadRepoPreferences(repo: string): RepoPreferences {
  const path = preferencesPath(repo);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const prefs = parsed as Record<string, unknown>;
    const out: RepoPreferences = {};
    if (typeof prefs.defaultMode === 'string') out.defaultMode = prefs.defaultMode;
    if (Array.isArray(prefs.includeGlobs) && prefs.includeGlobs.every((g) => typeof g === 'string')) {
      out.includeGlobs = [...prefs.includeGlobs];
    }
    if (Array.isArray(prefs.excludeGlobs) && prefs.excludeGlobs.every((g) => typeof g === 'string')) {
      out.excludeGlobs = [...prefs.excludeGlobs];
    }
    if (typeof prefs.notes === 'string') out.notes = prefs.notes;
    if (isStoryAudience(prefs.audience)) out.audience = prefs.audience;
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge a patch into the preferences file, preserving unknown future keys.
 * An invalid audience is dropped rather than persisted.
 */
export function saveRepoPreferences(repo: string, patch: Partial<RepoPreferences>): RepoPreferences {
  const path = preferencesPath(repo);
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    // A missing or corrupt file is replaced with the smallest valid one.
  }
  const next: Record<string, unknown> = { ...current };
  if (patch.defaultMode !== undefined) next.defaultMode = patch.defaultMode;
  if (patch.includeGlobs !== undefined) next.includeGlobs = patch.includeGlobs;
  if (patch.excludeGlobs !== undefined) next.excludeGlobs = patch.excludeGlobs;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.audience !== undefined) {
    if (isStoryAudience(patch.audience)) next.audience = patch.audience;
    else delete next.audience;
  }
  mkdirSync(dataDir(repo), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return loadRepoPreferences(repo);
}
