// Locate literal invocations inside a named function, never a file's first
// mention of its caller. This is source navigation, not runtime call analysis.
// Unsupported declaration syntax deliberately produces no automatic pairing.
import { readWholeFile } from './git.js';
import { landingSearchName, sourceSymbolKey } from './source-symbol.js';
import { isCodeStep, type CodeTourStep, type TourStep } from './types.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Preserve positions and newlines while excluding comments and string data. */
export function sourceCodeMask(source: string): string {
  let result = '', state: 'code' | 'line' | 'block' | 'quote' | 'regex' = 'code', quote = '', regexClass = false;
  const unsupported = () => source.replace(/[^\n]/g, ' ');
  const hasRegexSyntax = !/^\s*pragma\s+solidity\b/m.test(source);
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (state === 'line') {
      result += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') state = 'code';
    } else if (state === 'block') {
      if (ch === '*' && next === '/') { result += '  '; i++; state = 'code'; }
      else result += ch === '\n' ? '\n' : ' ';
    } else if (state === 'regex') {
      result += ch === '\n' ? '\n' : ' ';
      if (ch === '\\' && next !== undefined) { result += next === '\n' ? '\n' : ' '; i++; }
      else if (ch === '[') regexClass = true;
      else if (ch === ']') regexClass = false;
      else if ((ch === '/' && !regexClass) || ch === '\n') state = 'code';
    } else if (state === 'quote') {
      // Interpolated templates can contain recursively nested literals. They
      // need a language parser; do not expose their contents as source calls.
      if (quote === '`' && ch === '$' && next === '{') return unsupported();
      result += ch === '\n' ? '\n' : ' ';
      if (ch === '\\' && next !== undefined) { result += next === '\n' ? '\n' : ' '; i++; }
      else if (ch === quote) state = 'code';
    } else if (ch === '/' && next === '/') { result += '  '; i++; state = 'line'; }
    else if (ch === '/' && next === '*') { result += '  '; i++; state = 'block'; }
    else if (hasRegexSyntax && ch === '/') {
      if (/[=(:,!?{\[;]\s*$/.test(result) || /=>\s*$/.test(result) || /\b(?:return|throw|case|yield|else|do|await)\s+$/.test(result)) { result += ' '; regexClass = false; state = 'regex'; }
      else return unsupported(); // Division versus statement-position regex is ambiguous.
    }
    else if (ch === '"' || ch === "'" || ch === '`') { result += ' '; quote = ch; state = 'quote'; }
    else result += ch;
  }
  return result;
}

interface SourceFunction { name?: string; start: number; open: number; close: number }

function sourceFunctions(code: string): SourceFunction[] {
  const found: SourceFunction[] = [];
  const definitions = /\b(?:function|fn|fun|func)\s*\*?\s*(?:([A-Za-z_$][\w$]*)\s*)?\(/g;
  for (const definition of code.matchAll(definitions)) {
    const openParams = definition.index! + definition[0].lastIndexOf('(');
    const closeParams = closeDelimiter(code, openParams, '(', ')');
    if (closeParams < 0) continue;
    const tail = code.slice(closeParams + 1), boundary = /[;{}]/.exec(tail);
    if (!boundary || boundary[0] !== '{' || /^\s*:/.test(tail.slice(0, boundary.index))) continue;
    const open = closeParams + 1 + boundary.index, close = closeDelimiter(code, open, '{', '}');
    if (close >= 0) found.push({ name: definition[1], start: definition.index!, open, close });
  }
  return found;
}

function closeDelimiter(code: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Object methods introduce scopes that this small declaration reader cannot resolve. */
function hasMethodBody(code: string): boolean {
  const blocks = new Set<number>(), controls: number[] = [];
  for (const block of code.matchAll(/\b(?:else|try|finally|do|unchecked)\s*\{/g)) blocks.add(block.index! + block[0].lastIndexOf('{'));
  for (const token of code.matchAll(/\(/g)) {
    const open = token.index!, close = closeDelimiter(code, open, '(', ')');
    if (close < 0) continue;
    const tail = code.slice(close + 1);
    if (/^\s*:/.test(tail)) return true; // Return types require a language parser.
    const body = /^\s*\{/.exec(tail);
    if (!body) continue;
    const before = code.slice(0, open);
    const name = /\b([A-Za-z_$][\w$]*)\s*$/.exec(before)?.[1];
    const declaration = /\b(?:function|fn|fun|func)\s*\*?\s*(?:[A-Za-z_$][\w$]*\s*)?$/.test(before);
    if (!declaration && !/^(?:if|for|while|switch|catch|with)$/.test(name ?? '')) return true;
    blocks.add(close + 1 + body[0].lastIndexOf('{'));
    if (!declaration) controls.push(open);
  }
  // A keyword-named object method, such as { if() {} }, is not a control
  // statement. Its containing object brace is not a recognized block.
  for (const control of controls) {
    const scopes: number[] = [];
    for (let i = 0; i < control; i++) {
      if (code[i] === '{') scopes.push(i);
      else if (code[i] === '}') scopes.pop();
    }
    if (scopes.length && !blocks.has(scopes.at(-1)!)) return true;
  }
  return false;
}

/** Actual callee tokens in the named caller's body, clipped to a source window. */
export function callerInvocationLines(
  lines: string[], symbol: string, caller: string, viewport: [number, number] = [1, lines.length],
): number[] {
  const calleeName = landingSearchName(symbol), callerName = landingSearchName(caller);
  if (!IDENTIFIER.test(calleeName) || !IDENTIFIER.test(callerName) || calleeName === callerName) return [];
  // Owner-qualified declarations require scope resolution. Explicit callSite
  // anchors still support them; automatic lookup must not discard the owner.
  if (sourceSymbolKey(caller) !== callerName) return [];
  const code = sourceCodeMask(lines.join('\n'));
  const functions = sourceFunctions(code);
  const found = new Set<number>();
  for (const owner of functions.filter(fn => fn.name === callerName)) {
    const body = code.slice(owner.open + 1, owner.close);
    if (/\bclass\b|\b(?:interface|type)\s+[A-Za-z_$]/.test(body) || body.includes('=>') || hasMethodBody(body)) continue;
    const nested = functions.filter(fn => fn.start > owner.open && fn.close < owner.close);
    const target = sourceSymbolKey(symbol).split('.');
    if (!target.every(part => IDENTIFIER.test(part))) continue;
    const calls = new RegExp(`(?<![\\w$.:])${target.map(escape).join('\\s*(?:\\.|::)\\s*')}\\s*\\(`, 'g');
    for (const call of body.matchAll(calls)) {
      const before = body.slice(0, call.index);
      if (/\b(?:function|fn|fun|func)\s*\*?\s*$/.test(before) || /(?:\.|::)\s*$/.test(before)) continue;
      const offset = owner.open + 1 + call.index!;
      if (nested.some(fn => offset >= fn.start && offset <= fn.close)) continue;
      const line = code.slice(0, offset).split('\n').length;
      if (line >= viewport[0] && line <= viewport[1]) found.add(line);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Derive a small call-site crop for an existing story's declared relationship. */
export function discoverStoryCallSite(
  repo: string, step: CodeTourStep, ordered: TourStep[], head?: string,
): CodeTourStep['callSite'] {
  if (!step.landing || !/\([^)]*\)\s*$/.test(step.landing.symbol)) return undefined;
  const callers = new Set((step.landing.calledBy ?? []).map(sourceSymbolKey));
  if (!callers.size) return undefined;
  const files = new Map<string, string[] | null>();
  const at = ordered.findIndex(candidate => candidate.id === step.id);
  for (let i = at - 1; i >= 0; i--) {
    const parent = ordered[i];
    if (!isCodeStep(parent) || !parent.landing || !callers.has(sourceSymbolKey(parent.landing.symbol))) continue;
    if (!files.has(parent.file)) files.set(parent.file, readWholeFile(repo, parent.file, head));
    const lines = files.get(parent.file);
    if (!lines) continue;
    const viewport = parent.viewport ?? parent.range;
    const matches = callerInvocationLines(lines, step.landing.symbol, parent.landing.symbol, viewport);
    if (!matches.length || matches.at(-1)! - matches[0] >= 12) continue;
    const range: [number, number] = [matches[0], matches.at(-1)!];
    return {
      step: parent.id, range,
      viewport: [Math.max(viewport[0], range[0] - 8), Math.min(viewport[1], range[1] + 6)],
    };
  }
  return undefined;
}
