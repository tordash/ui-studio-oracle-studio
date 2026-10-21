// Bottom-sheet snap math (pure). Heights are measured from the bottom of the viewport.
//   peek 168 px (+ the home-indicator inset) · half 50 % · full 92 %
// A release projects the drag 200 ms ahead with its velocity: a flick moves one
// snap in its direction; a slow release lands on the nearest snap; dragging well
// below peek closes a closable sheet.

export type SnapPoint = 'peek' | 'half' | 'full';
export const SNAP_ORDER: readonly SnapPoint[] = ['peek', 'half', 'full'];
export const PEEK_PX = 168;
export const FLICK_PX_PER_MS = 0.5;
export const PROJECT_MS = 200;
/** a flick must clear a snap by this much to skip past it (a sheet nudged off its snap still moves on) */
export const FLICK_MARGIN_PX = 24;

export type SnapHeights = Record<SnapPoint, number>;

export function snapHeights(viewportH: number, safeBottom = 0): SnapHeights {
  const vh = Math.max(1, viewportH);
  const full = Math.round(vh * 0.92);
  const half = Math.min(full, Math.max(Math.round(vh * 0.5), PEEK_PX + safeBottom));
  const peek = Math.min(half, PEEK_PX + safeBottom);
  return { peek, half, full };
}

/**
 * Where a released sheet settles. `height` = current sheet height (px), `velocity`
 * = px/ms, positive = growing (finger moving up). `allowed` keeps the order of SNAP_ORDER.
 */
export function snapTo(
  height: number,
  velocity: number,
  heights: SnapHeights,
  allowed: readonly SnapPoint[] = SNAP_ORDER,
  closable = true,
): SnapPoint | 'close' {
  const pts = SNAP_ORDER.filter(p => allowed.includes(p));
  if (pts.length === 0) return 'close';
  const lowest = heights[pts[0]];
  if (Math.abs(velocity) >= FLICK_PX_PER_MS) {
    // flick: one step in the direction of travel from where the finger is now
    if (velocity > 0) {
      const up = pts.find(p => heights[p] > height + FLICK_MARGIN_PX);
      return up ?? pts[pts.length - 1];
    }
    const down = [...pts].reverse().find(p => heights[p] < height - FLICK_MARGIN_PX);
    if (down) return down;
    return closable ? 'close' : pts[0];
  }
  const projected = height + velocity * PROJECT_MS;
  if (closable && projected < lowest * 0.6) return 'close';
  let best = pts[0], bestD = Infinity;
  for (const p of pts) {
    const d = Math.abs(heights[p] - projected);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Next snap up / down for the keyboard (handle button) — wraps to the lowest from the top. */
export function cycleSnap(current: SnapPoint, allowed: readonly SnapPoint[] = SNAP_ORDER): SnapPoint {
  const pts = SNAP_ORDER.filter(p => allowed.includes(p));
  const i = pts.indexOf(current);
  return pts[(i + 1) % pts.length] ?? pts[0];
}
