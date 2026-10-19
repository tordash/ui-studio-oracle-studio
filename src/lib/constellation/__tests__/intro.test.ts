import { describe, it, expect } from 'bun:test';
import { introState, igniteProgress, driftOn, INTRO_FROM, INTRO_END_S, DRIFT_IDLE_MS, DRIFT_RAD_S } from '../intro';

const HOME = { yaw: 0, pitch: 0.18, dist: 24 };

describe('introState', () => {
  it('dolly 0–2.2 s from (34, −0.6, 0.45) to home, ease-out', () => {
    expect(INTRO_FROM).toEqual({ dist: 34, yaw: -0.6, pitch: 0.45 });
    const a = introState(0, { reduced: false, home: HOME });
    expect(a.pose).toEqual({ dist: 34, yaw: -0.6, pitch: 0.45 });
    const mid = introState(1.1, { reduced: false, home: HOME });
    // ease-out: more than half way at half time
    expect(mid.dolly).toBeGreaterThan(0.5);
    expect(mid.dolly).toBeLessThan(1);
    const end = introState(2.2, { reduced: false, home: HOME });
    expect(end.dolly).toBe(1);
    expect(end.pose.dist).toBeCloseTo(24, 9);
    expect(end.pose.yaw).toBeCloseTo(0, 9);
  });

  it('ribbons draw on 1.2–2.4 s', () => {
    expect(introState(1.2, { reduced: false, home: HOME }).ribbons).toBe(0);
    expect(introState(1.8, { reduced: false, home: HOME }).ribbons).toBeCloseTo(0.5, 9);
    expect(introState(2.4, { reduced: false, home: HOME }).ribbons).toBe(1);
  });

  it('replay window 2.4–6.4 s, then done', () => {
    expect(introState(2.3, { reduced: false, home: HOME }).replay).toBe(false);
    expect(introState(2.4, { reduced: false, home: HOME }).replay).toBe(true);
    expect(introState(6.3, { reduced: false, home: HOME }).replay).toBe(true);
    expect(introState(6.4, { reduced: false, home: HOME }).replay).toBe(false);
    expect(INTRO_END_S).toBe(6.4);
    expect(introState(6.4, { reduced: false, home: HOME }).done).toBe(true);
    expect(introState(3, { reduced: false, home: HOME }).done).toBe(false);
  });

  it('reduced motion: the final frame at t = 0', () => {
    const r = introState(0, { reduced: true, home: HOME });
    expect(r.pose).toEqual(HOME);
    expect(r.dolly).toBe(1);
    expect(r.ribbons).toBe(1);
    expect(r.replay).toBe(false);
    expect(r.done).toBe(true);
    expect(igniteProgress(0, 5, 12, true)).toBe(1);
  });
});

describe('igniteProgress', () => {
  it('rank order, 60 ms apart, starting at 0.3 s and done by 1.4 s', () => {
    // 10 nodes fit at the full 60 ms stagger
    expect(igniteProgress(0.29, 0, 10, false)).toBe(0);
    expect(igniteProgress(0.3 + 0.06 * 3 - 0.001, 3, 10, false)).toBe(0);
    expect(igniteProgress(0.3 + 0.06 * 3 + 0.2, 3, 10, false)).toBeGreaterThan(0);
    expect(igniteProgress(0.3 + 0.06 * 2 + 0.2, 3, 10, false)).toBeLessThan(igniteProgress(0.3 + 0.06 * 2 + 0.2, 2, 10, false));
    for (let r = 0; r < 12; r++) expect(igniteProgress(1.4, r, 12, false)).toBeCloseTo(1, 6);
  });

  it('overshoots slightly before settling', () => {
    let peak = 0;
    for (let t = 0.3; t <= 1.4; t += 0.01) peak = Math.max(peak, igniteProgress(t, 0, 1, false));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
  });

  it('many nodes still finish by 1.4 s (stagger shrinks)', () => {
    expect(igniteProgress(1.4, 39, 40, false)).toBeCloseTo(1, 6);
  });
});

describe('driftOn (C-D8)', () => {
  it('≥ 8 s idle, nothing selected, not reduced motion', () => {
    expect(DRIFT_IDLE_MS).toBe(8000);
    expect(DRIFT_RAD_S).toBeCloseTo(0.02, 9);
    expect(driftOn(8000, false, false)).toBe(true);
    expect(driftOn(7999, false, false)).toBe(false);
    expect(driftOn(60_000, true, false)).toBe(false);
    expect(driftOn(60_000, false, true)).toBe(false);
  });
});
