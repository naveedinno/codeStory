// The `__CODESTORY_DATA__` payload shapes — the contract between a route
// handler and its React surface.
//
// This module carries plain JSON-serializable interfaces and nothing else. That
// is what lets `client/` import these with `import type` across the src/client
// boundary and keep ONE definition of each shape instead of two that drift.
// `import type` is erased before esbuild ever sees it, so nothing from `src/` is
// bundled into the browser.
//
// It imports types from exactly two other modules, `./types.js` and
// `./noise.js`, and only because both are themselves import-free. That matters
// more than it looks: the client typechecker runs with `types: []` and no Node
// typings, so a type-only import that transitively reaches a module with
// `import { createHash } from 'node:crypto'` (which `view-model.ts` and
// `review-state.ts` both do) fails the client build. Anything those modules own
// is therefore restated here as a narrow projection rather than re-exported.
//
// Rules for anything added here (see
// `docs/superpowers/specs/server-shell-contract.md` §1):
//   - plain JSON only. No Map, no Set, no Date — epoch milliseconds and arrays.
//   - the payload is the whole initial state; do not smuggle state into
//     `data-*` attributes on <body>.
//   - keep presentation OUT. Raw values (`path`, `lastOpened`) travel; the
//     formatting (`~/…`, "7 min ago") happens in the component.
export {};
