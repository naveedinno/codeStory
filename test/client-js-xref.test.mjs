// PAGE_JS is assembled from template strings, so tsc never parses it and a
// deleted-but-still-called helper compiles, ships, and fails only at runtime —
// inside a .catch that reports it as a network problem. That happened once:
// `mountThreads` was renamed to `mountCommentPins` in d6c7589 and three call
// sites in diff-assets.ts were left behind, silently breaking every lazily
// loaded diff body. These tests make that class of bug fail the build instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { readFileSync } from "node:fs";

// The review engine is a module now, so `tsc`/esbuild would catch a genuinely
// unresolvable identifier at build time. This check survives anyway, retargeted
// at the module body, because the failure it was written for is subtler than a
// build error: a helper referenced from a delegated click branch that nothing
// declares fails only when a reviewer clicks that one control, which is exactly
// how `mountThreads(fullInner)` stayed green in CI for days.
const ENGINE = readFileSync(
  new URL("../client/surfaces/review/engine/review-engine.js", import.meta.url),
  "utf8",
);
// Everything between the exported entry point and its closing brace: the same
// closure the IIFE used to be.
const PAGE_JS = ENGINE.slice(
  ENGINE.indexOf("export function startReviewEngine"),
).replace("export ", "");
const DIFF_JS = PAGE_JS;

// Host and language builtins the client legitimately calls.
const ENGINE_IMPORTS = [
  // Imported at the top of the module rather than declared in the closure.
  "mountEnginePanel",
  "runProgress",
  "progressPrimaryActionClass",
  "progressSecondaryActionClass",
  "diagramErrorLine",
  "diagramErrorSummary",
  "createBrowserSpeech",
];
const GLOBALS = new Set([
  ...ENGINE_IMPORTS,
  // `import(` is syntax, and the rest are words that happen to precede a "(" in
  // this file's prose comments or in a CSS/`scaleX(...)` string.
  "import",
  "XMLSerializer",
  "_",
  "__",
  "cancelled",
  "comments",
  "files",
  "package",
  "panes",
  "review",
  "scaleX",
  "taken",
  "there",
  "tour",
  "which",
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "typeof",
  "function",
  "new",
  "delete",
  "void",
  "in",
  "of",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Math",
  "JSON",
  "Date",
  "RegExp",
  "Error",
  "Promise",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "Symbol",
  "BigInt",
  "Proxy",
  "Reflect",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
  "structuredClone",
  "fetch",
  "alert",
  "confirm",
  "prompt",
  "console",
  "document",
  "window",
  "navigator",
  "localStorage",
  "sessionStorage",
  "history",
  "location",
  "getComputedStyle",
  "matchMedia",
  "scrollTo",
  "getSelection",
  "CustomEvent",
  "Event",
  "EventSource",
  "AbortController",
  "Blob",
  "FormData",
  "Headers",
  "Request",
  "Response",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "URL",
  "URLSearchParams",
  "DOMParser",
  "Node",
  "Element",
  "HTMLElement",
  "Image",
  "TextEncoder",
  "TextDecoder",
]);

// Bare words that look like calls but are CSS functions inside string literals
// (`:not(…)`, `translate(…)`, `rotate(…)`) rather than JavaScript.
const CSS_FUNCTIONS_IN_STRINGS = new Set([
  // `cubic-bezier(...)` is matched from the segment after its hyphen.
  "bezier",
  "not",
  "rotate",
  "translate",
  "translateX",
  "translateY",
  "scale",
  "calc",
  "var",
  "url",
  "rgba",
  "rgb",
]);

/** Every identifier bound anywhere in `src` — declarations, params, catch bindings. */
function boundNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g))
    names.add(m[1]);
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g))
    names.add(m[1]);
  for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    for (const param of m[1].split(",")) {
      const name = param.trim();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const param of m[1].split(",")) {
      const name = param.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of src.matchAll(/(^|[^\w$])([A-Za-z_$][\w$]*)\s*=>/g))
    names.add(m[2]);
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g))
    names.add(m[1]);
  return names;
}

/** Identifiers invoked as bare functions — excludes `obj.method(…)`. */
function calledNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g))
    names.add(m[2]);
  return names;
}

test("every helper DIFF_JS calls is defined somewhere in the assembled PAGE_JS", () => {
  const defined = new Set([...boundNames(DIFF_JS), ...boundNames(PAGE_JS)]);
  const unresolved = [...calledNames(DIFF_JS)]
    .filter(
      (name) =>
        !GLOBALS.has(name) &&
        !CSS_FUNCTIONS_IN_STRINGS.has(name) &&
        !defined.has(name),
    )
    .sort();

  assert.deepEqual(
    unresolved,
    [],
    `DIFF_JS calls ${unresolved.join(", ")}, which nothing defines. A lazily loaded ` +
      "diff body will throw at runtime and report it as a failed network request.",
  );
});

test("the diff helpers really do share the engine closure", () => {
  // The cross-reference above is only meaningful if they are one scope. They
  // used to be one scope because DIFF_JS was spliced into PAGE_JS's IIFE; they
  // are one scope now because both are declarations inside
  // `startReviewEngine()`. If the diff half is ever hoisted to module level
  // this stops being true and the xref test stops checking anything.
  assert.match(PAGE_JS, /^function startReviewEngine\(options\)\{/);
  assert.ok(
    PAGE_JS.includes("function setMode("),
    "the diff half is inside the engine closure",
  );
  assert.ok(
    PAGE_JS.includes("function onClick("),
    "so is the delegated click handler",
  );
});

test("the engine body parses as JavaScript", () => {
  // Weaker than it was — esbuild now parses this file on every build — but it
  // still costs nothing and it fails faster than a broken bundle.
  assert.doesNotThrow(
    () => new Script(`(${PAGE_JS})`, { filename: "review-engine.js" }),
  );
});
