// Knowledge Galaxy — camera framing math (pure, no three).
//
// The camera orbits a target at a distance; to frame a set of stars we need a
// centre and a radius, then the distance at which a sphere of that radius fits
// the frustum on BOTH axes. On a portrait phone the horizontal half-FOV is the
// tight one: atan(tan(vfov/2) · aspect) — about 13° at 390×780 vs 25° vertical.

export interface FrameBounds {
  cx: number; cy: number; cz: number;
  /** distance from the centre that covers `percentile` of the stars */
  radius: number;
  count: number;
}

/**
 * Centroid + percentile radius of the given star indices. A percentile (not the
 * max) so a few far outliers don't pull the camera all the way back home.
 */
export function frameBounds(positions: ArrayLike<number>, indices: Iterable<number>, percentile = 0.85): FrameBounds | null {
  const n = Math.floor(positions.length / 3);
  const list: number[] = [];
  let cx = 0, cy = 0, cz = 0;
  for (const i of indices) {
    if (!(i >= 0 && i < n)) continue;
    cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2];
    list.push(i);
  }
  const k = list.length;
  if (k === 0) return null;
  cx /= k; cy /= k; cz /= k;
  const d = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    const i = list[j];
    const dx = positions[i * 3] - cx, dy = positions[i * 3 + 1] - cy, dz = positions[i * 3 + 2] - cz;
    d[j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  d.sort();
  const p = Math.min(1, Math.max(0, percentile));
  const radius = d[Math.min(k - 1, Math.max(0, Math.ceil(p * k) - 1))];
  return { cx, cy, cz, radius, count: k };
}

/** The tighter of the vertical and horizontal half-FOV, in radians. */
export function minHalfFov(fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(1e-6, aspect));
  return Math.min(v, h);
}

/**
 * Camera distance at which a sphere of `radius` (× margin) fits inside the
 * frustum on both axes, for any view direction.
 */
export function fitSphereDistance(radius: number, fovDeg: number, aspect: number, margin = 1.15): number {
  return (Math.max(0, radius) * margin) / Math.sin(minHalfFov(fovDeg, aspect));
}

/** Distance to frame `bounds`, clamped to [minDist, maxDist]. */
export function frameDistance(
  bounds: Pick<FrameBounds, 'radius'>,
  fovDeg: number,
  aspect: number,
  opts: { minDist: number; maxDist: number; margin?: number },
): number {
  const d = fitSphereDistance(bounds.radius, fovDeg, aspect, opts.margin);
  return Math.max(opts.minDist, Math.min(opts.maxDist, d));
}
