// The storyteller skill is SKILL.md plus references/*.md. Tests that pin skill
// wording read the whole corpus, so a rule can move between files without a
// test rewrite; tests that pin what must stay in the always-loaded core read
// SKILL.md alone.
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../../skills/codestory-storyteller/', import.meta.url);

/** SKILL.md only: what every agent loads before anything else. */
export function skillCore() {
  return readFileSync(new URL('SKILL.md', DIR), 'utf8');
}

/** File names under references/, sorted. */
export function skillReferenceFiles() {
  const refs = new URL('references/', DIR);
  return existsSync(refs) ? readdirSync(refs).filter((f) => f.endsWith('.md')).sort() : [];
}

/** SKILL.md followed by every reference file, in sorted order. */
export function skillCorpus() {
  const refs = new URL('references/', DIR);
  return [skillCore(), ...skillReferenceFiles().map((f) => readFileSync(new URL(f, refs), 'utf8'))].join('\n\n');
}
