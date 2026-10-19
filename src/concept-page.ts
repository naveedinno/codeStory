// Assemble a v4 concept page for its sandboxed frame. The author's HTML is
// passed through untouched; the only additions are a tiny shim, placed before
// any author markup, that forwards story keys to the app and follows the app's
// theme, and a set of optional color variables authors may use or ignore.
//
// Isolation does not come from the shim. It comes from the sandbox (opaque
// origin, no navigation, no popups), which the CSP below applies however the
// page is loaded, framed or opened directly in a tab, and from the server
// refusing every request that is not same-origin.
//
// The review-page lease token rides in the frame URL, so the page can read it
// from its own location. That is acceptable only because the token is not a
// credential on its own: every route that takes it also requires a
// same-origin request, which an opaque-origin page can never make.

export type ConceptPageTheme = 'light' | 'dark';

/**
 * Sandboxed with scripts only, whether framed or opened top-level; anything
 * the author wants to load, run, or fetch; and only codeStory may frame it.
 * Served only for pages that opt in with `"network": true`.
 */
export const CONCEPT_PAGE_CSP =
  "sandbox allow-scripts; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'";

/**
 * The default: the author's inline markup, script, and style run, but every
 * network request is blocked. `default-src 'none'` covers connect, frame,
 * worker, and object sources; script and style stay inline-only; images,
 * media, and fonts may only be inline data or blobs.
 */
export const CONCEPT_PAGE_CSP_OFFLINE =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; frame-ancestors 'self'";

/** The policy for one page step: network only when the author opted in. */
export function conceptPageCsp(network?: boolean): string {
  return network === true ? CONCEPT_PAGE_CSP : CONCEPT_PAGE_CSP_OFFLINE;
}

/**
 * The only keys a page forwards to the app: they step through the story or
 * play and pause narration, and nothing else. The review engine accepts the
 * same list (CONCEPT_FRAME_KEYS), and only from the focused frame on the
 * active step. Space on a control inside the page stays with that control.
 */
export const CONCEPT_PAGE_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'j', 'k', ' '];

// Values mirror client/generated/theme.css so a page that opts in matches the app.
// The page itself never paints a background: it sits on the step, so html and
// body stay transparent. Its color-scheme must match the app's, or the browser
// paints an opaque backdrop behind the frame.
const TOKENS = `html,body{background:transparent!important}
:root{color-scheme:dark!important;--ds-surface:#14171c;--ds-text:#eef1f5;--ds-text-2:#ccd1d9;--ds-text-3:#b1b9c6;--ds-line:rgba(190,205,225,.11);--ds-accent:#49b7ff;--ds-add:#3ddc97;--ds-del:#ff6b62}
:root[data-ds-theme="light"]{color-scheme:light!important;--ds-surface:#ffffff;--ds-text:#14171c;--ds-text-2:#4f5967;--ds-text-3:#5f6976;--ds-line:rgba(20,30,45,.12);--ds-accent:#0072d6;--ds-add:#178a52;--ds-del:#d2372e}`;

function shim(theme: ConceptPageTheme): string {
  return `<style data-codestory-shim>${TOKENS}</style><script data-codestory-shim>(function(){
var root=document.documentElement;root.setAttribute('data-ds-theme',${JSON.stringify(theme)});
var keys=${JSON.stringify(CONCEPT_PAGE_KEYS)};
function typing(t){if(!t)return false;if(t.isContentEditable)return true;var n=t.tagName;return n==='INPUT'||n==='TEXTAREA'||n==='SELECT';}
function control(t){return !!(t&&t.closest&&t.closest('button,a,[role="button"],[role="link"]'));}
window.addEventListener('keydown',function(e){if(e.isComposing||keys.indexOf(e.key)<0||typing(e.target))return;if(e.key===' '&&control(e.target))return;
setTimeout(function(){if(e.defaultPrevented)return;
parent.postMessage({type:'codestory:key',key:e.key,shiftKey:e.shiftKey,altKey:e.altKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,repeat:e.repeat},'*');},0);});
window.addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;if(d&&d.type==='codestory:theme'&&(d.theme==='light'||d.theme==='dark'))root.setAttribute('data-ds-theme',d.theme);});
})();</script>`;
}

const HEAD_OPEN = /<head(?:\s[^>]*)?>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;
const HTML_OPEN = /^\s*<html(?:\s[^>]*)?>/i;

/**
 * The author's page with the shim injected first inside <head>. Without a
 * <head> (legal HTML omits it), the shim still can't land before a leading
 * doctype or <html> open tag, or the page renders in quirks mode.
 */
export function conceptPageDocument(page: string, theme: ConceptPageTheme): string {
  const injected = shim(theme);
  const head = HEAD_OPEN.exec(page);
  if (head) {
    const at = head.index + head[0].length;
    return page.slice(0, at) + injected + page.slice(at);
  }
  let at = 0;
  const doctype = DOCTYPE.exec(page);
  if (doctype) at = doctype[0].length;
  const htmlOpen = HTML_OPEN.exec(page.slice(at));
  if (htmlOpen) at += htmlOpen[0].length;
  return page.slice(0, at) + injected + page.slice(at);
}
