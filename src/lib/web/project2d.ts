// Knowledge Web — the no-WebGL view: the same layout projected to 2D (pure).
// The force layout is seeded from PCA, so x / y carry the two strongest axes;
// dropping z and fitting the bounds keeps neighbours next to each other.

import { ARC_BOW } from './arcs';

export type RenderMode = '3d' | '2d' | 'list';

/** Which view to show: WebGL → 3D; lost or missing → Canvas2D; no 2D context either → list only. */
export function renderMode(webgl: boolean, contextLost: boolean, canvas2d: boolean): RenderMode {
  if (webgl && !contextLost) return '3d';
  return canvas2d ? '2d' : 'list';
}

export interface Projected2D {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  scale: number;
}

/** Fit cluster discs (centre ± radius) into width × height with `pad` px margins, y up → screen down. */
export function project2D(centres: ArrayLike<number>, radii: ArrayLike<number>, width: number, height: number, pad = 24): Projected2D {
  const C = radii.length;
  const out: Projected2D = { x: new Float32Array(C), y: new Float32Array(C), r: new Float32Array(C), scale: 1 };
  if (C === 0) return out;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let c = 0; c < C; c++) {
    const x = centres[c * 3], y = centres[c * 3 + 1], r = radii[c];
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  }
  const bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
  const s = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  const scale = Math.max(1e-6, s);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let c = 0; c < C; c++) {
    out.x[c] = width / 2 + (centres[c * 3] - cx) * scale;
    out.y[c] = height / 2 - (centres[c * 3 + 1] - cy) * scale;
    out.r[c] = Math.max(3, radii[c] * scale * 0.85);
  }
  out.scale = scale;
  return out;
}

/** 2D control point: midpoint pushed away from the screen centroid by ARC_BOW · length. */
export function ctrl2D(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number] {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay);
  let dx = mx - cx, dy = my - cy;
  let dl = Math.hypot(dx, dy);
  if (dl < 1e-6) { dx = -(by - ay); dy = bx - ax; dl = Math.hypot(dx, dy) || 1; }
  return [mx + (dx / dl) * ARC_BOW * len, my + (dy / dl) * ARC_BOW * len];
}

/** Point on the 2D quadratic curve. */
export function quad2D(ax: number, ay: number, qx: number, qy: number, bx: number, by: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * qx + t * t * bx, u * u * ay + 2 * u * t * qy + t * t * by];
}
