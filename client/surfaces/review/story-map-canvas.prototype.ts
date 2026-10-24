// THROWAWAY: the Ivy docs' measured tree, transform camera and reflow, adapted to live CodeStory cards.
type Topic = { id: string; children: string[] };
type Card = { id: string; el: HTMLElement; x: number; y: number; w: number; h: number; treeW: number; treeH: number; childH: number; visible: boolean; children: Card[]; parent?: Card };
type Presented = { x: number; y: number; w: number; h: number; sx: number; sy: number; opacity: string; visible: boolean };
const cameras = new WeakMap<HTMLElement, StoryMapCanvas>();
export const canvasFor = (map: HTMLElement) => cameras.get(map);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const matrix = (element: Element) => { const css = getComputedStyle(element).transform; return new DOMMatrix(css === 'none' ? undefined : css); };
const SVG = 'http://www.w3.org/2000/svg';
function shiftedPath(path: string, dx: number, dy: number) {
  let i = 0;
  return path.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, value => String(Number(value) + (i++ % 2 ? dy : dx)));
}

export class StoryMapCanvas {
  private topics: Topic[];
  private nodes = new Map<string, Card>();
  private map: HTMLElement | null = null;
  private world: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private cam = { x: 0, y: 0, s: 1 };
  private width = 0;
  private height = 0;
  private home = true;
  private target = 'root';
  private pending: { cards: Map<string, Presented>; anchor: string; structural: boolean } | null = null;
  private slots = new Map<Element, Map<string, Animation>>();
  private resize: ResizeObserver | null = null;
  private resizeFrame = 0;
  private drag: { id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private points = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; scale: number } | null = null;
  private swallowClick = false;
  private signature = '';
  private viewWidth = 0;
  private viewHeight = 0;
  private needsFraming = new Set<string>();
  constructor(topics: Topic[]) { this.topics = topics; }

  capture(map: HTMLElement, anchor: string, structural = false) {
    if (!map.querySelector('.sm-canvas-world')) return;
    if (this.pending) { this.pending.structural ||= structural; return; }
    this.interrupt();
    this.pending = { cards: this.presented(), anchor, structural };
  }
  private presented() {
    return new Map([...this.nodes].map(([id, n]) => { const m = matrix(n.el); return [id, { x: n.x + m.e, y: n.y + m.f, w: n.w, h: n.h, sx: m.a, sy: m.d, opacity: getComputedStyle(n.el).opacity, visible: !n.el.hidden }] as const; }));
  }
  private motion(el: HTMLElement | SVGElement, slot: string, from: Keyframe, to: Keyframe, duration: number, delay = 0, done?: () => void) {
    let slots = this.slots.get(el); if (!slots) { slots = new Map(); this.slots.set(el, slots); }
    slots.get(slot)?.cancel(); slots.delete(slot); Object.assign(el.style, to);
    if (!duration || reduced()) { if (!slots.size) this.slots.delete(el); done?.(); return; }
    const animation = el.animate([from, to], { duration, delay, fill: 'both', easing: 'cubic-bezier(.22,.8,.22,1)' }); slots.set(slot, animation);
    animation.onfinish = () => { if (slots!.get(slot) !== animation) return; slots!.delete(slot); if (!slots!.size) this.slots.delete(el); animation.cancel(); done?.(); };
  }
  flush(map: HTMLElement): boolean {
    const world = map.querySelector<HTMLElement>('.sm-canvas-world');
    if (!world) { this.reset(); return false; }
    const first = world !== this.world;
    if (first) {
      this.reset(); this.map = map; this.world = world; cameras.set(map, this);
      this.svg = document.createElementNS(SVG, 'svg'); this.svg.classList.add('sm-canvas-edges'); this.svg.setAttribute('aria-hidden', 'true'); world.prepend(this.svg);
      for (const topic of this.topics) {
        const el = world.querySelector<HTMLElement>(`[data-canvas-node="${topic.id}"]`)!;
        this.nodes.set(topic.id, { id: topic.id, el, x: 0, y: 0, w: 0, h: 0, treeW: 0, treeH: 0, childH: 0, visible: false, children: [] });
      }
      for (const topic of this.topics) { const n = this.nodes.get(topic.id)!; n.children = topic.children.map(id => this.nodes.get(id)!); n.children.forEach(child => { child.parent = n; }); }
      this.wire();
      this.resize = new ResizeObserver(() => {
        cancelAnimationFrame(this.resizeFrame); this.resizeFrame = requestAnimationFrame(() => {
          if (!this.map || !this.world) return;
          if (this.viewWidth === this.map.clientWidth && this.viewHeight === this.map.clientHeight && this.currentSignature() === this.signature) return;
          const wasHome = this.home;
          this.reflow(false);
          if (wasHome) this.fit(false); else if (!document.activeElement?.closest('[data-map-native-viewer]')) this.center(this.nodes.get(this.target), false);
        });
      }); this.resize.observe(map); this.nodes.forEach(n => this.resize!.observe(n.el));
    }
    const pending = this.pending; this.pending = null;
    if (!first && !pending && this.currentSignature() === this.signature) return false;
    this.reflow(!first && !!pending?.structural, pending?.cards, pending?.anchor);
    if (first) this.fit(false);
    return pending?.structural ?? false;
  }
  private currentSignature() { return [...this.nodes.values()].map(n => `${n.el.dataset.canvasOpen}:${n.el.dataset.reading}:${n.el.dataset.canvasOpen === 'true' ? n.el.offsetHeight : 0}`).join(','); }
  private reflow(animate: boolean, before = this.presented(), anchorId = this.target) {
    if (!this.map || !this.world || !this.svg) return;
    this.interrupt();
    const vertical = this.map.clientWidth < 1120, duration = animate && !reduced() ? 440 : 0;
    this.world.dataset.vertical = String(vertical);
    for (const n of this.nodes.values()) {
      n.visible = n.el.dataset.canvasOpen === 'true';
      const reading = n.el.dataset.reading === 'true', kind = n.el.querySelector<HTMLElement>('[data-card-kind]')!.dataset.cardKind;
      const inspection = reading && (kind === 'Code' || kind === 'Code diff');
      n.w = Math.min(reading && kind === 'Code' && n.id !== 'root' ? 920 : reading && kind === 'Code diff' ? 1040 : n.id === 'root' || !n.parent?.parent ? 720 : 460, Math.max(280, this.map.clientWidth - (inspection ? 24 : 48)));
      n.el.style.width = n.w + 'px';
      // Measure the same live card, never a clone of its native source viewer.
      const hidden = n.el.hidden; n.el.hidden = false;
      n.h = n.el.offsetHeight; n.el.hidden = hidden;
      const old = before.get(n.id);
      if (!old?.visible || Math.abs(old.w - n.w) > 1 || Math.abs(old.h - n.h) > 1) this.needsFraming.add(n.id);
    }
    const kids = (n: Card) => n.children.filter(child => child.visible);
    const gapX = (n: Card) => n.id === 'root' ? 180 : 100;
    const gapY = (n: Card) => n.id === 'root' ? 44 : 32;
    const size = (n: Card) => {
      n.children.forEach(size); const children = kids(n);
      n.childH = children.reduce((sum, child) => sum + child.treeH, 0) + Math.max(0, children.length - 1) * gapY(n);
      const childW = Math.max(0, ...children.map(child => child.treeW));
      n.treeW = vertical ? Math.max(n.w, childW) : n.w + (children.length ? gapX(n) + childW : 0);
      n.treeH = vertical ? n.h + (children.length ? 100 + n.childH : 0) : Math.max(n.h, n.childH);
    };
    const place = (n: Card, x: number, top: number) => {
      n.x = x; n.y = vertical ? top : top + Math.max(0, (n.treeH - n.h) / 2);
      let cursor = vertical ? n.y + n.h + 100 : top + Math.max(0, (n.treeH - n.childH) / 2);
      for (const child of kids(n)) { place(child, vertical ? x : x + n.w + gapX(n), cursor); cursor += child.treeH + gapY(n); }
    };
    const root = this.nodes.get('root')!; size(root); place(root, 100, 100);
    this.width = root.treeW + 200; this.height = root.treeH + 200;
    this.viewWidth = this.map.clientWidth; this.viewHeight = this.map.clientHeight;
    const anchor = this.nodes.get(anchorId), oldAnchor = before.get(anchorId);
    const dx = anchor?.visible && oldAnchor?.visible ? anchor.x - oldAnchor.x : 0, dy = anchor?.visible && oldAnchor?.visible ? anchor.y - oldAnchor.y : 0;
    this.cam.x -= dx * this.cam.s; this.cam.y -= dy * this.cam.s;
    this.world.style.width = this.width + 'px'; this.world.style.height = this.height + 'px';
    for (const n of this.nodes.values()) {
      const old = before.get(n.id), el = n.el;
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.inert = !n.visible; el.setAttribute('aria-hidden', String(!n.visible));
      if (n.visible) {
        el.hidden = false;
        const from = old?.visible ? `translate(${old.x + dx - n.x}px,${old.y + dy - n.y}px) scale(${old.sx},${old.sy})` : `translate(${vertical ? '0,-24px' : '-24px,0'}) scale(.94)`;
        this.motion(el, 'position', { transform: from, opacity: old?.visible ? old.opacity : '0' }, { transform: 'none', opacity: '1' }, duration, !old?.visible && duration ? 230 : 0);
      } else if (old?.visible) {
        this.motion(el, 'position', { transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }, { transform: 'translateX(-18px) scale(.96)', opacity: '0' }, duration ? 220 : 0, 0, () => { if (!n.visible) el.hidden = true; });
      } else el.hidden = true;
    }
    this.svg.setAttribute('width', String(this.width)); this.svg.setAttribute('height', String(this.height));
    const paths = new Map([...this.svg.querySelectorAll<SVGPathElement>('path')].map(path => [path.dataset.mapEdge!, path]));
    for (const n of this.nodes.values()) {
      if (!n.parent) continue; const p = n.parent, on = n.visible && p.visible;
      let path = paths.get(n.id); if (!path && !on) continue;
      const fresh = !path;
      if (!path) { path = document.createElementNS(SVG, 'path'); path.dataset.mapEdge = n.id; path.dataset.rootEdge = String(p.id === 'root'); path.setAttribute('pathLength', '1'); this.svg.append(path); }
      const closed = path.dataset.closed === 'true';
      if (on) {
        const x = p.x + p.w, y = p.y + p.h / 2, sy = n.y + n.h / 2, stem = x + gapX(p) / 2;
        const d = vertical ? `M ${p.x + p.w / 2} ${p.y + p.h} C ${p.x + p.w / 2} ${p.y + p.h + 42}, ${p.x - 24} ${p.y + p.h + 18}, ${p.x - 24} ${p.y + p.h + 60} L ${p.x - 24} ${sy - 24} Q ${p.x - 24} ${sy} ${n.x} ${sy}` : `M ${x} ${y} C ${stem} ${y}, ${stem} ${sy}, ${n.x} ${sy}`;
        const prior = shiftedPath(getComputedStyle(path).getPropertyValue('d'), dx, dy); path.style.display = ''; path.dataset.closed = 'false'; path.setAttribute('d', d);
        this.motion(path, 'shape', { d: fresh ? `path("${d}")` : prior }, { d: `path("${d}")` }, duration);
        this.motion(path, 'draw', { strokeDashoffset: fresh ? '1' : getComputedStyle(path).strokeDashoffset }, { strokeDashoffset: '0' }, (fresh || closed) && duration ? 520 : duration);
      } else if (!closed) {
        path.dataset.closed = 'true';
        this.motion(path, 'draw', { strokeDashoffset: getComputedStyle(path).strokeDashoffset }, { strokeDashoffset: '1' }, duration ? 320 : 0, 0, () => { if (path!.dataset.closed === 'true') path!.style.display = 'none'; });
      }
    }
    // Commit compensation before any subsequent camera flight, as in Ivy reflow().
    this.apply(false); if (duration) this.world.getBoundingClientRect();
    this.signature = this.currentSignature();
  }
  interrupt() {
    if (!this.world) return;
    const m = matrix(this.world); this.cam = { x: m.e, y: m.f, s: m.a || 1 };
    this.world.style.transition = 'none'; this.world.style.transform = `translate(${this.cam.x}px,${this.cam.y}px) scale(${this.cam.s})`;
  }
  private apply(animate: boolean) {
    if (!this.world || !this.map) return;
    this.world.style.transition = animate && !reduced() ? '' : 'none'; this.world.style.transform = `translate(${this.cam.x}px,${this.cam.y}px) scale(${this.cam.s})`;
    this.map.dataset.mapZoom = String(Math.round(this.cam.s * 100)); this.map.dataset.canvasHome = String(this.home);
    this.map.dispatchEvent(new CustomEvent('codestory:map-camera', { bubbles: true, detail: Math.round(this.cam.s * 100) }));
  }
  private clampCamera() {
    if (!this.map) return;
    const w = this.map.clientWidth, h = this.map.clientHeight, px = Math.max(200, w / 2), py = Math.max(200, h / 2);
    this.cam.x = clamp(this.cam.x, Math.min(0, w - this.width * this.cam.s) - px, Math.max(0, w - this.width * this.cam.s) + px);
    this.cam.y = clamp(this.cam.y, Math.min(0, h - this.height * this.cam.s) - py, Math.max(0, h - this.height * this.cam.s) + py);
  }
  fit(animate = true) {
    if (!this.map) return; this.interrupt(); this.home = true;
    const s = Math.min(this.map.clientWidth / (this.width + 160), this.map.clientHeight / (this.height + 160), 1);
    this.cam = { s, x: (this.map.clientWidth - this.width * s) / 2, y: (this.map.clientHeight - this.height * s) / 2 }; this.apply(animate);
  }
  private center(n: Card | undefined, animate: boolean) {
    if (!n || !this.map) return;
    this.home = false; this.target = n.id;
    this.needsFraming.delete(n.id);
    this.cam.s = Math.min(1, (this.map.clientWidth - 32) / n.w);
    this.cam.x = this.map.clientWidth / 2 - (n.x + n.w / 2) * this.cam.s;
    this.cam.y = n.h * this.cam.s <= this.map.clientHeight - 24 ? this.map.clientHeight / 2 - (n.y + n.h / 2) * this.cam.s : 16 - n.y * this.cam.s;
    this.clampCamera(); this.apply(animate);
  }
  reveal(element: HTMLElement, center = false, animate = true, headerOnly = false) {
    if (!this.map) return;
    const n = this.nodes.get(element.dataset.mapNode!); if (!n?.visible) return;
    this.target = n.id;
    this.interrupt();
    if (!animate) this.slots.get(n.el)?.get('position')?.finish();
    const heading = element.querySelector('.sm-card-head')!, h = heading.getBoundingClientRect(), v = this.map.getBoundingClientRect();
    if (!center && headerOnly && !this.needsFraming.has(n.id) && this.cam.s >= .95 && h.top >= v.top + 16 && h.bottom <= v.bottom - 16 && h.left >= v.left + 16 && h.right <= v.right - 16) return;
    this.center(n, animate);
  }
  zoom(factor: number, px?: number, py?: number) {
    if (!this.map) return; this.interrupt(); this.home = false;
    const minScale = Math.min(.15, this.map.clientWidth / (this.width + 160), this.map.clientHeight / (this.height + 160));
    const x = px ?? this.map.clientWidth / 2, y = py ?? this.map.clientHeight / 2, s = clamp(this.cam.s * factor, minScale, 2);
    this.cam = { x: x - (x - this.cam.x) * s / this.cam.s, y: y - (y - this.cam.y) * s / this.cam.s, s }; this.clampCamera(); this.apply(false);
  }
  private owns(target: EventTarget | null) { return target instanceof Element && !!target.closest('[data-map-native-viewer],button,a,input,textarea,select,summary,label,[role="separator"],[contenteditable="true"]'); }
  private wheel = (event: WheelEvent) => {
    this.interrupt(); if (this.owns(event.target)) return;
    event.preventDefault(); this.home = false;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.map!.clientHeight : 1, r = this.map!.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) this.zoom(Math.exp(clamp(-event.deltaY * unit * .002, -.1, .1)), event.clientX - r.left, event.clientY - r.top);
    else { this.cam.x -= event.deltaX * unit; this.cam.y -= event.deltaY * unit; this.clampCamera(); this.apply(false); }
  };
  private down = (event: PointerEvent) => {
    this.swallowClick = false;
    this.interrupt(); if (this.owns(event.target) || event.button !== 0) return;
    if (event.pointerType === 'touch') this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.points.size > 1) { this.drag = null; return; }
    if (event.target instanceof Element && event.target.closest('.sm-prose,.sm-symbol') && event.pointerType !== 'touch') return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
  };
  private move = (event: PointerEvent) => {
    if (!this.map) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) { this.drag = null; this.map.classList.remove('is-panning'); return; }
    if (this.points.has(event.pointerId)) this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.points.size === 2) {
      const [a, b] = [...this.points.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), r = this.map.getBoundingClientRect();
      if (!this.pinch) this.pinch = { distance, scale: this.cam.s };
      this.zoom((this.pinch.scale * distance / this.pinch.distance) / this.cam.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return;
    }
    const drag = this.drag; if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!drag.moved) this.map.setPointerCapture(drag.id); drag.moved = true; this.map.classList.add('is-panning'); this.home = false;
    this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy; this.clampCamera(); this.apply(false);
  };
  private up = (event: PointerEvent) => { this.points.delete(event.pointerId); if (this.points.size < 2) this.pinch = null; if (this.drag?.moved && event.type !== 'pointercancel') this.swallowClick = true; this.drag = null; this.map?.classList.remove('is-panning'); };
  private blur = () => { this.drag = null; this.points.clear(); this.pinch = null; this.swallowClick = false; this.map?.classList.remove('is-panning'); };
  private click = (event: MouseEvent) => { if (this.swallowClick) { this.swallowClick = false; event.preventDefault(); event.stopPropagation(); } };
  private nativeScroll = () => {
    if (!this.map) return;
    const x = this.map.scrollLeft, y = this.map.scrollTop;
    if (!x && !y) return;
    this.interrupt(); this.map.scrollTo(0, 0); this.cam.x -= x; this.cam.y -= y; this.apply(false);
  };
  private focus = (event: FocusEvent) => {
    if (!this.map || !(event.target instanceof HTMLElement)) return;
    // Hidden-overflow canvases must never acquire an independent browser scroll.
    this.nativeScroll();
    if (event.target === this.map) return;
    if (event.target.matches('[data-map-focus]')) return;
    const box = event.target.getBoundingClientRect(), view = this.map.getBoundingClientRect();
    const dx = box.left < view.left + 12 ? view.left + 12 - box.left : box.right > view.right - 12 ? view.right - 12 - box.right : 0;
    const dy = box.top < view.top + 12 ? view.top + 12 - box.top : box.bottom > view.bottom - 12 ? view.bottom - 12 - box.bottom : 0;
    if (dx || dy) { this.interrupt(); this.cam.x += dx; this.cam.y += dy; this.apply(false); }
  };
  private wire() {
    const map = this.map!; map.addEventListener('wheel', this.wheel, { passive: false }); map.addEventListener('pointerdown', this.down); map.addEventListener('pointermove', this.move); window.addEventListener('pointerup', this.up, true); window.addEventListener('pointercancel', this.up, true); window.addEventListener('blur', this.blur); map.addEventListener('click', this.click, true); map.addEventListener('focusin', this.focus); map.addEventListener('scroll', this.nativeScroll);
  }
  reset() {
    if (this.map) { this.map.removeEventListener('wheel', this.wheel); this.map.removeEventListener('pointerdown', this.down); this.map.removeEventListener('pointermove', this.move); window.removeEventListener('pointerup', this.up, true); window.removeEventListener('pointercancel', this.up, true); window.removeEventListener('blur', this.blur); this.map.removeEventListener('click', this.click, true); this.map.removeEventListener('focusin', this.focus); this.map.removeEventListener('scroll', this.nativeScroll); cameras.delete(this.map); }
    this.slots.forEach(slots => slots.forEach(animation => animation.cancel())); this.slots.clear(); this.resize?.disconnect(); this.resize = null; cancelAnimationFrame(this.resizeFrame); this.pending = null; this.nodes.clear(); this.needsFraming.clear(); this.svg?.remove(); this.svg = null; this.world = null; this.map = null; this.home = true; this.signature = ''; this.drag = null; this.points.clear(); this.pinch = null;
  }
}
