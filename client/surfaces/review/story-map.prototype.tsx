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
type NavigationIntent = { keyboard?: boolean; focus?: boolean };
const variants: Record<Variant, string> = { A: 'Content map', B: 'Reading tree', C: 'Focused cards' };
const readVariant = (): Variant => { const v = new URL(location.href).searchParams.get('variant'); return v === 'B' || v === 'C' ? v : 'A'; };
const payload: ReviewPayload = JSON.parse(document.querySelector('#__CODESTORY_DATA__')!.textContent!);
const waitFor = (condition: () => boolean) => new Promise<void>(resolve => {
  if (condition()) { resolve(); return; }
  const observer = new MutationObserver(() => { if (condition()) { observer.disconnect(); resolve(); } });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
});

// Only the outer map moves. Native code, caller and diff scrollers keep ownership.
const mapFrames = new WeakMap<HTMLElement, number>();
function cancelMapMotion(map: HTMLElement | null) {
  if (!map) return;
  cancelAnimationFrame(mapFrames.get(map) ?? 0); mapFrames.delete(map);
}
function cameraEase(progress: number) {
  // A short ease-out for intentional pointer framing; keyboard paths are instant.
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) { const mid = (low + high) / 2; if (curve(mid, .23, .32) < progress) low = mid; else high = mid; }
  return curve((low + high) / 2, 1, 1);
}
function revealInMap(element: HTMLElement | null, center = false, animate = true, headerOnly = false) {
  const map = element?.closest<HTMLElement>('.sm-map');
  if (!element || !map) return;
  cancelMapMotion(map);
  const heading = element.querySelector('.sm-card-head') ?? element;
  const head = heading.getBoundingClientRect(), card = element.getBoundingClientRect(), box = map.getBoundingClientRect();
  const width = Math.min(card.width, box.width - 32);
  // Selecting something already readable must not move a large code card merely
  // because its bottom is outside the viewport. Find is the explicit framing action.
  if (!center && head.top >= box.top + 16 && head.bottom <= box.bottom - 16 && head.left >= box.left + 16 && head.left + width <= box.right - 16) return;
  const height = Math.min(headerOnly ? head.height : center ? card.height : Math.min(card.height, 360), box.height - 32);
  const x = head.left - box.left, y = head.top - box.top;
  const dx = center ? x - (box.width - width) / 2 : x < 16 ? x - 16 : x + width > box.width - 16 ? x + width - box.width + 16 : 0;
  const dy = center ? y - (box.height - height) / 2 : y < 16 ? y - 16 : y + height > box.height - 16 ? y + height - box.height + 16 : 0;
  const fromX = map.scrollLeft, fromY = map.scrollTop;
  const toX = Math.max(0, Math.min(map.scrollWidth - map.clientWidth, fromX + dx));
  const toY = Math.max(0, Math.min(map.scrollHeight - map.clientHeight, fromY + dy));
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { map.scrollLeft = toX; map.scrollTop = toY; return; }
  if (Math.abs(toX - fromX) < 1 && Math.abs(toY - fromY) < 1) return;
  const start = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / 220), eased = cameraEase(progress);
    map.scrollLeft = fromX + (toX - fromX) * eased; map.scrollTop = fromY + (toY - fromY) * eased;
    if (progress < 1) mapFrames.set(map, requestAnimationFrame(frame)); else mapFrames.delete(map);
  };
  mapFrames.set(map, requestAnimationFrame(frame));
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
  const [navigation, setNavigation] = useState(0);
  const selectedRef = useRef('root');
  const keyboardInput = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const pendingSource = useRef<{ panelIndex: number; beat: number } | null>(null);
  const [sourcePosition, setSourcePosition] = useState({ panelIndex: get('root').panelIndex, beat: 0 });
  const [expanded, setExpanded] = useState(new Set(['root']));
  const [detail, setDetail] = useState(true);
  const [visited, setVisited] = useState(new Set(['root']));
  const [focused, setFocused] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const map = useRef<HTMLElement>(null), options = useRef<HTMLDivElement>(null), optionsId = 'sm-options-' + useId();
  const revealRequest = useRef<{ id: string; keyboard: boolean; focus: boolean } | null>(null);
  const [transcript, setTranscript] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [beatNav, setBeatNav] = useState({ previous: false, next: false });
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
  const choose = (topic: Topic, intent: NavigationIntent = {}) => {
    const keyboard = intent.keyboard ?? keyboardInput.current;
    cancelMapMotion(map.current);
    revealRequest.current = { id: topic.id, keyboard, focus: intent.focus ?? keyboard };
    setNavigation(value => value + 1);
    pendingSource.current = { panelIndex: topic.panelIndex, beat: topic.beat };
    document.querySelector<HTMLButtonElement>('[data-aloud-stop]:not([hidden])')?.click();
    const owner = parent(topic.id);
    readingPlan(owner?.stepId === topic.stepId ? owner : topic);
    selectedRef.current = topic.id; setSelected(topic.id); setOutside(''); setVisited(old => new Set([...old, topic.id]));
    setSourcePosition({ panelIndex: topic.panelIndex, beat: topic.beat });
    setExpanded(old => new Set([...old, ...ancestors(topic.id).map(item => item.id)]));
    void selectSource(topic);
  };
  const cardFor = (id: string) => map.current?.querySelector<HTMLElement>(`[data-map-detail="${id}"]`) ?? map.current?.querySelector<HTMLElement>(`[data-map-node="${id}"]`) ?? null;
  const toggle = (id: string) => {
    if (expanded.has(id) && ancestors(selectedRef.current).some(topic => topic.id === id)) choose(get(id));
    cancelMapMotion(map.current);
    setExpanded(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const changeVariant = (next: Variant) => {
    cancelMapMotion(map.current);
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url);
    revealRequest.current = { id: selectedRef.current, keyboard: keyboardInput.current, focus: false }; setVariant(next);
  };
  const focusCard = (id: string) => cardFor(id)?.querySelector<HTMLElement>('[data-map-focus]')?.focus({ preventScroll: true });
  const findCurrent = () => {
    setExpanded(old => new Set([...old, ...ancestors(selectedRef.current).map(item => item.id)]));
    focusCard(selectedRef.current);
    revealInMap(cardFor(selectedRef.current), true, !keyboardInput.current);
  };
  const mapKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (document.querySelector('[popover]:popover-open,.ds-command-root:not([hidden])')) return;
    const target = event.target as HTMLElement;
    const viewer = target.closest('[data-map-native-viewer]');
    if (viewer && event.key === 'Escape') {
      const menu = viewer.querySelector<HTMLDetailsElement>('details[open]');
      if (menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true }); return; }
    }
    if (focused || document.body.dataset.readView !== 'tour' || document.querySelector('dialog[open]')) return;
    if (viewer) {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        const card = target.closest<HTMLElement>('[data-map-node],[data-map-detail]');
        const ownerId = card?.dataset.mapNode ?? card?.dataset.mapDetail ?? selectedRef.current;
        const id = get(ownerId).panelIndex === get(selectedRef.current).panelIndex ? selectedRef.current : ownerId;
        if (selectedRef.current !== id) choose(get(id), { keyboard: true }); else focusCard(id);
        revealInMap(cardFor(id), false, false, true);
      }
      return;
    }
    const navigationControl = target.closest('[data-map-focus],.sm-expand,.sm-map-actions button,.sm-breadcrumbs button,.sm-card-actions button,.sm-root-link');
    if (!navigationControl && target.closest('button,a,input,textarea,select,summary,[contenteditable="true"],[role="separator"],[role="tab"],[role="slider"]')) return;
    const onMap = map.current?.contains(target) || !!target.closest('.sm-command-bar') || target === document.body || target === document.documentElement || target.matches('.ds-main,#ds-view-tour');
    if (!onMap) return;
    const id = selectedRef.current;
    const current = get(id), owner = parent(id), siblings = owner ? owner.children : ['root'];
    let next: Topic | undefined;
    if (event.key === 'Home') next = get('root');
    else if (event.key === 'Enter' && (target.closest('[data-map-focus]') || !target.closest('button'))) {
      event.preventDefault(); event.stopPropagation(); focusCard(id); revealInMap(cardFor(id), true, false); return;
    } else if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && id === 'root')) {
      next = byId.get(current.children[0]);
    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      next = owner;
      if (owner) setExpanded(old => { const next = new Set(old); owner.children.forEach(id => next.delete(id)); return next; });
    }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') next = byId.get(siblings[siblings.indexOf(id) + (event.key === 'ArrowDown' ? 1 : -1)]);
    else return;
    event.preventDefault(); event.stopPropagation();
    cancelMapMotion(map.current);
    if (next) choose(next, { keyboard: true });
  };
  keyHandler.current = mapKey;
  const mapClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.closest('[data-map-native-viewer],button,a,input,textarea,select,summary,[role="separator"]') || !window.getSelection()?.isCollapsed) return;
    const card = target.closest<HTMLElement>('[data-map-node],[data-map-detail]');
    const id = card?.dataset.mapNode ?? card?.dataset.mapDetail;
    if (id) { if (id !== selectedRef.current) choose(get(id)); focusCard(id); }
    else map.current?.focus({ preventScroll: true });
  };
  const scope = (requested: Topic, focus = true) => {
    const owner = parent(requested.id);
    choose(owner?.stepId === requested.stepId ? owner : requested, { focus });
  };

  const follow = (topic: Topic) => {
    options.current?.hidePopover();
    optionsTrigger.current?.focus({ preventScroll: true });
    scope(topic, false);
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
  useLayoutEffect(() => {
    const request = revealRequest.current;
    revealRequest.current = null;
    if (focused) { cancelMapMotion(map.current); return; }
    const card = cardFor(selected);
    if (!card) return;
    if (request?.focus) card.querySelector<HTMLElement>('[data-map-focus]')?.focus({ preventScroll: true });
    // Narration follows headers without taking the viewport away from inspection.
    if (!request && document.activeElement?.closest('[data-map-native-viewer]')) return;
    revealInMap(card, false, !!request && !request.keyboard, !request || request.keyboard);
    return () => cancelMapMotion(map.current);
  }, [selected, variant, detail, focused, navigation]);
  useEffect(() => { document.body.dataset.mapTranscript = String(transcript); }, [transcript]);
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
    const stage = document.querySelector('.ds-dock-stage')!;
    const syncBeats = () => setBeatNav({ previous: !!stage.querySelector('[data-beat-dock]:not([hidden]) [data-beat-move="-1"]:not(:disabled)'), next: !!stage.querySelector('[data-beat-dock]:not([hidden]) [data-beat-move="1"]:not(:disabled)') });
    const beats = new MutationObserver(syncBeats); beats.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    sync(); syncBeats(); return () => { observer.disconnect(); beats.disconnect(); };
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
    const pop = () => setVariant(readVariant()); window.addEventListener('popstate', pop);
    const interrupt = () => cancelMapMotion(map.current);
    const pointer = () => { keyboardInput.current = false; interrupt(); };
    const key = (event: KeyboardEvent) => { keyboardInput.current = true; interrupt(); keyHandler.current(event); };
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('resize', interrupt);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('keydown', key, true); window.removeEventListener('wheel', interrupt, true); window.removeEventListener('resize', interrupt); interrupt(); };
  }, []);
  useEffect(() => {
    const view = document.querySelector('#ds-view-tour')!;
    const observer = new MutationObserver(() => {
      const active = view.querySelector<HTMLElement>('.ds-step:not([hidden])');
      const panel = Number(active?.dataset.stepPanel);
      const beat = Number(document.querySelector(`[data-dock-step="${panel}"] [data-story-beat].is-selected`)?.getAttribute('data-focus-group') ?? 0);
      // Native activation briefly selects the introduction before the requested
      // beat. Keep the immediate map selection/focus authoritative until that
      // command lands, including rapid movement within a single helper.
      if (pendingSource.current) {
        if (pendingSource.current.panelIndex !== panel || pendingSource.current.beat !== beat) return;
        pendingSource.current = null;
      }
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
  function Node({ topic, compact = false, disclosure = true, full = false, summaryOnly = false, modal = false }: { topic: Topic; compact?: boolean; disclosure?: boolean; full?: boolean; summaryOnly?: boolean; modal?: boolean }) {
    const active = selected === topic.id;
    return <article className={`sm-node ${active ? 'is-current' : ''} ${compact ? 'is-small' : ''}`} aria-label={topic.label} data-map-node={full ? undefined : topic.id} data-map-detail={full && !modal ? topic.id : undefined} data-card-kind={kindOf(topic)}>
      <header className="sm-card-head"><div><span className="sm-card-type">{kindOf(topic)}</span>
        {modal ? <h3>{topic.label}</h3> : <button type="button" className="sm-select" data-map-focus={topic.id} tabIndex={active && !(variant === 'C' && summaryOnly) ? 0 : -1} aria-current={active ? 'location' : undefined} aria-label={`Read ${topic.label}`} onClick={() => choose(topic)} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) revealInMap(event.currentTarget.closest('[data-map-node],[data-map-detail]'), false, false, true); }}><strong>{topic.label}</strong></button>}
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
    return <div className="sm-world">{world('root')}</div>;
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
    {createPortal(<div className="sm-story-title">{data.title}</div>, document.querySelector('.ds-reviewchrome-main')!)}
    {createPortal(<dialog ref={dialog} className="sm-focus-dialog" aria-labelledby="sm-focus-title" onCancel={event => { event.preventDefault(); setFocused(null); }} onKeyDown={event => event.stopPropagation()}><div className="sm-focus-head"><h2 id="sm-focus-title">{focused ? get(focused).label : 'Read card'}</h2><div className="sm-focus-actions">
      <button type="button" disabled={transport.disabled} aria-label={transport.accessibleLabel} onClick={() => document.querySelector<HTMLButtonElement>('[data-readaloud]')?.click()}>{transport.label}</button>
      {transport.canStop && <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('[data-aloud-stop]')?.click()}>Stop narration</button>}
      <button type="button" autoFocus onClick={() => setFocused(null)}>Close card</button></div></div>{focused && Node({ topic: get(focused), full: true, disclosure: false, modal: true })}</dialog>, document.body)}
    <header className="sm-command-bar">
      <nav className="sm-breadcrumbs" aria-label="Map location">{path.map((item, index) => <span key={item.id}>{index > 0 && <span aria-hidden="true">/</span>}<button type="button" onClick={() => choose(item)} aria-current={item.id === selected ? 'location' : undefined}>{item.id === 'root' ? 'Gateway' : item.label}</button></span>)}</nav>
      <div className="sm-map-actions">
        <button type="button" aria-label="Find current card" title="Center current card" onClick={findCurrent}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg></button>
        <button type="button" className="sm-focus" aria-label="Focus current card" onClick={() => openCard(node)}><span className="sm-focus-label">Focus</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
        <button ref={optionsTrigger} type="button" aria-label="Map options" aria-haspopup="dialog" aria-expanded={optionsOpen} aria-controls={optionsId} popoverTarget={optionsId} title="Map options"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>
      </div>
    </header>
    {createPortal(<div ref={options} id={optionsId} popover="auto" className="sm-options" role="dialog" aria-label="Map options" onToggle={event => setOptionsOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={event => event.stopPropagation()}>
      <div className="sm-options-head"><strong>Map options</strong><button type="button" aria-label="Close map options" onClick={() => options.current?.hidePopover()}>×</button></div>
      <label>Layout<select aria-label="Map layout" value={variant} onChange={event => changeVariant(event.target.value as Variant)}>{(['A', 'B', 'C'] as Variant[]).map(key => <option key={key} value={key}>{variants[key]}</option>)}</select></label>
      {variant === 'A' && <label className="sm-check"><input type="checkbox" checked={detail} onChange={event => setDetail(event.target.checked)} />Show card content</label>}
      <label className="sm-check"><input type="checkbox" checked={transcript} onChange={event => setTranscript(event.target.checked)} />Show narration transcript</label>
      <div className="sm-options-reading"><span className="sm-section-label">Reading path · {reading}</span><button type="button" onClick={() => follow(get('root'))}>Follow gateway</button><button type="button" onClick={() => follow(node)}>Follow this branch</button></div>
      <details><summary>Keyboard shortcuts</summary><dl><dt>→ / ←</dt><dd>Enter first detail / return to parent</dd><dt>↑ / ↓</dt><dd>Previous / next sibling</dd><dt>Home</dt><dd>Gateway overview</dd><dt>Enter</dt><dd>Center the current card</dd><dt>Escape</dt><dd>Leave code, or go up one level</dd><dt>Tab</dt><dd>Inspect card controls and source</dd></dl></details>
    </div>, document.body)}
    <nav ref={map} className="sm-map" tabIndex={-1} aria-label="Gateway story map" aria-describedby="sm-map-key-help" onClick={mapClick}>{variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}</nav>
    {outside && <div className="sm-outside">Reading elsewhere in the story.<button type="button" onClick={() => choose(node)}>Return to this branch</button></div>}
    <span id="sm-map-key-help" className="ds-sr-only">Arrow keys navigate the map. Enter centers the current card. Escape returns from code to the map.</span>
    <span className="ds-sr-only" role="status">{outside || `Reading ${node.label}. ${visited.size} topics visited.`}</span>
    {createPortal(<div className="sm-playback-context"><div className="sm-playback-label"><span>{node.label}</span><small>{reading === 'Gateway' ? 'Gateway' : 'Branch'} · {sourcePosition.beat + 1} / {payload.steps[sourcePosition.panelIndex - 1]?.beats.length || 1}</small></div><div className="sm-beat-controls" role="group" aria-label="Explanation navigation">
      <button type="button" aria-label="Previous explanation" disabled={!beatNav.previous} onClick={() => document.querySelector<HTMLButtonElement>('.ds-dock-stage [data-beat-dock]:not([hidden]) [data-beat-move="-1"]')?.click()}>←</button>
      <button type="button" aria-label="Next explanation" disabled={!beatNav.next} onClick={() => document.querySelector<HTMLButtonElement>('.ds-dock-stage [data-beat-dock]:not([hidden]) [data-beat-move="1"]')?.click()}>→</button>
    </div></div>, document.querySelector('.ds-dock-transport')!)}

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
