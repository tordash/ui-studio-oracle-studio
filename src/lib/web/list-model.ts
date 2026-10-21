// Knowledge Web — the accessible list view's rows (pure; same model as the canvas).

import type { WebModel } from './peek-model';

export interface ClusterListRow {
  cluster: number;
  label: string;
  files: number;
  links: number;
  /** strongest shared concepts across its drawn links (weighted by link weight × share) */
  concepts: string[];
  unsorted: boolean;
  orphan: boolean;
}

export function clusterRows(m: WebModel, maxConcepts = 3): ClusterListRow[] {
  const score: Map<string, number>[] = m.labels.map(() => new Map());
  for (const e of m.edges) {
    for (const v of e.evidence) {
      const add = e.w * v.share;
      for (const c of [e.a, e.b]) score[c].set(v.concept, (score[c].get(v.concept) ?? 0) + add);
    }
  }
  return m.labels
    .map((label, c) => ({
      cluster: c,
      label,
      files: m.sizes[c],
      links: m.degree[c] ?? 0,
      concepts: [...score[c].entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxConcepts).map(x => x[0]),
      unsorted: c === m.unsorted,
      orphan: m.orphans.includes(c),
    }))
    .sort((a, b) => b.files - a.files || a.cluster - b.cluster);
}

export interface FileListRow { star: number; title: string; date: string; links: number | null }

export const FILE_PAGE = 100;

/** A drilled cluster's files, newest first (undated last), `page` × 100 at a time. */
export function fileRows(
  stars: readonly number[],
  titles: readonly string[],
  dates: readonly (number | null)[],
  formatDate: (ms: number | null) => string,
  linkCount: ((star: number) => number) | null,
  page: number,
): { rows: FileListRow[]; total: number; more: boolean } {
  const sorted = [...stars].sort((a, b) => (dates[b] ?? -Infinity) - (dates[a] ?? -Infinity) || (titles[a] < titles[b] ? -1 : titles[a] > titles[b] ? 1 : a - b));
  const n = Math.min(sorted.length, Math.max(1, page) * FILE_PAGE);
  return {
    rows: sorted.slice(0, n).map(s => ({ star: s, title: titles[s], date: formatDate(dates[s]), links: linkCount ? linkCount(s) : null })),
    total: sorted.length,
    more: n < sorted.length,
  };
}

/** The list footnote: every limit of the data, said plainly. */
export function listFootnote(m: Pick<WebModel, 'moteSource' | 'moteTotal' | 'totalFiles'>, coverage: number | null): string[] {
  const out = [
    'Links come from each file’s first 10 concepts (arra keeps at most 10 per file), weighted so concepts every cluster shares count for nothing.',
  ];
  if (coverage != null) out.push(`${Math.round(coverage * 100)}% of this cluster’s files share a specific concept with another file; the rest still have Related (vector) neighbours.`);
  if (m.moteSource === 'estimate') {
    out.push(`Chunk particles are estimated: ≈${m.totalFiles ? Math.round(m.moteTotal / m.totalFiles) : 0} per file from ${m.moteTotal.toLocaleString('en-US')} indexed chunks, until arra reports exact counts per file.`);
  }
  return out;
}
