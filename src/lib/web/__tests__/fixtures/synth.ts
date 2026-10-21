// Deterministic synthetic map3d docs for Knowledge Web tests (no network, no snapshot).

import type { MapDocument } from '../../../../api/oracle';
import { mulberry32 } from '../../../galaxy/clusters';

export interface SynthCluster {
  project: string | null;
  size: number;
  /** concepts this cluster draws most of its files' concepts from */
  theme: string[];
  /** cluster centre in the PCA cube */
  centre?: [number, number, number];
}

export interface SynthOptions {
  seed?: number;
  /** concepts every cluster draws from (low lift) */
  common?: string[];
  /** concepts per file: [min, max] */
  perFile?: [number, number];
  /** chance a concept comes from `common` instead of the theme */
  commonRate?: number;
}

export function synthDocs(clusters: SynthCluster[], opts: SynthOptions = {}): MapDocument[] {
  const rand = mulberry32(opts.seed ?? 12);
  const common = opts.common ?? ['session', 'oracle', 'file', 'pattern'];
  const [lo, hi] = opts.perFile ?? [3, 8];
  const commonRate = opts.commonRate ?? 0.3;
  const docs: MapDocument[] = [];
  clusters.forEach((cl, ci) => {
    const c = cl.centre ?? [Math.cos(ci) * 0.5, Math.sin(ci) * 0.5, (ci % 3) * 0.2 - 0.2];
    for (let i = 0; i < cl.size; i++) {
      const k = lo + Math.floor(rand() * (hi - lo + 1));
      const set = new Set<string>();
      for (let j = 0; j < k * 3 && set.size < k; j++) {
        const pool = rand() < commonRate || cl.theme.length === 0 ? common : cl.theme;
        set.add(pool[Math.floor(rand() * pool.length)]);
      }
      docs.push({
        id: `${cl.project ?? 'none'}#${i}`,
        type: 'learning',
        source_file: `ψ/memory/${ci}/${i}.md`,
        concepts: [...set],
        project: cl.project,
        x: c[0] + (rand() - 0.5) * 0.2,
        y: c[1] + (rand() - 0.5) * 0.2,
        z: c[2] + (rand() - 0.5) * 0.2,
        created_at: null,
      });
    }
  });
  return docs;
}

/** Seeded Fisher–Yates copy. */
export function shuffled<T>(arr: readonly T[], seed = 99): T[] {
  const rand = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Plain doc with explicit concepts. */
export function doc(id: string, project: string | null, concepts: string[], x = 0, y = 0, z = 0): MapDocument {
  return { id, type: 'learning', source_file: `${id}.md`, concepts, project, x, y, z, created_at: null };
}

/** A small realistic web: themed clusters with overlapping themes and a big Unsorted. */
export function webFixture(seed = 12): MapDocument[] {
  const t = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i}`);
  const shared = t('bridge', 6);
  return synthDocs([
    { project: null, size: 120, theme: [...t('misc', 30), ...shared] },
    { project: 'github.com/tordash/marketing-agency-team', size: 90, theme: [...t('mkt', 20), ...shared.slice(0, 3)] },
    { project: 'github.com/torsupakit/marketing-agency-team', size: 4, theme: t('mkt', 20) },
    { project: 'github.com/tordash/somtor-oracle', size: 30, theme: [...t('somtor', 10), ...t('arra', 4)] },
    { project: 'github.com/tordash/arra-oracle-v3', size: 12, theme: [...t('arra', 8), 'somtor-1', 'somtor-2'] },
    { project: 'github.com/soul-brews-studio/arra-oracle-v3', size: 6, theme: t('arra', 8) },
    { project: 'github.com/tordash/beam-oracle', size: 5, theme: ['soul-sync', 'identity', 'beam-x'] },
    { project: 'github.com/tordash/lookout-oracle', size: 8, theme: ['soul-sync', 'identity', 'lookout-x', 'lookout-y'] },
    { project: 'github.com/tordash/reelsmith-oracle', size: 1, theme: ['reel-a', 'reel-b'] },
  ], { seed });
}
