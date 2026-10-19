// Reading the server's bootstrap payload.
//
// Every surface shell emits exactly one
// `<script type="application/json" id="__CODESTORY_DATA__">…</script>`
// (see `src/shell.ts`). That block is the whole initial state: there is no
// second fetch on mount, no `data-*` attribute to scrape off <body>, and no
// client-side router. Read it once at boot and hand it to the root component.

/** Must match `SHELL_PAYLOAD_ID` in `src/shell.ts`. */
export const SHELL_PAYLOAD_ID = "__CODESTORY_DATA__";

/**
 * Parse the embedded payload.
 *
 * Throws rather than returning a default. A missing or malformed payload means
 * the shell and the bundle disagree, which is a build/route bug — failing loudly
 * at boot beats rendering an empty page that looks like "you have no
 * repositories".
 */
export function readShellPayload<T>(): T {
  const node = document.getElementById(SHELL_PAYLOAD_ID);
  if (!node) {
    throw new Error(
      `codeStory: no #${SHELL_PAYLOAD_ID} block in the document — the shell did not render a payload.`,
    );
  }
  const text = node.textContent ?? "";
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(
      `codeStory: #${SHELL_PAYLOAD_ID} is not valid JSON (${(cause as Error).message}).`,
    );
  }
}
