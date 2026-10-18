import { describe, it, expect } from 'bun:test';
import type { MapDocument } from '../../../api/oracle';
import {
  parsePathDate, docDate, recencyBrightness, BRIGHT_MIN, BRIGHT_MAX, BRIGHT_UNDATED,
  chunkCount, sizeForChunks, SIZE_UNIFORM, SIZE_MAX, normalizeSourcePath, sourceFolder,
  prepareGalaxy, matchSearchResults, matchLocal, computeStates,
  STATE_NORMAL, STATE_DIM, STATE_MATCH, STATE_HIDDEN, galaxyTypeColor, GALAXY_UNKNOWN_COLOR, hexToRgb01,
  GALAXY_RADIUS,
} from '../mapping';

const doc = (o: Partial<MapDocument> & { id: string }): MapDocument => ({
  type: 'learning', source_file: `${o.id}.md`, concepts: [], project: null, x: 0, y: 0, z: 0, created_at: null, ...o,
});

describe('dates', () => {
  it('parses the path date shapes DocDetail understands', () => {
    expect(parsePathDate('ψ/memory/learnings/2026-04-18_x.md')).toBe(Date.UTC(2026, 3, 18));
    expect(parsePathDate('ψ/memory/retrospectives/2026-04/16/08.05_x.md')).toBe(Date.UTC(2026, 3, 16));
    expect(parsePathDate('a/2025/06/10/b.md')).toBe(Date.UTC(2025, 5, 10));
    expect(parsePathDate('ψ/inbox/brief_helm_20260412.md')).toBe(Date.UTC(2026, 3, 12));
    expect(parsePathDate('ψ/memory/resonance/birth.md')).toBeNull();
    expect(parsePathDate('v2026-13-40.md')).toBeNull();
  });
  it('prefers path date over created_at (index time) and labels the source', () => {
    expect(docDate(doc({ id: 'a', source_file: 'x/2026-04-12_a.md', created_at: '2026-04-18T10:00:00Z' })))
      .toEqual({ ms: Date.UTC(2026, 3, 12), source: 'path' });
    expect(docDate(doc({ id: 'b', created_at: '2026-04-18T10:00:00.000Z' })).source).toBe('indexed');
    expect(docDate(doc({ id: 'c' }))).toEqual({ ms: null, source: null });
  });
});

describe('recencyBrightness', () => {
  it('ranks dated stars across the full range; undated stay dim', () => {
    const b = recencyBrightness([30, null, 10, 20]);
    expect(b[2]).toBeCloseTo(BRIGHT_MIN);
    expect(b[3]).toBeCloseTo((BRIGHT_MIN + BRIGHT_MAX) / 2);
    expect(b[0]).toBeCloseTo(BRIGHT_MAX);
    expect(b[1]).toBeCloseTo(BRIGHT_UNDATED);
  });
  it('gives ties the same brightness and survives all-null', () => {
    const b = recencyBrightness([5, 5, 9]);
    expect(b[0]).toBe(b[1]);
    expect(b[2]).toBeCloseTo(BRIGHT_MAX);
    expect(Array.from(recencyBrightness([null, null]))).toEqual([BRIGHT_UNDATED, BRIGHT_UNDATED].map(v => Math.fround(v)));
  });
});

describe('size', () => {
  it('reads chunks or chunk_ids, else null → uniform', () => {
    expect(chunkCount({ ...doc({ id: 'a' }), chunks: 4 } as MapDocument & { chunks: number })).toBe(4);
    expect(chunkCount(doc({ id: 'b', chunk_ids: ['1', '2'] }))).toBe(2);
    expect(chunkCount(doc({ id: 'c' }))).toBeNull();
    expect(sizeForChunks(null)).toBe(SIZE_UNIFORM);
    expect(sizeForChunks(1)).toBe(SIZE_UNIFORM);
    expect(sizeForChunks(8)).toBeGreaterThan(sizeForChunks(2));
    expect(sizeForChunks(100000)).toBe(SIZE_MAX);
  });
});

describe('paths & colours', () => {
  it('normalises search-style paths to map3d-style paths', () => {
    expect(normalizeSourcePath('../ghq/github.com/tordash/chronos-oracle/ψ/memory/x.md')).toBe('ψ/memory/x.md');
    expect(normalizeSourcePath('ψ/Memory/X.md')).toBe('ψ/memory/x.md');
    expect(sourceFolder('ψ/learn/gsd-build/repo/README.md')).toBe('learn/gsd-build');
    expect(sourceFolder('clients/dopelab/social-content/a.md')).toBe('clients/dopelab');
  });
  it('colours by type with an honest unknown fallback', () => {
    expect(galaxyTypeColor('learning')).not.toBe(GALAXY_UNKNOWN_COLOR);
    expect(galaxyTypeColor('nope')).toBe(GALAXY_UNKNOWN_COLOR);
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
  });
});

describe('prepareGalaxy + matching + states', () => {
  const docs = [
    doc({ id: 'a_0', source_file: 'ψ/memory/2026-04-01_alpha.md', x: 1, y: -1, z: 0.5, concepts: ['oracle'] }),
    doc({ id: 'b_3', source_file: 'ψ/learn/beta.md', type: 'retro', project: 'github.com/o/r' }),
    doc({ id: 'c_1', source_file: 'ψ/inbox/gamma.md', title: 'Gamma ทดสอบ' } as Partial<MapDocument> & { id: string }),
  ];
  const g = prepareGalaxy(docs);
  it('maps positions, types, flags', () => {
    expect(g.count).toBe(3);
    expect(Array.from(g.positions.slice(0, 3))).toEqual([GALAXY_RADIUS, -GALAXY_RADIUS, GALAXY_RADIUS / 2]);
    expect(g.typeCounts).toEqual({ learning: 2, retro: 1 });
    expect(g.hasChunks).toBe(false);
    expect(g.flat).toBe(false);
    expect(g.titles[2]).toBe('Gamma ทดสอบ');
    expect(g.titles[1]).toBe('beta');
    expect(g.dateSourceCounts).toEqual({ path: 1, indexed: 0, undated: 2 });
  });
  it('matches search results by id or by normalised source_file (chunk ids differ)', () => {
    const m = matchSearchResults(g, [
      { id: 'a_0' },
      { id: 'beta_7', source_file: '../ghq/github.com/o/r/ψ/learn/beta.md' },
      { id: 'zzz', source_file: 'nowhere.md' },
    ]);
    expect([...m].sort()).toEqual([0, 1]);
    expect([...matchLocal(g, 'ORACLE')]).toEqual([0]);
    expect([...matchLocal(g, 'ทดสอบ')]).toEqual([2]);
    expect(matchLocal(g, '  ').size).toBe(0);
  });
  it('computes shader states for search, type filter and project filter', () => {
    expect(Array.from(computeStates(g, {}))).toEqual([STATE_NORMAL, STATE_NORMAL, STATE_NORMAL]);
    expect(Array.from(computeStates(g, { matches: new Set([1]) }))).toEqual([STATE_DIM, STATE_MATCH, STATE_DIM]);
    expect(Array.from(computeStates(g, { hiddenTypes: new Set(['retro']) }))).toEqual([STATE_NORMAL, STATE_HIDDEN, STATE_NORMAL]);
    expect(Array.from(computeStates(g, { project: 'github.com/o/r' }))).toEqual([STATE_DIM, STATE_NORMAL, STATE_DIM]);
    expect(Array.from(computeStates(g, { project: '' }))).toEqual([STATE_NORMAL, STATE_DIM, STATE_NORMAL]);
  });
});
