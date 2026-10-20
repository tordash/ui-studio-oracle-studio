import { useEffect, useState } from 'react';
import { getSimilar } from '../../api/oracle';
import { mapSimilar } from '../../lib/web/related';
import type { RelatedContext, RelatedRow } from '../../lib/web/related';

export const RELATED_LIMIT = 12;
const COLLAPSED = 4;

interface RelatedProps {
  docId: string;
  ctx: RelatedContext;
  palette: readonly string[];
  /** tap a row: same cluster → fly + open; other cluster → drill there, then open */
  onHop: (row: RelatedRow) => void;
  /** mapped rows, for the dotted vector layer inside a drill */
  onRows?: (rows: RelatedRow[]) => void;
}

type State = { status: 'loading' } | { status: 'ready'; rows: RelatedRow[] } | { status: 'error' };

/**
 * Related (vector neighbours, cross-oracle) for the open file. Order is the API's;
 * no score is shown — /api/similar returns 0 for every result today. Copies of the
 * same ψ file in several repos collapse into one row with an "also in" chip.
 */
export function Related({ docId, ctx, palette, onHop, onRows }: RelatedProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [shownFor, setShownFor] = useState(docId);
  if (shownFor !== docId) { setShownFor(docId); setState({ status: 'loading' }); setExpanded(false); }

  useEffect(() => {
    let cancelled = false;
    getSimilar(docId, RELATED_LIMIT)
      .then(res => {
        if (cancelled) return;
        const rows = mapSimilar(res.results ?? [], ctx);
        setState({ status: 'ready', rows });
        onRows?.(rows);
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
    // ctx / onRows are stable per open file; refetch only when the file changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const rows = state.status === 'ready' ? state.rows : [];
  const visible = expanded ? rows : rows.slice(0, COLLAPSED);

  return (
    <section aria-labelledby="web-related-title" className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <h3 id="web-related-title" className="flex items-baseline justify-between text-[12px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
        <span>Related{state.status === 'ready' ? ` · ${rows.length}` : ''}</span>
        <span className="font-normal normal-case tracking-normal">vector neighbours, any oracle</span>
      </h3>
      {state.status === 'loading' && (
        <ul aria-busy="true" className="mt-2 flex flex-col gap-2">
          {[0, 1, 2].map(i => <li key={i} className="h-11 rounded-md bg-white/[0.03] motion-safe:animate-pulse" />)}
        </ul>
      )}
      {state.status === 'error' && <p className="mt-2 text-[14px] text-text-secondary">Related unavailable — the document below still loads.</p>}
      {state.status === 'ready' && rows.length === 0 && <p className="mt-2 text-[14px] text-text-secondary">No related documents in the index.</p>}
      {visible.length > 0 && (
        <ul className="mt-1 flex flex-col divide-y divide-white/[0.05]">
          {visible.map(r => {
            const col = r.cluster >= 0 ? palette[r.cluster] ?? '#888888' : '#888888';
            const label = r.cluster >= 0 ? ctx.labels[r.cluster] : 'not in the map';
            return (
              <li key={r.key}>
                <button
                  type="button"
                  disabled={r.star < 0}
                  onClick={() => onHop(r)}
                  className="flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1 py-2 text-left transition-colors duration-150 enabled:hover:bg-white/[0.03] disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className={`line-clamp-2 break-words text-[15px] leading-snug ${r.star >= 0 ? 'text-text-primary' : 'text-text-secondary'}`}>{r.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
                      {label}
                    </span>
                    {r.alsoIn.length > 0 && <span className="rounded-full bg-white/[0.04] px-2 py-0.5">also in {r.alsoIn.join(', ')}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="mt-1 min-h-11 w-full rounded-md text-[14px] text-accent transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {expanded ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      {state.status === 'ready' && rows.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-snug text-text-secondary">Ordered by vector search. No similarity score is shown: the index returns none yet.</p>
      )}
    </section>
  );
}
