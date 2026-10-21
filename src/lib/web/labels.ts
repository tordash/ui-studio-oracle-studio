// Knowledge Web — which cluster labels may show (pure). T21: at home every label fought
// for the same few hundred px and pills overlapped. Now a label is a candidate only if
//   • its cluster is armed (tapped / hovered / keyboard-focused), or
//   • it is among the top-N clusters by file count, or
//   • its cluster is drawn big enough on screen (radius ≥ REVEAL px) — so zooming in
//     reveals the rest;
// then galaxy's declutterLabels keeps the bigger one on any overlap, with pill-tight
// boxes (the 44 px button's transparent padding is ignored, a few px gap is kept).

export const LABEL_TOP_N_WIDE = 8;
export const LABEL_TOP_N_PHONE = 5;
export const LABEL_REVEAL_PX = 46;
/** button px-1 (4 px) minus a 2 px gap each side → pills never touch */
export const LABEL_INSET_X = 2;
/** 44 px button around a ~23 px pill (≈ 10 px padding) minus a ~2 px gap */
export const LABEL_INSET_Y = 8;

/** rank[c] = 0 for the biggest cluster; ties by index (deterministic). */
export function sizeRanks(sizes: ArrayLike<number>): Int32Array {
  const n = sizes.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (sizes[b] ?? 0) - (sizes[a] ?? 0) || a - b);
  const rank = new Int32Array(n);
  order.forEach((c, r) => { rank[c] = r; });
  return rank;
}

export function labelEligible(
  a: { cluster: number; radiusPx: number },
  rank: ArrayLike<number>,
  armed: number,
  topN: number,
  revealPx = LABEL_REVEAL_PX,
): boolean {
  if (a.cluster === armed) return true;
  if ((rank[a.cluster] ?? Infinity) < topN) return true;
  return a.radiusPx >= revealPx;
}
