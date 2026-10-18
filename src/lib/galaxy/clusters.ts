// Knowledge Galaxy — spatial clusters for nebulae + labels.
//
// Deterministic k-means (seeded k-means++) over the real PCA positions, then each
// cluster is labelled from what its members actually carry:
//   • top concept, when enough members have concepts  → kind 'concept'
//   • otherwise the dominant source folder            → kind 'folder' (shown as a folder)
// O(n·k·iters); for 13k stars × 12 × 12 that is ~2M distance ops.

import type { MapDocument } from '../../api/oracle';
import { sourceFolder } from './mapping';

export interface GalaxyCluster {
  id: number;
  label: string;
  kind: 'concept' | 'folder';
  size: number;
  /** centroid in world units */
  cx: number; cy: number; cz: number;
  /** RMS distance of members to the centroid (world units) */
  spread: number;
  /** most common doc type among members */
  dominantType: string;
}

/** mulberry32 — tiny seeded PRNG so clustering is stable between loads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function kmeans(positions: Float32Array, k: number, iters = 12, seed = 7): { assign: Int32Array; centroids: Float32Array } {
  const n = Math.floor(positions.length / 3);
  const assign = new Int32Array(n);
  k = Math.max(1, Math.min(k, n));
  const cent = new Float32Array(k * 3);
  if (n === 0) return { assign, centroids: cent };
  const rand = mulberry32(seed);

  // k-means++ init
  const first = Math.floor(rand() * n);
  cent[0] = positions[first * 3]; cent[1] = positions[first * 3 + 1]; cent[2] = positions[first * 3 + 2];
  const dist = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    const px = cent[(c - 1) * 3], py = cent[(c - 1) * 3 + 1], pz = cent[(c - 1) * 3 + 2];
    for (let i = 0; i < n; i++) {
      const dx = positions[i * 3] - px, dy = positions[i * 3 + 1] - py, dz = positions[i * 3 + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let target = rand() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) { target -= dist[i]; if (target <= 0) { pick = i; break; } }
    cent[c * 3] = positions[pick * 3]; cent[c * 3 + 1] = positions[pick * 3 + 1]; cent[c * 3 + 2] = positions[pick * 3 + 2];
  }

  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  for (let it = 0; it < iters; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = x - cent[c * 3], dy = y - cent[c * 3 + 1], dz = z - cent[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best || it === 0) { changed++; assign[i] = best; }
    }
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c * 3] += positions[i * 3]; sums[c * 3 + 1] += positions[i * 3 + 1]; sums[c * 3 + 2] += positions[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      cent[c * 3] = sums[c * 3] / counts[c]; cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c]; cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
    if (changed === 0 && it > 0) break;
  }
  return { assign, centroids: cent };
}

function topKey(counts: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [k, v] of counts) if (!best || v > best[1] || (v === best[1] && k < best[0])) best = [k, v];
  return best;
}

function topUnused(counts: Map<string, number>, used: Set<string>, prefix: string): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [k, v] of counts) {
    if (used.has(prefix + k)) continue;
    if (!best || v > best[1] || (v === best[1] && k < best[0])) best = [k, v];
  }
  return best;
}

/**
 * Cluster the galaxy and label each cluster from its members' real fields.
 * Returns at most `maxClusters`, largest first; tiny clusters (< minShare of all
 * stars) are dropped so labels never crowd.
 */
export function buildClusters(
  docs: MapDocument[],
  positions: Float32Array,
  opts: { maxClusters?: number; minShare?: number; seed?: number } = {},
): GalaxyCluster[] {
  const n = docs.length;
  if (n < 8) return [];
  const maxClusters = opts.maxClusters ?? 12;
  const k = Math.max(1, Math.min(maxClusters, Math.floor(n / 40)));
  const { assign, centroids } = kmeans(positions, k, 12, opts.seed ?? 7);

  const concept = Array.from({ length: k }, () => new Map<string, number>());
  const folder = Array.from({ length: k }, () => new Map<string, number>());
  const types = Array.from({ length: k }, () => new Map<string, number>());
  const withConcepts = new Int32Array(k);
  const size = new Int32Array(k);
  const sq = new Float64Array(k);

  for (let i = 0; i < n; i++) {
    const c = assign[i];
    const d = docs[i];
    size[c]++;
    const dx = positions[i * 3] - centroids[c * 3];
    const dy = positions[i * 3 + 1] - centroids[c * 3 + 1];
    const dz = positions[i * 3 + 2] - centroids[c * 3 + 2];
    sq[c] += dx * dx + dy * dy + dz * dz;
    const t = d.type || 'unknown';
    types[c].set(t, (types[c].get(t) || 0) + 1);
    if (d.concepts && d.concepts.length > 0) {
      withConcepts[c]++;
      for (const raw of d.concepts) {
        const key = raw.trim().toLowerCase();
        if (key) concept[c].set(key, (concept[c].get(key) || 0) + 1);
      }
    }
    if (d.source_file) {
      const f = sourceFolder(d.source_file);
      folder[c].set(f, (folder[c].get(f) || 0) + 1);
    }
  }

  const minSize = Math.max(2, Math.ceil(n * (opts.minShare ?? 0.015)));
  const order = Array.from({ length: k }, (_, c) => c)
    .filter(c => size[c] >= minSize)
    .sort((a, b) => size[b] - size[a])
    .slice(0, maxClusters);
  // Largest clusters pick first; a concept/folder already used by a bigger
  // cluster is skipped so 12 labels don't all read "pattern".
  const used = new Set<string>();
  const out: GalaxyCluster[] = [];
  for (const c of order) {
    const enoughConcepts = withConcepts[c] >= Math.max(3, size[c] * 0.1);
    const tc = enoughConcepts ? topUnused(concept[c], used, 'c:') : null;
    const tf = tc ? null : topUnused(folder[c], used, 'f:') ?? topKey(folder[c]);
    const label = tc ? tc[0] : tf ? tf[0] : '(unlabelled)';
    used.add((tc ? 'c:' : 'f:') + label);
    out.push({
      id: c,
      label,
      kind: tc ? 'concept' : 'folder',
      size: size[c],
      cx: centroids[c * 3], cy: centroids[c * 3 + 1], cz: centroids[c * 3 + 2],
      spread: Math.sqrt(sq[c] / size[c]),
      dominantType: topKey(types[c])?.[0] ?? 'unknown',
    });
  }
  return out;
}
