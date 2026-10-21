// Knowledge Web — GPU-ready per-star / per-cluster arrays (pure; built once per data load).
// The engine uploads these as attributes; picking and framing use starWorldPos(), the
// same formula as WEB_POS minus the ≤ 2 % drift.

import { hexToRgb01 } from '../galaxy/mapping';
import { DRILL_SCALE, layoutBounds } from './layout';

export interface SceneInput {
  clusterOf: ArrayLike<number>;
  /** cluster centres (C × 3) */
  centres: ArrayLike<number>;
  radii: ArrayLike<number>;
  /** star overview offsets (n × 3) */
  offsets: ArrayLike<number>;
  /** hex per cluster */
  palette: readonly string[];
  /** 0..1 per star (drift phase) */
  phases: ArrayLike<number>;
  /** 0..1 per star (recency brightness) */
  brightness: ArrayLike<number>;
  /** Unsorted cluster index, -1 if none */
  unsorted: number;
}

export interface WebScene {
  n: number;
  C: number;
  clusterOf: Int32Array;
  centres: Float32Array;
  radii: Float32Array;
  starCentre: Float32Array;
  starOff: Float32Array;
  /** cluster, phase, R, brightness */
  starMeta: Float32Array;
  starColor: Float32Array;
  coreColor: Float32Array;
  /** cluster, R, state, unsorted flag */
  coreMeta: Float32Array;
  palette: string[];
  unsorted: number;
  bounds: { cx: number; cy: number; cz: number; radius: number };
}

export function buildScene(s: SceneInput): WebScene {
  const n = s.clusterOf.length;
  const C = s.radii.length;
  const rgb = s.palette.map(hexToRgb01);
  const clusterOf = Int32Array.from(s.clusterOf as ArrayLike<number>);
  const centres = Float32Array.from(s.centres as ArrayLike<number>);
  const radii = Float32Array.from(s.radii as ArrayLike<number>);
  const starCentre = new Float32Array(n * 3);
  const starOff = Float32Array.from(s.offsets as ArrayLike<number>);
  const starMeta = new Float32Array(n * 4);
  const starColor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = clusterOf[i];
    starCentre[i * 3] = centres[c * 3]; starCentre[i * 3 + 1] = centres[c * 3 + 1]; starCentre[i * 3 + 2] = centres[c * 3 + 2];
    starMeta[i * 4] = c;
    starMeta[i * 4 + 1] = s.phases[i];
    starMeta[i * 4 + 2] = radii[c];
    starMeta[i * 4 + 3] = s.brightness[i];
    const col = rgb[c] ?? [0.53, 0.53, 0.53];
    starColor[i * 3] = col[0]; starColor[i * 3 + 1] = col[1]; starColor[i * 3 + 2] = col[2];
  }
  const coreColor = new Float32Array(C * 3);
  const coreMeta = new Float32Array(C * 4);
  for (let c = 0; c < C; c++) {
    const col = rgb[c] ?? [0.53, 0.53, 0.53];
    coreColor[c * 3] = col[0]; coreColor[c * 3 + 1] = col[1]; coreColor[c * 3 + 2] = col[2];
    coreMeta[c * 4] = c;
    coreMeta[c * 4 + 1] = radii[c];
    coreMeta[c * 4 + 2] = 0;
    coreMeta[c * 4 + 3] = c === s.unsorted ? 1 : 0;
  }
  return {
    n, C, clusterOf, centres, radii, starCentre, starOff, starMeta, starColor, coreColor, coreMeta,
    palette: [...s.palette], unsorted: s.unsorted, bounds: layoutBounds(centres, radii),
  };
}

/** A star's world position without drift; `drill` 0..1 expands the drilled cluster by DRILL_SCALE. */
export function starWorldPos(sc: Pick<WebScene, 'starCentre' | 'starOff' | 'clusterOf'>, i: number, drill = 0, drillCluster = -1, out: number[] = [0, 0, 0]): number[] {
  const k = sc.clusterOf[i] === drillCluster ? 1 + (DRILL_SCALE - 1) * drill : 1;
  out[0] = sc.starCentre[i * 3] + sc.starOff[i * 3] * k;
  out[1] = sc.starCentre[i * 3 + 1] + sc.starOff[i * 3 + 1] * k;
  out[2] = sc.starCentre[i * 3 + 2] + sc.starOff[i * 3 + 2] * k;
  return out;
}

/** World positions of every star (n × 3) at a drill state — for the pick grid and framing. */
export function starWorldPositions(sc: Pick<WebScene, 'starCentre' | 'starOff' | 'clusterOf'>, drill: number, drillCluster: number, out?: Float32Array): Float32Array {
  const n = sc.clusterOf.length;
  const p = out ?? new Float32Array(n * 3);
  const tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    starWorldPos(sc, i, drill, drillCluster, tmp);
    p[i * 3] = tmp[0]; p[i * 3 + 1] = tmp[1]; p[i * 3 + 2] = tmp[2];
  }
  return p;
}

/** Star indices of one cluster. */
export function starsOf(sc: Pick<WebScene, 'clusterOf'>, cluster: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < sc.clusterOf.length; i++) if (sc.clusterOf[i] === cluster) out.push(i);
  return out;
}
