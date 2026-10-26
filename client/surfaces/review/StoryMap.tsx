// Story navigation around the native leased code, diff and concept viewers.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { ReviewPayload } from '../../../src/payloads';
import { MapBranchMotion, branchExitStyle, mapScrollBounds, mapCardLayoutBox } from './story-map-motion';
import { StoryMapCanvas, canvasFor } from './story-map-canvas';
import { plural } from './format';

import type { StoryMapContent as ContentBlock, StoryMapTopic as Topic, StoryMapData as MapData } from '../../../src/story-map';
const hasMedia = (topic: Topic) => topic.content.some(block => block.type === 'code' || block.type === 'diff' || block.type === 'diagram' || block.type === 'page');
const mediaId = (topic: Topic, block: ContentBlock, index: number) => block.type === 'diagram' ? `diagram-${topic.id}-${index}` : block.type === 'code' || block.type === 'diff' || block.type === 'page' ? block.viewerId : undefined;
const primaryMedia = (topic: Topic) => {
  const index = topic.content.findIndex(block => block.type === 'code' || block.type === 'diff' || block.type === 'page');
  const fallback = index < 0 ? topic.content.findIndex(block => block.type === 'diagram') : index;
  return fallback < 0 ? undefined : mediaId(topic, topic.content[fallback], fallback);
};
type Variant = 'A' | 'B' | 'C';
type NavigationIntent = { keyboard?: boolean; focus?: boolean };
const variants: Record<Variant, string> = { A: 'Content map', B: 'Reading tree', C: 'Focused cards' };
const readVariant = (): Variant => { const v = new URL(location.href).searchParams.get('variant'); return v === 'B' || v === 'C' ? v : 'A'; };
let payload: ReviewPayload;
let viewerUrl: (block: ViewerBlock) => string;
const waitFor = (condition: () => boolean) => new Promise<void>(resolve => {
  if (condition()) { resolve(); return; }
  const observer = new MutationObserver(() => { if (condition()) { observer.disconnect(); resolve(); } });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
});

// Only the outer map moves. Native code, caller and diff scrollers keep ownership.
const mapFrames = new WeakMap<HTMLElement, number>();
function cancelMapMotion(map: HTMLElement | null) {
  if (!map) return;
  canvasFor(map)?.interrupt();
  cancelAnimationFrame(mapFrames.get(map) ?? 0); mapFrames.delete(map);
}
function cameraEase(progress: number) {
  // The docs camera curve; branch focus is immediate while its viewport follows.
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) { const mid = (low + high) / 2; if (curve(mid, .25, .15) < progress) low = mid; else high = mid; }
  return curve((low + high) / 2, .7, 1);
}
function revealInMap(element: HTMLElement | null, center = false, animate = true, headerOnly = false) {
  const map = element?.closest<HTMLElement>('.sm-map');
  if (!element || !map) return;
  const canvas = canvasFor(map); if (canvas) { canvas.reveal(element, center, animate); return; }
  cancelMapMotion(map);
  const heading = element.querySelector('.sm-card-head') ?? element;
  const presented = heading.getBoundingClientRect(), card = mapCardLayoutBox(element), box = map.getBoundingClientRect();
  const head = { left: card.left, top: card.top, height: (heading as HTMLElement).offsetHeight };
  const width = Math.min(card.width, box.width - 32);
  // Selecting something already readable must not move a large code card merely
  // because its bottom is outside the viewport. Find is the explicit framing action.
  if (!center && presented.top >= box.top + 16 && presented.bottom <= box.bottom - 16 && presented.left >= box.left + 16 && presented.left + Math.min(presented.width, box.width - 32) <= box.right - 16) return;
  const height = Math.min(headerOnly ? head.height : center ? card.height : Math.min(card.height, 360), box.height - 32);
  const x = head.left - box.left, y = head.top - box.top;
  const dx = center ? x - (box.width - width) / 2 : x < 16 ? x - 16 : x + width > box.width - 16 ? x + width - box.width + 16 : 0;
  const dy = center ? y - (box.height - height) / 2 : y < 16 ? y - 16 : y + height > box.height - 16 ? y + height - box.height + 16 : 0;
  const fromX = map.scrollLeft, fromY = map.scrollTop;
  const limits = mapScrollBounds(map);
  const toX = Math.max(0, Math.min(limits.width - map.clientWidth, fromX + dx));
  const toY = Math.max(0, Math.min(limits.height - map.clientHeight, fromY + dy));
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { map.scrollLeft = toX; map.scrollTop = toY; return; }
  if (Math.abs(toX - fromX) < 1 && Math.abs(toY - fromY) < 1) return;
  const start = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / 350), eased = cameraEase(progress);
    map.scrollLeft = fromX + (toX - fromX) * eased; map.scrollTop = fromY + (toY - fromY) * eased;
    if (progress < 1) mapFrames.set(map, requestAnimationFrame(frame)); else mapFrames.delete(map);
  };
  mapFrames.set(map, requestAnimationFrame(frame));
}

let selectionVersion = 0;
async function selectSource(topic: Topic) {
  const version = ++selectionVersion;
  if (!document.querySelector(`[data-step-panel="${topic.panelIndex}"]:not([data-step-lazy]):not([hidden])`)) document.querySelector<HTMLButtonElement>(`[data-thread-node="${topic.panelIndex}"]`)?.click();
  await waitFor(() => version !== selectionVersion || !!document.querySelector(`[data-step-panel="${topic.panelIndex}"]:not([data-step-lazy]):not([hidden])`));
  if (version !== selectionVersion) return false;
  const beat = document.querySelector<HTMLButtonElement>(`[data-dock-step="${topic.panelIndex}"] [data-story-beat][data-focus-group="${topic.beat}"]`);
  if (!beat?.classList.contains('is-selected')) beat?.click();
  return version === selectionVersion && (!beat || beat.classList.contains('is-selected'));
}

type ViewerBlock = Extract<ContentBlock, { type: 'code' | 'diff' | 'page' }>;
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
function closeViewerOptions(menu: HTMLDetailsElement) {
  menu.open = false;
  const popup = menu.querySelector<HTMLElement>('.sm-viewer-options-pop');
  if (popup?.matches(':popover-open')) popup.hidePopover();
}
function placeViewer(viewer: LiveViewer) {
  const owner = [...viewer.hosts].find(host => host.modal) ?? [...viewer.hosts][0];
  if (!viewer.panel) return;
  if (!owner) {
    // Layout changes briefly remove both hosts. Keep interactive diagram frames
    // connected through that gap, just as Focus keeps the same live source pane.
    if (viewer.panel.isConnected && viewer.panel.querySelector('[data-concept-frame]')) {
      let parking = document.querySelector<HTMLElement>('#sm-viewer-parking');
      if (!parking) { parking = document.createElement('div'); parking.id = 'sm-viewer-parking'; parking.hidden = true; parking.dataset.mapNativeViewer = 'parked'; document.body.append(parking); }
      const target = parking as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
      if (target.moveBefore) target.moveBefore(viewer.panel, null); else target.append(viewer.panel);
    }
    return;
  }
  if (viewer.panel.parentElement !== owner.element) {
    viewer.panel.querySelectorAll<HTMLDetailsElement>('.sm-viewer-options[open]').forEach(closeViewerOptions);
    rememberViewerScroll(viewer); viewer.restoring = true;
    for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = 'none';
    const target = owner.element as HTMLDivElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (viewer.panel.querySelector('[data-concept-frame]') && viewer.panel.isConnected && target.isConnected && target.moveBefore) {
      target.replaceChildren(); target.moveBefore(viewer.panel, null);
    } else target.replaceChildren(viewer.panel);
  }
  owner.refresh({ initialize: !viewer.initialized, attach: true, reflow: !viewer.initialized });
  viewer.initialized = true;
  settleViewerScroll(viewer);
}
// Keep the native controls and their listeners, but give every viewer one
// toolbar above its scroll panes. Mode controls retain an explicit owner.
function compactViewerHeader(panel: HTMLElement, block: ViewerBlock) {
  if (block.type === 'page') return;
  const toolbar = panel.querySelector<HTMLElement>('.ds-difftoolbar');
  const holder = toolbar?.closest<HTMLElement>('[data-story-diff]');
  if (!toolbar || !holder) return;
  toolbar.classList.add('sm-viewer-toolbar');
  toolbar.dataset.mapToolbarFor = holder.id;
  Object.assign(holder, { _dsMapToolbar: toolbar });
  const meta = document.createElement('div'); meta.className = 'sm-viewer-meta';
  const file = toolbar.querySelector('.ds-diff-path'); if (file) meta.append(file);
  const revision = document.createElement('span'); revision.className = 'sm-viewer-revision';
  revision.textContent = block.type === 'code' ? block.revision.slice(0, 7) : `${block.base.slice(0, 7)} → ${block.head.slice(0, 7)}`;
  revision.title = block.type === 'code' ? `Code at ${block.revision}` : `Change from ${block.base} to ${block.head}`;
  revision.setAttribute('aria-label', revision.title); meta.append(revision); toolbar.prepend(meta);
  const actions = panel.querySelector('.ds-step-actions');
  const toggle = panel.querySelector<HTMLButtonElement>('[data-callsite-toggle]');
  if (toggle && actions) { toggle.removeAttribute('aria-label'); toggle.title = 'Show or hide caller context'; actions.prepend(toggle); }
  const wrap = toolbar.querySelector<HTMLElement>('[data-line-wrap-toggle]');
  if (wrap && actions) {
    const label = wrap.querySelector('[data-line-wrap-label]'); if (label) label.textContent = 'Wrap long lines';
    actions.prepend(wrap);
  }
  const source = actions?.querySelector('.ds-source-info'); if (source) source.textContent = 'Source references';
  const repair = actions?.querySelector('summary[aria-label="Repair this story step"]');
  if (repair) { const label = document.createElement('span'); label.className = 'sm-viewer-action-label'; label.textContent = repair.getAttribute('aria-label') ?? 'Repair story step'; repair.append(label); }
  if (actions) {
    const options = document.createElement('details'); options.className = 'sm-viewer-options';
    const trigger = document.createElement('summary'); trigger.setAttribute('aria-label', 'Viewer options'); trigger.title = 'Viewer options'; trigger.textContent = '⋯';
    const menu = document.createElement('div'); menu.className = 'sm-viewer-options-pop'; menu.setAttribute('popover', 'manual'); menu.append(actions);
    options.append(trigger, menu);
    const position = () => {
      if (!menu.matches(':popover-open')) return;
      const anchor = trigger.getBoundingClientRect(), box = menu.getBoundingClientRect();
      const width = document.documentElement.clientWidth, height = window.innerHeight;
      const below = anchor.bottom + 5, above = anchor.top - box.height - 5;
      menu.style.left = `${Math.max(8, Math.min(width - box.width - 8, anchor.right - box.width))}px`;
      menu.style.top = `${Math.max(8, below + box.height <= height - 8 ? below : above)}px`;
    };
    options.addEventListener('toggle', () => {
      if (options.open) { menu.showPopover(); position(); }
      else { closeViewerOptions(options); options.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(detail => { detail.open = false; }); }
    });
    repair?.parentElement?.addEventListener('toggle', position);
    toolbar.append(options);
  }
  const pairToolbar = panel.querySelector('.ds-code-pair-toolbar');
  if (pairToolbar) pairToolbar.replaceWith(toolbar); else panel.prepend(toolbar);
  panel.querySelector<HTMLElement>('.ds-step-top')?.setAttribute('hidden', '');
  const callerPath = panel.querySelector<HTMLElement>('.ds-callsite-path');
  const caller = panel.querySelector<HTMLElement>('.ds-callsite-heading code');
  if (caller && callerPath) {
    caller.title = callerPath.title;
    const pane = panel.querySelector<HTMLElement>('.ds-callsite-pane');
    pane?.setAttribute('aria-label', `${pane.getAttribute('aria-label')} in ${callerPath.title}`);
    callerPath.hidden = true;
  }
  const back = panel.querySelector<HTMLElement>('[data-callsite-return]');
  if (back) back.title = back.getAttribute('aria-label') ?? 'Return to caller';
}
function NativeViewer({ block, beat, current, full, hidden = false }: { block: ViewerBlock; beat: number; current: boolean; full: boolean; hidden?: boolean }) {
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
        beat: state.beat, ranges: block.type === 'page' ? [] : block.rangesByBeat[state.beat] ?? [], ...extra,
      } }));
    };
    const registration = { element, modal: !!element.closest('dialog'), refresh }; viewer.hosts.add(registration);
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => refresh({ geometry: true })); };
    const observer = new MutationObserver(records => { if (records.some(record => (record.target as HTMLElement).matches('[data-mode],[data-full-inner],[data-diff-inner],[data-split-inner],[data-line-wrap-toggle],.ds-callsite-pane,[data-callsite-toggle]'))) schedule(); });
    let width = 0;
    const resize = new ResizeObserver(entries => { const next = Math.round(entries[0].contentRect.width); if (next !== width) { width = next; refresh({ geometry: true }); settleViewerScroll(viewer); } });
    if (!viewerHtml.has(block.viewerId)) viewerHtml.set(block.viewerId, fetch(viewerUrl(block)).then(async response => { if (!response.ok) throw new Error(response.status === 409 ? 'This review changed. Reload to read its source.' : 'Could not load this viewer. Reload to try again.'); return response.text(); }));
    void viewerHtml.get(block.viewerId)!.then(markup => {
      if (cancelled) return;
      if (!viewer.panel) {
        // The ordinary escaped server fragment becomes one live viewer. Focus
        // reparents this element, preserving all native inspection state.
        const template = document.createElement('template'); template.innerHTML = markup;
        const panel = template.content.firstElementChild as HTMLElement;
        panel.classList.remove('ds-step'); panel.classList.add('sm-native-step'); panel.removeAttribute('hidden'); panel.removeAttribute('data-step-panel');
        panel.querySelectorAll('[data-beat-dock],template[data-step-landing]').forEach(node => node.remove());
        if (block.type !== 'page') panel.querySelectorAll<HTMLElement>('.ds-diffscroll').forEach(node => { node.tabIndex = 0; node.setAttribute('role', 'region'); node.setAttribute('aria-label', `${block.type === 'diff' ? 'Code diff' : 'Code'} viewport: ${block.file}`); });
        const ids = new Map<string, string>();
        panel.querySelectorAll<HTMLElement>('[id]').forEach(node => { ids.set(node.id, 'sm-' + id + '-' + node.id); node.id = ids.get(node.id)!; });
        panel.querySelectorAll<HTMLElement>('[aria-controls],[aria-labelledby],[popovertarget]').forEach(node => {
          for (const attr of ['aria-controls', 'aria-labelledby', 'popovertarget']) if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr)!.split(' ').map(value => ids.get(value) ?? value).join(' '));
        });
        if (block.type === 'diff') panel.querySelectorAll<HTMLElement>('[data-open-full-diff]').forEach(node => { node.removeAttribute('data-open-full-diff'); node.setAttribute('data-map-open-full', ''); node.setAttribute('aria-label', `Read ${block.file} at this historical change`); node.title = `Read ${block.file} at this historical change`; });
        if (block.type === 'page') panel.querySelectorAll<HTMLElement>('[data-concept-page]').forEach(node => { node.tabIndex = 0; node.setAttribute('role', 'region'); node.setAttribute('aria-label', 'Interactive story diagram'); });
        compactViewerHeader(panel, block);
        viewer.panel = panel;
      }
      placeViewer(viewer);
      observer.observe(element, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-pressed', 'aria-busy'] });
      resize.observe(element);
    }).catch(error => { if (!cancelled && !viewer.panel) { const note = document.createElement('p'); note.className = 'ds-diffnote'; note.setAttribute('role', 'alert'); note.textContent = error.message; element.replaceChildren(note); } });
    const update = (event: Event) => refresh((event as CustomEvent).detail);
    const scrolled = () => { if (viewer.panel?.parentElement === element) rememberViewerScroll(viewer); };
    element.addEventListener('scroll', scrolled, true);
    element.addEventListener('codestory:map-position', update);
    return () => { rememberViewerScroll(viewer); cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); element.removeEventListener('scroll', scrolled, true); element.removeEventListener('codestory:map-position', update); viewer.hosts.delete(registration); placeViewer(viewer); };
  }, [block.viewerId]);
  useEffect(() => { host.current?.dispatchEvent(new CustomEvent('codestory:map-position', { detail: { center: current && (positioned.current || !full) } })); positioned.current = true; }, [beat, current]);
  return <div className="sm-viewer-block" data-map-media={block.viewerId} data-map-page={block.type === 'page' ? 'true' : undefined} hidden={hidden}>
    <div ref={host} data-map-native-viewer={block.viewerId} className="sm-native-viewer" tabIndex={block.type === 'page' ? 0 : undefined} aria-label={block.type === 'page' ? 'Interactive story diagram' : undefined} onClick={event => {
      if ((event.target as HTMLElement).closest('[data-map-open-full]')) { event.stopPropagation(); host.current?.querySelector<HTMLButtonElement>('[data-mode="full"]')?.click(); }
      const caller = (event.target as HTMLElement).closest('[data-callsite-return]');
      if (caller) window.dispatchEvent(new CustomEvent('codestory:map-return', { detail: Number(caller.getAttribute('data-callsite-return')) }));
    }} onKeyDown={event => {
      if (!(event.target as HTMLElement).closest('button,a,input,textarea,select,[role="separator"]')) event.stopPropagation();
    }}><div className="ds-step-loading" role="status">Loading CodeStory viewer…</div></div>
  </div>;
}

function BranchPresence({ open, branchId, as = 'div', className, children }: { open: boolean; branchId: string; as?: 'div' | 'ul'; className?: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open), [shown, setShown] = useState(open);
  const element = useRef<HTMLDivElement & HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (open) { setMounted(true); setShown(true); return; }
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
    return () => clearTimeout(timer);
  }, [open, shown]);
  if (!mounted && !open) return null;
  const Tag = as;
  return <Tag ref={element} id={`sm-branch-${branchId}`} data-presence-branch={branchId} data-branch-exiting={!open && shown ? 'true' : undefined} className={className} hidden={!open && !shown} inert={!open} aria-hidden={!open || undefined} style={!open && shown ? branchExitStyle(element.current) : undefined}>{children}</Tag>;
}

function StoryMap({ data }: { data: MapData }) {
  const byId = useMemo(() => new Map(data.nodes.map(node => [node.id, node])), [data.nodes]);
  const parents = useMemo(() => new Map(data.nodes.flatMap(node => node.children.map(child => [child, node] as const))), [data.nodes]);
  const mountedMedia = useRef(new Set<string>());
  const get = (id: string) => byId.get(id)!;
  const parent = (id: string) => parents.get(id);
  const ancestors = (id: string): Topic[] => { const p = parent(id); return p ? [...ancestors(p.id), p] : []; };
  const numberFor = (id: string): string => {
    const owner = parent(id);
    if (!owner) return '01';
    const index = owner.children.indexOf(id);
    return owner.id === 'root' ? String(index + 2).padStart(2, '0') : `${numberFor(owner.id)}.${index + 1}`;
  };
  // The native engine restores and mirrors its reading position before the map
  // mounts. Structural cards share panel indexes, so restore the actual step.
  const [initialTopic] = useState(() => {
    const params = new URL(location.href).searchParams;
    const panelIndex = Number(params.get('step'));
    const card = byId.get(params.get('card') ?? '');
    if (card && card.panelIndex === panelIndex) return card;
    return Number.isInteger(panelIndex) && panelIndex > 0
      ? data.nodes.find(topic => !topic.structural && topic.beat === 0 && topic.panelIndex === panelIndex) ?? get('root')
      : get('root');
  });
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [selected, setSelected] = useState(initialTopic.id);
  const [navigation, setNavigation] = useState(0);
  const selectedRef = useRef(initialTopic.id);
  const [branchMotion] = useState(() => new MapBranchMotion(new Map(data.nodes.flatMap(node => node.children.map(child => [child, node.id] as const)))));
  const [canvas] = useState(() => new StoryMapCanvas(data.nodes));
  const [zoom, setZoom] = useState(100);
  const [overview, setOverview] = useState(false);
  const reflowed = useRef(false), focusByMap = useRef(false);
  const keyboardInput = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const pendingSource = useRef<{ panelIndex: number; beat: number } | null>(null);
  const [sourcePosition, setSourcePosition] = useState({ panelIndex: initialTopic.panelIndex, beat: initialTopic.beat });
  const sourcePositionRef = useRef(sourcePosition); sourcePositionRef.current = sourcePosition;
  const lastBeats = useRef(new Map<number, number>()); lastBeats.current.set(sourcePosition.panelIndex, sourcePosition.beat);
  const [expanded, setExpanded] = useState(new Set(['root', ...ancestors(initialTopic.id).map(topic => topic.id)]));
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [visited, setVisited] = useState(new Set(['root', initialTopic.id]));
  const [focused, setFocused] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMedia, setFullscreenMedia] = useState<string | undefined>();
  const fullscreenReturn = useRef<{ focused: boolean; element: HTMLElement | null; top: number; topic: string | null }>({ focused: false, element: null, top: 0, topic: null });
  const dialog = useRef<HTMLDialogElement>(null);
  const focusDestination = useRef(false);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const map = useRef<HTMLElement>(null), options = useRef<HTMLDivElement>(null), optionsId = 'sm-options-' + useId();
  const revealRequest = useRef<{ id: string; keyboard: boolean; focus: boolean; center?: boolean } | null>(null);
  const lastRevealedSelection = useRef({ id: '', variant });
  const [transcript, setTranscript] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [beatNav, setBeatNav] = useState({ previous: false, next: false });
  const [transport, setTransport] = useState({ label: 'Play', accessibleLabel: 'Play narration', disabled: false, canStop: false });
  const [reading, setReading] = useState(data.readingLabel ?? 'Gateway');
  const [outside, setOutside] = useState('');
  const node = get(selected), path = [...ancestors(selected), node];
  const readingPlan = (topic: Topic) => {
    const collect = (n: Topic): number[] => [n.panelIndex, ...n.children.flatMap(id => collect(get(id)))];
    const indexes = topic.id === 'root' ? data.path.map(id => get(id).panelIndex) : collect(topic);
    document.body.dataset.prototypeReadingPath = [...new Set(indexes)].join(',');
    setReading(topic.id === 'root' ? data.readingLabel ?? 'Gateway' : topic.label);
  };
  const prepareReflow = (anchor = selectedRef.current, layoutChange = false) => {
    if (!map.current) return;
    if (variant === 'A') for (const viewer of liveViewers.values()) {
      rememberViewerScroll(viewer); viewer.restoring = true;
      for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = 'none';
    }
    canvas.capture(map.current, anchor, layoutChange); branchMotion.capture(map.current, anchor, layoutChange);
  };
  const allowViewerCenter = (panelIndex: number) => {
    for (const topic of data.nodes) if (topic.panelIndex === panelIndex) for (const block of topic.content) {
      if (block.type !== 'code' && block.type !== 'diff') continue;
      const viewer = liveViewers.get(block.viewerId); if (!viewer) continue;
      // A new explanation intentionally reveals different code. Inspection
      // restoration only owns moves of the same explanation (Fit or Focus).
      for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = saved.anchor;
      viewer.restoring = false;
    }
  };
  const choose = (topic: Topic, intent: NavigationIntent = {}) => {
    const keyboard = intent.keyboard ?? keyboardInput.current;
    prepareReflow(selectedRef.current, ancestors(topic.id).some(item => !expandedRef.current.has(item.id)));
    if (variant === 'A' && (sourcePositionRef.current.panelIndex !== topic.panelIndex || sourcePositionRef.current.beat !== topic.beat)) allowViewerCenter(topic.panelIndex);
    setOverview(false);
    cancelMapMotion(map.current);
    revealRequest.current = { id: topic.id, keyboard, focus: intent.focus ?? keyboard };
    setNavigation(value => value + 1);
    pendingSource.current = { panelIndex: topic.panelIndex, beat: topic.beat };
    document.querySelector<HTMLButtonElement>('[data-aloud-stop]:not([hidden])')?.click();
    const owner = parent(topic.id);
    readingPlan(owner && !owner.structural && owner.stepId === topic.stepId ? owner : topic);
    selectedRef.current = topic.id; setSelected(topic.id); setOutside(''); setVisited(old => new Set([...old, topic.id]));
    setSourcePosition({ panelIndex: topic.panelIndex, beat: topic.beat });
    setExpanded(old => new Set([...old, ...ancestors(topic.id).map(item => item.id)]));
    void selectSource(topic).then(settled => {
      if (settled && pendingSource.current?.panelIndex === topic.panelIndex && pendingSource.current.beat === topic.beat) pendingSource.current = null;
    });
  };
  const cardFor = (id: string) => map.current?.querySelector<HTMLElement>(`[data-map-detail="${id}"]`) ?? map.current?.querySelector<HTMLElement>(`[data-map-node="${id}"]`) ?? null;
  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    prepareReflow(id, true);
    const returning = !opening && ancestors(selectedRef.current).some(topic => topic.id === id);
    if (returning) choose(get(id));
    cancelMapMotion(map.current);
    revealRequest.current = { id: opening ? get(id).children[0] : id, keyboard: keyboardInput.current, focus: returning && keyboardInput.current };
    setNavigation(value => value + 1);
    setExpanded(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const changeVariant = (next: Variant) => {
    cancelMapMotion(map.current); branchMotion.reset(); canvas.reset();
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url);
    revealRequest.current = { id: selectedRef.current, keyboard: keyboardInput.current, focus: false }; setVariant(next);
  };
  const focusCard = (id: string) => { focusByMap.current = true; try { cardFor(id)?.querySelector<HTMLElement>('[data-map-focus]')?.focus({ preventScroll: true }); } finally { focusByMap.current = false; } };
  const preserveInspection = () => {
    for (const viewer of liveViewers.values()) if (viewer.panel?.getClientRects().length) {
      rememberViewerScroll(viewer); viewer.restoring = true;
      for (const saved of viewer.scrolls) saved.element.style.overflowAnchor = 'none';
    }
  };
  useEffect(() => {
    const element = map.current!;
    const restore = () => { for (const viewer of liveViewers.values()) if (viewer.restoring) settleViewerScroll(viewer); };
    element.addEventListener('codestory:map-retire', preserveInspection);
    element.addEventListener('codestory:map-retired', restore);
    return () => { element.removeEventListener('codestory:map-retire', preserveInspection); element.removeEventListener('codestory:map-retired', restore); };
  }, []);
  const exitFullscreen = () => {
    preserveInspection(); setFullscreen(false);
    const previous = fullscreenReturn.current;
    if (!previous.focused) setFocused(null);
    requestAnimationFrame(() => {
      if (previous.focused && dialog.current) dialog.current.scrollTop = previous.topic === focused ? previous.top : 0;
      if (previous.element?.isConnected && previous.element.getClientRects().length) previous.element.focus({ preventScroll: true });
      else if (!previous.focused) focusCard(selectedRef.current);
    });
  };
  const enterFullscreen = (topic: Topic) => {
    if (fullscreen) { exitFullscreen(); return; }
    if (!hasMedia(topic)) return;
    fullscreenReturn.current = { focused: !!focused, element: document.activeElement instanceof HTMLElement ? document.activeElement : null, top: dialog.current?.scrollTop ?? 0, topic: focused };
    setFullscreenMedia(fullscreenReturn.current.element?.closest<HTMLElement>('[data-map-media]')?.dataset.mapMedia ?? primaryMedia(topic));
    preserveInspection(); cancelMapMotion(map.current); setFocused(topic.id); setFullscreen(true);
  };
  const dismissCard = () => {
    if (fullscreen && !fullscreenReturn.current.focused) { exitFullscreen(); return; }
    preserveInspection(); setFullscreen(false); setFocused(null);
  };
  const findCurrent = () => {
    if (variant === 'A' && overview) {
      prepareReflow(); setOverview(false); revealRequest.current = { id: selectedRef.current, keyboard: keyboardInput.current, focus: true, center: true }; setNavigation(value => value + 1); return;
    }
    setExpanded(old => { const ids = ancestors(selectedRef.current).map(item => item.id); return ids.every(id => old.has(id)) ? old : new Set([...old, ...ids]); });
    focusCard(selectedRef.current);
    revealInMap(cardFor(selectedRef.current), true, variant === 'A' || !keyboardInput.current);
  };
  const mapKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (document.querySelector('[popover]:popover-open:not(.sm-viewer-options-pop),.ds-command-root:not([hidden])')) return;
    const target = event.target as HTMLElement;
    if (event.key.toLowerCase() === 'f' && target.closest('.sm-map,.sm-focus-dialog') && !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) {
      const owner = target.closest<HTMLElement>('[data-map-node],[data-map-detail]');
      const topic = focused ? get(focused) : get(owner?.dataset.mapNode ?? owner?.dataset.mapDetail ?? selectedRef.current);
      if (fullscreen || hasMedia(topic)) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) {
          const menu = target.closest<HTMLDetailsElement>('.sm-viewer-options'); if (menu) closeViewerOptions(menu);
          enterFullscreen(topic);
        }
        return;
      }
    }
    if (event.shiftKey) return;
    const viewer = target.closest('[data-map-native-viewer]');
    if (viewer && event.key === 'Escape') {
      const menu = target.closest<HTMLDetailsElement>('details[open]') ?? viewer.querySelector<HTMLDetailsElement>('details[open]');
      if (menu) { event.preventDefault(); event.stopPropagation(); if (menu.matches('.sm-viewer-options')) closeViewerOptions(menu); else menu.open = false; menu.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true }); return; }
    }
    if (fullscreen && event.key === 'Escape' && !document.fullscreenElement) { event.preventDefault(); event.stopPropagation(); exitFullscreen(); return; }
    // Keys forwarded by a sandboxed diagram have no browser dialog default.
    // Dismiss Focus explicitly after native menus/fullscreen have had priority.
    if (focused && viewer && event.key === 'Escape' && !document.fullscreenElement) { event.preventDefault(); event.stopPropagation(); dismissCard(); return; }
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
    const navigationControl = target.closest('[data-map-focus],.sm-expand,.sm-map-actions button,.sm-breadcrumbs button,.sm-card-actions button,.sm-parent-card,.sm-sibling-cards button,.sm-root-link');
    if (!navigationControl && target.closest('button,a,input,textarea,select,summary,[contenteditable="true"],[role="separator"],[role="tab"],[role="slider"]')) return;
    const onMap = map.current?.contains(target) || !!target.closest('.sm-command-bar') || target === document.body || target === document.documentElement || target.matches('.ds-main,#ds-view-tour');
    if (!onMap) return;
    const id = selectedRef.current;
    const current = get(id), owner = parent(id), siblings = owner ? owner.children : ['root'];
    let next: Topic | undefined;
    if (event.key === 'Home') next = get('root');
    else if (event.key === 'Enter' && (target.closest('[data-map-focus]') || !target.closest('button'))) {
      event.preventDefault(); event.stopPropagation(); focusCard(id); revealInMap(cardFor(id), true, variant === 'A'); return;
    } else if (event.key === 'ArrowRight' || (event.key === 'ArrowDown' && id === 'root')) {
      next = byId.get(current.children[0]);
    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      next = owner;
      if (owner) { prepareReflow(owner.id, owner.children.some(id => expandedRef.current.has(id))); setExpanded(old => { const next = new Set(old); owner.children.forEach(id => next.delete(id)); return next; }); }
    }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') next = byId.get(siblings[siblings.indexOf(id) + (event.key === 'ArrowDown' ? 1 : -1)]);
    else return;
    event.preventDefault(); event.stopPropagation();
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
    choose(owner && !owner.structural && owner.stepId === requested.stepId ? owner : requested, { focus });
  };

  const follow = (topic: Topic) => {
    options.current?.hidePopover();
    optionsTrigger.current?.focus({ preventScroll: true });
    scope(topic, false);
  };

  useEffect(() => {
    const dismiss = (event: Event) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>('.sm-viewer-options[open]')) {
        if (!menu.contains(event.target as Node)) closeViewerOptions(menu);
      }
    };
    const closeAll = () => document.querySelectorAll<HTMLDetailsElement>('.sm-viewer-options[open]').forEach(closeViewerOptions);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', closeAll);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss); document.removeEventListener('wheel', dismiss, true); window.removeEventListener('resize', closeAll); };
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>('.sm-viewer-options[open]').forEach(closeViewerOptions);
  }, [selected, focused, variant]);
  useEffect(() => {
    document.body.dataset.mapVariant = variant;
  }, [variant]);
  useEffect(() => {
    // Structural cards and explanation leaves can share one native step. Keep
    // their identity beside the engine-owned step so reload restores the card.
    const url = new URL(location.href);
    url.searchParams.set('card', selected);
    history.replaceState(null, '', url);
  }, [selected]);
  useEffect(() => {
    setFocused(current => {
      if (!current) return current;
      const topic = get(selected), shown = get(current), owner = parent(topic.id);
      if (shown.panelIndex === topic.panelIndex && (!document.querySelector('[data-readaloud][aria-pressed="true"]') || parent(shown.id)?.stepId !== shown.stepId)) return current;
      return owner && !owner.structural && owner.stepId === topic.stepId ? owner.id : topic.id;
    });
  }, [selected]);
  useLayoutEffect(() => {
    reflowed.current = map.current ? variant === 'A' ? canvas.flush(map.current) : branchMotion.flush(map.current) : false;
    if (variant === 'A') for (const viewer of liveViewers.values()) if (viewer.restoring) settleViewerScroll(viewer);
  });
  useEffect(() => () => { branchMotion.reset(); canvas.reset(); }, []);
  useEffect(() => {
    const element = map.current!;
    const moved = (event: Event) => setZoom((event as CustomEvent<number>).detail);
    setZoom(Number(element.dataset.mapZoom) || 100);
    element.addEventListener('codestory:map-camera', moved);
    return () => element.removeEventListener('codestory:map-camera', moved);
  }, []);
  useLayoutEffect(() => {
    const request = revealRequest.current;
    revealRequest.current = null;
    if (focused) { cancelMapMotion(map.current); return; }
    if (variant === 'A' && overview) { canvas.fit(!keyboardInput.current); return; }
    const initialReveal = !lastRevealedSelection.current.id;
    const changed = lastRevealedSelection.current.id !== selected || lastRevealedSelection.current.variant !== variant;
    lastRevealedSelection.current = { id: selected, variant };
    // Native activation acknowledges the same selection in a second commit.
    // It must not cancel an already running camera flight and snap to its end.
    if (!changed && !request && !reflowed.current) return;
    const card = cardFor(request?.id ?? selected);
    if (!card) return;
    if (request?.focus) focusCard(selected);
    // Narration follows headers without taking the viewport away from inspection.
    if (!request && document.activeElement?.closest('[data-map-native-viewer]')) return;
    const animate = !initialReveal && (variant === 'A' ? changed || !!request || reflowed.current : reflowed.current || (!!request && !request.keyboard));
    revealInMap(card, !!request?.center || reflowed.current, animate, !request?.center && !reflowed.current && (!request || request.keyboard));
  }, [selected, variant, focused, navigation, expanded, overview]);
  useEffect(() => { document.body.dataset.mapTranscript = String(transcript); }, [transcript]);
  useEffect(() => {
    if (focused && !dialog.current?.open) dialog.current?.showModal();
    else if (!focused && dialog.current?.open) dialog.current.close();
    if (focused && dialog.current) dialog.current.scrollTop = 0;
  }, [focused]);
  useLayoutEffect(() => {
    for (const viewer of liveViewers.values()) if (viewer.restoring) settleViewerScroll(viewer);
  }, [fullscreen]);
  useEffect(() => {
    if (!fullscreen || !dialog.current) return;
    const root = dialog.current, initialFocus = document.activeElement;
    const observer = new MutationObserver(() => { if (focusContent()) observer.disconnect(); });
    const focusContent = () => {
      // Do not take focus back after the reader has started another action.
      if (document.activeElement !== initialFocus) return true;
      const previous = fullscreenReturn.current.element;
      const media = [...root.querySelectorAll<HTMLElement>('.sm-diagram,[data-map-native-viewer]')].find(element => element.getClientRects().length);
      const pane = media?.matches('[data-map-native-viewer]')
        ? [...media.querySelectorAll<HTMLElement>('.ds-helper-scroll')].find(element => element.getClientRects().length)
          ?? [...media.querySelectorAll<HTMLElement>('.ds-diffscroll,[data-concept-page]')].find(element => element.getClientRects().length)
        : media;
      const target = previous && root.contains(previous) && previous.getClientRects().length && previous.closest('[data-map-native-viewer]') ? previous : pane;
      if (!target) return false;
      target.focus({ preventScroll: true }); return true;
    };
    const frame = requestAnimationFrame(() => { if (!focusContent()) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] }); });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [fullscreen]);
  useLayoutEffect(() => {
    if (!focused || !focusDestination.current) return;
    focusDestination.current = false;
    dialog.current?.querySelector<HTMLElement>('#sm-focus-title')?.focus({ preventScroll: true });
  }, [focused]);
  useEffect(() => {
    const primary = document.querySelector<HTMLButtonElement>('[data-readaloud]');
    const stop = document.querySelector<HTMLButtonElement>('[data-aloud-stop]');
    if (!primary || !stop) return;
    const sync = () => {
      const next = { label: primary.querySelector('[data-readaloud-label]')?.textContent?.trim() || 'Play',
        accessibleLabel: primary.getAttribute('aria-label') || 'Play narration', disabled: primary.disabled, canStop: !stop.hidden };
      setTransport(old => old.label === next.label && old.accessibleLabel === next.accessibleLabel && old.disabled === next.disabled && old.canStop === next.canStop ? old : next);
    };
    const observer = new MutationObserver(sync);
    observer.observe(primary, { attributes: true, childList: true, characterData: true, subtree: true });
    observer.observe(stop, { attributes: true, attributeFilter: ['hidden'] });
    const stage = document.querySelector('.ds-dock-stage')!;
    const syncBeats = () => {
      const next = { previous: !!stage.querySelector('[data-beat-dock]:not([hidden]) [data-beat-move="-1"]:not(:disabled)'), next: !!stage.querySelector('[data-beat-dock]:not([hidden]) [data-beat-move="1"]:not(:disabled)') };
      setBeatNav(old => old.previous === next.previous && old.next === next.next ? old : next);
    };
    const beats = new MutationObserver(syncBeats); beats.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    sync(); syncBeats(); return () => { observer.disconnect(); beats.disconnect(); };
  }, []);
  useEffect(() => {
    document.body.dataset.prototypeReadingPath = data.path.map(id => get(id).panelIndex).join(',');
    void selectSource(initialTopic);
    const returned = (event: Event) => {
      const topic = data.nodes.find(item => !item.structural && item.panelIndex === (event as CustomEvent<number>).detail);
      if (topic) { choose(topic); requestAnimationFrame(() => { const code = document.querySelector<HTMLDetailsElement>(`.sm-map [data-map-node="${topic.id}"] .sm-native-disclosure`); if (code) code.open = true; }); }
    };
    window.addEventListener('codestory:map-return', returned);
    return () => window.removeEventListener('codestory:map-return', returned);
  }, []);
  useEffect(() => {
    const pop = () => { branchMotion.reset(); canvas.reset(); setVariant(readVariant()); }; window.addEventListener('popstate', pop);
    const interrupt = () => cancelMapMotion(map.current);
    const pointer = () => { keyboardInput.current = false; interrupt(); };
    const key = (event: KeyboardEvent) => { keyboardInput.current = true; keyHandler.current(event); if (!event.defaultPrevented) interrupt(); };
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', interrupt, { capture: true, passive: true });
    window.addEventListener('resize', interrupt);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('keydown', key, true); window.removeEventListener('wheel', interrupt, true); window.removeEventListener('resize', interrupt); interrupt(); };
  }, []);
  useEffect(() => {
    const view = document.querySelector('#ds-view-tour')!;
    const observer = new MutationObserver(records => {
      if (records.every(record => (record.target as Element).closest('.sm-prototype'))) return;
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
      const matches = data.nodes.filter(topic => !topic.structural && topic.panelIndex === panel);
      if (!matches.length) { if (panel) setOutside(payload.steps[panel - 1]?.title.text ?? 'Another part of the story'); return; }
      setOutside('');
      const requested = get(selectedRef.current);
      const narrating = document.querySelector('[data-readaloud]')?.getAttribute('aria-label')?.startsWith('Pause');
      if (requested.structural && requested.panelIndex === panel && beat === 0 && !narrating) return;
      const exact = !requested.structural && requested.panelIndex === panel && requested.beat === beat ? requested : matches.find(topic => !topic.children.length && topic.beat === beat) ?? matches[0];
      if (exact.id !== 'root' || beat > 0) setOverview(false);
      if (ancestors(exact.id).some(topic => !expandedRef.current.has(topic.id))) prepareReflow(selectedRef.current, true);
      if (sourcePositionRef.current.panelIndex !== panel || sourcePositionRef.current.beat !== beat) allowViewerCenter(panel);
      selectedRef.current = exact.id;
      setSelected(exact.id); setVisited(old => old.has(exact.id) ? old : new Set([...old, exact.id]));
      setExpanded(old => { const ids = ancestors(exact.id).map(item => item.id); return ids.every(id => old.has(id)) ? old : new Set([...old, ...ids]); });
    });
    observer.observe(view, { attributes: true, subtree: true, attributeFilter: ['hidden', 'aria-pressed'] });
    const primary = document.querySelector('[data-readaloud]'); if (primary) observer.observe(primary, { attributes: true, attributeFilter: ['aria-label'] });
    const stage = document.querySelector('.ds-dock-stage'); if (stage) observer.observe(stage, { attributes: true, subtree: true, attributeFilter: ['hidden', 'aria-pressed'] });
    return () => observer.disconnect();
  }, []);

  const kindOf = (topic: Topic) => topic.structural ? (topic.structural === 'tour' ? 'Story map' : topic.structural === 'chapter' ? 'Chapter' : 'Section') : topic.content.some(block => block.type === 'diff') ? 'Code diff' : topic.content.some(block => block.type === 'code') ? 'Code' : topic.content.some(block => block.type === 'diagram' || block.type === 'page') ? 'Story + diagram' : 'Story';
  const openCard = (topic: Topic) => { if (get(selectedRef.current).stepId !== topic.stepId) choose(topic); setFocused(topic.id); };
  function Content({ topic, full = false }: { topic: Topic; full?: boolean }) {
    const currentBeat = parent(topic.id)?.stepId !== topic.stepId ? lastBeats.current.get(topic.panelIndex) ?? topic.beat : topic.beat;
    const activeMedia = topic.content.some((block, index) => mediaId(topic, block, index) === fullscreenMedia) ? fullscreenMedia : primaryMedia(topic);
    return <div className={`sm-card-content ${full ? 'is-full' : ''}`}>{topic.content.map((block, index) => {
      if (block.type === 'prose') return <p className="sm-prose" key={index}>{block.text}</p>;
      if (block.type === 'text') {
        const step = payload.steps[block.panelIndex - 1];
        const prose = <p className="sm-prose">{step?.beats[currentBeat]?.text.text ?? step?.why?.text ?? step?.conceptSpeech}</p>;
        // Reserve the tallest authored passage in a source card. Narration can
        // then change its text/highlights without moving the connected canvas.
        if (variant === 'A' && !full && topic.content.some(item => item.type === 'code' || item.type === 'diff')) return <div className="sm-prose-stack" key={index}>{prose}{step?.beats.map((beat, i) => <p key={i} className="sm-prose-measure" aria-hidden="true">{beat.text.text}</p>)}</div>;
        return <p className="sm-prose" key={index}>{step?.beats[currentBeat]?.text.text ?? step?.why?.text ?? step?.conceptSpeech}</p>;
      }
      if (block.type === 'diagram') return <figure className="sm-diagram" key={index} data-map-media={mediaId(topic, block, index)} hidden={full && fullscreen && activeMedia !== mediaId(topic, block, index)} tabIndex={0} aria-keyshortcuts="F"><figcaption>{block.title}</figcaption>
        <ol aria-label={block.title}>{block.labels.map((label, i) => <li key={label}><span>{String(i + 1).padStart(2, '0')}</span>{label}</li>)}</ol></figure>;
      if (data.scope === 'full') {
        if (full || selected === topic.id || ancestors(selected).some(owner => owner.id === topic.id)) mountedMedia.current.add(block.viewerId);
        if (!mountedMedia.current.has(block.viewerId)) return <div key={block.viewerId} className="sm-viewer-block" data-map-page={block.type === 'page' ? 'true' : undefined}><div className="sm-native-viewer" /></div>;
      }
      if (block.viewerId === 'source-root' && !full) return <details key={block.viewerId} className="sm-native-disclosure"><summary>Read _executeCall() code</summary><NativeViewer block={block} beat={currentBeat} current={sourcePosition.panelIndex === topic.panelIndex} full={full} /></details>;
      return <NativeViewer key={block.viewerId} block={block} beat={currentBeat} current={sourcePosition.panelIndex === topic.panelIndex} full={full} hidden={full && fullscreen && activeMedia !== block.viewerId} />;
    })}</div>;
  }
  function Node({ topic, compact = false, disclosure = true, full = false, summaryOnly = false, modal = false }: { topic: Topic; compact?: boolean; disclosure?: boolean; full?: boolean; summaryOnly?: boolean; modal?: boolean }) {
    const active = selected === topic.id;
    const number = numberFor(topic.id), owner = parent(topic.id), siblings = owner?.children ?? [topic.id], index = siblings.indexOf(topic.id);
    const previous = byId.get(siblings[index - 1]), next = byId.get(siblings[index + 1]);
    const readable = variant !== 'A' || !overview || modal;
    const peerControls = readable && (active || modal);
    const navigate = (destination: Topic) => {
      choose(destination, { focus: !modal });
      if (modal) { focusDestination.current = true; setFocused(destination.id); }
    };
    return <article className={`sm-node ${active ? 'is-current' : ''} ${compact ? 'is-small' : ''}`} aria-label={`Card ${number}: ${topic.label}`} data-map-node={full ? undefined : topic.id} data-map-detail={full && !modal ? topic.id : undefined} data-card-kind={kindOf(topic)}>
      <header className="sm-card-head"><div><div className="sm-card-meta"><span className="sm-map-order" aria-label={`Card ${number}`}>{owner && readable ? <button type="button" className="sm-parent-card" aria-label={`Parent card ${numberFor(owner.id)}: ${owner.label}`} title={`Back to ${numberFor(owner.id)} · ${owner.label}`} onClick={() => navigate(owner)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>{number}</button> : number}</span><span className="sm-card-type">{kindOf(topic)}</span>
        {owner && <span className="sm-peer-dots" role="img" aria-label={`Card ${index + 1} of ${siblings.length} siblings`} title={`${index + 1} of ${siblings.length} · ${owner.label}`}>{siblings.map((id, i) => <i key={id} className={i === index ? 'is-position' : ''} />)}</span>}
        {owner && !summaryOnly && <div className="sm-sibling-cards" role="group" aria-label={`Card ${number} sibling navigation`} hidden={!peerControls}>
          <button type="button" disabled={!previous} aria-label={previous ? `Previous sibling ${numberFor(previous.id)}: ${previous.label}` : 'No previous sibling'} title={previous ? `${previous.label} (↑)` : 'First sibling'} onClick={() => previous && navigate(previous)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
          <button type="button" disabled={!next} aria-label={next ? `Next sibling ${numberFor(next.id)}: ${next.label}` : 'No next sibling'} title={next ? `${next.label} (↓)` : 'Last sibling'} onClick={() => next && navigate(next)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>
        </div>}
        </div>
        {modal ? <h3 tabIndex={-1}>{topic.label}</h3> : <h3 className="sm-card-heading"><button type="button" className="sm-select" data-map-focus={topic.id} tabIndex={active && !(variant === 'C' && summaryOnly) ? 0 : -1} aria-current={active ? 'location' : undefined} aria-label={`Read ${topic.label}`} aria-keyshortcuts={hasMedia(topic) ? 'F' : undefined} onClick={() => choose(topic)} onFocus={event => { if (!focusByMap.current && event.currentTarget.matches(':focus-visible')) revealInMap(event.currentTarget.closest('[data-map-node],[data-map-detail]'), false, false, true); }}><strong>{topic.label}</strong></button></h3>}
        {topic.symbol && <code className="sm-symbol">{topic.symbol}</code>}</div>
      </header>
      {!summaryOnly && (!compact || active) && Content({ topic, full })}
      {!full && !summaryOnly && <footer className="sm-card-actions"><span>{visited.has(topic.id) ? '✓ Visited' : 'Not visited'}</span><button type="button" onClick={() => openCard(topic)} aria-label={`Focus ${topic.label}`}>Focus card ↗</button></footer>}
      {!!topic.children.length && (disclosure || modal || variant === 'C') && <button type="button" className={`sm-expand sm-child-cards ${readable ? '' : 'is-map-count'}`} disabled={!readable} aria-label={modal || variant === 'C' ? `Enter ${topic.children.length} children of card ${number}: ${topic.label}` : `${expanded.has(topic.id) ? 'Collapse' : 'Expand'} ${topic.label}`} aria-expanded={modal || variant === 'C' ? undefined : expanded.has(topic.id)} title={`${topic.children.length} child cards · ${modal || variant === 'C' ? 'Go deeper' : expanded.has(topic.id) ? 'Collapse branch' : 'Expand branch'}`} onClick={() => modal || variant === 'C' ? navigate(get(topic.children[0])) : toggle(topic.id)}><span>{topic.children.length}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={modal || variant === 'C' ? 'm9 5 7 7-7 7' : expanded.has(topic.id) ? 'M5 12h14' : 'M5 12h14M12 5v14'}/></svg></button>}
      {!topic.children.length && <span className="ds-sr-only sm-no-children">No child cards</span>}
    </article>;
  }

  function VariantA() {
    return <div className="sm-canvas-world">{data.nodes.map(topic => {
      const visible = ancestors(topic.id).every(owner => expanded.has(owner.id));
      const reading = !overview && (selected === topic.id || (topic.id !== 'root' && ancestors(selected).some(owner => owner.id === topic.id)));
      const kind = topic.id === 'root' ? 'root' : parent(topic.id)?.id === 'root' ? 'chapter' : !!topic.children.length ? 'question' : 'detail';
      return <div key={topic.id} className={`sm-canvas-item sm-canvas-${kind}`} data-canvas-node={topic.id} data-canvas-open={visible} data-reading={reading}>
        {Node({ topic })}
      </div>;
    })}</div>;
  }
  function Tree({ id }: { id: string }) {
    const n = get(id);
    return <li key={id}>{Node({ topic: n })}{!!n.children.length && <BranchPresence as="ul" open={expanded.has(id)} branchId={id}>{n.children.map(child => Tree({ id: child }))}</BranchPresence>}</li>;
  }
  function VariantB() { return <div className="sm-tree"><ul>{Tree({ id: 'root' })}</ul></div>; }
  function VariantC() {
    const owner = parent(node.id);
    const branch = owner && !owner.structural && owner.stepId === node.stepId ? owner : node;
    return <div className="sm-columns">
      <div className="sm-chapter-column"><button type="button" className="sm-root-link" onClick={() => choose(get('root'))}>← {data.rootLabel ?? 'The whole call'}</button>
        <div className="sm-section-label">Story branches</div>{get('root').children.map(id => <div key={id}>{Node({ topic: get(id), disclosure: false, summaryOnly: true })}</div>)}</div>
      <div className="sm-detail-column">{Node({ topic: node, full: true, disclosure: false })}
        {branch.id !== 'root' && !!branch.children.length && <nav className="sm-child-list" aria-label={`Explore ${branch.label}`}><div className="sm-section-label">Go deeper</div>
          {branch.children.map(id => <div key={id}>{Node({ topic: get(id), disclosure: false, summaryOnly: true })}</div>)}</nav>}
      </div>
    </div>;
  }

  return <>
    {createPortal(<div className="sm-story-title">{data.title}</div>, document.querySelector('.ds-reviewchrome-main')!)}
    {createPortal(<dialog ref={dialog} className={`sm-focus-dialog ${fullscreen ? 'is-fullscreen' : ''} ${fullscreen && focused && hasMedia(get(focused)) ? 'has-fullscreen-media' : ''}`} aria-labelledby="sm-focus-title" onCancel={event => { event.preventDefault(); if (fullscreen) exitFullscreen(); else dismissCard(); }} onKeyDown={event => event.stopPropagation()}><div className="sm-focus-head"><h2 id="sm-focus-title" tabIndex={-1}>{focused ? `${numberFor(focused)} ${get(focused).label}` : 'Read card'}</h2><div className="sm-focus-actions">
      <button type="button" disabled={transport.disabled} aria-label={transport.accessibleLabel} onClick={() => document.querySelector<HTMLButtonElement>('[data-readaloud]')?.click()}>{transport.label}</button>
      {transport.canStop && <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('[data-aloud-stop]')?.click()}>Stop narration</button>}
      {focused && (fullscreen || hasMedia(get(focused))) && <button type="button" className="sm-fullscreen-toggle" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} aria-keyshortcuts="F" title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={() => enterFullscreen(get(focused))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={fullscreen ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'}/></svg></button>}
      <button type="button" autoFocus onClick={dismissCard}>Close card</button></div></div>{focused && Node({ topic: get(focused), full: true, disclosure: false, modal: true })}</dialog>, document.body)}
    <header className="sm-command-bar">
      <nav className="sm-breadcrumbs" aria-label="Map location">{path.map((item, index) => <span key={item.id}>{index > 0 && <span aria-hidden="true">/</span>}<button type="button" onClick={() => choose(item)} aria-current={item.id === selected ? 'location' : undefined}>{item.id === 'root' ? data.rootLabel ?? 'Gateway' : item.label}</button></span>)}</nav>
      <div className="sm-map-actions">
        {variant === 'A' && <><button type="button" aria-label="Fit whole map" title="Whole map" onClick={() => { prepareReflow(); setOverview(true); canvas.fit(!keyboardInput.current); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button><button type="button" className="sm-zoom-label" aria-label={`Map zoom ${zoom} percent. Reset to readable size`} onClick={() => overview ? findCurrent() : canvas.resetZoom(selectedRef.current)}>{zoom}%</button></>}
        <button type="button" aria-label="Find current card" title="Center current card" onClick={findCurrent}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg></button>
        <button type="button" className="sm-focus" aria-label="Focus current card" onClick={() => openCard(node)}><span className="sm-focus-label">Focus</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
        <button ref={optionsTrigger} type="button" aria-label="Map options" aria-haspopup="dialog" aria-expanded={optionsOpen} aria-controls={optionsId} popoverTarget={optionsId} title="Map options"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>
      </div>
    </header>
    {createPortal(<div ref={options} id={optionsId} popover="auto" className="sm-options" role="dialog" aria-label="Map options" onToggle={event => setOptionsOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={event => event.stopPropagation()}>
      <div className="sm-options-head"><strong>Map options</strong><button type="button" aria-label="Close map options" onClick={() => options.current?.hidePopover()}>×</button></div>
      <label>Layout<select aria-label="Map layout" value={variant} onChange={event => changeVariant(event.target.value as Variant)}>{(['A', 'B', 'C'] as Variant[]).map(key => <option key={key} value={key}>{variants[key]}</option>)}</select></label>
      {variant === 'A' && <div className="sm-options-zoom"><button type="button" aria-label="Zoom out map" onClick={() => canvas.zoom(1 / 1.2)}>−</button><span>{zoom}%</span><button type="button" aria-label="Zoom in map" onClick={() => canvas.zoom(1.2)}>+</button></div>}
      <label className="sm-check"><input type="checkbox" checked={transcript} onChange={event => setTranscript(event.target.checked)} />Show narration transcript</label>
      <div className="sm-options-reading"><span className="sm-section-label">Reading path · {reading}</span><button type="button" onClick={() => follow(get('root'))}>Follow {data.scope === 'full' ? 'whole tour' : 'gateway'}</button><button type="button" onClick={() => follow(node)}>Follow this branch</button></div>
      <details><summary>Keyboard shortcuts</summary><dl><dt>→ / ←</dt><dd>Enter first detail / return to parent</dd><dt>↑ / ↓</dt><dd>Previous / next sibling</dd><dt>Home</dt><dd>{data.rootLabel ?? 'Gateway'} overview</dd><dt>Enter</dt><dd>Center the current card</dd><dt>F</dt><dd>Full screen for a code or diagram card</dd><dt>Escape</dt><dd>Exit full screen, leave code, or go up one level</dd><dt>Tab</dt><dd>Inspect card controls and source</dd></dl></details>
    </div>, document.body)}
    <nav ref={map} className={`sm-map ${variant === 'A' ? 'sm-canvas' : ''}`} data-map-overview={overview} tabIndex={-1} aria-label={data.scope === 'full' ? 'Full story map' : 'Gateway story map'} aria-describedby="sm-map-key-help" onClick={mapClick}>{variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}</nav>
    {outside && <div className="sm-outside">Reading elsewhere in the story.<button type="button" onClick={() => choose(node)}>Return to this branch</button></div>}
    <span id="sm-map-key-help" className="ds-sr-only">Arrow keys navigate the map. Enter centers the current card. Escape returns from code to the map.</span>
    <span className="ds-sr-only" role="status">{outside || `Reading ${node.label}. ${visited.size} ${plural(visited.size, 'topic')} visited.`}</span>
    {createPortal(<div className="sm-playback-context"><div className="sm-playback-label"><span>{node.label}</span><small>{data.scope === 'full' ? `Step ${sourcePosition.panelIndex}/${payload.steps.length}` : `${reading === 'Gateway' ? 'Gateway' : 'Branch'} · ${sourcePosition.beat + 1} / ${payload.steps[sourcePosition.panelIndex - 1]?.beats.length || 1}`}</small></div><div className="sm-beat-controls" role="group" aria-label="Explanation navigation">
      <button type="button" aria-label="Previous explanation" disabled={!beatNav.previous} onClick={() => document.querySelector<HTMLButtonElement>('.ds-dock-stage [data-beat-dock]:not([hidden]) [data-beat-move="-1"]')?.click()}>←</button>
      <button type="button" aria-label="Next explanation" disabled={!beatNav.next} onClick={() => document.querySelector<HTMLButtonElement>('.ds-dock-stage [data-beat-dock]:not([hidden]) [data-beat-move="1"]')?.click()}>→</button>
    </div></div>, document.querySelector('.ds-dock-transport')!)}

  </>;
}

export async function mountStoryMap(input: ReviewPayload, data: MapData, endpoint?: (block: ViewerBlock) => string) {
  if (!input.steps.length) return;
  await waitFor(() => !!document.querySelector('.ds-filmthread'));
  if (document.querySelector('.sm-prototype')) return;
  payload = input;
  const panels = new Map(data.nodes.flatMap(topic => topic.content.flatMap(block => 'viewerId' in block ? [[block.viewerId, topic.panelIndex] as const] : [])));
  viewerUrl = endpoint ?? (block => '/api/review/step-panel?index=' + panels.get(block.viewerId) + '&page=' + encodeURIComponent(input.pageToken));
  const host = document.createElement('aside'); host.className = 'sm-prototype'; host.setAttribute('aria-label', 'Story map');
  document.querySelector('#ds-view-tour')!.prepend(host);
  document.body.classList.add('sm-prototyping');
  createRoot(host).render(<StoryMap data={data} />);
}
