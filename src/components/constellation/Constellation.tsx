import { lazy, Suspense, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { FeedPoll } from '../../hooks/useFeedPoll';
import { buildGraph, windowLabel, WINDOW_MS } from '../../lib/constellation/aggregate';
import type { Graph, WindowId } from '../../lib/constellation/aggregate';
import { parseViewState, writeViewState } from '../../lib/constellation/url-state';
import type { ViewState } from '../../lib/constellation/url-state';
import { relTime, summary } from '../../lib/constellation/summary';
import { sheetData } from '../../lib/constellation/sheet';
import { getReducedMotion, subscribeReducedMotion, webglAvailable } from '../../lib/three';
import type { HoverInfo, ViewInput } from './engine';
import { ConstellationHUD } from './ConstellationHUD';
import { ConstellationFallback } from './ConstellationFallback';
import { FilterBar } from './FilterBar';
import { OracleSheet } from './OracleSheet';

// the three.js scene is its own chunk: HUD, fallback numbers and the list paint first
const ConstellationCanvas = lazy(() => import('./ConstellationCanvas'));

interface ConstellationProps {
  /** the page's single poller (shared with the stream list) */
  feed: FeedPoll;
  /** localhost only (C-D4): open the maw terminal for an oracle */
  onTerminal?: (oracleLabel: string) => void;
}

function hoverText(g: Graph, h: HoverInfo): string {
  if (h.kind === 'node') {
    const n = g.nodes.find(x => x.key === h.key);
    return n ? `${n.label} · sent ${n.sent} · recv ${n.recv} · ${relTime(g.now, n.lastTs)}` : '';
  }
  const e = g.edges.find(x => x.key === h.key);
  if (!e) return '';
  const label = (k: string) => g.nodes.find(x => x.key === k)?.label ?? k;
  return `${label(e.a)} ⇄ ${label(e.b)} · ${e.count} (${e.countAB} → · ${e.countBA} ←)`;
}

/** Pulse hero: capability gate → 3D canvas or the 2D fallback; owns window / focus / selection (URL-synced). */
export function Constellation({ feed, onTerminal }: ConstellationProps) {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const [webgl] = useState(() => webglAvailable());
  const [lost, setLost] = useState(false);
  const [view, setViewState] = useState<ViewState>(() => parseViewState(window.location.search));
  const [hideHostNodes, setHideHostNodes] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const setView = useCallback((next: ViewState) => {
    setViewState(next);
    const url = `${window.location.pathname}${writeViewState(window.location.search, next)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  // `now` = the last successful poll: pure, and heat decays with every poll
  const graph = useMemo(() => buildGraph(feed.msgs, WINDOW_MS[view.w], feed.lastOkAt ?? 0), [feed.msgs, view.w, feed.lastOkAt]);
  const label = windowLabel({ count: graph.msgs.length, windowStart: graph.windowStart, oldestHeld: feed.oldestHeld, bufferFull: feed.bufferFull });
  const selected = view.sel && graph.nodes.some(n => n.key === view.sel) ? view.sel : null;
  const engineView = useMemo<ViewInput>(
    () => ({ focus: new Set(view.focus), selected, hideHostNodes }),
    [view.focus, selected, hideHostNodes],
  );

  const onSelect = useCallback((key: string | null) => setView({ ...view, sel: key }), [view, setView]);
  const onWindow = useCallback((w: WindowId) => setView({ ...view, w }), [view, setView]);
  const onLost = useCallback(() => setLost(true), []);
  const onFocus = useCallback((focus: string[]) => setView({ ...view, focus }), [view, setView]);
  const onClose = useCallback(() => setView({ ...view, sel: null }), [view, setView]);
  const onPartner = useCallback((p: string) => { if (selected) setView({ ...view, focus: [selected, p] }); }, [view, selected, setView]);
  const sheet = useMemo(() => (selected ? sheetData(graph, selected) : null), [graph, selected]);

  const fallback = !webgl || lost;

  return (
    <section
      aria-label="Fleet Constellation"
      className="relative w-full overflow-hidden h-[max(340px,56svh)] md:h-[min(64svh,720px)]"
      style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 42%, #0b1024 0%, #04050b 72%)' }}
    >
      {fallback ? (
        <ConstellationFallback graph={graph} reason={webgl ? 'context-lost' : 'no-webgl'} label={label} />
      ) : (
        <Suspense fallback={null}>
          <ConstellationCanvas
            graph={graph}
            view={engineView}
            batch={feed.batch}
            reducedMotion={reducedMotion}
            onContextLost={onLost}
            onSelect={onSelect}
            onHover={setHover}
            className={`absolute inset-0 transition-opacity duration-200 ${sheet ? 'max-md:opacity-40' : ''}`}
          />
        </Suspense>
      )}
      <ConstellationHUD
        lastOkAt={feed.lastOkAt}
        lastErr={feed.lastErr}
        hidden={feed.hidden}
        nextAt={feed.nextAt}
        w={view.w}
        onWindow={onWindow}
        label={label}
        malformed={feed.stats.malformed}
        gap={feed.gap}
      />
      {hover && !fallback && (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-white/10 bg-[#04050b]/85 px-2.5 py-1.5 text-[12px] font-mono text-white/80 whitespace-nowrap backdrop-blur-sm"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hoverText(graph, hover)}
        </div>
      )}
      <FilterBar
        nodes={graph.nodes}
        focus={view.focus}
        onFocus={onFocus}
        hideHostNodes={hideHostNodes}
        onHideHostNodes={setHideHostNodes}
      />
      {/* plain sr-only text: the LiveDot status is the page's one live region (T16 #13) */}
      <p className="sr-only">{summary(graph)}</p>
      {sheet && (
        <OracleSheet
          data={sheet}
          now={graph.now}
          onClose={onClose}
          onPartner={onPartner}
          onTerminal={onTerminal && sheet.kind === 'oracle' ? () => onTerminal(sheet.label) : undefined}
        />
      )}
    </section>
  );
}
