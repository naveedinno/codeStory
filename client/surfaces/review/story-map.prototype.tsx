// THROWAWAY: compare spatial, hierarchical, and focused navigation on the real review screen.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { ReviewPayload } from '../../../src/payloads';

interface Topic { id: string; stepId: string; panelIndex: number; label: string; symbol: string; beat: number; children: string[]; beats: number }
interface MapData { nodes: Topic[]; commit: string; title: string; path: string[] }
type Variant = 'A' | 'B' | 'C';
const variants: Record<Variant, string> = { A: 'Mind map', B: 'Branch tree', C: 'Focus path' };
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
  const wrap = document.querySelector<HTMLButtonElement>(`[data-step-panel="${topic.panelIndex}"] [data-line-wrap-toggle][aria-pressed="false"]`);
  wrap?.click();
}

function Prototype({ data }: { data: MapData }) {
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const get = (id: string) => byId.get(id)!;
  const parent = (id: string) => data.nodes.find(node => node.children.includes(id));
  const ancestors = (id: string): Topic[] => { const p = parent(id); return p ? [...ancestors(p.id), p] : []; };
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [selected, setSelected] = useState('root');
  const selectedRef = useRef('root');
  const [expanded, setExpanded] = useState(new Set(['root']));
  const [detail, setDetail] = useState(false);
  const [visited, setVisited] = useState(new Set(['root']));
  const [collapsed, setCollapsed] = useState(false);
  const [reading, setReading] = useState('Gateway');
  const [outside, setOutside] = useState('');
  const node = get(selected), path = [...ancestors(selected), node];
  const branch = path.find(item => get('root').children.includes(item.id)) ?? get('route');
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
    document.body.classList.toggle('sm-map-collapsed', collapsed);
  }, [variant, collapsed]);
  useEffect(() => {
    if (!collapsed) requestAnimationFrame(() => revealInMap(document.querySelector<HTMLElement>(`.sm-map [data-map-node="${selected}"]`)));
  }, [selected, variant, detail, collapsed]);
  useEffect(() => {
    document.body.dataset.prototypeReadingPath = data.path.map(id => get(id).panelIndex).join(',');
    void selectSource(get('root'));
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

  function Node({ topic, compact = false, disclosure = true, readable = false }: { topic: Topic; compact?: boolean; disclosure?: boolean; readable?: boolean }) {
    const active = selected === topic.id;
    const explanation = payload.steps[topic.panelIndex - 1]?.beats[topic.beat]?.text.text;
    return <div className={`sm-node ${active ? 'is-current' : ''} ${compact ? 'is-small' : ''}`} data-map-node={topic.id}>
      <button type="button" className="sm-select" aria-current={active ? 'location' : undefined} aria-label={`Read ${topic.label}`} aria-describedby={`sm-symbol-${topic.id}${readable && active && explanation ? ` sm-summary-${topic.id}` : ''}`} onClick={() => choose(topic)}>
        <span className="sm-node-state" aria-label={visited.has(topic.id) ? 'Visited' : 'Not visited'}>{visited.has(topic.id) ? '✓' : '·'}</span>
        <strong>{topic.label}</strong>
        <span className="sm-symbol" id={`sm-symbol-${topic.id}`}>{topic.children.length ? topic.symbol : `Explanation ${topic.beat + 1} of ${topic.beats}`}</span>
        {readable && active && explanation && <span className="sm-card-summary" id={`sm-summary-${topic.id}`}>{explanation}</span>}
      </button>
      {disclosure && !!topic.children.length && <button type="button" className="sm-expand" aria-label={`${expanded.has(topic.id) ? 'Collapse' : 'Expand'} ${topic.label}`} aria-expanded={expanded.has(topic.id)} onClick={() => toggle(topic.id)}>{expanded.has(topic.id) ? '−' : '+'}</button>}
    </div>;
  }

  function VariantA() {
    const world = (id: string): React.ReactNode => {
      const topic = get(id), open = expanded.has(id) && !!topic.children.length;
      return <div className={`sm-world-row ${open ? 'has-children' : ''}`} key={id}>
        <div className={`sm-world-card ${detail && selected === id ? 'is-reading' : ''}`}>{Node({ topic, readable: detail })}</div>
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
    return <div className="sm-columns">
      <div className="sm-chapter-column"><button type="button" className="sm-root-link" onClick={() => choose(get('root'))}>← The whole call</button>
        <div className="sm-section-label">Four questions</div>{get('root').children.map(id => <div key={id}>{Node({ topic: get(id), disclosure: false })}</div>)}</div>
      <div className="sm-detail-column"><div className="sm-section-label">Inside {branch.symbol}</div>
        <h3>{branch.label}</h3>{branch.children.map(id => <div key={id}>{Node({ topic: get(id), compact: true })}</div>)}</div>
    </div>;
  }

  return <>
    <header className="sm-head"><div><span className="sm-kicker">Explore the story</span><h2>Gateway</h2></div>
      <button type="button" className="sm-focus" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Open map' : 'Focus code'}</button></header>
    {!collapsed && <>
      <nav className="sm-breadcrumbs" aria-label="Map location">{path.map((item, index) => <span key={item.id}>{index > 0 && <span aria-hidden="true">/</span>}<button type="button" onClick={() => choose(item)} aria-current={item.id === selected ? 'location' : undefined}>{item.id === 'root' ? '_executeCall()' : item.label}</button></span>)}</nav>
      <nav className="sm-map" aria-label="Gateway story map">{variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}</nav>
      {outside && <div className="sm-outside">Reading elsewhere in the story.<button type="button" onClick={() => choose(node)}>Return to this branch</button></div>}
      <footer className="sm-map-footer"><div><span className="sm-kicker">Guided reading</span><span>{outside ? 'Current source' : reading}</span></div>
        <button type="button" onClick={() => scope(node)}>{selected === 'root' ? 'Follow gateway' : 'Follow this branch'} <span aria-hidden="true">→</span></button>
        <p>{outside ? 'Return to the map to follow a branch.' : 'Play follows this path. Choose any node to explore.'}</p>
      </footer>
    </>}
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
  const main = document.querySelector('.ds-main')!; main.before(host);
  document.body.classList.add('sm-prototyping');
  createRoot(host).render(<Prototype data={data} />);
}
void boot();
