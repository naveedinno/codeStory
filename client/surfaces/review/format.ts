// Small text helpers the review markup needs, lifted from `src/render.ts`.
//
// They were private functions in the renderer; they are here because the same
// strings are now produced in the browser. Nothing in this file makes a
// decision — anything that does (freshness, trust precedence, the reading-order
// label) is computed once in the route and travels in the payload, so the
// server and the client cannot disagree about a verdict.

const countFormatter = new Intl.NumberFormat("en-US");

/** Preserve compact small counts; group five-figure totals for scanning. */
export function formatCount(value: number): string {
  return Math.abs(value) >= 10_000 ? countFormatter.format(value) : String(value);
}

/** `plural(1,'file')` → "file"; `plural(0,'file')` → "files". */
export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** A full object id reads as noise in a scope line; branch and tag names stay whole. */
export function refLabel(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}

/** Split a path into its directory prefix (with trailing slash) and base name. */
export function splitPath(p: string): [string, string] {
  const i = p.lastIndexOf("/");
  return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)];
}

/** Zero-padded step numeral, so numbers do not jitter as the rail scrolls. */
export function numeral(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A rail beat's clipped label.
 *
 * Always fed the TEXT projection, never the HTML one: clipping `.html` at 64
 * characters would cut a tag in half and hand the browser a fragment the
 * sanitizer never approved.
 */
export function railBeatLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 64) return clean;
  const clipped = clean.slice(0, 64);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 42 ? boundary : 64).replace(/[,:;\s]+$/, "")}…`;
}

/** The `+N −M` pair beside a file or directory in the sidebar tree. */
export function statPair(add: number, del: number): { add: number; del: number } | null {
  return add || del ? { add, del } : null;
}

/** `data-filter-test` — matches the vanilla renderer's test-path heuristic. */
export function isTestPath(file: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file);
}

/** The extension chip set offered by the storyless generator's file scope. */
export function fileExtension(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i) : "";
}

/** Newlines as `<br>`, for prose that arrives as sanitized inline HTML. */
export function withBreaks(html: string): string {
  return html.replace(/\n/g, "<br>");
}

/** `dangerouslySetInnerHTML` for narrative the server already sanitized. */
export function html(value: string): { __html: string } {
  return { __html: value };
}
