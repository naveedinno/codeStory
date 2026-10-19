// Vendored from starc007/ui-components — components/agents/agent-code.tsx (MIT)
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useState,
} from "react";
// Upstream imports `createHighlighter` from `shiki` here. shiki is a
// multi-megabyte async WASM highlighter and codeStory already highlights
// synchronously in its own palette (`src/highlight.ts`), so it is not adopted
// (README modification 4). Two seams replace it:
//   • `setAgentCodeTokenizer()` — install a tokenizer once, app-wide, and
//     `useAgentCodeTokens` keeps working for the line-level consumers
//     (`code-block`, `file-diff`).
//   • `highlightedHtml` — hand a component pre-highlighted markup directly.
// With neither installed these render plain, unhighlighted text.
import { cn } from "../lib/utils";

export type AgentCodeLanguage =
  | "bash"
  | "diff"
  | "json"
  | "text"
  | "tsx"
  | "typescript";

export interface AgentCodeToken {
  content: string;
  offset: number;
  light?: string;
  dark?: string;
}

export type AgentCodeTokenLines = AgentCodeToken[][];

export interface AgentCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
  /**
   * Pre-highlighted markup for `code`, replacing the tokenizer path entirely.
   * The caller owns escaping — pass output from `src/highlight.ts`, which
   * escapes, and never raw user input.
   */
  highlightedHtml?: string;
}

export interface AgentCodeLineProps {
  code: string;
  tokens?: AgentCodeToken[];
  className?: string;
  /** Pre-highlighted markup for this one line. Same escaping contract. */
  highlightedHtml?: string;
}

const tokenCache = new Map<string, AgentCodeTokenLines>();

/**
 * A synchronous or async tokenizer standing in for shiki. Returning `null`
 * means "leave this unhighlighted".
 */
export type AgentCodeTokenizer = (
  code: string,
  language: AgentCodeLanguage,
) => AgentCodeTokenLines | Promise<AgentCodeTokenLines | null> | null;

let agentCodeTokenizer: AgentCodeTokenizer | null = null;

/**
 * Install the app-wide tokenizer behind `useAgentCodeTokens`. Call once at
 * startup. Passing `null` removes it and clears the cache; until something is
 * installed, every consumer renders plain text.
 */
export function setAgentCodeTokenizer(tokenizer: AgentCodeTokenizer | null) {
  agentCodeTokenizer = tokenizer;
  tokenCache.clear();
}

function tokenCacheKey(code: string, language: AgentCodeLanguage) {
  return `${language}\u0000${code}`;
}

export function useAgentCodeTokens(
  code: string,
  language: AgentCodeLanguage,
) {
  const key = tokenCacheKey(code, language);
  const cached = tokenCache.get(key);
  const [result, setResult] = useState<{
    key: string;
    code: string;
    language: AgentCodeLanguage;
    lines: AgentCodeTokenLines;
  } | null>(cached ? { key, code, language, lines: cached } : null);

  useEffect(() => {
    const current = tokenCache.get(key);
    if (current) {
      setResult({ key, code, language, lines: current });
      return;
    }

    const tokenizer = agentCodeTokenizer;
    if (!tokenizer) return;

    let cancelled = false;
    // Upstream awaited shiki's `createHighlighter()` here. The installed
    // tokenizer may be synchronous, so this resolves either shape.
    Promise.resolve(tokenizer(code, language)).then((lines) => {
      if (cancelled || !lines) return;
      tokenCache.set(key, lines);
      setResult({ key, code, language, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [code, key, language]);

  if (result?.key === key) return result.lines;
  if (result?.language === language && code.startsWith(result.code)) {
    return result.lines;
  }
  return null;
}

export function AgentCodeLine({
  code,
  tokens,
  className,
  highlightedHtml,
}: AgentCodeLineProps) {
  // The `highlightedHtml` seam (README modification 4): markup the caller
  // already produced wins over the tokenizer path.
  if (highlightedHtml !== undefined) {
    return (
      <span
        className={className}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the seam's contract
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    );
  }
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark": token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  );
}

export function AgentCode({
  code,
  language = "bash",
  className,
  highlightedHtml,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language);
  let offset = 0;
  const lines = code.split("\n").map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
  });

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/85",
        className,
      )}
    >
      {highlightedHtml !== undefined ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the seam's contract
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      ) : (
        <code>
          {lines.map((line, index) => (
            <Fragment key={line.offset}>
              <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
              {index < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </code>
      )}
    </pre>
  );
}
