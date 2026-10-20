// Knowledge Web — inter-cluster links from ALL files (A2), pure, runs in the worker.
//
// Weight = cosine of smoothed positive-lift concept vectors (design §3.2):
//   p_c   = df_c / N
//   ŝ_A(c) = (n_A(c) + α·p_c) / (|A| + α)          α = 5 shrinks small clusters toward p_c
//   v_A(c) = max(0, log(ŝ_A(c) / p_c))              = log ŝ + idf; ubiquitous concepts → ≈ 0
//   v̂_A    = v_A / ‖v_A‖₂
//   w(A,B) = Σ_c v̂_A(c) · v̂_B(c)
// Because w is a sparse dot product, each concept's share v̂_A(c)·v̂_B(c) / w is
// exact and the shares sum to 100 % — that is the hover evidence.
//
// Concepts with df < 2 can never link two clusters and are skipped. "Shared"
// counts only concepts with positive weight on both sides.
//
// Cost: postings Σ concepts ≈ 100k, pair accumulation Σ_c m_c² (m_c ≤ #clusters).

import type { EncodedWeb } from './encode';
import { documentFrequency, membersByCluster } from './encode';

export interface InterOptions {
  /** keep an edge if it is in the top-k of either endpoint */
  k: number;
  /** minimum shared concepts (positive weight on both sides) */
  minShared: number;
  /** minimum weight */
  wMin: number;
  /** smoothing prior strength */
  alpha: number;
  /** evidence rows stored per edge */
  maxEvidence: number;
  /** best weak matches listed for an orphan */
  weakCount: number;
}

export const INTER_DEFAULTS: Readonly<InterOptions> = {
  k: 3, minShared: 3, wMin: 0.02, alpha: 5, maxEvidence: 8, weakCount: 3,
};

/** Share of the weight below which an edge is labelled "broad overlap". */
export const DIFFUSE_TOP5 = 0.5;

export interface ClusterVectors {
  /** CSR offsets per cluster (length C + 1) */
  off: Int32Array;
  /** concept ids, ascending within a cluster */
  ids: Int32Array;
  /** L2-normalised lift weights aligned with ids */
  vals: Float64Array;
  /** n_A(c): files in the cluster carrying the concept, aligned with ids */
  counts: Int32Array;
  /** files per cluster */
  sizes: Int32Array;
}

export interface EdgeEvidence {
  concept: string;
  /** fraction of w contributed by this concept, 0..1 */
  share: number;
  /** files carrying the concept in cluster a / cluster b */
  nA: number;
  nB: number;
}

export interface InterEdge {
  a: number;
  b: number;
  w: number;
  /** concepts with positive weight on both sides */
  shared: number;
  /** top contributions, strongest first (≤ maxEvidence) */
  evidence: EdgeEvidence[];
  /** fraction of w explained by the top-5 concepts */
  top5: number;
}

export interface WeakMatch { b: number; w: number; shared: number }

export interface InterResult {
  edges: InterEdge[];
  /** drawn-edge degree per cluster */
  degree: number[];
  /** clusters with no drawn edge, ascending */
  orphans: number[];
  /** orphan → best matches by weight, ignoring minShared (may be empty) */
  weak: Record<number, WeakMatch[]>;
}

export function clusterVectors(e: EncodedWeb, alpha = INTER_DEFAULTS.alpha): ClusterVectors {
  const C = e.clusterKeys.length;
  const N = e.n;
  const df = documentFrequency(e);
  const members = membersByCluster(e);
  const scratch = new Int32Array(e.conceptNames.length);
  const touched: number[] = [];
  const off = new Int32Array(C + 1);
  const ids: number[] = [];
  const vals: number[] = [];
  const counts: number[] = [];
  const sizes = new Int32Array(C);

  for (let a = 0; a < C; a++) {
    const mem = members[a];
    sizes[a] = mem.length;
    touched.length = 0;
    for (let m = 0; m < mem.length; m++) {
      const f = mem[m];
      for (let k = e.conceptOff[f]; k < e.conceptOff[f + 1]; k++) {
        const c = e.conceptIds[k];
        if (scratch[c] === 0) touched.push(c);
        scratch[c]++;
      }
    }
    touched.sort((x, y) => x - y);
    const start = ids.length;
    let norm = 0;
    for (const c of touched) {
      const n = scratch[c];
      scratch[c] = 0;
      if (df[c] < 2) continue;
      const p = df[c] / N;
      const s = (n + alpha * p) / (mem.length + alpha);
      const v = Math.log(s / p);
      if (!(v > 0)) continue;
      ids.push(c); vals.push(v); counts.push(n);
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let k = start; k < vals.length; k++) vals[k] /= norm;
    off[a + 1] = ids.length;
  }
  return { off, ids: Int32Array.from(ids), vals: Float64Array.from(vals), counts: Int32Array.from(counts), sizes };
}

/** Dense C×C pair accumulation (upper triangle, a < b): weight and shared-concept count. */
export function pairWeights(vec: ClusterVectors, conceptCount: number): { C: number; w: Float64Array; shared: Int32Array } {
  const C = vec.sizes.length;
  // inverted index concept → (cluster, value), clusters ascending
  const postOff = new Int32Array(conceptCount + 1);
  for (let k = 0; k < vec.ids.length; k++) postOff[vec.ids[k] + 1]++;
  for (let c = 0; c < conceptCount; c++) postOff[c + 1] += postOff[c];
  const postCluster = new Int32Array(vec.ids.length);
  const postVal = new Float64Array(vec.ids.length);
  const fill = postOff.slice(0, conceptCount);
  for (let a = 0; a < C; a++) {
    for (let k = vec.off[a]; k < vec.off[a + 1]; k++) {
      const c = vec.ids[k];
      const at = fill[c]++;
      postCluster[at] = a;
      postVal[at] = vec.vals[k];
    }
  }
  const w = new Float64Array(C * C);
  const shared = new Int32Array(C * C);
  for (let c = 0; c < conceptCount; c++) {
    const s = postOff[c], t = postOff[c + 1];
    for (let i = s; i < t; i++) {
      const a = postCluster[i], va = postVal[i];
      for (let j = i + 1; j < t; j++) {
        const idx = a * C + postCluster[j];
        w[idx] += va * postVal[j];
        shared[idx]++;
      }
    }
  }
  return { C, w, shared };
}

/** Every shared concept's contribution v̂_A(c)·v̂_B(c), strongest first (ties by concept id). */
export function edgeContributions(vec: ClusterVectors, a: number, b: number): { concept: number; contrib: number; nA: number; nB: number }[] {
  const out: { concept: number; contrib: number; nA: number; nB: number }[] = [];
  let i = vec.off[a], j = vec.off[b];
  const ie = vec.off[a + 1], je = vec.off[b + 1];
  while (i < ie && j < je) {
    const ci = vec.ids[i], cj = vec.ids[j];
    if (ci === cj) {
      out.push({ concept: ci, contrib: vec.vals[i] * vec.vals[j], nA: vec.counts[i], nB: vec.counts[j] });
      i++; j++;
    } else if (ci < cj) i++;
    else j++;
  }
  out.sort((x, y) => y.contrib - x.contrib || x.concept - y.concept);
  return out;
}

export function interEdges(e: EncodedWeb, opts: Partial<InterOptions> = {}): InterResult {
  const o = { ...INTER_DEFAULTS, ...opts };
  const vec = clusterVectors(e, o.alpha);
  const { C, w, shared } = pairWeights(vec, e.conceptNames.length);
  const W = (a: number, b: number) => (a < b ? w[a * C + b] : w[b * C + a]);
  const S = (a: number, b: number) => (a < b ? shared[a * C + b] : shared[b * C + a]);

  // top-k candidates per cluster
  const keep = new Set<number>();
  for (let a = 0; a < C; a++) {
    const cand: number[] = [];
    for (let b = 0; b < C; b++) {
      if (b === a) continue;
      if (S(a, b) >= o.minShared && W(a, b) >= o.wMin && W(a, b) > 0) cand.push(b);
    }
    cand.sort((x, y) => W(a, y) - W(a, x) || x - y);
    for (let r = 0; r < Math.min(o.k, cand.length); r++) {
      const b = cand[r];
      keep.add(a < b ? a * C + b : b * C + a);
    }
  }

  const edges: InterEdge[] = [];
  const degree = new Array<number>(C).fill(0);
  for (const idx of [...keep].sort((x, y) => x - y)) {
    const a = Math.floor(idx / C), b = idx % C;
    const weight = w[idx];
    const contribs = edgeContributions(vec, a, b);
    let top5 = 0;
    for (let r = 0; r < Math.min(5, contribs.length); r++) top5 += contribs[r].contrib;
    edges.push({
      a, b, w: weight, shared: shared[idx],
      evidence: contribs.slice(0, o.maxEvidence).map(c => ({
        concept: e.conceptNames[c.concept], share: c.contrib / weight, nA: c.nA, nB: c.nB,
      })),
      top5: top5 / weight,
    });
    degree[a]++; degree[b]++;
  }
  edges.sort((x, y) => y.w - x.w || x.a - y.a || x.b - y.b);

  const orphans: number[] = [];
  const weak: Record<number, WeakMatch[]> = {};
  for (let a = 0; a < C; a++) {
    if (degree[a] > 0) continue;
    orphans.push(a);
    const cand: number[] = [];
    for (let b = 0; b < C; b++) if (b !== a && W(a, b) > 0) cand.push(b);
    cand.sort((x, y) => W(a, y) - W(a, x) || x - y);
    weak[a] = cand.slice(0, o.weakCount).map(b => ({ b, w: W(a, b), shared: S(a, b) }));
  }
  return { edges, degree, orphans, weak };
}

/** Edges of one cluster, strongest first. */
export function edgesOf(r: Pick<InterResult, 'edges'>, cluster: number): InterEdge[] {
  return r.edges.filter(x => x.a === cluster || x.b === cluster);
}

export function isDiffuse(edge: Pick<InterEdge, 'top5'>): boolean {
  return edge.top5 < DIFFUSE_TOP5;
}
