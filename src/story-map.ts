import type { Tour } from './types.js';
import { narrativeText } from './narrative.js';

export type StoryMapContent =
  | { type: 'text'; panelIndex: number; beat: number }
  | { type: 'prose'; text: string }
  | { type: 'page'; viewerId: string; panelIndex: number }
  | { type: 'diagram'; title: string; labels: string[] }
  | { type: 'code'; viewerId: string; file: string; revision: string; rangesByBeat: [number, number][][] }
  | { type: 'diff'; viewerId: string; file: string; base: string; head: string; rangesByBeat: [number, number][][] };

export interface StoryMapTopic {
  structural?: 'tour' | 'section' | 'chapter';
  id: string;
  stepId: string;
  panelIndex: number;
  label: string;
  symbol: string;
  beat: number;
  beats: number;
  children: string[];
  content: StoryMapContent[];
}

export interface StoryMapData {
  scope?: 'full';
  rootLabel?: string;
  readingLabel?: string;
  nodes: StoryMapTopic[];
  commit: string;
  title: string;
  path: string[];
}

/** Metadata only. Native source, diffs and sandboxed pages retain their leased endpoints. */
export function buildStoryMap(tour: Tour, base: string, head?: string): StoryMapData {
  const steps = [...tour.steps].sort((a, b) => a.order - b.order);
  const root: StoryMapTopic = {
    id: 'root', stepId: 'map-root', panelIndex: 1, label: narrativeText(tour.title),
    symbol: `${steps.length} steps`, beat: 0, beats: 0, structural: 'tour', children: [],
    content: [{ type: 'prose', text: narrativeText(tour.summary ?? '') }],
  };
  const nodes = [root], path: string[] = [];
  let chapter: StoryMapTopic | undefined, chapterLabel = '';
  for (const [index, step] of steps.entries()) {
    const label = step.chapter || 'Story';
    // Contiguous groups preserve authored order even when a chapter label repeats.
    if (!chapter || label !== chapterLabel) {
      chapterLabel = label;
      chapter = { id: `chapter-${index}`, stepId: `chapter-${index}`, panelIndex: index + 1,
        label: narrativeText(label), symbol: '', beat: 0, beats: 0, structural: 'chapter', children: [], content: [] };
      nodes.push(chapter); root.children.push(chapter.id);
    }
    // Navigation IDs cannot collide with authored IDs such as "root" or "chapter-0".
    const id = `step-${index + 1}`, panelIndex = index + 1, viewerId = `story-${id}`;
    const content: StoryMapContent[] = [];
    if (step.kind === 'concept') content.push({ type: 'page', viewerId, panelIndex });
    else {
      content.push({ type: 'text', panelIndex, beat: 0 });
      const rangesByBeat = step.beats?.map(beat => beat.highlights ?? []) ?? [step.highlights ?? [step.range]];
      content.push(tour.subject !== 'code' && step.kind !== 'context'
        ? { type: 'diff', viewerId, file: step.file, base, head: head ?? 'Working tree', rangesByBeat }
        : { type: 'code', viewerId, file: step.file, revision: head ?? 'Working tree', rangesByBeat });
    }
    const node: StoryMapTopic = { id, stepId: step.id, panelIndex, label: narrativeText(step.title),
      symbol: step.kind === 'concept' ? '' : step.landing?.symbol || step.file,
      beat: 0, beats: step.kind === 'concept' ? 0 : step.beats?.length ?? 0, children: [], content };
    // Narration beats update this card's text and native highlights in place;
    // they are not separate topics in the map hierarchy.
    nodes.push(node); chapter.children.push(id); path.push(id);
  }
  for (const group of nodes.filter(node => node.structural === 'chapter')) {
    group.symbol = `${group.children.length} ${group.children.length === 1 ? 'step' : 'steps'}`;
    group.content = [{ type: 'prose', text: `${group.symbol} in this chapter.` }];
  }
  return { nodes, path, commit: head ?? '', title: root.label, scope: 'full', rootLabel: 'Story map', readingLabel: 'Whole story' };
}
