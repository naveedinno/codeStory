// THROWAWAY: compare spatial, hierarchical, and focused navigation on the real review screen.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { ReviewPayload } from '../../../src/payloads';

type ContentBlock =
  | { type: 'text'; panelIndex: number; beat: number }
  | { type: 'diagram'; title: string; labels: string[] }
  | { type: 'code'; viewerId: string; file: string; revision: string; rangesByBeat: [number, number][][] }
  | { type: 'diff'; viewerId: string; file: string; base: string; head: string; rangesByBeat: [number, number][][] };
interface Topic { id: string; stepId: string; panelIndex: number; label: string; symbol: string; beat: number; children: string[]; beats: number; content: ContentBlock[] }
interface MapData { nodes: Topic[]; commit: string; title: string; path: string[] }
type Variant = 'A' | 'B' | 'C';
const variants: Record<Variant, string> = { A: 'Content map', B: 'Reading tree', C: 'Focused cards' };
const readVariant = (): Variant => { const v = new URL(location.href).searchParams.get('variant'); return v === 'B' || v === 'C' ? v : 'A'; };
const payload: ReviewPayload = JSON.parse(document.querySelector('#__CODESTORY_DATA__')!.textContent!);
const waitFor = (condition: () => boolean) => new Promise<void>(resolve => {
  if (condition()) { resolve(); return; }
  const observer = new MutationObserver(() => { if (condition()) { observer.disconnect(); resolve(); } });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
});

function revealInMap(element: HTMLElement | null) {
  const map = element?.closest<HTMLElement>('.sm-map');
  if (!element || !map) return;
  const target = element.getBoundingClientRect(), box = map.getBoundingClientRect();
  const top = box.top + (map.querySelector('.sm-map-tools')?.getBoundingClientRect().height ?? 0);
  if (target.top < top || target.height > box.bottom - top) map.scrollTop += target.top - top;
  else if (target.bottom > box.bottom) map.scrollTop += target.bottom - box.bottom;
  if (target.left < box.left) map.scrollLeft += target.left - box.left;
  else if (target.right > box.right) map.scrollLeft += target.right - box.right;
}

let selectionVersion = 0;
async function selectSource(topic: Topic) {
  const version = ++selectionVersion;
  document.querySelector<HTMLButtonElement>(`[data-thread-node="${topic.panelIndex}"]`)?.click();
  await waitFor(() => version !== selectionVersion || !!document.querySelector(`[data-step-panel="${topic.panelIndex}"]:not([data-step-lazy]):not([hidden])`));
  if (version !== selectionVersion) return;
  const beat = document.querySelector<HTMLButtonElement>(`[data-dock-step="${topic.panelIndex}"] [data-story-beat][data-focus-group="${topic.beat}"]`);
  beat?.click();
}

type ViewerBlock = Extract<ContentBlock, { type: 'code' | 'diff' }>;
const viewerHtml = new Map<string, Promise<string>>();
type ViewerHost = { element: HTMLDivElement; modal: boolean; refresh: (extra?: Record<string, unknown>) => void };
type LiveViewer = { panel?: HTMLElement; initialized: boolean; hosts: Set<ViewerHost>; restoring: boolean; scrolls: { element: HTMLElement; top: number; left: number; appliedTop: number; appliedLeft: number; anchor: string }[] };
const liveViewers = new Map<string, LiveViewer>();
function rememberViewerScroll(viewer: LiveViewer) {
  if (viewer.restoring || !viewer.panel?.getClientRects().length) return;
  viewer.scrolls = [...viewer.panel.querySelectorAll<HTMLElement>('.ds-diffscroll,.ds-callsite-scroll,[data-split-pane-scroll]')]
    .filter(element => element.getClientRects().length).map(element => {
      const previous = viewer.scrolls.find(saved => saved.element === element), top = element.scrollTop, left = element.scrollLeft;
      // A larger viewport can clamp an unchanged position. Keep the requested
      // coordinate until the reader actually scrolls that axis again.
      return { element, top: previous && Math.abs(top - previous.appliedTop) < 1 ? previous.top : top,
        left: previous && Math.abs(left - previous.appliedLeft) < 1 ? previous.left : left,
        appliedTop: top, appliedLeft: left, anchor: element.style.overflowAnchor };
    });
}
function restoreViewerScroll(viewer: LiveViewer, settled = false) {
  if (!viewer.restoring || !viewer.panel?.getClientRects().length) return;
  for (const saved of viewer.scrolls) { saved.element.scrollTop = saved.top; saved.element.scrollLeft = saved.left; saved.appliedTop = saved.element.scrollTop; saved.appliedLeft = saved.element.scrollLeft; }
  if (settled) { for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = saved.anchor; viewer.restoring = false; }
}
function settleViewerScroll(viewer: LiveViewer) {
  // Reparenting and a wider toolbar can reset offsets or trigger scroll anchoring.
  // Restore after layout, then return anchoring to its original native setting.
  requestAnimationFrame(() => { restoreViewerScroll(viewer); requestAnimationFrame(() => restoreViewerScroll(viewer, true)); });
}
function placeViewer(viewer: LiveViewer) {
  const owner = [...viewer.hosts].find(host => host.modal) ?? [...viewer.hosts][0];
  if (!owner || !viewer.panel) return;
  if (viewer.panel.parentElement !== owner.element) {
    rememberViewerScroll(viewer); viewer.restoring = true;
    for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = 'none';
    owner.element.replaceChildren(viewer.panel);
  }
  owner.refresh({ initialize: !viewer.initialized, attach: true, reflow: !viewer.initialized });
  viewer.initialized = true;
  settleViewerScroll(viewer);
}
function NativeViewer({ block, beat, current, full }: { block: ViewerBlock; beat: number; current: boolean; full: boolean }) {
  const host = useRef<HTMLDivElement>(null), id = useId(), positioned = useRef(false);
  const position = useRef({ beat, current }); position.current = { beat, current };
  useLayoutEffect(() => {
    const element = host.current!; let cancelled = false, frame = 0;
    if (!liveViewers.has(block.viewerId)) liveViewers.set(block.viewerId, { initialized: false, hosts: new Set(), restoring: false, scrolls: [] });
    const viewer = liveViewers.get(block.viewerId)!;
    const refresh = (extra: Record<string, unknown> = {}) => {
      if (!viewer.panel || viewer.panel.parentElement !== element) return;
      const state = position.current;
      element.dispatchEvent(new CustomEvent('codestory:map-viewer', { bubbles: true, detail: {
        beat: state.beat, ranges: block.rangesByBeat[state.beat] ?? [], ...extra,
      } }));
    };
    const registration = { element, modal: !!element.closest('dialog'), refresh }; viewer.hosts.add(registration);
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => refresh()); };
    const observer = new MutationObserver(records => { if (records.some(record => (record.target as HTMLElement).matches('[data-mode],[data-full-inner],[data-diff-inner],[data-split-inner],[data-line-wrap-toggle],.ds-callsite-pane,[data-callsite-toggle]'))) schedule(); });
    let width = 0;
    const resize = new ResizeObserver(entries => { const next = Math.round(entries[0].contentRect.width); if (next !== width) { width = next; refresh(); settleViewerScroll(viewer); } });
    if (!viewerHtml.has(block.viewerId)) viewerHtml.set(block.viewerId, fetch('/_prototype/viewer?id=' + encodeURIComponent(block.viewerId)).then(response => response.text()));
    void viewerHtml.get(block.viewerId)!.then(markup => {
      if (cancelled) return;
      if (!viewer.panel) {
        // The ordinary escaped server fragment becomes one live viewer. Focus
        // reparents this element, preserving all native inspection state.
        const template = document.createElement('template'); template.innerHTML = markup;
        const panel = template.content.firstElementChild as HTMLElement;
        panel.classList.remove('ds-step'); panel.classList.add('sm-native-step'); panel.removeAttribute('hidden'); panel.removeAttribute('data-step-panel');
        panel.querySelectorAll('[data-beat-dock],template[data-step-landing]').forEach(node => node.remove());
        panel.querySelectorAll<HTMLElement>('.ds-diffscroll').forEach(node => { node.tabIndex = 0; node.setAttribute('role', 'region'); node.setAttribute('aria-label', `${block.type === 'diff' ? 'Code diff' : 'Code'} viewport: ${block.file}`); });
        const ids = new Map<string, string>();
        panel.querySelectorAll<HTMLElement>('[id]').forEach(node => { ids.set(node.id, 'sm-' + id + '-' + node.id); node.id = ids.get(node.id)!; });
        panel.querySelectorAll<HTMLElement>('[aria-controls],[aria-labelledby],[popovertarget]').forEach(node => {
          for (const attr of ['aria-controls', 'aria-labelledby', 'popovertarget']) if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr)!.split(' ').map(value => ids.get(value) ?? value).join(' '));
        });
        if (block.type === 'diff') panel.querySelectorAll<HTMLElement>('[data-open-full-diff]').forEach(node => { node.removeAttribute('data-open-full-diff'); node.setAttribute('data-map-open-full', ''); node.setAttribute('aria-label', 'Read the complete file at this historical change'); node.title = 'Read the complete file at this historical change'; });
        viewer.panel = panel;
      }
      placeViewer(viewer);
      observer.observe(element, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-pressed', 'aria-busy'] });
      resize.observe(element);
    });
    const update = (event: Event) => refresh((event as CustomEvent).detail);
    const scrolled = () => { if (viewer.panel?.parentElement === element) rememberViewerScroll(viewer); };
    element.addEventListener('scroll', scrolled, true);
    element.addEventListener('codestory:map-position', update);
    return () => { rememberViewerScroll(viewer); cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); element.removeEventListener('scroll', scrolled, true); element.removeEventListener('codestory:map-position', update); viewer.hosts.delete(registration); placeViewer(viewer); };
  }, [block.viewerId]);
  useEffect(() => { host.current?.dispatchEvent(new CustomEvent('codestory:map-position', { detail: { center: current && (positioned.current || !full) } })); positioned.current = true; }, [beat, current]);
  return <div className="sm-viewer-block"><div className="sm-viewer-revision">{block.type === 'code' ? `Code at ${block.revision.slice(0, 7)}` : `Historical change · ${block.base.slice(0, 7)} → ${block.head.slice(0, 7)}`}</div>
    <div ref={host} data-map-native-viewer={block.viewerId} className="sm-native-viewer" onClick={event => {
      if ((event.target as HTMLElement).closest('[data-map-open-full]')) { event.stopPropagation(); host.current?.querySelector<HTMLButtonElement>('[data-mode="full"]')?.click(); }
      const caller = (event.target as HTMLElement).closest('[data-callsite-return]');
      if (caller) window.dispatchEvent(new CustomEvent('codestory:map-return', { detail: Number(caller.getAttribute('data-callsite-return')) }));
    }} onKeyDown={event => {
      if (!(event.target as HTMLElement).closest('button,a,input,textarea,select,[role="separator"]')) event.stopPropagation();
    }}><div className="ds-step-loading" role="status">Loading CodeStory viewer…</div></div>
  </div>;
}

function Prototype({ data }: { data: MapData }) {
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const get = (id: string) => byId.get(id)!;
  const parent = (id: string) => data.nodes.find(node => node.children.includes(id));
  const ancestors = (id: string): Topic[] => { const p = parent(id); return p ? [...ancestors(p.id), p] : []; };
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [selected, setSelected] = useState('root');
  const selectedRef = useRef('root');
  const [sourcePosition, setSourcePosition] = useState({ panelIndex: get('root').panelIndex, beat: 0 });
  const [expanded, setExpanded] = useState(new Set(['root']));
  const [detail, setDetail] = useState(true);
  const [visited, setVisited] = useState(new Set(['root']));
  const [focused, setFocused] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [transport, setTransport] = useState({ label: 'Play', accessibleLabel: 'Play narration', disabled: false, canStop: false });
  const [reading, setReading] = useState('Gateway');
  const [outside, setOutside] = useState('');
  const node = get(selected), path = [...ancestors(selected), node];
  const readingPlan = (topic: Topic) => {
    const collect = (n: Topic): number[] => [n.panelIndex, ...n.children.flatMap(id => collect(get(id)))];
    const indexes = topic.id === 'root' ? data.path.map(id => get(id).panelIndex) : collect(topic);
    document.body.dataset.prototypeReadingPath = [...new Set(indexes)].join(',');
    setReading(topic.id === 'root' ? 'Gateway' : topic.label);
  };
  const choose = (topic: Topic) => {
    document.querySelector<HTMLButtonElement>('[data-aloud-stop]:not([hidden])')?.click();
    const owner = parent(topic.id);
    readingPlan(owner?.stepId === topic.stepId ? owner : topic);
    selectedRef.current = topic.id; setSelected(topic.id); setOutside(''); setVisited(old => new Set([...old, topic.id]));
    setSourcePosition({ panelIndex: topic.panelIndex, beat: topic.beat });
    setExpanded(old => new Set([...old, ...ancestors(topic.id).map(item => item.id)]));
    void selectSource(topic);
  };
  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    setExpanded(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
    if (opening && variant === 'A') requestAnimationFrame(() => revealInMap(document.getElementById(`sm-branch-${id}`)));
  };
  const cycle = (delta: number) => {
    const keys: Variant[] = ['A', 'B', 'C'];
    const next = keys[(keys.indexOf(variant) + delta + 3) % 3];
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url);
    setVariant(next);
  };
  const scope = (requested: Topic) => {
    const owner = parent(requested.id);
    choose(owner?.stepId === requested.stepId ? owner : requested);
  };

  useEffect(() => {
    document.body.dataset.mapVariant = variant;
  }, [variant]);
  useEffect(() => {
    setFocused(current => {
      if (!current) return current;
      const topic = get(selected), shown = get(current), owner = parent(topic.id);
      if (shown.panelIndex === topic.panelIndex && (!document.querySelector('[data-readaloud][aria-pressed="true"]') || parent(shown.id)?.stepId !== shown.stepId)) return current;
      return owner?.stepId === topic.stepId ? owner.id : topic.id;
    });
  }, [selected]);
  useEffect(() => {
    requestAnimationFrame(() => {
      revealInMap(document.querySelector<HTMLElement>(`.sm-map [data-map-node="${selected}"]`));
    });
  }, [selected, sourcePosition.beat, variant, detail, focused]);
  useEffect(() => {
    if (focused && !dialog.current?.open) dialog.current?.showModal();
    else if (!focused && dialog.current?.open) dialog.current.close();
    if (focused && dialog.current) dialog.current.scrollTop = 0;
  }, [focused]);
  useEffect(() => {
    const primary = document.querySelector<HTMLButtonElement>('[data-readaloud]');
    const stop = document.querySelector<HTMLButtonElement>('[data-aloud-stop]');
    if (!primary || !stop) return;
    const sync = () => setTransport({ label: primary.querySelector('[data-readaloud-label]')?.textContent?.trim() || 'Play',
      accessibleLabel: primary.getAttribute('aria-label') || 'Play narration', disabled: primary.disabled, canStop: !stop.hidden });
    const observer = new MutationObserver(sync);
    observer.observe(primary, { attributes: true, childList: true, characterData: true, subtree: true });
    observer.observe(stop, { attributes: true, attributeFilter: ['hidden'] });
    sync(); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    document.body.dataset.prototypeReadingPath = data.path.map(id => get(id).panelIndex).join(',');
    void selectSource(get('root'));
    const returned = (event: Event) => {
      const topic = data.nodes.find(item => item.panelIndex === (event as CustomEvent<number>).detail);
      if (topic) { choose(topic); requestAnimationFrame(() => { const code = document.querySelector<HTMLDetailsElement>(`.sm-map [data-map-node="${topic.id}"] .sm-native-disclosure`); if (code) code.open = true; }); }
    };
    window.addEventListener('codestory:map-return', returned);
    return () => window.removeEventListener('codestory:map-return', returned);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target !== document.body && !target.closest('.sm-switcher')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopImmediatePropagation(); cycle(event.key === 'ArrowRight' ? 1 : -1); }
    };
    window.addEventListener('keydown', key, true);
    const pop = () => setVariant(readVariant()); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('popstate', pop); };
  }, [variant]);
  useEffect(() => {
    const view = document.querySelector('#ds-view-tour')!;
    const observer = new MutationObserver(() => {
      const active = view.querySelector<HTMLElement>('.ds-step:not([hidden])');
      const panel = Number(active?.dataset.stepPanel);
      const beat = Number(document.querySelector(`[data-dock-step="${panel}"] [data-story-beat].is-selected`)?.getAttribute('data-focus-group') ?? 0);
      setSourcePosition(old => old.panelIndex === panel && old.beat === beat ? old : { panelIndex: panel, beat });
      const matches = data.nodes.filter(topic => topic.panelIndex === panel);
      if (!matches.length) { if (panel) setOutside(payload.steps[panel - 1]?.title.text ?? 'Another part of the story'); return; }
      setOutside('');
      const requested = get(selectedRef.current);
      const exact = requested.panelIndex === panel && requested.beat === beat ? requested : matches.find(topic => !topic.children.length && topic.beat === beat) ?? matches[0];
      selectedRef.current = exact.id;
      setSelected(exact.id); setVisited(old => old.has(exact.id) ? old : new Set([...old, exact.id]));
      setExpanded(old => { const ids = ancestors(exact.id).map(item => item.id); return ids.every(id => old.has(id)) ? old : new Set([...old, ...ids]); });
    });
    observer.observe(view, { attributes: true, subtree: true, attributeFilter: ['hidden', 'aria-pressed'] });
    return () => observer.disconnect();
  }, []);

  const kindOf = (topic: Topic) => topic.content.some(block => block.type === 'diff') ? 'Code diff' : topic.content.some(block => block.type === 'code') ? 'Code' : topic.content.some(block => block.type === 'diagram') ? 'Story + diagram' : 'Story';
  const openCard = (topic: Topic) => { if (get(selectedRef.current).stepId !== topic.stepId) choose(topic); setFocused(topic.id); };
  function Content({ topic, full = false }: { topic: Topic; full?: boolean }) {
    const currentBeat = sourcePosition.panelIndex === topic.panelIndex && parent(topic.id)?.stepId !== topic.stepId ? sourcePosition.beat : topic.beat;
    return <div className={`sm-card-content ${full ? 'is-full' : ''}`}>{topic.content.map((block, index) => {
      if (block.type === 'text') return <p className="sm-prose" key={index}>{payload.steps[block.panelIndex - 1]?.beats[currentBeat]?.text.text}</p>;
      if (block.type === 'diagram') return <figure className="sm-diagram" key={index}><figcaption>{block.title}</figcaption>
        <ol aria-label={block.title}>{block.labels.map((label, i) => <li key={label}><span>{String(i + 1).padStart(2, '0')}</span>{label}</li>)}</ol></figure>;
      if (block.viewerId === 'source-root') return <details key={block.viewerId} className="sm-native-disclosure" open={full}><summary>Read _executeCall() code</summary><NativeViewer block={block} beat={currentBeat} current={sourcePosition.panelIndex === topic.panelIndex} full={full} /></details>;
      return <NativeViewer key={block.viewerId} block={block} beat={currentBeat} current={sourcePosition.panelIndex === topic.panelIndex} full={full} />;
    })}</div>;
  }
  function Node({ topic, compact = false, disclosure = true, full = false, summaryOnly = false }: { topic: Topic; compact?: boolean; disclosure?: boolean; full?: boolean; summaryOnly?: boolean }) {
    const active = selected === topic.id;
    return <article className={`sm-node ${active ? 'is-current' : ''} ${compact ? 'is-small' : ''}`} aria-label={topic.label} data-map-node={full ? undefined : topic.id} data-card-kind={kindOf(topic)}>
      <header className="sm-card-head"><div><span className="sm-card-type">{kindOf(topic)}</span>
        {full ? <h3>{topic.label}</h3> : <button type="button" className="sm-select" aria-current={active ? 'location' : undefined} aria-label={`Read ${topic.label}`} onClick={() => choose(topic)}><strong>{topic.label}</strong></button>}
        <code className="sm-symbol">{topic.symbol}</code></div>
        {disclosure && !!topic.children.length && <button type="button" className="sm-expand" aria-label={`${expanded.has(topic.id) ? 'Collapse' : 'Expand'} ${topic.label}`} aria-expanded={expanded.has(topic.id)} onClick={() => toggle(topic.id)}>{expanded.has(topic.id) ? '−' : '+'}</button>}
      </header>
      {!summaryOnly && (!compact || active) && Content({ topic, full })}
      {!full && !summaryOnly && <footer className="sm-card-actions"><span>{visited.has(topic.id) ? '✓ Visited' : 'Not visited'}</span><button type="button" onClick={() => openCard(topic)} aria-label={`Focus ${topic.label}`}>Focus card ↗</button></footer>}
    </article>;
  }

  function VariantA() {
    const world = (id: string): React.ReactNode => {
      const topic = get(id), open = expanded.has(id) && !!topic.children.length;
      return <div className={`sm-world-row ${open ? 'has-children' : ''}`} key={id}>
        <div className={`sm-world-card ${detail ? 'is-reading' : ''}`}>{Node({ topic, compact: !detail })}</div>
        {open && <div className="sm-world-children" id={`sm-branch-${id}`}>{topic.children.map(world)}</div>}
      </div>;
    };
    return <>
      <div className="sm-map-tools" role="group" aria-label="Map detail level">
        <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>Overview</button>
        <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>Detail</button>
        <button type="button" onClick={() => { setExpanded(old => new Set([...old, ...ancestors(selected).map(item => item.id)])); requestAnimationFrame(() => revealInMap(document.querySelector<HTMLElement>(`.sm-world [data-map-node="${selected}"]`))); }}>Find current</button>
      </div>
      <div className="sm-world">{world('root')}</div>
    </>;
  }
  function Tree({ id }: { id: string }) {
    const n = get(id);
    return <li key={id}>{Node({ topic: n })}{expanded.has(id) && !!n.children.length && <ul>{n.children.map(child => Tree({ id: child }))}</ul>}</li>;
  }
  function VariantB() { return <div className="sm-tree"><ul>{Tree({ id: 'root' })}</ul></div>; }
  function VariantC() {
    const owner = parent(node.id);
    const branch = owner?.stepId === node.stepId ? owner : node;
    return <div className="sm-columns">
      <div className="sm-chapter-column"><button type="button" className="sm-root-link" onClick={() => choose(get('root'))}>← The whole call</button>
        <div className="sm-section-label">Story branches</div>{get('root').children.map(id => <div key={id}>{Node({ topic: get(id), disclosure: false, summaryOnly: true })}</div>)}</div>
      <div className="sm-detail-column">{Node({ topic: node, full: true, disclosure: false })}
        {branch.id !== 'root' && !!branch.children.length && <nav className="sm-child-list" aria-label={`Explore ${branch.label}`}><div className="sm-section-label">Go deeper</div>
          {branch.children.map(id => <div key={id}>{Node({ topic: get(id), disclosure: false, summaryOnly: true })}</div>)}</nav>}
      </div>
    </div>;
  }

  return <>
    {createPortal(<dialog ref={dialog} className="sm-focus-dialog" aria-labelledby="sm-focus-title" onCancel={event => { event.preventDefault(); setFocused(null); }} onKeyDown={event => event.stopPropagation()}><div className="sm-focus-head"><h2 id="sm-focus-title">{focused ? get(focused).label : 'Read card'}</h2><div className="sm-focus-actions">
      <button type="button" disabled={transport.disabled} aria-label={transport.accessibleLabel} onClick={() => document.querySelector<HTMLButtonElement>('[data-readaloud]')?.click()}>{transport.label}</button>
      {transport.canStop && <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('[data-aloud-stop]')?.click()}>Stop narration</button>}
      <button type="button" autoFocus onClick={() => setFocused(null)}>Close card</button></div></div>{focused && Node({ topic: get(focused), full: true, disclosure: false })}</dialog>, document.body)}
    <header className="sm-head"><div><span className="sm-kicker">Explore the story</span><h2>Gateway</h2></div>
      <button type="button" className="sm-focus" onClick={() => openCard(node)}>Focus current card</button></header>
    <>
      <nav className="sm-breadcrumbs" aria-label="Map location">{path.map((item, index) => <span key={item.id}>{index > 0 && <span aria-hidden="true">/</span>}<button type="button" onClick={() => choose(item)} aria-current={item.id === selected ? 'location' : undefined}>{item.id === 'root' ? '_executeCall()' : item.label}</button></span>)}</nav>
      <nav className="sm-map" aria-label="Gateway story map">{variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}</nav>
      {outside && <div className="sm-outside">Reading elsewhere in the story.<button type="button" onClick={() => choose(node)}>Return to this branch</button></div>}
      <footer className="sm-map-footer"><div><span className="sm-kicker">Guided reading</span><span>{outside ? 'Current source' : reading}</span></div>
        <button type="button" onClick={() => scope(node)}>{selected === 'root' ? 'Follow gateway' : 'Follow this branch'} <span aria-hidden="true">→</span></button>
        <p>{outside ? 'Return to the map to follow a branch.' : 'Play follows this path. Choose any node to explore.'}</p>
      </footer>
    </>
    <span className="ds-sr-only" role="status">{outside || `Reading ${node.label}. ${visited.size} topics visited.`}</span>
    {createPortal(<div className="sm-switcher" role="group" aria-label="Prototype layout"><span>Design prototype</span>
      <button type="button" aria-label="Previous layout" onClick={() => cycle(-1)}>←</button><strong>{variant} <span>— {variants[variant]}</span></strong>
      <button type="button" aria-label="Next layout" onClick={() => cycle(1)}>→</button><small>{['A', 'B', 'C'].indexOf(variant) + 1} / 3</small></div>, document.body)}
  </>;
}

async function boot() {
  await waitFor(() => !!document.querySelector('.ds-filmthread'));
  const data: MapData = await (await fetch('/_prototype/map.json')).json();
  const host = document.createElement('aside'); host.className = 'sm-prototype'; host.setAttribute('aria-label', 'Story map');
  document.querySelector('#ds-view-tour')!.prepend(host);
  document.body.classList.add('sm-prototyping');
  createRoot(host).render(<Prototype data={data} />);
}
void boot();
