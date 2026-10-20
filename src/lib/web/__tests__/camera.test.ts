import { describe, it, expect } from 'bun:test';
import {
  createRig, stepRig, snapRig, rigPosition, cameraBasis, orbitGoal, pinchGoal, panGoal, worldPerPx,
  wheelFactor, isDoubleTap, cdsTween, springSettled, DRILL_OMEGA, PITCH_LIMIT, DOUBLE_TAP_MS,
} from '../camera';

describe('damped rig', () => {
  it('converges to the goal and reports when it stops moving', () => {
    const r = createRig({ dist: 30, minDist: 2, maxDist: 90 });
    r.yaw.goal = 1; r.pitch.goal = -0.4; r.dist.goal = 12; r.goalTarget = [3, -2, 5];
    let frames = 0;
    while (stepRig(r, 1 / 60) && frames < 2000) frames++;
    expect(frames).toBeLessThan(400);
    expect(r.yaw.cur).toBe(1);
    expect(r.dist.cur).toBe(12);
    expect(r.target).toEqual([3, -2, 5]);
    expect(stepRig(r, 1 / 60)).toBe(false);
  });
  it('approaches monotonically (no overshoot) and snaps under reduced motion', () => {
    const r = createRig({ dist: 30, minDist: 2, maxDist: 90 });
    r.dist.goal = 10;
    let prev = r.dist.cur;
    for (let i = 0; i < 120; i++) { stepRig(r, 1 / 60); expect(r.dist.cur).toBeLessThanOrEqual(prev); expect(r.dist.cur).toBeGreaterThanOrEqual(10); prev = r.dist.cur; }
    const s = createRig({ dist: 30, minDist: 2, maxDist: 90 });
    s.dist.goal = 7; s.goalTarget = [1, 1, 1];
    snapRig(s);
    expect(s.dist.cur).toBe(7);
    expect(s.target).toEqual([1, 1, 1]);
  });
  it('positions the camera on the orbit sphere', () => {
    const r = createRig({ dist: 10, yaw: 0, pitch: 0, minDist: 1, maxDist: 50 });
    expect(rigPosition(r).map(v => +v.toFixed(9))).toEqual([0, 0, 10]);
    r.pitch.cur = Math.PI / 2;
    const p = rigPosition(r);
    expect(p[1]).toBeCloseTo(10, 9);
  });
});

describe('gestures', () => {
  it('orbit drag clamps pitch', () => {
    const g = orbitGoal({ yaw: 0, pitch: 0 }, 100, 10000);
    expect(g.yaw).toBeCloseTo(-0.55, 9);
    expect(g.pitch).toBe(PITCH_LIMIT);
  });
  it('pinch distance clamps to MIN/MAX', () => {
    const r = { minDist: 2, maxDist: 90 };
    expect(pinchGoal(r, 30, 100, 200)).toBe(15);
    expect(pinchGoal(r, 30, 100, 10000)).toBe(2);
    expect(pinchGoal(r, 30, 300, 10)).toBe(90);
    expect(pinchGoal(r, 30, 0, 0)).toBe(30); // degenerate spread is safe
  });
  it('pan translates the target in the camera plane, opposite to the drag', () => {
    const k = worldPerPx(20, 50, 800);
    expect(k).toBeCloseTo((2 * 20 * Math.tan((50 * Math.PI) / 360)) / 800, 12);
    // looking down −z (yaw 0, pitch 0): right = +x, up = +y
    const t = panGoal([0, 0, 0], 0, 0, 100, 0, k);
    expect(t[0]).toBeCloseTo(-100 * k, 12);
    expect(t[1]).toBeCloseTo(0, 12);
    const u = panGoal([0, 0, 0], 0, 0, 0, 50, k);
    expect(u[1]).toBeCloseTo(50 * k, 12);
    // the basis stays orthonormal at any pose
    const { right, up } = cameraBasis(0.7, -0.4);
    expect(Math.hypot(...right)).toBeCloseTo(1, 12);
    expect(Math.hypot(...up)).toBeCloseTo(1, 12);
    expect(right[0] * up[0] + right[1] * up[1] + right[2] * up[2]).toBeCloseTo(0, 12);
  });
  it('wheel factor is clamped per event', () => {
    expect(wheelFactor(100)).toBeCloseTo(Math.exp(0.12), 12);
    expect(wheelFactor(100000)).toBeCloseTo(Math.exp(0.5), 12);
    expect(wheelFactor(-100000)).toBeCloseTo(Math.exp(-0.5), 12);
  });
  it('double tap needs both time and distance', () => {
    expect(isDoubleTap(null, 0, 0, 0)).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, DOUBLE_TAP_MS, 10, 10)).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, DOUBLE_TAP_MS + 1, 0, 0)).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, 100, 60, 0)).toBe(false);
  });
});

describe('cdsTween (drill morph spring)', () => {
  it('golden values match Graph3D (ω 3, 60 fps)', () => {
    const golden = [
      [0.0022675736961451243, 0.13605442176870747], [0.006586761688802504, 0.2591512795594428],
      [0.012757030249741617, 0.3702161136563468], [0.020592291914426207, 0.4701156998810753],
      [0.02991998437238405, 0.5596615474774707],
    ];
    let s = { x: 0, v: 0 };
    for (const [x, v] of golden) { s = cdsTween(s, 1, 3, 1 / 60); expect(s.x).toBe(x); expect(s.v).toBe(v); }
  });
  it('settles in ≈ 900 ms without overshoot, both directions', () => {
    for (const [from, to] of [[0, 1], [1, 0]]) {
      let s = { x: from, v: 0 };
      let t = 0;
      while (t < 0.9) {
        s = cdsTween(s, to, DRILL_OMEGA, 1 / 60);
        t += 1 / 60;
        if (to > from) expect(s.x).toBeLessThanOrEqual(to + 1e-12);
        else expect(s.x).toBeGreaterThanOrEqual(to - 1e-12);
      }
      expect(Math.abs(s.x - to)).toBeLessThan(0.01);
      for (let i = 0; i < 60; i++) s = cdsTween(s, to, DRILL_OMEGA, 1 / 60);
      expect(springSettled(s, to)).toBe(true);
    }
  });
  it('is stable at 30 fps and with a long frame', () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 40; i++) { s = cdsTween(s, 1, DRILL_OMEGA, 1 / 30); expect(s.x).toBeLessThanOrEqual(1 + 1e-12); }
    s = cdsTween({ x: 0, v: 0 }, 1, DRILL_OMEGA, 0.5);
    expect(s.x).toBeLessThanOrEqual(1);
  });
});
