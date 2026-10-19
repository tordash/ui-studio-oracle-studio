// Fleet Constellation — ribbon width from message count (log scale; pair counts are heavily skewed).

export const EDGE_WIDTH_MIN = 1;
export const EDGE_WIDTH_MAX = 10;

/** CSS px (the shader multiplies by DPR): clamp(1 + 2.4·log2(1+n), 1, 10). */
export function edgeWidthPx(count: number): number {
  if (!(count > 0)) return EDGE_WIDTH_MIN;
  return Math.min(EDGE_WIDTH_MAX, Math.max(EDGE_WIDTH_MIN, 1 + 2.4 * Math.log2(1 + count)));
}
