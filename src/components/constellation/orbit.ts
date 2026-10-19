// Fleet Constellation — camera rig + pointer input (Pointer Events only, no
// mouse-only listeners). The hero lives in a scrolling page, so the canvas is
// `touch-action: pan-y`: on a phone a one-finger vertical drag scrolls the
// page natively, a horizontal drag yaws, and two fingers pinch-zoom and tilt
// (lib/constellation/gesture). Desktop: drag orbits, wheel zooms 8–40,
// double-click resets. A tap (< 6 px, < 350 ms) goes to onTap.

import { classifyGesture } from '../../lib/constellation/gesture';
import type { Gesture } from '../../lib/constellation/gesture';
import { classifyTap } from '../../lib/constellation/pick';
import { easeInOut } from '../../lib/constellation/layout';

export interface OrbitPose { yaw: number; pitch: number; dist: number }

export interface OrbitCallbacks {
  onTap: (x: number, y: number, touch: boolean) => void;
  /** mouse hover without buttons; NaN = left the canvas */
  onHover: (x: number, y: number) => void;
  /** any user input (stops the intro, resets the idle timer) */
  onInput: () => void;
  /** the pose goal changed: render */
  onChange: () => void;
}

export const MIN_DIST = 8;
export const MAX_DIST = 40;
const PITCH_MAX = 1.35;
const DRAG_K = 0.0055;
const SPEED = 9;

interface Timed { from: OrbitPose; to: OrbitPose; start: number; dur: number }

const clampPitch = (p: number) => Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p));
const clampDist = (d: number) => Math.max(MIN_DIST, Math.min(MAX_DIST, d));

export class OrbitRig {
  /** current pose (what the camera shows) */
  readonly cur: OrbitPose;
  /** damped goal (drag / wheel / pinch) */
  private goal: OrbitPose;
  private home: OrbitPose;
  private timed: Timed | null = null;
  private el: HTMLElement;
  private cb: OrbitCallbacks;
  private phone: boolean;
  private reduced: boolean;

  private pointers = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, t: 0, yaw: 0, pitch: 0, multi: false };
  private gesture: Gesture = 'pending';
  private pinch = { d0: 1, dist0: 24, y0: 0, pitch0: 0 };

  constructor(el: HTMLElement, home: OrbitPose, opts: { phone: boolean; reduced: boolean }, cb: OrbitCallbacks) {
    this.el = el;
    this.cb = cb;
    this.phone = opts.phone;
    this.reduced = opts.reduced;
    this.home = { ...home };
    this.cur = { ...home };
    this.goal = { ...home };
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', this.onDblClick);
  }

  dispose() {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('dblclick', this.onDblClick);
  }

  setReducedMotion(r: boolean) { this.reduced = r; if (r) this.snap(); }

  /** Home moved (resize): follow it if the camera is at home. */
  setHome(home: OrbitPose) {
    const atHome = Math.abs(this.goal.dist - this.home.dist) < 1e-3 && !this.timed;
    this.home = { ...home };
    if (atHome) { this.goal.dist = home.dist; if (this.reduced) this.snap(); }
  }

  /** Start pose for the intro dolly (the engine animates `cur` itself). */
  setCurrent(p: OrbitPose) { Object.assign(this.cur, p); Object.assign(this.goal, p); this.timed = null; }

  /** Timed ease (selection: 0.9 s). Snaps under reduced motion. */
  easeTo(to: OrbitPose, durS: number) {
    const target = { yaw: to.yaw, pitch: clampPitch(to.pitch), dist: clampDist(to.dist) };
    // shortest way round in yaw
    const tau = Math.PI * 2;
    target.yaw = this.cur.yaw + ((((target.yaw - this.cur.yaw) % tau) + tau * 1.5) % tau) - Math.PI;
    if (this.reduced) {
      Object.assign(this.cur, target);
      Object.assign(this.goal, target);
      this.timed = null;
    } else {
      this.timed = { from: { ...this.cur }, to: target, start: -1, dur: durS };
      Object.assign(this.goal, target);
    }
    this.cb.onChange();
  }

  reset() { this.easeTo(this.home, 0.9); }

  /** Idle drift: rotate both pose and goal so damping does not fight it. */
  drift(dyaw: number) { this.cur.yaw += dyaw; this.goal.yaw += dyaw; }

  /** Advance; returns true while the camera still moves. `t` = seconds clock. */
  step(dt: number, t: number): boolean {
    if (this.timed) {
      const m = this.timed;
      if (m.start < 0) m.start = t;
      const k = Math.min(1, (t - m.start) / m.dur);
      const e = easeInOut(k);
      this.cur.yaw = m.from.yaw + (m.to.yaw - m.from.yaw) * e;
      this.cur.pitch = m.from.pitch + (m.to.pitch - m.from.pitch) * e;
      this.cur.dist = m.from.dist + (m.to.dist - m.from.dist) * e;
      if (k >= 1) this.timed = null;
      return true;
    }
    const k = 1 - Math.exp(-SPEED * dt);
    let moving = false;
    for (const f of ['yaw', 'pitch', 'dist'] as const) {
      const d = this.goal[f] - this.cur[f];
      if (Math.abs(d) > 1e-4 * Math.max(1, Math.abs(this.goal[f]))) { this.cur[f] += d * k; moving = true; } else this.cur[f] = this.goal[f];
    }
    return moving;
  }

  private snap() {
    if (this.timed) { Object.assign(this.goal, this.timed.to); this.timed = null; }
    Object.assign(this.cur, this.goal);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.timed = null;
    if (this.pointers.size === 1) {
      this.down = { x: p.x, y: p.y, t: performance.now(), yaw: this.goal.yaw, pitch: this.goal.pitch, multi: false };
      this.gesture = 'pending';
      // mouse / pen only: touch capture would fight the native vertical scroll
      if (e.pointerType !== 'touch') { try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), dist0: this.goal.dist, y0: (a.y + b.y) / 2, pitch0: this.goal.pitch };
      this.down.multi = true;
      this.gesture = 'pinch';
      for (const id of this.pointers.keys()) { try { this.el.setPointerCapture(id); } catch { /* ignore */ } }
    }
    this.cb.onInput();
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.cb.onHover(p.x, p.y);
      return;
    }
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      this.goal.dist = clampDist(this.pinch.dist0 * (this.pinch.d0 / d));
      this.goal.pitch = clampPitch(this.pinch.pitch0 + ((a.y + b.y) / 2 - this.pinch.y0) * DRAG_K);
      this.afterGoal();
      return;
    }
    const dx = p.x - this.down.x, dy = p.y - this.down.y;
    if (this.gesture === 'pending') this.gesture = classifyGesture(1, dx, dy, this.phone);
    if (this.gesture === 'yaw') {
      this.goal.yaw = this.down.yaw - dx * DRAG_K;
      this.afterGoal();
    } else if (this.gesture === 'orbit') {
      this.goal.yaw = this.down.yaw - dx * DRAG_K;
      this.goal.pitch = clampPitch(this.down.pitch + dy * DRAG_K);
      this.afterGoal();
    }
    // 'scroll': the browser pans the page (touch-action: pan-y); never yaw
  };

  private onPointerUp = (e: PointerEvent) => {
    const start = this.pointers.get(e.pointerId);
    if (!start) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    const wasPending = this.gesture === 'pending';
    this.gesture = 'pending';
    if (!this.down.multi && wasPending && classifyTap(p.x - this.down.x, p.y - this.down.y, performance.now() - this.down.t) === 'tap') {
      this.cb.onTap(p.x, p.y, e.pointerType !== 'mouse');
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    // the browser took the gesture (native vertical scroll)
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = 'pending';
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) this.cb.onHover(NaN, NaN);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.timed = null;
    this.goal.dist = clampDist(this.goal.dist * Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0012))));
    this.cb.onInput();
    this.afterGoal();
  };

  private onDblClick = () => {
    this.cb.onInput();
    this.reset();
  };

  private afterGoal() {
    if (this.reduced) Object.assign(this.cur, this.goal);
    this.cb.onChange();
  }
}
