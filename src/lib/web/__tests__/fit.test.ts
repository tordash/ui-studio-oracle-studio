import { describe, it, expect } from 'bun:test';
import { fitView, rigBasis, projectForRig, frameInsets, homePose, nearestAngle, NO_INSETS, PEEK_PANEL_INSET, CONTROLS_INSET, HOME_YAW, HOME_PITCH } from '../fit';
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

describe('homePose (overview framing)', () => {
  /** a flat, wide web: 1.7 : 1 in x : z, thin in y — the snapshot's shape */
  function wideWeb(n = 3000): Float32Array {
    const p = new Float32Array(n * 3);
    let s = 11;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
    for (let i = 0; i < n; i++) { p[i * 3] = rnd() * 50; p[i * 3 + 1] = rnd() * 8; p[i * 3 + 2] = rnd() * 30; }
    return p;
  }
  const fillOf = (pos: Float32Array, h: { target: [number, number, number]; dist: number; yaw: number; pitch: number }, w: number, hh: number) => {
    const b = screenBox(pos, h, h.yaw, h.pitch, w, hh);
    return { w: (b.x1 - b.x0) / w, h: (b.y1 - b.y0) / hh };
  };

  it('keeps the default angle when no other is ≥ 10 % tighter (a round cloud)', () => {
    const ball = new Float32Array(3000 * 3);
    let s = 5;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
    for (let i = 0; i < 3000; i++) {
      let x = 0, y = 0, z = 0;
      do { x = rnd() * 2; y = rnd() * 2; z = rnd() * 2; } while (x * x + y * y + z * z > 1);
      ball[i * 3] = x * 20; ball[i * 3 + 1] = y * 20; ball[i * 3 + 2] = z * 20;
    }
    const h = homePose(ball, { fovDeg: FOV, width: 1440, height: 812 })!;
    expect([h.yaw, h.pitch]).toEqual([HOME_YAW, HOME_PITCH]);
  });

  it('the web fills ~80 % of the viewport on its tight axis (desktop and phone)', () => {
    const pos = wideWeb();
    for (const [w, hh] of [[1440, 812], [390, 640]]) {
      const h = homePose(pos, { fovDeg: FOV, width: w, height: hh })!;
      const f = fillOf(pos, h, w, hh);
      // the 99th-percentile fit targets 80 %; the full min–max box (strays included) lands a bit past it
      expect(Math.max(f.w, f.h)).toBeGreaterThan(0.72);
      expect(Math.max(f.w, f.h)).toBeLessThan(0.92);
    }
  });

  it('a portrait phone turns / raises the view when that frames the web ≥ 10 % tighter', () => {
    const pos = wideWeb();
    const def = fitView(pos, null, HOME_YAW, HOME_PITCH, { fovDeg: FOV, width: 390, height: 640, fill: 0.8, percentile: 0.99 })!;
    const h = homePose(pos, { fovDeg: FOV, width: 390, height: 640 })!;
    expect(h.dist).toBeLessThanOrEqual(def.dist * 0.9);
    expect(h.yaw !== HOME_YAW || h.pitch !== HOME_PITCH).toBe(true);
    const f = fillOf(pos, h, 390, 640);
    expect(f.w * f.h).toBeGreaterThan(0.3); // a real frame, not a thin strip
  });

  it('deterministic; null on no points', () => {
    const pos = wideWeb(500);
    expect(homePose(pos, { fovDeg: FOV, width: 390, height: 640 })).toEqual(homePose(pos, { fovDeg: FOV, width: 390, height: 640 }));
    expect(homePose(new Float32Array(0), { fovDeg: FOV, width: 390, height: 640 })).toBeNull();
  });
});

describe('nearestAngle', () => {
  it('Home never spins a full lap', () => {
    expect(nearestAngle(-1.5, 4.71)).toBeCloseTo(4.71 - 2 * Math.PI, 9);
    expect(nearestAngle(0.2, 0)).toBeCloseTo(0, 9);
    expect(nearestAngle(13, 0.5)).toBeCloseTo(0.5 + 4 * Math.PI, 9);
    for (const [a, b] of [[0, 3], [7, -7], [-20, 1]]) expect(Math.abs(nearestAngle(a, b) - a)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});
