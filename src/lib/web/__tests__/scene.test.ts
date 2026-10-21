import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScene, starWorldPos, starWorldPositions, starsOf } from '../scene';
import { DRILL_SCALE } from '../layout';

const sc = buildScene({
  clusterOf: [0, 1, 1, 0],
  centres: [0, 0, 0, 10, 0, 0],
  radii: [1, 2],
  offsets: [1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0],
  palette: ['#60a5fa', '#888888'],
  phases: [0.1, 0.2, 0.3, 0.4],
  brightness: [1, 0.5, 0.5, 0.22],
  unsorted: 1,
});

describe('buildScene', () => {
  it('packs per-star centre / meta / colour from the cluster', () => {
    expect([...sc.starCentre.subarray(3, 6)]).toEqual([10, 0, 0]);
    expect([...sc.starMeta.subarray(4, 8)].map(v => +v.toFixed(3))).toEqual([1, 0.2, 2, 0.5]);
    expect(sc.starColor[3]).toBeCloseTo(0x88 / 255, 6);
    expect([...sc.coreMeta.subarray(4, 8)]).toEqual([1, 2, 0, 1]); // unsorted flag
    expect(sc.bounds.radius).toBeGreaterThan(5);
  });
  it('starWorldPos = centre + offset, × DRILL_SCALE for the drilled cluster', () => {
    expect(starWorldPos(sc, 1)).toEqual([10, 1, 0]);
    expect(starWorldPos(sc, 1, 1, 1)).toEqual([10, DRILL_SCALE, 0]);
    expect(starWorldPos(sc, 1, 0.5, 1)[1]).toBeCloseTo(1 + (DRILL_SCALE - 1) * 0.5, 6);
    expect(starWorldPos(sc, 0, 1, 1)).toEqual([1, 0, 0]); // other clusters keep their offset
    const all = starWorldPositions(sc, 1, 1);
    expect([...all.subarray(3, 6)]).toEqual([10, Math.fround(DRILL_SCALE), 0]);
    expect(starsOf(sc, 1)).toEqual([1, 2]);
  });
});

describe('galaxy engine diff', () => {
  it('galaxy only swaps its inline backdrop for the shared helper', () => {
    const src = readFileSync(join(import.meta.dir, '../../../components/galaxy/engine.ts'), 'utf8');
    expect(src).toContain("import { createBackdrop } from '../../lib/three/backdrop';");
    expect(src).toContain('const bd = createBackdrop(this.pixelRatio);');
    expect(src).not.toContain('BACKDROP_VERT');
    expect(src).not.toContain('mulberry32');
  });
  it('the web engine never uses Math.random', () => {
    const src = readFileSync(join(import.meta.dir, '../../../components/web/engine.ts'), 'utf8');
    expect(src).not.toContain('Math.random');
  });
});
