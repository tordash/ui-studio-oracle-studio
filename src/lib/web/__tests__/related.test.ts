import { describe, it, expect } from 'bun:test';
import { mapSimilar, inClusterStars, withTimeout, RelatedTimeoutError, RELATED_TIMEOUT_MS } from '../related';
import type { RelatedContext } from '../related';
import { prepareGalaxy } from '../../galaxy/mapping';
import { clusterKey } from '../keys';
import type { MapDocument } from '../../../api/oracle';

const d = (id: string, source_file: string, project: string | null): MapDocument => ({
  id, type: 'learning', source_file, concepts: [], project, x: 0, y: 0, z: 0, created_at: null,
});

const docs = [
  d('self', 'ψ/memory/learnings/story-pipeline.md', 'github.com/tordash/somtor-oracle'),
  d('a-som', 'ψ/memory/learnings/ci-proof.md', 'github.com/tordash/somtor-oracle'),
  d('a-tor', 'ψ/memory/learnings/ci-proof.md', 'github.com/tordash/tor-oracle'),
  d('b', 'ψ/inbox/handoff-14.md', null),
  d('c', 'ψ/memory/learnings/arra-deploy.md', 'github.com/tordash/arra-oracle-v3'),
];
const data = prepareGalaxy(docs);
const keys = ['own/somtor-oracle', 'own/tor-oracle', '∅', 'own/arra-oracle-v3'];
const labels = ['somtor', 'tor', 'Unsorted', 'arra-oracle-v3'];
const ctx: RelatedContext = {
  data,
  selfIdx: 0,
  clusterOfStar: i => keys.indexOf(clusterKey(docs[i].project)),
  clusterOfProject: p => keys.indexOf(clusterKey(p)),
  labels,
};

describe('mapSimilar', () => {
  it('maps ../ghq/… paths onto stars and keeps the API order', () => {
    const rows = mapSimilar([
      { id: 'x1', source_file: '../ghq/github.com/tordash/arra-oracle-v3/ψ/memory/learnings/arra-deploy.md', project: 'github.com/tordash/arra-oracle-v3' },
      { id: 'b', source_file: 'ψ/inbox/handoff-14.md' },
    ], ctx);
    expect(rows.map(r => r.star)).toEqual([4, 3]);
    expect(rows.map(r => r.cluster)).toEqual([3, 2]);
    expect(rows[0].title).toBe(data.titles[4]);
  });

  it('collapses same-path copies into "also in", preferring the same-project star', () => {
    const rows = mapSimilar([
      { source_file: '../ghq/github.com/tordash/tor-oracle/ψ/memory/learnings/ci-proof.md', project: 'github.com/tordash/tor-oracle' },
      { source_file: '../ghq/github.com/tordash/SomTor-oracle/ψ/memory/learnings/ci-proof.md', project: 'github.com/tordash/somtor-oracle' },
      { source_file: '../Projects/x/ψ/memory/learnings/ci-proof.md', project: null },
    ], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].star).toBe(2);              // tor's copy, because the first result is tor's
    expect(rows[0].alsoIn).toEqual(['somtor']); // the null-project copy resolves to a map star in somtor/tor → deduped
  });

  it('drops the opened file itself (by id or by path)', () => {
    const rows = mapSimilar([
      { id: 'self', source_file: 'ψ/memory/learnings/story-pipeline.md' },
      { source_file: '../ghq/github.com/tordash/tor-oracle/ψ/memory/learnings/story-pipeline.md' },
      { id: 'c' },
    ], ctx);
    expect(rows.map(r => r.star)).toEqual([4]);
  });

  it('never carries a score; unknown files stay listed honestly', () => {
    const rows = mapSimilar([{ id: 'nope', source_file: 'ψ/lab/unknown-file.md', project: 'github.com/tordash/tor-oracle', ...{ score: 0 } } as never], ctx);
    expect(rows[0]).toEqual({ key: 'ψ/lab/unknown-file.md', star: -1, title: 'unknown file', cluster: 1, alsoIn: [], path: 'ψ/lab/unknown-file.md' });
    expect(Object.keys(rows[0])).not.toContain('score');
  });

  it('inClusterStars feeds the dotted vector layer', () => {
    const rows = mapSimilar([{ id: 'a-som' }, { id: 'c' }, { id: 'nope', source_file: 'zz.md' }], ctx);
    expect(inClusterStars(rows, 0)).toEqual([1]);
  });
});

describe('withTimeout (Related never sits on skeletons)', () => {
  it('passes a value or an error through', async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
  it('rejects a stalled request with a RelatedTimeoutError', async () => {
    const t0 = performance.now();
    const p = withTimeout(new Promise<number>(() => { /* never settles */ }), 30);
    await expect(p).rejects.toBeInstanceOf(RelatedTimeoutError);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('the cap is generous next to a normal /api/similar (0.1–0.4 s) but finite', () => {
    expect(RELATED_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(RELATED_TIMEOUT_MS).toBeLessThanOrEqual(20000);
  });
});
