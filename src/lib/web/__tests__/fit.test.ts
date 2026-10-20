import { describe, it, expect } from 'bun:test';
import { fitView, rigBasis, projectForRig, frameInsets, NO_INSETS, PEEK_PANEL_INSET, CONTROLS_INSET } from '../fit';
import type { FitInsets } from '../fit';
import { rigPosition, createRig } from '../camera';
import { PEEK_PX } from '../../ui/sheet-snap';

const FOV = 50;

/** Deterministic blob + a far lobe (the shape of Helm's drill: ~13 % of files ~60 units out). */
function lobes(nMain = 400, nFar = 60): Float32Array {
  const p = new Float32Array((nMain + nFar) * 3);
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let i = 0; i < nMain; i++) { p[i * 3] = rnd() * 30; p[i * 3 + 1] = rnd() * 22; p[i * 3 + 2] = rnd() * 26; }
  for (let i = nMain; i < nMain + nFar; i++) { p[i * 3] = -48 + rnd() * 10; p[i * 3 + 1] = 30 + rnd() * 8; p[i * 3 + 2] = 6 + rnd() * 8; }
  return p;
}

function screenBox(pos: Float32Array, f: { target: [number, number, number]; dist: number }, yaw: number, pitch: number, w: number, h: number) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, minDepth = Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    const q = projectForRig([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], f.target, f.dist, yaw, pitch, FOV, w, h);
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); minDepth = Math.min(minDepth, q.depth);
  }
  return { x0, x1, y0, y1, minDepth };
}

describe('rigBasis', () => {
  it('back points from the target to the rig camera; the basis is orthonormal', () => {
    for (const [yaw, pitch] of [[0, 0.32], [1.3, -0.4], [4.97, 1.2]]) {
      const r = createRig({ dist: 10, yaw, pitch, target: [1, 2, 3], minDist: 1, maxDist: 100 });
      const cam = rigPosition(r);
      const { right, up, back } = rigBasis(yaw, pitch);
      const d = [(cam[0] - 1) / 10, (cam[1] - 2) / 10, (cam[2] - 3) / 10];
      d.forEach((v, k) => expect(back[k]).toBeCloseTo(v, 9));
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(right, up)).toBeCloseTo(0, 9); expect(dot(right, back)).toBeCloseTo(0, 9); expect(dot(up, back)).toBeCloseTo(0, 9);
      expect(dot(right, right)).toBeCloseTo(1, 9); expect(dot(up, up)).toBeCloseTo(1, 9);
      expect(up[1]).toBeGreaterThan(0); // never upside down
    }
  });
});

describe('fitView', () => {
  const pos = lobes();
  for (const [w, h] of [[1440, 812], [390, 600]]) {
    it(`percentile 1 puts every point inside the fill box at ${w}×${h}, and is tight`, () => {
      const yaw = 0.4, pitch = 0.32, fill = 0.84;
      const f = fitView(pos, null, yaw, pitch, { fovDeg: FOV, width: w, height: h, fill, percentile: 1 })!;
      const b = screenBox(pos, f, yaw, pitch, w, h);
      const mx = (w * (1 - fill)) / 2, my = (h * (1 - fill)) / 2;
      expect(b.minDepth).toBeGreaterThan(0);
      expect(b.x0).toBeGreaterThanOrEqual(mx - 1); expect(b.x1).toBeLessThanOrEqual(w - mx + 1);
      expect(b.y0).toBeGreaterThanOrEqual(my - 1); expect(b.y1).toBeLessThanOrEqual(h - my + 1);
      // tight on the limiting axis: the box reaches the fill edge on at least one side
      const slack = Math.min(b.x0 - mx, w - mx - b.x1, b.y0 - my, h - my - b.y1);
      expect(slack).toBeLessThan(Math.max(w, h) * 0.02);
    });
  }

  it('the far lobe stays on screen (no off-screen links) — a centroid-percentile frame would drop it', () => {
    const f = fitView(pos, null, 0, 0.32, { fovDeg: FOV, width: 1440, height: 812, fill: 0.84, percentile: 1 })!;
    const lobe = pos.subarray(400 * 3);
    const b = screenBox(lobe, f, 0, 0.32, 1440, 812);
    expect(b.x0).toBeGreaterThan(0); expect(b.y0).toBeGreaterThan(0);
  });

  it('insets: content stays in the free rect (desktop peek card on the left, HUD on top)', () => {
    const ins: FitInsets = { top: 80, right: CONTROLS_INSET, bottom: 0, left: PEEK_PANEL_INSET };
    const f = fitView(pos, null, 0, 0.32, { fovDeg: FOV, width: 1440, height: 812, fill: 0.9, percentile: 1, insets: ins })!;
    const b = screenBox(pos, f, 0, 0.32, 1440, 812);
    expect(b.x0).toBeGreaterThan(PEEK_PANEL_INSET - 4);
    expect(b.x1).toBeLessThan(1440 - CONTROLS_INSET + 4);
    expect(b.y0).toBeGreaterThan(80 - 4);
    // roughly centred in the free rect
    const cx = (b.x0 + b.x1) / 2, free = (PEEK_PANEL_INSET + 1440 - CONTROLS_INSET) / 2;
    expect(Math.abs(cx - free)).toBeLessThan(60);
  });

  it('percentile < 1 ignores outliers (overview: a few strays never shrink the web)', () => {
    const all = fitView(pos, null, 0, 0.32, { fovDeg: FOV, width: 1440, height: 812, percentile: 1 })!;
    const main = Array.from({ length: 400 }, (_, i) => i);
    const trimmed = fitView(pos, main, 0, 0.32, { fovDeg: FOV, width: 1440, height: 812, percentile: 0.99 })!;
    expect(trimmed.dist).toBeLessThan(all.dist);
  });

  it('empty input → null; deterministic', () => {
    expect(fitView(new Float32Array(0), null, 0, 0, { fovDeg: FOV, width: 100, height: 100 })).toBeNull();
    const a = fitView(pos, null, 1, 0.5, { fovDeg: FOV, width: 800, height: 600 });
    const b = fitView(pos, null, 1, 0.5, { fovDeg: FOV, width: 800, height: 600 });
    expect(a).toEqual(b);
  });
});

describe('frameInsets', () => {
  it('HUD on top always; drilled: peek card left on desktop, peek sheet bottom on phones', () => {
    expect(frameInsets({ wide: true, drilled: false, hudBottom: 72 })).toEqual({ top: 80, right: CONTROLS_INSET, bottom: 0, left: 0 });
    expect(frameInsets({ wide: true, drilled: true, hudBottom: 72 })).toEqual({ top: 80, right: CONTROLS_INSET, bottom: 0, left: PEEK_PANEL_INSET });
    expect(frameInsets({ wide: false, drilled: true, hudBottom: 113 })).toEqual({ top: 121, right: 0, bottom: PEEK_PX, left: 0 });
    expect(frameInsets({ wide: false, drilled: false, hudBottom: -5 })).toEqual({ ...NO_INSETS, top: 8 });
  });
});
