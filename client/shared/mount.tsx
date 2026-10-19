// Boot one React surface into the shell's `#root`.
//
// `createRoot(...).render()` replaces the container's existing children on its
// first commit, so the shell's delayed boot placeholder needs no teardown.
//
// StrictMode is deliberately NOT used. These surfaces manage real DOM state
// outside React — `inert` and `aria-hidden` on a background element, a close
// timer, focus restoration — and StrictMode's double-invoked effects make that
// choreography fire twice in development while behaving differently in the
// production bundle we actually ship. There is no dev/prod split here (esbuild
// always builds with NODE_ENV=production), so the only thing StrictMode could
// buy is a divergence from what users run.
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

export function mountSurface(tree: ReactNode, containerId = "root"): void {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`codeStory: no #${containerId} element to mount into.`);
  flushSync(() => {
    createRoot(container).render(tree);
  });
}
