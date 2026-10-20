// Knowledge Web — screen-space picking (pure; no raycaster, touch-friendly radii).
//   overview : a tap picks a cluster (inside its projected disc, ≥ 22 px), else a link
//              within 16 px of its projected arc, else nothing
//   drill    : stars of the drilled cluster through galaxy's ScreenGrid (22 px touch / 12 px mouse)

export const CORE_MIN_PX = 22;
export const ARC_PICK_PX = 16;
export const STAR_PICK_TOUCH = 22;
export const STAR_PICK_MOUSE = 12;

/** Projected radius in CSS px of a world-space radius at camera distance `dist`. */
export function projectedRadius(worldR: number, dist: number, scale: number): number {
  return (worldR * scale) / Math.max(1e-3, dist);
}

/**
 * The cluster under (px, py): inside max(minPx, radiusPx[c]); the smallest
 * normalised distance d / r wins (a small cluster on top of a big one stays
 * tappable at its centre); near-ties go to the one nearer the camera.
 */
export function pickCore(
  xs: ArrayLike<number>, ys: ArrayLike<number>, depth: ArrayLike<number>, radiusPx: ArrayLike<number>,
  px: number, py: number, minPx = CORE_MIN_PX, include?: (c: number) => boolean,
): number {
  let best = -1, bestS = Infinity, bestZ = Infinity;
  for (let c = 0; c < xs.length; c++) {
    const x = xs[c], y = ys[c];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (include && !include(c)) continue;
    const r = Math.max(minPx, radiusPx[c]);
    const d = Math.hypot(px - x, py - y);
    if (d > r) continue;
    const s = d / r;
    if (s < bestS - 0.03 || (Math.abs(s - bestS) <= 0.03 && depth[c] < bestZ)) { best = c; bestS = s; bestZ = depth[c]; }
  }
  return best;
}

/** Distance from P to segment AB (CSS px). */
export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Projected polyline of one arc: x, y per sample (NaN = behind the camera / off clip). */
export interface ScreenPolyline { xs: Float32Array; ys: Float32Array }

/** Nearest link within `radius` px of its projected polyline; -1 if none. */
export function pickArc(polys: readonly ScreenPolyline[], px: number, py: number, radius = ARC_PICK_PX, include?: (e: number) => boolean): number {
  let best = -1, bestD = radius;
  for (let e = 0; e < polys.length; e++) {
    if (include && !include(e)) continue;
    const { xs, ys } = polys[e];
    for (let k = 0; k + 1 < xs.length; k++) {
      const ax = xs[k], ay = ys[k], bx = xs[k + 1], by = ys[k + 1];
      if (!Number.isFinite(ax) || !Number.isFinite(bx)) continue;
      const d = pointSegDist(px, py, ax, ay, bx, by);
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  return best;
}
