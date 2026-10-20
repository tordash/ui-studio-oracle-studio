// Knowledge Web — cluster colours from studio tokens only (pure).
//
// Colour by cluster, not type: 13,083 of 13,089 docs are `learning`, so type
// colour would be one blue blob. Hues are the studio's own tokens — the type
// badge palette (lib/type-colors.ts) plus accent + warning (index.css @theme;
// success #4ade80 is the same hex as retro, so it is not a separate hue): 10.
// Greedy colouring over the drawn links, largest cluster first, so linked
// neighbours differ. Unsorted is the "unknown" grey the badges already use.

import { TYPE_COLORS, TYPE_COLOR_FALLBACK } from '../type-colors';

/** index.css @theme --color-accent / --color-warning */
export const ACCENT_TOKENS = ['#64b5f6', '#fbbf24'] as const;

export const WEB_PALETTE: readonly string[] = [...new Set([...Object.values(TYPE_COLORS), ...ACCENT_TOKENS])];

export const UNSORTED_COLOUR = TYPE_COLOR_FALLBACK;

export function assignColours(
  sizes: ArrayLike<number>,
  edges: readonly { a: number; b: number }[],
  unsorted: number,
  palette: readonly string[] = WEB_PALETTE,
): string[] {
  const C = sizes.length;
  const nbrs: number[][] = Array.from({ length: C }, () => []);
  for (const e of edges) { nbrs[e.a].push(e.b); nbrs[e.b].push(e.a); }
  const order = Array.from({ length: C }, (_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const colour = new Int32Array(C).fill(-1);
  const used = new Int32Array(palette.length);
  const out = new Array<string>(C);
  for (const c of order) {
    if (c === unsorted) { out[c] = UNSORTED_COLOUR; continue; }
    const clash = new Int32Array(palette.length);
    for (const n of nbrs[c]) if (colour[n] >= 0) clash[colour[n]]++;
    // fewest clashing neighbours (0 whenever a free hue exists), then least used, then palette order
    let best = 0;
    for (let h = 1; h < palette.length; h++) {
      if (clash[h] < clash[best] || (clash[h] === clash[best] && used[h] < used[best])) best = h;
    }
    colour[c] = best;
    used[best]++;
    out[c] = palette[best];
  }
  return out;
}
