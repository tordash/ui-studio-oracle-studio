// Knowledge Web — what the peek card / HUD says (pure; the React side only renders it).
// Honesty rules: every number is real; estimates say so; Unsorted says what it is;
// orphans say why they have no links; broad (diffuse) links say they are broad.

import type { InterEdge, WeakMatch } from './inter';
import { DIFFUSE_TOP5 } from './inter';
import type { MoteSource } from './motes';

export interface WebModel {
  labels: readonly string[];
  sizes: ArrayLike<number>;
  /** raw project values merged into each cluster */
  sources: readonly (readonly string[])[];
  unsorted: number;
  edges: readonly InterEdge[];
  degree: readonly number[];
  orphans: readonly number[];
  weak: Readonly<Record<number, readonly WeakMatch[]>>;
  totalFiles: number;
  moteSource: MoteSource;
  moteTotal: number;
}

export interface StarInfo {
  index: number;
  title: string;
  cluster: number;
  dateLabel: string;
  concepts: readonly string[];
  /** chunk motes of this file (real or estimated, see moteSource) */
  chunks: number;
  /** intra neighbours when the cluster's links are loaded (null = not yet) */
  links: { title: string; shared: readonly string[] }[] | null;
}

export type PeekState =
  | { kind: 'none'; drilled: number }
  | { kind: 'cluster'; cluster: number; drilled: boolean; coverage?: number | null }
  | { kind: 'edge'; edge: number }
  | { kind: 'star'; star: StarInfo };

export interface PeekChip { text: string; detail?: string }
export interface PeekRow {
  key: string;
  label: string;
  value: string;
  chips: PeekChip[];
  /** link row → highlight this edge; star link row → nothing */
  edge?: number;
  cluster?: number;
  muted?: boolean;
}
export type PeekActionId = 'enter' | 'back' | 'open' | 'list';
export interface PeekAction { id: PeekActionId; label: string }

export interface PeekView {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** cluster colour index the card is tinted with (-1 = neutral) */
  tint: number;
  facts: string[];
  rows: PeekRow[];
  rowsTitle: string;
  notes: string[];
  actions: PeekAction[];
}

const n0 = (v: number) => v.toLocaleString('en-US');
export function pct(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}
const w2 = (w: number) => (w >= 0.01 ? w.toFixed(2) : w.toFixed(3));

function filesWord(n: number) { return `${n0(n)} file${n === 1 ? '' : 's'}`; }

export function clusterSubtitle(m: WebModel, c: number): string {
  if (c === m.unsorted) return `${filesWord(m.sizes[c])} without a project tag`;
  const src = m.sources[c] ?? [];
  return src.length > 1 ? `${filesWord(m.sizes[c])} · merged from ${src.length} sources` : filesWord(m.sizes[c]);
}

function otherEnd(e: InterEdge, c: number) { return e.a === c ? e.b : e.a; }

export function diffuseNote(e: InterEdge): string | null {
  if (e.top5 >= DIFFUSE_TOP5) return null;
  return `Broad overlap: ${n0(e.shared)} shared concepts, top 5 = ${pct(e.top5)} of the weight`;
}

export function moteNote(m: Pick<WebModel, 'moteSource' | 'moteTotal' | 'totalFiles'>): string | null {
  if (m.moteSource === 'estimate') {
    const per = m.totalFiles ? Math.round(m.moteTotal / m.totalFiles) : 0;
    return `Chunk particles: ≈${per} per file, estimated from ${n0(m.moteTotal)} indexed chunks · exact counts pending arra`;
  }
  if (m.moteSource === 'none') return 'Chunk particles off: the index reported no chunk total';
  return null;
}

export function peekModel(m: WebModel, s: PeekState): PeekView {
  if (s.kind === 'none') {
    const notes: string[] = [];
    if (m.unsorted >= 0) notes.push(`Unsorted (grey, dashed links) = ${filesWord(m.sizes[m.unsorted])} without a project tag`);
    const mn = moteNote(m);
    if (mn) notes.push(mn);
    return {
      eyebrow: 'Knowledge Web',
      title: `${n0(m.labels.length)} clusters`,
      subtitle: `${n0(m.totalFiles)} files · ${n0(m.edges.length)} links`,
      tint: -1, facts: [], rows: [], rowsTitle: '', notes,
      actions: [{ id: 'list', label: 'List view' }],
    };
  }

  if (s.kind === 'cluster') {
    const c = s.cluster;
    const mine = m.edges.filter(e => e.a === c || e.b === c).sort((x, y) => y.w - x.w);
    const rows: PeekRow[] = mine.map(e => {
      const o = otherEnd(e, c);
      return {
        key: `e${e.a}-${e.b}`, label: m.labels[o], value: w2(e.w), edge: m.edges.indexOf(e), cluster: o,
        chips: e.evidence.slice(0, 3).map(v => ({ text: `${v.concept} ${pct(v.share)}` })),
        muted: e.top5 < DIFFUSE_TOP5,
      };
    });
    const notes: string[] = [];
    let rowsTitle = rows.length ? `Links · ${rows.length}` : '';
    if (rows.length === 0 && m.orphans.includes(c)) {
      notes.push('No link with ≥ 3 specific shared concepts');
      const weak = m.weak[c] ?? [];
      for (const x of weak) {
        rows.push({ key: `w${x.b}`, label: m.labels[x.b], value: w2(x.w), cluster: x.b, chips: [{ text: `${x.shared} shared` }], muted: true });
      }
      rowsTitle = weak.length ? 'Closest weak matches' : '';
    }
    if (mine.some(e => e.top5 < DIFFUSE_TOP5)) notes.push('Dimmed rows are broad overlaps: many shared concepts, none dominant');
    if (c === m.unsorted) notes.push('Unsorted is not a project: these files have no project tag in the index');
    const facts: string[] = [];
    if (s.drilled && s.coverage != null) facts.push(`${pct(s.coverage)} of files linked by shared concepts`);
    return {
      eyebrow: c === m.unsorted ? 'Unsorted' : 'Cluster',
      title: m.labels[c],
      subtitle: clusterSubtitle(m, c),
      tint: c, facts, rows, rowsTitle, notes,
      actions: s.drilled ? [{ id: 'back', label: 'All clusters' }] : [{ id: 'enter', label: `Enter ${m.labels[c]}` }],
    };
  }

  if (s.kind === 'edge') {
    const e = m.edges[s.edge];
    const shown = Math.min(8, e.evidence.length);
    const rows: PeekRow[] = e.evidence.slice(0, shown).map((v, i) => ({
      key: `c${i}`, label: v.concept, value: pct(v.share),
      chips: [{ text: `${n0(v.nA)} ${m.labels[e.a]}`, detail: 'files' }, { text: `${n0(v.nB)} ${m.labels[e.b]}`, detail: 'files' }],
    }));
    const notes: string[] = [];
    const d = diffuseNote(e);
    if (d) notes.push(d);
    if (e.shared > shown) notes.push(`+${n0(e.shared - shown)} more shared concepts`);
    if (e.a === m.unsorted || e.b === m.unsorted) notes.push('Link to Unsorted: files without a project tag');
    return {
      eyebrow: 'Link',
      title: `${m.labels[e.a]} ↔ ${m.labels[e.b]}`,
      subtitle: `weight ${w2(e.w)} · ${n0(e.shared)} shared concepts`,
      tint: e.a, facts: [], rows, rowsTitle: 'Why they link', notes,
      actions: [],
    };
  }

  const st = s.star;
  const facts: string[] = [];
  if (st.dateLabel) facts.push(st.dateLabel);
  facts.push(m.moteSource === 'real' ? `${n0(st.chunks)} chunk${st.chunks === 1 ? '' : 's'}` : m.moteSource === 'estimate' ? `≈${n0(st.chunks)} chunks (estimated)` : 'chunks unknown');
  const rows: PeekRow[] = (st.links ?? []).map((l, i) => ({
    key: `n${i}`, label: l.title, value: '', chips: l.shared.slice(0, 3).map(t => ({ text: t })),
  }));
  const notes: string[] = [];
  if (st.links == null) notes.push('Links appear when you enter the cluster');
  else if (st.links.length === 0) notes.push('No concept link above the threshold — Related (vector) neighbours show when you open it');
  return {
    eyebrow: m.labels[st.cluster],
    title: st.title,
    subtitle: st.concepts.slice(0, 6).join(' · '),
    tint: st.cluster, facts, rows, rowsTitle: rows.length ? `Concept links · ${rows.length}` : '', notes,
    actions: [{ id: 'open', label: 'Open' }],
  };
}

/** One-line canvas / screen-reader summary (aria-label + live region). */
export function webSummary(m: Pick<WebModel, 'labels' | 'totalFiles' | 'edges'>): string {
  return `Knowledge Web: ${n0(m.labels.length)} cluster nodes, ${n0(m.edges.length)} links, ${n0(m.totalFiles)} files`;
}

/** Live-region text when a cluster is entered. */
export function enteredText(label: string, files: number, links: number | null): string {
  return links == null ? `Entered ${label}: ${filesWord(files)}` : `Entered ${label}: ${filesWord(files)}, ${n0(links)} links`;
}
