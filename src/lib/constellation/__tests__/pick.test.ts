import { describe, it, expect } from 'bun:test';
import { pickNode, pickEdge, classifyTap, bezierSamples, EDGE_SAMPLES, EDGE_PICK_PX, TAP_MOVE_PX, TAP_MS } from '../pick';
import type { ScreenNode } from '../pick';

const n = (x: number, y: number, r = 6, visible = true): ScreenNode => ({ x, y, r, visible });

describe('pickNode', () => {
  it('nearest within max(22 px, r + 6 px)', () => {
    const nodes = [n(100, 100), n(130, 100), n(300, 300, 30)];
    expect(pickNode(112, 100, nodes)).toBe(0);
    expect(pickNode(118, 100, nodes)).toBe(1);
    expect(pickNode(100, 121, nodes)).toBe(0);  // 21 < 22
    expect(pickNode(100, 123, [n(100, 100)])).toBe(-1); // 23 > 22
    expect(pickNode(300, 335, nodes)).toBe(2);  // 35 < 30 + 6
    expect(pickNode(300, 337, nodes)).toBe(-1);
  });

  it('skips hidden / behind-camera nodes, −1 when nothing is close', () => {
    expect(pickNode(100, 100, [n(100, 100, 6, false)])).toBe(-1);
    expect(pickNode(100, 100, [n(NaN, NaN)])).toBe(-1);
    expect(pickNode(0, 0, [])).toBe(-1);
  });
});

describe('pickEdge', () => {
  it('nearest of 16 projected Bézier samples within 8 px', () => {
    expect(EDGE_SAMPLES).toBe(16);
    expect(EDGE_PICK_PX).toBe(8);
    const line = (y: number) => Array.from({ length: 16 }, (_, i) => [i * 10, y] as [number, number]);
    const edges = [line(100), line(110)];
    expect(pickEdge(50, 103, edges)).toBe(0);
    expect(pickEdge(50, 107, edges)).toBe(1);
    expect(pickEdge(50, 119, edges)).toBe(-1);
    expect(pickEdge(50, 90, [line(100)])).toBe(-1);
    expect(pickEdge(50, 93, [line(100)])).toBe(0);
  });

  it('ignores NaN samples (behind the camera)', () => {
    expect(pickEdge(0, 0, [[[NaN, NaN]]])).toBe(-1);
  });
});

describe('bezierSamples', () => {
  it('n samples on the quadratic Bézier from a to b', () => {
    const s = bezierSamples([0, 0, 0], [5, 10, 0], [10, 0, 0], 16);
    expect(s).toHaveLength(16);
    expect(s[0]).toEqual([0, 0, 0]);
    expect(s[15]).toEqual([10, 0, 0]);
    // the curve's apex is half way to the control point
    const peak = Math.max(...s.map(p => p[1]));
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(4.9);
  });
});

describe('classifyTap', () => {
  it('tap if < 6 px and < 350 ms', () => {
    expect(TAP_MOVE_PX).toBe(6);
    expect(TAP_MS).toBe(350);
    expect(classifyTap(3, 4, 100)).toBe('tap');      // 5 px
    expect(classifyTap(6, 0, 100)).toBe('drag');
    expect(classifyTap(0, 0, 350)).toBe('drag');
    expect(classifyTap(0, 0, 349)).toBe('tap');
  });
});
