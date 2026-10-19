// Knowledge Galaxy — pure data → visual mapping (no three.js, no DOM).
//
// Every visual channel here maps to a field that /api/map3d actually returns:
//   position   ← x, y, z (real PCA of bge-m3 embeddings, normalised to [-1, 1])
//   colour     ← type
//   size       ← chunk count (`chunks` or `chunk_ids.length`) — uniform when the API omits it
//   brightness ← recency rank of the doc date (path date first, created_at as "indexed" fallback)
//
// Kept pure so it is unit-tested with bun:test and scales linearly to the ~13k
// points arra #58 will return in the same shape.

import type { MapDocument } from '../../api/oracle';
import { getTypeColor } from '../type-colors';

/** World radius the normalised PCA cube is scaled to. */
export const GALAXY_RADIUS = 10;

/** Star colour per doc type — the same palette as the badges (lib/type-colors.ts, decision S2). */
export function galaxyTypeColor(type: string | null | undefined): string {
  return getTypeColor(type);
}

/** '#rrggbb' → [r, g, b] in 0..1 */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── Dates ────────────────────────────────────────────────────────────────

/** Where a star's date came from. `indexed` = created_at, which is index time, not authoring time. */
export type DateSource = 'path' | 'indexed' | null;

function validYmd(y: number, m: number, d: number): number | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : ms;
}

const PATH_DATE_PATTERNS: RegExp[] = [
  /(\d{4})-(\d{2})-(\d{2})/,            // 2026-04-18
  /(\d{4})\/(\d{2})\/(\d{2})/,          // 2026/04/18
  /(\d{4})-(\d{2})\/(\d{2})/,           // retrospectives/2026-04/16
  /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/, // brief_helm_20260412
];

/** Parse a YYYY-MM-DD-ish date out of a path or id. Returns UTC ms or null. */
export function parsePathDate(text: string | null | undefined): number | null {
  if (!text) return null;
  for (const re of PATH_DATE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const ms = validYmd(+m[1], +m[2], +m[3]);
      if (ms != null) return ms;
    }
  }
  return null;
}

/**
 * Best available date for a doc. Path/id date first (same order DocDetail uses),
 * then created_at labelled "indexed" because arra sets it at index time.
 */
export function docDate(doc: Pick<MapDocument, 'source_file' | 'id' | 'created_at'>): { ms: number | null; source: DateSource } {
  const p = parsePathDate(doc.source_file) ?? parsePathDate(doc.id);
  if (p != null) return { ms: p, source: 'path' };
  if (doc.created_at) {
    const ms = Date.parse(doc.created_at);
    if (!Number.isNaN(ms)) return { ms, source: 'indexed' };
  }
  return { ms: null, source: null };
}

export const BRIGHT_MIN = 0.38;
export const BRIGHT_MAX = 1.0;
export const BRIGHT_UNDATED = 0.22;

/**
 * Brightness = relative recency. Rank-based (percentile among dated stars) so a
 * dataset clumped into one month still spreads over the full brightness range.
 * Ties share the same brightness. Undated stars get a dim constant.
 */
export function recencyBrightness(dates: ArrayLike<number | null>): Float32Array {
  const n = dates.length;
  const out = new Float32Array(n).fill(BRIGHT_UNDATED);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (dates[i] != null) idx.push(i);
  if (idx.length === 0) return out;
  idx.sort((a, b) => (dates[a] as number) - (dates[b] as number));
  const m = idx.length;
  let i = 0;
  while (i < m) {
    let j = i;
    const v = dates[idx[i]];
    while (j + 1 < m && dates[idx[j + 1]] === v) j++;
    const rank = m === 1 ? 1 : ((i + j) / 2) / (m - 1); // average rank for ties
    const b = BRIGHT_MIN + (BRIGHT_MAX - BRIGHT_MIN) * rank;
    for (let k = i; k <= j; k++) out[idx[k]] = b;
    i = j + 1;
  }
  return out;
}

// ── Size ────────────────────────────────────────────────────────────────

/** Chunk count if the API provides it (`chunks` from arra #58, or `chunk_ids`). */
export function chunkCount(doc: MapDocument & { chunks?: number }): number | null {
  if (typeof doc.chunks === 'number' && doc.chunks > 0) return doc.chunks;
  if (Array.isArray(doc.chunk_ids) && doc.chunk_ids.length > 0) return doc.chunk_ids.length;
  return null;
}

export const SIZE_UNIFORM = 1;
export const SIZE_MAX = 3.2;

/** Size multiplier from chunk count: 1 chunk → 1, grows with log2, capped. */
export function sizeForChunks(chunks: number | null): number {
  if (chunks == null || chunks <= 1) return SIZE_UNIFORM;
  return Math.min(SIZE_MAX, 1 + 0.55 * Math.log2(chunks));
}

// ── Titles / paths ──────────────────────────────────────────────────────

export function titleFromPath(sourceFile: string): string {
  const base = sourceFile.split('/').pop() || sourceFile;
  return base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || sourceFile;
}

/**
 * Normalise a source_file for cross-endpoint matching. Search returns paths like
 * `../ghq/github.com/<owner>/<repo>/ψ/memory/x.md` while map3d returns `ψ/memory/x.md`.
 */
export function normalizeSourcePath(p: string): string {
  let s = p.replace(/\\/g, '/').trim();
  s = s.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  s = s.replace(/^(?:.*\/)?ghq\/[^/]+\/[^/]+\/[^/]+\//, '');
  s = s.replace(/^github\.com\/[^/]+\/[^/]+\//, '');
  s = s.replace(/^Projects\/[^/]+\//, '');
  return s.toLowerCase();
}

/**
 * Top-level source folder used to label clusters whose members carry no
 * concepts — e.g. `ψ/learn/gsd-build/…` → `learn/gsd-build`. Shown as a folder,
 * never passed off as a concept.
 */
export function sourceFolder(p: string): string {
  const segs = normalizeSourcePath(p).split('/').filter(s => s && s !== 'ψ');
  segs.pop(); // filename
  if (segs.length === 0) return '(root)';
  return segs.slice(0, 2).join('/');
}

// ── Prepared galaxy ─────────────────────────────────────────────────────

export interface GalaxyData {
  docs: MapDocument[];
  count: number;
  /** xyz × GALAXY_RADIUS */
  positions: Float32Array;
  /** rgb 0..1 per star */
  colors: Float32Array;
  sizes: Float32Array;
  brightness: Float32Array;
  /** stable 0..1 per star — pulse phase offset */
  phases: Float32Array;
  dates: (number | null)[];
  dateSources: DateSource[];
  titles: string[];
  /** true when at least one doc carried a chunk count */
  hasChunks: boolean;
  /** true when the response had no z (2D /api/map fallback) */
  flat: boolean;
  typeCounts: Record<string, number>;
  dateSourceCounts: { path: number; indexed: number; undated: number };
  dateRange: { min: number; max: number } | null;
  byId: Map<string, number>;
  byPath: Map<string, number[]>;
}

export function prepareGalaxy(docs: MapDocument[]): GalaxyData {
  const n = docs.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const phases = new Float32Array(n);
  const dates: (number | null)[] = new Array(n);
  const dateSources: DateSource[] = new Array(n);
  const titles: string[] = new Array(n);
  const typeCounts: Record<string, number> = {};
  const dsc = { path: 0, indexed: 0, undated: 0 };
  const byId = new Map<string, number>();
  const byPath = new Map<string, number[]>();
  const rgbCache = new Map<string, [number, number, number]>();
  let hasChunks = false;
  let flat = n > 0;
  let dmin = Infinity, dmax = -Infinity;

  for (let i = 0; i < n; i++) {
    const d = docs[i] as MapDocument & { chunks?: number; title?: string };
    const z = typeof d.z === 'number' ? d.z : 0;
    if (typeof d.z === 'number') flat = false;
    positions[i * 3] = (d.x || 0) * GALAXY_RADIUS;
    positions[i * 3 + 1] = (d.y || 0) * GALAXY_RADIUS;
    positions[i * 3 + 2] = z * GALAXY_RADIUS;

    const type = d.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    let rgb = rgbCache.get(type);
    if (!rgb) { rgb = hexToRgb01(galaxyTypeColor(type)); rgbCache.set(type, rgb); }
    colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2];

    const c = chunkCount(d);
    if (c != null) hasChunks = true;
    sizes[i] = sizeForChunks(c);

    const dd = docDate(d);
    dates[i] = dd.ms;
    dateSources[i] = dd.source;
    if (dd.source === 'path') dsc.path++; else if (dd.source === 'indexed') dsc.indexed++; else dsc.undated++;
    if (dd.ms != null) { if (dd.ms < dmin) dmin = dd.ms; if (dd.ms > dmax) dmax = dd.ms; }

    titles[i] = (d.title && d.title.trim()) || titleFromPath(d.source_file || d.id);
    // golden-ratio sequence: stable, well-spread phases without randomness
    phases[i] = (i * 0.6180339887) % 1;

    if (!byId.has(d.id)) byId.set(d.id, i);
    if (d.source_file) {
      const key = normalizeSourcePath(d.source_file);
      const arr = byPath.get(key);
      if (arr) arr.push(i); else byPath.set(key, [i]);
    }
  }

  return {
    docs, count: n, positions, colors, sizes,
    brightness: recencyBrightness(dates),
    phases, dates, dateSources, titles, hasChunks, flat, typeCounts,
    dateSourceCounts: dsc,
    dateRange: dmin <= dmax ? { min: dmin, max: dmax } : null,
    byId, byPath,
  };
}

/** Map search results (chunk ids, other path spellings) onto star indices. */
export function matchSearchResults(
  data: Pick<GalaxyData, 'byId' | 'byPath'>,
  results: Array<{ id?: string; source_file?: string }>,
): Set<number> {
  const out = new Set<number>();
  for (const r of results) {
    if (r.id != null) {
      const i = data.byId.get(r.id);
      if (i != null) { out.add(i); continue; }
    }
    if (r.source_file) {
      const arr = data.byPath.get(normalizeSourcePath(r.source_file));
      if (arr) for (const i of arr) out.add(i);
    }
  }
  return out;
}

/** Instant local match on title / path / concepts (case-insensitive substring). */
export function matchLocal(data: Pick<GalaxyData, 'docs' | 'titles'>, query: string): Set<number> {
  const q = query.trim().toLowerCase();
  const out = new Set<number>();
  if (!q) return out;
  const { docs, titles } = data;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (
      titles[i].toLowerCase().includes(q) ||
      (d.source_file && d.source_file.toLowerCase().includes(q)) ||
      (d.concepts && d.concepts.some(c => c.toLowerCase().includes(q)))
    ) out.add(i);
  }
  return out;
}

/** Star visibility/emphasis state consumed by the shader. */
export const STATE_NORMAL = 0;
export const STATE_DIM = 1;
export const STATE_MATCH = 2;
export const STATE_HIDDEN = 3;

export function computeStates(
  data: Pick<GalaxyData, 'docs' | 'count'>,
  opts: { hiddenTypes?: Set<string>; matches?: Set<number> | null; project?: string | null },
): Float32Array {
  const { docs, count } = data;
  const out = new Float32Array(count);
  const hidden = opts.hiddenTypes;
  const matches = opts.matches && opts.matches.size > 0 ? opts.matches : null;
  const project = opts.project === undefined ? null : opts.project;
  for (let i = 0; i < count; i++) {
    const d = docs[i];
    if (hidden && hidden.has(d.type || 'unknown')) { out[i] = STATE_HIDDEN; continue; }
    const projOk = project == null || (project === '' ? d.project == null : d.project === project);
    if (matches) out[i] = matches.has(i) && projOk ? STATE_MATCH : STATE_DIM;
    else out[i] = projOk ? STATE_NORMAL : STATE_DIM;
  }
  return out;
}

export function formatDay(ms: number | null): string {
  if (ms == null) return 'undated';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}
