// The review page's interaction engine.
//
// This is a MOVE, not a rewrite. Every line below was the body of the single
// IIFE that `src/page-assets.ts` inlined into the review document (PAGE_JS =
// PAGE_JS_HEAD + DIFF_JS + PAGE_JS_TAIL). It is imported by the React surface
// and started once, after React's first commit, instead of on DOMContentLoaded.
//
// Why it was moved rather than reimplemented as hooks:
//
//   * The review page has 56 delegated-click branches whose ORDER is the
//     behaviour, and 20 keyboard bindings of which five compete for the arrow
//     keys in a fixed precedence. Per-component handlers get that wrong by
//     construction; `docs/superpowers/specs/review-page-inventory.md` §"At risk"
//     names it as the single most likely regression in this rewrite.
//   * Diff rows stay server-rendered HTML (diff-render.ts / highlight.ts /
//     intra-line.ts keep emitting them). Everything here reads the 30 data-*
//     attributes on that injected markup. React must not own row-level
//     rendering, so a delegated document handler is the correct shape anyway.
//   * The thirteen performance measures that keep a 300-step story usable —
//     lazy step stubs, the speech cache, single-step prefetch, deferred
//     coverage, the shared trust promise, the 90/180/1000 ms debounces, rAF
//     batching, single-instance observers, `hidden` instead of unmounting,
//     token-guarded aborts — are load-bearing and were preserved by moving the
//     code that implements them.
//
// It is plain JavaScript on purpose: it is checked by the same tests that
// checked it as a string, and re-typing 2,800 lines of dense DOM code into
// strict TypeScript would have been a rewrite with none of the review value.
// The module boundary is `startReviewEngine()` plus the two seams below.
//
// Two seams differ from the inlined original, and only two:
//
//   1. The bootstrap. `init()` used to run on DOMContentLoaded; it now runs
//      when the React tree has committed and the DOM it reads exists.
//   2. The progress panel. `new ProgressPanel(root, opts)` / `runProgress`
//      were globals defined by `src/progress-ui.ts`; they are now the React
//      surface in `client/surfaces/progress`, reached through the adapter in
//      `./progress-host.js`.

import {
  mountEnginePanel,
  runProgress,
  progressPrimaryActionClass,
  progressSecondaryActionClass,
} from './progress-host';
import { diagramErrorLine, diagramErrorSummary } from './diagram-errors';
import { createBrowserSpeech } from './browser-speech';

/**
 * Start the review page's engine against the DOM React has just committed.
 *
 * Safe to call once per page. Everything it installs (document-level click and
 * key handlers, the SSE stream, observers) lives for the lifetime of the
 * document, exactly as it did when this was an inline script.
 */
export function startReviewEngine(options){
  // The two facts the engine used to scrape out of the document: the queued
  // comments (a `<script type="application/json">` block) and each comment's
  // server-computed anchor state (an attribute on a server-rendered card).
  // Both now arrive in the payload, so the page carries one data block, not
  // three, and React never has to re-render a card the engine owns.
  var engineOptions=options||{};
  var initialCommentAnchors=engineOptions.commentAnchors||{};

  var MERMAID_ASSET_URL='/assets/mermaid.esm.min.mjs';
  var API='/api/comments';
  var CODEX_MODEL_API='/api/codex/models';
  var agentBusy=false;
  var FLAVOR={change:{label:'Fix request',ico:'!'},question:{label:'Question',ico:'?'},nit:{label:'Note',ico:'·'}};
  // Reading a code story, a new comment is most often a question about the code.
  function defaultCommentFlavor(){return document.body.getAttribute('data-story-subject')==='code'?'question':'change';}
  var FLAVOR_ICON_PATHS={
    change:'<path d="M14.8 6.2a4.2 4.2 0 0 1-5.4 5.4l-4.8 4.8a1.4 1.4 0 0 1-2-2l4.8-4.8a4.2 4.2 0 0 1 5.4-5.4l-2.3 2.3.7 2.3 2.3.7 2.3-2.3Z"/>',
    question:'<circle cx="9" cy="9" r="6.5"/><path d="M7.2 7.1a2 2 0 0 1 3.8.9c0 1.5-2 1.7-2 3"/><path d="M9 13.4h.01"/>',
    nit:'<path d="M4.5 2.8h7l3 3v9.4h-10Z"/><path d="M11.5 2.8v3h3M7 9h5M7 11.6h4"/>'
  };
  // pi-lens-ignore: ast-grep:no-inner-html-js
  function composerFlavorIcon(type){var span=el('span','ds-composer-type-icon');span.setAttribute('aria-hidden','true');span.innerHTML='<svg viewBox="0 0 18 18" focusable="false">'+(FLAVOR_ICON_PATHS[type]||FLAVOR_ICON_PATHS.nit)+'</svg>';return span;}
  var tourView,filesView,reviewView,driftDrawer,commandRoot,toastEl,selectionMenu,filmThread,filmTooltip,filmTooltipTarget=null,filmMagnifyFrame=0,filmPointerX=null,filmProgressObserver=null,selectionContext=null,selectionRects=[],selectionContextMenuPending=false,stepPanels,stepCards,total=1,active=0,visited={0:true},toastTimer,toastSequence=0,storyFocusIndex=-1,storyFocusGroup=-1,voiceFocusIndex=-1,voiceFocusGroup=-1,voiceFocusTimers=[],voiceSequenceToken=0,currentSpeechStep=-1,currentSpeechUnit=-1,currentSpeechManual=false,sidebarReturnFocus=null,commandReturnFocus=null,composerReturnFocus=null,modalStack=[],modalBackgroundSnapshots=[];
  var filePanels=[],fileItems=[],selectedFile=-1,fileSearchQuery='',fileSearchMatches=null,fileSearchRequest=0,fileSearchTimer=null,sidebarResizing=false,sidebarResizeFrame=0,sidebarResizeClientX=null,splitBody=null,splitHolder=null,splitResizeFrame=0,splitResizeClientX=null,splitGrabOffset=0,annotationFrame=0,annotationObserver=null,focusScrollTimer=0,focusScrollFrame=0,aloudIntent='off',aloudResumeDirty=false,aloudControlTimer=0,aloudActive=false,aloudPaused=false,aloudJobId='',aloudPollTimer=0,aloudPrepareTimer=0,aloudPrepareRequest=0,aloudPreparedText='',aloudRequestAbort=null,aloudRequestToken=0,aloudControlToken=0,aloudControlPending=false,aloudPhase='idle',aloudRate=1,aloudSequence=[],aloudSequenceIndex=-1,speechLoadingLabel='',aloudPollFails=0,aloudStateMessage='',aloudStartedAt=0,aloudSlowNotice=false,aloudEverStarted=false;
  var activeFileFilter='all',restoringReviewPosition=false,reviewSaveTimer=null,reviewPositionReady=false,driftRequestAbort=null,driftRequestToken=0,driftLayoutMode=compactScreen()?'unified':'split';
  var mermaidModulePromise=null,mermaidRenderId=0;
  var liveEventSource=null,liveDisconnectTimer=null,liveOriginalStoryFreshness='',liveIssues={diff:false,story:false,disconnected:false},liveGenerations={diff:0,story:0,disconnected:0},liveDismissed={diff:0,story:0,disconnected:0},storyReloadTimer=null,storyReloadToastSequence=0,storyReloadRemaining=10000,storyReloadStarted=0,storyReloadHovered=false;
  var workspaceTransition=null,workspaceFallbackTimer=0,workspaceTransitionToken=0;
  var sceneEntered={0:true},sceneAnimations=[],sceneEntranceToken=0,conceptFitFrame=0,conceptFitObserver=null;
  function $(s,r){return (r||document).querySelector(s);}
  function $all(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  function closest(n,s){return n&&n.closest?n.closest(s):null;}
  function reviewPageUrl(path){
    var url=new URL(path,location.href),token=document.body.getAttribute('data-review-page-token')||'';
    if(token)url.searchParams.set('page',token);
    return url.pathname+url.search;
  }
  function sameOriginPath(path){
    try{var url=new URL(path,location.href);return url.origin===location.origin?url.pathname+url.search+url.hash:'';}catch(e){return '';}
  }
  function openSymbolInEditor(symbol){
    var code=closest(symbol,'[data-comment-code]');
    if(!code||(code.getAttribute('data-comment-side')||'right')!=='right')return;
    var file=code.getAttribute('data-comment-file')||'';
    var line=parseInt(code.getAttribute('data-comment-line')||'0',10);
    var column=parseInt(symbol.getAttribute('data-vscode-column')||'0',10);
    if(!file||!line||!column)return;
    fetch(reviewPageUrl('/api/editor/open'),{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({file:file,line:line,column:column})
    }).then(function(r){return r.json().then(function(body){if(!r.ok)throw new Error(body.error||'Could not open the source editor.');return body;});})
      .then(function(body){toast('Opening implementation in '+(body.label||'your editor')+'…');})
      .catch(function(error){toast(error&&error.message?error.message:'Could not open the source editor.','error');});
  }
  var LIVE_BANNER_KINDS=[
    {kind:'diff',message:'Diff changed.'},
    {kind:'disconnected',message:'Live updates interrupted.'}
  ];
  function liveBannerEntry(kind){for(var i=0;i<LIVE_BANNER_KINDS.length;i++)if(LIVE_BANNER_KINDS[i].kind===kind)return LIVE_BANNER_KINDS[i];return null;}
  function livePriority(){for(var i=0;i<LIVE_BANNER_KINDS.length;i++){var kind=LIVE_BANNER_KINDS[i].kind;if(liveIssues[kind]&&liveDismissed[kind]!==liveGenerations[kind])return kind;}return '';}
  function renderLiveBanner(){
    var banner=$('[data-live-banner]');if(!banner)return;
    var entry=liveBannerEntry(livePriority());
    if(!entry){banner.hidden=true;banner.removeAttribute('data-live-kind');return;}
    var message=$('[data-live-message]',banner);banner.setAttribute('data-live-kind',entry.kind);banner.hidden=false;
    if(message)message.textContent=entry.message;
  }
  function hideStoryReloadToast(){
    var reloadToast=$('[data-story-reload-toast]'),sequence=++storyReloadToastSequence;
    if(storyReloadTimer){clearTimeout(storyReloadTimer);storyReloadTimer=null;}
    storyReloadRemaining=0;storyReloadStarted=0;storyReloadHovered=false;
    document.body.classList.remove('ds-story-reload-pending');
    if(!reloadToast)return;
    reloadToast.classList.remove('is-show');
    setTimeout(function(){if(sequence===storyReloadToastSequence)reloadToast.hidden=true;},220);
  }
  function scheduleStoryReload(){
    var reloadToast=$('[data-story-reload-toast]');if(!reloadToast||storyReloadTimer)return;
    var sequence=++storyReloadToastSequence;
    reloadToast.hidden=false;document.body.classList.add('ds-story-reload-pending');
    requestAnimationFrame(function(){if(sequence===storyReloadToastSequence)reloadToast.classList.add('is-show');});
    storyReloadRemaining=10000;
    resumeStoryReload();
  }
  function pauseStoryReload(){
    if(!storyReloadTimer)return;
    clearTimeout(storyReloadTimer);storyReloadTimer=null;
    storyReloadRemaining=Math.max(0,storyReloadRemaining-(Date.now()-storyReloadStarted));
  }
  function resumeStoryReload(){
    var reloadToast=$('[data-story-reload-toast]');
    if(!reloadToast||reloadToast.hidden||storyReloadRemaining<=0||storyReloadTimer||storyReloadHovered||reloadToast.contains(document.activeElement))return;
    var sequence=storyReloadToastSequence;storyReloadStarted=Date.now();
    storyReloadTimer=setTimeout(function(){if(sequence!==storyReloadToastSequence)return;storyReloadTimer=null;location.reload();},storyReloadRemaining);
  }
  function cancelStoryReload(){hideStoryReloadToast();toast('Automatic reload cancelled.');}
  function setLiveIssue(kind,on){
    if(liveIssues[kind]===on){renderLiveBanner();return;}
    liveIssues[kind]=on;if(on)liveGenerations[kind]++;
    if(kind==='diff'){
      document.body.setAttribute('data-live-diff-stale',on?'1':'0');
      refreshCount();
    }
    if(kind==='story'&&!document.body.hasAttribute('data-storyless')){
      var freshness=on?'stale':liveOriginalStoryFreshness||'unverified';
      document.body.setAttribute('data-story-freshness',freshness);
      var reviewButton=$('[data-review-status]');if(reviewButton)reviewButton.setAttribute('data-story-freshness',freshness);
      refreshCount();
      if(on)scheduleStoryReload();else hideStoryReloadToast();
    }
    renderLiveBanner();
  }
  function liveEventData(event){try{return JSON.parse(event.data||'{}');}catch(e){return {};}}
  function startLiveEvents(){
    var token=document.body.getAttribute('data-review-page-token')||'';if(!token||typeof EventSource==='undefined')return;
    liveOriginalStoryFreshness=document.body.getAttribute('data-story-freshness')||'unverified';
    function open(){
      if(liveEventSource&&liveEventSource.readyState!==2)return;
      var source=new EventSource(reviewPageUrl('/api/events'));liveEventSource=source;
      source.onopen=function(){
        if(liveDisconnectTimer){clearTimeout(liveDisconnectTimer);liveDisconnectTimer=null;}
        setLiveIssue('disconnected',false);refreshComments(null,true);refreshReviewState();
      };
      source.onerror=function(){
        if(liveDisconnectTimer)return;
        // The server's retry directive is 1500ms; the banner may only appear
        // once a healthy reconnect has had time to land, or it flashes on
        // every transient drop.
        liveDisconnectTimer=setTimeout(function(){liveDisconnectTimer=null;setLiveIssue('disconnected',true);},4000);
      };
      source.addEventListener('state',function(event){var data=liveEventData(event);setLiveIssue('diff',!!data.diffChanged);setLiveIssue('story',!!data.storyChanged);});
      source.addEventListener('comments-changed',function(){refreshComments(null,true);});
      source.addEventListener('review-state-changed',function(){refreshReviewState();});
      source.addEventListener('story-changed',function(){setLiveIssue('story',true);});
      source.addEventListener('story-synced',function(){setLiveIssue('story',false);});
      source.addEventListener('diff-changed',function(){setLiveIssue('diff',true);});
      source.addEventListener('diff-synced',function(){setLiveIssue('diff',false);refreshReviewState();});
    }
    open();
    // A bfcache restore revives the page with the stream we closed on the way
    // out; EventSource.close() is terminal, so reopen instead of going stale.
    window.addEventListener('pagehide',function(){if(liveEventSource)liveEventSource.close();});
    window.addEventListener('pageshow',function(e){if(e.persisted)open();});
  }
  function reviewLazyText(r){
    if(!r.ok){var err=new Error('Review evidence request failed');err.status=r.status;err.reloadRequired=r.status===409;throw err;}
    return r.text();
  }
  function reviewLazyMessage(err,fallback){
    return err&&err.reloadRequired?'The review changed while this page was open. Reload to continue safely.':fallback;
  }
  function reviewLazyAction(err,retryAttr,retryValue){
    if(err&&err.reloadRequired)return '<button type="button" class="ds-btn ds-btn-ghost" data-review-reload>Reload review</button>';
    return '<button type="button" class="ds-btn ds-btn-ghost" '+retryAttr+'="'+retryValue+'">Try again</button>';
  }
  function isTextEntryTarget(t){
    if(!t)return false;
    if(t.isContentEditable)return true;
    var tag=t.tagName||'';
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(tag))return true;
    return !!closest(t,'[contenteditable="true"]');
  }
  function isKeyboardControlTarget(t){
    if(!t)return false;
    var tag=t.tagName||'';
    if(/^(BUTTON|A)$/.test(tag))return true;
    return !!closest(t,'[role="button"],[role="link"],[role="separator"]');
  }
  function isReadAloudShortcutTarget(t){
    return !!closest(t,'[data-readaloud]');
  }
  function setLineWrap(on,persist){
    var changed=document.body.classList.contains('ds-line-wrap')!==on;
    document.body.classList.toggle('ds-line-wrap',on);
    document.body.setAttribute('data-line-wrap',on?'on':'off');
    $all('[data-line-wrap-toggle]').forEach(function(button){
      button.classList.toggle('is-active',on);
      button.setAttribute('aria-pressed',on?'true':'false');
      button.setAttribute('title',on?'Disable line wrapping':'Wrap long lines');
      button.setAttribute('aria-label','Wrap long lines');
    });
    if(persist){try{localStorage.setItem('ds-line-wrap',on?'1':'0');}catch(e){}}
    syncSplitPaneLayouts();
    if(changed)$all('.ds-callsite-scroll').forEach(function(scroll){scroll._dsCallsiteCentered=false;syncCallerWindow(closest(scroll,'.ds-step'));});
  }
  function loadLineWrap(){
    var on=false;try{on=localStorage.getItem('ds-line-wrap')==='1';}catch(e){}
    setLineWrap(on,false);
  }
  function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
  function replaceChildrenFromHtml(node,html){var parsed=new DOMParser().parseFromString(String(html||''),'text/html');node.textContent='';while(parsed.body.firstChild)node.appendChild(parsed.body.firstChild);}
  var CODE=String.fromCharCode(96),FENCE=CODE+CODE+CODE;
  function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function renderInlineMarkdown(input){
    var parts=String(input==null?'':input).split(CODE),out='';
    for(var i=0;i<parts.length;i++){
      if(i%2){out+='<code>'+escHtml(parts[i])+'</code>';continue;}
      out+=escHtml(parts[i])
        .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
        .replace(/__([^_]+)__/g,'<strong>$1</strong>')
        .replace(/(^|[^\*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
        .replace(/\n/g,'<br>');
    }
    return out;
  }
  function renderMarkdown(input){
    var lines=String(input==null?'':input).replace(/\r\n/g,'\n').trim().split('\n'),out=[],para=[];
    function flush(){if(!para.length)return;out.push('<p>'+renderInlineMarkdown(para.join('\n'))+'</p>');para=[];}
    for(var i=0;i<lines.length;i++){
      var line=lines[i],trim=line.trim();
      if(!trim){flush();continue;}
      if(trim.indexOf(FENCE)===0){
        flush();
        var code=[],lang=trim.slice(3).trim().split(/\s+/)[0]||'';
        i++;
        while(i<lines.length&&lines[i].trim()!==FENCE){code.push(lines[i]);i++;}
        out.push('<pre class="ds-md-code"'+(lang?' data-lang="'+escHtml(lang)+'"':'')+'><code>'+escHtml(code.join('\n'))+'</code></pre>');
        continue;
      }
      var q=line.match(/^>\s?(.*)$/);
      if(q){
        flush();
        var quoted=[q[1]];
        while(i+1<lines.length){var nq=lines[i+1].match(/^>\s?(.*)$/);if(!nq)break;quoted.push(nq[1]);i++;}
        out.push('<blockquote>'+renderMarkdown(quoted.join('\n'))+'</blockquote>');
        continue;
      }
      var b=line.match(/^\s*[-*]\s+(.+)$/);
      if(b){
        flush();
        var bullets=[b[1]];
        while(i+1<lines.length){var nb=lines[i+1].match(/^\s*[-*]\s+(.+)$/);if(!nb)break;bullets.push(nb[1]);i++;}
        out.push('<ul>'+bullets.map(function(item){return '<li>'+renderInlineMarkdown(item)+'</li>';}).join('')+'</ul>');
        continue;
      }
      var o=line.match(/^\s*\d+[.)]\s+(.+)$/);
      if(o){
        flush();
        var ordered=[o[1]];
        while(i+1<lines.length){var no=lines[i+1].match(/^\s*\d+[.)]\s+(.+)$/);if(!no)break;ordered.push(no[1]);i++;}
        out.push('<ol>'+ordered.map(function(item){return '<li>'+renderInlineMarkdown(item)+'</li>';}).join('')+'</ol>');
        continue;
      }
      para.push(line);
    }
    flush();
    return out.join('');
  }
  // pi-lens-ignore: ast-grep:no-inner-html-js
  function markdownBlock(cls,text){var e=el('div',cls);e.innerHTML=renderMarkdown(text);return e;}
  function mermaidThemeToken(name,fallback){
    var value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value&&value.indexOf('var(')!==0?value:fallback;
  }
  function mermaidThemeVariables(dark){
    return {
      background:mermaidThemeToken('--surface',dark?'#151a1f':'#ffffff'),
      primaryColor:mermaidThemeToken('--surface-2',dark?'#1b2128':'#f5f7f9'),
      primaryTextColor:mermaidThemeToken('--text',dark?'#f1f4f7':'#171a1f'),
      primaryBorderColor:mermaidThemeToken('--line',dark?'#36404a':'#d7dde3'),
      secondaryColor:mermaidThemeToken('--accent-soft',dark?'#12324a':'#e5f3ff'),
      secondaryTextColor:mermaidThemeToken('--text',dark?'#f1f4f7':'#171a1f'),
      secondaryBorderColor:mermaidThemeToken('--accent',dark?'#31a8ff':'#0072d6'),
      tertiaryColor:mermaidThemeToken('--surface-3',dark?'#222a32':'#edf1f4'),
      tertiaryTextColor:mermaidThemeToken('--text',dark?'#f1f4f7':'#171a1f'),
      tertiaryBorderColor:mermaidThemeToken('--line',dark?'#36404a':'#d7dde3'),
      lineColor:mermaidThemeToken('--text-3',dark?'#7f8b98':'#727d88'),
      textColor:mermaidThemeToken('--text',dark?'#f1f4f7':'#171a1f'),
      edgeLabelBackground:mermaidThemeToken('--surface',dark?'#151a1f':'#ffffff'),
      fontFamily:'IBM Plex Sans, sans-serif',
      fontSize:'14px'
    };
  }
  function mermaidModule(){
    if(mermaidModulePromise)return mermaidModulePromise;
    // Loaded from our own origin at runtime, never bundled: the CSP is
    // `script-src 'self'` so no CDN is reachable, and `sendMermaidBrowserAsset`
    // serves this path. The specifier goes through a variable so the bundler
    // treats it as an external URL rather than a module to inline — mermaid is
    // ~1 MB and only concept steps ever ask for it.
    mermaidModulePromise=import(/* @vite-ignore */ MERMAID_ASSET_URL).then(function(mod){
      var mermaid=mod.default||mod;
      var dark=document.documentElement.getAttribute('data-theme')==='dark';
      mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,suppressErrorRendering:true,maxTextSize:8000,maxEdges:120,theme:'base',look:'neo',fontFamily:'IBM Plex Sans, sans-serif',fontSize:14,themeVariables:mermaidThemeVariables(dark),flowchart:{htmlLabels:false,useMaxWidth:true,nodeSpacing:32,rankSpacing:44,wrappingWidth:180,diagramPadding:12,curve:'basis'},sequence:{useMaxWidth:true,wrap:true,mirrorActors:false,width:200,actorMargin:40,messageMargin:32,boxMargin:8,noteMargin:10,diagramMarginX:16,diagramMarginY:12,messageFontSize:14,actorFontSize:14,noteFontSize:13}});
      return mermaid;
    });
    return mermaidModulePromise;
  }
  function spaceMermaidLabelRows(root){
    // Mermaid's SVG rows default to 1.1em. IBM Plex Sans needs more room once
    // wide LR diagrams scale down to their container; 1.7em keeps a visible
    // gap without consuming the node's built-in vertical padding.
    var lineSpacing=1.7;
    Array.prototype.slice.call(root.querySelectorAll('.node text')).forEach(function(text){
      var rows=Array.prototype.slice.call(text.children||[]).filter(function(child){return child.classList&&child.classList.contains('text-outer-tspan')&&child.classList.contains('row');});
      if(rows.length<2)return;
      var positions=rows.map(function(row){return parseFloat(row.getAttribute('y'));});
      if(positions.some(function(value){return !Number.isFinite(value);}))return;
      var center=(positions[0]+positions[positions.length-1])/2;
      rows.forEach(function(row,index){
        var y=center+(index-(rows.length-1)/2)*lineSpacing;
        row.setAttribute('y',String(Math.round(y*1000)/1000)+'em');
      });
    });
  }
  function sanitizeMermaidSvg(svg){
    var parsed=new DOMParser().parseFromString(String(svg||''),'image/svg+xml');
    var root=parsed.documentElement;
    if(!root||String(root.localName||root.nodeName).toLowerCase()!=='svg'||root.namespaceURI!=='http://www.w3.org/2000/svg')throw new Error('invalid diagram SVG');
    Array.prototype.slice.call(root.querySelectorAll('script,foreignObject,iframe,object,embed,image,a')).forEach(function(node){node.remove();});
    Array.prototype.slice.call(root.querySelectorAll('style')).forEach(function(node){if(/@import|javascript:|data:|https?:/i.test(node.textContent||''))node.remove();});
    [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).forEach(function(node){
      Array.prototype.slice.call(node.attributes||[]).forEach(function(attr){
        var name=String(attr.name||'').toLowerCase(),value=String(attr.value||'');
        if(name.indexOf('on')===0){node.removeAttribute(attr.name);return;}
        if(name==='href'||name==='xlink:href'){if(value.charAt(0)!=='#')node.removeAttribute(attr.name);return;}
        if(/javascript:|data:|https?:/i.test(value)){node.removeAttribute(attr.name);return;}
        if(name==='style'&&/url\((?!\s*#)/i.test(value))node.removeAttribute(attr.name);
      });
    });
    spaceMermaidLabelRows(root);
    return new XMLSerializer().serializeToString(root);
  }
  function mermaidBaseView(svg){
    var raw=String(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
    if(raw.length===4&&raw.every(Number.isFinite)&&raw[2]>0&&raw[3]>0)return {x:raw[0],y:raw[1],width:raw[2],height:raw[3]};
    var width=parseFloat(svg.getAttribute('width')||''),height=parseFloat(svg.getAttribute('height')||'');
    if(!(width>0&&height>0)){try{var box=svg.getBBox();width=box.width;height=box.height;}catch(e){}}
    return {x:0,y:0,width:width>0?width:1,height:height>0?height:1};
  }
  function mermaidDiagramSvg(figure){var output=figure?$('[data-mermaid-output]',figure):null;return output?$('svg',output):null;}
  function classifyMermaidInlineShape(figure){
    var svg=mermaidDiagramSvg(figure);if(!figure||!svg)return;
    var base=mermaidBaseView(svg);
    figure.classList.toggle('is-portrait',base.height>base.width*1.35);
    // Landscape frames take their height from the drawing, so a wide diagram
    // is not centred in a tall empty box.
    figure.style.setProperty('--ds-diagram-aspect',String(Math.round(base.width/base.height*1000)/1000));
    figure.style.setProperty('--ds-diagram-height',Math.round(base.height)+'px');
  }
  function mermaidCanvasIsFullscreen(figure){return !!figure&&(document.fullscreenElement===figure||figure.classList.contains('is-mermaid-fullscreen'));}
  function applyMermaidView(figure){
    var view=figure&&figure._dsMermaidView,svg=mermaidDiagramSvg(figure);if(!view||!svg)return;
    svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].map(function(value){return Math.round(value*1000)/1000;}).join(' '));
    var label=$('[data-mermaid-zoom-label]',figure);if(label)label.textContent=Math.round(view.scale*100)+'%';
    $all('[data-mermaid-zoom]',figure).forEach(function(button){var direction=button.getAttribute('data-mermaid-zoom');button.disabled=direction==='out'?view.scale<=view.minScale:view.scale>=view.maxScale;});
  }
  function resetMermaidView(figure){
    var view=figure&&figure._dsMermaidView;if(!view)return;
    view.x=view.base.x;view.y=view.base.y;view.width=view.base.width;view.height=view.base.height;view.scale=1;applyMermaidView(figure);
  }
  function zoomMermaidView(figure,multiplier,clientX,clientY){
    var view=figure&&figure._dsMermaidView,svg=mermaidDiagramSvg(figure);if(!view||!svg)return;
    var nextScale=Math.max(view.minScale,Math.min(view.maxScale,view.scale*multiplier));if(Math.abs(nextScale-view.scale)<0.0001)return;
    var ratioX=.5,ratioY=.5,rect=svg.getBoundingClientRect();
    if(Number.isFinite(clientX)&&Number.isFinite(clientY)&&rect.width>0&&rect.height>0){
      var screenScale=Math.min(rect.width/view.width,rect.height/view.height),drawnWidth=view.width*screenScale,drawnHeight=view.height*screenScale;
      ratioX=Math.max(0,Math.min(1,(clientX-(rect.left+(rect.width-drawnWidth)/2))/drawnWidth));
      ratioY=Math.max(0,Math.min(1,(clientY-(rect.top+(rect.height-drawnHeight)/2))/drawnHeight));
    }
    var anchorX=view.x+view.width*ratioX,anchorY=view.y+view.height*ratioY,newWidth=view.base.width/nextScale,newHeight=view.base.height/nextScale;
    view.x=anchorX-newWidth*ratioX;view.y=anchorY-newHeight*ratioY;view.width=newWidth;view.height=newHeight;view.scale=nextScale;applyMermaidView(figure);
  }
  function syncMermaidFullscreen(){
    var nativeFigure=document.fullscreenElement&&closest(document.fullscreenElement,'[data-concept-diagram]');
    $all('[data-concept-diagram]').forEach(function(figure){
      var active=figure===nativeFigure||figure.classList.contains('is-mermaid-fullscreen'),button=$('[data-mermaid-fullscreen]',figure);
      figure.classList.toggle('is-fullscreen-active',active);
      if(button){button.setAttribute('aria-pressed',active?'true':'false');button.setAttribute('aria-label',active?'Exit diagram fullscreen':'Open diagram fullscreen');button.setAttribute('title',active?'Exit diagram fullscreen (Esc)':'Open diagram fullscreen');}
      if(!active)figure.classList.remove('is-panning');
    });
    document.body.classList.toggle('ds-mermaid-fullscreen-open',!!nativeFigure||!!$('.is-mermaid-fullscreen'));
  }
  function openMermaidFallback(figure){figure.classList.add('is-mermaid-fullscreen');syncMermaidFullscreen();}
  function setMermaidFullscreen(figure,open){
    if(!figure)return;
    if(open){
      resetMermaidView(figure);
      if(typeof figure.requestFullscreen==='function'){
        try{var request=figure.requestFullscreen();if(request&&typeof request.catch==='function')request.catch(function(){openMermaidFallback(figure);});}
        catch(e){openMermaidFallback(figure);}
      }else openMermaidFallback(figure);
      return;
    }
    figure.classList.remove('is-mermaid-fullscreen');
    if(document.fullscreenElement===figure&&typeof document.exitFullscreen==='function'){
      try{var exitRequest=document.exitFullscreen();if(exitRequest&&typeof exitRequest.catch==='function')exitRequest.catch(function(){syncMermaidFullscreen();});}
      catch(e){syncMermaidFullscreen();}
    }else syncMermaidFullscreen();
  }
  function prepareMermaidCanvas(figure){
    var output=$('[data-mermaid-output]',figure),svg=output?$('svg',output):null;if(!output||!svg)return;
    var base=mermaidBaseView(svg);
    figure._dsMermaidView={base:base,x:base.x,y:base.y,width:base.width,height:base.height,scale:1,minScale:.35,maxScale:8,pointerId:null,lastX:0,lastY:0};
    output.setAttribute('aria-description','Open fullscreen to drag the diagram, scroll to zoom, or use the arrow, plus, minus, and zero keys.');
    if(!output._dsMermaidCanvasReady){
      output._dsMermaidCanvasReady=true;
      output.addEventListener('wheel',function(e){
        if(!mermaidCanvasIsFullscreen(figure))return;
        e.preventDefault();var unit=e.deltaMode===1?16:e.deltaMode===2?Math.max(output.clientHeight,1):1,delta=Math.max(-240,Math.min(240,e.deltaY*unit));
        zoomMermaidView(figure,Math.exp(-delta*.0018),e.clientX,e.clientY);
      },{passive:false});
      output.addEventListener('pointerdown',function(e){
        var view=figure._dsMermaidView;if(!view||!mermaidCanvasIsFullscreen(figure)||e.button!==0)return;
        e.preventDefault();view.pointerId=e.pointerId;view.lastX=e.clientX;view.lastY=e.clientY;output.setPointerCapture(e.pointerId);figure.classList.add('is-panning');
      });
      output.addEventListener('pointermove',function(e){
        var view=figure._dsMermaidView;if(!view||view.pointerId!==e.pointerId)return;
        var svgNow=$('svg',output),rect=svgNow?svgNow.getBoundingClientRect():null;if(!rect)return;
        var screenScale=Math.min(rect.width/view.width,rect.height/view.height);if(!(screenScale>0))return;
        view.x-=(e.clientX-view.lastX)/screenScale;view.y-=(e.clientY-view.lastY)/screenScale;view.lastX=e.clientX;view.lastY=e.clientY;applyMermaidView(figure);
      });
      function endPan(e){var view=figure._dsMermaidView;if(!view||view.pointerId!==e.pointerId)return;view.pointerId=null;figure.classList.remove('is-panning');if(output.hasPointerCapture&&output.hasPointerCapture(e.pointerId))output.releasePointerCapture(e.pointerId);}
      output.addEventListener('pointerup',endPan);output.addEventListener('pointercancel',endPan);
      output.addEventListener('keydown',function(e){
        if(!mermaidCanvasIsFullscreen(figure))return;
        var view=figure._dsMermaidView,key=e.key;if(!view)return;
        if(key==='+'||key==='=')zoomMermaidView(figure,1.25);
        else if(key==='-')zoomMermaidView(figure,.8);
        else if(key==='0')resetMermaidView(figure);
        else if(key==='ArrowLeft')view.x-=view.width*.08;
        else if(key==='ArrowRight')view.x+=view.width*.08;
        else if(key==='ArrowUp')view.y-=view.height*.08;
        else if(key==='ArrowDown')view.y+=view.height*.08;
        else return;
        e.preventDefault();e.stopPropagation();if(/^Arrow/.test(key))applyMermaidView(figure);
      });
    }
    var fullscreen=$('[data-mermaid-fullscreen]',figure);if(fullscreen&&!fullscreen._dsMermaidBound){fullscreen._dsMermaidBound=true;fullscreen.addEventListener('click',function(){setMermaidFullscreen(figure,!mermaidCanvasIsFullscreen(figure));});}
    $all('[data-mermaid-zoom]',figure).forEach(function(button){if(button._dsMermaidBound)return;button._dsMermaidBound=true;button.addEventListener('click',function(){zoomMermaidView(figure,button.getAttribute('data-mermaid-zoom')==='in'?1.25:.8);output.focus();});});
    var reset=$('[data-mermaid-reset]',figure);if(reset&&!reset._dsMermaidBound){reset._dsMermaidBound=true;reset.addEventListener('click',function(){resetMermaidView(figure);output.focus();});}
    applyMermaidView(figure);syncMermaidFullscreen();
  }
  function diagramErrorBox(summary,failure){
    // Built with textContent, never innerHTML: both the parser's message and
    // the author's source line are untrusted text.
    var box=el('div','ds-mermaid-error');
    box.setAttribute('role','alert');
    box.appendChild(el('p','ds-mermaid-error-title','This diagram could not be drawn.'));
    box.appendChild(el('p','ds-mermaid-error-message',summary));
    if(failure){
      var line=el('p','ds-mermaid-error-line','Line '+failure.line+': ');
      line.appendChild(el('code','',failure.text));
      box.appendChild(line);
    }
    box.appendChild(el('p','ds-mermaid-error-hint','The caption and full source are preserved below.'));
    return box;
  }
  function reportDiagramFailure(figure,summary,line){
    // The story-health row (Overview) listens for this and folds runtime
    // diagram failures into its findings; the stash covers listeners that
    // attach after the render already failed.
    var panel=figure?closest(figure,'[data-step-panel]'):null;
    var detail={step:panel?panel.getAttribute('data-step-id'):'',panel:panel?parseInt(panel.getAttribute('data-step-panel')||'0',10):0,message:summary,line:line};
    try{
      window.__dsDiagramErrors=window.__dsDiagramErrors||[];
      window.__dsDiagramErrors.push(detail);
      document.dispatchEvent(new CustomEvent('ds-diagram-error',{detail: detail}));
    }catch(e){}
  }
  function renderConceptDiagrams(panel){
    if(!panel)return;
    $all('[data-concept-diagram]',panel).forEach(function(figure){
      if(figure.getAttribute('data-render-state'))return;
      figure.setAttribute('data-render-state','loading');
      var source=$('[data-mermaid-source]',figure),output=$('[data-mermaid-output]',figure),fallback=$('[data-mermaid-fallback]',figure);
      var text=source?source.textContent||'':'';
      mermaidModule().then(function(mermaid){return mermaid.render('ds-mermaid-'+(++mermaidRenderId),text);}).then(function(result){
        if(!output)return;
        // pi-lens-ignore: ast-grep:no-inner-html-js
        output.innerHTML=sanitizeMermaidSvg(result.svg);
        classifyMermaidInlineShape(figure);figure.setAttribute('data-render-state','ready');prepareMermaidCanvas(figure);
      }).catch(function(err){
        figure.setAttribute('data-render-state','error');figure.classList.add('is-error');
        var summary=diagramErrorSummary(err),failure=diagramErrorLine(err&&err.message||summary,text);
        figure.setAttribute('data-diagram-error',summary);
        if(failure)figure.setAttribute('data-diagram-line',String(failure.line));
        if(output){output.textContent='';output.appendChild(diagramErrorBox(summary,failure));}
        if(fallback)fallback.open=true;
        reportDiagramFailure(figure,summary,failure?failure.line:0);
      });
    });
  }
  document.addEventListener('ds-theme-change',function(){
    mermaidModulePromise=null;
    $all('[data-concept-diagram]').forEach(function(figure){
      figure.removeAttribute('data-render-state');figure.classList.remove('is-error','is-portrait');figure.style.removeProperty('--ds-diagram-aspect');figure.style.removeProperty('--ds-diagram-height');
      var output=$('[data-mermaid-output]',figure);if(output)output.textContent='';
    });
    renderConceptDiagrams(document.body);mountConceptPages(document.body);
  });
  function conceptPageTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}
  // A concept page may keep timers, audio, or a canvas running, so only the
  // active step's page is ever loaded. It learns the theme again on load, in
  // case the theme changed while it was still loading.
  function mountConceptPages(panel){
    var live=stepPanels&&stepPanels[active];
    $all('[data-concept-frame]',panel).forEach(function(frame){
      if(frame._dsMounted||!live||!live.contains(frame))return;frame._dsMounted=true;
      var figure=closest(frame,'[data-concept-page]');
      frame.addEventListener('load',function(){if(!frame._dsMounted)return;if(figure)figure.classList.add('is-loaded');if(frame.contentWindow)frame.contentWindow.postMessage({type:'codestory:theme',theme:conceptPageTheme()},'*');});
      frame.src=reviewPageUrl('/api/review/concept-page?index='+encodeURIComponent(frame.getAttribute('data-concept-index')||'')+'&theme='+conceptPageTheme());
    });
  }
  // Swapping in an unloaded copy tears the old page down completely; the copy
  // has no address, so it stays empty until its step is active again.
  function unloadConceptPages(keep){
    $all('[data-concept-frame]').forEach(function(frame){
      if(!frame._dsMounted||(keep&&keep.contains(frame)))return;frame._dsMounted=false;
      var figure=closest(frame,'[data-concept-page]'),blank=frame.cloneNode(false);blank.removeAttribute('src');
      if(figure&&document.fullscreenElement===figure&&document.exitFullscreen)document.exitFullscreen().catch(function(){});
      frame.replaceWith(blank);if(figure)figure.classList.remove('is-loaded');
    });
  }
  function toggleConceptPageFullscreen(button){
    var figure=closest(button,'[data-concept-page]');if(!figure)return;
    if(document.fullscreenElement===figure){if(document.exitFullscreen)document.exitFullscreen().catch(function(){});return;}
    if(figure.requestFullscreen)figure.requestFullscreen().catch(function(){});
  }
  function syncConceptPageFullscreen(){
    $all('[data-concept-page-fullscreen]').forEach(function(button){
      var figure=closest(button,'[data-concept-page]'),on=!!figure&&document.fullscreenElement===figure;if(figure)figure.classList.toggle('is-fullscreen-active',on);
      button.setAttribute('aria-pressed',on?'true':'false');button.setAttribute('aria-label',on?'Exit page fullscreen':'Open page fullscreen');button.setAttribute('title',on?'Exit page fullscreen (Esc)':'Open page fullscreen');
    });
  }
  function syncConceptPageTheme(){
    var theme=conceptPageTheme();
    $all('[data-concept-frame]').forEach(function(frame){if(frame.contentWindow)frame.contentWindow.postMessage({type:'codestory:theme',theme:theme},'*');});
  }
  // Any mounted concept page can post to this window, so a forwarded key is
  // replayed only from the focused frame on the active step, and only when it
  // moves through the story or plays and pauses narration. The page shim
  // forwards exactly this list.
  var CONCEPT_FRAME_KEYS=['ArrowLeft','ArrowRight','j','k',' '];
  function conceptFrameForMessage(e){
    var d=e.data;if(!d||d.type!=='codestory:key'||typeof d.key!=='string'||CONCEPT_FRAME_KEYS.indexOf(d.key)<0)return null;
    var panel=stepPanels&&stepPanels[active];if(!panel)return null;
    var frame=null;$all('[data-concept-frame]',panel).forEach(function(f){if(f.contentWindow===e.source)frame=f;});
    return frame&&document.activeElement===frame?frame:null;
  }
  function onConceptFrameMessage(e){
    var frame=conceptFrameForMessage(e);if(!frame)return;var d=e.data;
    onKey({key:d.key,code:d.key===' '?'Space':'',shiftKey:!!d.shiftKey,altKey:!!d.altKey,ctrlKey:!!d.ctrlKey,metaKey:!!d.metaKey,repeat:!!d.repeat,isComposing:false,target:frame,defaultPrevented:false,preventDefault:function(){},stopPropagation:function(){}});
  }
  var STORY_MODELS={
    claude:[['Best quality','opus','Use the strongest available model for the clearest story'],['Lower cost','haiku','Use a smaller model for a faster, cheaper run']],
    // Safe while the live catalog loads: use the default from the exact Codex
    // runtime codeStory will launch, never a guessed hard-coded model name.
    codex:[['Codex default','','Use the default model from your installed Codex app']]
  };

  function setSidebarCollapsed(collapsed,persist){
    document.body.classList.toggle('ds-rail-collapsed',collapsed);
    if(persist!==false){try{localStorage.setItem('ds-sidebar-collapsed',collapsed?'1':'0');}catch(e){}}
    $all('[data-sidebar-toggle]').forEach(function(b){
      b.classList.toggle('is-active',!collapsed);
      b.setAttribute('aria-expanded',collapsed?'false':'true');
      b.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');
      b.setAttribute('title',collapsed?'Expand sidebar':'Collapse sidebar');
    });
    syncSidebarOverlay(collapsed);
  }
  function compactScreen(){return !!(window.matchMedia&&window.matchMedia('(max-width:720px)').matches);}
  function prefersReducedMotion(){return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}
  function showFilmTooltip(node){
    if(!filmTooltip||!node)return;
    var label=$('.ds-filmnode-label',node),thread=closest(node,'[data-filmthread]');if(!label||!thread)return;
    filmTooltipTarget=node;filmTooltip.textContent=label.textContent||'';filmTooltip.classList.add('is-visible');
    // Measured against whatever actually positions the tooltip — inside the dock
    // that is the island, not the thread row it lives in.
    var anchor=filmTooltip.offsetParent||thread;
    var tr=anchor.getBoundingClientRect(),nr=node.getBoundingClientRect(),half=filmTooltip.offsetWidth/2,x=nr.left+nr.width/2-tr.left;
    x=Math.max(half+10,Math.min(tr.width-half-10,x));filmTooltip.style.setProperty('--ds-film-tooltip-x',x+'px');
  }
  function hideFilmTooltip(node){if(!filmTooltip||filmTooltipTarget!==node)return;filmTooltipTarget=null;filmTooltip.classList.remove('is-visible');}
  function syncFilmProgress(){
    if(!filmThread)return;
    if(active<=0){filmThread.style.setProperty('--thread-pct','0px');return;}
    var nodes=$('.ds-filmthread-nodes',filmThread),node=nodes?$('[data-thread-node="'+active+'"]',nodes):null;if(!nodes||!node)return;
    // Both rectangles share the rendered viewport coordinate space. Their
    // difference stays correct after zoom and space-between redistributes nodes.
    var nr=nodes.getBoundingClientRect(),ar=node.getBoundingClientRect(),center=ar.left-nr.left+ar.width/2;
    if(Number.isFinite(center))filmThread.style.setProperty('--thread-pct',center+'px');
  }
  function watchFilmProgress(){
    syncFilmProgress();
    if(!filmThread||typeof ResizeObserver!=='function')return;
    var nodes=$('.ds-filmthread-nodes',filmThread);if(!nodes)return;
    if(!filmProgressObserver)filmProgressObserver=new ResizeObserver(syncFilmProgress);
    filmProgressObserver.disconnect();filmProgressObserver.observe(nodes);
  }
  function onFilmPointerOver(e){var node=closest(e.target,'.ds-filmnode');if(node)showFilmTooltip(node);}
  function onFilmPointerOut(e){var node=closest(e.target,'.ds-filmnode');if(node&&!node.contains(e.relatedTarget)&&document.activeElement!==node)hideFilmTooltip(node);}
  function onFilmFocusIn(e){var node=closest(e.target,'.ds-filmnode');if(node){clearFilmMagnification();showFilmTooltip(node);}}
  function onFilmFocusOut(e){var node=closest(e.target,'.ds-filmnode');if(node&&!node.contains(e.relatedTarget))hideFilmTooltip(node);}
  function clearFilmMagnification(){
    if(filmMagnifyFrame)cancelAnimationFrame(filmMagnifyFrame);filmMagnifyFrame=0;filmPointerX=null;
    if(filmThread)$all('.ds-filmnode',filmThread).forEach(function(node){node.style.removeProperty('--ds-dock-scale');node.style.removeProperty('--ds-dock-lift');});
  }
  function renderFilmMagnification(){
    filmMagnifyFrame=0;if(!filmThread||filmPointerX===null)return;
    // Amicro's proximity dock uses the pointer as a continuous force rather than
    // a hovered/not-hovered switch. The broader falloff lets neighbouring story
    // stops bend with the selected one, while the fixed review order remains
    // purely navigational — this is magnification, never drag-to-reorder.
    $all('.ds-filmnode',filmThread).forEach(function(node){var r=node.getBoundingClientRect(),distance=Math.abs(filmPointerX-(r.left+r.width/2)),t=Math.max(0,1-distance/132),influence=t*t*(3-2*t);node.style.setProperty('--ds-dock-scale',(1+.36*influence).toFixed(3));node.style.setProperty('--ds-dock-lift',(-8*influence).toFixed(2)+'px');});
  }
  function onFilmPointerMove(e){
    var thread=closest(e.target,'[data-filmthread]');if(!thread||!closest(e.target,'.ds-filmthread-scroll')){clearFilmMagnification();return;}
    if(prefersReducedMotion()||(window.matchMedia&&window.matchMedia('(hover:none),(pointer:coarse)').matches)){clearFilmMagnification();return;}
    filmThread=thread;filmPointerX=e.clientX;if(!filmMagnifyFrame)filmMagnifyFrame=requestAnimationFrame(renderFilmMagnification);
  }
  function onFilmPointerLeave(){clearFilmMagnification();}
  function visibleWorkspaceSurface(kind){
    var selector=kind==='view'?'.ds-view:not([hidden])':kind==='file'?'.ds-filepanel:not([hidden])':kind==='step'?'.ds-step:not([hidden])':kind==='mode'?'.ds-filepanel-body>[data-diff-inner]:not([hidden]),.ds-filepanel-body>[data-split-inner]:not([hidden]),.ds-filepanel-body>[data-full-inner]:not([hidden])':'';
    return selector?$(selector):null;
  }
  function runWorkspaceFallback(kind,direction,update){
    if(workspaceFallbackTimer)clearTimeout(workspaceFallbackTimer);
    $all('.is-workspace-entering').forEach(function(node){node.classList.remove('is-workspace-entering');node.removeAttribute('data-ds-enter-direction');node.removeAttribute('data-ds-enter-kind');});
    update();
    var surface=visibleWorkspaceSurface(kind);if(!surface)return null;
    surface.setAttribute('data-ds-enter-direction',String(direction||0));surface.setAttribute('data-ds-enter-kind',kind);surface.classList.add('is-workspace-entering');
    workspaceFallbackTimer=setTimeout(function(){workspaceFallbackTimer=0;surface.classList.remove('is-workspace-entering');surface.removeAttribute('data-ds-enter-direction');surface.removeAttribute('data-ds-enter-kind');},cssMotionDuration(kind==='step'?'--motion-duration-fast':kind==='mode'?'--motion-duration-ui':'--motion-duration-spatial',kind==='step'?150:kind==='mode'?200:340)+10);
    return null;
  }
  function runWorkspaceTransition(kind,direction,update){
    if(!update)return null;
    if(prefersReducedMotion()){update();return null;}
    if(typeof document.startViewTransition!=='function')return runWorkspaceFallback(kind,direction,update);
    if(workspaceTransition&&typeof workspaceTransition.skipTransition==='function')workspaceTransition.skipTransition();
    var token=++workspaceTransitionToken,root=document.documentElement;
    root.setAttribute('data-ds-motion',kind);
    root.setAttribute('data-ds-motion-direction',String(direction||0));
    try{workspaceTransition=document.startViewTransition(update);}catch(e){
      workspaceTransition=null;root.removeAttribute('data-ds-motion');root.removeAttribute('data-ds-motion-direction');update();return null;
    }
    Promise.resolve(workspaceTransition.ready).catch(function(){});
    Promise.resolve(workspaceTransition.finished).then(function(){
      if(token!==workspaceTransitionToken)return;
      workspaceTransition=null;root.removeAttribute('data-ds-motion');root.removeAttribute('data-ds-motion-direction');
    },function(){
      if(token!==workspaceTransitionToken)return;
      workspaceTransition=null;root.removeAttribute('data-ds-motion');root.removeAttribute('data-ds-motion-direction');
    });
    return workspaceTransition;
  }
  function cssMotionDuration(name,fallback){
    var value=getComputedStyle(document.documentElement).getPropertyValue(name).trim(),amount=parseFloat(value);
    if(!isFinite(amount))return fallback;
    if(/ms$/i.test(value))return amount;
    if(/s$/i.test(value))return amount*1000;
    return fallback;
  }
  function cssMotionEasing(name,fallback){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;
  }
  function cancelSceneEntrance(){
    sceneEntranceToken++;
    sceneAnimations.forEach(function(animation){try{animation.cancel();}catch(e){}});
    sceneAnimations=[];
  }
  function conceptSceneNeedsEntrance(panel,index){
    if(!panel||panel.hasAttribute('data-step-lazy')||sceneEntered[index])return false;
    var layout=panel.getAttribute('data-scene-layout')||'';
    return layout==='concept-document'||layout==='concept-diagram';
  }
  function animateConceptScene(panel,index){
    sceneEntered[index]=true;
    if(!panel||panel.hidden||prefersReducedMotion()||typeof panel.animate!=='function')return;
    var targets=[
      $('.ds-concept-heading',panel),
      $('.ds-concept-title',panel),
      $('.ds-concept-body',panel),
      $('.ds-concept-diagram',panel)
    ].filter(Boolean);
    if(!targets.length)return;
    var token=++sceneEntranceToken,duration=cssMotionDuration('--motion-duration-ui',200),easing=cssMotionEasing('--motion-ease-out','cubic-bezier(0.23,1,0.32,1)');
    var owned=targets.map(function(target,position){
      return target.animate(
        [{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],
        {duration:duration,delay:position*40,easing:easing,fill:'both'}
      );
    });
    sceneAnimations=owned;
    Promise.all(owned.map(function(animation){return Promise.resolve(animation.finished).catch(function(){});})).then(function(){
      if(token!==sceneEntranceToken)return;
      owned.forEach(function(animation){try{animation.cancel();}catch(e){}});
      sceneAnimations=[];
    });
  }
  // Concept scenes are presentation surfaces, so fixed document-size type leaves
  // a conspicuous hole on a large stage. Grow the whole copy hierarchy together
  // only when its actual content leaves room; authored long-form primers keep the
  // normal measure and the compact stack keeps its explicit mobile sizes.
  function clearConceptTypographyFit(copy){
    if(!copy)return;
    ['--ds-concept-title-size','--ds-concept-body-size','--ds-concept-heading-size','--ds-concept-table-size','--ds-concept-caption-size','--ds-concept-pre-size'].forEach(function(name){copy.style.removeProperty(name);});
    var canvas=copy.closest('.ds-concept-document');
    if(canvas)canvas.style.removeProperty('--ds-concept-diagram-caption-size');
    copy.removeAttribute('data-concept-type-scale');
  }
  function setConceptTypographyScale(copy,layout,scale){
    var titleBase=34/16,bodyBase=layout==='concept-diagram'?14/16:15/16;
    copy.style.setProperty('--ds-concept-title-size',(titleBase*scale).toFixed(2)+'rem');
    copy.style.setProperty('--ds-concept-body-size',(bodyBase*scale).toFixed(2)+'rem');
    copy.style.setProperty('--ds-concept-heading-size',((layout==='concept-diagram'?15/16:bodyBase)*scale).toFixed(2)+'rem');
    copy.style.setProperty('--ds-concept-table-size',((layout==='concept-diagram'?13.5/16:bodyBase*.9)*scale).toFixed(2)+'rem');
    copy.style.setProperty('--ds-concept-caption-size',((layout==='concept-diagram'?11.5/16:bodyBase*(11.5/15))*scale).toFixed(2)+'rem');
    copy.style.setProperty('--ds-concept-pre-size',((layout==='concept-diagram'?12/16:bodyBase*.8)*scale).toFixed(2)+'rem');
    var canvas=copy.closest('.ds-concept-document');
    if(canvas&&layout==='concept-diagram')canvas.style.setProperty('--ds-concept-diagram-caption-size',(11.5/16*scale).toFixed(2)+'rem');
    copy.setAttribute('data-concept-type-scale',scale.toFixed(3));
  }
  function fitConceptTypography(panel){
    if(!panel||panel.hidden||panel.hasAttribute('data-step-lazy'))return;
    var layout=panel.getAttribute('data-scene-layout')||'';
    if(layout!=='concept-document'&&layout!=='concept-diagram')return;
    var copy=$('.ds-concept-copy',panel),documentCanvas=$('.ds-concept-document',panel);
    if(!copy||!documentCanvas)return;
    clearConceptTypographyFit(copy);
    if(window.innerWidth<=980||copy.getBoundingClientRect().width<360)return;
    var canvasStyle=getComputedStyle(documentCanvas);
    var availableHeight=documentCanvas.clientHeight-parseFloat(canvasStyle.paddingTop||'0')-parseFloat(canvasStyle.paddingBottom||'0');
    if(!isFinite(availableHeight)||availableHeight<420)return;
    var targetHeight=availableHeight*.92,baseHeight=copy.getBoundingClientRect().height;
    if(targetHeight-baseHeight<Math.max(40,targetHeight*.06))return;
    var low=1,high=1.47;
    for(var pass=0;pass<7;pass++){
      var scale=(low+high)/2;
      setConceptTypographyScale(copy,layout,scale);
      if(copy.getBoundingClientRect().height<=targetHeight)low=scale;else high=scale;
    }
    if(low<1.04)clearConceptTypographyFit(copy);else setConceptTypographyScale(copy,layout,low);
  }
  function scheduleConceptTypographyFit(panel){
    if(conceptFitFrame)cancelAnimationFrame(conceptFitFrame);
    conceptFitFrame=requestAnimationFrame(function(){conceptFitFrame=0;fitConceptTypography(panel||stepPanels&&stepPanels[active]);});
  }
  function watchConceptTypographyFit(panel){
    scheduleConceptTypographyFit(panel);
    if(typeof ResizeObserver!=='function')return;
    if(!conceptFitObserver)conceptFitObserver=new ResizeObserver(function(){scheduleConceptTypographyFit(stepPanels&&stepPanels[active]);});
    conceptFitObserver.disconnect();
    var canvas=panel&&$('.ds-concept-document',panel);if(canvas)conceptFitObserver.observe(canvas);
  }
  function syncSidebarOverlay(collapsed){
    var open=compactScreen()&&!collapsed&&currentView()==='files',main=$('.ds-main'),chrome=$('.ds-reviewchrome-main'),actions=$('.ds-reviewchrome-island.is-actions'),scrim=$('[data-sidebar-scrim]');
    if(main){if(open)main.setAttribute('inert','');else main.removeAttribute('inert');}
    [chrome,actions].forEach(function(island){if(!island)return;if(open)island.setAttribute('inert','');else island.removeAttribute('inert');});
    if(scrim){scrim.tabIndex=open?0:-1;scrim.setAttribute('aria-hidden',open?'false':'true');}
  }
  function openCompactSidebar(trigger){
    sidebarReturnFocus=trigger||document.activeElement;
    setSidebarCollapsed(false);
    var tab=$('.ds-tab[aria-selected="true"]');if(tab)tab.focus();
  }
  function closeCompactSidebar(restore){
    setSidebarCollapsed(true);
    var target=sidebarReturnFocus;sidebarReturnFocus=null;
    if(restore&&target&&target.focus)target.focus();
  }
  function focusActiveReview(){
    focusViewEntry(currentView());
  }
  function collapseCompactSidebar(){if(compactScreen()){closeCompactSidebar(false);focusActiveReview();}}
  function nodeElement(n){return n&&n.nodeType===1?n:(n&&n.parentElement?n.parentElement:null);}
  function codeForNode(n){var e=nodeElement(n);return e?closest(e,'[data-comment-code]'):null;}
  function clearSelectionSide(){
    document.body.classList.remove('ds-selecting-left');
    document.body.classList.remove('ds-selecting-right');
  }
  function isSecondarySelectionGesture(e){
    return !!e&&(e.button===2||(e.button===0&&e.ctrlKey));
  }
  function trackSelectionSide(e){
    if(isSecondarySelectionGesture(e)){selectionContextMenuPending=true;setTimeout(function(){selectionContextMenuPending=false;},500);return;}
    if(e.button!==0)return;
    var code=codeForNode(e.target);
    selectionContext=null;selectionRects=[];
    clearSelectionSide();
    if(!code)return;
    var side=code.getAttribute('data-comment-side')||'right';
    document.body.classList.add(side==='left'?'ds-selecting-left':'ds-selecting-right');
  }
  function releaseSelectionSide(e){
    if(isSecondarySelectionGesture(e)||(e&&e.button!==0))return;
    setTimeout(function(){
      var sel=window.getSelection&&window.getSelection();
      if(!sel||sel.rangeCount===0||sel.isCollapsed){clearSelectionSide();selectionContext=null;selectionRects=[];return;}
      cacheSelectionContext();
    },0);
  }
  function clearCollapsedSelection(){
    if(selectionContextMenuPending)return;
    var sel=window.getSelection&&window.getSelection();
    if(sel&&sel.rangeCount&&!sel.isCollapsed)return;
    selectionContext=null;selectionRects=[];
  }
  function selectedTextInCode(range,code){
    try{
      var r=document.createRange();
      r.selectNodeContents(code);
      if(code.contains(range.startContainer))r.setStart(range.startContainer,range.startOffset);
      if(code.contains(range.endContainer))r.setEnd(range.endContainer,range.endOffset);
      return r.toString();
    }catch(e){return '';}
  }
  function selectedOffsetInCode(code,text){
    var full=code&&code.textContent?code.textContent:'';
    var idx=full.indexOf(text);
    if(idx<0)return {};
    return {start:idx+1,end:idx+text.length};
  }
  function currentSelectionContext(){
    var sel=window.getSelection&&window.getSelection();
    if(!sel||sel.rangeCount===0||sel.isCollapsed)return null;
    var range=sel.getRangeAt(0);
    var startCode=codeForNode(range.startContainer),endCode=codeForNode(range.endContainer);
    var intendedSide=(startCode||endCode)?(startCode||endCode).getAttribute('data-comment-side')||'right':document.body.classList.contains('ds-selecting-left')?'left':document.body.classList.contains('ds-selecting-right')?'right':'';
    if(!intendedSide)return null;
    if(startCode&&endCode&&(endCode.getAttribute('data-comment-side')||'right')!==intendedSide)return null;
    var codes=$all('[data-comment-code]').filter(function(code){
      if((code.getAttribute('data-comment-side')||'right')!==intendedSide)return false;
      try{return range.intersectsNode(code);}catch(e){return false;}
    });
    if(!codes.length)return null;
    var file='',side='',rows=[],segments=[],targets=[];
    for(var i=0;i<codes.length;i++){
      var code=codes[i],row=closest(code,'.ds-row,.ds-urow');
      if(!row)return null;
      var s=code.getAttribute('data-comment-side')||'right';
      if(side&&s!==side)return null;
      side=s;
      var f=code.getAttribute('data-comment-file')||'';
      var line=parseInt(code.getAttribute('data-comment-line')||'0',10);
      if(!f)return null;
      if(file&&f!==file)return null;
      if(!line)return null;
      file=f;
      var piece=selectedTextInCode(range,code);
      if(piece)segments.push(piece);
      rows.push(row);
      targets.push({row:row,line:line});
    }
    var selectedText=segments.join('\n').trim();
    if(!selectedText)return null;
    var firstRow=rows[0],lastRow=rows[rows.length-1],firstTarget=targets[0],lastTarget=targets[targets.length-1];
    var startLine=firstTarget.line;
    var endLine=lastTarget.line;
    if(!startLine||!endLine)return null;
    var firstText=selectedTextInCode(range,codes[0]);
    var lastText=selectedTextInCode(range,codes[codes.length-1]);
    var firstOffset=selectedOffsetInCode(codes[0],firstText);
    var lastOffset=selectedOffsetInCode(codes[codes.length-1],lastText);
    return {
      anchorRow:lastRow,
      file:file,
      line:startLine,
      side:side,
      step:firstRow.getAttribute('data-step')||'',
      selectedText:selectedText,
      selection:{startLine:startLine,endLine:endLine,startColumn:firstOffset.start,endColumn:lastOffset.end}
    };
  }
  function focusedRowContext(){
    var row=closest(document.activeElement,'.ds-row,.ds-urow');if(!row)return null;
    var code=$('[data-comment-code]',row);if(!code)return null;
    var file=code.getAttribute('data-comment-file')||'',line=parseInt(code.getAttribute('data-comment-line')||'0',10),side=code.getAttribute('data-comment-side')||'right';
    if(!file||!line)return null;
    var selectedText=(code.textContent||'').replace(/\s+$/,'');
    return {anchorRow:row,file:file,line:line,side:side,step:row.getAttribute('data-step')||'',selectedText:selectedText,selection:{startLine:line,endLine:line,startColumn:1,endColumn:selectedText.length+1}};
  }
  function ensureSelectionMenu(){
    if(selectionMenu)return selectionMenu;
    selectionMenu=$('[data-selection-menu]')||el('div','ds-selection-menu');
    selectionMenu.setAttribute('data-selection-menu','');
    selectionMenu.setAttribute('role','menu');
    if(!selectionMenu.children.length){
      var b=el('button','','Comment selected code');
      b.setAttribute('type','button');b.setAttribute('role','menuitem');b.setAttribute('data-selection-comment','');selectionMenu.appendChild(b);
    }
    selectionMenu.hidden=true;
    if(!selectionMenu.parentNode)document.body.appendChild(selectionMenu);
    return selectionMenu;
  }
  function closeSelectionMenu(){
    if(selectionMenu)selectionMenu.hidden=true;
  }
  function cacheSelectionContext(){
    var ctx=currentSelectionContext();if(!ctx){selectionContext=null;selectionRects=[];return;}
    selectionContext=ctx;
    var sel=window.getSelection&&window.getSelection();if(!sel||!sel.rangeCount)return;
    var range=sel.getRangeAt(0),rect=range.getBoundingClientRect();
    if(!rect||(!rect.width&&!rect.height)){selectionRects=[];return;}
    selectionRects=[];var rects=range.getClientRects?range.getClientRects():[];
    for(var ri=0;ri<rects.length;ri++){var rr=rects[ri];if(rr.width||rr.height)selectionRects.push({left:rr.left,top:rr.top,right:rr.right,bottom:rr.bottom});}
    if(!selectionRects.length)selectionRects.push({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom});
  }
  function pointInSelection(x,y){
    for(var i=0;i<selectionRects.length;i++){var r=selectionRects[i];if(x>=r.left-2&&x<=r.right+2&&y>=r.top-2&&y<=r.bottom+2)return true;}
    return false;
  }
  function contextForSelectionMenu(e){
    var live=currentSelectionContext();
    if(live){
      var sel=window.getSelection&&window.getSelection();
      if(sel&&sel.rangeCount){var range=sel.getRangeAt(0),rects=range.getClientRects?range.getClientRects():[];selectionRects=[];for(var i=0;i<rects.length;i++){var r=rects[i];if(r.width||r.height)selectionRects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom});}}
      selectionContext=live;
    }
    return selectionContext&&pointInSelection(e.clientX,e.clientY)?selectionContext:null;
  }
  function openSelectionMenu(e){
    var ctx=contextForSelectionMenu(e);
    selectionContextMenuPending=false;
    if(!ctx)return;
    e.preventDefault();
    selectionContext=ctx;
    var menu=ensureSelectionMenu();
    menu.hidden=false;
    var x=e.clientX,y=e.clientY;
    var w=menu.offsetWidth||168,h=menu.offsetHeight||120;
    var vw=window.innerWidth||document.documentElement.clientWidth||0;
    var vh=window.innerHeight||document.documentElement.clientHeight||0;
    menu.style.left=Math.max(8,Math.min(x,vw-w-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,vh-h-8))+'px';
  }
  function sidebarBounds(){
    var vw=window.innerWidth||document.documentElement.clientWidth||0;
    var min=240,max=Math.min(560,Math.max(min,vw-360));
    return {min:min,max:max};
  }
  function currentSidebarWidth(){
    var layout=$('.ds-layout'),bodyStyle=document.body.style;
    var raw=(bodyStyle.getPropertyValue('--ds-rail-width')||getComputedStyle(document.body).getPropertyValue('--ds-rail-width')||(layout&&layout.style.getPropertyValue('--ds-rail-width'))||(layout&&getComputedStyle(layout).getPropertyValue('--ds-rail-width'))||'316').replace('px','');
    return parseFloat(raw)||316;
  }
  function updateSidebarHandle(width){
    var b=sidebarBounds();
    $all('[data-sidebar-resizer]').forEach(function(h){
      h.setAttribute('aria-valuemin',String(b.min));
      h.setAttribute('aria-valuemax',String(b.max));
      h.setAttribute('aria-valuenow',String(Math.round(width)));
    });
  }
  function setSidebarWidth(w,persist){
    var b=sidebarBounds(),width=Math.max(b.min,Math.min(b.max,Number(w)||316));
    document.body.style.setProperty('--ds-rail-width',width+'px');
    updateSidebarHandle(width);
    if(persist){try{localStorage.setItem('ds-sidebar-width',String(Math.round(width)));}catch(e){}}
  }

  function focusElementWithoutScroll(target){
    if(!target||!target.focus)return false;
    try{target.focus({preventScroll:true});}catch(e){target.focus();}
    return document.activeElement===target;
  }
  function focusStoryViewEntry(){
    var panel=stepPanels&&stepPanels[active],target=null;
    if(panel){
      var host=beatHost(panel);
      target=active===0?$('.ds-intro-start',panel):$('[data-story-beat][aria-pressed="true"]',host);
      if(!target)target=$('[data-story-beat]',host);
    }
    if(!target)target=$('[data-thread-node="'+active+'"]')||$('.ds-tab[aria-selected="true"]');
    focusElementWithoutScroll(target);
  }
  var DS_VIEWS=['tour','files','review'];
  function viewIndex(v){var i=DS_VIEWS.indexOf(v);return i<0?0:i;}
  function currentView(){var v=document.body.getAttribute('data-read-view');return DS_VIEWS.indexOf(v)<0?'tour':v;}
  var pendingReviewSection=false;
  function focusViewEntry(v){
    if(v==='tour'){focusStoryViewEntry();return;}
    if(v==='review'){
      // gotoReview is about to focus a specific section; do not outrun it.
      if(pendingReviewSection)return;
      var selectedReviewTab=$('.ds-reviewtab[aria-selected="true"]');
      focusElementWithoutScroll(selectedReviewTab||$('[data-view="review"]'));return;
    }
    var tab=$('[data-view="files"]');if(!focusElementWithoutScroll(tab)){var search=$('[data-file-search]');focusElementWithoutScroll(search);}
  }
  function setView(v,focusAfter){
    if(DS_VIEWS.indexOf(v)<0)v='tour';
    // Read the previous view from the attribute the last commit wrote rather than
    // from panel visibility: with three panels a mid-transition DOM read is
    // ambiguous, and the server now paints data-read-view so the first read is
    // honest too.
    var previous=currentView();
    if(compactScreen()&&v!=='files')setSidebarCollapsed(true,false);
    var update=function(){
      document.body.setAttribute('data-read-view',v);
      if(tourView)tourView.hidden=v!=='tour';
      if(filesView)filesView.hidden=v!=='files';
      if(reviewView)reviewView.hidden=v!=='review';
      if(v==='files'||v==='tour')syncSplitPaneLayouts(v==='files'?filesView:tourView);
      $all('.ds-tab').forEach(function(t){var on=t.getAttribute('data-view')===v;t.classList.toggle('is-active',on);t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});
      $all('[data-rail]').forEach(function(r){r.hidden=r.getAttribute('data-rail')!==v;});
      syncLandingSlot();
      revealResumeReview();
      // Files parks focus on its own tab, so entering it from a click would steal
      // focus back off whatever was clicked. Story and Review both have a real
      // entry point worth landing on.
      if(focusAfter||(v!=='files'&&previous!==v))setTimeout(function(){focusViewEntry(v);},0);
    };
    // Left-to-right tab order is the spatial model: tour(0) < files(1) < review(2).
    if(reviewPositionReady&&previous!==v)runWorkspaceTransition('view',viewIndex(v)>viewIndex(previous)?1:-1,update);else update();
    if(v==='files'&&selectedFile<0)selectFile(0);
    if(v==='review')loadTrustEvidence();
    watchStickyMetrics();
    if(v!=='tour'){cancelFocusScroll();setAloudIntent('off');cancelSpeech();}
    saveReviewPositionSoon();
  }

  // The header's map island shows the active story step's call map, copied from
  // the template its panel carries; Files, Review, and map-less scenes show the
  // story title instead. Keyed by step, so re-syncing the same step is free.
  function syncLandingSlot(){
    var host=$('[data-landing-host]'),fallback=$('[data-landing-fallback]');if(!host)return;
    var panel=currentView()==='tour'&&stepPanels?stepPanels[active]:null;
    var tpl=panel&&$('template[data-step-landing]',panel),key=tpl?String(active):'';
    if(host.getAttribute('data-landing-for')===key)return;
    host.setAttribute('data-landing-for',key);
    // pi-lens-ignore: ast-grep:no-inner-html-js
    host.innerHTML=tpl?tpl.innerHTML:'';
    host.hidden=!tpl;if(fallback)fallback.hidden=!!tpl;
  }
  function loadStoryStep(i,done){
    var panel=stepPanels&&stepPanels[i];if(!panel||!panel.hasAttribute('data-step-lazy')){if(done)done(true);return;}
    panel._dsStepCallbacks=panel._dsStepCallbacks||[];if(done)panel._dsStepCallbacks.push(done);
    if(panel.getAttribute('data-step-loading')==='1')return;
    panel.setAttribute('data-step-loading','1');
    // pi-lens-ignore: ast-grep:no-inner-html-js
    panel.innerHTML='<div class="ds-step-loading" role="status"><span class="ds-sk" style="width:34%"></span><span class="ds-sk" style="width:76%"></span><span class="ds-sk" style="width:58%"></span><span class="ds-step-loading-tx">Loading this review step…</span></div>';
    fetch(reviewPageUrl('/api/review/step-panel?index='+encodeURIComponent(String(i))))
      .then(reviewLazyText)
      .then(function(html){
        // pi-lens-ignore: ast-grep:no-inner-html-js
        var template=document.createElement('template');template.innerHTML=html.trim();var fresh=template.content.firstElementChild;
        if(!fresh||!fresh.classList||!fresh.classList.contains('ds-step'))throw new Error('Invalid story step');
        var callbacks=panel._dsStepCallbacks||[];fresh._dsPendingReturn=panel._dsPendingReturn;fresh._dsReadingPosition=panel._dsReadingPosition;panel.replaceWith(fresh);stepPanels=$all('.ds-step');
        mountCommentPins(fresh);adoptStepDocks();renderConceptDiagrams(fresh);mountConceptPages(fresh);setLineWrap(document.body.classList.contains('ds-line-wrap'),false);$all('.ds-filepanel,.ds-diff',fresh).forEach(updateChangeNav);
        try{var split=localStorage.getItem('ds-split');if(split)$all('.ds-filepanel,.ds-diff',fresh).forEach(function(holder){holder.style.setProperty('--ds-split',split);});}catch(e){}
        syncSplitPaneLayouts(fresh);
        if(i===active)syncLandingSlot();
        callbacks.forEach(function(callback){callback(true);});
      })
      .catch(function(err){
        var callbacks=panel._dsStepCallbacks||[];panel._dsStepCallbacks=[];
        panel.removeAttribute('data-step-loading');
        // pi-lens-ignore: ast-grep:no-inner-html-js
        panel.innerHTML='<div class="ds-step-loaderror" role="alert"><span>'+reviewLazyMessage(err,'Could not load this review step.')+'</span>'+reviewLazyAction(err,'data-retry-story-step',String(i))+'</div>';
        callbacks.forEach(function(callback){callback(false);});
      });
  }
  function activateStep(i,autoSpeak){
    if(i<0)i=0;if(i>total-1)i=total-1;var previous=active;
    if(previous!==i&&stepPanels&&stepPanels[previous]){
      $all('.ds-source-references:popover-open').forEach(function(panel){panel.hidePopover();});
      var oldPanel=stepPanels[previous],oldScroll=$('.ds-diffscroll',oldPanel);
      if(oldScroll)oldPanel._dsReadingPosition={group:storyFocusIndex===previous?storyFocusGroup:0,top:oldScroll.scrollTop,left:oldScroll.scrollLeft};
    }
    active=i;visited[i]=true;
    cancelSceneEntrance();
    var entrancePanel=stepPanels&&stepPanels[i],revealConcept=conceptSceneNeedsEntrance(entrancePanel,i);
    if(aloudIntent==='off')clearVoiceFocus();
    var update=function(){
      stepPanels.forEach(function(p,idx){p.hidden=idx!==i;});
      // The split columns can only be measured once the panel has a box; a
      // view transition runs this update after activateStep has returned.
      syncSplitPaneLayouts(stepPanels[i]);
      requestAnimationFrame(function(){if(active===i)syncCallerWindow(stepPanels[i]);});
      stepCards.forEach(function(c,idx){
        var isA=idx===i,isV=visited[idx]&&!isA;
        c.classList.toggle('is-active',isA);
        c.classList.toggle('is-visited',isV);
        // Index 0 is the Overview — leave its mark alone; real steps keep stable numbers.
        var num=$('.ds-num',c);if(num&&!c.hasAttribute('data-intro'))num.textContent=('0'+idx).slice(-2);
      });
      $all('[data-story-step-node]').forEach(function(node){node.classList.toggle('is-active',parseInt(node.getAttribute('data-story-step-node')||'-1',10)===i);});
      var activeCard=stepCards[i],chapter=activeCard?closest(activeCard,'[data-story-chapter]'):null;if(chapter)chapter.open=true;
      $all('[data-thread-node]').forEach(function(n){var k=parseInt(n.getAttribute('data-thread-node')||'-1',10);n.classList.toggle('is-active',k===i);n.classList.toggle('is-visited',!!visited[k]&&k!==i);});
      syncDockStage();
      syncLandingSlot();
      var thread=$('[data-filmthread]');
      document.body.classList.toggle('ds-overview-active',i===0);
      if(thread){
        if(i===0&&previous!==0){var introStart=$('.ds-intro-start');if(introStart)introStart.focus({preventScroll:true});}
        thread.classList.toggle('is-overview',i===0);
        if(i===0){filmTooltipTarget=null;if(filmTooltip)filmTooltip.classList.remove('is-visible');clearFilmMagnification();}
        var an=$('[data-thread-node="'+i+'"]',thread),scroll=$('.ds-filmthread-scroll',thread);
        // The fill is measured from the active node's rendered center and kept
        // live by the filmstrip observer when zoom or layout redistributes it.
        if(i>0&&an)syncFilmProgress();
        if(i>0&&an&&scroll){if(i<=1)scroll.scrollLeft=0;else{var sr=scroll.getBoundingClientRect(),ar=an.getBoundingClientRect();scroll.scrollLeft+=(ar.left+ar.width/2)-(sr.left+sr.width/2);}}}
      // A prefetched step is already loaded but still hidden while the workspace
      // transition starts. Paint only after this visibility update has landed.
      syncActiveAnnotations();
      watchConceptTypographyFit(stepPanels[i]);
    };
    if(revealConcept){
      if(workspaceTransition&&typeof workspaceTransition.skipTransition==='function')workspaceTransition.skipTransition();
      update();animateConceptScene(stepPanels[i],i);
    }
    else if(reviewPositionReady&&previous!==i)runWorkspaceTransition('step',i>previous?1:-1,update);else update();
    var steps=total-1; // real steps, with the Overview excluded
    var pt=$('#ds-progress-text');if(pt)pt.textContent=i===0?'Overview':(i+' / '+steps);
    var ratio=i===0||!steps?0:i/steps;ratio=Math.max(0,Math.min(1,ratio));
    var pf=$('#ds-progress-fill');if(pf)pf.style.transform='scaleX('+ratio+')';
    if(tourView)tourView.scrollTop=0;
    var ap=stepPanels[i];if(ap)ap.scrollTop=0;
    if(ap)renderConceptDiagrams(ap);
    unloadConceptPages(ap);if(ap)mountConceptPages(ap);
    applyResponsiveStoryMode(ap);
    syncSplitPaneLayouts(ap);
    // A hidden step has no box to measure, and a lazy one brings its own dock and
    // toolbar, so the metrics are taken (and re-observed) as the step comes up.
    watchStickyMetrics();
    prepareStepNarration(i===0?1:i);
    if(i===0)clearStoryFocus();
    var storyFocused=ap&&i>0?selectStoryFocus(i,0,true):false;
    if(ap&&!storyFocused)jumpToFirstChange($('.ds-diff',ap));
    syncCallerWindow(ap);
    if(ap&&ap._dsPendingReturn&&!ap.hasAttribute('data-step-lazy')){
      var pending=ap._dsPendingReturn;ap._dsPendingReturn=null;
      var restore=function(){
        if(active!==i)return;
        var saved=ap._dsReadingPosition,scroller=$('.ds-diffscroll',ap);
        if(saved){selectStoryFocus(i,saved.group,false);cancelFocusScroll();if(scroller){scroller.scrollTop=saved.top;scroller.scrollLeft=saved.left;}}
        else{var row=$all('[data-story-diff] [data-side="right"][data-line="'+pending.line+'"]',ap).find(function(r){return !closest(r,'[hidden]')&&r.getClientRects().length;});if(row){var group=parseInt(row.getAttribute('data-step-focus')||'0',10);selectStoryFocus(i,group,false);centerFocusRows([row],true);}}
        var selected=$('[data-story-beat].is-selected',beatHost(ap));if(selected)focusElementWithoutScroll(selected);
      };
      var afterTransition=function(){requestAnimationFrame(function(){requestAnimationFrame(restore);});};
      if(workspaceTransition&&workspaceTransition.finished)Promise.resolve(workspaceTransition.finished).then(afterTransition,afterTransition);else afterTransition();
    }
    // The autoSpeak branch is exactly the user-driven navigation path — the
    // narration engine advances the story with activateStep(i,false). Moving
    // while paused stays silent (speakStep is intent-gated) and re-points Resume
    // at the step the reviewer actually landed on.
    if(autoSpeak!==false){markResumeMoved();speakStep(i);}
    saveReviewPositionSoon();
  }
  function syncThreadRoving(i){
    $all('[data-thread-node]').forEach(function(n){
      n.tabIndex=Number(n.getAttribute('data-thread-node'))===i?0:-1;
    });
  }
  function wireThreadRoving(){
    var thread=$('[data-filmthread]');if(!thread||thread._dsRoving)return;thread._dsRoving=true;
    thread.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End');
    thread.addEventListener('keydown',function(e){
      var node=e.target&&closest(e.target,'[data-thread-node]');if(!node)return;
      if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='Home'&&e.key!=='End')return;
      e.preventDefault();e.stopPropagation();
      var nodes=$all('[data-thread-node]'),at=nodes.indexOf(node),to=at;
      if(e.key==='ArrowLeft')to=(at-1+nodes.length)%nodes.length;
      else if(e.key==='ArrowRight')to=(at+1)%nodes.length;
      else if(e.key==='Home')to=0;else to=nodes.length-1;
      if(nodes[to]){nodes[to].focus();nodes[to].click();}
    });
  }
  function mustOnlyStep(i,delta){
    // Sequential j/k walking skips skim stops in must-read-only mode.
    // Explicit jumps — rail clicks, goto links, the film thread — call setActive
    // directly and always land, so a skim stop stays one click away.
    if(!mustOnly())return i+delta;
    var j=i+delta;
    while(j>=0&&j<total&&isSkimPanel(stepPanels[j]))j+=delta;
    return j;
  }
  function setActive(i,autoSpeak){
    if(i<0)i=0;if(i>total-1)i=total-1;
    syncThreadRoving(i);
    // setActive is the user-driven entry point, so re-point Resume here rather
    // than relying on activateStep's autoSpeak branch: on a lazy step that branch
    // only runs from the load callback, which leaves a pause resuming into the
    // step the reviewer had already walked away from.
    markResumeMoved();
    var panel=stepPanels&&stepPanels[i];
    if(panel&&panel.hasAttribute('data-step-lazy')){
      activateStep(i,false);
      loadStoryStep(i,function(ok){if(ok&&active===i){activateStep(i,autoSpeak!==false);loadStoryStep(i+1);}});
      return;
    }
    activateStep(i,autoSpeak!==false);
    if(i>0)loadStoryStep(i+1);
  }
  function clearSpeechCursor(){
    currentSpeechStep=-1;currentSpeechUnit=-1;currentSpeechManual=false;
  }

  function clearVoiceFocus(){
    cancelFocusScroll();
    voiceFocusTimers.forEach(function(t){clearTimeout(t);});
    voiceFocusTimers=[];
    voiceFocusIndex=-1;
    voiceFocusGroup=-1;
    $all('.ds-step.is-voice-active').forEach(function(p){p.classList.remove('is-voice-active');});
    $all('.ds-row.is-voice-focus,.ds-urow.is-voice-focus').forEach(function(r){r.classList.remove('is-voice-focus');});
    clearActiveBeats();
  }
  function clearActiveBeats(){
    $all('.ds-beat.is-active,.ds-railbeat.is-active').forEach(function(b){b.classList.remove('is-active');});
  }
  // ---- The bottom island owns the beats ----
  // A step still renders its own dock (that is what the lazy step endpoint hands
  // back), but the dock is adopted into the island's stage so the reviewer reads
  // one bar instead of two. Everything that used to scope a beat query to the step
  // panel now goes through beatHost, and everything that walked back up to the
  // panel from a beat goes through beatPanel — the two are no longer the same tree.
  function beatHost(panel){
    if(!panel||!panel.getAttribute)return panel||null;
    var index=panel.getAttribute('data-step-panel');
    if(index==null)return panel;
    return $('[data-beat-dock][data-dock-step="'+index+'"]')||panel;
  }
  function beatPanel(node){
    var dock=closest(node,'[data-beat-dock]');
    if(dock){
      var owner=$('.ds-step[data-step-panel="'+dock.getAttribute('data-dock-step')+'"]');
      if(owner)return owner;
    }
    return closest(node,'.ds-step');
  }
  function adoptStepDocks(){
    var stage=$('[data-dock-slot]');if(!stage)return;
    $all('.ds-step [data-beat-dock]').forEach(function(dock){stage.appendChild(dock);});
    syncDockStage();
  }
  // With no dock for this step — the Overview, a concept step — the stage names the
  // step instead of collapsing, so the island keeps one steady height as you walk.
  function syncDockStage(){
    var stage=$('[data-dock-slot]');if(!stage)return;
    var mounted=null;
    $all('[data-beat-dock]',stage).forEach(function(dock){
      var on=parseInt(dock.getAttribute('data-dock-step')||'-1',10)===active;
      dock.hidden=!on;if(on)mounted=dock;
    });
    var idle=$('[data-dock-idle]',stage);if(!idle)return;
    idle.hidden=!!mounted;
    if(mounted)return;
    var label=$('[data-thread-node="'+active+'"] .ds-filmnode-label');
    idle.textContent=label?(label.textContent||'').trim():'Overview';
  }
  function focusGroupsForPanel(panel){
    var seen={};
    $all('[data-step-focus]',panel).forEach(function(r){
      var n=parseInt(r.getAttribute('data-step-focus')||'0',10);
      if(!isNaN(n))seen[n]=true;
    });
    return Object.keys(seen).map(function(k){return parseInt(k,10);}).sort(function(a,b){return a-b;});
  }
  function focusRowsForGroup(panel,group){
    var groups=focusGroupsForPanel(panel);
    if(!groups.length)return [];
    var g=groups.indexOf(group)>=0?group:groups[0];
    return $all('[data-step-focus="'+g+'"]',panel);
  }
  function updateBeatNav(panel,selected){
    var host=beatHost(panel);
    var beats=$all('[data-story-beat]',host),current=$('[data-beat-current]',host),prev=$('[data-beat-move="-1"]',host),next=$('[data-beat-move="1"]',host);
    var index=beats.findIndex(function(beat){return parseInt(beat.getAttribute('data-focus-group')||'-1',10)===selected;});if(index<0)index=0;
    var panelIndex=parseInt(panel.getAttribute('data-step-panel')||'-1',10);
    if(current)current.textContent=String(index+1).padStart(2,'0');if(prev)prev.disabled=index<=0&&panelIndex<=1;if(next)next.disabled=index>=beats.length-1&&panelIndex>=total-1;
    var railCurrent=$('[data-story-step-node="'+panelIndex+'"] [data-rail-current]');
    if(railCurrent)railCurrent.textContent=(index+1)+' / '+beats.length;
  }
  function cancelFocusScroll(){
    if(focusScrollTimer)clearTimeout(focusScrollTimer);
    if(focusScrollFrame)cancelAnimationFrame(focusScrollFrame);
    focusScrollTimer=0;focusScrollFrame=0;
    document.documentElement.removeAttribute('data-story-scroll-pending');
  }
  function centerFocusRows(rows,instant){
    cancelFocusScroll();
    if(!rows.length)return;
    var rendered=rows.filter(function(row){return !closest(row,'[hidden]')&&row.getClientRects().length>0;});
    var candidates=rendered.length?rendered:rows,target=candidates[Math.floor((candidates.length-1)/2)];if(!target)return;
    document.documentElement.setAttribute('data-story-scroll-pending','1');
    focusScrollTimer=setTimeout(function(){
      focusScrollTimer=0;
      focusScrollFrame=requestAnimationFrame(function(){
        focusScrollFrame=0;
        document.documentElement.removeAttribute('data-story-scroll-pending');
        if(!document.documentElement.contains(target))return;
        var scroller=closest(target,'.ds-diffscroll');if(!scroller||!document.documentElement.contains(scroller))return;
        var sr=scroller.getBoundingClientRect(),tr=target.getBoundingClientRect(),ft=flowRowTop(target);
        var top=ft?ft.top-(scroller.clientHeight-ft.h)/2:scroller.scrollTop+(tr.top-sr.top)-(scroller.clientHeight-tr.height)/2;
        try{scroller.scrollTo({top:Math.max(0,top),behavior:instant||prefersReducedMotion()?'auto':'smooth'});}
        catch(e){scroller.scrollTop=Math.max(0,top);}
      });
    },instant?0:120);
  }
  function clearStoryFocus(){
    cancelFocusScroll();
    storyFocusIndex=-1;storyFocusGroup=-1;
    $all('.ds-step.is-story-active').forEach(function(p){p.classList.remove('is-story-active');});
    $all('.ds-row.is-story-focus,.ds-urow.is-story-focus').forEach(function(r){r.classList.remove('is-story-focus');});
    $all('.ds-beat.is-selected').forEach(function(b){b.classList.remove('is-selected');b.setAttribute('aria-pressed','false');});
    $all('.ds-railbeat.is-selected').forEach(function(b){b.classList.remove('is-selected');b.classList.add('is-visited');b.setAttribute('aria-pressed','false');});
  }
  function announceStoryFocus(panel,beat){
    if(!panel||!beat)return;
    var status=$('[data-story-focus-status]',beatHost(panel));if(!status)return;
    var destination=beat.getAttribute('data-focus-destination')||'';
    var label=beat.getAttribute('data-focus-group')||'0';
    status.textContent='';
    setTimeout(function(){status.textContent='Story beat '+(parseInt(label,10)+1)+' focused at '+destination;},0);
  }
  // fromVoice suppresses the live-region announcement only: the narration is
  // already saying this beat out loud, so announcing it again talks over itself.
  function selectStoryFocus(stepIndex,group,shouldScroll,fromVoice){
    var panel=stepPanels&&stepPanels[stepIndex];
    if(!panel||!panel.hasAttribute('data-story-focus'))return false;
    var groups=focusGroupsForPanel(panel);if(!groups.length)return false;
    var selected=groups.indexOf(group)>=0?group:groups[0],rows=focusRowsForGroup(panel,selected);if(!rows.length)return false;
    clearStoryFocus();
    storyFocusIndex=stepIndex;storyFocusGroup=selected;panel.classList.add('is-story-active');
    rows.forEach(function(r){r.classList.add('is-story-focus');});
    var beat=$('[data-story-beat][data-focus-group="'+selected+'"]',beatHost(panel));
    if(beat){beat.classList.add('is-selected');beat.setAttribute('aria-pressed','true');if(!fromVoice)announceStoryFocus(panel,beat);}
    var railBeat=$('[data-rail-beat][data-rail-step-index="'+stepIndex+'"][data-focus-group="'+selected+'"]');
    if(railBeat){railBeat.classList.add('is-selected');railBeat.setAttribute('aria-pressed','true');}
    updateBeatNav(panel,selected);
    if(shouldScroll!==false)centerFocusRows(rows,false);
    return true;
  }
  function focusStoryStepBoundary(stepIndex,atEnd){
    var initial=stepPanels&&stepPanels[stepIndex],wasLazy=initial&&initial.hasAttribute('data-step-lazy');
    var finish=function(ok){
      if(!ok||active!==stepIndex)return;
      var panel=stepPanels&&stepPanels[stepIndex],beats=panel?$all('[data-story-beat]',beatHost(panel)):[];
      if(!beats.length){
        var boundaryTarget=panel?$('.ds-intro-start',panel)||$('[data-goto-step]:not(.ds-landing-node)',panel):null;
        if(!boundaryTarget)boundaryTarget=$('[data-thread-node="'+stepIndex+'"]');
        var conceptScroll=panel&&$('.ds-concept-scroll',panel);
        if(conceptScroll)conceptScroll.scrollTop=atEnd?conceptScroll.scrollHeight:0;
        if(atEnd&&boundaryTarget&&boundaryTarget.focus)boundaryTarget.focus();else focusElementWithoutScroll(boundaryTarget);
        return;
      }
      var target=beats[atEnd?beats.length-1:0],group=parseInt(target.getAttribute('data-focus-group')||'0',10);
      selectStoryFocus(stepIndex,group,true);focusElementWithoutScroll(target);
    };
    var finishAfterActivation=function(ok){
      if(!ok)return;
      var focus=function(){requestAnimationFrame(function(){finish(true);});};
      if(workspaceTransition&&workspaceTransition.finished)Promise.resolve(workspaceTransition.finished).then(focus,focus);else focus();
    };
    setActive(stepIndex,false);
    if(wasLazy)loadStoryStep(stepIndex,finishAfterActivation);else finishAfterActivation(true);
  }
  function moveStoryBeat(button,delta){
    var panel=beatPanel(button);if(!panel)return false;
    var beats=$all('[data-story-beat]',beatHost(panel)),index=beats.indexOf(button);if(index<0||!beats.length)return false;
    var stepIndex=parseInt(panel.getAttribute('data-step-panel')||'0',10);
    if(delta>0&&index===beats.length-1&&stepIndex<total-1){focusStoryStepBoundary(mustOnlyStep(stepIndex,1),false);return true;}
    if(delta<0&&index===0&&stepIndex>1){focusStoryStepBoundary(mustOnlyStep(stepIndex,-1),true);return true;}
    var next=Math.max(0,Math.min(beats.length-1,index+delta)),target=beats[next];
    var group=parseInt(target.getAttribute('data-focus-group')||'0',10);
    selectStoryFocus(stepIndex,group,true);target.focus();return true;
  }
  function movePanelBeat(panel,delta){
    if(!panel)return false;var host=beatHost(panel),selected=$('[data-story-beat].is-selected',host)||$('[data-story-beat]',host);if(!selected)return false;
    return moveStoryBeat(selected,delta);
  }
  function moveRailBeat(button,delta){
    if(!button)return false;var stepIndex=parseInt(button.getAttribute('data-rail-step-index')||'-1',10),beats=$all('[data-rail-beat][data-rail-step-index="'+stepIndex+'"]'),index=beats.indexOf(button);if(index<0||!beats.length)return false;
    var next=Math.max(0,Math.min(beats.length-1,index+delta)),target=beats[next],group=parseInt(target.getAttribute('data-focus-group')||'0',10);
    selectStoryFocus(stepIndex,group,true);target.focus();return true;
  }
  function applyResponsiveStoryMode(panel){
    if(!panel||!compactScreen())return;
    var holder=$('[data-story-diff]',panel);if(!holder||holder.hasAttribute('data-mode-user-set'))return;
    var unified=$('.ds-modetoggle button[data-mode="diff"]',holder);
    if(unified&&!unified.classList.contains('is-active')){
      setMode(unified,{persist:false});
      var panelIndex=parseInt(panel.getAttribute('data-step-panel')||'-1',10);
      if(storyFocusIndex===panelIndex)selectStoryFocus(panelIndex,storyFocusGroup,true);
    }
  }
  function syncCallerWindow(panel){
    if(!panel)return;
    var scroll=$('.ds-callsite-scroll',panel),anchor=$('[data-callsite-anchor]',panel);
    if(scroll&&anchor&&!scroll._dsCallsiteCentered&&anchor.getClientRects().length){
      var sr=scroll.getBoundingClientRect(),ar=anchor.getBoundingClientRect();
      scroll.scrollTop=Math.max(0,scroll.scrollTop+ar.top-sr.top-(scroll.clientHeight-ar.height)/2);scroll._dsCallsiteCentered=true;
    }
  }
  function toggleCaller(button){
    var pair=closest(button,'[data-code-pair]');if(!pair)return;
    var hide=button.getAttribute('aria-expanded')==='true',pane=$('.ds-callsite-pane',pair),divider=$('[data-callsite-divider]',pair);
    pair.classList.toggle('is-caller-hidden',hide);if(pane)pane.hidden=hide;if(divider)divider.hidden=hide;
    button.setAttribute('aria-expanded',String(!hide));button.textContent=hide?'Show caller':'Hide caller';
    syncCallerWindow(closest(pair,'.ds-step'));syncSplitPaneLayouts(pair);updateStickyMetrics();
  }
  function returnToCaller(button){
    var index=Number(button.getAttribute('data-callsite-return')),panel=stepPanels&&stepPanels[index];if(!panel)return;
    var wasNarrating=aloudIntent!=='off';cancelSpeech();setAloudIntent(wasNarrating?'paused':'off');updateReadAloudButton();
    panel._dsPendingReturn={line:Number(button.getAttribute('data-callsite-line'))};setActive(index,false);
  }
  function setCallerWidth(divider,value){
    var pair=closest(divider,'[data-code-pair]');if(!pair)return;
    value=Math.max(25,Math.min(65,value));pair.style.setProperty('--ds-caller-width',String(value));divider.setAttribute('aria-valuenow',String(Math.round(value)));
    var scroll=$('.ds-callsite-scroll',pair);if(scroll)scroll._dsCallsiteCentered=false;syncCallerWindow(closest(pair,'.ds-step'));
    syncSplitPaneLayouts(pair);updateStickyMetrics();
  }
  function callerDividerKey(e){
    var divider=closest(e.target,'[data-callsite-divider]');if(!divider)return;
    var value=Number(divider.getAttribute('aria-valuenow')||40),delta=e.shiftKey?10:4;
    if(e.key==='ArrowLeft')value-=delta;else if(e.key==='ArrowRight')value+=delta;else if(e.key==='Home')value=25;else if(e.key==='End')value=65;else return;
    e.preventDefault();e.stopPropagation();setCallerWidth(divider,value);
  }
  function startCallerResize(e){
    var divider=closest(e.target,'[data-callsite-divider]');if(!divider||e.button!==0)return;
    var body=closest(divider,'.ds-code-pair-body');if(!body)return;
    e.preventDefault();divider.setPointerCapture(e.pointerId);document.body.classList.add('ds-resizing');
    var move=function(event){var r=body.getBoundingClientRect();if(r.width>10)setCallerWidth(divider,(event.clientX-r.left-5)/(r.width-10)*100);};
    var end=function(){document.body.classList.remove('ds-resizing');divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);divider.removeEventListener('lostpointercapture',end);};
    divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);divider.addEventListener('lostpointercapture',end);
  }
  function estimatedSpeechDurationMs(text){
    var words=(text||'').split(/\s+/).filter(Boolean).length;
    return Math.max(2400,Math.round(words/Math.max(80,155*aloudRate)*60000));
  }
  function activeVoiceFocusRows(panel,group){
    var focused=focusRowsForGroup(panel,group);if(focused.length)return focused;
    var rows=$all('.ds-row-add,.ds-row-del,.ds-row-pair',panel);
    return rows.length?rows:$all('.ds-row',panel);
  }
  function applyVoiceFocusGroup(stepIndex,group){
    if(stepIndex==null||stepIndex<0)return;
    var panel=stepPanels&&stepPanels[stepIndex];if(!panel)return;
    if(voiceFocusIndex===stepIndex&&voiceFocusGroup>group)return;
    $all('.ds-row.is-voice-focus,.ds-urow.is-voice-focus',panel).forEach(function(r){r.classList.remove('is-voice-focus');});
    voiceFocusIndex=stepIndex;
    voiceFocusGroup=group;
    panel.classList.add('is-voice-active');
    // The dock is the reviewer's "which beat is this" readout, so the voice has
    // to carry it along: marking the beat active only recolored it, which left
    // the counter and the shown note parked on beat one for the whole step.
    // Ahead of centerFocusRows because selectStoryFocus cancels pending scrolls.
    selectStoryFocus(stepIndex,group,false,true);
    var focusRows=activeVoiceFocusRows(panel,group);
    focusRows.forEach(function(r){r.classList.add('is-voice-focus');});
    centerFocusRows(focusRows,false);
  }
  function setVoiceFocus(stepIndex,focusGroup){
    clearVoiceFocus();
    applyVoiceFocusGroup(stepIndex,focusGroup||0);
  }
  function setActiveBeat(stepIndex,group){
    setVoiceFocus(stepIndex,group==null?0:group);
    var panel=stepPanels&&stepPanels[stepIndex];if(!panel)return;
    var beat=group==null?null:$('[data-story-beat][data-focus-group="'+group+'"]',beatHost(panel));
    if(beat)beat.classList.add('is-active');
    var railBeat=group==null?null:$('[data-rail-beat][data-rail-step-index="'+stepIndex+'"][data-focus-group="'+group+'"]');
    if(railBeat)railBeat.classList.add('is-active');
  }
  function startVoiceFocusSequence(stepIndex,text){
    clearVoiceFocus();
    if(stepIndex==null||stepIndex<0)return;
    var panel=stepPanels&&stepPanels[stepIndex];if(!panel)return;
    var count=Math.max(1,focusGroupsForPanel(panel).length);
    applyVoiceFocusGroup(stepIndex,0);
    if(count<=1)return;
    var each=Math.max(900,estimatedSpeechDurationMs(text)/count);
    for(var i=1;i<count;i++){
      (function(group){
        voiceFocusTimers.push(setTimeout(function(){applyVoiceFocusGroup(stepIndex,group);},Math.round(each*group)));
      })(i);
    }
  }

  // The reviewer's intent — 'off', 'playing' or 'paused' — and the only thing
  // that decides whether moving through the story narrates. Deliberately never
  // written by the status poll: aloudActive and aloudPaused mirror what the
  // daemon last reported, which is an observation, and it arrives late and
  // sometimes stale. Conflating the two is why pause never held. A pause used to
  // leave "narrate as I navigate" armed, so clicking any step, pressing j/k or
  // pressing an arrow key started a brand new job talking over the pause.
  function narrationPlaying(){return aloudIntent==='playing';}
  function setAloudIntent(next){
    aloudIntent=next;
    if(next!=='paused')aloudResumeDirty=false;
  }
  // Moving the reading cursor while paused must stay silent, but it also
  // invalidates the daemon's paused job — it is parked somewhere the reviewer
  // has left. Remember that, so Resume speaks from where they actually are
  // instead of resuming a job pointing at the step they walked away from.
  function markResumeMoved(){
    if(aloudIntent==='paused')aloudResumeDirty=true;
  }
  function cancelSpeech(stopPlayback){
    cancelFocusScroll();
    voiceSequenceToken++;
    clearSpeechCursor();
    aloudRequestToken++;
    aloudControlToken++;aloudControlPending=false;
    if(aloudControlTimer){clearTimeout(aloudControlTimer);aloudControlTimer=0;}
    if(aloudPollTimer){clearTimeout(aloudPollTimer);aloudPollTimer=0;}
    if(aloudRequestAbort){try{aloudRequestAbort.abort();}catch(e){}}
    aloudRequestAbort=null;
    // speechLoadingLabel belongs in this guard: aborting our own fetch does not
    // un-send the POST, and the daemon starts the job whether or not we are still
    // listening. Without it, giving up mid-start left the speech engine reading a story the
    // page had already forgotten, with every control hidden or idle.
    if(stopPlayback!==false&&(aloudActive||aloudJobId||speechLoadingLabel))aloudControl('stop',true);
    aloudActive=false;aloudPaused=false;aloudResumeDirty=false;aloudJobId='';aloudPhase='idle';aloudSequence=[];aloudSequenceIndex=-1;speechLoadingLabel='';
    clearVoiceFocus();
    var btn=$('[data-readaloud]');if(btn)btn.classList.remove('is-speaking');
    updateReadAloudButton();
  }
  // Narration is full of identifiers, and a phonemizer handed MAX_DAEMON_TEXT or
  // aloud-client.ts has no good options: it either spells letters out or slurs the
  // whole token. Splitting them into ordinary words first is what makes a beat
  // about code sound like a sentence instead of a stumble. Kept idempotent, since
  // stepSpeechUnits cleans a beat and splitSpeechUnit cleans it again.
  function speechClean(text){
    return (text||'')
      .replace(/→/g,' to ')
      .replace(/↵/g,' return ')
      // Our own name is one word. The camelCase rule below would otherwise read it
      // as "code Story" every time a beat mentions the tool, which is most of them;
      // lowering the inner capital removes the boundary without a placeholder.
      .replace(/\bcodeStory\b/g,'codestory')
      .replace(/\bfn\b/g,'function')
      .replace(/\(\)/g,' function ')
      // Operators, before punctuation stripping removes the characters they use.
      .replace(/!==|!=/g,' is not equal to ')
      .replace(/===|==/g,' equals ')
      .replace(/=>/g,' arrow ')
      .replace(/->/g,' to ')
      .replace(/&&/g,' and ')
      .replace(/\|\|/g,' or ')
      .replace(/>=/g,' at least ')
      .replace(/<=/g,' at most ')
      // A dotted file name reads as a word plus its extension, not as a decimal.
      .replace(/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|sh|yml|yaml)\b/gi,' dot $1 ')
      // Paths: say the separator rather than running the segments together.
      .replace(/([A-Za-z0-9_)\]])\/([A-Za-z0-9_.])/g,'$1 slash $2')
      .replace(/::/g,' colon colon ')
      // A digit separator is not a word break: 120_000 has to stay one number,
      // or it reads as "one hundred twenty" followed by "zero".
      .replace(/([0-9])_([0-9])/g,'$1$2')
      // snake_case identifiers become separate words.
      .replace(/([A-Za-z0-9])_([A-Za-z0-9])/g,'$1 $2')
      // camelCase and PascalCase boundaries, including runs like HTTPServer.
      .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
      // The acronym boundary needs two lowercase letters to follow, or a plural
      // acronym splits at its own last letter: APIs became "AP Is", IDs became
      // "I Ds". Requiring a real word after the capital keeps HTTPServer working
      // while leaving pluralised acronyms alone.
      .replace(/([A-Z]+)([A-Z][a-z]{2,})/g,'$1 $2')
      // Braces only. Semicolons used to be stripped alongside them, which read two
      // independent clauses as one breathless run-on ("the full modern gate legacy
      // repairs still validate..."). espeak-ng already treats a semicolon as a
      // clause pause, so deleting it threw away phrasing the narrator wanted.
      .replace(/[{}]+/g,' ')
      .replace(/\s+/g,' ')
      // Expanding a token mid-sentence can leave a gap before the punctuation
      // that followed it, which the phonemizer voices as a stumble.
      .replace(/ +([,;:.!?])/g,'$1')
      .trim();
  }
  function speechFrom(node){
    // The speech projection rides in data-speech-text; textContent stays the
    // fallback so a node rendered without the attribute is still narrated.
    return speechClean(node.getAttribute('data-speech-text')||node.textContent||'');
  }
  function fallbackStepText(panel){
    var w=$('.ds-why-text',panel)||$('.ds-why-text',beatHost(panel));
    return w?speechFrom(w):'';
  }
  function stepSpeechUnits(panel){
    var overview=$all('[data-speech-overview],[data-speech-concept]',panel);
    if(overview.length){
      return overview.map(function(node){return {text:speechFrom(node),group:null};}).filter(function(unit){return !!unit.text;});
    }
    // A loaded step keeps its beats in the island; a lazy one still carries its own
    // sr-only speech cache, so both scopes are searched before giving up.
    var beats=$all('[data-speech-beat]',panel);
    if(!beats.length)beats=$all('[data-speech-beat]',beatHost(panel));
    if(beats.length){
      return beats.map(function(b){
        var group=parseInt(b.getAttribute('data-focus-group')||'',10);
        return {text:speechClean(b.getAttribute('data-speech-text')||b.textContent||''),group:isNaN(group)?null:group};
      }).filter(function(unit){return !!unit.text;});
    }
    var text=fallbackStepText(panel);
    return text?[{text:text,group:null}]:[];
  }
  // Each chunk becomes its own synthesis request and its own audio clip, played
  // back to back. So a chunk boundary is an audible boundary: the narrator stops,
  // and the next clip starts with fresh sentence intonation. Boundaries therefore
  // belong at sentence ends, never wherever a character budget happens to run out.
  var ALOUD_FIRST_CHUNK_CHARS=170,ALOUD_CHUNK_CHARS=480,ALOUD_MIN_TAIL_CHARS=60;
  // Only split where punctuation is followed by whitespace or the end of the text,
  // so "1.5 seconds" and "app.ts" stay intact. Splitting on any period would both
  // mangle them and break the batches-rejoin-to-text contract the speech engine checks.
  function splitSpeechSentences(text){
    var boundary=/[.!?]+(?:["')\]]+)?(?=\s+|$)/g,out=[],start=0,match;
    while((match=boundary.exec(text))!==null){
      var end=match.index+match[0].length,segment=text.slice(start,end).trim();
      if(segment)out.push(segment);
      start=end;
    }
    var tail=text.slice(start).trim();
    if(tail)out.push(tail);
    return out.length?out:[text.trim()];
  }
  function splitSpeechUnit(text){
    // The whitespace class needs a doubled backslash. This client code lives in a
    // plain string, so a single one is eaten before the browser sees it, and this
    // line read as "split on the letter s" — every beat was split on its own s
    // characters and rejoined with spaces, so narration said "Concept validation
    // i  a reu able profile". Every regex escape in this file must be doubled.
    var clean=speechClean(text);
    if(!clean)return [];
    // A sentence only gets broken apart when it alone exceeds a whole chunk.
    var units=[];
    splitSpeechSentences(clean).forEach(function(sentence){
      if(sentence.length<=ALOUD_CHUNK_CHARS){units.push(sentence);return;}
      var current='';
      sentence.split(/\s+/).forEach(function(word){
        var combined=current?current+' '+word:word;
        if(current&&combined.length>ALOUD_CHUNK_CHARS){units.push(current);current=word;}
        else current=combined;
      });
      if(current)units.push(current);
    });
    var chunks=[],pending='';
    units.forEach(function(unit){
      // The first chunk stays small so playback can start sooner, but never at the
      // cost of cutting a sentence: an over-long opening sentence ships whole.
      var limit=chunks.length?ALOUD_CHUNK_CHARS:ALOUD_FIRST_CHUNK_CHARS;
      var combined=pending?pending+' '+unit:unit;
      // The budget must not force out a chunk too short to stand on its own. A brief
      // opening sentence ("The direct handler lands here.") followed by a long one
      // exceeded the limit immediately, so the short one shipped alone and was read
      // as an isolated utterance. Keep absorbing until it can carry a clip.
      if(pending&&combined.length>limit&&pending.length>=ALOUD_MIN_TAIL_CHARS){chunks.push(pending);pending=unit;}
      else pending=combined;
    });
    if(pending){
      // A short tail rides along with the previous chunk. Left alone it became its
      // own clip — an 8-character fragment read as a complete sentence.
      if(chunks.length&&pending.length<ALOUD_MIN_TAIL_CHARS)chunks[chunks.length-1]+=' '+pending;
      else chunks.push(pending);
    }
    return chunks;
  }
  function speechSequenceFrom(stepIndex,unitIndex,manual){
    var sequence=[],last=manual?stepIndex:total-1;
    for(var s=stepIndex;s<=last;s++){
      // An explicit single-step play keeps its skim step; a must-read-only
      // "play story" run skips them.
      if(!manual&&mustOnly()&&isSkimPanel(stepPanels[s]))continue;
      var panel=stepPanels[s],units=panel?stepSpeechUnits(panel):[];
      var first=s===stepIndex?Math.max(0,unitIndex||0):0;
      for(var u=first;u<units.length;u++){
        (function(stepIndex,unitIndex,unit){
          splitSpeechUnit(unit.text).forEach(function(chunk){
            sequence.push({stepIndex:stepIndex,unitIndex:unitIndex,text:chunk,group:unit.group,start:0});
          });
        })(s,u,units[u]);
      }
    }
    var offset=0;
    sequence.forEach(function(unit){unit.start=offset;offset+=unit.text.length+1;});
    return sequence;
  }
  function warmSpeechSequence(sequence,index){
    var warmed={},remaining=2;
    for(var i=Math.max(0,index+1);i<sequence.length&&remaining>0;i++){
      var stepIndex=sequence[i].stepIndex;
      if(warmed[stepIndex])continue;
      warmed[stepIndex]=true;
      var panel=stepPanels&&stepPanels[stepIndex];
      if(panel&&panel.hasAttribute('data-step-lazy')){loadStoryStep(stepIndex);remaining--;}
    }
  }
  function speakNarrationSequence(sequence,manual){
    if(!sequence.length)return false;
    var first=sequence[0],batches=sequence.map(function(unit){return unit.text;}),text=batches.join(' ');
    currentSpeechStep=first.stepIndex;currentSpeechUnit=first.unitIndex;currentSpeechManual=!!manual;
    return speak(text,{batches:batches,manual:!!manual,sequence:sequence,stepIndex:first.stepIndex,focusGroup:first.group});
  }
  function speakStepIndex(i,manual){
    var p=stepPanels[i];if(!p)return false;
    var units=stepSpeechUnits(p);if(!units.length)return false;
    voiceSequenceToken++;
    return speakStepUnit(i,units,0,manual);
  }
  function speakStepUnit(stepIndex,units,index,manual){
    if(index>=units.length)return false;
    return speakNarrationSequence(speechSequenceFrom(stepIndex,index,manual),manual);
  }
  function speakStep(i){if(!narrationPlaying())return false;return speakStepIndex(i,false);}
  function mustOnly(){return document.body.hasAttribute('data-must-only');}
  function isSkimPanel(panel){return !!panel&&panel.getAttribute&&panel.getAttribute('data-step-weight')==='skim';}
  function speakablePanel(j){var panel=stepPanels[j];if(!panel||!stepSpeechUnits(panel).length)return false;return !mustOnly()||!isSkimPanel(panel);}
  function nextSpeakableStep(i){
    for(var j=i+1;j<total;j++){if(speakablePanel(j))return j;}
    return -1;
  }
  function previousSpeakableStep(i){
    for(var j=i-1;j>=1;j--){if(speakablePanel(j))return j;}
    return -1;
  }
  function speechBeatTarget(stepIndex,unitIndex,delta){
    if(stepIndex<0)stepIndex=active;
    if(!stepPanels[stepIndex])return null;
    var units=stepSpeechUnits(stepPanels[stepIndex]);
    if(!units.length)return null;
    if(unitIndex<0)unitIndex=delta>0?-1:units.length;
    var nextUnit=unitIndex+delta;
    if(nextUnit>=0&&nextUnit<units.length)return {step:stepIndex,unit:nextUnit};
    if(delta>0){var n=nextSpeakableStep(stepIndex);if(n>=0)return {step:n,unit:0};}
    if(delta<0){var p=previousSpeakableStep(stepIndex);if(p>=0){var prevUnits=stepSpeechUnits(stepPanels[p]);return {step:p,unit:prevUnits.length-1};}}
    return null;
  }
  function moveSpeechBeat(delta){
    if(isTextEntryTarget(document.activeElement))return false;
    if(!(aloudIntent!=='off'||currentSpeechStep>=0))return false;
    var baseStep=currentSpeechStep>=0?currentSpeechStep:active,baseUnit=currentSpeechUnit;
    var target=speechBeatTarget(baseStep,baseUnit,delta);if(!target)return true;
    var units=stepSpeechUnits(stepPanels[target.step]);if(!units.length)return true;
    // Skipping beats while paused has to stay paused. This used to cancel the job
    // and immediately speak the neighbouring beat, so an arrow key silently
    // un-paused the story — and because speakStepUnit builds a sequence running
    // to the end, it replaced the paused job with a whole new full-story one.
    if(aloudIntent==='paused'){
      cancelSpeech(true);
      aloudResumeDirty=true;
      currentSpeechStep=target.step;currentSpeechUnit=target.unit;
      activateStep(target.step,false);
      var held=units[target.unit];if(held)setActiveBeat(target.step,held.group);
      updateReadAloudButton();
      return true;
    }
    var manual=currentSpeechManual&&!narrationPlaying();
    cancelSpeech(false);
    setAloudIntent(manual?'off':'playing');
    activateStep(target.step,false);
    updateReadAloudButton();
    voiceSequenceToken++;
    speakStepUnit(target.step,units,target.unit,manual);
    return true;
  }
  function firstSpeakableStep(){
    for(var j=Math.max(1,active);j<total;j++){if(speakablePanel(j))return j;}
    for(var k=1;k<Math.min(total,Math.max(1,active));k++){if(speakablePanel(k))return k;}
    return -1;
  }
  function readJsonOrError(r,msg){
    if(r.ok)return r.json();
    // Carry the reader's own "this was only a blip" signal onto the Error so the
    // narration loop can retry instead of tearing playback down.
    return r.json().then(function(j){
      var err=new Error((j&&j.error)||msg);
      if(j&&j.transient)err.transient=true;
      if(j&&j.fallback)err.fallback=j.fallback;
      throw err;
    },function(){
      var err=new Error(msg);
      if(r.status===504)err.transient=true;
      throw err;
    });
  }
  function isAbortError(err){
    return err&&(err.name==='AbortError'||/aborted|cancelled/i.test(String(err.message||err)));
  }
  // Backup narrator. Set once the server reports that Lino is missing or would
  // not start, and kept until a local narrator is explicitly selected: every request
  // goes to the browser's own voice, which answers in the same shape.
  var browserSpeech=null,browserSpeechAnnounced=false;
  function useBrowserSpeech(){
    if(!browserSpeech)browserSpeech=createBrowserSpeech(window.speechSynthesis,window.SpeechSynthesisUtterance);
    return !!browserSpeech;
  }
  function browserSpeechRequest(path,body){
    // Said on the first play, not on the background status check that usually
    // discovers the fallback while the reviewer is only browsing.
    if(path==='speak'&&!browserSpeechAnnounced){
      browserSpeechAnnounced=true;
      toast('Lino is not available, so narration uses your browser\u2019s voice.');
    }
    return browserSpeech.request(path,body);
  }
  function aloudFetch(path,body,signal){
    if(browserSpeech)return browserSpeechRequest(path,body);
    var init={method:body==null?'GET':'POST',headers:body==null?undefined:{'Content-Type':'application/json'},signal:signal};
    if(body!=null)init.body=JSON.stringify(body);
    return fetch('/api/aloud/'+path,init).then(function(r){return readJsonOrError(r,'Narration is unavailable.');}).catch(function(err){
      if(err&&err.fallback==='browser'&&useBrowserSpeech())return browserSpeechRequest(path,body);
      throw err;
    });
  }
  // How many beats of the step under the cursor to warm ahead of a play. Matches
  // the daemon's own prepare depth; it clamps anything larger.
  var ALOUD_PREPARE_BEATS=4;
  var aloudPreparationId='';
  document.addEventListener('codestory:narration-settings',function(event){
    if(browserSpeech){browserSpeech.request('control',{action:'stop'}).catch(function(){});browserSpeech=null;browserSpeechAnnounced=false;}
    setAloudIntent('off');cancelSpeech(false);
    aloudPrepareRequest++;aloudPreparedText='';aloudPreparationId='';
    if(aloudPrepareTimer){clearTimeout(aloudPrepareTimer);aloudPrepareTimer=0;}
    if(event.detail&&typeof event.detail.rate==='number')aloudRate=event.detail.rate;
    updateReadAloudButton();prepareStepNarration(active);
  });
  // Step selection is also a browsing gesture. Wait until the reviewer has
  // actually settled before asking the speech engine to generate anything in the background.
  var ALOUD_PREPARE_DWELL_MS=1000;
  // Long enough that a normal pause/resume always answers first, short enough
  // that a wedged one hands the control back while the reviewer is still looking
  // at it. aloudControl never rejects, so this only fires on a genuine stall.
  var ALOUD_CONTROL_TIMEOUT_MS=6000;
  function aloudPreparationIdentity(status){
    status=status||{};
    return [
      String(status.engine||''),
      String(status.voice||''),
      String(status.resolvedVoice||status.voice||''),
      String(status.rate||''),
      String(status.mode||'')
    ].join('|');
  }
  function prepareStepNarration(stepIndex){
    if(!stepPanels||stepIndex<=0||stepIndex>=stepPanels.length||aloudIntent!=='off'||aloudActive||speechLoadingLabel)return;
    var prepareRequest=++aloudPrepareRequest;
    if(aloudPrepareTimer)clearTimeout(aloudPrepareTimer);
    aloudPrepareTimer=setTimeout(function(){
      aloudPrepareTimer=0;
      var panel=stepPanels&&stepPanels[stepIndex];if(!panel)return;
      if(panel.hasAttribute('data-step-lazy')){
        loadStoryStep(stepIndex,function(ok){if(ok&&prepareRequest===aloudPrepareRequest)prepareStepNarration(stepIndex);});
        return;
      }
      var units=stepSpeechUnits(panel),chunks=[];
      units.forEach(function(unit){splitSpeechUnit(unit.text).forEach(function(chunk){chunks.push(chunk);});});
      // Warm the whole step, not its first two beats. Two was enough to start
      // talking and not enough to keep talking: by beat three playback was waiting
      // on synthesis again. The daemon caps how deep it actually goes.
      var prepareChunks=chunks.slice(0,ALOUD_PREPARE_BEATS);
      if(!prepareChunks.length)return;
      // A text-only key reused audio prepared for the previous engine, voice,
      // speed, or mode. Ask the speech engine for the settings it will actually use before
      // deciding this step is warm.
      aloudFetch('status').then(function(status){
        if(prepareRequest!==aloudPrepareRequest||aloudIntent!=='off'||aloudActive||speechLoadingLabel)return;
        if(!status||status.service!=='aloud-speech-daemon'||status.protocolVersion!==2)return;
        var preparedKey=aloudPreparationIdentity(status)+'\n'+prepareChunks.join('\n');
        if(preparedKey===aloudPreparedText&&(!status.prepare||!status.prepare.state||
          (status.prepare.id===aloudPreparationId&&(status.prepare.state==='generating'||status.prepare.state==='ready'))))return;
        aloudPreparedText=preparedKey;
        return aloudFetch('prepare',{text:prepareChunks.join(' '),batches:prepareChunks,prefetch:ALOUD_PREPARE_BEATS}).then(function(receipt){
          if(aloudPreparedText===preparedKey)aloudPreparationId=receipt&&receipt.prepare?receipt.prepare.id:'';
        }).catch(function(){
          if(aloudPreparedText===preparedKey)aloudPreparedText='';
        });
      }).catch(function(){
        // Preparation is opportunistic. Play owns the user-visible error path.
      });
    },ALOUD_PREPARE_DWELL_MS);
  }
  function aloudControl(action,silent){
    return aloudFetch('control',{action:action}).catch(function(err){if(!silent)toast(err.message||'Narration is unavailable.','error');});
  }
  function applyAloudStatus(status){
    if(!status)return;
    // Observation, never intent. A status snapshot taken before the reviewer's
    // pause reached the daemon must not repaint the control with the state they
    // just left, so an in-flight control owns the truth until it answers.
    if(aloudControlPending)return;
    aloudActive=!!status.running;aloudPaused=!!status.paused;
    if(typeof status.rate==='number'&&isFinite(status.rate)&&status.rate>0)aloudRate=status.rate;
    var state=status.state||{},phase=String(state.status||'');
    aloudPhase=aloudPaused?'paused':(phase==='starting'||phase==='generating'||phase==='reading'?phase:(aloudActive?'starting':'idle'));
    // The speech engine reports exactly which chunk it is preparing. Keep it so the control
    // can say what is happening instead of spinning silently.
    aloudStateMessage=typeof state.message==='string'?state.message:'';
    // Another tab of this review can pause the same engine. Adopt that rather
    // than insisting on an intent the reviewer can plainly hear is wrong — but
    // only while a job really exists,
    // so a story we paused and whose job we cancelled stays paused.
    if(aloudActive&&aloudIntent!=='off')setAloudIntent(aloudPaused?'paused':'playing');
  }
  function focusAloudSequenceUnit(index){
    if(index<0||index>=aloudSequence.length)return;
    aloudSequenceIndex=index;
    var unit=aloudSequence[index];
    currentSpeechStep=unit.stepIndex;currentSpeechUnit=unit.unitIndex;
    var apply=function(){
      if(aloudSequenceIndex!==index)return;
      if(active!==unit.stepIndex)activateStep(unit.stepIndex,false);
      setActiveBeat(unit.stepIndex,unit.group);
      warmSpeechSequence(aloudSequence,index);
    };
    var panel=stepPanels&&stepPanels[unit.stepIndex];
    if(panel&&panel.hasAttribute('data-step-lazy')){
      if(active!==unit.stepIndex)activateStep(unit.stepIndex,false);
      loadStoryStep(unit.stepIndex,function(ok){if(ok)apply();});
      return;
    }
    apply();
  }
  function applyAloudSequenceProgress(status){
    if(!aloudSequence.length||!status)return;
    var state=status.state||{},start=Number(state.chunkStart),index=-1;
    if(isFinite(start)){
      for(var i=0;i<aloudSequence.length;i++){if(aloudSequence[i].start===start){index=i;break;}}
    }
    if(index<0&&typeof state.current==='number'){
      index=Math.max(0,Math.min(aloudSequence.length-1,state.status==='starting'?state.current:state.current-1));
    }
    if(index>=0&&index!==aloudSequenceIndex)focusAloudSequenceUnit(index);
  }
  function finishAloudSpeech(token,opts,completed,message){
    if(token!==aloudRequestToken)return;
    if(aloudPollTimer){clearTimeout(aloudPollTimer);aloudPollTimer=0;}
    aloudActive=false;aloudPaused=false;aloudJobId='';aloudPhase='idle';speechLoadingLabel='';aloudPollFails=0;
    aloudStateMessage='';aloudStartedAt=0;aloudSlowNotice=false;
    if(opts.stepIndex!=null)clearVoiceFocus();
    aloudSequence=[];aloudSequenceIndex=-1;clearSpeechCursor();
    if(!opts.manual)setAloudIntent('off');
    var btn=$('[data-readaloud]');if(btn)btn.classList.remove('is-speaking');
    updateReadAloudButton();
    // Giving up on our side does not silence the speech engine. Without this the reviewer
    // gets an error toast and a reset button while the narration keeps talking.
    // A jobId handover passes no message, so it never stops the incoming job.
    //
    // The message alone is the guard. It used to also require wasActive, which is
    // false on precisely the path that needs the stop most: a /speak that the
    // daemon accepted and started before the reply failed on our side. There the
    // browser had cleared aloudActive on the way in, so the compensating stop was
    // skipped and the speech engine read the whole story to a page showing an idle button.
    if(message)aloudControl('stop',true);
    if(message)toast(message,'error');
    if(completed&&typeof opts.onDone==='function')opts.onDone();
  }
  // A cold start can run half a minute: the speech engine unloads its speech model after two
  // idle minutes, so the first play after reading a while pays to reload it. Say
  // that out loud instead of leaving the reviewer with a silent spinner.
  function noticeSlowNarration(){
    if(aloudSlowNotice||!aloudStartedAt)return;
    if(aloudPhase!=='starting'&&aloudPhase!=='generating')return;
    if(Date.now()-aloudStartedAt<8000)return;
    aloudSlowNotice=true;
    toast(aloudStateMessage
      ?'Lino is still generating audio — '+aloudStateMessage.charAt(0).toLowerCase()+aloudStateMessage.slice(1)+'.'
      :'Lino is still generating audio. The first play after a pause can take a moment.');
  }
  // This loop runs hundreds of times per playback. Tight beat highlighting only
  // needs a fast poll while the speech engine is actually reading; while it generates, a
  // slower poll tracks progress just as well with far fewer round trips. After a
  // failure, back off rather than hammering a reader that is already struggling.
  function aloudPollDelay(){
    if(aloudPollFails)return Math.min(1200,200*aloudPollFails);
    return aloudPhase==='reading'?100:500;
  }
  function pollAloudSpeech(token,opts){
    if(token!==aloudRequestToken)return;
    aloudPollTimer=setTimeout(function(){
      aloudPollTimer=0;
      aloudFetch('status').then(function(status){
        if(token!==aloudRequestToken)return;
        if(!status||status.service!=='aloud-speech-daemon'||status.protocolVersion!==2){
          finishAloudSpeech(token,opts,false,'The speech engine returned an incompatible status.');return;
        }
        if(aloudJobId&&status.jobId!==aloudJobId){
          finishAloudSpeech(token,opts,false);return;
        }
        aloudPollFails=0;
        applyAloudStatus(status);applyAloudSequenceProgress(status);updateReadAloudButton();
        noticeSlowNarration();
        if(status.running){pollAloudSpeech(token,opts);return;}
        var state=status.state&&status.state.status;
        finishAloudSpeech(token,opts,state==='done',state==='error'?(status.state.message||'Lino could not finish playback.'):'');
      }).catch(function(err){
        if(token!==aloudRequestToken)return;
        // One dropped poll is not a failed narration: the speech engine keeps reading while
        // a timeout or a restarting server briefly hides it from us. Ride out a
        // short run of failures on a backoff before admitting defeat, otherwise
        // a single blip silently kills playback that is still audible.
        aloudPollFails++;
        if(aloudPollFails<=6){pollAloudSpeech(token,opts);return;}
        finishAloudSpeech(token,opts,false,err.message||'Narration is unavailable.');
      });
    },aloudPollDelay());
  }
  function speak(text,opts){
    if(!text)return false;
    opts=opts||{};
    var token=++aloudRequestToken,btn=$('[data-readaloud]'),batches=opts.batches||[text];
    if(aloudPollTimer){clearTimeout(aloudPollTimer);aloudPollTimer=0;}
    if(aloudRequestAbort){try{aloudRequestAbort.abort();}catch(e){}}
    var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    aloudRequestAbort=ctrl;aloudActive=false;aloudPaused=false;aloudJobId='';aloudPhase='starting';speechLoadingLabel=browserSpeech?'Starting narration':'Starting Lino';
    aloudPollFails=0;aloudStateMessage='';aloudSlowNotice=false;aloudStartedAt=Date.now();aloudEverStarted=true;
    aloudSequence=opts.sequence||[];aloudSequenceIndex=-1;
    if(aloudSequence.length)focusAloudSequenceUnit(0);
    else if(opts.stepIndex!=null){if(opts.focusGroup!=null)setActiveBeat(opts.stepIndex,opts.focusGroup);else startVoiceFocusSequence(opts.stepIndex,text);}
    else clearVoiceFocus();
    if(btn)btn.classList.add('is-speaking');updateReadAloudButton();
    aloudFetch('speak',{text:text,batches:batches,prefetch:3},ctrl?ctrl.signal:undefined).then(function(status){
      if(token!==aloudRequestToken)return;
      if(aloudSequence.length&&(!status.state||status.state.total!==aloudSequence.length)){
        aloudControl('stop',true);
        throw new Error('Lino needs an update before it can prefetch codeStory narration. Update Lino, then try again.');
      }
      aloudRequestAbort=null;speechLoadingLabel='';aloudJobId=status.jobId||'';applyAloudStatus(status);
      applyAloudSequenceProgress(status);updateReadAloudButton();pollAloudSpeech(token,opts);
    }).catch(function(err){
      if(token!==aloudRequestToken||isAbortError(err))return;
      aloudRequestAbort=null;setAloudIntent('off');
      finishAloudSpeech(token,opts,false,err.message||'Install Lino and download a voice in Settings → Read Aloud to enable narration.');
    });
    return true;
  }
  function updateReadAloudButton(){
    var btn=$('[data-readaloud]');if(!btn)return;
    var label=$('[data-readaloud-label]',btn),ico=$('.ds-readaloud-ico',btn),stop=$('[data-aloud-stop]');
    // Rendered from intent, not from the daemon snapshot. The poll used to own
    // these flags, so a /status reply taken before the click reached the daemon
    // repainted the button with the state the reviewer had just left — the
    // control said "Pause" while the audio was already stopping.
    var paused=aloudIntent==='paused',speaking=aloudIntent==='playing';
    var busy=!!speechLoadingLabel||aloudControlPending;
    var loading=!!speechLoadingLabel||(speaking&&aloudActive&&(aloudPhase==='starting'||aloudPhase==='generating'));
    var playing=aloudIntent!=='off'||!!speechLoadingLabel;
    var action=paused?'Resume':(speechLoadingLabel?'Starting':(speaking?'Pause':'Play'));
    var buttonLabel=paused?'Resume narration':(speaking?'Pause narration':(speechLoadingLabel?'Starting narration':(browserSpeech?'Play story with the browser voice':'Play story with Lino')));
    // While the speech engine is still generating, its own progress is more useful than a
    // static label — a 30s cold start should never look like a hung button.
    if(loading&&aloudStateMessage)buttonLabel=buttonLabel+' — '+aloudStateMessage;
    btn.classList.toggle('is-active',playing);
    btn.classList.toggle('is-loading',loading||aloudControlPending);
    btn.classList.toggle('is-paused',paused);
    btn.classList.toggle('is-audible',speaking&&!loading);
    // An in-flight pause/resume now reads as busy instead of looking live and
    // swallowing every press through the aloudControlPending guard.
    btn.disabled=busy;
    btn.setAttribute('aria-busy',busy?'true':'false');
    btn.setAttribute('aria-pressed',speaking?'true':'false');
    btn.setAttribute('aria-label',buttonLabel);
    btn.setAttribute('title',buttonLabel);
    if(label)label.textContent=action;
    if(ico){ico.classList.toggle('is-pause',speaking&&!loading);ico.classList.toggle('is-play',!loading&&!speaking);ico.textContent=loading?'◌':'';}
    // Stop stays reachable through the start handshake, which is exactly when a
    // mis-started or wedged narration needs abandoning. It used to be hidden
    // there (aloudActive is false until /speak answers), so a start in progress
    // could not be called off from anywhere in the page.
    if(stop)stop.hidden=!(aloudIntent!=='off'||speechLoadingLabel);
    document.body.classList.toggle('ds-aloud-active',playing);
  }
  function startReadAloudFromActive(){
    var requestedStep=active,panel=stepPanels&&stepPanels[requestedStep];
    if(panel&&panel.hasAttribute('data-step-lazy')){
      // A newly selected step may still contain only its loading skeleton. It is
      // not an empty narration step, so do not fall through to some later panel
      // that happened to load first.
      loadStoryStep(requestedStep,function(ok){
        if(!ok){
          if(active===requestedStep){setAloudIntent('off');updateReadAloudButton();}
          return;
        }
        // setActive's own load callback starts narration when it is queued ahead
        // of this one. Only start here when no request is already in flight.
        if(!narrationPlaying()||active!==requestedStep||aloudActive||speechLoadingLabel)return;
        if(!speakStep(requestedStep)){setAloudIntent('off');updateReadAloudButton();}
      });
      return true;
    }
    if(speakStep(requestedStep))return true;
    var si=firstSpeakableStep();
    if(si>=0){setActive(si);return true;}
    setAloudIntent('off');updateReadAloudButton();return false;
  }
  function toggleReadAloud(){
    if(speechLoadingLabel||aloudControlPending)return;
    // Intent decides, not the daemon: a paused story whose job we already
    // cancelled (skipping beats does that) still has to resume from this button.
    if(aloudIntent!=='off'){toggleVoicePause();return;}
    setAloudIntent('playing');
    updateReadAloudButton();
    startReadAloudFromActive();
  }
  function stopReadAloud(){
    if(!(aloudIntent!=='off'||aloudActive||speechLoadingLabel))return false;
    setAloudIntent('off');cancelSpeech();toast('Narration stopped');return true;
  }
  /**
   * Pause and resume are an intent change first and a daemon call second. The
   * old version wrote the daemon's own aloudPaused optimistically and let the
   * next status poll overwrite it with a pre-click snapshot.
   */
  function setNarrationPaused(next){
    if(aloudControlPending)return true;
    if(next&&aloudIntent!=='playing')return false;
    if(!next&&aloudIntent!=='paused')return false;
    // Read the moved flag before changing intent: setAloudIntent clears it on the
    // way to 'playing', so checking it afterwards can only ever see false.
    var previous=aloudIntent,moved=aloudResumeDirty;
    setAloudIntent(next?'paused':'playing');
    // Resuming after the reviewer moved: the daemon's job is parked on a step
    // they have walked away from, so speak from where they actually are instead
    // of resuming into the wrong place. Same when the job is already gone.
    if(!next&&(moved||!aloudActive)){
      aloudResumeDirty=false;
      cancelSpeech(true);
      setAloudIntent('playing');
      updateReadAloudButton();
      startReadAloudFromActive();
      return true;
    }
    var token=++aloudControlToken;
    aloudControlPending=true;
    if(aloudControlTimer)clearTimeout(aloudControlTimer);
    // A control request that never settles used to leave the button looking live
    // while silently dropping every press. Time out and hand control back.
    aloudControlTimer=setTimeout(function(){
      if(token!==aloudControlToken)return;
      aloudControlTimer=0;aloudControlPending=false;updateReadAloudButton();
    },ALOUD_CONTROL_TIMEOUT_MS);
    updateReadAloudButton();
    aloudControl(next?'pause':'resume',false).then(function(status){
      if(token!==aloudControlToken)return;
      if(aloudControlTimer){clearTimeout(aloudControlTimer);aloudControlTimer=0;}
      aloudControlPending=false;
      if(!status){setAloudIntent(previous);updateReadAloudButton();return;}
      applyAloudStatus(status);updateReadAloudButton();
    });
    return true;
  }
  function toggleVoicePause(){
    if(aloudIntent==='playing')return setNarrationPaused(true);
    if(aloudIntent==='paused')return setNarrationPaused(false);
    return false;
  }
  function loadFilePanel(panel){
    if(!panel||!$('[data-file-panel-lazy]',panel)||panel.getAttribute('data-panel-loading')==='1')return Promise.resolve(panel);
    var file=panel.getAttribute('data-file')||'';
    panel.setAttribute('data-panel-loading','1');panel.setAttribute('aria-busy','true');
    return fetch(reviewPageUrl('/api/diff/file-panel?file='+encodeURIComponent(file))).then(reviewLazyText).then(function(html){
      // pi-lens-ignore: ast-grep:no-inner-html-js
      panel.innerHTML=html;panel.removeAttribute('data-panel-loading');panel.removeAttribute('aria-busy');setLineWrap(document.body.classList.contains('ds-line-wrap'),false);
      mountCommentPins(panel);updateChangeNav(panel);refreshComments();applyFilesMode(panel);syncSplitPaneLayout(panel);jumpToFirstChange(panel);return panel;
    }).catch(function(err){
      panel.removeAttribute('data-panel-loading');panel.removeAttribute('aria-busy');
      // pi-lens-ignore: ast-grep:no-inner-html-js
      panel.innerHTML='<div class="ds-filepanel-loaderror" role="alert"><strong>'+reviewLazyMessage(err,'Could not load this file review.')+'</strong>'+reviewLazyAction(err,'data-retry-file-panel','')+'</div>';
      return panel;
    });
  }
  function selectFile(i){
    if(!filePanels.length)return;
    if(i<0)i=0;if(i>filePanels.length-1)i=filePanels.length-1;
    var previous=selectedFile;selectedFile=i;
    var update=function(){
      filePanels.forEach(function(p,idx){p.hidden=idx!==i;});
      fileItems.forEach(function(it){it.classList.toggle('is-active',Number(it.getAttribute('data-file-index'))===i);});
    };
    if(reviewPositionReady&&previous>=0&&previous!==i)runWorkspaceTransition('file',i>previous?1:-1,update);else update();
    var activePanel=filePanels[i],fileHint=$('[data-file-hint]'),filePath=activePanel&&activePanel.getAttribute('data-file');
    if(fileHint){fileHint.textContent=filePath?'Viewing '+filePath:'Showing selected file';if(filePath)fileHint.title=filePath;else fileHint.removeAttribute('title');}
    var panel=filePanels[i];
    loadFilePanel(panel).then(function(){if(filePanels[selectedFile]===panel){applyFilesMode(panel);jumpToFirstChange(panel);}});
    var detail=$('#ds-file-detail');if(detail)detail.scrollTop=0;
    saveReviewPositionSoon();
  }
  function applyFilesMode(panel){
    if(!panel)return;
    var stored=null;try{stored=localStorage.getItem('ds-files-mode');}catch(e){}
    var active=$('.ds-modetoggle button.is-active',panel);
    var want=panel.hasAttribute('data-context-file')?'diff':(stored||(compactScreen()?'diff':'split'));
    if(!want)return;
    var btn=$('.ds-modetoggle button[data-mode="'+want+'"]',panel)||active;
    if(btn)setMode(btn,{persist:false});
  }
  function selectFileByPath(file){
    for(var k=0;k<filePanels.length;k++){if(filePanels[k].getAttribute('data-file')===file){selectFile(k);return;}}
  }
  // Several stories — and every rewrite of one — share a single base..head scope, so a
  // position saved under the scope alone replays into whichever story is opened next,
  // dropping the reader mid-way through a story they have not begun. The story identity
  // keeps each one's slot to itself.
  function reviewUiKey(){return 'ds-review-ui:'+(document.body.getAttribute('data-review-scope')||document.body.getAttribute('data-viewed-scope')||'')+':'+(document.body.getAttribute('data-story-key')||'');}
  function currentReviewPosition(){
    var view=currentView();
    var panel=view==='files'?filePanels[selectedFile]:stepPanels[active];
    var scroll=0;
    if(view==='files'){var detail=$('#ds-file-detail');scroll=detail?detail.scrollTop:0;}
    else if(panel){var diff=$('.ds-diffscroll',panel);scroll=diff?diff.scrollTop:panel.scrollTop;}
    return {view:view,step:active,file:filePanels[selectedFile]?filePanels[selectedFile].getAttribute('data-file'):'',scroll:Math.round(scroll||0),reviewTab:activeReviewTab()};
  }
  function saveReviewPosition(){
    if(restoringReviewPosition||!reviewPositionReady)return;
    try{localStorage.setItem(reviewUiKey(),JSON.stringify(currentReviewPosition()));}catch(e){}
    mirrorReviewPositionToUrl();
  }
  function mirrorReviewPositionToUrl(){
    try{
      var pos=currentReviewPosition(),url=new URL(window.location.href),sp=url.searchParams;
      if(pos.view)sp.set('view',pos.view);else sp.delete('view');
      if(pos.view==='files'&&pos.file)sp.set('file',pos.file);else sp.delete('file');
      if(pos.view==='tour'&&Number(pos.step)>0)sp.set('step',String(pos.step));else sp.delete('step');
      window.history.replaceState(null,'',url.toString());
    }catch(e){}
  }
  function queryReviewPosition(){
    try{
      var sp=new URLSearchParams(window.location.search),view=sp.get('view');
      if(view!=='tour'&&view!=='files'&&view!=='review')return null;
      return {view:view,step:Number(sp.get('step'))||0,file:sp.get('file')||'',scroll:0,reviewTab:''};
    }catch(e){return null;}
  }
  function saveReviewPositionSoon(){
    if(reviewSaveTimer)clearTimeout(reviewSaveTimer);
    reviewSaveTimer=setTimeout(saveReviewPosition,90);
  }
  function storedReviewPosition(){try{return JSON.parse(localStorage.getItem(reviewUiKey())||'null');}catch(e){return null;}}
  function describeReviewPosition(state){
    if(!state)return '';
    if(state.view==='files'&&state.file)return 'Resume at '+state.file;
    if(state.view==='tour'&&Number(state.step)>0)return 'Resume at story step '+state.step;
    return '';
  }
  function revealResumeReview(){
    var state=storedReviewPosition(),btn=$('[data-resume-review]'),label=$('[data-resume-review-label]');
    var text=describeReviewPosition(state),inFiles=currentView()==='files';if(!btn)return;
    btn.hidden=!text||!inFiles;
    if(text){if(label)label.textContent=text;btn.title=text;btn.setAttribute('aria-label',text);}
    else{btn.removeAttribute('title');btn.removeAttribute('aria-label');}
  }
  function restoreReviewPosition(){
    var state=queryReviewPosition()||storedReviewPosition();if(!state)return;
    restoringReviewPosition=true;
    if(state.view==='review'){
      setView('review');if(state.reviewTab)setReviewTab(state.reviewTab,false);restoringReviewPosition=false;
    }else if(state.view==='files'){
      setView('files');if(state.file)selectFileByPath(state.file);
      setTimeout(function(){var d=$('#ds-file-detail');if(d)d.scrollTop=Number(state.scroll)||0;restoringReviewPosition=false;},0);
    }else{
      setView('tour');setActive(Number(state.step)||0,false);
      setTimeout(function(){var p=stepPanels[active],d=p&&$('.ds-diffscroll',p);if(d)d.scrollTop=Number(state.scroll)||0;restoringReviewPosition=false;},0);
    }
  }

  function annotationRound(n){return Math.round(n*10)/10;}
  function annotationTagWidth(text){return annotationRound(18+String(text||'').length*6.4);}
  function annotationBox(id,side,kind,run){
    return {id:id,side:side,kind:kind,x:annotationRound(run.left+2),y:annotationRound(run.top+1),w:annotationRound(Math.max(0,run.right-run.left-4)),h:annotationRound(Math.max(0,run.bottom-run.top-2)),dashed:side==='left'};
  }
  function annotationArrow(id,kind,fromY,toY,geom,open,reverse){
    var left=annotationRound(geom.gutterLeft),right=annotationRound(geom.gutterRight),span=right-left;
    var start=reverse?right:left,end=reverse?left:right,c1=annotationRound(start+(reverse?-1:1)*span*.4),c2=annotationRound(end+(reverse?1:-1)*span*.4);
    var y1=annotationRound(fromY),y2=annotationRound(toY),angle=reverse?180:0;
    return {id:id,kind:kind,d:'M'+start+','+y1+' C'+c1+','+y1+' '+c2+','+y2+' '+end+','+y2,head:{x:end,y:y2,angle:angle,open:!!open},dashed:!!open};
  }
  function computeAnnotations(spec,regions,geom){
    var boxes=[],arrows=[],tags=[],tagLanes=Object.create(null),moves=spec&&Array.isArray(spec.moves)?spec.moves:[];
    moves.forEach(function(move){
      var before=move.before&&move.before.local?(regions[move.id+':before']||[]):[];
      var after=move.after&&move.after.local?(regions[move.id+':after']||[]):[];
      before.forEach(function(run){boxes.push(annotationBox(move.id,'left',move.kind,run));});
      after.forEach(function(run){boxes.push(annotationBox(move.id,'right',move.kind,run));});
      // One label per move, on the box the reader starts from; the arrow carries it across.
      var tagEndpoint=annotationTagEndpoint(move);
      if(tagEndpoint){
        var tw=annotationTagWidth(move.tag),side=tagEndpoint==='before'?'left':'right',run=(tagEndpoint==='before'?before:after)[0];
        var box=run&&annotationBox(move.id,side,move.kind,run);
        if(box&&box.w>=tw+14){
          var laneKey=side+':'+box.x+':'+box.y+':'+box.w,lane=tagLanes[laneKey]||0;tagLanes[laneKey]=lane+1;
          tags.push({id:move.id,text:String(move.tag).toUpperCase(),x:annotationRound(box.x+box.w-tw-8),y:annotationRound(box.y+10+lane*18),w:tw,side:side,lane:lane});
        }
      }
      if(!move.arrow||geom.gutterRight-geom.gutterLeft<16||geom.width<640)return;
      if(move.kind==='reordered'&&before.length>1&&after.length>1){
        arrows.push(annotationArrow(move.id,move.kind,(before[0].top+before[0].bottom)/2,(after[1].top+after[1].bottom)/2,geom,false,false));
        arrows.push(annotationArrow(move.id,move.kind,(before[1].top+before[1].bottom)/2,(after[0].top+after[0].bottom)/2,geom,false,false));
        return;
      }
      var beforeRun=before[0],afterRun=after[0];
      if(beforeRun&&afterRun){arrows.push(annotationArrow(move.id,move.kind,(beforeRun.top+beforeRun.bottom)/2,(afterRun.top+afterRun.bottom)/2,geom,false,false));return;}
      if(beforeRun){var beforeY=(beforeRun.top+beforeRun.bottom)/2;arrows.push(annotationArrow(move.id,move.kind,beforeY,beforeY,geom,true,false));return;}
      if(afterRun){var afterY=(afterRun.top+afterRun.bottom)/2;arrows.push(annotationArrow(move.id,move.kind,afterY,afterY,geom,true,true));}
    });
    return {boxes:boxes,arrows:arrows,tags:tags};
  }
  function annotationTagEndpoint(move){
    if(!move.tag)return null;
    return move.before&&move.before.local?'before':move.after&&move.after.local?'after':null;
  }
  // The row across the divider that shares this row's grid track, if any.
  function flowTrackTwin(body,row){
    var flow=body._dsFlow,es=flow?flow.entries:[];
    for(var k=0;k<es.length;k++){var e=es[k];if(e.l&&e.l.el===row)return e.r?e.r.el:null;if(e.r&&e.r.el===row)return e.l?e.l.el:null;}
    return null;
  }
  function moveEndpointRows(panel,id,endpoint){
    var token=id+':'+endpoint;
    return $all('[data-move]',panel).filter(function(row){return (row.getAttribute('data-move')||'').split(/\s+/).indexOf(token)>=0;});
  }
  function clearAnnotationTagLanes(root){
    $all('.ds-row[data-annot-tag-lanes]',root||document).forEach(function(row){row.removeAttribute('data-annot-tag-lanes');row.removeAttribute('data-annot-tag-here');row.style.removeProperty('--ds-annot-tag-space');});
  }
  // A label is top padding on its row. The row across the divider shares that
  // grid track, so it takes the same padding and both code lines stay level;
  // CSS turns that space into a margin outside its cell, so its box hugs the
  // code. data-annot-tag-here marks the labelled row.
  function prepareAnnotationTagLanes(body,spec){
    var desired=[];
    function rowEntry(row){for(var i=0;i<desired.length;i++)if(desired[i].row===row)return desired[i];var entry={row:row,lanes:0,tags:0};desired.push(entry);return entry;}
    spec.moves.forEach(function(move){
      var endpoint=annotationTagEndpoint(move);if(!endpoint)return;
      var rows=moveEndpointRows(body,move.id,endpoint),selector=endpoint==='before'?'.ds-cell-l':'.ds-cell-r',row=null,cell=null;
      for(var i=0;i<rows.length;i++){cell=$(selector,rows[i]);if(cell&&cell.getClientRects().length){row=rows[i];break;}}
      if(!row||!cell||cell.getBoundingClientRect().width-4<annotationTagWidth(move.tag)+14)return;
      var entry=rowEntry(row);entry.tags++;entry.lanes=Math.max(entry.lanes,entry.tags);
    });
    desired.slice().forEach(function(entry){
      var twin=flowTrackTwin(body,entry.row);if(!twin||!twin.classList.contains('ds-row'))return;
      var other=rowEntry(twin);other.lanes=Math.max(other.lanes,entry.lanes);
    });
    $all('.ds-row[data-annot-tag-lanes]',body).forEach(function(row){var keep=false;for(var i=0;i<desired.length;i++)if(desired[i].row===row){keep=true;break;}if(!keep){row.removeAttribute('data-annot-tag-lanes');row.removeAttribute('data-annot-tag-here');row.style.removeProperty('--ds-annot-tag-space');}});
    desired.forEach(function(entry){
      if(entry.row.getAttribute('data-annot-tag-lanes')!==String(entry.lanes)){entry.row.setAttribute('data-annot-tag-lanes',String(entry.lanes));entry.row.style.setProperty('--ds-annot-tag-space',String(entry.lanes*18)+'px');}
      if(entry.tags)entry.row.setAttribute('data-annot-tag-here','');else entry.row.removeAttribute('data-annot-tag-here');
    });
  }
  // Boxes wrap whole cells, line numbers included, so the arrow between them
  // only crosses the divider and never draws over a line number.
  function annotationRuns(body,id,endpoint,side){
    var bodyRect=body.getBoundingClientRect(),selector=side==='left'?'.ds-cell-l':'.ds-cell-r';
    var rects=moveEndpointRows(body,id,endpoint).map(function(row){
      var cell=$(selector,row);if(!cell||!cell.getClientRects().length)return null;
      var rect=cell.getBoundingClientRect(),gap=parseFloat(window.getComputedStyle(cell).marginTop)||0;
      return {edge:annotationRound(rect.top-bodyRect.top-gap),top:annotationRound(rect.top-bodyRect.top),bottom:annotationRound(rect.bottom-bodyRect.top),left:annotationRound(rect.left-bodyRect.left),right:annotationRound(rect.right-bodyRect.left)};
    }).filter(Boolean).sort(function(a,b){return a.top-b.top;});
    var runs=[];rects.forEach(function(rect){var last=runs[runs.length-1];if(last&&rect.edge-last.bottom<=1&&Math.abs(rect.left-last.left)<=1&&Math.abs(rect.right-last.right)<=1){last.bottom=rect.bottom;}else runs.push({top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right});});return runs;
  }
  function measureAnnotations(body,spec){
    var regions=Object.create(null);spec.moves.forEach(function(move){if(move.before&&move.before.local)regions[move.id+':before']=annotationRuns(body,move.id,'before','left');if(move.after&&move.after.local)regions[move.id+':after']=annotationRuns(body,move.id,'after','right');});
    var bodyRect=body.getBoundingClientRect(),leftCell=$('.ds-cell-l:not(.ds-cell-empty)',body),rightCell=$('.ds-cell-r:not(.ds-cell-empty)',body),divider=$('.ds-celldiv',body),left=leftCell?leftCell.getBoundingClientRect().right-bodyRect.left:(divider?divider.getBoundingClientRect().left-bodyRect.left:bodyRect.width/2-16),right=rightCell?rightCell.getBoundingClientRect().left-bodyRect.left:(divider?divider.getBoundingClientRect().right-bodyRect.left:bodyRect.width/2+16);
    return {regions:regions,geom:{gutterLeft:annotationRound(left),gutterRight:annotationRound(Math.max(left,right)),width:annotationRound(bodyRect.width),height:annotationRound(bodyRect.height)}};
  }
  function annotationSvgElement(name,attrs){var node=document.createElementNS('http://www.w3.org/2000/svg',name);Object.keys(attrs).forEach(function(key){node.setAttribute(key,String(attrs[key]));});return node;}
  function paintAnnotations(body,shapes,geom,trace){
    var svg=annotationSvgElement('svg',{class:'ds-annot'+(trace?' is-tracing':''),'aria-hidden':'true',width:geom.width,height:geom.height,viewBox:'0 0 '+geom.width+' '+geom.height});
    shapes.boxes.forEach(function(box){svg.appendChild(annotationSvgElement('rect',{class:'ds-annot-box ds-annot-box-'+box.side+(box.dashed?' is-dashed':''),pathLength:1,x:box.x,y:box.y,width:box.w,height:box.h,rx:5,ry:5}));});
    shapes.arrows.forEach(function(arrow){svg.appendChild(annotationSvgElement('path',{class:'ds-annot-arrow ds-annot-arrow-right'+(arrow.dashed?' is-dashed':''),pathLength:1,d:arrow.d}));var h=arrow.head,open=h.open?'M-7 -5 L0 0 L-7 5':'M-7 -5 L0 0 L-7 5 Z';svg.appendChild(annotationSvgElement('path',{class:'ds-annot-head',d:open,transform:'translate('+h.x+' '+h.y+') rotate('+h.angle+')'}));});
    shapes.tags.forEach(function(tag){svg.appendChild(annotationSvgElement('rect',{class:'ds-annot-tag-bg-'+tag.side,x:tag.x,y:tag.y-8,width:tag.w,height:16,rx:3,ry:3}));var text=annotationSvgElement('text',{class:'ds-annot-tag-text',x:tag.x+9,y:tag.y+3.5});text.textContent=tag.text;svg.appendChild(text);});
    body.appendChild(svg);
  }
  function clearAnnotations(){
    if(annotationFrame){cancelAnimationFrame(annotationFrame);annotationFrame=0;}
    if(annotationObserver){annotationObserver.disconnect();annotationObserver=null;}
    $all('.ds-annot').forEach(function(svg){svg.remove();});
    clearAnnotationTagLanes(document);
  }
  function renderAnnotations(panel){
    if(!panel||panel.hidden)return;
    var holder=$('[data-story-diff]',panel),split=holder&&$('[data-split-inner]',holder);if(!holder||!split||split.hidden)return;
    var body=$('.ds-diffbody',split),data=$('[data-annotations]',split);if(!body||!data)return;
    $('.ds-annot',body)?.remove();var spec;try{spec=JSON.parse(data.textContent||'{}');}catch(e){return;}
    if(!body._dsFlow&&body.classList.contains('ds-diffbody-cols'))measureSplitFlow(body);
    prepareAnnotationTagLanes(body,spec);
    var measured=measureAnnotations(body,spec),shapes=computeAnnotations(spec,measured.regions,measured.geom),trace=!prefersReducedMotion()&&panel.getAttribute('data-annot-traced')!=='1';paintAnnotations(body,shapes,measured.geom,trace);panel.setAttribute('data-annot-traced','1');
    if(typeof ResizeObserver==='function'){
      if(annotationObserver)annotationObserver.disconnect();
      annotationObserver=new ResizeObserver(function(){scheduleAnnotations(panel);});annotationObserver.observe(body);
    }
  }
  function scheduleAnnotations(panel){
    if(annotationFrame)cancelAnimationFrame(annotationFrame);
    annotationFrame=requestAnimationFrame(function(){annotationFrame=0;renderAnnotations(panel);});
  }
  function syncActiveAnnotations(){var panel=stepPanels&&stepPanels[active];clearAnnotations();if(panel){panel.removeAttribute('data-annot-traced');scheduleAnnotations(panel);}}
  function openMoveTargetFile(file,line){
    if(!file)return false;setView('files');
    for(var i=0;i<filePanels.length;i++)if(filePanels[i].getAttribute('data-file')===file){
      selectFile(i);var panel=filePanels[i];loadFilePanel(panel).then(function(){var row=$('[data-side="right"][data-line="'+line+'"]',panel)||$('[data-line="'+line+'"]',panel);if(row)scrollReviewRowVertically(row,{instant:true});});return true;
    }
    return false;
  }
  function scrollReviewRowVertically(row,opts){
    if(!row)return false;
    var scroller=closest(row,'.ds-diffscroll')||closest(row,'.ds-filedetail');
    if(!scroller)return false;
    var sr=scroller.getBoundingClientRect(),rr=row.getBoundingClientRect(),ft=flowRowTop(row);
    var top=ft?ft.top-(scroller.clientHeight-ft.h)/2:scroller.scrollTop+(rr.top-sr.top)-(scroller.clientHeight-rr.height)/2;
    try{scroller.scrollTo({top:Math.max(0,top),behavior:(opts&&opts.instant)||prefersReducedMotion()?'auto':'smooth'});}
    catch(e){scroller.scrollTop=Math.max(0,top);}
    return true;
  }
  function visibleDiffRoot(holder){
    var fullInner=$('[data-full-inner]',holder),splitInner=$('[data-split-inner]',holder),diffInner=$('[data-diff-inner]',holder);
    if(fullInner&&!fullInner.hidden)return fullInner;
    if(splitInner&&!splitInner.hidden)return splitInner;
    return diffInner;
  }
  function diffResponseText(r){
    if(!r.ok){var err=new Error('Diff request failed');err.status=r.status;err.reloadRequired=r.status===409;throw err;}
    return r.text();
  }
  function diffFailureDetail(err){
    if(err&&err.reloadRequired)return 'The review changed while this page was open. Reload to continue safely.';
    return err&&err.status?'The server returned HTTP '+err.status+'.':'Check your connection and try again.';
  }
  function showDiffLoadError(inner,label,mode,err){
    inner.removeAttribute('data-loaded');inner.setAttribute('aria-busy','false');inner.textContent='';
    var note=document.createElement('div');note.className='ds-diffnote ds-differror';note.setAttribute('role','alert');
    var title=document.createElement('span');title.className='ds-differror-title';title.textContent='Could not load the '+label+'.';
    var detail=document.createElement('span');detail.className='ds-differror-detail';detail.textContent=diffFailureDetail(err);
    var retry=document.createElement('button');retry.type='button';retry.className='ds-diffretry';if(err&&err.reloadRequired){retry.setAttribute('data-review-reload','');retry.textContent='Reload review';retry.setAttribute('aria-label','Reload review with current evidence');}else{retry.setAttribute('data-mode',mode);retry.textContent='Try again';retry.setAttribute('aria-label','Retry loading the '+label);}
    note.appendChild(title);note.appendChild(detail);note.appendChild(retry);inner.appendChild(note);
  }
  function splitPercent(holder){
    var raw=holder&&holder.style?holder.style.getPropertyValue('--ds-split'):'';
    if(!raw&&holder&&window.getComputedStyle)raw=window.getComputedStyle(holder).getPropertyValue('--ds-split');
    var pct=parseFloat(raw||'50');if(isNaN(pct))pct=50;return Math.max(0,Math.min(100,pct));
  }
  function makeSplitPaneScroller(holder,side,label){
    var scroller=el('div','ds-pane-scroll ds-pane-scroll-'+side);
    scroller.setAttribute('data-split-pane-scroll',side);
    scroller.setAttribute('role','region');scroller.setAttribute('aria-label',label);scroller.tabIndex=0;
    scroller.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End');
    scroller.appendChild(el('div','ds-pane-scroll-track'));
    scroller.addEventListener('scroll',function(){
      holder.style.setProperty(side==='left'?'--ds-left-scroll':'--ds-right-scroll',scroller.scrollLeft+'px');
      scheduleAnnotations(closest(holder,'.ds-step'));
    });
    scroller.addEventListener('keydown',function(e){
      if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='Home'&&e.key!=='End')return;
      var max=Math.max(0,scroller.scrollWidth-scroller.clientWidth),next=scroller.scrollLeft;
      if(e.key==='Home')next=0;else if(e.key==='End')next=max;else next+=e.key==='ArrowRight'?40:-40;
      scroller.scrollLeft=Math.max(0,Math.min(max,next));
      holder.style.setProperty(side==='left'?'--ds-left-scroll':'--ds-right-scroll',scroller.scrollLeft+'px');
      scheduleAnnotations(closest(holder,'.ds-step'));e.preventDefault();e.stopPropagation();
    });
    return scroller;
  }
  function ensureSplitPaneScrollbars(holder){
    var split=$('[data-split-inner]:not([hidden])',holder);if(!split)return null;
    var bars=$('[data-split-scrollbars]',split);if(bars)return bars;
    bars=el('div','ds-split-scrollbars');bars.setAttribute('data-split-scrollbars','');
    bars.appendChild(makeSplitPaneScroller(holder,'left','Scroll before pane horizontally'));
    var divider=el('span','ds-split-scroll-divider');divider.setAttribute('aria-hidden','true');bars.appendChild(divider);
    bars.appendChild(makeSplitPaneScroller(holder,'right','Scroll after pane horizontally'));
    split.appendChild(bars);return bars;
  }
  function splitPaneTrackWidth(split,side){
    var maxCode=0,gutter=0;
    $all('.ds-cell-'+(side==='left'?'l':'r')+':not(.ds-cell-empty)',split).forEach(function(cell){
      var code=$('.ds-code',cell);if(!code)return;
      maxCode=Math.max(maxCode,code.scrollWidth);
      gutter=Math.max(gutter,Math.max(0,cell.clientWidth-code.clientWidth));
    });
    return Math.ceil(maxCode+gutter);
  }
  function resetSplitPaneScroll(holder,bars){
    ['left','right'].forEach(function(side){
      var scroller=$('[data-split-pane-scroll="'+side+'"]',bars);if(scroller)scroller.scrollLeft=0;
      holder.style.removeProperty(side==='left'?'--ds-left-scroll':'--ds-right-scroll');
    });
  }
  // Split panes clip their code and scroll through the bars pinned under the
  // diff, so a sideways trackpad swipe, a thumb wheel or shift+wheel anywhere
  // over a pane drives that pane's bar. The pane is found by pointer position,
  // not the event target: gutters, filler rows and the annotation layer sit
  // over the code too. Vertical scrolling falls through to the page untouched.
  function splitUnderPointer(x,y){
    var found=null;
    $all('.ds-split-mode [data-split-inner]:not([hidden])').some(function(split){
      if(!split.offsetParent)return false;
      var r=split.getBoundingClientRect();
      if(x<r.left||x>r.right||y<r.top||y>r.bottom)return false;
      found=split;return true;
    });
    return found;
  }
  function onSplitPaneWheel(e){
    if(e.ctrlKey||document.body.classList.contains('ds-line-wrap'))return;
    var dx=e.deltaX;if(!dx&&e.shiftKey)dx=e.deltaY;
    if(!dx||Math.abs(dx)<Math.abs(e.shiftKey?0:e.deltaY))return;
    var split=splitUnderPointer(e.clientX,e.clientY);if(!split)return;
    var divider=$('.ds-celldiv[role="separator"]',split);if(!divider)return;
    var d=divider.getBoundingClientRect(),side=e.clientX<d.left+d.width/2?'left':'right';
    var scroller=$('[data-split-scrollbars]:not([hidden]) [data-split-pane-scroll="'+side+'"]',split);
    if(!scroller||scroller.classList.contains('is-idle'))return;
    var unit=e.deltaMode===1?16:e.deltaMode===2?Math.max(scroller.clientWidth,1):1;
    var max=Math.max(0,scroller.scrollWidth-scroller.clientWidth),next=Math.max(0,Math.min(max,scroller.scrollLeft+dx*unit));
    if(next===scroller.scrollLeft)return;
    e.preventDefault();scroller.scrollLeft=next;
  }
  // Split columns share grid tracks. Missing halves leave a track empty;
  // paired rows keep the same height even when only one side wraps.
  // Scrolling never changes code geometry or repaints the divider.
  var flowFrame=0,flowObserver=null,bandFadeSeq=0;
  function flowBodies(root){return $all('.ds-diffbody-cols',root||document).filter(function(body){return !!body.offsetParent;});}
  function flowScroller(body){return closest(body,'.ds-diffscroll')||closest(body,'.ds-filedetail');}
  function flowRi(node){var v=node&&node.getAttribute?node.getAttribute('data-ri'):null;if(v==null)return null;var n=parseFloat(v);return isNaN(n)?null:n;}
  function flowItems(col){
    var out=[],kids=col.children;
    for(var i=0;i<kids.length;i++){var k=kids[i];if(k.hidden||k.classList.contains('ds-annot')||k.classList.contains('ds-fill'))continue;out.push({el:k,y:k.offsetTop,h:k.offsetHeight,ri:flowRi(k),change:flowChangeHalf(k),moved:k.classList.contains('ds-row-moved'),callout:k.classList.contains('ds-annot-callout'),annotated:k.hasAttribute('data-move')});}
    return out;
  }
  function flowChangeHalf(elm){var c=elm.classList;return c.contains('ds-row-add')||c.contains('ds-row-del')||c.contains('ds-row-pair')||c.contains('ds-row-pair-l');}
  // Merge both columns into shared tracks by row index. Within a change, the
  // one-sided rows are queued per side and laid side by side from the same
  // track, so a replacement never becomes a staircase of deletions above
  // additions. Anything two-sided or unindexed ends the run, except a move
  // callout: it joins its side's queue so it sits right under the box it
  // explains instead of after the whole run's filler.
  function flowEntries(L,R){
    var entries=[],lq=[],rq=[],i=0,j=0;
    function flush(){while(lq.length||rq.length)entries.push({l:lq.shift()||null,r:rq.shift()||null});}
    while(i<L.length||j<R.length){
      var a=L[i],b=R[j],e;
      if(a&&a.ri==null&&a.callout&&lq.length){lq.push(a);i++;continue;}
      if(b&&b.ri==null&&b.callout&&rq.length){rq.push(b);j++;continue;}
      if(a&&a.ri==null){e={l:a,r:null};i++;}
      else if(b&&b.ri==null){e={l:null,r:b};j++;}
      else if(a&&(!b||a.ri<b.ri)){e={l:a,r:null};i++;}
      else if(b&&(!a||b.ri<a.ri)){e={l:null,r:b};j++;}
      else{e={l:a,r:b};i++;j++;}
      var one=e.l&&e.r?null:e.l||e.r;
      if(one&&one.ri!=null&&one.change){(e.l?lq:rq).push(one);continue;}
      flush();entries.push(e);
    }
    flush();
    return entries;
  }
  // A track with rows on one side only gets a hatched filler on the other,
  // so the empty space reads as "nothing here" rather than a broken layout.
  // Fillers are inert: no code, no line numbers, skipped by flowItems.
  function syncFlowFillers(col,entries,side){
    var have=$all(':scope>.ds-fill',col),n=0;
    entries.forEach(function(e,index){
      var other=e[side==='l'?'r':'l'];
      if(e[side]||!other||other.el.classList.contains('ds-scoperow'))return;
      var f=have[n++];
      if(!f){f=el('div','ds-fill');f.setAttribute('aria-hidden','true');col.appendChild(f);}
      var row=String(index+1);if(f.style.gridRow!==row)f.style.gridRow=row;
    });
    for(;n<have.length;n++)have[n].remove();
  }
  function flowBands(entries){
    var bands=[],cur=null;
    for(var k=0;k<entries.length;k++){
      var e=entries[k];
      if(!e.change){cur=null;continue;}
      if(!cur){cur={idx:k,l0:null,l1:null,r0:null,r1:null,adds:0,dels:0,moved:0,rows:0,annotL:false,annotR:false};bands.push(cur);}
      if(e.l&&e.l.annotated)cur.annotL=true;if(e.r&&e.r.annotated)cur.annotR=true;
      cur.rows++;if((!e.l||e.l.moved)&&(!e.r||e.r.moved))cur.moved++;
      if(e.l){if(cur.l0==null)cur.l0=e.l.y;cur.l1=e.l.y+e.l.h;}
      if(e.r){if(cur.r0==null)cur.r0=e.r.y;cur.r1=e.r.y+e.r.h;}
      if(e.l&&e.r){cur.adds++;cur.dels++;}else if(e.l)cur.dels++;else cur.adds++;
    }
    return bands;
  }
  function measureSplitFlow(body){
    var l=$(':scope>.ds-col-l',body),r=$(':scope>.ds-col-r',body),d=$(':scope>.ds-celldiv',body),scroller=flowScroller(body);
    if(!l||!r||!scroller){body._dsFlow=null;body.style.removeProperty('height');return null;}
    var entries=flowEntries(flowItems(l),flowItems(r)),t=0;
    entries.forEach(function(e){e.change=!!((e.l&&e.l.change)||(e.r&&e.r.change));});
    // Assign matching row indices before reading the browser's shared tracks.
    // CSS subgrid owns sizing, so wrapping and inline comments cannot start a
    // ResizeObserver feedback loop through explicit pixel heights.
    var tracks=Array(Math.max(1,entries.length)).fill('auto').join(' ');
    if(body.style.gridTemplateRows!==tracks)body.style.gridTemplateRows=tracks;
    entries.forEach(function(e,index){
      ['l','r'].forEach(function(side){var it=e[side];if(it&&it.el.style.gridRow!==String(index+1))it.el.style.gridRow=String(index+1);});
    });
    syncFlowFillers(l,entries,'l');syncFlowFillers(r,entries,'r');
    t=0;
    entries.forEach(function(e){
      ['l','r'].forEach(function(side){var it=e[side];if(it){it.y=it.el.offsetTop;it.h=it.el.offsetHeight;}});
      e.t=t;e.h=Math.max(e.l?e.l.h:0,e.r?e.r.h:0);t+=e.h;
    });
    var flow={l:l,r:r,d:d,scroller:scroller,entries:entries,height:t,colH:{l:l.offsetHeight,r:r.offsetHeight},bands:flowBands(entries),shift:{l:0,r:0}};
    body._dsFlow=flow;
    return flow;
  }
  // One bridge per change block, in divider coordinates. Rows already share
  // tracks, so the bridge just carries the row tint across the gutter: its
  // top and bottom edges curve from the left block's extent to the right's,
  // which is flat when the two match and a gentle S where one side runs
  // longer. A side with no rows takes the other side's extent, so a pure
  // deletion or addition is a plain rectangle that fades toward the empty side.
  function flowBridgePath(b,w){
    var l0=b.l1==null?b.r0:b.l0,l1=b.l1==null?b.r1:b.l1,r0=b.r1==null?l0:b.r0,r1=b.r1==null?l1:b.r1,c=w/2,f=function(n){return n.toFixed(1);};
    return 'M0 '+f(l0)+' C'+f(c)+' '+f(l0)+' '+f(c)+' '+f(r0)+' '+w+' '+f(r0)+' V'+f(r1)+' C'+f(c)+' '+f(r1)+' '+f(c)+' '+f(l1)+' 0 '+f(l1)+' Z';
  }
  // A one-sided block has nothing to bridge to, so its band fades out toward
  // the empty side instead of painting a solid block beside the filler.
  function bandFade(svg,fades,kind){
    if(fades[kind])return fades[kind];
    var id='ds-band-fade-'+(++bandFadeSeq),defs=$('defs',svg);
    if(!defs){defs=annotationSvgElement('defs',{});svg.insertBefore(defs,svg.firstChild);}
    var grad=annotationSvgElement('linearGradient',{id:id,x1:kind==='add'?0:1,x2:kind==='add'?1:0,y1:0,y2:0});
    grad.appendChild(annotationSvgElement('stop',{offset:0,class:'ds-band-stop ds-band-stop-'+kind,'stop-opacity':0}));
    grad.appendChild(annotationSvgElement('stop',{offset:1,class:'ds-band-stop ds-band-stop-'+kind}));
    defs.appendChild(grad);fades[kind]=id;return id;
  }
  function flowSvgClear(svg){while(svg.firstChild)svg.removeChild(svg.firstChild);}
  function paintFlowBands(flow,shift,winTop,winH){
    var svg=$('.ds-bands',flow.d);if(!svg)return;
    var w=flow.d.clientWidth||32,h=Math.ceil(winH);
    // Pin the drawing to its box. `clientWidth` is rounded, the divider's real
    // width can be fractional, and with the default aspect-ratio fit a 1px
    // mismatch scales every band and centres it — the bands drift down and
    // shrink the further they are from the top of the file.
    svg.setAttribute('width',String(w));svg.setAttribute('height',String(h));svg.setAttribute('viewBox','0 0 '+w+' '+h);
    svg.setAttribute('preserveAspectRatio','none');svg.style.height=h+'px';
    svg.style.transform='translateY('+winTop+'px)';
    flowSvgClear(svg);
    var fades={};
    flow.bands.forEach(function(b){
      var y=function(v,s){return v==null?null:v+s-winTop;};
      var g={l0:y(b.l0,shift.l),l1:y(b.l1,shift.l),r0:y(b.r0,shift.r),r1:y(b.r1,shift.r)};
      if(Math.max(g.l1==null?-Infinity:g.l1,g.r1==null?-Infinity:g.r1)<-40||Math.min(g.l0==null?Infinity:g.l0,g.r0==null?Infinity:g.r0)>winH+40)return;
      // An annotation arrow already bridges a block boxed on both sides; a
      // tinted band under it reads as a smudge, not a link.
      if(b.annotL&&b.annotR)return;
      var kind=b.moved===b.rows?'moved':b.dels&&!b.adds?'del':b.adds&&!b.dels?'add':'pair';
      var path=annotationSvgElement('path',{class:'ds-band ds-band-'+kind,d:flowBridgePath(g,w)});
      if(kind==='add'||kind==='del')path.style.fill='url(#'+bandFade(svg,fades,kind)+')';
      svg.appendChild(path);
    });
  }
  function applySplitFlow(body){
    var flow=body._dsFlow;if(!flow||!body.offsetParent)return;
    paintFlowBands(flow,flow.shift,0,flow.height);
  }
  function scheduleFlow(){
    if(flowFrame)return;
    flowFrame=requestAnimationFrame(function(){
      flowFrame=0;
      flowBodies().forEach(function(body){
        if(!measureSplitFlow(body))return;watchFlow(body);
        applySplitFlow(body);
      });
    });
  }
  function watchFlow(body){
    if(typeof ResizeObserver!=='function'||body._dsFlowObserved)return;
    var flow=body._dsFlow;if(!flow)return;body._dsFlowObserved=true;
    // Both columns resize with their shared tracks when content changes.
    if(!flowObserver)flowObserver=new ResizeObserver(function(records){
      var seen=[];
      records.forEach(function(rec){var b=closest(rec.target,'.ds-diffbody-cols');if(b&&seen.indexOf(b)<0)seen.push(b);});
      seen.forEach(function(b){if(b.offsetParent){measureSplitFlow(b);applySplitFlow(b);}});
    });
    flowObserver.observe(flow.l);flowObserver.observe(flow.r);
  }
  function syncSplitFlow(holder){
    var root=holder?visibleDiffRoot(holder):null;if(!root)return;
    $all('.ds-diffbody-cols',root).forEach(function(body){
      var flow=measureSplitFlow(body);if(!flow)return;
      watchFlow(body);applySplitFlow(body);
    });
  }
  // Use the shared track for focus navigation, independent of which side
  // contains the selected line.
  function flowRowTop(row){
    var body=closest(row,'.ds-diffbody-cols'),flow=body&&body._dsFlow;if(!flow)return null;
    var es=flow.entries;
    for(var k=0;k<es.length;k++){
      var e=es[k];
      if((e.l&&e.l.el===row)||(e.r&&e.r.el===row)){
        var sr=flow.scroller.getBoundingClientRect(),br=body.getBoundingClientRect();
        return {scroller:flow.scroller,top:flow.scroller.scrollTop+(br.top-sr.top)+e.t,h:e.h};
      }
    }
    return null;
  }
  function flowTwin(row){
    var body=closest(row,'.ds-diffbody-cols'),ri=row.getAttribute('data-ri');if(!body||ri==null)return null;
    var col=closest(row,'.ds-col'),other=col&&col.classList.contains('ds-col-l')?$(':scope>.ds-col-r',body):$(':scope>.ds-col-l',body);
    return other?$(':scope>[data-ri="'+ri+'"]',other):null;
  }
  function flowCanonicalGap(mirror){
    var body=closest(mirror,'.ds-diffbody-cols'),ri=mirror.getAttribute('data-ri');if(!body||ri==null)return null;
    return $(':scope>.ds-col-r>[data-gap][data-ri="'+ri+'"]',body);
  }
  function flowMirrorGap(gap){
    var body=closest(gap,'.ds-diffbody-cols'),ri=gap.getAttribute('data-ri');if(!body||ri==null)return null;
    return $(':scope>.ds-col-l>[data-gap-mirror][data-ri="'+ri+'"]',body);
  }
  function removeFlowGap(gap,mirror){gap.remove();if(mirror)mirror.remove();}
  // The enclosing-declaration label stands in for the code hidden above a hunk.
  // Once a gap is expanded that code is on screen, so a label with a real row
  // above it is stale: it would read as a declaration reopening mid-body.
  function pruneScopeRows(holder){
    if(!holder)return;
    $all('.ds-scoperow',holder).forEach(function(scope){
      var prev=scope.previousElementSibling;
      if(prev&&!prev.classList.contains('ds-hunkgap'))scope.remove();
    });
  }
  // Expanded context arrives as two side fragments with local indices. They
  // take fractions between the gap and its neighbour, then every index in the
  // body is renumbered so the order stays integral for the next expansion.
  function insertFlowFragments(gap,mirror,leftFrag,rightFrag,mode){
    var body=closest(gap,'.ds-diffbody-cols');if(!body)return;
    var gapRi=flowRi(gap),all=$all('[data-ri]',body).map(flowRi).filter(function(v){return v!=null;}),lo,hi;
    if(mode==='up'){lo=gapRi;hi=Infinity;all.forEach(function(v){if(v>gapRi&&v<hi)hi=v;});if(hi===Infinity)hi=gapRi+1;}
    else{hi=gapRi;lo=-Infinity;all.forEach(function(v){if(v<gapRi&&v>lo)lo=v;});if(lo===-Infinity)lo=gapRi-1;}
    var n=0;
    [leftFrag,rightFrag].forEach(function(frag){if(!frag)return;for(var i=0;i<frag.children.length;i++){var v=flowRi(frag.children[i]);if(v!=null&&v+1>n)n=v+1;}});
    var rebase=function(frag){if(!frag)return;[].slice.call(frag.children).forEach(function(k){var v=flowRi(k);if(v!=null)k.setAttribute('data-ri',String(lo+(hi-lo)*(v+1)/(n+1)));});};
    rebase(leftFrag);rebase(rightFrag);
    var place=function(frag,anchor){if(!frag||!anchor||!anchor.parentNode)return;var parent=anchor.parentNode,ref=mode==='up'?anchor.nextSibling:anchor;while(frag.firstChild)parent.insertBefore(frag.firstChild,ref);};
    place(rightFrag,gap);place(leftFrag,mirror);
    var nodes=$all('[data-ri]',body).map(function(node,i){return {el:node,ri:flowRi(node),i:i};}).sort(function(a,b){return (a.ri-b.ri)||(a.i-b.i);}),next=-1,last=null;
    nodes.forEach(function(x){if(last===null||x.ri!==last){next++;last=x.ri;}x.el.setAttribute('data-ri',String(next));});
  }
  function syncSplitPaneLayout(holder){
    if(!holder)return;
    // A single-column body (a new file) has nothing to keep in step and wants
    // the card at content width so long lines scroll natively.
    var split=$('[data-split-inner]:not([hidden])',holder),active=!!split&&!!$('.ds-diffbody-cols',split);
    holder.classList.toggle('ds-split-mode',active);
    var oldBars=$('[data-split-scrollbars]',holder);
    if(!active){if(oldBars)oldBars.hidden=true;syncSplitFlow(holder);return;}
    var divider=$('.ds-celldiv[role="separator"]',split);if(divider)setSplitDividerValue(divider,splitPercent(holder));
    var bars=ensureSplitPaneScrollbars(holder);if(!bars)return;
    if(document.body.classList.contains('ds-line-wrap')){resetSplitPaneScroll(holder,bars);bars.hidden=true;syncSplitFlow(holder);return;}
    bars.hidden=false;
    var overflow=false;
    ['left','right'].forEach(function(side){
      var scroller=$('[data-split-pane-scroll="'+side+'"]',bars),track=$('.ds-pane-scroll-track',scroller);
      var width=splitPaneTrackWidth(split,side);track.style.width=width+'px';
      var idle=width<=scroller.clientWidth+1;scroller.classList.toggle('is-idle',idle);overflow=overflow||!idle;
      holder.style.setProperty(side==='left'?'--ds-left-scroll':'--ds-right-scroll',scroller.scrollLeft+'px');
    });
    bars.hidden=!overflow;
    syncSplitFlow(holder);
  }
  function syncSplitPaneLayouts(root){
    $all('.ds-filepanel,.ds-diff',root||document).forEach(syncSplitPaneLayout);
  }
  function setSplitDividerValue(divider,pct){
    var rounded=Math.round(pct);
    divider.setAttribute('aria-valuenow',String(rounded));
    divider.setAttribute('aria-valuetext',rounded+'% before, '+(100-rounded)+'% after');
  }
  function handleSplitDividerKey(e){
    var divider=closest(e.target,'.ds-celldiv[role="separator"]');if(!divider)return false;
    var key=e.key;if(key!=='ArrowLeft'&&key!=='ArrowRight'&&key!=='Home'&&key!=='End')return false;
    var holder=closest(divider,'.ds-filepanel,.ds-diff');if(!holder)return false;
    var pct=splitPercent(holder),step=e.shiftKey?10:4;
    if(key==='Home')pct=0;else if(key==='End')pct=100;else pct+=key==='ArrowRight'?step:-step;
    pct=Math.max(0,Math.min(100,pct));holder.style.setProperty('--ds-split',String(pct));
    try{localStorage.setItem('ds-split',String(pct));}catch(err){}
    setSplitDividerValue(divider,pct);syncSplitPaneLayout(holder);scheduleAnnotations(closest(holder,'.ds-step'));e.preventDefault();e.stopPropagation();return true;
  }
  function prepareSplitDivider(holder){
    if(!holder)return;
    var root=visibleDiffRoot(holder)||holder,dividers=$all('.ds-celldiv',root);
    dividers.forEach(function(divider){divider.tabIndex=-1;divider.setAttribute('aria-hidden','true');divider.removeAttribute('role');divider.removeAttribute('aria-label');divider.removeAttribute('aria-orientation');divider.removeAttribute('aria-valuemin');divider.removeAttribute('aria-valuemax');divider.removeAttribute('aria-valuenow');divider.removeAttribute('aria-valuetext');divider.removeAttribute('aria-keyshortcuts');});
    if(!dividers.length)return;
    var divider=dividers[0];divider.tabIndex=0;divider.removeAttribute('aria-hidden');divider.setAttribute('role','separator');divider.setAttribute('aria-label','Resize before and after panes');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-valuemin','0');divider.setAttribute('aria-valuemax','100');divider.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End');divider.title='Resize panes with left and right arrow keys';setSplitDividerValue(divider,splitPercent(holder));
    if(!divider._dsSplitKeyboard){divider._dsSplitKeyboard=true;divider.addEventListener('keydown',handleSplitDividerKey);divider.addEventListener('focus',function(){setSplitDividerValue(divider,splitPercent(holder));});}
  }
  function changeRows(holder){
    var root=visibleDiffRoot(holder);if(!root)return [];
    var rows=$all('.ds-row-add,.ds-row-del,.ds-row-pair',root);
    if(!$('.ds-diffbody-cols',root))return rows;
    // Two columns put every left row before every right row in the DOM; the
    // reading order is the timeline index.
    return rows.map(function(r,i){return {r:r,ri:flowRi(r),i:i};}).sort(function(a,b){return (a.ri==null||b.ri==null)?a.i-b.i:(a.ri-b.ri)||(a.i-b.i);}).map(function(x){return x.r;});
  }
  function updateChangeNav(holder){
    if(!holder)return;
    prepareSplitDivider(holder);
    var nav=$('[data-change-nav]',holder);if(!nav)return;
    nav.setAttribute('role','group');nav.setAttribute('aria-label','Change navigation');
    if(typeof syncViewed==='function')syncViewed();
    var rows=changeRows(holder),idx=parseInt(holder.getAttribute('data-change-index')||'0',10);
    if(!rows.length){holder.setAttribute('data-change-index','0');nav.hidden=true;return;}
    if(isNaN(idx)||idx<0)idx=0;if(idx>rows.length-1)idx=rows.length-1;
    holder.setAttribute('data-change-index',String(idx));
    nav.hidden=false;
    var count=$('[data-change-count]',nav);if(count){count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');count.textContent=(idx+1)+' / '+rows.length;}
    var prev=$('[data-change-prev]',nav),next=$('[data-change-next]',nav);
    if(prev)prev.disabled=rows.length<2;
    if(next)next.disabled=rows.length<2;
  }
  function jumpToChange(holder,index,opts){
    if(!holder)return false;
    var rows=changeRows(holder);
    if(!rows.length){updateChangeNav(holder);return false;}
    var idx=Math.max(0,Math.min(rows.length-1,Number(index)||0));
    holder.setAttribute('data-change-index',String(idx));
    updateChangeNav(holder);
    var row=rows[idx];if(!row)return false;
    $all('.ds-row-add,.ds-row-del,.ds-row-pair',holder).forEach(function(r){r.classList.remove('is-change-jump');r.removeAttribute('aria-current');});
    $all('.ds-row-pair-l.is-change-jump',holder).forEach(function(r){r.classList.remove('is-change-jump');});
    row.classList.add('is-change-jump');
    var twin=flowTwin(row);if(twin)twin.classList.add('is-change-jump');
    row.setAttribute('aria-current','true');
    scrollReviewRowVertically(row,opts);
    if(opts&&opts.focus&&row.focus){try{row.focus({preventScroll:true});}catch(e){row.focus();}}
    return true;
  }
  function jumpRelativeChange(holder,delta,opts){
    if(!holder)return false;
    var rows=changeRows(holder);
    if(!rows.length){updateChangeNav(holder);return false;}
    var idx=parseInt(holder.getAttribute('data-change-index')||'0',10);
    if(isNaN(idx))idx=0;
    idx=(idx+delta+rows.length)%rows.length;
    return jumpToChange(holder,idx,opts);
  }
  function jumpToFirstChange(holder){
    if(!holder)return false;
    holder.setAttribute('data-change-index','0');
    updateChangeNav(holder);
    return jumpToChange(holder,0,{instant:true});
  }
  function activeChangeHolder(target){
    var holder=closest(target,'.ds-filepanel')||closest(target,'.ds-diff');
    if(holder&&!holder.hidden)return holder;
    if(filesView&&!filesView.hidden)return filePanels[selectedFile]||$('.ds-filepanel:not([hidden])');
    if(tourView&&!tourView.hidden){
      var panel=stepPanels&&stepPanels[active];
      return panel?$('.ds-diff',panel):null;
    }
    return null;
  }
  function handleChangeShortcut(e){
    if(isTextEntryTarget(e.target))return false;
    var dir=e.key==='ArrowRight'||e.key==='n'||e.key==='N'||e.key===']'?1:e.key==='ArrowLeft'||e.key==='p'||e.key==='P'||e.key==='['?-1:0;
    if(!dir)return false;
    var holder=activeChangeHolder(e.target);
    if(!holder||!changeRows(holder).length)return false;
    e.preventDefault();
    jumpRelativeChange(holder,dir,{focus:true});
    return true;
  }

  function setMode(btn,opts){
    var holder=closest(btn,'.ds-filepanel')||closest(btn,'.ds-diff');if(!holder)return;
    var file=holder.getAttribute('data-file');
    var mode=btn.getAttribute('data-mode');
    var diffInner=$('[data-diff-inner]',holder),fullInner=$('[data-full-inner]',holder),splitInner=$('[data-split-inner]',holder),hint=$('[data-difthint]',holder);
    if(holder.classList.contains('ds-filepanel')&&!(opts&&opts.persist===false)){try{localStorage.setItem('ds-files-mode',mode);}catch(e){}}
    var needsLoad=mode==='full'?!!(fullInner&&!fullInner.getAttribute('data-loaded')&&file):mode==='split'?!!(splitInner&&!splitInner.getAttribute('data-loaded')&&file):false;
    if(needsLoad&&mode==='full')loadFull(fullInner,file);else if(needsLoad&&mode==='split')loadSplit(splitInner,file);
    var update=function(){
      $all('.ds-modetoggle button',holder).forEach(function(b){var active=b.getAttribute('data-mode')===mode;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',active?'true':'false');});
      if(mode==='full'){
        if(hint){if(!hint.getAttribute('data-diffhint'))hint.setAttribute('data-diffhint',hint.textContent);hint.textContent='Complete file';}
        if(diffInner)diffInner.hidden=true;if(splitInner)splitInner.hidden=true;if(fullInner)fullInner.hidden=false;
      }else if(mode==='split'&&splitInner){
        if(hint&&hint.getAttribute('data-diffhint'))hint.textContent=hint.getAttribute('data-diffhint');
        if(diffInner)diffInner.hidden=true;if(fullInner)fullInner.hidden=true;splitInner.hidden=false;
      }else{
        if(hint&&hint.getAttribute('data-diffhint'))hint.textContent=hint.getAttribute('data-diffhint');
        if(fullInner)fullInner.hidden=true;if(splitInner)splitInner.hidden=true;if(diffInner)diffInner.hidden=false;
      }
    };
    var transition=null;if(opts&&opts.persist===false)update();else transition=runWorkspaceTransition('mode',0,update);
    var finish=function(){updateChangeNav(holder);syncSplitPaneLayout(holder);if(!needsLoad)jumpToFirstChange(holder);if(mode==='split')scheduleAnnotations(closest(holder,'.ds-step'));else clearAnnotations();};
    if(transition&&transition.updateCallbackDone)Promise.resolve(transition.updateCallbackDone).then(finish,finish);else finish();
    if(typeof saveReviewPositionSoon==='function')saveReviewPositionSoon();
  }
  function loadFull(fullInner,file){
    fullInner.setAttribute('data-loaded','1');
    fullInner.setAttribute('aria-busy','true');
    // pi-lens-ignore: ast-grep:no-inner-html-js
    fullInner.innerHTML='<div class="ds-diffnote" role="status">Loading the full file…</div>';
    // pi-lens-ignore: ast-grep:no-inner-html-js
    fetch(reviewPageUrl('/api/fullfile?file='+encodeURIComponent(file))).then(diffResponseText).then(function(html){fullInner.setAttribute('aria-busy','false');fullInner.innerHTML=html;mountCommentPins(fullInner);var fh=closest(fullInner,'.ds-filepanel')||closest(fullInner,'.ds-diff');updateChangeNav(fh);syncSplitPaneLayout(fh);jumpToFirstChange(fh);}).catch(function(err){showDiffLoadError(fullInner,'full file','full',err);updateChangeNav(closest(fullInner,'.ds-filepanel')||closest(fullInner,'.ds-diff'));});
  }
  function loadSplit(splitInner,file){
    splitInner.setAttribute('data-loaded','1');
    splitInner.setAttribute('aria-busy','true');
    // pi-lens-ignore: ast-grep:no-inner-html-js
    splitInner.innerHTML='<div class="ds-diffnote" role="status">Loading the split view…</div>';
    fetch(reviewPageUrl('/api/diff/split?file='+encodeURIComponent(file))).then(diffResponseText).then(function(html){
      splitInner.setAttribute('aria-busy','false');
      // pi-lens-ignore: ast-grep:no-inner-html-js
      splitInner.innerHTML=html;
      mountCommentPins(splitInner);
      var h=closest(splitInner,'.ds-filepanel')||closest(splitInner,'.ds-diff');
      updateChangeNav(h);syncSplitPaneLayout(h);jumpToFirstChange(h);
    }).catch(function(err){
      showDiffLoadError(splitInner,'split view','split',err);
      updateChangeNav(closest(splitInner,'.ds-filepanel')||closest(splitInner,'.ds-diff'));
    });
  }
  function viewedKey(){return 'ds-viewed:'+(document.body.getAttribute('data-viewed-scope')||'');}
  var viewedFiles=Object.create(null);
  function reviewHashForFile(file){
    var hash='',conflict=false;
    function take(node){
      if(!node)return;var value=(node.getAttribute('data-review-hash')||'').trim();if(!value)return;
      if(hash&&hash!==value)conflict=true;else hash=value;
    }
    fileItems.forEach(function(item){if(item.getAttribute('data-goto-file')===file)take(item);});
    filePanels.forEach(function(panel){if(panel.getAttribute('data-file')===file)take(panel);});
    return conflict?'':hash;
  }
  function fileIsReviewed(file){var hash=reviewHashForFile(file);return !!hash&&viewedFiles[file]===hash;}
  function loadViewed(){
    viewedFiles=Object.create(null);
    try{
      var stored=JSON.parse(localStorage.getItem(viewedKey())||'{}');
      if(Array.isArray(stored)){
        stored.forEach(function(file){var hash=reviewHashForFile(file);if(hash)viewedFiles[file]=hash;});
        saveViewed();
      }else if(stored&&typeof stored==='object'){
        Object.keys(stored).forEach(function(file){if(typeof stored[file]==='string'&&stored[file])viewedFiles[file]=stored[file];});
      }
    }catch(e){}
  }
  function saveViewed(){try{localStorage.setItem(viewedKey(),JSON.stringify(viewedFiles));}catch(e){}}
  function invalidateChangedViewed(){
    var changed=false;
    Object.keys(viewedFiles).forEach(function(file){var hash=reviewHashForFile(file);if(!hash||viewedFiles[file]!==hash){delete viewedFiles[file];changed=true;}});
    if(changed)saveViewed();
  }
  function toggleViewed(file){
    if(!file)return;
    var hash=reviewHashForFile(file);
    if(!hash){toast('This file cannot be marked reviewed until its review fingerprint is available.');return;}
    if(viewedFiles[file]===hash)delete viewedFiles[file];else viewedFiles[file]=hash;
    saveViewed();syncViewed();
  }
  function formatReviewCount(value){return value>=10000?new Intl.NumberFormat('en-US').format(value):String(value);}
  function syncViewed(){
    var n=0,total=0;
    fileItems.forEach(function(it){
      var f=it.getAttribute('data-goto-file');if(!f)return;
      total++;
      var on=fileIsReviewed(f);if(on)n++;
      it.classList.toggle('is-viewed',on);
      it.classList.toggle('is-reviewed',on);
      it.setAttribute('data-reviewed',on?'true':'false');
      var states=$all('.ds-fileitem-flag,.ds-fileitem-regen',it).map(function(flag){return flag.getAttribute('title')||'';}).filter(Boolean);
      it.setAttribute('aria-label',[f,on?'reviewed':'not reviewed'].concat(states).join(', '));
    });
    $all('[data-viewed-toggle]').forEach(function(btn){
      var panel=closest(btn,'.ds-filepanel'),file=panel&&panel.getAttribute('data-file'),on=fileIsReviewed(file);
      btn.classList.toggle('is-active',on);
      btn.setAttribute('aria-pressed',on?'true':'false');
      btn.setAttribute('data-reviewed',on?'true':'false');
      btn.setAttribute('aria-label','Mark '+(file||'file')+(on?' unreviewed':' reviewed'));
      btn.setAttribute('title',(on?'Mark unreviewed':'Mark reviewed')+' (V)');
      var label=$('[data-viewed-label]',btn);if(label)label.textContent=on?'Reviewed':'Mark reviewed';
    });
    var prog=$('[data-viewed-progress]');
    if(prog)prog.textContent=formatReviewCount(n)+' of '+formatReviewCount(total)+' reviewed';
  }
  function clearGapError(gap){
    var error=$('.ds-gaperror',gap);if(error&&error.parentNode)error.parentNode.removeChild(error);gap.classList.remove('is-error');
  }
  function showGapError(gap,mode,err){
    var restoreFocus=gap.contains(document.activeElement);
    clearGapError(gap);gap.classList.add('is-error');gap.setAttribute('aria-busy','false');
    var status=document.createElement('span');status.className='ds-gaperror';status.setAttribute('role','alert');
    var message=document.createElement('span');message.textContent='Could not load hidden context. '+diffFailureDetail(err);
    var retry=document.createElement('button');retry.type='button';retry.className='ds-gapbtn ds-gapretry';if(err&&err.reloadRequired){retry.setAttribute('data-review-reload','');retry.textContent='Reload review';retry.setAttribute('aria-label','Reload review with current evidence');}else{retry.setAttribute('data-expand',mode);retry.textContent='Try again';retry.setAttribute('aria-label','Retry loading hidden context');}
    status.appendChild(message);status.appendChild(retry);gap.appendChild(status);
    if(restoreFocus){try{retry.focus({preventScroll:true});}catch(e){retry.focus();}}
  }
  function expandGap(btn){
    var gap=closest(btn,'[data-gap]');
    if(!gap){var mirrorHalf=closest(btn,'[data-gap-mirror]');gap=mirrorHalf?flowCanonicalGap(mirrorHalf):null;}
    if(!gap)return;
    if(btn.disabled)return;
    expandGapBy(gap,btn.getAttribute('data-expand'),0);
  }
  function expandGapBy(gap,mode,lines){
    var mirrorGap=flowMirrorGap(gap);
    var file=gap.getAttribute('data-gap-file');
    var from=parseInt(gap.getAttribute('data-gap-from')||'0',10);
    var toAttr=gap.getAttribute('data-gap-to');
    var eof=toAttr==='eof';
    var to=eof?0:parseInt(toAttr||'0',10);
    var chunk=lines>0?lines:Math.max(1,parseInt(gap.getAttribute('data-gap-chunk')||'20',10)||20);
    clearGapError(gap);gap.setAttribute('aria-busy','true');
    var rf,rt;
    if(mode==='all'){rf=from;rt=eof?'eof':to;}
    else if(mode==='down'){rf=from;rt=eof?(from+chunk-1):Math.min(to,from+chunk-1);}
    else{rf=Math.max(from,to-chunk+1);rt=to;}
    var holder=closest(gap,'.ds-filepanel')||closest(gap,'.ds-diff');
    var layout=closest(gap,'[data-split-inner]')?'split':'unified';
    var btns=[].slice.call(gap.querySelectorAll('.ds-gapbtn')).concat(mirrorGap?[].slice.call(mirrorGap.querySelectorAll('.ds-gapbtn')):[]);
    btns.forEach(function(b){b.disabled=true;});
    fetch(reviewPageUrl('/api/diff/context?file='+encodeURIComponent(file)+'&from='+rf+'&to='+rt+'&layout='+layout))
      .then(diffResponseText)
      .then(function(html){
        gap.setAttribute('aria-busy','false');
        // pi-lens-ignore: ast-grep:no-inner-html-js
        var tmp=document.createElement('div');tmp.innerHTML=html;
        var wrap=tmp.firstElementChild;
        if(!wrap||!wrap.hasAttribute('data-ctx-rows'))throw new Error('Unexpected context response');
        if(!wrap.children.length){removeFlowGap(gap,mirrorGap);if(holder){pruneScopeRows(holder);updateChangeNav(holder);}return;}
        var servedFrom=parseInt(wrap.getAttribute('data-from')||'0',10);
        var servedTo=parseInt(wrap.getAttribute('data-to')||'0',10);
        mountCommentPins(wrap);
        var leftFrag=$('[data-ctx-side="left"]',wrap),rightFrag=$('[data-ctx-side="right"]',wrap);
        if(rightFrag)insertFlowFragments(gap,mirrorGap,leftFrag,rightFrag,mode);
        else{var parent=gap.parentNode,refNode=(mode==='up')?gap.nextSibling:gap;while(wrap.firstChild)parent.insertBefore(wrap.firstChild,refNode);}
        if(mode==='all'){removeFlowGap(gap,mirrorGap);}
        else if(mode==='down'){
          var nf=servedTo+1;
          if(eof){gap.setAttribute('data-gap-from',String(nf));}
          else if(nf>to){removeFlowGap(gap,mirrorGap);}
          else{gap.setAttribute('data-gap-from',String(nf));}
        }else{
          var nt=servedFrom-1;
          if(nt<from){removeFlowGap(gap,mirrorGap);}
          else{gap.setAttribute('data-gap-to',String(nt));}
        }
        btns.forEach(function(b){b.disabled=false;});
        if(holder){pruneScopeRows(holder);updateChangeNav(holder);syncSplitPaneLayout(holder);scheduleAnnotations(closest(holder,'.ds-step'));}
      })
      .catch(function(err){
        btns.forEach(function(b){b.disabled=false;});
        showGapError(gap,mode,err);
      });
  }

  function modalSnapshot(node){
    for(var i=0;i<modalBackgroundSnapshots.length;i++)if(modalBackgroundSnapshots[i].node===node)return modalBackgroundSnapshots[i];
    var snapshot={node:node,hadAriaHidden:node.hasAttribute('aria-hidden'),ariaHidden:node.getAttribute('aria-hidden'),hadInert:node.hasAttribute('inert'),inertValue:node.getAttribute('inert')};
    modalBackgroundSnapshots.push(snapshot);return snapshot;
  }
  function restoreModalNode(snapshot){
    var node=snapshot&&snapshot.node;if(!node)return;
    if(snapshot.hadAriaHidden)node.setAttribute('aria-hidden',snapshot.ariaHidden||'');else node.removeAttribute('aria-hidden');
    if(snapshot.hadInert)node.setAttribute('inert',snapshot.inertValue||'');else node.removeAttribute('inert');
  }
  function topModalFrame(){return modalStack.length?modalStack[modalStack.length-1]:null;}
  function topModalRoot(){var frame=topModalFrame();return frame&&frame.root;}
  function modalFocusables(root){
    return root?$all('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',root).filter(function(node){return !node.hidden&&node.offsetParent!==null;}):[];
  }
  function focusModalRoot(root){
    if(!root||topModalRoot()!==root)return;var focusables=modalFocusables(root),dialog=$('[role="dialog"]',root)||root,target=focusables[0]||dialog;
    if(target&&target.focus)target.focus();
  }
  // Everything that is NOT the top modal, from the modal outwards.
  //
  // This used to be `body > *` minus the modal, which was exact while the page
  // was one server-rendered document and every modal was a direct child of
  // <body>. React mounts into `#root`, so the modal is now a GRANDchild and
  // `body > *` matches only `#root` — inerting it would inert the modal itself,
  // and Tab would walk straight out of the dialog into an inert document.
  // Walking the ancestor chain and inerting each level's other children is the
  // same set in the old layout and the right one in this layout.
  function modalBackgroundNodes(top){
    var nodes=[],node=top,parent;
    while(node&&node!==document.body&&(parent=node.parentNode)){
      Array.prototype.slice.call(parent.children||[]).forEach(function(child){
        if(child===node||child.tagName==='SCRIPT'||child.tagName==='STYLE')return;
        nodes.push(child);
      });
      node=parent;
    }
    return nodes;
  }
  function syncModalBackground(){
    // Restore first, then re-apply: the background set changes when a second
    // modal opens over the first, and a node that leaves the set must have its
    // original aria-hidden/inert put back rather than being left inert forever.
    modalBackgroundSnapshots.forEach(restoreModalNode);modalBackgroundSnapshots=[];
    var top=topModalRoot();if(!top)return;
    modalBackgroundNodes(top).forEach(function(node){
      modalSnapshot(node);
      node.setAttribute('aria-hidden','true');node.setAttribute('inert','');
    });
  }
  function syncModalScrollLock(){document.body.classList.toggle('ds-noscroll',modalStack.length>0);}
  function activateModal(root,returnFocus){
    if(!root)return;for(var i=modalStack.length-1;i>=0;i--)if(modalStack[i].root===root)modalStack.splice(i,1);
    modalStack.push({root:root,returnFocus:returnFocus||document.activeElement});syncModalBackground();syncModalScrollLock();
  }
  function restoreModalFocus(frame){
    setTimeout(function(){
      var top=topModalRoot(),target=frame&&frame.returnFocus;
      if(top){if(target&&top.contains(target)&&document.contains(target)&&!target.hasAttribute('inert'))target.focus();else focusModalRoot(top);}
      else if(target&&document.contains(target)&&!target.hasAttribute('inert'))target.focus();
    },0);
  }
  function deactivateModal(root,restoreFocus){
    var index=-1;for(var i=modalStack.length-1;i>=0;i--)if(modalStack[i].root===root){index=i;break;}
    if(index<0)return false;var wasTop=index===modalStack.length-1,frame=modalStack[index];modalStack.splice(index,1);syncModalBackground();syncModalScrollLock();
    if(wasTop&&restoreFocus!==false)restoreModalFocus(frame);return wasTop;
  }
  function showDrawerRoot(root){
    if(!root)return;
    if(root._dsHideTimer){clearTimeout(root._dsHideTimer);root._dsHideTimer=0;}
    if(root._dsShowFrame){cancelAnimationFrame(root._dsShowFrame);root._dsShowFrame=0;}
    root._dsReturnFocus=document.activeElement;root.hidden=false;activateModal(root,root._dsReturnFocus);
    root._dsShowFrame=requestAnimationFrame(function(){root._dsShowFrame=0;if(!root.hidden)root.classList.add('is-open');});
    setTimeout(function(){focusModalRoot(root);},0);
  }
  function hideDrawerRoot(root){
    if(!root)return;
    if(root._dsShowFrame){cancelAnimationFrame(root._dsShowFrame);root._dsShowFrame=0;}
    if(root._dsHideTimer){clearTimeout(root._dsHideTimer);root._dsHideTimer=0;}
    root.classList.remove('is-open');
    deactivateModal(root,true);root._dsReturnFocus=null;
    root._dsHideTimer=setTimeout(function(){root._dsHideTimer=0;root.hidden=true;},prefersReducedMotion()?200:250);
  }
  var trustLoadPromise=null;
  function loadTrustEvidence(){
    var host=$('[data-trust-evidence]');
    if(!host||host.getAttribute('data-trust-pending')!=='1')return Promise.resolve();
    // Return the in-flight promise rather than bailing: gotoReview chains a
    // scroll on this, and the fetch replaces innerHTML — scrolling to a card
    // that is about to be swapped out lands the reviewer nowhere.
    if(trustLoadPromise)return trustLoadPromise;
    var pending=$('.ds-trust-clean',host);
    if(pending){pending.textContent='Calculating story coverage for the loaded diff…';pending.setAttribute('aria-busy','true');}
    trustLoadPromise=fetch(reviewPageUrl('/api/review/trust')).then(reviewLazyText).then(function(html){
      var parsed=new DOMParser().parseFromString(html,'text/html'),next=parsed.querySelector('[data-trust-evidence]');
      if(!next)throw new Error('Trust evidence response was incomplete.');
      // pi-lens-ignore: ast-grep:no-inner-html-js
      host.innerHTML=next.innerHTML;
      host.setAttribute('data-trust-pending','0');
      // This response carries the same verdict the pill is waiting on. Settle the
      // pill from it rather than leaving it spinning next to its own answer.
      var verdict=next.getAttribute('data-trust-uncovered');
      if(verdict)applyCoverageVerdict(Number(verdict||0),next.getAttribute('data-trust-storyless')==='1');
      syncExclusionAcknowledgement();
    }).catch(function(err){
      // pi-lens-ignore: ast-grep:no-inner-html-js
      host.innerHTML='<div class="ds-diffnote" role="alert">'+reviewLazyMessage(err,'Could not calculate coverage.')+' '+reviewLazyAction(err,'data-retry-trust','')+'</div>';
      markCoverageUnavailable();
    }).finally(function(){trustLoadPromise=null;});
    return trustLoadPromise;
  }
  // ---- coverage verdict ----
  // The page renders from a lazy file index, so at first paint it cannot know
  // whether the story explains every changed range. The pill says so honestly in
  // a neutral unknown state, and this resolves it in the background, then writes
  // the answer back into the pill AND the review chip's clean state — without
  // which the chip could never legitimately go green.
  var coverageResolved=false,coveragePromise=null;
  function applyCoverageVerdict(uncovered,storyless){
    var pill=$('.ds-trustpill');
    if(!pill||!pill.classList.contains('is-unknown'))return;
    coverageResolved=true;
    var reviewBtn=$('[data-review-status]');
    if(reviewBtn)reviewBtn.setAttribute('data-unexplained-count',String(uncovered));
    var excluded=Number(pill.getAttribute('data-trust-excluded')||0),focused=pill.getAttribute('data-trust-focused')==='1';
    pill.classList.remove('is-unknown');
    // The pill's arrow follows its verdict: a coverage gap sends the reviewer to
    // the unexplained section that holds it, not to a generic evidence anchor.
    pill.setAttribute('data-goto-review',uncovered>0&&!storyless?'unexplained':excluded?'exclusions':'evidence');
    applyCoverageFlag(uncovered>0&&!storyless?uncovered:0,excluded+$all('[data-review-section="staged"] .ds-exclusion-card').length);
    if(uncovered>0&&!storyless){
      pill.classList.remove('is-clean');
      // pi-lens-ignore: ast-grep:no-inner-html-js
      pill.innerHTML='<span class="ds-tri">▲</span><span><b>'+uncovered+'</b> '+(uncovered===1?'change':'changes')+' not explained by the story</span><span class="ds-review-row-arrow">›</span>';
    }else{
      pill.classList.add('is-clean');
      // pi-lens-ignore: ast-grep:no-inner-html-js
      pill.innerHTML='<span class="ds-check">✓</span><span>'+(focused?'Story covers its selected scope':'Story covers the rendered diff')+(excluded?' · <b>'+excluded+'</b> excluded '+(excluded===1?'file':'files')+' to inspect':'')+'</span><span class="ds-review-row-arrow">›</span>';
    }
    refreshCount();
  }
  // The Coverage tab's mark is decorative and its label is what a screen reader
  // reads, so both are written here, together, from the same numbers.
  function applyCoverageFlag(uncovered,outside){
    var flag=$('[data-coverage-flag]'),tab=$('[data-review-tab-select="coverage"]');
    if(!flag||!tab)return;
    var text=uncovered?'▲'+uncovered:outside?'▲':'';
    var label=uncovered?uncovered+' '+(uncovered===1?'change':'changes')+' not explained by the story':outside?'files to inspect outside the story':'';
    flag.textContent=text;flag.hidden=!text;
    if(label)tab.setAttribute('aria-label','Coverage, '+label);else tab.removeAttribute('aria-label');
  }
  // A check that could not run stays unknown — never silently clean.
  function markCoverageUnavailable(){
    var pill=$('.ds-trustpill');
    if(!pill||!pill.classList.contains('is-unknown'))return;
    var spin=$('.ds-tri-spin',pill);if(spin)spin.classList.remove('ds-tri-spin');
    var text=$('[data-trust-pill-text]',pill);if(text)text.textContent='Coverage unchecked · open to retry';
  }
  function resolveCoverage(){
    if(coverageResolved||coveragePromise)return;
    var pill=$('.ds-trustpill');
    if(!pill||!pill.classList.contains('is-unknown'))return;
    coveragePromise=fetch(reviewPageUrl('/api/review/coverage')).then(function(res){
      if(!res.ok)throw new Error('Coverage check failed.');
      return res.json();
    }).then(function(verdict){
      applyCoverageVerdict(Number((verdict&&verdict.uncovered)||0),!!(verdict&&verdict.storyless));
    }).catch(function(){
      markCoverageUnavailable();
    }).finally(function(){coveragePromise=null;});
  }
  // Coverage costs a full diff read on the server, so it waits for first paint
  // rather than competing with it.
  function scheduleCoverageResolve(){
    if(typeof requestIdleCallback==='function')requestIdleCallback(resolveCoverage,{timeout:2000});
    else setTimeout(resolveCoverage,400);
  }
  // ---- review page tabs ----
  // The page is tabbed, so reaching a section means selecting the tab that owns
  // it first. Sections carry their own names; the panel they sit in is the tab.
  function activeReviewTab(){var page=$('.ds-reviewpage');return page?page.getAttribute('data-review-tab')||'coverage':'';}
  function setReviewTab(tab,focusTab){
    var page=$('.ds-reviewpage');if(!page||!tab)return;
    var button=$('[data-review-tab-select="'+tab+'"]',page);if(!button)return;
    page.setAttribute('data-review-tab',tab);
    $all('[data-review-tab-select]',page).forEach(function(node){
      var on=node===button;
      node.classList.toggle('is-active',on);
      node.setAttribute('aria-selected',on?'true':'false');
      node.tabIndex=on?0:-1;
    });
    $all('[data-review-panel]',page).forEach(function(panel){panel.hidden=panel.getAttribute('data-review-panel')!==tab;});
    if(focusTab)button.focus();
    saveReviewPositionSoon();
  }
  // Switching tabs returns to the top of the page: the panel below the tab bar
  // changes completely, so a scroll offset carried over from the last one points
  // at nothing, and it would hide the pinned verdict for no reason.
  function selectReviewTab(tab,focusTab){
    if(tab===activeReviewTab()){if(focusTab){var same=$('[data-review-tab-select="'+tab+'"]');if(same)same.focus();}return;}
    setReviewTab(tab,focusTab);
    if(reviewView)reviewView.scrollTo({top:0,behavior:prefersReducedMotion()?'auto':'smooth'});
  }
  // Every affordance that used to open the trust drawer now points at a section
  // of the review page instead, so nothing that had an entrance loses one.
  function gotoReview(section,path){
    pendingReviewSection=true;
    setView('review');
    loadTrustEvidence().then(function(){
      pendingReviewSection=false;
      var dest=section?$('[data-review-section="'+section+'"]'):null;
      if(path){var card=$('[data-excluded-file="'+path+'"]');if(card)dest=card;}
      if(!dest){focusElementWithoutScroll(reviewView);return;}
      var panel=closest(dest,'[data-review-panel]');
      if(panel)setReviewTab(panel.getAttribute('data-review-panel'),false);
      // Asking for the unexplained changes is asking to read them: the section
      // stays shut on arrival, but not when the reviewer aimed at it.
      if(section==='unexplained'){var disclosure=$('[data-unexplained-disclosure]',dest);if(disclosure)disclosure.open=true;}
      // Scroll the review panel itself. The blunt DOM helper this replaces also
      // scrolls horizontal ancestors, which would shove the diff sideways.
      if(reviewView){
        var top=reviewView.scrollTop+dest.getBoundingClientRect().top-reviewView.getBoundingClientRect().top-12;
        reviewView.scrollTo({top:Math.max(0,top),behavior:prefersReducedMotion()?'auto':'smooth'});
      }
      focusElementWithoutScroll(dest.hasAttribute('tabindex')?dest:(closest(dest,'[data-review-section]')||dest));
    });
  }
  function setDriftExpanded(on){$all('[data-drift-open]').forEach(function(button){button.setAttribute('aria-expanded',on?'true':'false');});}
  function invalidateDriftRequest(){
    driftRequestToken++;
    if(driftRequestAbort){driftRequestAbort.abort();driftRequestAbort=null;}
  }
  function resetDriftSelection(){
    if(!driftDrawer)return;
    $all('[data-drift-file]',driftDrawer).forEach(function(row){row.classList.remove('is-active');row.setAttribute('aria-pressed','false');});
    var label=$('[data-drift-selected-path]',driftDrawer),preview=$('[data-drift-preview]',driftDrawer);if(label)label.textContent='';
    // pi-lens-ignore: ast-grep:no-inner-html-js
    if(preview)preview.innerHTML='<div class="ds-diffnote">Choose a file to load its exact change since the story.</div>';
  }
  function openDriftDrawer(){if(!driftDrawer)return;invalidateDriftRequest();driftLayoutMode=compactScreen()?'unified':'split';driftDrawer.classList.remove('is-detail');resetDriftSelection();showDrawerRoot(driftDrawer);setDriftExpanded(true);}
  function closeDriftDrawer(){if(!driftDrawer)return;invalidateDriftRequest();hideDrawerRoot(driftDrawer);setDriftExpanded(false);}
  function loadDriftFile(button){
    if(!driftDrawer||!button)return;
    var file=button.getAttribute('data-drift-file')||'',labelText=button.getAttribute('data-drift-label')||file,observation=driftDrawer.getAttribute('data-drift-observation')||'',preview=$('[data-drift-preview]',driftDrawer),label=$('[data-drift-selected-path]',driftDrawer),back=$('[data-drift-back]',driftDrawer),layout=compactScreen()?'unified':'split';
    if(!file||!preview)return;
    driftLayoutMode=layout;
    invalidateDriftRequest();
    $all('[data-drift-file]',driftDrawer).forEach(function(row){var active=row===button;row.classList.toggle('is-active',active);row.setAttribute('aria-pressed',active?'true':'false');});
    if(label)label.textContent=labelText;driftDrawer.classList.add('is-detail');
    if(compactScreen()){if(back)back.focus();}else if(back&&document.activeElement===back)button.focus();
    // pi-lens-ignore: ast-grep:no-inner-html-js
    if(button.getAttribute('data-drift-loaded')==='1'&&button._dsDriftHtml&&button._dsDriftLayout===layout){preview.innerHTML=button._dsDriftHtml;return;}
    // pi-lens-ignore: ast-grep:no-inner-html-js
    preview.innerHTML='<div class="ds-diffnote" role="status">Loading change since story…</div>';
    var requestToken=driftRequestToken,ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    driftRequestAbort=ctrl;
    fetch(reviewPageUrl('/api/story-drift/file?observation='+encodeURIComponent(observation)+'&file='+encodeURIComponent(file)+'&layout='+layout),ctrl?{signal:ctrl.signal}:undefined).then(reviewLazyText).then(function(html){
      if(requestToken!==driftRequestToken||$('.ds-drift-file.is-active',driftDrawer)!==button||button.getAttribute('data-drift-file')!==file)return;
      if(driftRequestAbort===ctrl)driftRequestAbort=null;
      // pi-lens-ignore: ast-grep:no-inner-html-js
      button._dsDriftHtml=html;button._dsDriftLayout=layout;button.setAttribute('data-drift-loaded','1');preview.innerHTML=html;
    }).catch(function(err){
      if(requestToken!==driftRequestToken||$('.ds-drift-file.is-active',driftDrawer)!==button||(err&&err.name==='AbortError'))return;
      if(driftRequestAbort===ctrl)driftRequestAbort=null;
      // pi-lens-ignore: ast-grep:no-inner-html-js
      preview.innerHTML='<div class="ds-diffnote" role="alert">'+reviewLazyMessage(err,'Could not load this change.')+' '+reviewLazyAction(err,'data-drift-retry','Retry')+'</div>';
    });
  }
  function showDriftList(){
    if(!driftDrawer)return;invalidateDriftRequest();var active=$('.ds-drift-file.is-active',driftDrawer);driftDrawer.classList.remove('is-detail');if(active)active.focus();
  }
  function syncDriftLayout(){
    var next=compactScreen()?'unified':'split';if(next===driftLayoutMode)return;driftLayoutMode=next;
    if(!driftDrawer||driftDrawer.hidden)return;var active=$('.ds-drift-file.is-active',driftDrawer);if(active){loadDriftFile(active);if(next==='split')active.focus();}
  }
  function fileMatchesFilter(item){
    var q=($('[data-file-search]')&&$('[data-file-search]').value||'').trim().toLowerCase();
    if(q&&(item.getAttribute('data-filter-path')||'').indexOf(q)<0&&!(
      fileSearchQuery===q&&fileSearchMatches&&fileSearchMatches[item.getAttribute('data-goto-file')]
    ))return false;
    if(activeFileFilter==='reviewed'&&!viewedFiles[item.getAttribute('data-goto-file')])return false;
    if(activeFileFilter==='unreviewed'&&viewedFiles[item.getAttribute('data-goto-file')])return false;
    if(activeFileFilter==='comments'&&item.getAttribute('data-filter-comments')!=='1')return false;
    if(activeFileFilter==='unexplained'&&item.getAttribute('data-filter-unexplained')!=='1')return false;
    if(activeFileFilter==='tests'&&item.getAttribute('data-filter-test')!=='1')return false;
    return true;
  }
  function applyFileFilters(){
    var visible=[];
    fileItems.forEach(function(item){var show=fileMatchesFilter(item);item.hidden=!show;if(show)visible.push(item);});
    $all('.ds-filetree-dir').reverse().forEach(function(dir){dir.hidden=!$all('.ds-fileitem',dir).some(function(item){return !item.hidden;});});
    $all('[data-file-filter]').forEach(function(btn){var active=btn.getAttribute('data-file-filter')===activeFileFilter;btn.classList.toggle('is-active',active);btn.setAttribute('aria-pressed',active?'true':'false');});
    var selected=fileItems.find(function(item){return Number(item.getAttribute('data-file-index'))===selectedFile;});
    if(visible.length&&(!selected||selected.hidden))selectFile(Number(visible[0].getAttribute('data-file-index')));
    var progress=$('[data-viewed-progress]');
    var excludedCount=progress?Number(progress.getAttribute('data-excluded-count')||0):0;
    if(progress&&!fileItems.length&&excludedCount)progress.textContent=formatReviewCount(excludedCount)+' '+(excludedCount===1?'file':'files');
    else if(progress&&!visible.length)progress.textContent='No matching files';
    else syncViewed();
  }
  function clearFileSearchNote(){var n=$('[data-file-search-note]');if(n&&n.parentNode)n.parentNode.removeChild(n);}
  function showFileSearchNote(){
    clearFileSearchNote();
    var tools=$('.ds-filetools');if(!tools)return;
    var n=el('p','','Content search is unavailable; showing name matches only.');
    n.setAttribute('data-file-search-note','');
    n.setAttribute('style','font-size:var(--text-sm);color:var(--muted);margin:6px 2px 0');
    tools.appendChild(n);
  }
  function searchFilesLazily(){
    var input=$('[data-file-search]'),q=(input&&input.value||'').trim().toLowerCase(),request=++fileSearchRequest;
    fileSearchQuery=q;var keptMatches=fileSearchMatches;fileSearchMatches=null;clearFileSearchNote();
    if(fileSearchTimer){clearTimeout(fileSearchTimer);fileSearchTimer=null;}
    applyFileFilters();
    if(q.length<2)return;
    fileSearchTimer=setTimeout(function(){
      fileSearchTimer=null;
      fetch(reviewPageUrl('/api/review/file-search?q='+encodeURIComponent(q))).then(function(response){
        if(!response.ok)throw new Error('Search unavailable');
        return response.json();
      }).then(function(result){
        if(request!==fileSearchRequest||!result||result.query!==q)return;
        var matches={};(result.files||[]).forEach(function(file){matches[file]=1;});
        fileSearchMatches=matches;clearFileSearchNote();applyFileFilters();
      }).catch(function(){if(request===fileSearchRequest){fileSearchMatches=keptMatches;showFileSearchNote();applyFileFilters();}});
    },180);
  }
  function setFileFilter(filter){
    activeFileFilter=filter||'all';applyFileFilters();
    var label=$('[data-file-filter-label]'),button=$('[data-file-filter="'+activeFileFilter+'"]');if(label)label.textContent=button?button.textContent:'All';
    var menu=$('.ds-filefilter-menu');if(menu)menu.open=false;
  }
  function syncFileCommentFlags(){
    var paths={};queuedComments().forEach(function(c){paths[c.file]=1;});
    fileItems.forEach(function(item){item.setAttribute('data-filter-comments',paths[item.getAttribute('data-goto-file')]?'1':'0');});
    applyFileFilters();
  }
  function nextUnviewedFile(){
    var visible=fileItems.filter(function(item){return !item.hidden&&!viewedFiles[item.getAttribute('data-goto-file')];});
    if(!visible.length){toast('All visible files marked reviewed');return;}
    var after=visible.find(function(item){return Number(item.getAttribute('data-file-index'))>selectedFile;})||visible[0];
    setView('files');selectFile(Number(after.getAttribute('data-file-index')));collapseCompactSidebar();
  }
  function challengeKey(){return 'ds-challenge:'+(document.body.getAttribute('data-review-scope')||'')+':'+(document.body.getAttribute('data-current-diff-hash')||'');}
  function loadChallengeChecks(){var saved={};try{saved=JSON.parse(localStorage.getItem(challengeKey())||'{}')||{};}catch(e){}$all('[data-challenge-check]').forEach(function(input){input.checked=!!saved[input.getAttribute('data-challenge-check')];});}
  function saveChallengeChecks(){var saved={};$all('[data-challenge-check]').forEach(function(input){if(input.checked)saved[input.getAttribute('data-challenge-check')]=1;});try{localStorage.setItem(challengeKey(),JSON.stringify(saved));}catch(e){}}
  function initialComments(){
    var list=engineOptions.comments;return Array.isArray(list)?list.slice():[];
  }
  var allComments=initialComments();
  var reviewFeedbackIdentityRequest=0;
  function queuedComments(){return allComments.filter(function(c){return c&&c.status==='open';});}
  function commentAnchorLabel(state){return state==='changed'?'Code changed':state==='moved'?'Code moved':state==='old-side'?'Old side':state==='legacy'?'Line-only anchor':'Anchor current';}
  function commentAnchorInfo(id,fallback){var raw=fallback||initialCommentAnchors[id]||{};if(typeof raw==='string')return {state:raw,label:commentAnchorLabel(raw)};var state=raw.state||'current';return {state:state,label:raw.label||commentAnchorLabel(state),currentLine:raw.currentLine};}
  function commentNavigationLine(c){var info=commentAnchorInfo(c.id),line=Number(info.currentLine||0);return line>0?line:Number(c.line||0);}
  function commentSide(c){return c&&c.side==='left'?'left':'right';}
  function commentById(id){return allComments.find(function(c){return c&&c.id===id;});}
  function replaceComment(c){var found=false;allComments=allComments.map(function(old){if(old.id===c.id){found=true;return c;}return old;});if(!found)allComments.push(c);}
  function refreshReviewState(done){
    var request=++reviewFeedbackIdentityRequest;
    fetch(reviewPageUrl('/api/review-state')).then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(state){
      if(request!==reviewFeedbackIdentityRequest||!state)return;
      if(state.scopeKey!==(document.body.getAttribute('data-review-scope')||''))return;
      document.body.setAttribute('data-feedback-health',state.feedbackHealth&&state.feedbackHealth.status==='invalid'?'invalid':'healthy');
      var renderedHash=document.body.getAttribute('data-current-diff-hash')||'',sameDiff=state.currentDiffHash===renderedHash;
      setLiveIssue('diff',!sameDiff);refreshCount();if(done)done(state);
    }).catch(function(){if(done)done(null);});
  }
  function syncReviewFeedbackIdentity(){refreshReviewState();}
  function noteBlockingFeedbackMutation(comment){if(comment&&comment.type==='change')syncReviewFeedbackIdentity();}
  function commentRows(c,scope){
    var rows=[],line=commentNavigationLine(c);$all('[data-comment-code]',scope||document).forEach(function(code){if(code.getAttribute('data-comment-file')!==c.file||String(code.getAttribute('data-comment-line'))!==String(line)||(code.getAttribute('data-comment-side')||'right')!==commentSide(c))return;var row=closest(code,'.ds-row,.ds-urow');if(row&&rows.indexOf(row)<0)rows.push(row);});return rows;
  }
  function commentRow(c,scope){
    var rows=commentRows(c,scope),visible=rows.find(function(row){return !closest(row,'[hidden]')&&row.getClientRects().length>0;});return visible||rows[0]||null;
  }
  function mountCommentPins(scope){
    scope=scope||document;$all('[data-comment-launcher]',scope).forEach(function(pin){if(pin.parentNode)pin.parentNode.removeChild(pin);});
    var mounted=[];queuedComments().forEach(function(c){commentRows(c,scope).forEach(function(row){if(mounted.indexOf(row)<0)mounted.push(row);});});mounted.forEach(function(row){var matches=queuedComments().filter(function(c){return commentRows(c,scope).indexOf(row)>=0;});var pin=el('button','ds-comment-pin',matches.length>1?String(matches.length):'●');pin.type='button';pin.setAttribute('data-comment-launcher','');pin.setAttribute('data-queued-comment-id',matches[0].id);pin.setAttribute('aria-label','Open '+matches.length+' queued review '+(matches.length===1?'comment':'comments'));row.appendChild(pin);});
  }
  function syncCommentPins(){mountCommentPins(document);}
  function gotoComment(id){
    var c=commentById(id);if(!c)return;
    var anchor=commentAnchorInfo(c.id),useStoryStep=c.step&&!(anchor.state==='moved'&&anchor.currentLine);
    if(useStoryStep){setView('tour');var stepCard=$('.ds-stepcard[data-step-id="'+c.step+'"]');if(stepCard)setActive(Number(stepCard.getAttribute('data-step-index')));}else{setView('files');selectFileByPath(c.file);}
    var attempt=0;function focusWhenMounted(){var row=commentRow(c,document),pin=row&&$('[data-comment-launcher]',row);if(row&&pin&&pin.offsetParent){scrollReviewRowVertically(row);row.classList.add('ds-comment-anchor-target');pin.focus({preventScroll:true});setTimeout(function(){row.classList.remove('ds-comment-anchor-target');},2400);return;}if(++attempt<50)setTimeout(focusWhenMounted,80);}setTimeout(focusWhenMounted,80);
  }
  function gotoQueuedComment(id){
    pendingReviewSection=true;setView('review');loadTrustEvidence().then(function(){pendingReviewSection=false;setReviewTab('notes',false);var card=id?$('[data-feedback-card][data-comment-id="'+id+'"]'):null;if(!card){focusElementWithoutScroll(reviewView);return;}card.tabIndex=-1;card.classList.add('is-targeted');if(reviewView){var top=reviewView.scrollTop+card.getBoundingClientRect().top-reviewView.getBoundingClientRect().top-18;reviewView.scrollTo({top:Math.max(0,top),behavior:prefersReducedMotion()?'auto':'smooth'});}focusElementWithoutScroll(card);setTimeout(function(){card.classList.remove('is-targeted');},2400);});
  }
  function openCommands(){if(!commandRoot||!commandRoot.hidden)return;commandReturnFocus=document.activeElement;commandRoot.hidden=false;activateModal(commandRoot,commandReturnFocus);setTimeout(function(){if(topModalRoot()!==commandRoot)return;var firstCommand=$('[data-command]',commandRoot),dialog=$('[role="dialog"]',commandRoot);if(firstCommand)firstCommand.focus();else if(dialog&&dialog.focus)dialog.focus();},0);}
  function closeCommands(){if(!commandRoot||commandRoot.hidden)return;deactivateModal(commandRoot,true);commandRoot.hidden=true;commandReturnFocus=null;}
  function runCommand(id){closeCommands();if(id==='story'){setView('tour');return;}if(id==='files'){setView('files');var q=$('[data-file-search]');if(q)q.focus();return;}if(id==='review'){gotoReview('notes');return;}if(id==='next-unviewed'){nextUnviewedFile();return;}if(id==='toggle-viewed'){var panel=filePanels[selectedFile];if(panel)toggleViewed(panel.getAttribute('data-file'));return;}if(id==='read-aloud')toggleReadAloud();}
  function feedbackFlavorControls(c){
    var group=el('div','ds-queue-edit-types');group.setAttribute('role','group');group.setAttribute('aria-label','Comment type');['change','question','nit'].forEach(function(type){var b=el('button','',FLAVOR[type].label);b.type='button';b.setAttribute('data-edit-flavor',type);b.setAttribute('aria-pressed',c.type===type?'true':'false');b.onclick=function(){$all('[data-edit-flavor]',group).forEach(function(choice){choice.setAttribute('aria-pressed',choice===b?'true':'false');});};group.appendChild(b);});return group;
  }
  function buildFeedbackCardClient(c,anchor){
    var f=FLAVOR[c.type]||FLAVOR.change,info=commentAnchorInfo(c.id,anchor),state=info.state||'current',line=info.currentLine||c.line,card=el('article','ds-feedback-card');card.setAttribute('data-feedback-card','');card.setAttribute('data-feedback-anchor',state);card.setAttribute('data-comment-id',c.id);card.setAttribute('data-comment-file',c.file||'');card.setAttribute('data-comment-line',String(line||0));card.setAttribute('data-comment-step',c.step||'');if(info.currentLine)card.setAttribute('data-comment-current-line',String(info.currentLine));
    var head=el('div','ds-feedback-head');head.appendChild(el('span','ds-flavor-ico',f.ico));head.appendChild(el('span','ds-feedback-type',f.label));head.appendChild(el('span','ds-feedback-path',(c.file||'')+':'+(line||0)));head.appendChild(el('span','ds-flex'));head.appendChild(el('span','ds-anchorbadge is-'+state,info.label||commentAnchorLabel(state)));card.appendChild(head);
    if(c.selectedText){var compare=el('div','ds-feedback-compare'),side=el('div','');side.appendChild(el('span','','Commented on'));side.appendChild(el('code','ds-feedback-selection',c.selectedText));compare.appendChild(side);card.appendChild(compare);}
    card.appendChild(markdownBlock('ds-feedback-message ds-md',c.body||''));
    var editor=el('div','ds-queue-edit');editor.setAttribute('data-comment-editor','');editor.hidden=true;editor.appendChild(feedbackFlavorControls(c));var ta=el('textarea','');ta.rows=3;ta.value=c.body||'';ta.setAttribute('data-edit-body','');ta.setAttribute('aria-label','Edit review comment');editor.appendChild(ta);var editActions=el('div','ds-queue-edit-actions'),cancel=el('button','ds-feedback-action','Cancel'),save=el('button','ds-btn ds-btn-solid','Save');cancel.type='button';cancel.setAttribute('data-edit-cancel','');save.type='button';save.setAttribute('data-edit-save','');editActions.appendChild(cancel);editActions.appendChild(save);editor.appendChild(editActions);card.appendChild(editor);
    var actions=el('div','ds-feedback-actions'),go=el('button','ds-feedback-action','Go to code'),edit=el('button','ds-feedback-action','Edit'),remove=el('button','ds-feedback-action ds-danger','Remove');go.type='button';edit.type='button';remove.type='button';go.setAttribute('data-goto-comment',c.id);edit.setAttribute('data-edit-comment',c.id);remove.setAttribute('data-remove-comment',c.id);actions.appendChild(go);actions.appendChild(edit);actions.appendChild(remove);card.appendChild(actions);return card;
  }
  function syncFeedbackCards(){
    if(!reviewView)return;var list=$('[data-feedback-view="feedback"]',reviewView);if(!list)return;var anchors=Object.assign({},initialCommentAnchors);$all('[data-feedback-card]',list).forEach(function(card){var id=card.getAttribute('data-comment-id')||'',state=card.getAttribute('data-feedback-anchor')||'current',currentLine=Number(card.getAttribute('data-comment-current-line')||0);anchors[id]={state:state,label:commentAnchorLabel(state),currentLine:currentLine||undefined};});list.textContent='';var queued=queuedComments().sort(function(a,b){return String(a.file).localeCompare(String(b.file))||Number(commentNavigationLine(a))-Number(commentNavigationLine(b))||String(a.createdAt).localeCompare(String(b.createdAt));});if(!queued.length){list.appendChild(el('div','ds-drawer-empty',defaultCommentFlavor()==='question'?'No queued questions yet. Select code and press C.':'No queued comments. Select code in the diff and press C.'));return;}var groups={};queued.forEach(function(c){(groups[c.file]||(groups[c.file]=[])).push(c);});Object.keys(groups).sort().forEach(function(file){var group=el('section','ds-feedback-group');group.setAttribute('data-feedback-group',file);var head=el('div','ds-feedback-group-head');head.appendChild(el('code','',file));head.appendChild(el('span','',groups[file].length+' '+(groups[file].length===1?'comment':'comments')));group.appendChild(head);groups[file].forEach(function(c){group.appendChild(buildFeedbackCardClient(c,anchors[c.id]||'current'));});list.appendChild(group);});
  }
  function syncComposerRadioGroup(group,selected){$all('[role="radio"]',group).forEach(function(choice){var active=choice===selected;choice.classList.toggle('is-active',active);choice.setAttribute('aria-checked',active?'true':'false');choice.tabIndex=active?0:-1;});}
  function moveComposerRadio(group,selector,e){if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='ArrowUp'&&e.key!=='ArrowDown'&&e.key!=='Home'&&e.key!=='End')return;var choices=$all(selector,group);if(!choices.length)return;var at=choices.indexOf(document.activeElement);if(at<0)at=choices.findIndex(function(choice){return choice.getAttribute('aria-checked')==='true';});if(at<0)at=0;var next;if(e.key==='Home')next=choices[0];else if(e.key==='End')next=choices[choices.length-1];else next=choices[(at+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+choices.length)%choices.length];if(next){e.preventDefault();next.focus();next.click();}}
  // Dismissing a draft — close button, Escape, or opening a second composer —
  // must not drop typed text. Drafts live in a module map for the session and
  // in localStorage under the review scope so a reload restores them too.
  var composerDrafts=Object.create(null);
  function composerDraftScope(){return (document.body.getAttribute('data-review-scope')||document.body.getAttribute('data-viewed-scope')||'')+':'+(document.body.getAttribute('data-story-key')||'');}
  function composerAnchorKey(anchor){return String(anchor.file||'')+':'+String(anchor.line||'')+':'+String(anchor.side||'')+':'+String(anchor.step||'');}
  function composerDraftKey(key){return 'ds-composer-draft:'+composerDraftScope()+':'+key;}
  function composerFlavorOf(box){var active=$('.ds-composer-tab[aria-checked="true"]',box);return active?active.getAttribute('data-flavor'):'change';}
  function readComposerDraft(key){if(Object.prototype.hasOwnProperty.call(composerDrafts,key))return composerDrafts[key];var draft=null;try{draft=JSON.parse(localStorage.getItem(composerDraftKey(key))||'null');}catch(e){draft=null;}if(draft&&typeof draft==='object'&&typeof draft.text==='string'&&draft.text.trim()){composerDrafts[key]=draft;return draft;}return null;}
  function stashComposerDraft(box){if(!box||!box._dsDraftAnchor)return;var key=composerAnchorKey(box._dsDraftAnchor),ta=$('.ds-composer-ta',box),text=ta?ta.value:'';if(!text.trim()){clearComposerDraft(key);return;}var draft={anchor:{file:box._dsDraftAnchor.file,line:box._dsDraftAnchor.line,side:box._dsDraftAnchor.side,step:box._dsDraftAnchor.step},flavor:composerFlavorOf(box),text:text,selectedText:box._dsDraftSelection||''};composerDrafts[key]=draft;try{localStorage.setItem(composerDraftKey(key),JSON.stringify(draft));}catch(e){}}
  function clearComposerDraft(key){delete composerDrafts[key];try{localStorage.removeItem(composerDraftKey(key));}catch(e){}}
  function clearComposerDraftForBox(box){if(box&&box._dsDraftAnchor)clearComposerDraft(composerAnchorKey(box._dsDraftAnchor));}
  function restoreComposerDraft(box){if(!box||!box._dsDraftAnchor)return;var draft=readComposerDraft(composerAnchorKey(box._dsDraftAnchor));if(!draft)return;var ta=$('.ds-composer-ta',box);if(ta)ta.value=draft.text||'';if(draft.flavor&&FLAVOR[draft.flavor]){var tab=$('.ds-composer-tab[data-flavor="'+draft.flavor+'"]',box);if(tab&&tab.getAttribute('aria-checked')!=='true')tab.click();}}
  function dirtyComposer(){var box=$('.ds-composer');if(!box)return null;var ta=$('.ds-composer-ta',box);return ta&&ta.value.trim()?box:null;}
  function buildComposer(row,flavor,ctx){
    ctx=ctx||{};var file=ctx.file||row.getAttribute('data-file'),line=ctx.line||row.getAttribute('data-line'),step=ctx.step||row.getAttribute('data-step'),side=ctx.side||row.getAttribute('data-side')||'right',selectedText=ctx.selectedText||'',state={flavor:flavor||defaultCommentFlavor()};var box=el('section','ds-composer');box._dsDraftAnchor={file:file,line:line,side:side,step:step||''};box._dsDraftSelection=selectedText;box.setAttribute('data-comment-side',side);box.setAttribute('role','region');box.setAttribute('aria-label','New review comment on '+file+', line '+line);box.tabIndex=-1;
    var head=el('div','ds-composer-head');head.appendChild(el('strong','','New comment'));head.appendChild(el('span','ds-composer-anchor',file+':'+line));var close=el('button','ds-composer-close','×');close.type='button';close.setAttribute('aria-label','Cancel comment');close.onclick=function(){removeComposer(box,true);};head.appendChild(close);box.appendChild(head);
    var main=el('div','ds-composer-main'),tabs=el('div','ds-composer-tabs');tabs.setAttribute('role','radiogroup');tabs.setAttribute('aria-label','Comment type');tabs.setAttribute('aria-orientation','horizontal');['change','question','nit'].forEach(function(v){var f=FLAVOR[v],b=el('button','ds-composer-tab'+(v===state.flavor?' is-active':''));b.type='button';b.setAttribute('data-flavor',v);b.setAttribute('role','radio');b.setAttribute('aria-checked',v===state.flavor?'true':'false');b.tabIndex=v===state.flavor?0:-1;b.appendChild(composerFlavorIcon(v));b.appendChild(document.createTextNode(f.label));b.onclick=function(){state.flavor=v;syncComposerRadioGroup(tabs,b);};tabs.appendChild(b);});tabs.addEventListener('keydown',function(e){moveComposerRadio(tabs,'.ds-composer-tab',e);});var ta=el('textarea','ds-composer-ta');ta.placeholder='Write a question, requested fix, or note…';ta.rows=3;ta.setAttribute('aria-label','Review comment');ta.setAttribute('aria-keyshortcuts','Meta+Enter Control+Enter Meta+Shift+Enter Control+Shift+Enter');main.appendChild(tabs);main.appendChild(ta);box.appendChild(main);
    var foot=el('div','ds-composer-foot'),bar=el('div','ds-composer-actions'),add=el('button','ds-ghost ds-composer-add','Add to queue'),copy=el('button','ds-btn ds-btn-solid ds-composer-copy','Copy comment');
    function draft(){var body=ta.value.trim();return body?{file:file,line:Number(line),side:side,step:step,type:state.flavor,body:body,selectedText:selectedText,selection:ctx.selection,status:'open'}:null;}
    function queue(){var payload=draft();if(!payload){ta.focus();return;}add.disabled=true;copy.disabled=true;fetch(reviewPageUrl(API),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json().catch(function(){return {};}).then(function(data){if(!r.ok)throw new Error(data&&data.error||'Could not save comment');return data;});}).then(function(c){replaceComment(c);noteBlockingFeedbackMutation(c);removeComposer(box,false);clearComposerDraftForBox(box);syncCommentPins();syncFeedbackCards();syncFileCommentFlags();refreshCount();toast('Added to the review queue.');}).catch(function(err){add.disabled=false;copy.disabled=false;toast(err&&err.message?err.message:'Could not save your comment.','error');ta.focus();});}
    function copyDraft(){var payload=draft();if(!payload){ta.focus();return;}writeClipboard(commentsToText([payload]),function(){removeComposer(box,false);clearComposerDraftForBox(box);toast('Comment copied.');});}
    add.type='button';copy.type='button';add.onclick=queue;copy.onclick=copyDraft;bar.appendChild(add);bar.appendChild(copy);foot.appendChild(bar);box.appendChild(foot);ta.addEventListener('keydown',function(e){if(e.key!=='Enter'||(!e.metaKey&&!e.ctrlKey)||e.isComposing)return;e.preventDefault();if(e.shiftKey)queue();else copyDraft();});restoreComposerDraft(box);return box;
  }
  function removeComposer(box,restoreFocus){var b=box||$('.ds-composer');stashComposerDraft(b);var back=composerReturnFocus,anchor=b&&b._dsAnchorRow,holder=b&&(closest(b,'.ds-filepanel')||closest(b,'.ds-diff'));if(anchor&&anchor.classList)anchor.classList.remove('ds-comment-draft-anchor');if(b&&b.parentNode)b.parentNode.removeChild(b);if(holder)syncSplitFlow(holder);composerReturnFocus=null;if(restoreFocus!==false&&back&&document.contains(back)&&back.focus)back.focus();}
  function revealComposer(box){var scroller=closest(box,'.ds-diffscroll')||closest(box,'.ds-filedetail');if(!scroller)return;requestAnimationFrame(function(){if(!document.documentElement.contains(box))return;var sr=scroller.getBoundingClientRect(),br=box.getBoundingClientRect(),pad=10,card=closest(box,'.ds-diff'),sticky=card?$all('.ds-difftoolbar,.ds-diffhead',card):[],stickyHeight=sticky.reduce(function(total,node){var nr=node.getBoundingClientRect(),style=getComputedStyle(node);return total+(style.position==='sticky'&&nr.height&&nr.bottom>sr.top&&nr.top<sr.bottom?nr.height:0);},0),topEdge=sr.top+stickyHeight+pad,bottomEdge=sr.bottom-pad,available=bottomEdge-topEdge,delta=0;if(br.height>available||br.top<topEdge)delta=br.top-topEdge;else if(br.bottom>bottomEdge)delta=br.bottom-bottomEdge;if(!delta)return;var top=Math.max(0,scroller.scrollTop+delta);try{scroller.scrollTo({top:top,behavior:'auto'});}catch(e){scroller.scrollTop=top;}});}
  function openComposer(row,flavor,ctx){if(document.body.hasAttribute('data-history')){toast('History snapshots are read-only. Return to the live story to comment.','error');return;}removeComposer(null,false);if(!(ctx&&ctx.line)&&!row.getAttribute('data-line'))return;if(!row.parentNode)return;composerReturnFocus=document.activeElement;var box=buildComposer(row,flavor,ctx);box._dsAnchorRow=row;row.classList.add('ds-comment-draft-anchor');row.parentNode.insertBefore(box,row.nextSibling);syncSplitFlow(closest(row,'.ds-filepanel')||closest(row,'.ds-diff'));var ta=$('.ds-composer-ta',box);if(ta){try{ta.focus({preventScroll:true});}catch(e){ta.focus();}}revealComposer(box);}
  function openQueuedCommentEditor(card){if(!card)return;var editor=$('[data-comment-editor]',card),message=$('.ds-feedback-message',card);if(!editor)return;editor.hidden=false;card.classList.add('is-editing');if(message)message.hidden=true;var ta=$('[data-edit-body]',editor);if(ta)ta.focus();}
  function closeQueuedCommentEditor(card){if(!card)return;var editor=$('[data-comment-editor]',card),message=$('.ds-feedback-message',card),c=commentById(card.getAttribute('data-comment-id'));if(editor)editor.hidden=true;if(message)message.hidden=false;card.classList.remove('is-editing');if(c){var ta=$('[data-edit-body]',card);if(ta)ta.value=c.body||'';$all('[data-edit-flavor]',card).forEach(function(choice){choice.setAttribute('aria-pressed',choice.getAttribute('data-edit-flavor')===c.type?'true':'false');});}}
  function saveQueuedComment(card){if(!card)return;var id=card.getAttribute('data-comment-id'),ta=$('[data-edit-body]',card),selected=$('[data-edit-flavor][aria-pressed="true"]',card),body=ta&&ta.value.trim(),type=selected&&selected.getAttribute('data-edit-flavor');if(!body){if(ta)ta.focus();return;}var save=$('[data-edit-save]',card);if(save)save.disabled=true;fetch(reviewPageUrl(API+'/'+encodeURIComponent(id)),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,body:body})}).then(function(r){return r.json().catch(function(){return {};}).then(function(data){if(!r.ok)throw new Error(data&&data.error||'Could not update comment');return data;});}).then(function(c){replaceComment(c);noteBlockingFeedbackMutation(c);syncFeedbackCards();syncCommentPins();refreshCount();toast('Queued comment updated.');}).catch(function(err){if(save)save.disabled=false;toast(err&&err.message?err.message:'Could not update the comment.','error');});}
  function cancelRemoveConfirm(box){if(!box)return;var back=box._dsRemoveBtn;if(box.parentNode)box.parentNode.removeChild(box);if(back&&document.contains(back))back.focus();}
  function askRemoveQueuedComment(id,btn){
    var c=commentById(id);if(!c)return;
    var card=btn?closest(btn,'[data-feedback-card]'):null;if(!card)return;
    if($('[data-remove-confirm]',card))return;
    var box=el('div','ds-queue-edit');box.setAttribute('data-remove-confirm','');
    box.setAttribute('role','group');box.setAttribute('aria-label','Remove this comment?');
    box._dsRemoveBtn=btn||null;
    box.appendChild(el('strong','','Remove this comment?'));
    box.appendChild(el('p','',String(c.file||'')+':'+(c.line||0)+' will lose this queued comment. This cannot be undone.'));
    var row=el('div','ds-queue-edit-actions'),cancel=el('button','ds-btn ds-btn-ghost','Cancel'),remove=el('button','ds-btn ds-btn-ghost ds-danger','Remove comment');
    cancel.type='button';remove.type='button';
    cancel.onclick=function(){cancelRemoveConfirm(box);};
    remove.onclick=function(){deleteQueuedComment(id,box);};
    row.appendChild(cancel);row.appendChild(remove);box.appendChild(row);
    card.appendChild(box);cancel.focus();
  }
  function deleteQueuedComment(id,box){
    var removed=commentById(id);if(!removed)return;
    fetch(reviewPageUrl(API+'/'+encodeURIComponent(id)),{method:'DELETE'}).then(function(r){if(!r.ok)throw new Error('Remove failed');allComments=allComments.filter(function(c){return c.id!==id;});noteBlockingFeedbackMutation(removed);syncFeedbackCards();syncCommentPins();syncFileCommentFlags();refreshCount();toast('Queued comment removed.');var next=$('[data-feedback-card] [data-remove-comment]');if(next)next.focus();}).catch(function(){if(!box||!box.parentNode){toast('Could not remove the queued comment.','error');return;}var err=$('[data-remove-error]',box);if(!err){err=el('p','');err.setAttribute('data-remove-error','');err.setAttribute('role','alert');box.appendChild(err);}err.textContent='Could not remove the queued comment. Try again.';});
  }
  function setBusy(b){agentBusy=b;}
  function refreshComments(done){fetch(reviewPageUrl(API)).then(function(r){if(!r.ok){var err=new Error('HTTP '+r.status);err.status=r.status;throw err;}return r.json();}).then(function(list){if(Array.isArray(list))allComments=list;syncCommentPins();syncFeedbackCards();syncFileCommentFlags();refreshCount();syncReviewFeedbackIdentity();if(done)done(list);}).catch(function(err){if(err&&err.status===409){setLiveIssue('disconnected',true);if(done)done(null);return;}toast('Could not refresh review comments. Existing comments remain visible.','error');if(done)done(null);});}
  var acAbort=null;
  function acRoot(){return document.getElementById('ds-agentpanel');}
  function availableStoryAgents(agents){var raw=(agents||[]).filter(function(a){return a==='claude'||a==='codex';});return ['codex','claude'].filter(function(a){return raw.indexOf(a)>=0;});}
  function restoreAgentPanel(){var node=acRoot(),home=document.getElementById('ds-agenthome');if(!node)return;node.hidden=true;node.setAttribute('data-variant','floating');if(home&&node.parentNode!==home)home.appendChild(node);}
  function repairStory(action,target){
    if(agentBusy){toast('The agent is already working — wait for it to finish.');return;}
    fetch('/api/agents').then(function(r){return r.json();}).then(function(d){
      var agents=availableStoryAgents(d.agents||[]);if(!agents.length){toast('No Claude or Codex CLI found on PATH.','error');return;}
      var root=acRoot();if(!root)return;
      setBusy(true);agentBusy=true;
      root.setAttribute('data-variant','floating');root.hidden=false;
      var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;acAbort=ctrl;
      var panel=mountEnginePanel(root,{
        onStop:function(){if(acAbort)acAbort.abort();},
        onClose:function(){restoreAgentPanel();},
        onBlocked:function(){setBusy(false);agentBusy=false;acAbort=null;},
        onDone:function(status){setBusy(false);agentBusy=false;acAbort=null;if(status!=='complete')return;var btn=el('button',progressPrimaryActionClass,'Reload story');btn.setAttribute('data-reload-diff','');panel.showFoot(btn);}
      });
      var payload={action:action,agent:agents[0]};
      if(target&&target.observation)payload.observation=target.observation;if(target&&target.file)payload.file=target.file;if(target&&target.line)payload.line=target.line;if(target&&target.stepId)payload.stepId=target.stepId;
      panel.start();runProgress(panel,action==='refresh'?reviewPageUrl('/api/story/refresh'):'/api/story/repair',payload,ctrl).then(function(){if(agentBusy){setBusy(false);agentBusy=false;acAbort=null;}});
    }).catch(function(){toast('Could not start story repair.','error');});
  }
  function storyGenEls(){
    return {
      agentSel:$('#storyAgentSel'),
      agentChoices:$('#storyAgentChoices'),
      agentField:$('.ds-field-agent'),
      agentState:$('[data-story-agent-state]'),
      modelSel:$('#storyModelSel'),
      modelChoices:$('#storyModelChoices'),
      qualityField:$('[data-story-quality-field]'),
      modeSel:$('#storyMode'),
      audienceSel:$('#storyAudience'),
      note:$('#storyReviewerNote'),
      scope:$('[data-story-scope]'),
      scopeError:$('#storyScopeError'),
      fileSearch:$('[data-story-file-search]'),
      ctaLabel:$('[data-storygen-cta-label]'),
      ctaSub:$('[data-storygen-cta-sub]'),
      warn:$('#storySkillWarn'),
      warnText:$('#storySkillWarnText'),
      updateBtn:$('#storySkillUpdateBtn')
    };
  }
  var storyIntroSaved=null,storyAgentReady=false;
  function storyIntroEls(){
    var wrap=document.querySelector('.ds-step.is-intro .ds-introwrap');
    if(!wrap)return null;
    return {
      wrap:wrap,
      title:$('.ds-intro-title',wrap),
      lede:$('.ds-intro-lede',wrap),
      eyebrow:$('.ds-intro-eyebrow span',wrap),
      facts:$('.ds-intro-facts',wrap),
      card:$('.ds-storygen-card',wrap)
    };
  }
  function mountPanelInStage(e){
    var node=acRoot(); if(!node)return null;
    node.setAttribute('data-variant','stage');
    var mount=document.getElementById('ds-storystage');
    if(!mount){
      mount=document.createElement('div'); mount.id='ds-storystage';
      e.wrap.insertBefore(mount,e.card||null);
    }
    mount.appendChild(node);
    return node;
  }
  function setStoryGenerating(state){
    var e=storyIntroEls(); if(!e)return;
    var on=!!state;
    if(on){
      if(!storyIntroSaved)storyIntroSaved={
        title:e.title?e.title.textContent:'',
        lede:e.lede?e.lede.textContent:'',
        eyebrow:e.eyebrow?e.eyebrow.textContent:''
      };
      var failed=state==='failed';
      if(e.title)e.title.textContent=failed?"The story wasn't created":'Writing the story of this change';
      if(e.eyebrow)e.eyebrow.textContent=failed?'Story not created':'Story in progress';
      if(e.lede)e.lede.textContent=failed
        ? 'No reviewable story is available yet. Try again, or change the story settings.'
        : 'Keep reading the diff under All files — the story will land here when it is ready.';
      if(e.facts)e.facts.hidden=true;
      if(e.card)e.card.hidden=true;
    }else{
      if(storyIntroSaved){
        if(e.title)e.title.textContent=storyIntroSaved.title;
        if(e.lede)e.lede.textContent=storyIntroSaved.lede;
        if(e.eyebrow)e.eyebrow.textContent=storyIntroSaved.eyebrow;
      }
      if(e.facts)e.facts.hidden=false;
      if(e.card)e.card.hidden=false;
    }
  }
  function setStoryChoice(id,value){
    var input=$('#'+id);if(!input)return;
    input.value=value||'';
    $all('[data-story-choice="'+id+'"]').forEach(function(b){
      var on=b.getAttribute('data-value')===input.value;
      b.classList.toggle('is-active',on);
      b.setAttribute('role','radio');
      b.setAttribute('aria-checked',on?'true':'false');
      b.setAttribute('tabindex',on?'0':'-1');
    });
    if(id==='storyMode')updateStoryGenerationSummary();
  }
  function storyFileChecks(){return $all('input[data-story-file]');}
  function storySelectedFiles(){
    return storyFileChecks().filter(function(c){return c.checked;}).map(function(c){return c.value;});
  }
  var STORY_DEPTH_UI={
    brief:{label:'Generate compact story'},
    guided:{label:'Generate guided story'},
    detailed:{label:'Generate deep story'}
  };
  function updateStoryGenerationSummary(){
    var e=storyGenEls(),mode=e.modeSel&&e.modeSel.value?e.modeSel.value:'guided';
    var ui=STORY_DEPTH_UI[mode]||STORY_DEPTH_UI.guided,n=storySelectedFiles().length;
    if(e.ctaLabel)e.ctaLabel.textContent=ui.label;
    if(e.ctaSub)e.ctaSub.textContent=storyAgentReady
      ? n+' selected '+(n===1?'file':'files')+' · gaps are flagged as Unexplained'
      : 'Waiting for an available local writer';
  }
  function storyPathIsTest(path){
    return /(^|\/)(__tests__|test|tests|spec)(\/|$)|(^|[._-])(test|spec)\.[^/]+$/i.test(path);
  }
  function storyPathIsConfig(path){
    return /(^|\/)(package(-lock)?\.json|tsconfig\.json|vite\.config\.|webpack\.config\.|rollup\.config\.|hardhat\.config\.|foundry\.toml|\.github\/)|(^|\/)(config|configs)(\/|$)|\.(config|rc)\.[^/]+$/i.test(path);
  }
  function storyPathIsDoc(path){return /\.(md|mdx|txt|rst)$/i.test(path);}
  function storyFileExt(path){
    var base=path.slice(path.lastIndexOf('/')+1),i=base.lastIndexOf('.');
    return i>0?base.slice(i):'';
  }
  function updateStoryScopeCount(){
    var n=storySelectedFiles().length,count=$('#storyScopeCount'),e=storyGenEls(),generate=$('[data-generate-story]');
    if(count)count.textContent=String(n);
    if(e.scopeError)e.scopeError.hidden=!!n;
    if(generate)generate.disabled=!n||agentBusy||!storyAgentReady;
    updateStoryGenerationSummary();
  }
  function filterStoryFiles(){
    var e=storyGenEls(),q=(e.fileSearch&&e.fileSearch.value||'').trim().toLowerCase();
    $all('.ds-storyfile').forEach(function(row){
      var input=$('input[data-story-file]',row),path=input&&input.value?input.value.toLowerCase():'';
      row.hidden=!!q&&path.indexOf(q)<0;
    });
  }
  function setStoryFileChecks(predicate){
    storyFileChecks().forEach(function(c){c.checked=!!predicate(c.value);});
    updateStoryScopeCount();
  }
  function renderStoryChoices(holder,id,items,value){
    if(!holder)return;
    holder.textContent='';
    items.forEach(function(item){
      var b=el('button','ds-choice');
      b.type='button';
      b.setAttribute('data-story-choice',id);
      b.setAttribute('data-value',item[1]);
      b.setAttribute('role','radio');
      b.setAttribute('aria-checked','false');
      b.setAttribute('tabindex','-1');
      if(item[2])b.setAttribute('title',item[2]);
      b.textContent=item[0];
      holder.appendChild(b);
    });
    var chosen=items.some(function(item){return item[1]===value;})?value:(items[0]?items[0][1]:'');
    setStoryChoice(id,chosen);
  }
  function fillStoryModels(){
    var e=storyGenEls();
    if(!e.modelSel)return;
    var ms=STORY_MODELS[e.agentSel?e.agentSel.value:'']||[['Best quality','']];
    renderStoryChoices(e.modelChoices,'storyModelSel',ms,e.modelSel.value);
  }
  function loadCodexStoryModels(){
    return fetch(CODEX_MODEL_API).then(function(r){
      return r.json().then(function(body){if(!r.ok)throw new Error(body.error||'Could not load Codex models.');return body;});
    }).then(function(body){
      var models=(body.models||[]).map(function(item){
        return item&&item.label&&item.model?[String(item.label),String(item.model),String(item.description||'')]:null;
      }).filter(Boolean);
      if(!models.length)return;
      STORY_MODELS.codex=models;
      var e=storyGenEls();if(e.agentSel&&e.agentSel.value==='codex')fillStoryModels();
    }).catch(function(){
      // The same-runtime default above remains valid when catalog discovery is unavailable.
    });
  }
  function setStoryAgents(agents,errorMessage){
    var e=storyGenEls();
    var list=(agents||[]).filter(function(a){return a==='claude'||a==='codex';});
    if(!list.length){
      storyAgentReady=false;
      if(e.agentSel)e.agentSel.value='';
      if(e.agentChoices)e.agentChoices.textContent='';
      if(e.modelSel)e.modelSel.value='';
      if(e.modelChoices)e.modelChoices.textContent='';
      if(e.agentField)e.agentField.classList.add('is-wide');
      if(e.qualityField)e.qualityField.hidden=true;
      if(e.agentState){e.agentState.hidden=false;e.agentState.classList.add('is-error');e.agentState.textContent=errorMessage||'No local writer found. Install Codex or Claude, then reload this page.';}
      updateStoryScopeCount();
      return;
    }
    storyAgentReady=true;
    if(e.agentField)e.agentField.classList.remove('is-wide');
    if(e.qualityField)e.qualityField.hidden=false;
    if(e.agentState){e.agentState.hidden=true;e.agentState.classList.remove('is-error');e.agentState.textContent='';}
    var current=list.indexOf('codex')>=0?'codex':list[0];
    renderStoryChoices(e.agentChoices,'storyAgentSel',list.map(function(a){return [a.charAt(0).toUpperCase()+a.slice(1),a];}),current);
    fillStoryModels();
    updateStoryScopeCount();
  }
  var storySkills=null,storySkillHide=null;
  function showStorySkillState(sk){
    if(sk)storySkills=sk;
    sk=storySkills;
    var e=storyGenEls();
    if(!e.warn||!e.warnText||!e.updateBtn||!sk)return;
    if(storySkillHide){clearTimeout(storySkillHide);storySkillHide=null;}
    var agent=e.agentSel&&e.agentSel.value?e.agentSel.value:'';
    var st=(agent&&sk.agents&&sk.agents[agent])?sk.agents[agent]:sk;
    var label=agent?agent.charAt(0).toUpperCase()+agent.slice(1):'the agent';
    var where=st.dir||'~/.agents, ~/.claude, or ~/.codex';
    if(sk.legacyInstalled){
      e.warn.hidden=false;e.updateBtn.hidden=false;e.updateBtn.disabled=false;e.updateBtn.textContent='Update skills';
      var retired=sk.legacyNames&&sk.legacyNames.length?sk.legacyNames:[];
      e.warnText.textContent=(retired.length?retired.join(' and '):'An older storyteller skill')+(retired.length>1?' were':' was')+' renamed to codestory-storyteller. Update skills to remove the retired '+(retired.length>1?'copies':'copy')+' before generating.';
      return;
    }
    if(st.current){
      e.warn.hidden=false;e.updateBtn.hidden=true;
      e.warnText.textContent=agent?'The storyteller skill is up to date for '+label+'.':'Storyteller skills are up to date.';
      storySkillHide=setTimeout(function(){e.warn.hidden=true;},1400);return;
    }
    e.warn.hidden=false;e.updateBtn.hidden=false;e.updateBtn.disabled=false;e.updateBtn.textContent='Update skills';
    e.warnText.textContent=st.installed
      ? 'The storyteller skill in '+where+' does not match this app. Update it before generating so '+label+' sees the current story rules.'
      : 'The storyteller skill was not found in '+where+'. Install it before generating so '+label+' can create the story reliably.';
  }
  function wireStorySkillUpdate(){
    var e=storyGenEls();if(!e.updateBtn)return;
    e.updateBtn.onclick=function(){
      e.updateBtn.disabled=true;e.updateBtn.textContent='Updating…';if(e.warnText)e.warnText.textContent='Installing bundled codeStory skills locally…';
      fetch('/api/skills/update',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
        if(d&&d.skills)showStorySkillState(d.skills);else throw new Error('bad response');
      }).catch(function(){
        e.updateBtn.disabled=false;e.updateBtn.textContent='Try again';
        if(e.warnText)e.warnText.textContent='Could not update skills. Run scripts/install-skills.sh from a codeStory clone, or re-run the codeStory installer.';
      });
    };
  }
  function initStoryGenerator(){
    var e=storyGenEls();
    if(!e.agentSel)return;
    setStoryChoice('storyMode','guided');
    updateStoryScopeCount();
    storyFileChecks().forEach(function(c){c.addEventListener('change',updateStoryScopeCount);});
    if(e.fileSearch)e.fileSearch.addEventListener('input',filterStoryFiles);
    wireStorySkillUpdate();
    fetch('/api/agents').then(function(r){return r.json();}).then(function(d){
      setStoryAgents(d.agents||[]);
      if(storyAgentReady)showStorySkillState(d.skills);
      if((d.agents||[]).indexOf('codex')>=0)loadCodexStoryModels();
    }).catch(function(){setStoryAgents([],'Could not check local writers. Reload the page to try again.');});
  }
  function generateStory(btn){
    if(!storyAgentReady){var noWriter=storyGenEls();if(noWriter.agentState){noWriter.agentState.hidden=false;noWriter.agentState.focus();}return;}
    if(agentBusy){toast('The agent is already working — wait for it to finish.');return;}
    var selected=storySelectedFiles();
    if(!selected.length){
      var emptyState=storyGenEls();
      if(emptyState.scope)emptyState.scope.open=true;
      if(emptyState.scopeError){emptyState.scopeError.hidden=false;emptyState.scopeError.focus();}
      return;
    }
    restoreAgentPanel();
    var intro=storyIntroEls();
    var root=intro?mountPanelInStage(intro):acRoot();
    if(!root)return;
    if(intro)setStoryGenerating(true);
    var reviewUrl=btn.getAttribute('data-review-url')||'';
    var e=storyGenEls();
    var model=e.modelSel?e.modelSel.value:'';
    var payload={
      base:btn.getAttribute('data-base')||undefined,
      head:btn.getAttribute('data-head')||undefined,
      agent:e.agentSel&&e.agentSel.value?e.agentSel.value:undefined,
      model:model||undefined,
      mode:e.modeSel&&e.modeSel.value?e.modeSel.value:undefined,
      audience:e.audienceSel&&e.audienceSel.value?e.audienceSel.value:undefined,
      includedFiles:storySelectedFiles(),
      reviewerNote:e.note&&e.note.value?e.note.value.trim():undefined
    };
    function restoreForm(){
      setStoryGenerating(false); restoreAgentPanel();
      btn.disabled=false; setBusy(false); acAbort=null;
    }
    var panel;
    function startRun(){
      var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
      if(intro)setStoryGenerating(true);
      acAbort=ctrl;btn.disabled=true;setBusy(true);panel.start();
      runProgress(panel,'/api/generate',payload,ctrl);
    }
    function showRecovery(err){
      if(intro)setStoryGenerating('failed');
      if(panel.els.close)panel.els.close.hidden=true;
      var modelFailure=!!(err&&/Codex needs an update for/.test(err.label||''));
      var actions=el('div','ds-pp-recovery'),primary,secondary;
      if(modelFailure){
        primary=el('button',progressPrimaryActionClass,'Change model');
        primary.onclick=function(){restoreForm();loadCodexStoryModels().then(function(){
          var choice=$('[data-story-choice="storyModelSel"][aria-checked="true"]');if(choice)choice.focus();
        });};
        secondary=el('button',progressSecondaryActionClass,'Try again after updating');
        secondary.onclick=function(){loadCodexStoryModels().then(function(){
          var current=storyGenEls();payload.model=current.modelSel&&current.modelSel.value?current.modelSel.value:undefined;startRun();
        });};
      }else{
        primary=el('button',progressPrimaryActionClass,'Try again');primary.onclick=startRun;
        secondary=el('button',progressSecondaryActionClass,'Review settings');secondary.onclick=function(){
          restoreForm();var choice=$('[data-story-choice="storyMode"][aria-checked="true"]');if(choice)choice.focus();
        };
      }
      actions.appendChild(primary);actions.appendChild(secondary);panel.showFoot(actions);
      var active=document.activeElement;
      if(root.offsetParent&&(!active||active===document.body||active===btn))primary.focus();
    }
    panel=mountEnginePanel(root,{
      onStop:function(){ if(acAbort)acAbort.abort(); },
      onClose:function(){ restoreForm(); },
      onBlocked:function(err){ setBusy(false); acAbort=null; btn.disabled=false;showRecovery(err); },
      onDone:function(status,result){
        setBusy(false); acAbort=null; btn.disabled=false;
        var nextReviewUrl=reviewUrl?sameOriginPath(reviewUrl):'';
        // pi-lens-ignore: ast-grep:no-open-redirect-js
        if(status==='complete'&&result&&result.storyWritten&&nextReviewUrl){location.href=nextReviewUrl;return;}
        if(status==='stopped'){restoreForm();return;}
        showRecovery(panel.error());
      }
    });
    startRun();
  }
  function refreshCount(){
    var queued=queuedComments(),openN=queued.length;
    var blockingN=queued.filter(function(c){return c.type==='change';}).length;
    var b=$('#ds-open-count b');if(b)b.textContent=openN;
    var count=$('#ds-open-count');if(count)count.hidden=openN===0;
    var reviewBtn=$('[data-review-status]'),unexplained=reviewBtn?Number(reviewBtn.getAttribute('data-unexplained-count')||0):0,excluded=reviewBtn?Number(reviewBtn.getAttribute('data-excluded-count')||0):0,indexDivergent=reviewBtn?Number(reviewBtn.getAttribute('data-index-divergence-count')||0):0;
    var storyFreshness=reviewBtn?reviewBtn.getAttribute('data-story-freshness')||'unverified':'current';
    var feedbackHealthy=document.body.getAttribute('data-feedback-health')!=='invalid';
    if(reviewBtn)reviewBtn.setAttribute('aria-label','Review, '+openN+' queued '+(openN===1?'comment':'comments')+(!feedbackHealthy?', feedback file needs repair':indexDivergent?', '+indexDivergent+' staged and working-tree '+(indexDivergent===1?'version differs':'versions differ'):storyFreshness!=='current'?', story requires regeneration':unexplained?', '+unexplained+' '+(unexplained===1?'change':'changes')+' not explained by the story':excluded?', '+excluded+' excluded '+(excluded===1?'file':'files')+' to inspect':''));
    var summary=$('[data-review-summary-count]');if(summary)summary.textContent=formatReviewCount(openN)+' queued '+(openN===1?'comment':'comments');
    var notesTabCount=$('[data-review-open-notes]');if(notesTabCount){notesTabCount.textContent=openN;notesTabCount.hidden=openN===0;}
    var pill=$('.ds-trustpill'),fresh=document.body.getAttribute('data-story-freshness')||'unverified',focused=document.body.getAttribute('data-story-scope')==='focused',liveDiffCurrent=document.body.getAttribute('data-live-diff-stale')!=='1',coverageClean=(!pill||pill.classList.contains('is-clean'))&&fresh==='current',exclusionsClear=excluded===0||exclusionsAcknowledged(),clean=feedbackHealthy&&coverageClean&&exclusionsClear&&indexDivergent===0&&!focused&&liveDiffCurrent;
    // One flag on the Review tab, shown only while the page behind it still
    // wants a decision. Clean means the flag goes away, not that it turns green.
    var flag=$('[data-review-flag]');if(flag)flag.hidden=blockingN===0&&!!clean;
    var qs=$('[data-queue-summary]');if(qs){qs.textContent=formatReviewCount(openN)+' queued';qs.hidden=openN===0;}
    $all('[data-copy-comments]').forEach(function(button){button.disabled=openN===0;});
    if(fileItems&&fileItems.length)syncFileCommentFlags();
  }
  function excludedPaths(){return $all('[data-excluded-file]').map(function(card){return card.getAttribute('data-excluded-file');}).filter(Boolean);}
  function exclusionsAckKey(){return 'ds-exclusions-ack:'+(document.body.getAttribute('data-review-scope')||'')+':'+(document.body.getAttribute('data-current-diff-hash')||'');}
  function exclusionsAcknowledged(){if(!excludedPaths().length)return true;try{return localStorage.getItem(exclusionsAckKey())==='1';}catch(e){return false;}}
  function syncExclusionAcknowledgement(){var checkbox=$('[data-exclusions-ack]');if(checkbox)checkbox.checked=exclusionsAcknowledged();refreshCount();}
  function setExclusionsAcknowledged(on){try{if(on)localStorage.setItem(exclusionsAckKey(),'1');else localStorage.removeItem(exclusionsAckKey());}catch(e){}refreshCount();}
  function toast(msg,tone){
    if(!toastEl)return;
    var sequence=++toastSequence,isError=tone==='error';
    clearTimeout(toastTimer);toastEl.classList.remove('is-show');toastEl.classList.toggle('is-error',isError);toastEl.textContent='';
    toastEl.setAttribute('role',isError?'alert':'status');toastEl.setAttribute('aria-live',isError?'assertive':'polite');
    requestAnimationFrame(function(){if(sequence!==toastSequence)return;toastEl.textContent=msg;toastEl.classList.add('is-show');});
    if(!isError)toastTimer=setTimeout(function(){if(sequence!==toastSequence)return;toastEl.classList.remove('is-show');setTimeout(function(){if(sequence!==toastSequence)return;toastEl.textContent='';toastEl.classList.remove('is-error');toastEl.setAttribute('role','status');toastEl.setAttribute('aria-live','polite');},220);},5000);
  }
  function commentsToText(list){
    var out=[list.length===1?'Review comment from codeStory':'Code review comments from codeStory',''];
    list.forEach(function(c,i){
      var label=(FLAVOR[c.type]&&FLAVOR[c.type].label)||c.type;
      var sel=c.selection||{},start=sel.startLine||c.line,end=sel.endLine||start;
      var side=commentSide(c);
      out.push((i+1)+'. ['+label+'] '+c.file+':'+start+(end&&end!==start?'-'+end:'')+' ('+(side==='left'?'old side':'new side')+')');
      if(c.selectedText){var fence=String.fromCharCode(96,96,96);out.push('Selected code:',fence,String(c.selectedText),fence);}
      out.push('Comment:',String(c.body||''));
      out.push('');
    });
    return out.join('\n').replace(/\s+$/,'');
  }
  function writeClipboard(text,onOk){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(onOk,function(){legacyCopy(text,onOk);});
    }else{legacyCopy(text,onOk);}
  }
  function legacyCopy(text,onOk){
    try{
      var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');
      ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);
      ta.select();var ok=document.execCommand('copy');document.body.removeChild(ta);
      if(ok)onOk();else toast('Could not copy — select the comments manually.','error');
    }catch(e){toast('Could not copy — select the comments manually.','error');}
  }
  function copyComments(){
    fetch(reviewPageUrl(API)).then(function(r){return r.json();}).then(function(list){
      var pick=(Array.isArray(list)?list:[]).filter(function(c){return c.status==='open';});
      if(!pick.length){toast('No queued comments to copy.');return;}
      writeClipboard(commentsToText(pick),function(){showCopySuccess(pick.length);toast('Copied '+pick.length+' queued '+(pick.length===1?'comment.':'comments.'));});
    }).catch(function(){toast('Could not read comments to copy.','error');});
  }
  function showCopySuccess(count){
    $all('[data-copy-comments]').forEach(function(button){
      if(button._dsCopyTimer)clearTimeout(button._dsCopyTimer);
      var label=$('[data-copy-comments-label]',button);button.classList.add('is-copied');button.setAttribute('aria-label','Copied '+count+' queued '+(count===1?'comment':'comments'));
      if(label)label.textContent='Copied';
      button._dsCopyTimer=setTimeout(function(){button.classList.remove('is-copied');button.setAttribute('aria-label','Copy all queued comments');if(label)label.textContent='Copy all';button._dsCopyTimer=0;},1800);
    });
  }
  function closeStoryTuneMenus(except){
    $all('.ds-story-tune[open],.ds-landing-more[open]').forEach(function(menu){if(menu!==except)menu.open=false;});
  }

  // Blame: which commit put a line here, or took it away. Opened from a row's
  // line number or the B key, anchored under that number, one at a time.
  var blamePop=null,blameFor=null,blameReq=0;
  function blameRowTarget(row){
    if(!row)return null;
    var side=row.getAttribute('data-side'),line=parseInt(row.getAttribute('data-line')||'0',10),file=row.getAttribute('data-file')||'';
    return (side==='left'||side==='right')&&line>0&&file?{row:row,side:side,line:line,file:file}:null;
  }
  function blameOpen(){return !!(blamePop&&!blamePop.hidden);}
  function closeBlame(restore){
    if(!blameOpen())return;
    blamePop.hidden=true;blameReq++;
    var back=blameFor;blameFor=null;
    if(restore&&back&&document.documentElement.contains(back.row)){try{back.row.focus({preventScroll:true});}catch(err){back.row.focus();}}
  }
  function blameCommit(kicker,c){
    var wrap=el('div','ds-blame-commit');
    wrap.appendChild(el('div','ds-blame-kicker',kicker));
    wrap.appendChild(el('div','ds-blame-subject',c.subject||'(no subject)'));
    var meta=el('div','ds-blame-meta');
    var sha=el('code','ds-blame-sha',String(c.sha||'').slice(0,8));sha.title=c.sha||'';
    meta.appendChild(sha);meta.appendChild(el('span','',(c.author||'')+(c.relative?' · '+c.relative:'')));
    if(c.date)meta.title=c.date;
    wrap.appendChild(meta);
    var actions=el('div','ds-blame-actions');
    var routeBase=document.body.getAttribute('data-route-base')||'';
    if(routeBase){
      var open=el('a','ds-blame-action','Review this commit');
      open.href=routeBase+'/change?scope=commit&commit='+encodeURIComponent(c.sha);open.target='_blank';open.rel='noopener';
      actions.appendChild(open);
    }
    var copy=el('button','ds-blame-action','Copy SHA');copy.type='button';
    copy.onclick=function(){writeClipboard(c.sha,function(){copy.textContent='Copied';});};
    actions.appendChild(copy);
    wrap.appendChild(actions);
    return wrap;
  }
  function renderBlame(body,data){
    body.textContent='';
    if(data.kind==='uncommitted'){
      body.appendChild(el('div','ds-blame-kicker','Not committed yet'));
      body.appendChild(el('p','ds-blame-note','This line exists only in the working tree.'));
      return;
    }
    if(data.kind==='line'){
      body.appendChild(blameCommit(data.inRange?'Changed in this review by':'Unchanged here since',data.commit));
      return;
    }
    if(data.removedBy==='uncommitted'){
      body.appendChild(el('div','ds-blame-kicker','Removed by uncommitted changes'));
      body.appendChild(el('p','ds-blame-note','No commit has taken this line away yet.'));
    }else body.appendChild(blameCommit(data.moved?'Moved by':'Removed by',data.removedBy));
    if(data.origin)body.appendChild(blameCommit('Originally written in',data.origin));
  }
  function placeBlame(anchor){
    var r=anchor.getBoundingClientRect(),w=blamePop.offsetWidth||320,h=blamePop.offsetHeight||140;
    var vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight;
    var top=r.bottom+6;if(top+h>vh-8)top=Math.max(8,r.top-6-h);
    blamePop.style.left=Math.max(8,Math.min(r.left,vw-w-8))+'px';blamePop.style.top=top+'px';
  }
  function openBlame(target,anchor){
    if(!blamePop){
      blamePop=el('div','ds-blame-pop');blamePop.hidden=true;blamePop.setAttribute('role','dialog');blamePop.setAttribute('aria-modal','true');blamePop.tabIndex=-1;
      document.body.appendChild(blamePop);
    }
    var req=++blameReq;blameFor=target;
    blamePop.textContent='';
    blamePop.setAttribute('aria-label','Blame for '+(target.side==='left'?'before':'after')+' line '+target.line);
    var head=el('div','ds-blame-head');
    head.appendChild(el('span','ds-blame-title',(target.side==='left'?'Before':'After')+' · line '+target.line));
    var close=el('button','ds-blame-close','×');close.type='button';close.setAttribute('aria-label','Close blame');
    close.onclick=function(){closeBlame(true);};
    head.appendChild(close);blamePop.appendChild(head);
    var body=el('div','ds-blame-body');body.appendChild(el('p','ds-blame-note','Reading history…'));
    blamePop.appendChild(body);
    blamePop.hidden=false;placeBlame(anchor);
    try{blamePop.focus({preventScroll:true});}catch(err){blamePop.focus();}
    var q='/api/blame?side='+target.side+'&line='+target.line+'&file='+encodeURIComponent(target.file);
    fetch(reviewPageUrl(q)).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(res){
      if(req!==blameReq)return;
      if(!res.ok){body.textContent='';body.appendChild(el('p','ds-blame-note',(res.j&&res.j.error)||'Git has no blame for this line.'));}
      else renderBlame(body,res.j);
      placeBlame(anchor);
    }).catch(function(){
      if(req!==blameReq)return;
      body.textContent='';body.appendChild(el('p','ds-blame-note','Could not read the history for this line.'));
    });
  }

  // A moved line's tag jumps to its other end in the same file and view.
  function jumpToMovedLine(tag){
    var side=tag.getAttribute('data-moved-side'),line=tag.getAttribute('data-moved-line');
    var scope=closest(tag,'[data-diff-inner],[data-split-inner],[data-full-inner]')||closest(tag,'.ds-filepanel-body')||document;
    var row=$all('[data-side="'+side+'"][data-line="'+line+'"]',scope).filter(function(r){return !!r.offsetParent;})[0];
    if(!row)return;
    // The same stable marker change navigation leaves: one outline, no flash.
    var holder=closest(tag,'.ds-filepanel')||scope;
    $all('.ds-row-add,.ds-row-del,.ds-row-pair',holder).forEach(function(r){r.classList.remove('is-change-jump');r.removeAttribute('aria-current');});
    $all('.ds-row-pair-l.is-change-jump',holder).forEach(function(r){r.classList.remove('is-change-jump');});
    row.classList.add('is-change-jump');row.setAttribute('aria-current','true');
    scrollReviewRowVertically(row);
    try{row.focus({preventScroll:true});}catch(err){row.focus();}
  }

  function onClick(e){
    var t=e.target,b;
    closeStoryTuneMenus(closest(t,'.ds-story-tune,.ds-landing-more'));
    if(blameOpen()&&!closest(t,'.ds-blame-pop')&&!closest(t,'.ds-no'))closeBlame(false);
    b=closest(t,'[data-moved-jump]');if(b){e.preventDefault();jumpToMovedLine(b);return;}
    b=closest(t,'.ds-no');
    if(b&&(b.textContent||'').trim()){
      var blameRow=closest(b,'[data-review-row]'),blameTarget=blameRowTarget(blameRow);
      if(blameTarget){
        e.preventDefault();
        if(blameOpen()&&blameFor&&blameFor.row===blameRow){closeBlame(false);return;}
        openBlame(blameTarget,b);return;
      }
    }
    b=closest(t,'[data-vscode-symbol]');if(b&&(e.metaKey||e.ctrlKey)){e.preventDefault();openSymbolInEditor(b);return;}
    b=closest(t,'[data-review-reload]');if(b){location.reload();return;}
    b=closest(t,'[data-move-target-file]');if(b){var targetStep=parseInt(b.getAttribute('data-move-target-step')||'0',10);if(targetStep>0){setActive(targetStep);return;}var targetFile=b.getAttribute('data-move-target-file')||'',targetLine=parseInt(b.getAttribute('data-move-target-line')||'0',10);if(targetFile){openMoveTargetFile(targetFile,targetLine);return;}}
    b=closest(t,'[data-selection-comment]');if(b){var ctx=selectionContext;closeSelectionMenu();if(ctx)openComposer(ctx.anchorRow,defaultCommentFlavor(),ctx);return;}
    if(selectionMenu&&!selectionMenu.hidden&&!closest(t,'[data-selection-menu]'))closeSelectionMenu();
    b=closest(t,'[data-sidebar-toggle]');if(b){
      var collapsed=document.body.classList.contains('ds-rail-collapsed');
      if(compactScreen()){if(collapsed)openCompactSidebar(b);else closeCompactSidebar(true);}
      else setSidebarCollapsed(!collapsed);
      return;
    }
    b=closest(t,'[data-sidebar-scrim]');if(b){closeCompactSidebar(true);return;}
    b=closest(t,'[data-view]');if(b){setView(b.getAttribute('data-view'));return;}
    b=closest(t,'[data-review-tab-select]');if(b){selectReviewTab(b.getAttribute('data-review-tab-select'),false);return;}
    b=closest(t,'[data-goto-review]');if(b){gotoReview(b.getAttribute('data-goto-review'),b.getAttribute('data-goto-excluded'));return;}
    b=closest(t,'[data-file-filter]');if(b){setFileFilter(b.getAttribute('data-file-filter'));return;}
    b=closest(t,'[data-next-unviewed]');if(b){nextUnviewedFile();return;}
    b=closest(t,'[data-retry-file-panel]');if(b){var lazyPanel=closest(b,'.ds-filepanel');if(lazyPanel){replaceChildrenFromHtml(lazyPanel,'<div class="ds-filepanel-loading" data-file-panel-lazy role="status">Loading file review…</div>');loadFilePanel(lazyPanel);}return;}
    b=closest(t,'[data-retry-story-step]');if(b){var lazyStep=closest(b,'.ds-step'),stepIndex=Number(b.getAttribute('data-retry-story-step'));if(lazyStep){lazyStep.setAttribute('data-step-lazy','1');loadStoryStep(stepIndex,function(ok){if(ok&&active===stepIndex)activateStep(stepIndex,true);});}return;}
    b=closest(t,'[data-drift-refresh]');if(b){var observation=driftDrawer&&driftDrawer.getAttribute('data-drift-observation');closeDriftDrawer();repairStory('refresh',{observation:observation});return;}
    b=closest(t,'[data-drift-open]');if(b){openDriftDrawer();return;}
    b=closest(t,'[data-drift-close]');if(b){closeDriftDrawer();return;}
    b=closest(t,'[data-drift-back]');if(b&&driftDrawer){showDriftList();return;}
    b=closest(t,'[data-drift-file]');if(b){loadDriftFile(b);return;}
    b=closest(t,'[data-drift-retry]');if(b&&driftDrawer){var activeDrift=$('.ds-drift-file.is-active',driftDrawer);if(activeDrift){activeDrift.removeAttribute('data-drift-loaded');loadDriftFile(activeDrift);}return;}
    b=closest(t,'[data-retry-trust]');if(b){loadTrustEvidence();return;}
    b=closest(t,'[data-challenge-check]');if(b){saveChallengeChecks();return;}
    b=closest(t,'[data-goto-comment]');if(b){gotoComment(b.getAttribute('data-goto-comment'));return;}
    b=closest(t,'[data-edit-comment]');if(b){openQueuedCommentEditor(closest(b,'[data-feedback-card]'));return;}
    b=closest(t,'[data-edit-cancel]');if(b){closeQueuedCommentEditor(closest(b,'[data-feedback-card]'));return;}
    b=closest(t,'[data-edit-save]');if(b){saveQueuedComment(closest(b,'[data-feedback-card]'));return;}
    b=closest(t,'[data-remove-comment]');if(b){askRemoveQueuedComment(b.getAttribute('data-remove-comment'),b);return;}
    b=closest(t,'[data-comment-launcher]');if(b){gotoQueuedComment(b.getAttribute('data-queued-comment-id'));return;}
    b=closest(t,'[data-resume-review]');if(b){restoreReviewPosition();return;}
    b=closest(t,'[data-shortcuts-open]');if(b){openCommands();return;}
    b=closest(t,'[data-shortcuts-close]');if(b){closeCommands();return;}
    b=closest(t,'[data-command]');if(b){runCommand(b.getAttribute('data-command'));return;}
    b=closest(t,'[data-story-choice]');if(b){
      var id=b.getAttribute('data-story-choice'),value=b.getAttribute('data-value')||'';
      setStoryChoice(id,value);
      if(id==='storyAgentSel'){fillStoryModels();showStorySkillState();}
      return;
    }
    b=closest(t,'[data-story-scope-action]');if(b){
      var action=b.getAttribute('data-story-scope-action');
      if(action==='all')setStoryFileChecks(function(){return true;});
      else if(action==='none')setStoryFileChecks(function(){return false;});
      else if(action==='tests')setStoryFileChecks(storyPathIsTest);
      else if(action==='config')setStoryFileChecks(storyPathIsConfig);
      else if(action==='source')setStoryFileChecks(function(path){return !storyPathIsTest(path)&&!storyPathIsConfig(path)&&!storyPathIsDoc(path);});
      return;
    }
    b=closest(t,'[data-story-ext]');if(b){
      var ext=b.getAttribute('data-story-ext')||'';
      setStoryFileChecks(function(path){return storyFileExt(path)===ext;});
      return;
    }
    b=closest(t,'input[data-story-file]');if(b){updateStoryScopeCount();return;}
    b=closest(t,'[data-generate-story]');if(b){generateStory(b);return;}
    b=closest(t,'[data-reload-diff]');if(b){b.disabled=true;b.classList.add('is-loading');b.setAttribute('aria-busy','true');b.setAttribute('aria-label','Reloading diff');var reloadLabel=$('[data-reload-label]',b);if(reloadLabel)reloadLabel.textContent='Reloading';requestAnimationFrame(function(){location.reload();});return;}
    b=closest(t,'[data-rail-beat]');if(b){var rbi=parseInt(b.getAttribute('data-rail-step-index')||'-1',10),rbg=parseInt(b.getAttribute('data-focus-group')||'0',10);if(rbi===active)selectStoryFocus(rbi,rbg,true);collapseCompactSidebar();return;}
    b=closest(t,'[data-beat-move]');if(b){var bmp=beatPanel(b);movePanelBeat(bmp,parseInt(b.getAttribute('data-beat-move')||'0',10));return;}
    b=closest(t,'[data-open-full-diff]');if(b){var file=b.getAttribute('data-open-full-diff')||'',item=fileItems.find(function(candidate){return candidate.getAttribute('data-file-path')===file;});setView('files');if(item)selectFile(Number(item.getAttribute('data-file-index')));collapseCompactSidebar();return;}
    b=closest(t,'[data-open-all-files]');if(b){setView('files');collapseCompactSidebar();return;}
    b=closest(t,'[data-story-beat]');if(b){var bp=beatPanel(b);if(bp){var bpi=parseInt(bp.getAttribute('data-step-panel')||'0',10),bpg=parseInt(b.getAttribute('data-focus-group')||'0',10);selectStoryFocus(bpi,bpg,true);}return;}
    b=closest(t,'[data-aloud-stop]');if(b){stopReadAloud();return;}
    b=closest(t,'[data-readaloud]');if(b){toggleReadAloud();return;}
    b=closest(t,'[data-viewed-toggle]');if(b){var viewedPanel=closest(b,'.ds-filepanel');if(viewedPanel)toggleViewed(viewedPanel.getAttribute('data-file'));return;}
    b=closest(t,'.ds-fileitem');if(b){setView('files');selectFile(Number(b.getAttribute('data-file-index')));collapseCompactSidebar();return;}
    b=closest(t,'[data-copy-comments]');if(b){if(b.disabled)return;copyComments();return;}
    b=closest(t,'[data-change-prev]');if(b){jumpRelativeChange(closest(b,'.ds-filepanel')||closest(b,'.ds-diff'),-1);return;}
    b=closest(t,'[data-change-next]');if(b){jumpRelativeChange(closest(b,'.ds-filepanel')||closest(b,'.ds-diff'),1);return;}
    b=closest(t,'[data-expand]');if(b){expandGap(b);return;}
    b=closest(t,'[data-line-wrap-toggle]');if(b){setLineWrap(b.getAttribute('aria-pressed')!=='true',true);return;}
    b=closest(t,'[data-mode]');if(b){var modeHolder=closest(b,'[data-story-diff]');if(modeHolder)modeHolder.setAttribute('data-mode-user-set','1');setMode(b);return;}
    b=closest(t,'[data-exclusions-ack]');if(b){setExclusionsAcknowledged(!!b.checked);return;}
    b=closest(t,'[data-inspect-excluded]');if(b){
      var excludedCard=closest(b,'[data-excluded-file]'),preview=excludedCard&&$('[data-excluded-preview]',excludedCard),excludedFile=b.getAttribute('data-inspect-excluded')||'';if(!preview)return;
      if(preview.getAttribute('data-loaded')==='1'){preview.hidden=!preview.hidden;b.textContent=preview.hidden?'Inspect current file':'Hide preview';return;}
      b.disabled=true;preview.hidden=false;replaceChildrenFromHtml(preview,'<div class="ds-diffnote">Loading excluded file preview…</div>');
      fetch(reviewPageUrl('/api/review/excluded-file?file='+encodeURIComponent(excludedFile))).then(reviewLazyText).then(function(html){replaceChildrenFromHtml(preview,html);preview.setAttribute('data-loaded','1');b.disabled=false;b.textContent='Hide preview';}).catch(function(err){replaceChildrenFromHtml(preview,'<div class="ds-diffnote" role="alert">'+reviewLazyMessage(err,'Could not load this excluded file.')+(err&&err.reloadRequired?' <button type="button" class="ds-btn ds-btn-ghost" data-review-reload>Reload review</button>':'')+'</div>');b.disabled=false;b.textContent=err&&err.reloadRequired?'Reload required':'Try preview again';});return;
    }
    b=closest(t,'[data-callsite-toggle]');if(b){toggleCaller(b);return;}
    b=closest(t,'[data-callsite-return]');if(b){returnToCaller(b);return;}
    b=closest(t,'[data-goto-step]');if(b){closeDriftDrawer();setView('tour');setActive(Number(b.getAttribute('data-goto-step')));collapseCompactSidebar();return;}
    b=closest(t,'[data-goto-file]');if(b){closeDriftDrawer();setView('files');selectFileByPath(b.getAttribute('data-goto-file'));collapseCompactSidebar();return;}
    b=closest(t,'[data-explain]');if(b){repairStory('explain',{file:b.getAttribute('data-story-file'),line:Number(b.getAttribute('data-story-line')||0)});return;}
    b=closest(t,'[data-caller-source]');if(b){fetch(reviewPageUrl('/api/editor/caller'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stepId:b.getAttribute('data-caller-step'),caller:b.getAttribute('data-caller-name')})}).then(function(r){return r.json().then(function(data){if(!r.ok)throw new Error(data.error);toast('Opening caller source…');});}).catch(function(error){toast(error.message||'Could not open caller source.','error');});return;}
    b=closest(t,'[data-story-repair]');if(b){repairStory(b.getAttribute('data-story-repair'),{file:b.getAttribute('data-story-file'),stepId:b.getAttribute('data-story-step')});var det=closest(b,'details');if(det&&!det.hasAttribute('data-story-health'))det.open=false;return;}
    var cpf=closest(t,'[data-concept-page-fullscreen]');if(cpf){toggleConceptPageFullscreen(cpf);return;}
    b=closest(t,'.ds-stepcard');if(b){setActive(Number(b.getAttribute('data-step-index')));collapseCompactSidebar();return;}
  }
  function singleKeysEnabled(){try{return localStorage.getItem('ds-single-keys')!=='off';}catch(e){return true;}}
  function syncShortcutsToggle(){
    var t=$('[data-shortcuts-toggle]');if(!t)return;
    t.checked=singleKeysEnabled();
    t.addEventListener('change',function(){
      try{if(t.checked)localStorage.removeItem('ds-single-keys');else localStorage.setItem('ds-single-keys','off');}catch(e){}
    });
  }
  function onKey(e){
    // Native popover keys belong to source inspection, not story navigation.
    if($('.ds-source-references:popover-open'))return;
    if(e.key==='Escape'&&blameOpen()){e.preventDefault();e.stopPropagation();closeBlame(true);return;}
    if(e.key==='Escape'&&e.target&&closest(e.target,'[data-remove-confirm]')){e.preventDefault();cancelRemoveConfirm(closest(e.target,'[data-remove-confirm]'));return;}
    if(e.key==='Escape'){
      var mermaidFullscreen=document.fullscreenElement&&closest(document.fullscreenElement,'[data-concept-diagram]')||$('.is-mermaid-fullscreen');
      if(mermaidFullscreen){e.preventDefault();setMermaidFullscreen(mermaidFullscreen,false);return;}
      var openTune=$('.ds-story-tune[open],.ds-landing-more[open]');if(openTune){
        e.preventDefault();openTune.open=false;var tuneSummary=$('summary',openTune);if(tuneSummary)tuneSummary.focus();return;
      }
      var inlineComposer=$('.ds-composer');if(inlineComposer){e.preventDefault();removeComposer(inlineComposer,true);return;}
      var escapeModal=topModalRoot();if(escapeModal){
        e.preventDefault();if(escapeModal===commandRoot)closeCommands();else if(escapeModal===driftDrawer)closeDriftDrawer();return;
      }
      closeSelectionMenu();
      if(compactScreen()&&!document.body.classList.contains('ds-rail-collapsed'))closeCompactSidebar(true);
      return;
    }
    var modalRoot=topModalRoot();
    if(singleKeysEnabled()&&!isTextEntryTarget(e.target)&&e.key==='?'){e.preventDefault();openCommands();return;}
    if(modalRoot&&e.key==='Tab'){
      var focusables=modalFocusables(modalRoot);
      if(focusables.length){var first=focusables[0],last=focusables[focusables.length-1],focusInside=modalRoot.contains(document.activeElement);if(!focusInside){e.preventDefault();(e.shiftKey?last:first).focus();return;}if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();return;}if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();return;}}
    }
    if(modalRoot)return;
    if(singleKeysEnabled()&&!isTextEntryTarget(e.target)&&e.key==='/'){
      e.preventDefault();setView('files');var search=$('[data-file-search]');if(search)search.focus();return;
    }
    if(singleKeysEnabled()&&!isTextEntryTarget(e.target)&&(e.key==='b'||e.key==='B')&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
      var blameKeyRow=closest(document.activeElement,'[data-review-row]'),blameKeyTarget=blameRowTarget(blameKeyRow);
      if(blameKeyTarget){e.preventDefault();openBlame(blameKeyTarget,$('.ds-no',blameKeyRow)||blameKeyRow);return;}
    }
    if(singleKeysEnabled()&&!isTextEntryTarget(e.target)&&(e.key==='c'||e.key==='C')){
      var cctx=currentSelectionContext()||focusedRowContext();if(cctx){e.preventDefault();selectionContext=cctx;openComposer(cctx.anchorRow,defaultCommentFlavor(),cctx);return;}
    }
    var storyChoice=closest(e.target,'[data-story-choice]');
    if(storyChoice&&(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='Home'||e.key==='End')){
      var choiceGroup=closest(storyChoice,'[role="radiogroup"]'),choices=choiceGroup?$all('[data-story-choice]',choiceGroup):[];
      if(choices.length){
        var ci=choices.indexOf(storyChoice),nextChoice;
        if(e.key==='Home')nextChoice=choices[0];
        else if(e.key==='End')nextChoice=choices[choices.length-1];
        else nextChoice=choices[(ci+((e.key==='ArrowRight'||e.key==='ArrowDown')?1:-1)+choices.length)%choices.length];
        if(nextChoice){e.preventDefault();nextChoice.focus();nextChoice.click();return;}
      }
    }
    // The review page's own tablist walks the same way the view tabs do — a
    // tablist a keyboard cannot cross is a tablist in name only.
    var reviewTab=closest(e.target,'[data-review-tab-select]');
    if(reviewTab&&(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End')){
      var reviewTabs=$all('[data-review-tab-select]'),rti=reviewTabs.indexOf(reviewTab);
      var nextReviewTab=e.key==='Home'?reviewTabs[0]:e.key==='End'?reviewTabs[reviewTabs.length-1]:reviewTabs[(rti+(e.key==='ArrowRight'?1:-1)+reviewTabs.length)%reviewTabs.length];
      if(nextReviewTab){selectReviewTab(nextReviewTab.getAttribute('data-review-tab-select'),true);e.preventDefault();}
      return;
    }
    var viewTab=closest(e.target,'[data-view]');
    if(viewTab&&(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End')){
      // Wrapping N-way walk: a two-way flip stopped being correct at three tabs.
      var tabs=$all('.ds-tab'),ti=tabs.indexOf(viewTab);
      var nextTab=e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:tabs[(ti+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
      if(nextTab){var nextView=nextTab.getAttribute('data-view');
      setView(nextView,true);
      nextTab.focus();
      e.preventDefault();}return;
    }
    var railHandle=closest(e.target,'[data-sidebar-resizer]');
    if(railHandle&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){
      setSidebarCollapsed(false);
      setSidebarWidth(currentSidebarWidth()+(e.key==='ArrowRight'?16:-16),true);
      e.preventDefault();
      return;
    }
    var focusedRailBeat=closest(e.target,'[data-rail-beat]');
    if(focusedRailBeat&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){
      e.preventDefault();moveRailBeat(focusedRailBeat,e.key==='ArrowRight'?1:-1);return;
    }
    var focusedStoryBeat=closest(e.target,'[data-story-beat]');
    if(focusedStoryBeat&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){
      e.preventDefault();moveStoryBeat(focusedStoryBeat,e.key==='ArrowRight'?1:-1);return;
    }
    var wantsBeatNav=e.key==='ArrowRight'||e.key==='ArrowLeft';
    if(wantsBeatNav&&moveSpeechBeat(e.key==='ArrowRight'?1:-1)){e.preventDefault();return;}
    if(wantsBeatNav&&!isTextEntryTarget(e.target)&&tourView&&!tourView.hidden&&active>0&&movePanelBeat(stepPanels[active],e.key==='ArrowRight'?1:-1)){e.preventDefault();return;}
    if(handleChangeShortcut(e))return;
    var next=e.key==='j',prev=e.key==='k';
    if(next||prev){
      if(!singleKeysEnabled())return;
      if(isTextEntryTarget(e.target))return;
      if(currentView()==='review')return;
      e.preventDefault();
      if(filesView&&!filesView.hidden)selectFile(selectedFile+(next?1:-1));
      else if(tourView&&!tourView.hidden)setActive(mustOnlyStep(active,next?1:-1));
      return;
    }
    if(singleKeysEnabled()&&(e.key==='v'||e.key==='V')&&!isTextEntryTarget(e.target)&&filesView&&!filesView.hidden){
      var vp=filePanels[selectedFile];
      if(vp){toggleViewed(vp.getAttribute('data-file'));e.preventDefault();return;}
    }
    var wantsSpacePause=e.key===' '||e.code==='Space'||e.key==='Spacebar';
    // Space toggles read aloud only once narration has started this page-load
    // (via the transport or the palette command). Before that it keeps its
    // standard job: scrolling the page.
    if(wantsSpacePause&&aloudEverStarted&&!isTextEntryTarget(e.target)&&(isReadAloudShortcutTarget(e.target)||!isKeyboardControlTarget(e.target))){
      // On the button itself, let the browser's own activation do the work —
      // handling it here as well would toggle twice for one press.
      if(isReadAloudShortcutTarget(e.target))return;
      if($('[data-readaloud]')){e.preventDefault();toggleReadAloud();return;}
    }
    if(isTextEntryTarget(e.target)||isKeyboardControlTarget(e.target))return;
  }
  // ---- resizable sidebar ----
  function sidebarDragWidth(e){
    var layout=$('.ds-layout'),left=0;
    if(layout){left=layout.getBoundingClientRect().left;}
    return e.clientX-left;
  }
  function startSidebarResize(e){
    var h=closest(e.target,'[data-sidebar-resizer]');if(!h)return;
    sidebarResizing=true;
    setSidebarCollapsed(false);
    document.body.classList.add('ds-sidebar-resizing');
    e.preventDefault();
  }
  function moveSidebarResize(e){
    if(!sidebarResizing)return;
    sidebarResizeClientX=e.clientX;
    if(!sidebarResizeFrame)sidebarResizeFrame=requestAnimationFrame(function(){
      sidebarResizeFrame=0;
      if(sidebarResizing&&sidebarResizeClientX!=null)setSidebarWidth(sidebarDragWidth({clientX:sidebarResizeClientX}),false);
    });
  }
  function endSidebarResize(e){
    if(!sidebarResizing)return;
    if(e&&typeof e.clientX==='number')sidebarResizeClientX=e.clientX;
    if(sidebarResizeFrame){cancelAnimationFrame(sidebarResizeFrame);sidebarResizeFrame=0;}
    if(sidebarResizeClientX!=null)setSidebarWidth(sidebarDragWidth({clientX:sidebarResizeClientX}),false);
    sidebarResizeClientX=null;
    sidebarResizing=false;
    document.body.classList.remove('ds-sidebar-resizing');
    setSidebarWidth(currentSidebarWidth(),true);
  }
  // ---- resizable diff panes (drag the BEFORE | AFTER divider) ----
  function startSplit(e){
    var div=closest(e.target,'.ds-celldiv');if(!div)return;
    var body=closest(div,'.ds-diffbody');if(!body)return;
    var rect=div.getBoundingClientRect();splitGrabOffset=e.clientX-rect.left-rect.width/2;
    splitBody=body;splitHolder=closest(div,'.ds-filepanel,.ds-diff');splitResizeClientX=null;document.body.classList.add('ds-resizing');e.preventDefault();
  }
  function applySplitResize(clientX){
    if(!splitBody||!splitHolder)return;
    var r=splitBody.getBoundingClientRect();if(!r.width)return;
    var gutter=$('.ds-celldiv',splitBody),width=gutter?gutter.getBoundingClientRect().width:0,available=r.width-width;if(available<=0)return;
    var pct=Math.max(0,Math.min(100,(clientX-splitGrabOffset-r.left-width/2)/available*100));
    splitHolder.style.setProperty('--ds-split',String(pct));
    var divider=$('.ds-celldiv[role="separator"]',splitHolder);if(divider)setSplitDividerValue(divider,pct);
    scheduleFlow();
    scheduleAnnotations(closest(splitHolder,'.ds-step'));
  }
  function moveSplit(e){
    if(!splitBody)return;
    splitResizeClientX=e.clientX;
    if(!splitResizeFrame)splitResizeFrame=requestAnimationFrame(function(){splitResizeFrame=0;if(splitBody&&splitResizeClientX!=null)applySplitResize(splitResizeClientX);});
  }
  function endSplit(e){
    if(!splitBody)return;
    if(e&&typeof e.clientX==='number')splitResizeClientX=e.clientX;
    if(splitResizeFrame){cancelAnimationFrame(splitResizeFrame);splitResizeFrame=0;}
    if(splitResizeClientX!=null)applySplitResize(splitResizeClientX);
    try{localStorage.setItem('ds-split',(splitHolder&&splitHolder.style.getPropertyValue('--ds-split')||'').trim());}catch(err){}
    syncSplitPaneLayout(splitHolder);
    splitResizeClientX=null;splitBody=null;splitHolder=null;document.body.classList.remove('ds-resizing');
  }
  // The sticky file head parks below whatever chrome sits above it, and that
  // chrome's height is real layout, not a constant worth guessing. It lands as a
  // CSS var on the holder so the CSS above stays declarative. (The beat dock used
  // to need the same treatment when it floated over the diff; it stands in the
  // bottom island now, so the scroller has nothing to reserve room for.)
  var stickyObserver=null;
  function measureChrome(holder,sel,prop){
    var kid=holder?$(sel,holder):null;
    var h=kid?kid.getBoundingClientRect().height:0;
    if(h)holder.style.setProperty(prop,h+'px');else if(holder)holder.style.removeProperty(prop);
  }
  // The card toolbar must span exactly the scroller's visible inner width: a
  // fixed scrollbar deduction is wrong the moment the diff is short enough to
  // need no scrollbar, and container units disagree across browsers about
  // whether they include one. So measure it.
  function measureViewport(scroller){
    var cs=getComputedStyle(scroller);
    var w=scroller.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0);
    if(w>0)scroller.style.setProperty('--ds-diffviewport-w',w+'px');else scroller.style.removeProperty('--ds-diffviewport-w');
  }
  function updateStickyMetrics(){
    $all('.ds-diffscroll').forEach(measureViewport);
    $all('.ds-diff').forEach(function(card){measureChrome(card,'.ds-difftoolbar','--ds-stickytop');});
    $all('.ds-filepanel').forEach(function(panel){measureChrome(panel,'.ds-filepanel-head','--ds-stickytop');});
  }
  function watchStickyMetrics(){
    updateStickyMetrics();
    if(typeof ResizeObserver!=='function')return;
    // Observe only — the callback never re-observes, or each measurement would
    // schedule the next one and the loop would never settle.
    if(!stickyObserver)stickyObserver=new ResizeObserver(updateStickyMetrics);
    stickyObserver.disconnect();
    // The scroller's content box shrinks when a vertical scrollbar appears, so
    // observing it re-measures the toolbar width at exactly the right moment.
    $all('.ds-difftoolbar,.ds-filepanel-head,.ds-diffscroll').forEach(function(el){stickyObserver.observe(el);});
  }
  function init(){
    tourView=$('#ds-view-tour');filesView=$('#ds-view-files');reviewView=$('#ds-view-review');driftDrawer=$('#ds-drift-drawer');commandRoot=$('[data-command-root]');toastEl=$('#ds-toast');selectionMenu=$('[data-selection-menu]');filmThread=$('[data-filmthread]');filmTooltip=$('[data-filmthread-tooltip]');
    stepPanels=$all('.ds-step');stepCards=$all('.ds-stepcard');total=stepPanels.length||1;
    adoptStepDocks();
    filePanels=$all('.ds-filepanel');fileItems=$all('.ds-fileitem');
    if(document.body.getAttribute('data-storyless')||document.body.getAttribute('data-initial-view')==='files')setView('files');
    document.addEventListener('click',onClick);
    document.addEventListener('contextmenu',openSelectionMenu);
    document.addEventListener('keydown',onKey);
    document.addEventListener('keydown',callerDividerKey,true);
    document.addEventListener('pointerdown',startCallerResize);
    window.addEventListener('resize',function(){$all('.ds-callsite-scroll').forEach(function(scroll){scroll._dsCallsiteCentered=false;syncCallerWindow(closest(scroll,'.ds-step'));});});
    document.addEventListener('wheel',onSplitPaneWheel,{passive:false});
    window.addEventListener('message',onConceptFrameMessage);
    // A dirty composer holds an unqueued draft; stash it and warn before the
    // tab goes away so a reload restores the text on reopen.
    window.addEventListener('beforeunload',function(e){var box=dirtyComposer();if(!box)return;stashComposerDraft(box);e.preventDefault();e.returnValue='';});
    new MutationObserver(syncConceptPageTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    document.addEventListener('fullscreenchange',syncMermaidFullscreen);
    document.addEventListener('fullscreenchange',syncConceptPageFullscreen);
    document.addEventListener('pointerover',onFilmPointerOver);
    document.addEventListener('pointerout',onFilmPointerOut);
    document.addEventListener('focusin',onFilmFocusIn);
    document.addEventListener('focusout',onFilmFocusOut);
    if(filmThread){filmThread.addEventListener('pointermove',onFilmPointerMove);filmThread.addEventListener('pointerleave',onFilmPointerLeave);}
    watchFilmProgress();
    document.addEventListener('mousedown',trackSelectionSide);
    document.addEventListener('mouseup',releaseSelectionSide);
    document.addEventListener('selectionchange',clearCollapsedSelection);
    document.addEventListener('scroll',saveReviewPositionSoon,true);
    // The popover is anchored to a row that scrolling carries away.
    document.addEventListener('scroll',function(e){if(blameOpen()&&!closest(e.target,'.ds-blame-pop'))closeBlame(false);},true);
    document.addEventListener('mousedown',startSidebarResize);
    document.addEventListener('mousemove',moveSidebarResize);
    document.addEventListener('mouseup',endSidebarResize);
    document.addEventListener('mousedown',startSplit);
    document.addEventListener('mousemove',moveSplit);
    document.addEventListener('mouseup',endSplit);
    var liveReload=$('[data-live-reload]');if(liveReload)liveReload.addEventListener('click',function(){location.reload();});
    var liveDismiss=$('[data-live-dismiss]');if(liveDismiss)liveDismiss.addEventListener('click',function(){var kind=livePriority();if(kind){liveDismissed[kind]=liveGenerations[kind];renderLiveBanner();}});
    var storyReloadCancel=$('[data-story-reload-cancel]');if(storyReloadCancel)storyReloadCancel.addEventListener('click',cancelStoryReload);
    var storyReloadToast=$('[data-story-reload-toast]');if(storyReloadToast){
      storyReloadToast.addEventListener('mouseenter',function(){storyReloadHovered=true;pauseStoryReload();});
      storyReloadToast.addEventListener('mouseleave',function(){storyReloadHovered=false;resumeStoryReload();});
      storyReloadToast.addEventListener('focusin',pauseStoryReload);
      storyReloadToast.addEventListener('focusout',function(){queueMicrotask(resumeStoryReload);});
    }
    window.addEventListener('resize',function(){if(compactScreen()&&currentView()!=='files')setSidebarCollapsed(true,false);setSidebarWidth(currentSidebarWidth(),false);syncSidebarOverlay(document.body.classList.contains('ds-rail-collapsed'));applyResponsiveStoryMode(stepPanels&&stepPanels[active]);syncDriftLayout();$all('.ds-filepanel,.ds-diff').forEach(updateChangeNav);syncSplitPaneLayouts();updateStickyMetrics();syncFilmProgress();syncActiveAnnotations();scheduleConceptTypographyFit(stepPanels&&stepPanels[active]);if(filmTooltipTarget)showFilmTooltip(filmTooltipTarget);});
    try{var rw=parseFloat(localStorage.getItem('ds-sidebar-width')||'');if(rw)setSidebarWidth(rw,false);else updateSidebarHandle(currentSidebarWidth());}catch(e){updateSidebarHandle(currentSidebarWidth());}
    try{var sv=localStorage.getItem('ds-split');if(sv)$all('.ds-filepanel,.ds-diff').forEach(function(holder){holder.style.setProperty('--ds-split',sv);});}catch(e){}
    loadLineWrap();
    try{
      var storedCollapsed=localStorage.getItem('ds-sidebar-collapsed');
      // A desktop preference must not cover the review on a narrow screen.
      setSidebarCollapsed(compactScreen()||storedCollapsed==='1',false);
    }catch(e){setSidebarCollapsed(compactScreen(),false);}
    initStoryGenerator();
    $all('.ds-filepanel,.ds-diff').forEach(updateChangeNav);
    watchStickyMetrics();
    syncFeedbackCards();
    refreshCount();
    scheduleCoverageResolve();
    loadViewed();invalidateChangedViewed();syncViewed();applyFileFilters();syncExclusionAcknowledgement();loadChallengeChecks();
    var fileSearch=$('[data-file-search]');if(fileSearch)fileSearch.addEventListener('input',searchFilesLazily);
    reviewPositionReady=true;restoreReviewPosition();mirrorReviewPositionToUrl();syncShortcutsToggle();wireThreadRoving();syncThreadRoving(active);
    revealResumeReview();
    refreshComments();
    startLiveEvents();
    // Reloading or closing the tab must not leave the speech engine reading to a page that
    // no longer exists. The fresh page starts idle, so it hides the stop button
    // and every control refers to a job it has never heard of — there was no way
    // left in codeStory to silence a voice the reviewer could still hear.
    window.addEventListener('pagehide',function(){
      if(aloudIntent==='off'&&!aloudActive&&!aloudJobId&&!speechLoadingLabel)return;
      try{
        var body=new Blob([JSON.stringify({action:'stop'})],{type:'application/json'});
        if(navigator.sendBeacon)navigator.sendBeacon('/api/aloud/control',body);
      }catch(e){}
    });
    var rab=$('[data-readaloud]');
    if(rab)updateReadAloudButton();
    prepareStepNarration(active===0?1:active);
  }

  init();
}
