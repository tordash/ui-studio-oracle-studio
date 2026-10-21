// Knowledge Web — worker message protocol (types only + the algorithm version tag).

import type { EncodedWeb } from './encode';
import type { InterResult } from './inter';
import type { IntraResult } from './intra';

/** Bump when any of inter / layout / palette changes output, so cached results expire. */
export const ALGO_V1 = 'web-v1';

/** The persistable overview: inter links + layout + colours (~30 KB, plain JSON-safe data). */
export interface CoreResult {
  algo: string;
  inter: InterResult;
  /** cluster centres, world units (C × 3) */
  centres: number[];
  /** cluster radii, world units */
  radii: number[];
  /** hex colour per cluster */
  palette: string[];
  /** ms spent computing (0 when it came from a cache) */
  ms: number;
}

export type WebRequest =
  | { id: number; kind: 'init'; enc: EncodedWeb }
  | { id: number; kind: 'core' }
  | { id: number; kind: 'intra'; cluster: number };

export type WebResponse =
  | { id: number; ok: true; kind: 'init' }
  | { id: number; ok: true; kind: 'core'; result: CoreResult }
  | { id: number; ok: true; kind: 'intra'; result: IntraResult; ms: number }
  | { id: number; ok: false; error: string };
