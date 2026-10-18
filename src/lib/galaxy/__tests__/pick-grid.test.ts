import { describe, it, expect } from 'bun:test';
import { ScreenGrid, projectPoints } from '../pick-grid';

describe('projectPoints', () => {
  it('maps clip space to CSS pixels with identity matrix and culls behind-camera points', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const pos = new Float32Array([0, 0, 0, 1, 1, 0, -1, -1, 0, 0, 0, 5]);
    const xs = new Float32Array(4), ys = new Float32Array(4), zs = new Float32Array(4);
    projectPoints(pos, id, 200, 100, xs, ys, zs);
    expect([xs[0], ys[0]]).toEqual([100, 50]);
    expect([xs[1], ys[1]]).toEqual([200, 0]);
    expect([xs[2], ys[2]]).toEqual([0, 100]);
    expect(Number.isNaN(xs[3])).toBe(true); // z=5 outside clip volume
  });
});

describe('ScreenGrid', () => {
  const xs = new Float32Array([10, 50, 52, 300, NaN]);
  const ys = new Float32Array([10, 50, 51, 300, NaN]);
  const zs = new Float32Array([0.5, 0.9, 0.2, 0.5, 0]);
  it('picks the nearest star within radius, -1 when none', () => {
    const g = new ScreenGrid(16);
    g.build(xs, ys, zs, 400, 400);
    expect(g.pick(12, 11, 10)).toBe(0);
    expect(g.pick(200, 200, 10)).toBe(-1);
    expect(g.pick(299, 299, 4)).toBe(3);
  });
  it('breaks near-ties toward the star closer to the camera', () => {
    const g = new ScreenGrid(16);
    g.build(xs, ys, zs, 400, 400);
    expect(g.pick(51, 50.5, 10)).toBe(2);
  });
  it('never returns excluded (hidden) stars and handles cell borders', () => {
    const g = new ScreenGrid(16);
    g.build(xs, ys, zs, 400, 400, i => i !== 2);
    expect(g.pick(52, 51, 10)).toBe(1);
    const g2 = new ScreenGrid(32);
    g2.build(new Float32Array([31.5, 400]), new Float32Array([31.5, 0]), new Float32Array([0, 0]), 400, 400);
    expect(g2.pick(33, 33, 4)).toBe(0); // neighbour cell is scanned
    expect(g2.pick(399, 1, 4)).toBe(-1); // x=400 is off-screen → not bucketed
  });
  it('scales linearly: 13k stars build + 1k picks stay fast', () => {
    const n = 13000;
    const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
    for (let i = 0; i < n; i++) { X[i] = (i * 7919) % 1280; Y[i] = (i * 104729) % 800; Z[i] = (i % 100) / 100; }
    const g = new ScreenGrid(32);
    const t0 = performance.now();
    g.build(X, Y, Z, 1280, 800);
    for (let k = 0; k < 1000; k++) g.pick((k * 37) % 1280, (k * 53) % 800, 14);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
