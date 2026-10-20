// Knowledge Web (/graph) — clusters per oracle/project, weighted links from all files,
// drill into a cluster's files, open a file with its Related list.
// Design: tordash/ui-studio-oracle-studio#12 (decisions Q1–Q6 approved by ต่อ).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getMap3d } from '../api/oracle';
import type { MapDocument } from '../api/oracle';
import { cached } from '../lib/cache';
import { formatDay, prepareGalaxy } from '../lib/galaxy/mapping';
import { getReducedMotion, subscribeReducedMotion, webglAvailable, probeGpuTier } from '../lib/three';
import type { GpuTier } from '../lib/three';
import { encodeForWorker } from '../lib/web/encode';
import { createWebCompute } from '../lib/web/client';
import type { WebCompute } from '../lib/web/client';
import { memoCore } from '../lib/web/cache';
import type { PersistFn } from '../lib/web/cache';
import type { CoreResult } from '../lib/web/protocol';
import { buildPageModel } from '../lib/web/model';
import type { IntraResult } from '../lib/web/intra';
import { neighboursOf, sharedConcepts } from '../lib/web/intra';
import { peekModel, webSummary, enteredText, pct } from '../lib/web/peek-model';
import type { PeekAction, PeekRow, PeekState, StarInfo } from '../lib/web/peek-model';
import { parseWebUrl, resolveWebState, webSearch, WebHistory } from '../lib/web/url-state';
import type { WebUrlState } from '../lib/web/url-state';
import { inClusterStars } from '../lib/web/related';
import { keyboardAction, ignoreKeyEvent } from '../lib/web/keyboard';
import { fileRows } from '../lib/web/list-model';
import { starsOf } from '../lib/web/scene';
import type { RelatedRow } from '../lib/web/related';
import type { SnapPoint } from '../lib/ui/sheet-snap';
import { GLASS, SPACE_BG } from '../lib/ui/space';
import { makeWebWorker } from '../workers/make-web-worker';
import { FillViewport } from '../components/FillViewport';
import { WebView } from '../components/web/WebView';
import type { ArmTarget, LabelAnchor, WebEngine, WebEngineData } from '../components/web/engine';
import { ClusterLabels } from '../components/web/ClusterLabels';
import type { LabelLayoutFn } from '../components/web/ClusterLabels';
import { PeekCard } from '../components/web/PeekCard';
import { WebList } from '../components/web/WebList';
import { WebFallback2D, canvas2dAvailable } from '../components/web/WebFallback2D';
import { renderMode } from '../lib/web/project2d';
import { Related } from '../components/web/Related';
import { ViewSwitch } from '../components/web/ViewSwitch';
import { Sheet } from '../components/ui/Sheet';
import { DocSheet } from '../components/galaxy/DocSheet';
import { GALAXY_FONT_STACK } from '../components/galaxy/engine';

const ENGINE_MODEL = 'bge-m3';
const WIDE_QUERY = '(min-width: 640px)';

interface PcaInfo { n_vectors?: number; computed_at?: string }

const persist: PersistFn = (key, ttl, compute) => cached(key, ttl, compute, { tag: 'map3d', store: 'idb' });

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getWide = () => window.matchMedia(WIDE_QUERY).matches;

export function KnowledgeWeb() {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const wide = useSyncExternalStore(subscribeWide, getWide, () => true);
  const [webgl] = useState(() => webglAvailable());
  const [canvas2d] = useState(() => canvas2dAvailable());
  const [tier] = useState<GpuTier>(() => (webgl ? probeGpuTier() : 'low'));
  const [contextLost, setContextLost] = useState(false);

  const [docs, setDocs] = useState<MapDocument[] | null>(null);
  const [pca, setPca] = useState<PcaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [core, setCore] = useState<CoreResult | null>(null);
  const [armed, setArmed] = useState<ArmTarget | null>(null);
  const [peekSnap, setPeekSnap] = useState<SnapPoint>('peek');
  const [intra, setIntra] = useState<{ cluster: number; r: IntraResult } | null>(null);
  const [live, setLive] = useState('');
  const [engineVersion, setEngineVersion] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [listSnap, setListSnap] = useState<SnapPoint>('half');

  const engineRef = useRef<WebEngine | null>(null);
  const computeRef = useRef<WebCompute | null>(null);
  const labelsLayout = useRef<LabelLayoutFn | null>(null);
  const hist = useRef(new WebHistory());
  const navigate = useNavigate();
  const location = useLocation();

  // ── data ──
  useEffect(() => {
    let cancelled = false;
    getMap3d(ENGINE_MODEL)
      .then(d => {
        if (cancelled) return;
        setDocs(d.documents ?? []);
        setPca((d.pca_info as PcaInfo | undefined) ?? null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const data = useMemo(() => (docs ? prepareGalaxy(docs) : null), [docs]);
  const enc = useMemo(() => (docs ? encodeForWorker(docs) : null), [docs]);

  // worker: inter links + layout + colours (session memo → IDB → compute)
  useEffect(() => {
    if (!docs || !enc || docs.length === 0) return;
    const wc = createWebCompute(docs, { makeWorker: makeWebWorker, encoded: enc });
    computeRef.current = wc;
    let cancelled = false;
    memoCore(pca?.computed_at, docs.length, () => wc.core(), persist)
      .then(c => { if (!cancelled) setCore(c); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      cancelled = true;
      wc.dispose();
      if (computeRef.current === wc) computeRef.current = null;
    };
  }, [docs, enc, pca]);

  const model = useMemo(
    () => (docs && data && enc && core ? buildPageModel(docs, data, enc, core, pca?.n_vectors) : null),
    [docs, data, enc, core, pca],
  );
  const engineData = useMemo<WebEngineData | null>(
    () => (model ? { scene: model.scene, edges: model.core.inter.edges, motes: model.motes, moteSource: model.moteCounts.source } : null),
    [model],
  );

  // ── URL state (single source of truth for drill + open file) ──
  const urlState = useMemo(() => parseWebUrl(location.search), [location.search]);
  const resolved = useMemo(() => {
    if (!model || !data) return { cluster: -1, star: -1 };
    return resolveWebState(urlState, model.enc.clusterKeys, id => data.byId.get(id) ?? -1, i => model.enc.clusterOf[i]);
  }, [urlState, model, data]);
  const drilled = resolved.cluster;
  const openStar = resolved.star;

  useEffect(() => { hist.current.onLocation(location.search); }, [location.search]);

  const go = useCallback((s: WebUrlState) => {
    const search = webSearch(s);
    if (search === location.search) return;
    hist.current.push(location.search, search);
    navigate({ search });
  }, [location.search, navigate]);

  const back = useCallback(() => {
    const a = hist.current.back(location.search);
    if (a.kind === 'pop') navigate(-1);
    else navigate({ search: a.search }, { replace: true });
  }, [location.search, navigate]);

  const keyOf = useCallback((c: number) => (model ? model.enc.clusterKeys[c] : null), [model]);
  const enterCluster = useCallback((c: number) => {
    const k = keyOf(c);
    if (k) go({ c: k, f: null });
  }, [go, keyOf]);
  const openFile = useCallback((i: number) => {
    if (!model || !docs) return;
    const c = model.enc.clusterOf[i];
    go({ c: drilled >= 0 ? keyOf(drilled) : keyOf(c), f: docs[i].id });
  }, [model, docs, drilled, go, keyOf]);

  // ── engine sync ──
  const onReady = useCallback(() => setEngineVersion(v => v + 1), []);
  useEffect(() => { engineRef.current?.setDrill(drilled); }, [drilled, engineVersion]);
  useEffect(() => { engineRef.current?.setSelectedStar(openStar); }, [openStar, engineVersion]);
  useEffect(() => { engineRef.current?.setArmed(armed); }, [armed, engineVersion]);
  useEffect(() => { setArmed(null); setPeekSnap('peek'); }, [drilled]);

  // intra links for the drilled cluster (worker, LRU of 4)
  useEffect(() => {
    if (drilled < 0 || !model) return;
    let cancelled = false;
    const label = model.labels[drilled];
    const size = model.stats.sizes[drilled];
    setLive(enteredText(label, size, null));
    computeRef.current?.intra(drilled).then(r => {
      if (cancelled) return;
      setIntra({ cluster: drilled, r });
      engineRef.current?.setIntra(drilled, r);
      setLive(enteredText(label, size, r.edgeI.length));
    }).catch(() => { if (!cancelled) setLive(`Entered ${label}: links unavailable`); });
    return () => { cancelled = true; };
  }, [drilled, model, engineVersion]);

  const intraHere = intra && intra.cluster === drilled ? intra.r : null;

  // list view + keyboard share the canvas's model
  const drilledStars = useMemo(() => (model && drilled >= 0 ? starsOf(model.scene, drilled) : []), [model, drilled]);
  const clusterOrder = useMemo(() => {
    if (!model) return [] as number[];
    const s = model.stats.sizes;
    return [...Array(s.length).keys()].sort((a, b) => s[b] - s[a] || a - b);
  }, [model]);
  const starOrder = useMemo(
    () => (data && drilledStars.length ? fileRows(drilledStars, data.titles, data.dates, () => '', null, Math.ceil(drilledStars.length / 100)).rows.map(r => r.star) : []),
    [data, drilledStars],
  );
  const linkCount = useMemo(() => {
    if (!intraHere) return null;
    const r = intraHere;
    return (star: number) => neighboursOf(r, star).length;
  }, [intraHere]);

  // ── engine callbacks ──
  const onArm = useCallback((t: ArmTarget | null) => {
    setArmed(t);
    if (t) setPeekSnap('peek');
  }, []);
  const onOpenStar = useCallback((i: number) => openFile(i), [openFile]);
  const onEnterCluster = useCallback((c: number) => enterCluster(c), [enterCluster]);
  const onHome = useCallback(() => {
    if (drilled >= 0) back();
    else engineRef.current?.goHome();
  }, [drilled, back]);
  const onPose = useCallback((a: LabelAnchor[]) => labelsLayout.current?.(a), []);
  const onContextLost = useCallback(() => setContextLost(true), []);

  // ── peek ──
  const starInfo = useCallback((i: number): StarInfo => {
    const d = docs![i];
    const ds = data!.dateSources[i];
    const dateLabel = ds === 'path' ? formatDay(data!.dates[i]) : ds === 'indexed' ? `indexed ${formatDay(data!.dates[i])}` : 'undated';
    const c = model!.enc.clusterOf[i];
    const links = intraHere && c === drilled
      ? neighboursOf(intraHere, i).map(n => ({ title: data!.titles[n.file], shared: sharedConcepts(model!.enc, i, n.file) }))
      : null;
    return { index: i, title: data!.titles[i], cluster: c, dateLabel, concepts: d.concepts ?? [], chunks: model!.moteCounts.counts[i] ?? 0, links };
  }, [docs, data, model, intraHere, drilled]);

  const peekState: PeekState | null = useMemo(() => {
    if (!model) return null;
    if (armed?.kind === 'star') return { kind: 'star', star: starInfo(armed.index) };
    if (armed?.kind === 'edge') return { kind: 'edge', edge: armed.index };
    const coverage = intraHere ? intraHere.coverage : null;
    if (armed?.kind === 'cluster') return { kind: 'cluster', cluster: armed.index, drilled: armed.index === drilled, coverage: armed.index === drilled ? coverage : null };
    if (drilled >= 0) return { kind: 'cluster', cluster: drilled, drilled: true, coverage };
    return null;
  }, [model, armed, drilled, intraHere, starInfo]);
  const peekView = model && peekState ? peekModel(model.peek, peekState) : null;

  const onPeekAction = useCallback((id: PeekAction['id']) => {
    if (id === 'enter' && armed?.kind === 'cluster') enterCluster(armed.index);
    else if (id === 'back') back();
    else if (id === 'open' && armed?.kind === 'star') openFile(armed.index);
  }, [armed, enterCluster, back, openFile]);

  const onPeekRow = useCallback((row: PeekRow) => {
    if (row.edge != null) setArmed({ kind: 'edge', index: row.edge });
    else if (row.cluster != null) setArmed({ kind: 'cluster', index: row.cluster });
  }, []);

  const onLabelTap = useCallback((c: number) => {
    if (armed?.kind === 'cluster' && armed.index === c) enterCluster(c);
    else { setArmed({ kind: 'cluster', index: c }); setPeekSnap('peek'); }
  }, [armed, enterCluster]);

  // ── keyboard: ←/→ cycle, Enter enter/open, Esc back out, +/− zoom, Home reset ──
  const openNow = openStar;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (ignoreKeyEvent({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, defaultPrevented: e.defaultPrevented, targetTag: t?.tagName, editable: t?.isContentEditable })) return;
      if (openNow >= 0) return; // the open file owns the keyboard; its Esc closes it
      const a = keyboardAction(e.key, { drilled, armed, clusterOrder, starOrder, listOpen });
      if (!a) return;
      e.preventDefault();
      const eng = engineRef.current;
      switch (a.kind) {
        case 'arm':
          setArmed(a.target);
          if (a.target.kind === 'cluster') eng?.focusCluster(a.target.index);
          else eng?.flyToStar(a.target.index);
          break;
        case 'enter': enterCluster(a.cluster); break;
        case 'open': openFile(a.star); break;
        case 'disarm': setArmed(null); break;
        case 'back': back(); break;
        case 'close-list': setListOpen(false); break;
        case 'zoom': eng?.zoomBy(a.factor); break;
        case 'home': eng?.goHome(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openNow, drilled, armed, clusterOrder, starOrder, listOpen, enterCluster, openFile, back]);

  // ── related (open file) ──
  const relatedCtx = useMemo(() => (model && data ? {
    data, selfIdx: openStar, clusterOfStar: (i: number) => model.enc.clusterOf[i], clusterOfProject: model.clusterOfProject, labels: model.labels,
  } : null), [model, data, openStar]);
  const onHop = useCallback((row: RelatedRow) => {
    if (row.star < 0 || !docs || !model) return;
    const c = row.cluster >= 0 ? row.cluster : model.enc.clusterOf[row.star];
    go({ c: keyOf(c), f: docs[row.star].id });
  }, [docs, model, go, keyOf]);
  const onRelatedRows = useCallback((rows: RelatedRow[]) => {
    if (drilled >= 0 && openStar >= 0) engineRef.current?.setVectorNeighbours(openStar, inClusterStars(rows, drilled));
  }, [drilled, openStar]);

  // ── states ──
  if (error && !core) {
    return (
      <FillViewport className="flex flex-col items-center justify-center gap-3 px-6 text-center overscroll-none" style={{ background: '#05060f' }}>
        <h1 className="text-base text-[#f87171]">Couldn’t load the Knowledge Web</h1>
        <p className="max-w-[420px] text-[14px] text-text-secondary">{error}</p>
      </FillViewport>
    );
  }

  if (!docs || !data || (docs.length > 0 && !model)) {
    return (
      <FillViewport className="relative flex flex-col items-center justify-center gap-3 overflow-hidden overscroll-none" style={{ background: SPACE_BG }}>
        <div className="h-10 w-10 rounded-full border border-white/10 border-t-[#8ab4ff] motion-safe:animate-spin" aria-hidden />
        <h1 className="text-[16px] tracking-wide text-text-primary">Knowledge Web</h1>
        <p className="text-[14px] text-text-secondary" role="status">
          {docs ? `Linking ${docs.length.toLocaleString('en-US')} files by shared concepts…` : 'Loading the map…'}
        </p>
      </FillViewport>
    );
  }

  if (!model || !engineData) {
    return (
      <FillViewport className="flex flex-col items-center justify-center gap-3 px-6 text-center overscroll-none" style={{ background: SPACE_BG }}>
        <h1 className="text-[22px] font-semibold text-text-primary">No files yet</h1>
        <p className="text-[15px] leading-relaxed text-text-secondary">The Knowledge Web needs vector embeddings. Run a vector index to populate it.</p>
      </FillViewport>
    );
  }

  const mode = renderMode(webgl, contextLost, canvas2d);
  const useFallback = mode !== '3d';
  const p = model.peek;
  const summary = webSummary(p);
  const drilledLabel = drilled >= 0 ? model.labels[drilled] : null;
  const openIdx = openStar >= 0 && openStar < data.count ? openStar : -1;
  const peekOpen = !!peekView && openIdx < 0;
  const moteChip = p.moteSource === 'estimate' ? 'chunk particles estimated' : p.moteSource === 'none' ? 'no chunk particles' : null;

  return (
    <FillViewport className="relative flex overflow-hidden overscroll-none" style={{ background: SPACE_BG }}>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {useFallback ? (
          <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pb-10 pt-24 sm:px-8">
            <div className="mx-auto flex max-w-[760px] flex-col gap-4">
              <p className="text-[14px] text-text-secondary">
                {webgl ? 'Graphics context lost' : '3D is unavailable on this device'} — the same clusters and links{mode === '2d' ? ' in 2D, and' : ''} as a list.
              </p>
              {mode === '2d' && drilled < 0 && (
                <WebFallback2D
                  centres={model.core.centres}
                  radii={model.core.radii}
                  palette={model.core.palette}
                  labels={model.labels}
                  sizes={p.sizes}
                  edges={p.edges}
                  unsorted={p.unsorted}
                  reducedMotion={reducedMotion}
                  maxLabels={wide ? 24 : 12}
                  onEnter={enterCluster}
                  summary={summary}
                />
              )}
              <div id="web-list">
                <WebList
                  model={p}
                  palette={model.core.palette}
                  titleId="web-list-title"
                  drilled={drilled}
                  drilledStars={drilledStars}
                  titles={data.titles}
                  dates={data.dates}
                  formatDate={formatDay}
                  linkCount={linkCount}
                  coverage={intraHere ? intraHere.coverage : null}
                  onEnter={enterCluster}
                  onOpenStar={openFile}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <WebView
              className="absolute inset-0"
              data={engineData}
              tier={tier}
              reducedMotion={reducedMotion}
              engineRef={engineRef}
              onReady={onReady}
              onArm={onArm}
              onOpenStar={onOpenStar}
              onEnterCluster={onEnterCluster}
              onHome={onHome}
              onPose={onPose}
              onContextLost={onContextLost}
            />
            <ClusterLabels
              labels={model.labels}
              sizes={p.sizes}
              palette={model.core.palette}
              unsorted={p.unsorted}
              armed={armed?.kind === 'cluster' ? armed.index : -1}
              hidden={drilled >= 0}
              maxVisible={wide ? 24 : 12}
              layoutRef={labelsLayout}
              onTap={onLabelTap}
            />
          </>
        )}

        {/* HUD: title + real totals, or the drilled cluster with a Back button */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 px-3 pt-3 sm:px-4 sm:pt-4"
          style={{ paddingLeft: 'max(12px, env(safe-area-inset-left))', paddingRight: 'max(12px, env(safe-area-inset-right))' }}
        >
          <div className="pointer-events-auto min-w-0 max-w-[min(440px,100%)] rounded-xl border border-white/[0.08] px-3 py-2" style={{ ...GLASS, fontFamily: GALAXY_FONT_STACK }}>
            <h1 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-text-primary">Knowledge Web</h1>
            {drilledLabel == null ? (
              <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">
                <span className="tabular-nums">{p.labels.length}</span> clusters · <span className="tabular-nums">{p.totalFiles.toLocaleString('en-US')}</span> files · <span className="tabular-nums">{p.edges.length}</span> links
                {/* persistent until arra reports real per-file chunk counts (R7) */}
                {moteChip && <span className="max-sm:block"><span className="max-sm:hidden"> · </span>{moteChip}</span>}
              </p>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={back}
                  className="-ml-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[14px] text-accent transition-colors duration-150 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden>←</span> All clusters
                </button>
                <p className="min-w-0 truncate text-[13px] text-text-secondary">
                  <span className="text-text-primary">{drilledLabel}</span> · {p.sizes[drilled].toLocaleString('en-US')} files
                  {intraHere ? ` · ${pct(intraHere.coverage)} linked` : ''}
                </p>
              </div>
            )}
          </div>
          <div className="pointer-events-auto flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
            <ViewSwitch active="web" style={GLASS} />
            {!useFallback && (
              <button
                type="button"
                onClick={() => setListOpen(v => !v)}
                aria-expanded={listOpen}
                aria-controls="web-list"
                className="flex min-h-11 items-center rounded-xl border border-white/[0.09] px-3.5 text-[14px] text-text-primary transition-colors duration-150 hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                style={GLASS}
              >
                List
              </button>
            )}
          </div>
        </div>

        {/* camera controls: 44 px, right thumb zone */}
        {!useFallback && (
          <div
            className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1.5 sm:right-4"
            style={{ marginRight: 'env(safe-area-inset-right)' }}
          >
            {[
              { label: '+', title: 'Zoom in', fn: () => engineRef.current?.zoomBy(0.72) },
              { label: '−', title: 'Zoom out', fn: () => engineRef.current?.zoomBy(1.4) },
              { label: '⌂', title: drilled >= 0 ? 'Frame this cluster' : 'Reset view', fn: () => engineRef.current?.goHome() },
            ].map(b => (
              <button
                key={b.title}
                type="button"
                onClick={b.fn}
                title={b.title}
                aria-label={b.title}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.09] text-lg text-text-primary transition-colors duration-200 hover:border-[#8ab4ff]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                style={GLASS}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

        {/* peek card: desktop panel bottom-left; phones use the bottom sheet below */}
        {peekOpen && wide && peekView && (
          <section
            aria-labelledby="web-peek-title"
            className="absolute bottom-4 left-4 z-20 flex max-h-[min(62%,560px)] w-[380px] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.09] p-4 shadow-[0_16px_60px_rgba(0,0,0,0.5)]"
            style={{ ...GLASS, marginLeft: 'env(safe-area-inset-left)' }}
          >
            <PeekCard view={peekView} palette={model.core.palette} titleId="web-peek-title" onAction={onPeekAction} onRow={onPeekRow} onClose={drilled >= 0 && !armed ? undefined : () => setArmed(null)} />
          </section>
        )}

        {/* list view: desktop side panel (phones: bottom sheet below) */}
        {listOpen && !useFallback && wide && (
          <section
            id="web-list"
            aria-labelledby="web-list-title"
            className="absolute bottom-3 right-3 top-[76px] z-30 w-[400px] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.09] p-4 shadow-[0_16px_60px_rgba(0,0,0,0.5)] sm:right-4"
            style={GLASS}
          >
            <WebList
              model={p}
              palette={model.core.palette}
              titleId="web-list-title"
              drilled={drilled}
              drilledStars={drilledStars}
              titles={data.titles}
              dates={data.dates}
              formatDate={formatDay}
              linkCount={linkCount}
              coverage={intraHere ? intraHere.coverage : null}
              onEnter={c => { enterCluster(c); }}
              onOpenStar={openFile}
              onClose={() => setListOpen(false)}
            />
          </section>
        )}

        {/* screen-reader summary (the canvas's aria-describedby) + live announcements */}
        <p id="web-list-summary" className="sr-only">{summary}</p>
        <p className="sr-only" aria-live="polite" role="status">{live}</p>
      </div>

      {listOpen && !useFallback && !wide && (
        <Sheet
          snap={listSnap}
          onSnapChange={setListSnap}
          onClose={() => setListOpen(false)}
          snaps={['half', 'full']}
          labelledBy="web-list-title"
          reducedMotion={reducedMotion}
        >
          <div id="web-list">
            <WebList
              model={p}
              palette={model.core.palette}
              titleId="web-list-title"
              drilled={drilled}
              drilledStars={drilledStars}
              titles={data.titles}
              dates={data.dates}
              formatDate={formatDay}
              linkCount={linkCount}
              coverage={intraHere ? intraHere.coverage : null}
              onEnter={c => { setListOpen(false); enterCluster(c); }}
              onOpenStar={i => { setListOpen(false); openFile(i); }}
              onClose={() => setListOpen(false)}
            />
          </div>
        </Sheet>
      )}

      {peekOpen && !wide && !listOpen && peekView && (
        <Sheet
          snap={peekSnap}
          onSnapChange={setPeekSnap}
          onClose={drilled >= 0 && !armed ? undefined : () => setArmed(null)}
          snaps={['peek', 'half', 'full']}
          labelledBy="web-peek-title"
          reducedMotion={reducedMotion}
        >
          <PeekCard view={peekView} palette={model.core.palette} titleId="web-peek-title" onAction={onPeekAction} onRow={onPeekRow} />
        </Sheet>
      )}

      {openIdx >= 0 && relatedCtx && (
        <DocSheet
          data={data}
          idx={openIdx}
          reducedMotion={reducedMotion}
          onClose={back}
          related={<Related docId={data.docs[openIdx].id} ctx={relatedCtx} palette={model.core.palette} onHop={onHop} onRows={onRelatedRows} />}
        />
      )}
    </FillViewport>
  );
}
