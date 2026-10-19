// Fleet Constellation — screen-space picking (pure). ≤ ~30 nodes and ≤ ~60
// edges, so a linear scan over projected points beats a raycaster.

export interface ScreenNode {
  /** CSS px; NaN = behind the camera */
  x: number;
  y: number;
  /** projected radius, CSS px */
  r: number;
  visible: boolean;
}

export const NODE_PICK_MIN_PX = 22;
export const NODE_PICK_PAD_PX = 6;
export const EDGE_SAMPLES = 16;
export const EDGE_PICK_PX = 8;
export const TAP_MOVE_PX = 6;
export const TAP_MS = 350;

/** Nearest node within max(22 px, r + 6 px), or −1. */
export function pickNode(x: number, y: number, nodes: readonly ScreenNode[]): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.visible || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const d = Math.hypot(x - n.x, y - n.y);
    if (d <= Math.max(NODE_PICK_MIN_PX, n.r + NODE_PICK_PAD_PX) && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Nearest edge by its projected samples, within 8 px, or −1. */
export function pickEdge(x: number, y: number, edges: readonly (readonly (readonly [number, number])[])[]): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < edges.length; i++) {
    for (const [sx, sy] of edges[i]) {
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d <= EDGE_PICK_PX && d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

type V3 = readonly [number, number, number] | readonly number[];

/** n points on the quadratic Bézier a → ctrl → b, ends included. */
export function bezierSamples(a: V3, c: V3, b: V3, n: number = EDGE_SAMPLES): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const u = 1 - t;
    const ka = u * u, kc = 2 * u * t, kb = t * t;
    out.push([ka * a[0] + kc * c[0] + kb * b[0], ka * a[1] + kc * c[1] + kb * b[1], ka * a[2] + kc * c[2] + kb * b[2]]);
  }
  return out;
}

export function classifyTap(dx: number, dy: number, dtMs: number): 'tap' | 'drag' {
  return Math.hypot(dx, dy) < TAP_MOVE_PX && dtMs < TAP_MS ? 'tap' : 'drag';
}
