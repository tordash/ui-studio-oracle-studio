// Optional parity check against a saved /api/map3d response (never committed).
//   WEB_SNAPSHOT=/path/to/map3d.json bun test src/lib/web/__tests__/snapshot.test.ts
// Skipped in normal runs — tests stay fixture-only (no network, no data files).
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { encodeForWorker } from '../encode';
import { interEdges } from '../inter';
import { intraEdges } from '../intra';

const path = process.env.WEB_SNAPSHOT;

describe.skipIf(!path)('snapshot parity (design §3.2–3.3)', () => {
  const data = path ? JSON.parse(readFileSync(path, 'utf8')) : { documents: [] };
  const e = encodeForWorker(data.documents);

  it('77 clusters after the owner merge', () => {
    expect(e.clusterKeys.length).toBe(77);
  });

  it('inter: ≈143 edges, max degree ≤ 10, top-5 explains ≥ 95% at the median', () => {
    const r = interEdges(e);
    expect(r.edges.length).toBeGreaterThanOrEqual(130);
    expect(r.edges.length).toBeLessThanOrEqual(150);
    expect(Math.max(...r.degree)).toBeLessThanOrEqual(10);
    const ex = r.edges.map(x => x.top5).sort((a, b) => a - b);
    expect(ex[ex.length >> 1]).toBeGreaterThanOrEqual(0.95);
    // without the w ≥ 0.02 filter it is exactly the design's Python result
    const raw = interEdges(e, { wMin: 0 });
    expect(raw.edges.length).toBe(143);
    expect(Math.max(...raw.degree)).toBe(10);
    expect(raw.orphans.length).toBe(6);
  });

  it('intra coverage reproduces (±1 pt)', () => {
    const want: Record<string, number> = {
      '∅': 0.854, 'own/marketing-agency-team': 0.814, 'own/tor-oracle': 0.904, 'own/somtor-oracle': 0.891,
    };
    for (const [key, cov] of Object.entries(want)) {
      const r = intraEdges(e, e.clusterKeys.indexOf(key));
      expect(Math.abs(r.coverage - cov)).toBeLessThan(0.01);
    }
  });
});
