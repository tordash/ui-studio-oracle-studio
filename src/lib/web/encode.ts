// Knowledge Web — encode map3d docs into flat typed arrays (pure, no DOM).
//
// The worker gets ~0.6 MB of transferable buffers instead of a structured clone
// of 13k objects. Cluster keys and concept names are sorted, and each file's
// concept ids are de-duplicated and sorted, so every downstream sum runs in a
// canonical order: a shuffled input gives bit-identical output.

import type { MapDocument } from '../../api/oracle';
import { clusterKey } from './keys';

export interface EncodedWeb {
  /** number of files (stars) */
  n: number;
  /** sorted cluster keys; index = cluster id */
  clusterKeys: string[];
  /** per file → cluster id */
  clusterOf: Int32Array;
  /** sorted concept names; index = concept id */
  conceptNames: string[];
  /** CSR offsets, length n + 1 */
  conceptOff: Int32Array;
  /** CSR values: each file's unique concept ids, ascending */
  conceptIds: Int32Array;
  /** raw PCA position per file (x, y, z in [-1, 1]); z = 0 when the API has none */
  pos: Float32Array;
  /** canonical rank of each file by doc id — the tie-break that survives input order */
  rank: Int32Array;
}

type EncodableDoc = Pick<MapDocument, 'id' | 'project' | 'concepts' | 'x' | 'y'> & { z?: number };

export function encodeForWorker(
  docs: readonly EncodableDoc[],
  keyOf: (project: string | null | undefined) => string = clusterKey,
): EncodedWeb {
  const n = docs.length;
  const keys = new Array<string>(n);
  const keySet = new Set<string>();
  const conceptSet = new Set<string>();
  for (let i = 0; i < n; i++) {
    const k = keyOf(docs[i].project);
    keys[i] = k;
    keySet.add(k);
    const cs = docs[i].concepts;
    if (Array.isArray(cs)) for (const c of cs) if (typeof c === 'string' && c) conceptSet.add(c);
  }
  const clusterKeys = [...keySet].sort();
  const conceptNames = [...conceptSet].sort();
  const keyIdx = new Map(clusterKeys.map((k, i) => [k, i] as const));
  const conceptIdx = new Map(conceptNames.map((c, i) => [c, i] as const));

  const clusterOf = new Int32Array(n);
  const conceptOff = new Int32Array(n + 1);
  const ids: number[] = [];
  const pos = new Float32Array(n * 3);
  const tmp = new Set<number>();
  for (let i = 0; i < n; i++) {
    const d = docs[i];
    clusterOf[i] = keyIdx.get(keys[i])!;
    tmp.clear();
    if (Array.isArray(d.concepts)) for (const c of d.concepts) if (typeof c === 'string' && c) tmp.add(conceptIdx.get(c)!);
    const sorted = [...tmp].sort((a, b) => a - b);
    for (const id of sorted) ids.push(id);
    conceptOff[i + 1] = ids.length;
    pos[i * 3] = Number.isFinite(d.x) ? d.x : 0;
    pos[i * 3 + 1] = Number.isFinite(d.y) ? d.y : 0;
    pos[i * 3 + 2] = typeof d.z === 'number' && Number.isFinite(d.z) ? d.z : 0;
  }
  const byId = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (docs[a].id < docs[b].id ? -1 : docs[a].id > docs[b].id ? 1 : a - b));
  const rank = new Int32Array(n);
  byId.forEach((f, r) => { rank[f] = r; });
  return { n, clusterKeys, clusterOf, conceptNames, conceptOff, conceptIds: Int32Array.from(ids), pos, rank };
}

/** The ArrayBuffers to pass as `transfer` (they detach on the sender). */
export function transferables(e: EncodedWeb): ArrayBuffer[] {
  return [e.clusterOf.buffer, e.conceptOff.buffer, e.conceptIds.buffer, e.pos.buffer, e.rank.buffer] as ArrayBuffer[];
}

/** Files of each cluster, ascending file index. */
export function membersByCluster(e: Pick<EncodedWeb, 'n' | 'clusterKeys' | 'clusterOf'>): Int32Array[] {
  const C = e.clusterKeys.length;
  const counts = new Int32Array(C);
  for (let i = 0; i < e.n; i++) counts[e.clusterOf[i]]++;
  const out = Array.from({ length: C }, (_, c) => new Int32Array(counts[c]));
  const fill = new Int32Array(C);
  for (let i = 0; i < e.n; i++) {
    const c = e.clusterOf[i];
    out[c][fill[c]++] = i;
  }
  return out;
}

/** Number of files carrying each concept (document frequency). */
export function documentFrequency(e: Pick<EncodedWeb, 'conceptNames' | 'conceptIds'>): Int32Array {
  const df = new Int32Array(e.conceptNames.length);
  for (let k = 0; k < e.conceptIds.length; k++) df[e.conceptIds[k]]++;
  return df;
}
