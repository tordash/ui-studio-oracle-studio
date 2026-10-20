// Knowledge Web — map /api/similar results onto stars (pure).
//
// Live probes return scores of 0 and the same ψ file mirrored in several repos, so:
//   • the API ORDER is the ranking; a score is never shown or used;
//   • results with the same normalised path collapse into one row with an
//     "also in …" chip (the other copies' clusters);
//   • a path with several stars resolves to the star whose project matches the
//     result's project, else the first;
//   • the opened file itself is dropped.

import type { GalaxyData } from '../galaxy/mapping';
import { normalizeSourcePath, titleFromPath } from '../galaxy/mapping';

export interface SimilarResult {
  id?: string;
  source_file?: string;
  project?: string | null;
}

export interface RelatedRow {
  key: string;
  /** star index, or -1 when the file is not in the map */
  star: number;
  title: string;
  /** cluster index, or -1 when unknown */
  cluster: number;
  /** cluster labels of the collapsed copies (excluding this row's cluster) */
  alsoIn: string[];
  path: string;
}

export interface RelatedContext {
  data: Pick<GalaxyData, 'byId' | 'byPath' | 'docs' | 'titles'>;
  /** the opened star (dropped from its own list) */
  selfIdx: number;
  clusterOfStar: (i: number) => number;
  /** cluster index for a raw project value (alias-merged), -1 if none */
  clusterOfProject: (project: string | null | undefined) => number;
  labels: readonly string[];
}

export function mapSimilar(results: readonly SimilarResult[], ctx: RelatedContext): RelatedRow[] {
  const { data } = ctx;
  const self = ctx.selfIdx >= 0 ? data.docs[ctx.selfIdx] : null;
  const selfPath = self?.source_file ? normalizeSourcePath(self.source_file) : null;
  const rows: RelatedRow[] = [];
  const byPathRow = new Map<string, RelatedRow>();

  for (const r of results) {
    const path = r.source_file ? normalizeSourcePath(r.source_file) : '';
    if (r.id != null && self && r.id === self.id) continue;
    if (path && selfPath && path === selfPath) continue;

    const wantCluster = ctx.clusterOfProject(r.project);
    let star = r.id != null ? data.byId.get(r.id) ?? -1 : -1;
    if (star < 0 && path) {
      const cands = data.byPath.get(path) ?? [];
      star = cands.find(i => ctx.clusterOfStar(i) === wantCluster) ?? cands[0] ?? -1;
    }
    const cluster = star >= 0 ? ctx.clusterOfStar(star) : wantCluster;

    const dup = path ? byPathRow.get(path) : undefined;
    if (dup) {
      const label = cluster >= 0 ? ctx.labels[cluster] : null;
      if (label && cluster !== dup.cluster && !dup.alsoIn.includes(label)) dup.alsoIn.push(label);
      continue;
    }
    const row: RelatedRow = {
      key: path || r.id || String(rows.length),
      star,
      title: star >= 0 ? data.titles[star] : titleFromPath(r.source_file || r.id || 'untitled'),
      cluster,
      alsoIn: [],
      path: r.source_file ?? '',
    };
    rows.push(row);
    if (path) byPathRow.set(path, row);
  }
  return rows;
}

/** Stars among `rows` that sit in `cluster` (the dotted vector layer inside a drill). */
export function inClusterStars(rows: readonly RelatedRow[], cluster: number): number[] {
  return rows.filter(r => r.star >= 0 && r.cluster === cluster).map(r => r.star);
}

/** /api/similar normally answers in ~0.1–0.4 s; past this the list shows "unavailable" + Try again. */
export const RELATED_TIMEOUT_MS = 12000;

export class RelatedTimeoutError extends Error {
  constructor(ms: number) { super(`Related timed out after ${ms} ms`); this.name = 'RelatedTimeoutError'; }
}

/** Settle `p`, or reject after `ms` — a stalled request must never leave Related on skeletons. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RelatedTimeoutError(ms)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
