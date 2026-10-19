// Portable story bundles for team handoff.
//
// A teammate replays a walkthrough with three things: the same branch or
// commit range checked out, the story file, and the app. The bundle is the
// middle one as a download: the validated story plus the replay metadata
// (base/head/origin) the picker needs to say whether it still applies.
// Comments never travel — they are local reviewer state.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dataDir } from './config.js';
import { snapshotStoryIfChanged } from './story-history.js';
import { loadTour, validateTour } from './tour.js';
import type { Tour } from './types.js';

export const STORY_BUNDLE_VERSION = 1;

export interface StoryBundle {
  bundle: number;
  exportedAt: string;
  /** Base ref the story was written against, when the story names one. */
  base?: string;
  /** Head ref for fixed-range stories. */
  head?: string;
  /** Directory name of the exporting repo: a hint, never an identity. */
  repoName: string;
  story: Tour;
}

/** Bundle the story behind a listStories() id (snapshots included). */
export function exportStoryBundle(repo: string, storyPath: string): StoryBundle {
  const tour = loadTour(storyPath);
  return {
    bundle: STORY_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(tour.base ? { base: tour.base } : {}),
    ...(tour.head ? { head: tour.head } : {}),
    repoName: basename(repo),
    story: tour,
  };
}

/** File name for the download: slug + date, safe for content-disposition. */
export function bundleFileName(storyId: string): string {
  const slug =
    storyId
      .toLowerCase()
      .replace(/\.json$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'story';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug}-${date}.codestory.json`;
}

function slugForImport(name: string, tour: Tour): string {
  const base = (name || tour.title || 'imported-story')
    .toLowerCase()
    .replace(/\.json$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'imported-story';
  return base;
}

export interface ImportedBundle {
  id: string;
  tour: Tour;
}

/**
 * Validate an uploaded bundle and save its story under `.codestory/stories/`.
 * Accepts a full bundle or a bare story object. Never writes anywhere else:
 * the primary story.json is only ever written by generation. Returns the new
 * story id, or throws a TourError-flavoured Error callers surface as a 400.
 */
export function importStoryBundle(
  repo: string,
  name: string,
  data: unknown,
): ImportedBundle {
  const story = (data as { story?: unknown })?.story ?? data;
  const errors = validateTour(story);
  if (errors.length) {
    throw new Error(`This bundle is not a valid story:\n  - ${errors.join('\n  - ')}`);
  }
  const tour = JSON.parse(JSON.stringify(story)) as Tour;
  const dir = join(dataDir(repo), 'stories');
  mkdirSync(dir, { recursive: true });
  const slug = slugForImport(typeof name === 'string' ? name : '', tour);
  let file = `${slug}.json`;
  for (let n = 2; existsSync(join(dir, file)); n++) {
    file = `${slug}-${n}.json`;
  }
  writeFileSync(join(dir, file), `${JSON.stringify(tour, null, 2)}\n`, 'utf8');
  const id = `stories/${file}`;
  snapshotStoryIfChanged(repo, id);
  return { id, tour };
}
