// Knowledge Web — view-dependent camera framing (pure, no three).
//
// galaxy's frame.ts fits a bounding SPHERE through the tighter half-FOV, which is
// right for any view direction but wastes the long screen axis, and a percentile
// radius around a centroid hides a far lobe (studio#12 T21: Helm's drill has ~13 %
// of its files in a lobe ~60 units out; framing the 85th-percentile radius and then
// clamping to the home distance left that lobe — and every link into it — off-screen).
//
// fitView projects the actual points onto the camera basis for a given yaw/pitch and
// solves, per point, the distance at which it lands inside `fill` of the FREE
// viewport (canvas minus HUD / card insets), exactly for a perspective camera:
//   NDC x = u / ((d − w) · tan(hfov/2))  ≤ fill · freeW / W   →   d ≥ w + |u| / (tx · fill · freeW/W)
// (u, v, w = offsets along right, up, back from the target). The answer is the
// `percentile` of those distances; the target is the centre of the trimmed u/v range,
// shifted so the content centres in the free rect rather than under a card.

import type { Vec3 } from './camera';
import { PEEK_PX } from '../ui/sheet-snap';

export interface FitInsets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Readonly<FitInsets> = { top: 0, right: 0, bottom: 0, left: 0 };

export interface FitOptions {
  fovDeg: number;
  /** canvas size, CSS px */
  width: number;
  height: number;
  /** share of the free viewport the content spans on its tighter axis (0.8 → 80 %) */
  fill?: number;
  /** 1 = every point on screen; 0.99 = ignore the farthest 1 % */
  percentile?: number;
  /** CSS px covered by HUD / cards; the content centres in what is left */
  insets?: FitInsets;
}

export interface Fit {
  target: Vec3;
  dist: number;
}

/** The rig camera's basis (three.js lookAt with up = +Y): right, up, back (target → camera). */
export function rigBasis(yaw: number, pitch: number): { right: Vec3; up: Vec3; back: Vec3 } {
  const cp = Math.cos(pitch);
  const back: Vec3 = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const rl = Math.hypot(back[2], back[0]) || 1;
  const right: Vec3 = [back[2] / rl, 0, -back[0] / rl];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  return { right, up, back };
}

function quantile(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  const q = Math.min(1, Math.max(0, p));
  return sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
}

/**
 * Target + distance that frame `points` (n × 3, or the listed `indices`) at this
 * yaw/pitch. Null when there is nothing to frame.
 */
export function fitView(points: ArrayLike<number>, indices: readonly number[] | null, yaw: number, pitch: number, o: FitOptions): Fit | null {
  const n = indices ? indices.length : Math.floor(points.length / 3);
  if (n === 0) return null;
  const fill = Math.min(1, Math.max(0.05, o.fill ?? 0.8));
  const pct = Math.min(1, Math.max(0.5, o.percentile ?? 1));
  const ins = o.insets ?? NO_INSETS;
  const W = Math.max(1, o.width), H = Math.max(1, o.height);
  const freeW = Math.max(W * 0.3, W - ins.left - ins.right);
  const freeH = Math.max(H * 0.3, H - ins.top - ins.bottom);
  const ty = Math.tan((o.fovDeg * Math.PI) / 360);
  const tx = ty * (W / H);
  const kx = tx * fill * (freeW / W);
  const ky = ty * fill * (freeH / H);

  const { right, up, back } = rigBasis(yaw, pitch);
  const U = new Float64Array(n), V = new Float64Array(n), D = new Float64Array(n);
  let wSum = 0;
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k;
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    U[k] = x * right[0] + y * right[1] + z * right[2];
    V[k] = x * up[0] + y * up[1] + z * up[2];
    D[k] = x * back[0] + y * back[1] + z * back[2];
    wSum += D[k];
  }
  const us = Float64Array.from(U).sort(), vs = Float64Array.from(V).sort();
  const uc = (quantile(us, 1 - pct) + quantile(us, pct)) / 2;
  const vc = (quantile(vs, 1 - pct) + quantile(vs, pct)) / 2;
  const wc = wSum / n;

  const need = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const w = D[k] - wc;
    need[k] = w + Math.max(Math.abs(U[k] - uc) / kx, Math.abs(V[k] - vc) / ky);
  }
  need.sort();
  const dist = Math.max(1e-3, quantile(need, pct));

  // centre the content in the free rect: shift the look-at point the other way
  const wpp = (2 * dist * ty) / H; // world units per CSS px at the target's depth
  const ox = ((ins.left - ins.right) / 2) * wpp;
  const oy = ((ins.top - ins.bottom) / 2) * wpp;
  const cu = uc - ox, cv = vc + oy;
  const target: Vec3 = [
    right[0] * cu + up[0] * cv + back[0] * wc,
    right[1] * cu + up[1] * cv + back[1] * wc,
    right[2] * cu + up[2] * cv + back[2] * wc,
  ];
  return { target, dist };
}

export interface HomePose extends Fit {
  yaw: number;
  pitch: number;
}

export const HOME_YAW = 0;
export const HOME_PITCH = 0.32;
export const HOME_FILL = 0.8;
/** the overview ignores the farthest 1 % of stars (a few strays must not shrink the web) */
export const HOME_PERCENTILE = 0.99;
const SEARCH_PITCHES = [0.32, 0.6, 0.9, 1.2];
const SEARCH_YAWS = 12;

/**
 * The overview's home pose. The default angle, unless another yaw/pitch frames the web
 * at least 10 % tighter: the layout is ~1.7 : 1 wide, so on a portrait phone a raised,
 * turned view lays its long axis down the screen (T21: 390 px went from a width-limited
 * strip to a fuller frame). Searched on a ≤ `sampleMax` subsample; the final fit uses all.
 */
export function homePose(points: ArrayLike<number>, o: FitOptions, sampleMax = 2000): HomePose | null {
  const n = Math.floor(points.length / 3);
  if (n === 0) return null;
  const opts: FitOptions = { fill: HOME_FILL, percentile: HOME_PERCENTILE, ...o };
  const stride = Math.max(1, Math.ceil(n / sampleMax));
  const sample: number[] = [];
  for (let i = 0; i < n; i += stride) sample.push(i);
  const def = fitView(points, sample, HOME_YAW, HOME_PITCH, opts)!;
  let best = { yaw: HOME_YAW, pitch: HOME_PITCH, dist: def.dist };
  for (let k = 0; k < SEARCH_YAWS; k++) {
    for (const pitch of SEARCH_PITCHES) {
      const yaw = (k * 2 * Math.PI) / SEARCH_YAWS;
      const f = fitView(points, sample, yaw, pitch, opts)!;
      if (f.dist < best.dist - 1e-9) best = { yaw, pitch, dist: f.dist };
    }
  }
  const pose = best.dist <= def.dist * 0.9 ? best : { yaw: HOME_YAW, pitch: HOME_PITCH };
  const f = fitView(points, null, pose.yaw, pose.pitch, opts)!;
  return { ...f, yaw: pose.yaw, pitch: pose.pitch };
}

/** `target` (radians) shifted by whole turns to be the nearest to `from` — Home never spins a lap. */
export function nearestAngle(from: number, target: number): number {
  const tau = 2 * Math.PI;
  const d = ((((target - from) % tau) + tau * 1.5) % tau) - tau / 2;
  return from + d;
}

/**
 * Screen-space check used by the tests (and handy for debugging): CSS px of a world
 * point for a rig pose — the same projection three.js does for the rig camera.
 */
export function projectForRig(p: Vec3, target: Vec3, dist: number, yaw: number, pitch: number, fovDeg: number, width: number, height: number): { x: number; y: number; depth: number } {
  const { right, up, back } = rigBasis(yaw, pitch);
  const cam: Vec3 = [target[0] + back[0] * dist, target[1] + back[1] * dist, target[2] + back[2] * dist];
  const r: Vec3 = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const depth = -(r[0] * back[0] + r[1] * back[1] + r[2] * back[2]);
  const ty = Math.tan((fovDeg * Math.PI) / 360);
  const tx = ty * (width / height);
  const nx = (r[0] * right[0] + r[1] * right[1] + r[2] * right[2]) / (depth * tx);
  const ny = (r[0] * up[0] + r[1] * up[1] + r[2] * up[2]) / (depth * ty);
  return { x: (nx + 1) * 0.5 * width, y: (1 - ny) * 0.5 * height, depth };
}

/** Desktop peek card (bottom-left): 16 px margin + 380 px card + 8 px gap. */
export const PEEK_PANEL_INSET = 404;
/** Desktop zoom column on the right: 44 px buttons + 16 px margin + 4 px gap. */
export const CONTROLS_INSET = 64;

/**
 * What covers the canvas, for framing: the HUD row on top (measured), and — inside a
 * drill — the cluster's peek card (desktop, left) or peek sheet (phone, bottom).
 */
export function frameInsets(o: { wide: boolean; drilled: boolean; hudBottom: number }): FitInsets {
  return {
    top: Math.max(0, o.hudBottom) + 8,
    right: o.wide ? CONTROLS_INSET : 0,
    bottom: !o.wide && o.drilled ? PEEK_PX : 0,
    left: o.wide && o.drilled ? PEEK_PANEL_INSET : 0,
  };
}
