// Fleet Constellation — which nodes get a DOM label (pure). A pool of ≤ 12
// buttons: the selected and hovered nodes always, then the top ranks.
// Labels on the back hemisphere hide (dot(normal, viewDir) < −0.15).

export const LABEL_MAX = 12;
export const BACKSIDE_DOT = -0.15;

/** `ranked` = node keys, busiest first. Returned in priority order. */
export function chooseLabels(ranked: readonly string[], selected: string | null, hovered: string | null, max: number = LABEL_MAX): string[] {
  const known = new Set(ranked);
  const out: string[] = [];
  for (const k of [selected, hovered, ...ranked]) {
    if (out.length >= max) break;
    if (k && known.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Declutter priority: selected > hovered > rank (lower rank = higher priority). */
export function labelPriority(key: string, rank: number, selected: string | null, hovered: string | null): number {
  if (key === selected) return 1e6;
  if (key === hovered) return 1e5;
  return 1e4 - rank;
}

export const backside = (dot: number) => dot < BACKSIDE_DOT;
