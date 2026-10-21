import { describe, it, expect } from 'bun:test';
import { buildPageModel } from '../model';
import { encodeForWorker } from '../encode';
import { computeCore } from '../worker-core';
import { prepareGalaxy } from '../../galaxy/mapping';
import { webFixture } from './fixtures/synth';

describe('buildPageModel', () => {
  const docs = webFixture();
  const data = prepareGalaxy(docs);
  const enc = encodeForWorker(docs);
  const core = computeCore(enc);
  const m = buildPageModel(docs, data, enc, core, docs.length * 6 - 3, Date.UTC(2026, 9, 21));

  it('scene, labels and peek model line up with the cluster keys', () => {
    expect(m.scene.n).toBe(docs.length);
    expect(m.scene.C).toBe(enc.clusterKeys.length);
    expect(m.labels.length).toBe(enc.clusterKeys.length);
    expect(m.labels[enc.clusterKeys.indexOf('own/somtor-oracle')]).toBe('somtor');
    expect(m.labels[enc.clusterKeys.indexOf('own/marketing-agency-team')]).toBe('Helm');
    expect(m.peek.sources[enc.clusterKeys.indexOf('own/marketing-agency-team')]).toHaveLength(2);
    expect(m.peek.unsorted).toBe(enc.clusterKeys.indexOf('∅'));
    expect(m.peek.totalFiles).toBe(docs.length);
  });
  it('motes use the labelled estimate when the API has no per-file counts', () => {
    expect(m.moteCounts.source).toBe('estimate');
    expect(m.motes?.count).toBe(docs.length * 6 - 3);
    expect(m.peek.moteSource).toBe('estimate');
  });
  it('maps raw project values to merged clusters', () => {
    expect(m.clusterOfProject('github.com/torsupakit/marketing-agency-team')).toBe(enc.clusterKeys.indexOf('own/marketing-agency-team'));
    expect(m.clusterOfProject(null)).toBe(enc.clusterKeys.indexOf('∅'));
    expect(m.clusterOfProject('github.com/x/nope')).toBe(-1);
  });
  it('no chunk total → no motes, said so', () => {
    const none = buildPageModel(docs, data, enc, core, undefined);
    expect(none.motes).toBeNull();
    expect(none.peek.moteSource).toBe('none');
  });
});
