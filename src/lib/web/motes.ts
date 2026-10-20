// Knowledge Web — chunk motes (A5): one tiny particle per indexed chunk, orbiting its file's star.
//
// Counts: real per-file chunk counts when arra emits them (map3d `chunks`, arra
// story tordash/arra-oracle-v3#90), read through galaxy's chunkCount(); until then
// an ESTIMATE that spreads the real total pca_info.n_vectors over the files by
// largest remainder (77,970 over 13,089 → 12,525 files × 6 + 564 × 5), the +1s going
// to files picked by a seeded hash of the id, so the total is exact. The UI labels
// it as an estimate until ≥ 95 % of files carry a real count.
//
// Buffers: motes are stored cluster-contiguous, each cluster's slice internally
// shuffled (seeded), so a drill drawRange prefix is a uniform sample of that
// cluster; the overview uses a global seeded permutation index so a drawRange
// prefix is a uniform sample of everything. Same attributes, two index buffers.

import { chunkCount } from '../galaxy/mapping';
import type { MapDocument } from '../../api/oracle';
import { speedFromCreatedAt, hashTilt } from '../planets/orbits';
import { mulberry32 } from '../galaxy/clusters';
import { fnv1a, hashOnSphere, xxhash } from './hash';

export const REAL_COUNT_SHARE = 0.95;

export type MoteSource = 'real' | 'estimate' | 'none';

export interface MoteCounts {
  counts: Int32Array;
  source: MoteSource;
  total: number;
  /** files that carried a real count (source 'real' may still estimate a few) */
  withReal: number;
}

type CountDoc = Pick<MapDocument, 'id'> & { chunks?: number; chunk_ids?: string[] };

/**
 * Per-file mote counts. Real counts when ≥ 95 % of files have one (the rest get
 * the rounded mean of the real ones); else the largest-remainder estimate of
 * `nVectors`; 'none' when neither is known.
 */
export function moteCounts(docs: readonly CountDoc[], nVectors: number | null | undefined): MoteCounts {
  const n = docs.length;
  const counts = new Int32Array(n);
  let withReal = 0, realSum = 0;
  const real = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const c = chunkCount(docs[i] as MapDocument & { chunks?: number });
    if (c != null) { real[i] = c; withReal++; realSum += c; }
  }
  if (n > 0 && withReal / n >= REAL_COUNT_SHARE) {
    const fill = Math.max(1, Math.round(realSum / withReal));
    let total = 0;
    for (let i = 0; i < n; i++) { counts[i] = real[i] >= 0 ? real[i] : fill; total += counts[i]; }
    return { counts, source: 'real', total, withReal };
  }
  if (!(typeof nVectors === 'number' && nVectors > 0) || n === 0) {
    return { counts, source: 'none', total: 0, withReal };
  }
  const base = Math.floor(nVectors / n);
  const extra = nVectors - base * n;
  counts.fill(base);
  if (extra > 0) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const ha = fnv1a(docs[a].id), hb = fnv1a(docs[b].id);
      return ha - hb || (docs[a].id < docs[b].id ? -1 : docs[a].id > docs[b].id ? 1 : 0);
    });
    for (let k = 0; k < extra; k++) counts[order[k]]++;
  }
  return { counts, source: 'estimate', total: nVectors, withReal };
}

/** Per-file inputs for building motes. */
export interface MoteStars {
  /** star → cluster */
  clusterOf: ArrayLike<number>;
  /** cluster centres (C × 3) */
  centres: ArrayLike<number>;
  /** star overview offsets (n × 3) */
  offsets: ArrayLike<number>;
  ids: readonly string[];
  createdAt: readonly (string | null | undefined)[];
  /** canonical star order inside a cluster (EncodedWeb.rank) */
  rank: ArrayLike<number>;
}

export interface MoteBuffers {
  count: number;
  /** star centre (cluster centre), 3 per mote */
  centre: Float32Array;
  /** star overview offset, 3 per mote */
  offset: Float32Array;
  /** orbit normal as (θ, φ) spherical angles, 2 per mote */
  axis: Float32Array;
  /** (orbit radius ×star size, phase 0..1, angular speed rad/s, cluster id), 4 per mote */
  orbit: Float32Array;
  /** mote → star */
  starOf: Int32Array;
  /** per cluster: [start, count] into the attribute order (drill draw range) */
  slices: Int32Array;
  /** global seeded permutation (overview draw order) */
  overviewIndex: Uint32Array;
}

const SEED_AXIS = 0x5eed;
const SEED_JITTER = 0x51de;
const SEED_PHASE = 0x9a5e;
const SEED_SPEED = 0x5bee;
/** orbits.ts speeds are 0.001–0.003 (planets per frame); × this → 0.12–0.36 rad/s */
export const MOTE_SPEED_K = 120;

export function buildMotes(counts: ArrayLike<number>, stars: MoteStars, clusterCount: number, now = Date.now()): MoteBuffers {
  const n = counts.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(0, counts[i]);

  // star order: by cluster, then canonical rank → contiguous slices
  const starOrder = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => stars.clusterOf[a] - stars.clusterOf[b] || stars.rank[a] - stars.rank[b]);
  const slices = new Int32Array(clusterCount * 2);
  const centre = new Float32Array(total * 3);
  const offset = new Float32Array(total * 3);
  const axis = new Float32Array(total * 2);
  const orbit = new Float32Array(total * 4);
  const starOf = new Int32Array(total);

  // pass 1: write motes cluster-contiguous
  let m = 0;
  for (const s of starOrder) {
    const c = stars.clusterOf[s];
    const k = Math.max(0, counts[s]);
    if (k === 0) continue;
    const h = fnv1a(stars.ids[s]);
    const tilt = hashTilt(stars.ids[s]) / 0.3; // 0..1: neat ring … loose cloud
    const base = hashOnSphere(SEED_AXIS, h);
    const speed = speedFromCreatedAt(stars.createdAt[s], now) * MOTE_SPEED_K;
    for (let j = 0; j < k; j++, m++) {
      const jit = hashOnSphere(SEED_JITTER, (h + j * 2654435761) >>> 0);
      const spread = 0.25 + 1.5 * tilt;
      let ax = base[0] + spread * jit[0], ay = base[1] + spread * jit[1], az = base[2] + spread * jit[2];
      const len = Math.hypot(ax, ay, az) || 1;
      ax /= len; ay /= len; az /= len;
      centre[m * 3] = stars.centres[c * 3]; centre[m * 3 + 1] = stars.centres[c * 3 + 1]; centre[m * 3 + 2] = stars.centres[c * 3 + 2];
      offset[m * 3] = stars.offsets[s * 3]; offset[m * 3 + 1] = stars.offsets[s * 3 + 1]; offset[m * 3 + 2] = stars.offsets[s * 3 + 2];
      axis[m * 2] = Math.acos(Math.max(-1, Math.min(1, az)));
      axis[m * 2 + 1] = Math.atan2(ay, ax);
      const r = xxhash(SEED_PHASE + 1, (h + j) >>> 0);
      orbit[m * 4] = 1.6 + 1.9 * r;                                            // 1.6–3.5 × star size
      orbit[m * 4 + 1] = xxhash(SEED_PHASE, (h + j) >>> 0);                    // phase
      orbit[m * 4 + 2] = speed * (0.8 + 0.4 * xxhash(SEED_SPEED, (h + j) >>> 0)) * (1.9 - 0.9 * (r)); // inner motes faster
      orbit[m * 4 + 3] = c;
      starOf[m] = s;
    }
  }

  // slices
  {
    let start = 0, cur = -1;
    for (let q = 0; q < total; q++) {
      const c = orbit[q * 4 + 3];
      if (c !== cur) {
        if (cur >= 0) slices[cur * 2 + 1] = q - start;
        cur = c; start = q; slices[c * 2] = q;
      }
    }
    if (cur >= 0) slices[cur * 2 + 1] = total - start;
  }

  // pass 2: shuffle inside each slice (seeded), so a draw-range prefix is uniform
  const perm = new Int32Array(total);
  for (let q = 0; q < total; q++) perm[q] = q;
  for (let c = 0; c < clusterCount; c++) {
    const s0 = slices[c * 2], len = slices[c * 2 + 1];
    const rand = mulberry32(0xc0ffee + c);
    for (let i = len - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = perm[s0 + i]; perm[s0 + i] = perm[s0 + j]; perm[s0 + j] = t;
    }
  }
  const out: MoteBuffers = {
    count: total,
    centre: permute(centre, perm, 3),
    offset: permute(offset, perm, 3),
    axis: permute(axis, perm, 2),
    orbit: permute(orbit, perm, 4),
    starOf: permuteInt(starOf, perm),
    slices,
    overviewIndex: moteIndices(total),
  };
  return out;
}

function permute(src: Float32Array, perm: Int32Array, w: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let q = 0; q < perm.length; q++) for (let k = 0; k < w; k++) out[q * w + k] = src[perm[q] * w + k];
  return out;
}

function permuteInt(src: Int32Array, perm: Int32Array): Int32Array {
  const out = new Int32Array(src.length);
  for (let q = 0; q < perm.length; q++) out[q] = src[perm[q]];
  return out;
}

/** Global seeded permutation 0..total-1 (overview index buffer). */
export function moteIndices(total: number, seed = 0x0dd5): Uint32Array {
  const idx = new Uint32Array(total);
  for (let i = 0; i < total; i++) idx[i] = i;
  const rand = mulberry32(seed);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

/** Overview draw count for a tier budget (× governor scale). */
export function overviewDrawCount(total: number, cap: number, scale = 1): number {
  return Math.max(0, Math.min(total, Math.floor(cap * scale)));
}

/** Drill draw range for one cluster: its slice, capped. */
export function drillDrawRange(slices: Int32Array, cluster: number, cap: number, scale = 1): { start: number; count: number } {
  const start = slices[cluster * 2] ?? 0;
  const len = slices[cluster * 2 + 1] ?? 0;
  return { start, count: Math.max(0, Math.min(len, Math.floor(cap * scale))) };
}

/** HUD text for the mote layer — never claims precision it doesn't have. */
export function moteLabel(m: Pick<MoteCounts, 'source' | 'total' | 'counts' | 'withReal'>): string {
  if (m.source === 'none') return 'Chunk particles unavailable · no chunk total from the index';
  if (m.source === 'real') {
    const missing = m.counts.length - m.withReal;
    return missing > 0
      ? `${m.total.toLocaleString('en-US')} chunks · exact counts for ${m.withReal.toLocaleString('en-US')} of ${m.counts.length.toLocaleString('en-US')} files`
      : `${m.total.toLocaleString('en-US')} chunks · exact counts`;
  }
  const per = m.counts.length ? m.total / m.counts.length : 0;
  return `≈${Math.round(per)} per file · estimated from ${m.total.toLocaleString('en-US')} indexed chunks · exact counts pending arra`;
}
