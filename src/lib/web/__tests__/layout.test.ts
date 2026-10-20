import { describe, it, expect } from 'bun:test';
import { encodeForWorker } from '../encode';
import { interEdges } from '../inter';
import {
  clusterRadius, clusterStats, forceLayout, starOffsets, layoutBounds,
  RADIUS_K, PCA_SCALE, OFFSET_CLAMP, LAYOUT_DEFAULTS, drillStarScale, DRILL_STAR_MAX,
} from '../layout';
import { assignColours, WEB_PALETTE, UNSORTED_COLOUR, ACCENT_TOKENS } from '../palette';
import { TYPE_COLORS } from '../../type-colors';
import { shuffled, webFixture, synthDocs } from './fixtures/synth';
import { SNAPSHOT_PROJECTS } from './fixtures/projects';
import { clusterKey } from '../keys';

describe('clusterRadius', () => {
  it('R = 0.6 · n^(1/3) (volume ∝ file count)', () => {
    expect(clusterRadius(1)).toBeCloseTo(RADIUS_K, 12);
    expect(clusterRadius(8)).toBeCloseTo(1.2, 12);
    expect(clusterRadius(5311)).toBeCloseTo(10.47, 2);
    expect(clusterRadius(1000) / clusterRadius(125)).toBeCloseTo(2, 12);
    expect(clusterRadius(0)).toBe(RADIUS_K);
  });
});

describe('forceLayout', () => {
  // real-shaped sizes: all 77 clusters of the snapshot, every mean stacked near the origin
  const sizes = (() => {
    const m = new Map<string, number>();
    for (const [p, n] of SNAPSHOT_PROJECTS) m.set(clusterKey(p), (m.get(clusterKey(p)) ?? 0) + n);
    return [...m.values()];
  })();
  const C = sizes.length;
  const radii = sizes.map(clusterRadius);
  const means = new Float64Array(C * 3);
  for (let c = 0; c < C; c++) {
    means[c * 3] = 0.14 + Math.sin(c) * 0.05;
    means[c * 3 + 1] = -0.1 + Math.cos(c * 1.7) * 0.05;
    means[c * 3 + 2] = c % 3 === 0 ? 0 : 0.02 * (c % 5);
  }
  means[3] = means[0]; means[4] = means[1]; means[5] = means[2]; // two identical means
  const edges = Array.from({ length: 60 }, (_, i) => ({ a: i % C, b: (i * 7 + 3) % C, w: 0.05 + (i % 9) / 10 }))
    .filter(e => e.a !== e.b);

  it('is deterministic', () => {
    const a = forceLayout(means, radii, edges);
    const b = forceLayout(means, radii, edges);
    expect([...a]).toEqual([...b]);
  });

  it('separates every pair: centre distance ≥ 0.95 · (R_a + R_b), even for identical seeds', () => {
    const p = forceLayout(means, radii, edges);
    let worst = Infinity;
    for (let a = 0; a < C; a++) for (let b = a + 1; b < C; b++) {
      const d = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
      worst = Math.min(worst, d / (radii[a] + radii[b]));
    }
    expect(worst).toBeGreaterThanOrEqual(0.95);
  });

  it('anchor drift is bounded: within the scene, and zero for well-separated unlinked seeds', () => {
    const p = forceLayout(means, radii, edges);
    const b = layoutBounds(p, radii);
    for (let c = 0; c < C; c++) {
      const drift = Math.hypot(p[c * 3] - means[c * 3] * PCA_SCALE, p[c * 3 + 1] - means[c * 3 + 1] * PCA_SCALE, p[c * 3 + 2] - means[c * 3 + 2] * PCA_SCALE);
      expect(drift).toBeLessThan(b.radius);
    }
    // seeds far apart, no links → nothing to resolve, every cluster stays on its seed
    const far = new Float64Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]);
    const q = forceLayout(far, [1, 1, 1], []);
    for (let i = 0; i < 9; i++) expect(q[i]).toBeCloseTo(far[i] * PCA_SCALE, 9);
    // a weak link between far seeds pulls them in only partway (anchor resists)
    const r = forceLayout(far, [1, 1, 1], [{ a: 0, b: 1, w: 0.1 }]);
    const d01 = Math.hypot(r[0] - r[3], r[1] - r[4], r[2] - r[5]);
    expect(d01).toBeLessThan(2 * PCA_SCALE);
    expect(d01).toBeGreaterThan(2.3 + 8 * 0.9);
  });

  it('linked clusters end closer than unlinked ones on average', () => {
    const p = forceLayout(means, radii, edges);
    const dist = (a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]) - radii[a] - radii[b];
    const linked = new Set(edges.map(e => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
    let ls = 0, ln = 0, us = 0, un = 0;
    for (let a = 0; a < C; a++) for (let b = a + 1; b < C; b++) {
      if (linked.has(`${a}-${b}`)) { ls += dist(a, b); ln++; } else { us += dist(a, b); un++; }
    }
    expect(ls / ln).toBeLessThan(us / un);
  });

  it('defaults match the design: 300 iterations', () => {
    expect(LAYOUT_DEFAULTS.iterations).toBe(300);
  });
});

describe('starOffsets', () => {
  const docs = webFixture();
  const e = encodeForWorker(docs);
  const stats = clusterStats(e);
  const radii = [...stats.sizes].map(clusterRadius);

  it('uses the real PCA offset normalised by the cluster rms (rms of offsets ≈ R, clamp aside)', () => {
    const off = starOffsets(e, stats, radii);
    const c = e.clusterKeys.indexOf('own/somtor-oracle');
    let s = 0, k = 0;
    for (let i = 0; i < e.n; i++) if (e.clusterOf[i] === c) {
      s += off[i * 3] ** 2 + off[i * 3 + 1] ** 2 + off[i * 3 + 2] ** 2; k++;
      // direction preserved
      const dx = e.pos[i * 3] - stats.means[c * 3];
      if (Math.abs(dx) > 1e-6) expect(Math.sign(off[i * 3])).toBe(Math.sign(dx));
    }
    expect(Math.sqrt(s / k) / radii[c]).toBeGreaterThan(0.8);
    expect(Math.sqrt(s / k) / radii[c]).toBeLessThanOrEqual(1.0001);
  });

  it('never exceeds the soft clamp; a singleton sits on its centre', () => {
    const off = starOffsets(e, stats, radii);
    for (let i = 0; i < e.n; i++) {
      const r = Math.hypot(off[i * 3], off[i * 3 + 1], off[i * 3 + 2]);
      expect(r).toBeLessThanOrEqual(OFFSET_CLAMP * radii[e.clusterOf[i]] + 1e-5);
    }
    const solo = e.clusterKeys.indexOf('own/reelsmith-oracle');
    for (let i = 0; i < e.n; i++) if (e.clusterOf[i] === solo) expect([off[i * 3], off[i * 3 + 1], off[i * 3 + 2]]).toEqual([0, 0, 0]);
  });
});

describe('assignColours', () => {
  const docs = webFixture();
  const e = encodeForWorker(docs);
  const r = interEdges(e);
  const sizes = clusterStats(e).sizes;
  const unsorted = e.clusterKeys.indexOf('∅');

  it('palette ⊆ studio tokens (type colours + accent + warning), no duplicates', () => {
    const tokens = new Set([...Object.values(TYPE_COLORS), ...ACCENT_TOKENS, '#4ade80']);
    for (const c of WEB_PALETTE) expect(tokens.has(c)).toBe(true);
    expect(new Set(WEB_PALETTE).size).toBe(WEB_PALETTE.length);
    expect(WEB_PALETTE.length).toBe(10);
  });

  it('linked neighbours differ; Unsorted is #888888', () => {
    const col = assignColours(sizes, r.edges, unsorted);
    expect(col[unsorted]).toBe(UNSORTED_COLOUR);
    expect(UNSORTED_COLOUR).toBe('#888888');
    for (const x of r.edges) {
      if (x.a === unsorted || x.b === unsorted) continue;
      expect(col[x.a]).not.toBe(col[x.b]);
    }
  });

  it('holds on a dense graph with degree < palette size', () => {
    const n = 40;
    const sz = Array.from({ length: n }, (_, i) => 100 - i);
    const edges: { a: number; b: number }[] = [];
    for (let a = 0; a < n; a++) for (let d = 1; d <= 4; d++) edges.push({ a, b: (a + d * 3) % n });
    const col = assignColours(sz, edges, -1);
    for (const x of edges) expect(col[x.a]).not.toBe(col[x.b]);
  });

  it('is deterministic and independent of doc order', () => {
    const s = shuffled(docs, 4);
    const e2 = encodeForWorker(s);
    const col2 = assignColours(clusterStats(e2).sizes, interEdges(e2).edges, e2.clusterKeys.indexOf('∅'));
    expect(col2).toEqual(assignColours(sizes, r.edges, unsorted));
  });

  it('larger synthetic web still colours conflict-free', () => {
    const t = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i}`);
    const big = synthDocs(Array.from({ length: 24 }, (_, i) => ({
      project: `github.com/tordash/c${i}`, size: 5 + i * 2, theme: [...t(`own${i}`, 5), ...t(`sh${i % 6}`, 4), ...t(`sh${(i + 1) % 6}`, 3)],
    })), { seed: 3 });
    const eb = encodeForWorker(big);
    const rb = interEdges(eb);
    const col = assignColours(clusterStats(eb).sizes, rb.edges, -1);
    expect(Math.max(...rb.degree)).toBeLessThan(WEB_PALETTE.length);
    for (const x of rb.edges) expect(col[x.a]).not.toBe(col[x.b]);
  });
});

describe('drillStarScale', () => {
  it('big drilled clusters get bigger stars (framed from farther away), small ones unchanged, capped', () => {
    expect(drillStarScale(clusterRadius(92))).toBe(1);
    expect(drillStarScale(clusterRadius(1368))).toBeCloseTo(clusterRadius(1368) / 3.5, 9);
    expect(drillStarScale(clusterRadius(4735))).toBeGreaterThan(2.5);
    expect(drillStarScale(clusterRadius(1e6))).toBe(DRILL_STAR_MAX);
  });
});
