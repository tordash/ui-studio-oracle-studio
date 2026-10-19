import { describe, it, expect } from 'bun:test';
import { keepAlive, drawCallBudget, DRAW_CALL_CAP, clampDt } from '../loop-state';
import type { KeepAliveInput } from '../loop-state';

const idle: KeepAliveInput = { reduced: false, intro: false, pulses: false, slerp: false, easing: false, drift: false, selected: false, bench: false };

describe('keepAlive', () => {
  it('reduced motion at idle → false (demand rendering, 0 fps at rest)', () => {
    expect(keepAlive({ ...idle, reduced: true })).toBe(false);
    // RM has no intro / pulses / drift: they never keep it alive
    expect(keepAlive({ ...idle, reduced: true, intro: true, pulses: true, drift: true })).toBe(false);
  });

  it('drift on, nothing selected → true (C-D8)', () => {
    expect(keepAlive({ ...idle, drift: true })).toBe(true);
  });

  it('selected and no easing → false, even with drift on', () => {
    expect(keepAlive({ ...idle, drift: true, selected: true })).toBe(false);
    expect(keepAlive({ ...idle, selected: true, easing: true })).toBe(true);
  });

  it('intro, live pulses, slot slerps and camera easing keep it alive', () => {
    expect(keepAlive({ ...idle, intro: true })).toBe(true);
    expect(keepAlive({ ...idle, pulses: true })).toBe(true);
    expect(keepAlive({ ...idle, slerp: true })).toBe(true);
    expect(keepAlive({ ...idle, easing: true })).toBe(true);
    expect(keepAlive({ ...idle, pulses: true, selected: true })).toBe(true);
  });

  it('a camera ease or a bench window keeps it alive under reduced motion too', () => {
    expect(keepAlive({ ...idle, reduced: true, easing: true })).toBe(true);
    expect(keepAlive({ ...idle, reduced: true, bench: true })).toBe(true);
  });

  it('nothing live → false', () => {
    expect(keepAlive(idle)).toBe(false);
  });
});

describe('drawCallBudget', () => {
  it('= 5 on both phone and desktop (stars, shell, ribbons, nodes, rings), ≤ 6', () => {
    expect(drawCallBudget(true)).toBe(5);
    expect(drawCallBudget(false)).toBe(5);
    expect(DRAW_CALL_CAP).toBe(6);
    expect(drawCallBudget(true)).toBeLessThanOrEqual(DRAW_CALL_CAP);
  });
});

describe('clampDt', () => {
  it('real clock delta in seconds, clamped to [1 ms, 50 ms]', () => {
    expect(clampDt(16.7)).toBeCloseTo(0.0167, 9);
    expect(clampDt(0)).toBe(0.001);
    expect(clampDt(-5)).toBe(0.001);
    expect(clampDt(500)).toBe(0.05);
    expect(clampDt(8.33)).toBeCloseTo(0.00833, 9); // 120 Hz ProMotion: real time, not 1/60
  });
});
