// branch presence, FLIP and connector drawing adapted from core/docs/site/assets/map.js.
const BRANCH_EASE = 'cubic-bezier(.22,.8,.22,1)';
// Slow the map's motion by 20%, including the cleanup that follows it.
export const mapMotionMs = (milliseconds: number) => milliseconds / .8;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
type Box = { left: number; top: number; width: number; height: number };
type Card = Box & { key: string; opacity: string; sx: number; sy: number; exiting: boolean };
type Snapshot = { cards: Map<HTMLElement, Card>; anchor: HTMLElement | null; anchorBox?: Box; layoutChange: boolean };
const branchBoxes = new WeakMap<HTMLElement, { left: number; top: number; width: number; height: number }>();
const bounds = new WeakMap<HTMLElement, { width: number; height: number }>();
export const mapScrollBounds = (map: HTMLElement) => bounds.get(map) ?? { width: map.scrollWidth, height: map.scrollHeight };
export function branchExitStyle(element: HTMLElement | null) {
  const box = element && branchBoxes.get(element);
  return box ? { position: 'absolute' as const, boxSizing: 'border-box' as const, ...box } : undefined;
}
function matrix(element: HTMLElement) { const value = getComputedStyle(element).transform; return new DOMMatrix(value === 'none' ? undefined : value); }
export function mapCardLayoutBox(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect(), css = getComputedStyle(element), m = matrix(element);
  const [ox, oy] = css.transformOrigin.split(' ').map(Number.parseFloat);
  return { left: rect.left - m.e - ox * (1 - m.a), top: rect.top - m.f - oy * (1 - m.d), width: rect.width / m.a, height: rect.height / m.d };
}

export class MapBranchMotion {
  private pending: Snapshot | null = null;
  private slots = new Map<Element, Map<string, Animation>>();
  private frame = 0;
  private holdTimer = 0;
  private extent: HTMLDivElement | null = null;
  private map: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private resize: ResizeObserver | null = null;
  private parents = new Map<string, string>();
  private lastBoxes = new Map<string, Box>();

  constructor(parents: Map<string, string>) { this.parents = parents; }
  private cards(map: HTMLElement) { return [...map.querySelectorAll<HTMLElement>('[data-map-node]')]; }
  private visible(element: HTMLElement) { return element.getClientRects().length > 0; }
  private active(element: HTMLElement) { return this.visible(element) && !element.closest('[data-branch-exiting="true"]'); }
  capture(map: HTMLElement, anchorId: string, layoutChange = false) {
    if (this.pending) { this.pending.layoutChange ||= layoutChange; return; }
    if (!map.querySelector('.sm-world,.sm-tree')) return;
    const cards = new Map<HTMLElement, Card>();
    for (const element of this.cards(map)) {
      if (!this.visible(element)) continue;
      const m = matrix(element), css = getComputedStyle(element), rect = element.getBoundingClientRect();
      cards.set(element, { key: element.dataset.mapNode!, left: rect.left, top: rect.top, width: rect.width, height: rect.height, opacity: css.opacity, sx: m.a, sy: m.d, exiting: !!element.closest('[data-branch-exiting="true"]') });
    }
    for (const element of map.querySelectorAll<HTMLElement>('[data-presence-branch]')) {
      if (!this.visible(element) || element.dataset.branchExiting === 'true') continue;
      const css = getComputedStyle(element);
      branchBoxes.set(element, { left: element.offsetLeft - (parseFloat(css.marginLeft) || 0), top: element.offsetTop - (parseFloat(css.marginTop) || 0), width: element.offsetWidth, height: element.offsetHeight });
    }
    const anchor = this.cards(map).find(element => element.dataset.mapNode === anchorId) ?? null;
    this.pending = { cards, anchor, anchorBox: anchor && this.visible(anchor) ? anchor.getBoundingClientRect() : undefined, layoutChange };
    // Keep collapse from clamping native scrolling before its camera can return.
    if (!this.extent) { this.extent = document.createElement('div'); this.extent.className = 'sm-motion-extent'; this.extent.setAttribute('aria-hidden', 'true'); map.append(this.extent); }
    this.extent.style.width = map.scrollWidth + 'px'; this.extent.style.height = map.scrollHeight + 'px';
  }
  private motion(element: HTMLElement | SVGElement, slot: string, from: Keyframe, to: Keyframe, duration: number, delay = 0, done?: () => void) {
    let slots = this.slots.get(element);
    if (!slots) { slots = new Map(); this.slots.set(element, slots); }
    slots.get(slot)?.cancel(); slots.delete(slot);
    Object.assign(element.style, to);
    if (!duration || reduce()) { if (!slots.size) this.slots.delete(element); done?.(); return; }
    const animation = element.animate([from, to], { duration: mapMotionMs(duration), delay: mapMotionMs(delay), fill: 'both', easing: BRANCH_EASE });
    slots.set(slot, animation);
    animation.onfinish = () => { if (slots!.get(slot) !== animation) return; slots!.delete(slot); if (!slots!.size) this.slots.delete(element); animation.cancel(); done?.(); };
  }
  flush(map: HTMLElement): boolean {
    this.map = map;
    const root = map.querySelector<HTMLElement>('.sm-world,.sm-tree');
    if (!root) { this.reset(); return false; }
    if (root !== this.root) {
      this.resize?.disconnect(); this.svg?.remove(); this.root = root;
      map.addEventListener('scroll', this.releaseAfterScroll, { passive: true });
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.classList.add('sm-map-edges'); this.svg.setAttribute('aria-hidden', 'true'); root.prepend(this.svg);
      this.resize = new ResizeObserver(() => { this.updateBounds(); this.draw(); }); this.resize.observe(root);
    }
    this.updateBounds();
    const snapshot = this.pending; this.pending = null;
    if (!snapshot) { this.draw(); return false; }
    const duration = reduce() ? 0 : 440;
    if (snapshot.anchor && snapshot.anchorBox && this.active(snapshot.anchor)) {
      const next = mapCardLayoutBox(snapshot.anchor);
      map.scrollLeft += next.left - snapshot.anchorBox.left; map.scrollTop += next.top - snapshot.anchorBox.top;
    }
    let entering = false;
    const targets = this.cards(map).filter(element => this.visible(element)).map(element => ({ element, box: mapCardLayoutBox(element) }));
    for (const { element, box } of targets) {
      const before = snapshot.cards.get(element), active = this.active(element);
      if (active) {
        const fresh = !before || before.key !== element.dataset.mapNode;
        const css = getComputedStyle(element), [ox, oy] = css.transformOrigin.split(' ').map(Number.parseFloat);
        const vertical = !!element.closest('.sm-tree') || matchMedia('(max-width:760px)').matches;
        const from = fresh ? `translate(${vertical ? '0,-24px' : '-24px,0'}) scale(.94)` : `translate(${before.left - box.left - ox * (1 - before.sx)}px,${before.top - box.top - oy * (1 - before.sy)}px) scale(${before.sx},${before.sy})`;
        const moved = fresh || Math.abs(before.left - box.left) > .5 || Math.abs(before.top - box.top) > .5 || before.opacity !== '1';
        if (moved) {
          entering ||= fresh;
          this.motion(element, 'position', { transform: from, opacity: fresh ? '0' : before.opacity }, { transform: 'none', opacity: '1' }, duration, fresh && duration ? 230 : 0);
        }
      } else if (before && !before.exiting) {
        this.motion(element, 'position', { transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity }, { transform: 'translateX(-18px) scale(.96)', opacity: '0' }, duration ? 220 : 0);
      }
    }
    this.draw(duration > 0);
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => { this.holdTimer = 0; this.updateBounds(); this.releaseExtent(); this.draw(); }, mapMotionMs(duration ? entering ? 670 : 440 : 0));
    this.tick();
    return snapshot.layoutChange;
  }
  private releaseAfterScroll = () => { if (!this.holdTimer) this.releaseExtent(); };
  private releaseExtent() {
    if (!this.extent || !this.map) return;
    // A stopped collapse pan can leave the viewport outside the smaller layout.
    // Keep exactly that visible space until the reader scrolls back, rather than
    // letting removal of the temporary extent clamp them to the old destination.
    const natural = mapScrollBounds(this.map);
    const right = Math.ceil(this.map.scrollLeft + this.map.clientWidth), bottom = Math.ceil(this.map.scrollTop + this.map.clientHeight);
    const holdX = right > natural.width + .5, holdY = bottom > natural.height + .5;
    // Zero-area boxes do not contribute scroll overflow. Keep the other axis
    // nonzero, and sample both coordinates before either write can clamp them.
    this.extent.style.width = (holdX ? right : holdY ? 1 : 0) + 'px';
    this.extent.style.height = (holdY ? bottom : holdX ? 1 : 0) + 'px';
  }
  private updateBounds() {
    if (!this.map || !this.root) return;
    bounds.set(this.map, { width: Math.max(this.map.clientWidth, this.root.offsetLeft + this.root.offsetWidth), height: Math.max(this.map.clientHeight, this.root.offsetTop + this.root.offsetHeight) });
  }
  private draw(animate = false) {
    if (!this.svg || !this.map || !this.root) return;
    const origin = this.root.getBoundingClientRect(), boxes = new Map<string, Box>(), active = new Set<string>();
    const elements = this.cards(this.map);
    for (const element of elements) {
      if (!this.visible(element)) continue;
      const rect = element.getBoundingClientRect(), id = element.dataset.mapNode!;
      boxes.set(id, { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
      if (this.active(element)) active.add(id);
    }
    const vertical = !!this.root.closest('.sm-tree') || this.root.classList.contains('sm-tree') || matchMedia('(max-width:760px)').matches;
    const paths = new Map([...this.svg.querySelectorAll<SVGPathElement>('[data-map-edge]')].map(path => [path.dataset.mapEdge!, path]));
    this.svg.setAttribute('width', String(this.root.offsetWidth)); this.svg.setAttribute('height', String(this.root.offsetHeight));
    for (const [id, parentId] of this.parents) {
      const parent = boxes.get(parentId) ?? this.lastBoxes.get(parentId), child = boxes.get(id) ?? this.lastBoxes.get(id);
      if (!parent || !child) continue;
      const on = active.has(id) && active.has(parentId);
      let path = paths.get(id);
      if (!path && !on) continue;
      const fresh = !path;
      if (!path) { path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.dataset.mapEdge = id; path.setAttribute('pathLength', '1'); this.svg.append(path); }
      const startX = vertical ? parent.left + 8 : parent.left + parent.width, startY = vertical ? parent.top + parent.height : parent.top + 56;
      const endX = child.left, endY = child.top + (vertical ? 40 : 56), midX = vertical ? parent.left + 8 : (startX + endX) / 2;
      path.setAttribute('d', vertical ? `M ${startX} ${startY} L ${midX} ${endY} L ${endX} ${endY}` : `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
      const closed = path.dataset.closed === 'true';
      if (on && (fresh || closed)) {
        const dash = fresh ? '1' : getComputedStyle(path).strokeDashoffset;
        path.style.display = ''; path.dataset.closed = 'false';
        this.motion(path, 'draw', { strokeDashoffset: dash }, { strokeDashoffset: '0' }, animate ? 520 : 0);
      } else if (!on && !closed) {
        path.dataset.closed = 'true';
        this.motion(path, 'draw', { strokeDashoffset: getComputedStyle(path).strokeDashoffset }, { strokeDashoffset: '1' }, animate ? 320 : 0, 0, () => { if (path!.dataset.closed === 'true') path!.style.display = 'none'; });
      }
    }
    for (const [id, box] of boxes) this.lastBoxes.set(id, box);
  }
  private tick() {
    if (this.frame) return;
    const frame = () => { this.frame = 0; this.draw(); if (this.slots.size) this.frame = requestAnimationFrame(frame); };
    this.frame = requestAnimationFrame(frame);
  }
  reset() {
    for (const [element, slots] of this.slots) { slots.forEach(animation => animation.cancel()); if (element instanceof HTMLElement) { element.style.transform = ''; element.style.opacity = ''; } }
    this.slots.clear(); cancelAnimationFrame(this.frame); this.frame = 0; clearTimeout(this.holdTimer); this.holdTimer = 0;
    this.pending = null; this.resize?.disconnect(); this.resize = null; this.svg?.remove(); this.svg = null; this.root = null;
    this.extent?.remove(); this.extent = null; if (this.map) { this.map.removeEventListener('scroll', this.releaseAfterScroll); bounds.delete(this.map); } this.lastBoxes.clear();
  }
}
