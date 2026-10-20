// Knowledge Web — cluster layout + star offsets (pure, deterministic, runs in the worker).
//
// Cluster PCA means are stacked (median nearest-neighbour distance 0.084 in a ±1
// cube; Unsorted, Helm and tor sit on top of each other), so centres come from a
// force layout SEEDED by the means:
//   start   mean PCA × 22 world units
//   springs on drawn links, rest = contact distance + SPRING_LEN · (1 − w)
//   anchor  weak pull back to each cluster's own seed (keeps semantic placement)
//   collide min centre distance = 1.15 · (R_a + R_b), heavier cluster moves less
// 300 iterations, then collision-only passes; no randomness anywhere.
//
// Size: R = 0.6 · n^(1/3) — one star per file at constant density → volume ∝ n.
// Stars keep their REAL PCA offset from the cluster mean, normalised by the
// cluster's rms: offset = (p − μ) / rms · R (soft-clamped past 2.5 R so a lone
// outlier can't sit inside a neighbour). The drill view scales it by DRILL_SCALE.

import type { EncodedWeb } from './encode';

export const RADIUS_K = 0.6;
export const PCA_SCALE = 22;
export const COLLIDE = 1.15;
export const SPRING_LEN = 8;
export const DRILL_SCALE = 3.2;
export const OFFSET_CLAMP = 2.5;

export interface LayoutOptions {
  iterations: number;
  /** extra collision-only passes after the main loop */
  settle: number;
  spring: number;
  anchor: number;
}

export const LAYOUT_DEFAULTS: Readonly<LayoutOptions> = { iterations: 300, settle: 60, spring: 0.04, anchor: 0.01 };

export function clusterRadius(n: number): number {
  return RADIUS_K * Math.cbrt(Math.max(1, n));
}

export interface ClusterStats {
  sizes: Int32Array;
  /** mean raw PCA position per cluster (C × 3) */
  means: Float64Array;
  /** rms distance to the mean, raw PCA units */
  rms: Float64Array;
}

export function clusterStats(e: Pick<EncodedWeb, 'n' | 'clusterKeys' | 'clusterOf' | 'pos'>): ClusterStats {
  const C = e.clusterKeys.length;
  const sizes = new Int32Array(C);
  const means = new Float64Array(C * 3);
  for (let i = 0; i < e.n; i++) {
    const c = e.clusterOf[i];
    sizes[c]++;
    means[c * 3] += e.pos[i * 3]; means[c * 3 + 1] += e.pos[i * 3 + 1]; means[c * 3 + 2] += e.pos[i * 3 + 2];
  }
  for (let c = 0; c < C; c++) if (sizes[c]) { means[c * 3] /= sizes[c]; means[c * 3 + 1] /= sizes[c]; means[c * 3 + 2] /= sizes[c]; }
  const rms = new Float64Array(C);
  for (let i = 0; i < e.n; i++) {
    const c = e.clusterOf[i];
    const dx = e.pos[i * 3] - means[c * 3], dy = e.pos[i * 3 + 1] - means[c * 3 + 1], dz = e.pos[i * 3 + 2] - means[c * 3 + 2];
    rms[c] += dx * dx + dy * dy + dz * dz;
  }
  for (let c = 0; c < C; c++) rms[c] = sizes[c] ? Math.sqrt(rms[c] / sizes[c]) : 0;
  return { sizes, means, rms };
}

export interface LayoutEdge { a: number; b: number; w: number }

/** Deterministic unit direction for a coincident pair (golden-angle spiral on the pair index). */
function pairDir(a: number, b: number): [number, number, number] {
  const k = a * 7919 + b * 104729;
  const y = 1 - 2 * (((k * 0.6180339887) % 1 + 1) % 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = k * 2.399963229728653;
  return [r * Math.cos(th), y, r * Math.sin(th)];
}

/**
 * Cluster centres in world units (C × 3). `means` are raw PCA (×PCA_SCALE here),
 * `radii` world units, `edges` the drawn inter links with weight in (0, 1].
 */
export function forceLayout(
  means: ArrayLike<number>,
  radii: ArrayLike<number>,
  edges: readonly LayoutEdge[],
  opts: Partial<LayoutOptions> = {},
): Float64Array {
  const o = { ...LAYOUT_DEFAULTS, ...opts };
  const C = radii.length;
  const p = new Float64Array(C * 3);
  const seed = new Float64Array(C * 3);
  for (let i = 0; i < C * 3; i++) { p[i] = means[i] * PCA_SCALE; seed[i] = p[i]; }
  const mass = new Float64Array(C);
  for (let c = 0; c < C; c++) mass[c] = Math.max(1e-6, radii[c] ** 3);

  const collide = () => {
    for (let a = 0; a < C; a++) {
      for (let b = a + 1; b < C; b++) {
        const min = COLLIDE * (radii[a] + radii[b]);
        let dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= min) continue;
        if (d < 1e-9) { [dx, dy, dz] = pairDir(a, b); d = 1e-9; } else { dx /= d; dy /= d; dz /= d; }
        const push = min - d;
        const ma = mass[a], mb = mass[b];
        const fa = mb / (ma + mb), fb = ma / (ma + mb);
        p[a * 3] -= dx * push * fa; p[a * 3 + 1] -= dy * push * fa; p[a * 3 + 2] -= dz * push * fa;
        p[b * 3] += dx * push * fb; p[b * 3 + 1] += dy * push * fb; p[b * 3 + 2] += dz * push * fb;
      }
    }
  };

  for (let it = 0; it < o.iterations; it++) {
    for (const e of edges) {
      const { a, b } = e;
      const w = Math.max(0, Math.min(1, e.w));
      const rest = COLLIDE * (radii[a] + radii[b]) + SPRING_LEN * (1 - w);
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const f = (o.spring * (d - rest)) / d;
      const ma = mass[a], mb = mass[b];
      const fa = mb / (ma + mb), fb = ma / (ma + mb);
      p[a * 3] += dx * f * fa; p[a * 3 + 1] += dy * f * fa; p[a * 3 + 2] += dz * f * fa;
      p[b * 3] -= dx * f * fb; p[b * 3 + 1] -= dy * f * fb; p[b * 3 + 2] -= dz * f * fb;
    }
    for (let i = 0; i < C * 3; i++) p[i] += o.anchor * (seed[i] - p[i]);
    collide();
  }
  for (let it = 0; it < o.settle; it++) collide();
  return p;
}

/**
 * Per-star overview offset from its cluster centre (n × 3, world units):
 * (p − μ) / rms · R, soft-clamped to OFFSET_CLAMP · R. Drill offset = × DRILL_SCALE.
 */
export function starOffsets(
  e: Pick<EncodedWeb, 'n' | 'clusterOf' | 'pos'>,
  stats: Pick<ClusterStats, 'means' | 'rms'>,
  radii: ArrayLike<number>,
): Float32Array {
  const out = new Float32Array(e.n * 3);
  for (let i = 0; i < e.n; i++) {
    const c = e.clusterOf[i];
    const rms = stats.rms[c];
    if (!(rms > 1e-9)) continue;
    const R = radii[c];
    let dx = (e.pos[i * 3] - stats.means[c * 3]) / rms * R;
    let dy = (e.pos[i * 3 + 1] - stats.means[c * 3 + 1]) / rms * R;
    let dz = (e.pos[i * 3 + 2] - stats.means[c * 3 + 2]) / rms * R;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const lim = OFFSET_CLAMP * R;
    if (r > 1e-12) {
      const s = (lim * Math.tanh(r / lim)) / r;
      dx *= s; dy *= s; dz *= s;
    }
    out[i * 3] = dx; out[i * 3 + 1] = dy; out[i * 3 + 2] = dz;
  }
  return out;
}

/** Bounding sphere of the laid-out clusters (centroid + farthest edge), for the home camera. */
export function layoutBounds(centres: ArrayLike<number>, radii: ArrayLike<number>): { cx: number; cy: number; cz: number; radius: number } {
  const C = radii.length;
  if (C === 0) return { cx: 0, cy: 0, cz: 0, radius: 1 };
  let cx = 0, cy = 0, cz = 0;
  for (let c = 0; c < C; c++) { cx += centres[c * 3]; cy += centres[c * 3 + 1]; cz += centres[c * 3 + 2]; }
  cx /= C; cy /= C; cz /= C;
  let radius = 0;
  for (let c = 0; c < C; c++) {
    const d = Math.hypot(centres[c * 3] - cx, centres[c * 3 + 1] - cy, centres[c * 3 + 2] - cz) + radii[c];
    if (d > radius) radius = d;
  }
  return { cx, cy, cz, radius: Math.max(1, radius) };
}
