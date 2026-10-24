// Project validated story facts into the small presentation vocabulary the
// review surface owns. This is deliberately not part of story.json: authors
// describe evidence and relationships; the app decides how to compose them.
import type { StoryStepSceneLayout } from './types.js';

export type StoryStepSceneFacts =
  | { kind: 'concept'; hasDiagram: boolean; hasPage?: boolean }
  | { kind: 'code'; hasMoves: boolean; paired: boolean; hasCallSite?: boolean };

/**
 * Choose the most specific scene that can present the existing evidence.
 * Paired code wins over the more general logic-move treatment because the
 * cross-file relationship already determines the widest layout.
 */
export function projectStoryStepScene(facts: StoryStepSceneFacts): StoryStepSceneLayout {
  if (facts.kind === 'concept') {
    if (facts.hasPage) return 'concept-page';
    return facts.hasDiagram ? 'concept-diagram' : 'concept-document';
  }
  if (facts.hasCallSite) return 'caller-helper';
  if (facts.paired) return 'paired-code';
  if (facts.hasMoves) return 'logic-move';
  return 'code-focus';
}
