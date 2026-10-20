// Shared color-theme plumbing for every browser surface. The preference lives in
// localStorage, while data-theme always contains the resolved light/dark value so
// an explicit choice can override the operating-system scheme without CSS drift.
const THEME_ICONS = {
    system: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.25"/><path d="M10 3.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"/></svg>',
    dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.9 12.4A6.7 6.7 0 0 1 7.6 4.1 6.7 6.7 0 1 0 15.9 12.4z"/></svg>',
};
export function themeControl() {
    return ('<div class="ds-theme-wrap">' +
        '<button class="ds-theme-toggle" type="button" data-theme-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Color theme: System" title="Color theme: System">' +
        `<span data-theme-icon="system">${THEME_ICONS.system}</span>` +
        `<span data-theme-icon="light" hidden>${THEME_ICONS.light}</span>` +
        `<span data-theme-icon="dark" hidden>${THEME_ICONS.dark}</span>` +
        '</button>' +
        '<div class="ds-theme-menu" data-theme-menu role="menu" aria-label="Color theme" hidden>' +
        `<button type="button" role="menuitemradio" data-theme-choice="system" aria-checked="true"><span class="ds-theme-choice-icon">${THEME_ICONS.system}</span><span>System</span><span class="ds-theme-check" aria-hidden="true">✓</span></button>` +
        `<button type="button" role="menuitemradio" data-theme-choice="light" aria-checked="false"><span class="ds-theme-choice-icon">${THEME_ICONS.light}</span><span>Light</span><span class="ds-theme-check" aria-hidden="true">✓</span></button>` +
        `<button type="button" role="menuitemradio" data-theme-choice="dark" aria-checked="false"><span class="ds-theme-choice-icon">${THEME_ICONS.dark}</span><span>Dark</span><span class="ds-theme-check" aria-hidden="true">✓</span></button>` +
        '</div></div>');
}
export function themeControlStyles() {
    return `
.ds-theme-wrap{position:relative;display:inline-flex;align-items:center;flex:none}
.ds-theme-toggle{position:relative;width:34px;height:34px;display:grid;place-items:center;padding:0;border:0;border-radius:var(--radius-pill);background:var(--nv-fill,var(--fill-2,var(--hover,var(--app-fill))));color:var(--nv-mut,var(--muted,var(--label2,var(--app-l2))));font:inherit;cursor:pointer}
.ds-theme-toggle::after{content:"";position:absolute;inset:-6px}
.ds-theme-toggle:hover,.ds-theme-toggle[aria-expanded="true"]{background:var(--nv-fill2,var(--fill-2,var(--hover,var(--app-fill))));color:var(--nv-fg,var(--text,var(--label,var(--app-label))))}
.ds-theme-toggle:focus-visible,.ds-theme-menu button:focus-visible{outline:none;box-shadow:var(--shadow-focus)}
.ds-theme-toggle>span{width:17px;height:17px;display:grid;place-items:center}.ds-theme-toggle>span[hidden]{display:none}
.ds-theme-toggle svg,.ds-theme-choice-icon svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.45;stroke-linecap:round;stroke-linejoin:round}
.ds-theme-menu{position:absolute;top:calc(100% + 7px);inset-inline-end:0;z-index:100;width:154px;padding:6px;border:1px solid var(--nv-bd-soft,var(--line-soft,var(--hairline,var(--app-hair))));border-radius:var(--radius-lg);background:var(--nv-bg,var(--panel2,var(--sheet,var(--app-elev))));box-shadow:var(--shadow);transform-origin:calc(100% - 17px) -7px}
.ds-theme-menu[hidden]{display:none}
.ds-theme-menu button{width:100%;height:36px;display:grid;grid-template-columns:18px minmax(0,1fr) 14px;align-items:center;gap:8px;padding:0 10px;border:0;border-radius:var(--radius);background:transparent;color:var(--nv-fg,var(--text,var(--label,var(--app-label))));font:inherit;font-size:12.5px;text-align:start;cursor:pointer}
.ds-theme-menu button:hover,.ds-theme-menu button:focus-visible{background:var(--nv-fill,var(--fill-2,var(--hover,var(--app-fill))))}
.ds-theme-choice-icon{width:16px;height:16px;color:var(--nv-mut,var(--muted,var(--label2,var(--app-l2))))}
.ds-theme-check{color:var(--nv-blue,var(--accent,var(--blue,var(--app-blue))));font-weight:700;opacity:0}.ds-theme-menu button[aria-checked="true"] .ds-theme-check{opacity:1}
@media (prefers-reduced-motion:no-preference){.ds-theme-menu:not([hidden]){animation:ds-anchored-pop var(--motion-duration-ui,200ms) var(--motion-ease-out,cubic-bezier(.23,1,.32,1)) backwards}.ds-theme-toggle{transition:background-color var(--motion-duration-fast,150ms) ease,color var(--motion-duration-fast,150ms) ease,transform var(--motion-duration-press,120ms) var(--motion-ease-out,cubic-bezier(.23,1,.32,1))}.ds-theme-toggle:active{transform:scale(.97)}@keyframes ds-anchored-pop{from{opacity:0;clip-path:inset(0 0 100% 72% round 10px);transform:translateY(-4px) scale(.96)}to{opacity:1;clip-path:inset(0 round 10px);transform:none}}}
@media (prefers-reduced-motion:reduce){.ds-theme-toggle,.ds-theme-menu button{transition:none}.ds-theme-toggle:active{transform:none}}
`;
}
/** Shared Thread Path atmosphere for page shells; page-local CSS only positions the layer. */
export function threadAtmosphereStyles() {
    return `
body.ds-map-bg::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:radial-gradient(var(--map-dot) 1px,transparent 1.6px);background-size:26px 26px;-webkit-mask-image:linear-gradient(180deg,#000,rgba(0,0,0,.38) 58%,transparent 94%);mask-image:linear-gradient(180deg,#000,rgba(0,0,0,.38) 58%,transparent 94%)}
.ds-thread-host{position:relative;isolation:isolate}
.ds-thread-layer{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.ds-atmosphere-thread{display:block;width:100%;height:100%}
.ds-atmosphere-thread .thread-base{fill:none;stroke:var(--thread-dim);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ds-atmosphere-thread .thread-pulse{fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.ds-atmosphere-thread .thread-nodes circle{fill:var(--text-3)}
.ds-atmosphere-thread .thread-nodes .node-mid{fill:var(--accent-hi)}
@media (prefers-reduced-motion:no-preference){.ds-atmosphere-thread .thread-base{stroke-dasharray:100;stroke-dashoffset:100;animation:ds-thread-draw 1.4s var(--motion-ease-out) .15s forwards}.ds-atmosphere-thread .thread-nodes{opacity:0;animation:ds-thread-nodes-in .5s var(--motion-ease-out) 1.2s forwards}.ds-atmosphere-thread .thread-pulse{stroke-dasharray:7 93;animation:ds-thread-pulse 11s linear 2s infinite backwards}@keyframes ds-thread-draw{to{stroke-dashoffset:0}}@keyframes ds-thread-nodes-in{to{opacity:1}}@keyframes ds-thread-pulse{0%{stroke-dashoffset:0;opacity:0}6%{opacity:.85}88%{opacity:.85}100%{stroke-dashoffset:-100;opacity:0}}}
@media (prefers-reduced-motion:reduce){.ds-atmosphere-thread .thread-pulse{display:none}.ds-atmosphere-thread .thread-nodes{opacity:.62}}
@media (max-width:480px){.ds-thread-layer[data-thread-compact="hide"]{display:none}}
`;
}
/**
 * Inline this in <head> before page CSS. It applies the saved preference before
 * first paint, then wires any theme controls after the document is ready.
 */
export function themeBootstrapScript() {
    return `<script>
(function(){
  var key='ds-theme',media=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  function readMode(){try{var value=localStorage.getItem(key);return value==='light'||value==='dark'?value:'system';}catch(e){return 'system';}}
  function resolved(mode){return mode==='system'?(media&&media.matches?'dark':'light'):mode;}
  function apply(mode){
    var value=resolved(mode),root=document.documentElement,previous=root.getAttribute('data-theme');
    var swap=document.createElement('style');swap.setAttribute('data-ds-theme-swap','');swap.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'));(document.head||root).appendChild(swap);
    root.setAttribute('data-theme',value);root.setAttribute('data-theme-mode',mode);root.style.colorScheme=value;
    void root.offsetWidth;
    var removeSwap=function(){if(swap.parentNode)swap.parentNode.removeChild(swap);};if(window.requestAnimationFrame)window.requestAnimationFrame(removeSwap);else removeSwap();
    var meta=document.querySelector('meta[data-ds-theme-color]');if(meta)meta.setAttribute('content',value==='dark'?'#0a0c0f':'#edf0f4');
    syncControls(mode);
    if(previous&&previous!==value&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('ds-theme-change',{detail:{theme:value,mode:mode}}));
  }
  function save(mode){try{if(mode==='system')localStorage.removeItem(key);else localStorage.setItem(key,mode);}catch(e){}apply(mode);}
  function syncControls(mode){
    document.querySelectorAll('[data-theme-toggle]').forEach(function(toggle){
      var label='Color theme: '+mode.charAt(0).toUpperCase()+mode.slice(1);toggle.setAttribute('aria-label',label);toggle.setAttribute('title',label);
      toggle.querySelectorAll('[data-theme-icon]').forEach(function(icon){icon.hidden=icon.getAttribute('data-theme-icon')!==mode;});
    });
    document.querySelectorAll('[data-theme-choice]').forEach(function(choice){choice.setAttribute('aria-checked',choice.getAttribute('data-theme-choice')===mode?'true':'false');});
  }
  function close(wrap,restore){var toggle=wrap.querySelector('[data-theme-toggle]'),menu=wrap.querySelector('[data-theme-menu]');if(!toggle||!menu)return;menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(restore)toggle.focus();}
  function init(){
    syncControls(readMode());
    document.querySelectorAll('.ds-theme-wrap').forEach(function(wrap){
      var toggle=wrap.querySelector('[data-theme-toggle]'),menu=wrap.querySelector('[data-theme-menu]');if(!toggle||!menu)return;
      toggle.addEventListener('click',function(){
        var opening=menu.hidden;document.querySelectorAll('.ds-theme-wrap').forEach(function(other){if(other!==wrap)close(other,false);});
        menu.hidden=!opening;toggle.setAttribute('aria-expanded',opening?'true':'false');
        if(opening){var active=menu.querySelector('[aria-checked="true"]');if(active)active.focus();}
      });
      menu.addEventListener('click',function(event){var choice=event.target.closest('[data-theme-choice]');if(!choice)return;save(choice.getAttribute('data-theme-choice'));close(wrap,true);});
      menu.addEventListener('keydown',function(event){
        if(event.key==='Escape'){event.preventDefault();close(wrap,true);return;}
        if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Home'&&event.key!=='End')return;
        event.preventDefault();var items=Array.prototype.slice.call(menu.querySelectorAll('[data-theme-choice]')),index=items.indexOf(document.activeElement);
        if(event.key==='Home')index=0;else if(event.key==='End')index=items.length-1;else index=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
        if(items[index])items[index].focus();
      });
    });
    document.addEventListener('mousedown',function(event){document.querySelectorAll('.ds-theme-wrap').forEach(function(wrap){if(!wrap.contains(event.target))close(wrap,false);});});
  }
  apply(readMode());
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  if(media){var onScheme=function(){if(readMode()==='system')apply('system');};if(media.addEventListener)media.addEventListener('change',onScheme);else if(media.addListener)media.addListener(onScheme);}
  window.addEventListener('storage',function(event){if(event.key===key)apply(readMode());});
})();
</script>`;
}
// The shared design-token layer for every browser surface. Direction "3b Signal /
// Thread-Ledger": ink surfaces, a single signal-blue accent, IBM Plex + Space
// Grotesk type. This block is the CANONICAL source of truth — page-local token
// names (--app-*, --md-*, --panel*, story-picker/picker/nav vars) alias onto
// these. Keep the aliases one-directional (name -> canonical) so no var() cycle
// forms. Dark is the no-script fallback; the head bootstrap resolves System to a
// concrete data-theme value before first paint. Fonts are self-hosted woff2
// served same-origin from /assets/fonts (satisfies the font-src 'self' CSP).
export function sharedTokens() {
    return `
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/ibm-plex-sans-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:500;font-display:swap;src:url('/assets/fonts/ibm-plex-sans-latin-500-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:600;font-display:swap;src:url('/assets/fonts/ibm-plex-sans-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:700;font-display:swap;src:url('/assets/fonts/ibm-plex-sans-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/ibm-plex-mono-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url('/assets/fonts/ibm-plex-mono-latin-500-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:600;font-display:swap;src:url('/assets/fonts/ibm-plex-mono-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:700;font-display:swap;src:url('/assets/fonts/ibm-plex-mono-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:500;font-display:swap;src:url('/assets/fonts/space-grotesk-latin-500-normal.woff2') format('woff2')}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:600;font-display:swap;src:url('/assets/fonts/space-grotesk-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:700;font-display:swap;src:url('/assets/fonts/space-grotesk-latin-700-normal.woff2') format('woff2')}
:root{color-scheme:dark;
  /* surfaces */
  --bg:#0a0c0f;--surface:#14171c;--surface-2:#181b20;--surface-3:#1e232b;
  /* text — dark secondary body and muted labels clear the APCA Lc 75 / 60
     targets on elevated surfaces without collapsing the three-step hierarchy. */
  --text:#eef1f5;--text-2:#ccd1d9;--text-3:#b1b9c6;
  /* lines + fills (cool alpha neutrals) */
  --line:rgba(190,205,225,.11);--line-soft:rgba(190,205,225,.065);
  --fill-1:rgba(190,205,225,.07);--fill-2:rgba(190,205,225,.12);--fill-3:rgba(190,205,225,.18);
  /* signal accent */
  --accent:#49b7ff;--accent-hi:#7adfff;--accent-solid-hover:#7adfff;--on-accent:#06121c;--accent-soft:rgba(73,183,255,.12);--accent-line:rgba(73,183,255,.3);
  --accent-text:#62c2ff;
  /* semantic: evidence + state */
  --add:#3ddc97;--diff-add-text:var(--add);--add-soft:rgba(61,220,151,.12);--del:#ff6b62;--diff-del-text:#ffa39d;--danger-text:var(--diff-del-text);--del-soft:rgba(255,107,98,.12);
  --amber:#ffb224;--amber-text:var(--amber);--amber-soft:rgba(255,178,36,.14);--on-amber:#241600;
  --neutral-status-text:#b8c0cc;
  /* thread + numerals */
  --numeral:var(--accent-text);--numeral-dim:#3a4250;--thread:var(--accent);--thread-dim:rgba(73,183,255,.28);
  --map-dot:rgba(190,205,225,.09);--accent-glow:rgba(73,183,255,.18);
  /* diff surfaces */
  --gutter:#12151a;--add-bg:rgba(61,220,151,.09);--del-bg:rgba(255,107,98,.09);--add-emphasis-bg:rgba(18,150,111,.2);--del-emphasis-bg:rgba(224,68,94,.2);
  /* syntax (cool dark) */
  --tk-k:#c79bff;--tk-t:#6fd2c2;--tk-f:#8fb4ff;--tk-s:#b7d59b;--tk-n:#e8a87c;--tk-c:#a6acb5;
  /* misc */
  --scrim:rgba(4,6,9,.62);--shadow:0 1px 2px rgba(0,0,0,.34),0 8px 28px rgba(0,0,0,.28);--scroll:rgba(190,205,225,.22);
  /* type: three voices, each one job */
  --font-sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-mono:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;
  --font-display:'Space Grotesk','IBM Plex Sans',sans-serif;
  --text-xs:.625rem;--text-sm:.6875rem;--text-md:.78125rem;--text-base:.8125rem;--text-lg:1rem;--text-xl:1.25rem;--text-2xl:1.625rem;--text-numeral:1.625rem;--text-numeral-lg:3.5rem;
  --tracking-kicker:.05em;--tracking-tight:-.02em;--tracking-numeral:-.03em;--leading-tight:1.25;--leading-body:1.55;
  /* spacing + radii: soft islands, tonal controls, and full-pill actions. */
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--sp-8:32px;--sp-10:40px;
  --radius-sm:8px;--radius:12px;--radius-lg:18px;--radius-island:26px;--radius-pill:999px;--rail-width:316px;--control-h:34px;--control-h-lg:40px;--hairline-w:1px;
  /* motion (carried over verbatim) */
  --motion-ease-out:cubic-bezier(0.23,1,0.32,1);--motion-ease-in-out:cubic-bezier(0.77,0,0.175,1);--motion-ease-drawer:cubic-bezier(0.32,0.72,0,1);
  --motion-duration-press:120ms;--motion-duration-fast:150ms;--motion-duration-ui:200ms;--motion-duration-progress:250ms;--motion-duration-spatial:340ms;
  /* --app-* compatibility aliases (one-directional -> canonical; resolve per-theme) */
  --app-bg:var(--bg);--app-elev:var(--surface);--app-label:var(--text);--app-l2:var(--text-2);--app-l3:var(--text-3);
  --app-hair:var(--line);--app-sep:var(--line-soft);--app-fill:var(--fill-2);--app-subbg:var(--fill-1);
  --app-blue:var(--accent);--app-blue2:var(--accent-hi);--app-add:var(--add);--app-del:var(--del);--app-addbar:var(--add);--app-delbar:var(--del)}
:root[data-theme="light"]{color-scheme:light;
  --bg:#edf0f4;--surface:#ffffff;--surface-2:#eef1f5;--surface-3:#e5eaf1;
  --text:#14171c;--text-2:#4f5967;--text-3:#5f6976;
  --line:rgba(20,30,45,.12);--line-soft:rgba(20,30,45,.065);
  --fill-1:rgba(20,30,45,.045);--fill-2:rgba(20,30,45,.075);--fill-3:rgba(20,30,45,.12);
  --accent:#0072d6;--accent-hi:#0086f0;--accent-solid-hover:#0067c2;--on-accent:#ffffff;--accent-soft:rgba(0,114,214,.1);--accent-line:rgba(0,114,214,.3);
  /* Signal blue as a FILL is fine at #0072d6 (white ink on it reads 4.8:1). As
     small INK on --bg it reads 4.20:1 — under AA — and this palette uses blue
     for exactly that: stage kickers, eyebrows, "Resume review", "In review".
     Same split as --add/--del below, so it gets the same shape of answer. */
  --accent-text:#005cae;
  /* Rails and fills keep the Signal semantic hues; the darker ink variants
     give small diff text AA contrast on header, split, and unified tints. */
  --add:#178a52;--diff-add-text:#116f43;--add-soft:rgba(23,138,82,.1);--del:#d2372e;--diff-del-text:#b52f2a;--del-soft:rgba(210,55,46,.09);
  --amber:#a96800;--amber-text:#875200;--amber-soft:rgba(199,124,0,.13);--on-amber:#ffffff;
  --neutral-status-text:#56606e;
  --numeral:var(--accent-text);--numeral-dim:#c3ccd9;--thread-dim:rgba(0,114,214,.25);--map-dot:rgba(20,40,70,.13);--accent-glow:rgba(0,114,214,.14);
  --gutter:#edf0f5;--add-bg:rgba(23,138,82,.08);--del-bg:rgba(210,55,46,.07);--add-emphasis-bg:rgba(18,150,111,.12);--del-emphasis-bg:rgba(224,68,94,.12);
  --tk-k:#8628a5;--tk-t:#096882;--tk-f:#1d4ed8;--tk-s:#256f35;--tk-n:#9a460c;--tk-c:#515c69;
  --scrim:rgba(15,22,32,.32);--shadow:0 1px 2px rgba(15,22,32,.12),0 8px 24px rgba(15,22,32,.1);--scroll:rgba(60,70,85,.25)}
@media (prefers-contrast: more){:root{--text:#ffffff;--text-2:#eef1f5;--text-3:#d3dae4;--line:rgba(190,205,225,.45);--line-soft:rgba(190,205,225,.3);--accent-text:#7adfff;--diff-add-text:#3ddc97;--amber-text:#ffb224}:root[data-theme="light"]{--text:#0a0d11;--text-2:#232c38;--text-3:#374252;--line:rgba(20,30,45,.42);--line-soft:rgba(20,30,45,.28);--accent-text:#00457c;--diff-add-text:#0a5c33;--amber-text:#5f3600}}
`;
}
