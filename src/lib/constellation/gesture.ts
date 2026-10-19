// Fleet Constellation — pointer gesture policy (pure).
// The hero sits in a scrolling page with `touch-action: pan-y`, so on a phone
// a one-finger vertical drag must stay a native page scroll: only a
// horizontal drag orbits (yaw only). Two fingers pinch-zoom and tilt.
// Desktop: one pointer orbits freely. The engine locks the first non-pending
// result for the rest of the gesture.

export type Gesture = 'pending' | 'yaw' | 'orbit' | 'scroll' | 'pinch';

export const GESTURE_SLOP_PX = 6;

export function classifyGesture(pointers: number, dx: number, dy: number, phone: boolean): Gesture {
  if (pointers <= 0) return 'pending';
  if (pointers >= 2) return 'pinch';
  if (Math.hypot(dx, dy) < GESTURE_SLOP_PX) return 'pending';
  if (!phone) return 'orbit';
  return Math.abs(dx) > Math.abs(dy) ? 'yaw' : 'scroll';
}
