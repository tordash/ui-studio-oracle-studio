// Knowledge Web — camera rig + gesture math (pure; ported from galaxy engine.ts:619-640, 780-863
// and Graph3D's cdsTween). The engine owns pointers and three.js; everything that decides a
// number lives here so it is unit-tested.
//
// Rig: orbit (yaw, pitch, dist) around a target, every value exponentially damped toward a goal.
// Touch: one finger orbits, two fingers pinch-zoom AND pan (midpoint drag), double-tap = home /
// enter. Mouse: drag orbits, wheel zooms, right/shift-drag pans.

export type Vec3 = [number, number, number];

export interface Damped { cur: number; goal: number }

export interface Rig {
  yaw: Damped;
  pitch: Damped;
  dist: Damped;
  target: Vec3;
  goalTarget: Vec3;
  /** damping rate (1/s); higher = snappier */
  speed: number;
  minDist: number;
  maxDist: number;
}

export const PITCH_LIMIT = 1.35;
export const ORBIT_RAD_PER_PX = 0.0055;
export const TAP_SLOP_PX = 6;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 28;
export const SPEED_IDLE = 6;

export function createRig(o: { dist: number; yaw?: number; pitch?: number; target?: Vec3; minDist: number; maxDist: number }): Rig {
  const t = o.target ?? [0, 0, 0];
  return {
    yaw: { cur: o.yaw ?? 0, goal: o.yaw ?? 0 },
    pitch: { cur: o.pitch ?? 0.28, goal: o.pitch ?? 0.28 },
    dist: { cur: o.dist, goal: o.dist },
    target: [...t] as Vec3,
    goalTarget: [...t] as Vec3,
    speed: SPEED_IDLE,
    minDist: o.minDist,
    maxDist: o.maxDist,
  };
}

/** Advance the damped rig by dt seconds. Returns true while anything is still moving. */
export function stepRig(r: Rig, dt: number): boolean {
  const k = 1 - Math.exp(-r.speed * Math.max(0, dt));
  let moving = false;
  for (const d of [r.yaw, r.pitch, r.dist]) {
    const diff = d.goal - d.cur;
    if (Math.abs(diff) > 1e-4 * Math.max(1, Math.abs(d.goal))) { d.cur += diff * k; moving = true; } else d.cur = d.goal;
  }
  const dx = r.goalTarget[0] - r.target[0], dy = r.goalTarget[1] - r.target[1], dz = r.goalTarget[2] - r.target[2];
  if (Math.hypot(dx, dy, dz) > 1e-4) {
    r.target[0] += dx * k; r.target[1] += dy * k; r.target[2] += dz * k;
    moving = true;
  } else {
    r.target[0] = r.goalTarget[0]; r.target[1] = r.goalTarget[1]; r.target[2] = r.goalTarget[2];
  }
  if (!moving) r.speed = SPEED_IDLE;
  return moving;
}

/** Jump to the goal (reduced motion). */
export function snapRig(r: Rig): void {
  r.yaw.cur = r.yaw.goal; r.pitch.cur = r.pitch.goal; r.dist.cur = r.dist.goal;
  r.target[0] = r.goalTarget[0]; r.target[1] = r.goalTarget[1]; r.target[2] = r.goalTarget[2];
}

/** Camera position for the rig's current pose. */
export function rigPosition(r: Rig): Vec3 {
  const cp = Math.cos(r.pitch.cur);
  return [
    r.target[0] + Math.sin(r.yaw.cur) * cp * r.dist.cur,
    r.target[1] + Math.sin(r.pitch.cur) * r.dist.cur,
    r.target[2] + Math.cos(r.yaw.cur) * cp * r.dist.cur,
  ];
}

/** Camera right / up vectors for a yaw/pitch (world space). */
export function cameraBasis(yaw: number, pitch: number): { right: Vec3; up: Vec3 } {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { right: [cy, 0, -sy], up: [-sy * sp, cp, -cy * sp] };
}

export function clampDist(r: Pick<Rig, 'minDist' | 'maxDist'>, d: number): number {
  return Math.max(r.minDist, Math.min(r.maxDist, d));
}

/** One-finger / mouse orbit from the pose at pointer-down. */
export function orbitGoal(start: { yaw: number; pitch: number }, dxPx: number, dyPx: number): { yaw: number; pitch: number } {
  return {
    yaw: start.yaw - dxPx * ORBIT_RAD_PER_PX,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, start.pitch + dyPx * ORBIT_RAD_PER_PX)),
  };
}

/** Pinch: distance scales with the finger spread ratio, clamped to [minDist, maxDist]. */
export function pinchGoal(r: Pick<Rig, 'minDist' | 'maxDist'>, dist0: number, spread0: number, spread: number): number {
  return clampDist(r, dist0 * (Math.max(1, spread0) / Math.max(1, spread)));
}

/** World units per CSS px at distance `dist` (vertical FOV). */
export function worldPerPx(dist: number, fovDeg: number, viewportH: number): number {
  return (2 * dist * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportH);
}

/**
 * Two-finger (or right-drag) pan: the content follows the fingers, so the target
 * moves opposite to the drag in the camera's right/up plane.
 */
export function panGoal(target0: Vec3, yaw: number, pitch: number, dxPx: number, dyPx: number, scale: number): Vec3 {
  const { right, up } = cameraBasis(yaw, pitch);
  return [
    target0[0] - right[0] * dxPx * scale + up[0] * dyPx * scale,
    target0[1] - right[1] * dxPx * scale + up[1] * dyPx * scale,
    target0[2] - right[2] * dxPx * scale + up[2] * dyPx * scale,
  ];
}

/** Wheel / trackpad zoom factor (clamped per event). */
export function wheelFactor(deltaY: number): number {
  return Math.exp(Math.max(-0.5, Math.min(0.5, deltaY * 0.0012)));
}

/** True when this tap completes a double-tap (time and distance both close). */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, t: number, x: number, y: number): boolean {
  if (!prev) return false;
  return t - prev.t <= DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_TAP_PX;
}

// ── critically damped spring (Graph3D.tsx:64-70 cdsTween, KlakMath) ──

export interface Spring { x: number; v: number }

/** Implicit critically-damped step toward `target` at angular speed `omega` (1/s). No overshoot. */
export function cdsTween(s: Spring, target: number, omega: number, dt: number): Spring {
  const n1 = s.v - (s.x - target) * (omega * omega * dt);
  const n2 = 1 + omega * dt;
  const nv = n1 / (n2 * n2);
  return { x: s.x + nv * dt, v: nv };
}

/** ω for the drill morph: settles (< 1 % left) in ≈ 900 ms. */
export const DRILL_OMEGA = 8;

export function springSettled(s: Spring, target: number, eps = 1e-3): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 10;
}
