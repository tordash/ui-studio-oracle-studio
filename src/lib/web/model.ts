// Knowledge Web — assemble the page model from docs + the worker's core (pure).

import type { MapDocument } from '../../api/oracle';
import type { GalaxyData } from '../galaxy/mapping';
import type { EncodedWeb } from './encode';
import type { CoreResult } from './protocol';
import { clusterStats, starOffsets } from './layout';
import type { ClusterStats } from './layout';
import { buildScene } from './scene';
import type { WebScene } from './scene';
import { buildMotes, moteCounts } from './motes';
import type { MoteBuffers, MoteCounts } from './motes';
import { clusterLabels, sourcesByKey, UNSORTED_KEY, clusterKey } from './keys';
import type { WebModel } from './peek-model';

export interface WebPageModel {
  enc: EncodedWeb;
  core: CoreResult;
  stats: ClusterStats;
  scene: WebScene;
  motes: MoteBuffers | null;
  moteCounts: MoteCounts;
  labels: string[];
  peek: WebModel;
  /** raw project value → cluster index (alias-merged) */
  clusterOfProject: (p: string | null | undefined) => number;
}

export function buildPageModel(
  docs: readonly MapDocument[],
  data: Pick<GalaxyData, 'phases' | 'brightness'>,
  enc: EncodedWeb,
  core: CoreResult,
  nVectors: number | null | undefined,
  now = Date.now(),
): WebPageModel {
  const C = enc.clusterKeys.length;
  const stats = clusterStats(enc);
  const offsets = starOffsets(enc, stats, core.radii);
  const unsorted = enc.clusterKeys.indexOf(UNSORTED_KEY);
  const scene = buildScene({
    clusterOf: enc.clusterOf, centres: core.centres, radii: core.radii, offsets,
    palette: core.palette, phases: data.phases, brightness: data.brightness, unsorted,
  });
  const mc = moteCounts(docs as (MapDocument & { chunks?: number })[], nVectors);
  const motes = mc.source === 'none' ? null : buildMotes(mc.counts, {
    clusterOf: enc.clusterOf, phases: data.phases, radii: core.radii, centres: core.centres, offsets,
    ids: docs.map(d => d.id), createdAt: docs.map(d => d.created_at), rank: enc.rank,
  }, C, now);
  const labelMap = clusterLabels(enc.clusterKeys);
  const labels = enc.clusterKeys.map(k => labelMap.get(k) ?? k);
  const srcMap = sourcesByKey(docs.map(d => d.project));
  const keyIndex = new Map(enc.clusterKeys.map((k, i) => [k, i] as const));
  const peek: WebModel = {
    labels,
    sizes: stats.sizes,
    sources: enc.clusterKeys.map(k => srcMap.get(k) ?? []),
    unsorted,
    edges: core.inter.edges,
    degree: core.inter.degree,
    orphans: core.inter.orphans,
    weak: core.inter.weak,
    totalFiles: enc.n,
    moteSource: mc.source,
    moteTotal: mc.total,
  };
  return {
    enc, core, stats, scene, motes, moteCounts: mc, labels, peek,
    clusterOfProject: p => keyIndex.get(clusterKey(p)) ?? -1,
  };
}
