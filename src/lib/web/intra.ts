// Knowledge Web — intra-cluster links for the tapped cluster (A2, Wanted 3), pure.
//
// Cosine over binary concept vectors with CLUSTER-LOCAL idf, idf_A(c) = log(|A| / n_A(c)),
// so a concept every member carries (dopelab inside marketing) links nothing.
//   norm_i  = sqrt(Σ_{c ∈ i} idf²)            all of i's concepts, incl. n_A = 1
//   cos(i,j) = Σ_{c ∈ i ∩ j} idf² / (norm_i · norm_j)
//
// Candidates: files that share at least one concept with 2 ≤ n_A(c) ≤ pMax
// (posting walk, O(Σ n_A(c)²) over capped concepts — never O(n²)). EVERY candidate
// is rescored exactly over all shared concepts (capped + broad), so:
//   • pMax = ∞ → identical to brute force;
//   • with the cap, every reported score is exact; only files linked solely by
//     broad concepts can be missed (honest "coverage" in the HUD).
// Keep each file's top-K with cos ≥ τ. Ties break on the canonical file rank.

import type { EncodedWeb } from './encode';

export interface IntraOptions {
  /** posting lists longer than this are "broad": not walked for candidates, still scored */
  pMax: number;
  /** neighbours kept per file */
  k: number;
  /** minimum cosine */
  tau: number;
}

export const INTRA_DEFAULTS: Readonly<IntraOptions> = { pMax: 400, k: 6, tau: 0.12 };

export interface IntraResult {
  cluster: number;
  /** member file indices (global), ascending */
  members: Int32Array;
  /** per member: CSR into nbr/score (length members + 1) */
  nbrOff: Int32Array;
  /** neighbour file indices (global), strongest first */
  nbr: Int32Array;
  score: Float64Array;
  /** undirected edges (global file indices), strongest first */
  edgeI: Int32Array;
  edgeJ: Int32Array;
  edgeS: Float64Array;
  /** members with ≥ 1 link */
  covered: number;
  /** covered / members (0 for an empty cluster) */
  coverage: number;
  /** candidate posting visits (cost) */
  postingOps: number;
}

export function membersOf(e: Pick<EncodedWeb, 'n' | 'clusterOf'>, cluster: number): Int32Array {
  let k = 0;
  for (let i = 0; i < e.n; i++) if (e.clusterOf[i] === cluster) k++;
  const out = new Int32Array(k);
  k = 0;
  for (let i = 0; i < e.n; i++) if (e.clusterOf[i] === cluster) out[k++] = i;
  return out;
}

export function intraEdges(
  e: EncodedWeb,
  cluster: number,
  opts: Partial<IntraOptions> = {},
  members: Int32Array = membersOf(e, cluster),
): IntraResult {
  const o = { ...INTRA_DEFAULTS, ...opts };
  const S = members.length;
  const rank = e.rank;

  // ── local concept table (ids follow the global ascending order inside each file) ──
  const localOf = new Int32Array(e.conceptNames.length).fill(-1);
  const nA: number[] = [];
  const off = new Int32Array(S + 1);
  const lc: number[] = [];
  for (let li = 0; li < S; li++) {
    const f = members[li];
    for (let k = e.conceptOff[f]; k < e.conceptOff[f + 1]; k++) {
      const c = e.conceptIds[k];
      let l = localOf[c];
      if (l < 0) { l = nA.length; localOf[c] = l; nA.push(0); }
      nA[l]++;
      lc.push(l);
    }
    off[li + 1] = lc.length;
  }
  const L = nA.length;
  const idf2 = new Float64Array(L);
  for (let l = 0; l < L; l++) { const v = Math.log(S / nA[l]); idf2[l] = v * v; }
  const norm = new Float64Array(S);
  for (let li = 0; li < S; li++) {
    let s = 0;
    for (let k = off[li]; k < off[li + 1]; k++) s += idf2[lc[k]];
    norm[li] = Math.sqrt(s);
  }

  // ── capped postings + broad-concept membership flags ──
  const isCapped = new Uint8Array(L);
  for (let l = 0; l < L; l++) isCapped[l] = nA[l] >= 2 && nA[l] <= o.pMax ? 1 : 0;
  const pOff = new Int32Array(L + 1);
  for (let k = 0; k < lc.length; k++) if (isCapped[lc[k]]) pOff[lc[k] + 1]++;
  for (let l = 0; l < L; l++) pOff[l + 1] += pOff[l];
  const post = new Int32Array(pOff[L]);
  const pFill = pOff.slice(0, L);
  for (let li = 0; li < S; li++) for (let k = off[li]; k < off[li + 1]; k++) {
    const l = lc[k];
    if (isCapped[l]) post[pFill[l]++] = li;
  }
  // broad = too common to walk (n_A > pMax) but still weighted; idf = 0 adds nothing
  const broad: (Uint8Array | null)[] = new Array(L).fill(null);
  let anyBroad = false;
  for (let l = 0; l < L; l++) if (nA[l] > o.pMax && idf2[l] > 0) { broad[l] = new Uint8Array(S); anyBroad = true; }
  if (anyBroad) {
    for (let li = 0; li < S; li++) for (let k = off[li]; k < off[li + 1]; k++) {
      const f = broad[lc[k]];
      if (f) f[li] = 1;
    }
  }

  // ── per-file candidates, exact rescoring, top-K ──
  const acc = new Float64Array(S);
  const stamp = new Int32Array(S).fill(-1);
  const touched: number[] = [];
  const K = Math.max(0, o.k);
  const topJ = new Int32Array(K);
  const topS = new Float64Array(K);
  const nbrOff = new Int32Array(S + 1);
  const nbr: number[] = [];
  const score: number[] = [];
  let ops = 0;
  let covered = 0;
  const broadOfI: number[] = [];
  const broadFlagsI: Uint8Array[] = [];
  const better = (s: number, j: number, s2: number, j2: number) =>
    s > s2 || (s === s2 && rank[members[j]] < rank[members[j2]]);

  for (let li = 0; li < S; li++) {
    touched.length = 0;
    broadOfI.length = 0;
    broadFlagsI.length = 0;
    if (norm[li] > 0) {
      for (let k = off[li]; k < off[li + 1]; k++) {
        const l = lc[k];
        if (isCapped[l]) {
          const w = idf2[l];
          for (let p = pOff[l]; p < pOff[l + 1]; p++) {
            const lj = post[p];
            if (lj === li) continue;
            if (stamp[lj] !== li) { stamp[lj] = li; acc[lj] = 0; touched.push(lj); }
            acc[lj] += w;
          }
          ops += pOff[l + 1] - pOff[l];
        } else if (broad[l]) { broadOfI.push(l); broadFlagsI.push(broad[l]!); }
      }
    }
    let n = 0;
    for (const lj of touched) {
      if (norm[lj] === 0) continue;
      let dot = acc[lj];
      for (let q = 0; q < broadOfI.length; q++) if (broadFlagsI[q][lj]) dot += idf2[broadOfI[q]];
      const s = dot / (norm[li] * norm[lj]);
      if (!(s >= o.tau)) continue;
      // insert into the fixed top-K buffer (sorted strongest first)
      if (n < K) {
        let p = n++;
        while (p > 0 && better(s, lj, topS[p - 1], topJ[p - 1])) { topS[p] = topS[p - 1]; topJ[p] = topJ[p - 1]; p--; }
        topS[p] = s; topJ[p] = lj;
      } else if (K > 0 && better(s, lj, topS[K - 1], topJ[K - 1])) {
        let p = K - 1;
        while (p > 0 && better(s, lj, topS[p - 1], topJ[p - 1])) { topS[p] = topS[p - 1]; topJ[p] = topJ[p - 1]; p--; }
        topS[p] = s; topJ[p] = lj;
      }
    }
    for (let r = 0; r < n; r++) { nbr.push(members[topJ[r]]); score.push(topS[r]); }
    if (n > 0) covered++;
    nbrOff[li + 1] = nbr.length;
  }

  // ── undirected edge list ──
  const seen = new Map<number, number>();
  const ei: number[] = [], ej: number[] = [], es: number[] = [];
  const localIdx = new Map<number, number>();
  for (let li = 0; li < S; li++) localIdx.set(members[li], li);
  for (let li = 0; li < S; li++) {
    for (let k = nbrOff[li]; k < nbrOff[li + 1]; k++) {
      const lj = localIdx.get(nbr[k])!;
      const a = Math.min(li, lj), b = Math.max(li, lj);
      const key = a * S + b;
      if (seen.has(key)) continue;
      seen.set(key, ei.length);
      ei.push(members[a]); ej.push(members[b]); es.push(score[k]);
    }
  }
  const order = ei.map((_, x) => x).sort((x, y) => {
    if (es[y] !== es[x]) return es[y] - es[x];
    const rx = Math.min(rank[ei[x]], rank[ej[x]]), ry = Math.min(rank[ei[y]], rank[ej[y]]);
    if (rx !== ry) return rx - ry;
    return Math.max(rank[ei[x]], rank[ej[x]]) - Math.max(rank[ei[y]], rank[ej[y]]);
  });

  return {
    cluster,
    members,
    nbrOff,
    nbr: Int32Array.from(nbr),
    score: Float64Array.from(score),
    edgeI: Int32Array.from(order.map(x => ei[x])),
    edgeJ: Int32Array.from(order.map(x => ej[x])),
    edgeS: Float64Array.from(order.map(x => es[x])),
    covered,
    coverage: S > 0 ? covered / S : 0,
    postingOps: ops,
  };
}

/** A member's neighbours (global indices + scores), strongest first. */
export function neighboursOf(r: IntraResult, file: number): { file: number; score: number }[] {
  let li = -1;
  // members is ascending → binary search
  let lo = 0, hi = r.members.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (r.members[mid] === file) { li = mid; break; }
    if (r.members[mid] < file) lo = mid + 1; else hi = mid - 1;
  }
  if (li < 0) return [];
  const out: { file: number; score: number }[] = [];
  for (let k = r.nbrOff[li]; k < r.nbrOff[li + 1]; k++) out.push({ file: r.nbr[k], score: r.score[k] });
  return out;
}

/** Concepts two files share (names), for the link chips. */
export function sharedConcepts(e: Pick<EncodedWeb, 'conceptOff' | 'conceptIds' | 'conceptNames'>, a: number, b: number): string[] {
  const out: string[] = [];
  let i = e.conceptOff[a], j = e.conceptOff[b];
  const ie = e.conceptOff[a + 1], je = e.conceptOff[b + 1];
  while (i < ie && j < je) {
    const x = e.conceptIds[i], y = e.conceptIds[j];
    if (x === y) { out.push(e.conceptNames[x]); i++; j++; }
    else if (x < y) i++;
    else j++;
  }
  return out;
}
