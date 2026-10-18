// Knowledge Galaxy (Map page) — one star per file from /api/map3d.
// Spec: SomTor-oracle ψ/lab/studio-a2/3D-PLAN.md §1 · issue tordash/ui-studio-oracle-studio#1
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getMap, getMap3d, getStats, search } from '../api/oracle';
import type { MapDocument, Stats } from '../api/oracle';
import {
  computeStates, formatDay, galaxyTypeColor, matchLocal, matchSearchResults, prepareGalaxy,
} from '../lib/galaxy/mapping';
import { buildClusters } from '../lib/galaxy/clusters';
import { GalaxyView } from '../components/galaxy/GalaxyView';
import { GalaxyFallback } from '../components/galaxy/GalaxyFallback';
import { DocSheet } from '../components/galaxy/DocSheet';
import { GALAXY_FONT_STACK, webglAvailable } from '../components/galaxy/engine';
import type { GalaxyEngine } from '../components/galaxy/engine';

const DEFAULT_ENGINE = 'bge-m3';
const SEARCH_LIMIT = 100;

interface PcaInfo { variance_explained?: number[]; n_vectors?: number; computed_at?: string }

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The global nav wraps (~64 px desktop, ~124 px at 390), so the page measures where it starts
// instead of assuming a header height, and fills the rest of the dynamic viewport (iOS bars).
function GalaxyShell({ className, style, children }: { className: string; style: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      el.style.height = `calc(100vh - ${top}px)`; // fallback where dvh is unsupported (invalid value is ignored)
      el.style.height = `calc(100dvh - ${top}px)`;
    };
    update();
    const ro = new ResizeObserver(update);
    const header = document.querySelector('header');
    if (header) ro.observe(header);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  // height is owned by the layout effect (runs before paint), never by React's style prop
  return <div ref={ref} className={className} style={style}>{children}</div>;
}

const glass = { background: 'rgba(9, 10, 22, 0.66)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } as const;

export function Map() {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const [webgl] = useState(() => webglAvailable());
  const [contextLost, setContextLost] = useState(false);

  const [engineKey, setEngineKey] = useState(DEFAULT_ENGINE);
  const [docs, setDocs] = useState<MapDocument[] | null>(null);
  const [pca, setPca] = useState<PcaInfo | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const [project, setProject] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Set<number> | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const [hover, setHover] = useState<{ idx: number; touch: boolean }>({ idx: -1, touch: false });
  const [selected, setSelected] = useState(-1);

  const engineRef = useRef<GalaxyEngine | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  // ── data ──
  useEffect(() => {
    let cancelled = false;
    getMap3d(engineKey)
      .catch(() => getMap().then(d => ({ ...d, pca_info: undefined })))
      .then(d => {
        if (cancelled) return;
        setDocs(d.documents ?? []);
        setPca((d.pca_info as PcaInfo | undefined) ?? null);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setSwitching(false); });
    return () => { cancelled = true; };
  }, [engineKey]);

  useEffect(() => {
    getStats().then(setStats).catch(() => setStats(null));
  }, []);

  const data = useMemo(() => (docs ? prepareGalaxy(docs) : null), [docs]);
  const clusters = useMemo(() => (data ? buildClusters(data.docs, data.positions) : []), [data]);
  const states = useMemo(
    () => (data ? computeStates(data, { hiddenTypes, matches, project }) : new Float32Array(0)),
    [data, hiddenTypes, matches, project],
  );
  const projects = useMemo(() => {
    if (!data) return [] as [string, number][];
    const m: Record<string, number> = {};
    for (const d of data.docs) { const k = d.project ?? ''; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);

  // ── engine callbacks ──
  const onHover = useCallback((idx: number, touch: boolean) => setHover({ idx, touch }), []);
  const onHoverAnchor = useCallback((x: number, y: number, visible: boolean) => {
    const el = tooltipRef.current;
    if (!el) return;
    const parent = el.parentElement;
    const pw = parent?.clientWidth ?? 0;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(12, Math.min(pw - w - 12, x - w / 2));
    const above = y - h - 22;
    const top = above < 64 ? y + 24 : above;
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    el.style.opacity = visible ? '1' : '0';
  }, []);
  const onOpen = useCallback((idx: number) => setSelected(idx), []);
  const onContextLost = useCallback(() => setContextLost(true), []);

  // after the tooltip re-renders with new content (new size), re-anchor it to the star
  useLayoutEffect(() => {
    if (hover.idx >= 0) engineRef.current?.refreshHoverAnchor();
  }, [hover.idx]);

  // ── search ──
  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!data) return;
    if (!q) { clearSearch(); return; }
    const seq = ++searchSeq.current;
    // touch: drop the keyboard so the result pill and the pulse are visible
    if (window.matchMedia('(pointer: coarse)').matches && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const local = matchLocal(data, q);
    setMatches(local);
    setSearchNote(null);
    setSearching(true);
    try {
      const res = await search(q, 'all', SEARCH_LIMIT, 'hybrid');
      if (seq !== searchSeq.current) return;
      const api = matchSearchResults(data, res.results ?? []);
      const union = new Set([...local, ...api]);
      setMatches(union);
      setSearchNote(`${api.size} semantic · ${local.size} title/path/concept`);
      if (union.size > 0) engineRef.current?.frame(union);
    } catch {
      if (seq !== searchSeq.current) return;
      setSearchNote(`${local.size} title/path/concept · semantic search unavailable`);
      if (local.size > 0) engineRef.current?.frame(local);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  function clearSearch() {
    searchSeq.current++;
    setQuery('');
    setMatches(null);
    setSearchNote(null);
    setSearching(false);
    engineRef.current?.goHome();
  }

  function toggleType(t: string) {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  function switchEngine(key: string) {
    if (key === engineKey || switching) return;
    setSwitching(true);
    setSelected(-1);
    setMatches(null);
    setEngineKey(key);
  }

  // ── states ──
  if (error && !data) {
    return (
      <GalaxyShell className="flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: '#05060f' }}>
        <div className="text-base text-[#f87171]">Couldn’t load the galaxy</div>
        <div className="text-[13px] text-text-muted max-w-[420px]">{error}</div>
      </GalaxyShell>
    );
  }

  if (!data) {
    return (
      <GalaxyShell className="relative flex flex-col items-center justify-center gap-3 overflow-hidden" style={{ background: SPACE_BG }}>
        <div className="w-10 h-10 rounded-full border border-white/10 border-t-[#8ab4ff] motion-safe:animate-spin" />
        <div className="text-[15px] text-text-primary tracking-wide">Charting the galaxy…</div>
        <div className="text-[12px] text-text-muted">Projecting embeddings from {engineKey}</div>
      </GalaxyShell>
    );
  }

  const types = Object.entries(data.typeCounts).sort((a, b) => b[1] - a[1]);
  const engines = (stats?.vectors ?? []).filter(v => v.enabled && !v.retired);
  const useFallback = !webgl || contextLost;
  const hovered = hover.idx >= 0 && hover.idx < data.count ? hover.idx : -1;
  const variance = pca?.variance_explained?.map(v => Math.round(v * 100));

  return (
    <GalaxyShell className="flex overflow-hidden" style={{ background: SPACE_BG }}>
      <div className="flex-1 relative overflow-hidden min-w-0 min-h-0">
        {data.count === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-[22px] font-semibold text-text-primary">No stars yet</div>
            <div className="text-sm text-text-muted leading-relaxed">The galaxy needs vector embeddings. Run a vector index to populate it.</div>
          </div>
        ) : useFallback ? (
          <GalaxyFallback data={data} clusters={clusters} reason={webgl ? 'context-lost' : 'no-webgl'} matches={matches} onOpen={setSelected} />
        ) : (
          <GalaxyView
            className="absolute inset-0"
            data={data}
            clusters={clusters}
            states={states}
            selected={selected}
            reducedMotion={reducedMotion}
            engineRef={engineRef}
            onHover={onHover}
            onHoverAnchor={onHoverAnchor}
            onOpen={onOpen}
            onContextLost={onContextLost}
          />
        )}

        {/* tooltip — positioned imperatively by the engine (no React render per frame) */}
        {!useFallback && (
          <div
            ref={tooltipRef}
            role="status"
            aria-live="polite"
            className="galaxy-tooltip pointer-events-none absolute left-0 top-0 z-20 max-w-[min(300px,calc(100%-24px))] rounded-xl border border-white/[0.09] px-3.5 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
            style={{ ...glass, opacity: 0, display: hovered >= 0 ? 'block' : 'none', fontFamily: GALAXY_FONT_STACK }}
          >
            {hovered >= 0 && (
              <>
                <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: galaxyTypeColor(data.docs[hovered].type) }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: galaxyTypeColor(data.docs[hovered].type) }} />
                  {data.docs[hovered].type}
                </div>
                <div className="mt-1 text-[14px] leading-snug font-semibold text-text-primary line-clamp-2 break-words">{data.titles[hovered]}</div>
                <div className="mt-1 text-[12px] text-text-muted tabular-nums">
                  {data.dateSources[hovered] === 'indexed' ? `indexed ${formatDay(data.dates[hovered])}` : formatDay(data.dates[hovered])}
                  <span className="text-text-muted/70"> · {hover.touch ? 'tap again to open' : 'click to open'}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* search */}
        <form onSubmit={runSearch} className="absolute top-3 sm:top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 w-[min(420px,calc(100%-24px))]" role="search">
          <div className="relative flex-1 min-w-0">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search — matching stars pulse"
              aria-label="Search the galaxy"
              enterKeyHint="search"
              className="w-full pl-4 pr-11 py-2.5 rounded-xl text-[14px] text-text-primary border border-white/[0.09] outline-none transition-colors duration-200 focus:border-[#8ab4ff]/60 placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
              style={glass}
            />
            <button
              type="submit"
              aria-label="Run search"
              title="Search"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#8ab4ff]/60"
            >
              {searching
                ? <span className="w-2 h-2 rounded-full bg-[#8ab4ff] animate-search-pulse" />
                : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                  </svg>
                )}
            </button>
          </div>
          {(query || matches) && (
            <button type="button" onClick={clearSearch} className="shrink-0 px-3 py-2.5 rounded-xl text-[12px] text-text-secondary border border-white/[0.09] transition-colors duration-200 hover:text-text-primary hover:border-white/20" style={glass}>
              Clear
            </button>
          )}
        </form>
        {matches && (
          <div className="absolute top-[58px] sm:top-[64px] left-1/2 -translate-x-1/2 z-10 text-[11.5px] text-text-secondary px-3 py-1 rounded-full border border-white/[0.07] whitespace-nowrap" style={glass}>
            <span className="text-text-primary font-semibold tabular-nums">{matches.size.toLocaleString()}</span> matching stars{searchNote ? ` · ${searchNote}` : ''}
          </div>
        )}

        {/* legend — colour / size / brightness, each tied to its API field */}
        {/* phones: a compact chip that expands, so the panel never covers the core of the galaxy */}
        {!legendOpen && (
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            aria-expanded={false}
            aria-controls="galaxy-legend"
            className="sm:hidden absolute bottom-3 left-3 z-10 flex items-center gap-2 px-3 py-2 rounded-full border border-white/[0.08] text-[12px] text-text-secondary"
            style={glass}
          >
            <span className="flex -space-x-0.5">
              {types.slice(0, 5).map(([t]) => (
                <span key={t} className="w-2 h-2 rounded-full" style={{ background: galaxyTypeColor(t), opacity: hiddenTypes.has(t) ? 0.35 : 1 }} />
              ))}
            </span>
            <span className="text-text-primary">Legend</span>
            <span className="tabular-nums text-text-muted">{hiddenTypes.size ? `${hiddenTypes.size} hidden` : `${types.length} types`}</span>
          </button>
        )}
        <div
          id="galaxy-legend"
          className={`${legendOpen ? 'block' : 'hidden'} sm:block absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-10 max-w-[calc(100%-24px)] sm:max-w-[340px] max-h-[45%] sm:max-h-[calc(100%-32px)] overflow-y-auto overscroll-contain rounded-xl border border-white/[0.08] px-3 py-2.5 text-[11.5px] text-text-secondary`}
          style={glass}
        >
          <div className="sm:hidden flex items-center justify-between mb-1.5">
            <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-text-muted">Legend</span>
            <button type="button" onClick={() => setLegendOpen(false)} aria-expanded={true} aria-controls="galaxy-legend" className="px-2 py-1 -mr-1 rounded-md text-[12px] text-text-secondary hover:text-text-primary">
              Hide
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {types.map(([t, n]) => {
              const on = !hiddenTypes.has(t);
              const c = galaxyTypeColor(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-35'}`}
                  style={{ background: on ? `${c}14` : 'transparent' }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: c, boxShadow: on ? `0 0 8px ${c}` : 'none' }} />
                  <span className="text-text-primary">{t}</span>
                  <span className="tabular-nums text-text-muted">{n.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 leading-snug">
            <span className="text-text-muted">colour</span><span>type{types.length === 1 ? ' (one type in this index)' : ''}</span>
            <span className="text-text-muted">brightness</span><span>recency rank · path date, else index time; dim = undated</span>
            <span className="text-text-muted">size</span><span>{data.hasChunks ? 'chunk count' : 'uniform — API has no chunk count yet'}</span>
          </div>
        </div>

        {/* camera controls */}
        {!useFallback && data.count > 0 && (
          <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1.5">
            {[
              { label: '+', title: 'Zoom in', fn: () => engineRef.current?.zoomBy(0.72) },
              { label: '−', title: 'Zoom out', fn: () => engineRef.current?.zoomBy(1.4) },
              { label: '⌂', title: 'Reset view', fn: () => engineRef.current?.goHome() },
            ].map(b => (
              <button
                key={b.title}
                type="button"
                onClick={b.fn}
                title={b.title}
                aria-label={b.title}
                className="w-10 h-10 rounded-xl text-text-primary text-lg flex items-center justify-center border border-white/[0.09] transition-colors duration-200 hover:border-[#8ab4ff]/60 hover:text-[#cfe0ff]"
                style={glass}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* sidebar (desktop) */}
      <aside className="hidden md:flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] p-6 overflow-hidden" style={{ background: 'rgba(8, 9, 20, 0.72)' }}>
        <h1 className="text-[20px] font-semibold text-text-primary tracking-[-0.01em]">Knowledge Galaxy</h1>
        <span className="mt-1 text-[11px] font-mono text-text-muted">
          {engineKey} · PCA{variance ? ` ${variance.join(' / ')}%` : ''}
        </span>
        <div className="mt-5 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto pr-1">
          <SideStat value={data.count} label="stars · one per file" />
          {stats?.total ? <SideStat value={stats.total} label="docs in the index" /> : null}
          <div className="grid grid-cols-3 gap-2">
            <MiniStat value={data.dateSourceCounts.path} label="path date" />
            <MiniStat value={data.dateSourceCounts.indexed} label="indexed" />
            <MiniStat value={data.dateSourceCounts.undated} label="undated" />
          </div>
          {data.dateRange && (
            <div className="text-[11.5px] text-text-muted">
              {formatDay(data.dateRange.min)} → {formatDay(data.dateRange.max)}
            </div>
          )}

          {clusters.length > 0 && (
            <>
              <Divider label={`Clusters · ${clusters.length}`} />
              <div className="flex flex-col gap-0.5">
                {clusters.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-text-primary" style={{ fontFamily: GALAXY_FONT_STACK }}>
                      <span className="text-text-muted">{c.kind === 'folder' ? '▢ ' : '● '}</span>{c.label}
                    </span>
                    <span className="tabular-nums text-text-muted">{c.size.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10.5px] text-text-muted leading-snug">● top concept of members · ▢ source folder (members carry no concepts)</div>
            </>
          )}

          {engines.length > 1 && (
            <>
              <Divider label="Embedding engine" />
              <div className="flex flex-col gap-1">
                {engines.map(v => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => switchEngine(v.key)}
                    disabled={switching}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-left text-[12px] transition-colors duration-150 ${v.key === engineKey ? 'border-[#8ab4ff]/40 bg-[#8ab4ff]/[0.07] text-text-primary' : 'border-white/[0.06] text-text-secondary hover:border-white/[0.14]'}`}
                  >
                    <span className="font-medium">{v.key}</span>
                    <span className="tabular-nums text-text-muted">{switching && v.key === engineKey ? '…' : v.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {projects.length > 1 && (
            <>
              <Divider label="Project" />
              <div className="flex flex-col gap-0.5">
                {projects.map(([p, n]) => {
                  const on = project === p;
                  return (
                    <button
                      key={p || '(none)'}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setProject(on ? null : p)}
                      className={`flex items-center justify-between gap-2 px-1.5 py-1 rounded-md text-left text-[12px] transition-colors duration-150 ${on ? 'bg-[#8ab4ff]/[0.1] text-text-primary' : 'text-text-secondary hover:bg-white/[0.04]'}`}
                    >
                      <span className="truncate">{p ? p.split('/').slice(-1)[0] : '(no project)'}</span>
                      <span className="tabular-nums text-text-muted">{n.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="mt-5 text-[11px] text-text-muted leading-relaxed">
          Drag to orbit · scroll or pinch to zoom · hover a star, click to open.
          {reducedMotion ? ' Reduced motion: static scene.' : ''}
        </div>
      </aside>

      {selected >= 0 && selected < data.count && (
        <DocSheet data={data} idx={selected} reducedMotion={reducedMotion} onClose={() => setSelected(-1)} />
      )}
    </GalaxyShell>
  );
}

const SPACE_BG =
  'radial-gradient(1100px 760px at 62% 38%, rgba(58, 66, 150, 0.22), transparent 62%),' +
  'radial-gradient(800px 640px at 18% 82%, rgba(120, 64, 150, 0.12), transparent 60%),' +
  'linear-gradient(180deg, #05060f 0%, #03030a 100%)';

function SideStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">{value.toLocaleString()}</span>
      <span className="text-[12px] text-text-muted">{label}</span>
    </div>
  );
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
      <span className="text-[14px] font-semibold text-text-primary tabular-nums">{value.toLocaleString()}</span>
      <span className="text-[10.5px] text-text-muted">{label}</span>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">{label}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}
