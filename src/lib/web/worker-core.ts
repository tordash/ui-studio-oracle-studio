// Knowledge Web — the worker's message handler, pure (no `self`, testable under bun).
// workers/web.worker.ts only wires `onmessage` to this; the main-thread fallback
// (lib/web/client.ts) calls the same functions when a Worker can't start.

import type { EncodedWeb } from './encode';
import { interEdges } from './inter';
import { intraEdges } from './intra';
import { clusterRadius, clusterStats, forceLayout } from './layout';
import { assignColours } from './palette';
import { UNSORTED_KEY } from './keys';
import { ALGO_V1 } from './protocol';
import type { CoreResult, WebRequest, WebResponse } from './protocol';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function computeCore(enc: EncodedWeb): CoreResult {
  const t0 = now();
  const stats = clusterStats(enc);
  const radii = [...stats.sizes].map(clusterRadius);
  const inter = interEdges(enc);
  const centres = forceLayout(stats.means, radii, inter.edges);
  const palette = assignColours(stats.sizes, inter.edges, enc.clusterKeys.indexOf(UNSORTED_KEY));
  return { algo: ALGO_V1, inter, centres: [...centres], radii, palette, ms: now() - t0 };
}

export interface WebCoreState { enc: EncodedWeb | null }

export function createCoreState(): WebCoreState {
  return { enc: null };
}

/** Handle one request. `transfer` lists buffers the reply may move instead of copy. */
export function handleWebRequest(state: WebCoreState, req: WebRequest): { res: WebResponse; transfer: ArrayBuffer[] } {
  try {
    if (req.kind === 'init') {
      state.enc = req.enc;
      return { res: { id: req.id, ok: true, kind: 'init' }, transfer: [] };
    }
    const enc = state.enc;
    if (!enc) return { res: { id: req.id, ok: false, error: 'not initialised' }, transfer: [] };
    if (req.kind === 'core') {
      return { res: { id: req.id, ok: true, kind: 'core', result: computeCore(enc) }, transfer: [] };
    }
    if (req.kind === 'intra') {
      if (!(req.cluster >= 0 && req.cluster < enc.clusterKeys.length)) {
        return { res: { id: req.id, ok: false, error: `unknown cluster ${req.cluster}` }, transfer: [] };
      }
      const t0 = now();
      const r = intraEdges(enc, req.cluster);
      const ms = now() - t0;
      const transfer = [r.members, r.nbrOff, r.nbr, r.score, r.edgeI, r.edgeJ, r.edgeS].map(a => a.buffer as ArrayBuffer);
      return { res: { id: req.id, ok: true, kind: 'intra', result: r, ms }, transfer };
    }
    return { res: { id: (req as { id: number }).id, ok: false, error: 'unknown request' }, transfer: [] };
  } catch (err) {
    return { res: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}
