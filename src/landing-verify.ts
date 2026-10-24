// Verifies a code step's `landing` against the repository: the symbol appears
// in the step's file, every named caller shares a file with the symbol, and a
// role's gate is written in the step's file. Read-only and deterministic. It
// cannot prove a call, but a vague caller ("every review page") or an invented
// one cannot pass. Co-occurrence is text evidence, never proof of a call.
import { execFileSync } from "node:child_process";
import { readWholeFile } from "./git.js";
import { orderedSteps } from "./tour.js";
import { isCodeStep, type Tour } from "./types.js";
import { landingSearchName } from './source-symbol.js';
import { callerInvocationLines } from './source-call-site.js';
export { landingSearchName } from './source-symbol.js';

const SYMBOL_NAME = /^[.#]?[A-Za-z_$][\w$-]*$/;

export interface CallerEvidence { file: string; line: number; text: string; level: 'text-match' | 'invocation'; }

/** A source occurrence for inspection. Intentionally makes no call-graph claim. */
export function callerEvidence(repo: string, symbol: string, caller: string, head?: string): CallerEvidence | null {
  const symbolName = landingSearchName(symbol), name = landingSearchName(caller);
  if (!SYMBOL_NAME.test(symbolName) || !SYMBOL_NAME.test(name)) return null;
  const cache = new Map<string, Set<string>>();
  const candidates = [...filesMentioning(repo, name, head, cache)].filter((file) =>
    !/(^|\/)(\.codestory|\.diffstory|\.env[^/]*)($|\/)/.test(file) && filesMentioning(repo, symbolName, head, cache).has(file)).sort();
  const word = new RegExp(`(?:^|[^\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w$])`);
  let fallback: CallerEvidence | null = null;
  for (const file of candidates.slice(0, 20)) {
    const lines = readWholeFile(repo, file, head);
    const invocation = lines && callerInvocationLines(lines, symbol, caller)[0];
    if (lines && invocation) return { file, line: invocation, text: lines[invocation - 1].slice(0, 500), level: 'invocation' };
    const index = lines?.findIndex((line) => word.test(line)) ?? -1;
    if (!fallback && lines && index >= 0) fallback = { file, line: index + 1, text: lines[index].slice(0, 500), level: 'text-match' };
  }
  return fallback;
}

/** Files (at `head`, or in the working tree including untracked files) that mention `name` as a word. */
function filesMentioning(
  repo: string,
  name: string,
  head: string | undefined,
  cache: Map<string, Set<string>>,
): Set<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const args = head
    ? ["grep", "-l", "-w", "-F", "-e", name, head, "--"]
    : ["grep", "--untracked", "-l", "-w", "-F", "-e", name];
  let out = "";
  try {
    out = execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    out = ""; // git grep exits 1 when nothing matches
  }
  const prefix = head ? `${head}:` : "";
  const files = new Set(
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => (prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line)),
  );
  cache.set(name, files);
  return files;
}

export function verifyLandings(repo: string, tour: Tour): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cache = new Map<string, Set<string>>();
  for (const step of orderedSteps(tour)) {
    if (!isCodeStep(step) || !step.landing || step.range[0] === 0) continue;
    const where = `steps[${step.id}].landing`;
    const { symbol, calledBy = [], role } = step.landing;
    const lines = readWholeFile(repo, step.file, tour.head);
    const fileText = lines ? lines.join("\n") : null;
    const symbolName = landingSearchName(symbol);
    if (fileText !== null && !fileText.includes(symbolName)) {
      errors.push(`${where}.symbol "${symbol}" does not appear in ${step.file}`);
    }
    const symbolFiles = filesMentioning(repo, symbolName, tour.head, cache);
    calledBy.forEach((caller, index) => {
      const name = landingSearchName(caller);
      if (!SYMBOL_NAME.test(name)) {
        errors.push(
          `${where}.calledBy[${index}] "${caller}" is a description, not a symbol; name the calling function, handler, test, or component`,
        );
        return;
      }
      if (name === symbolName) {
        errors.push(`${where}.calledBy[${index}] "${caller}" is the symbol itself`);
        return;
      }
      const callerFiles = filesMentioning(repo, name, tour.head, cache);
      if (![...callerFiles].some((file) => symbolFiles.has(file))) {
        errors.push(
          `${where}.calledBy[${index}] "${caller}": no file in the repository mentions both it and "${symbolName}"`,
        );
      }
    });
    const gate = role?.gate?.replace(/\s+/g, " ").trim();
    if (gate && fileText !== null && !fileText.replace(/\s+/g, " ").includes(gate)) {
      errors.push(`${where}.role.gate "${role?.gate}" does not appear in ${step.file}`);
    }
  }
  return { errors, warnings };
}
