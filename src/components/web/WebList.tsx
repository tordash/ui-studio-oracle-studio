import { useMemo, useState } from 'react';
import type { WebModel } from '../../lib/web/peek-model';
import { clusterRows, fileRows, listFootnote } from '../../lib/web/list-model';
import { GALAXY_FONT_STACK } from '../galaxy/engine';

interface WebListProps {
  model: WebModel;
  palette: readonly string[];
  titleId: string;
  /** -1 = overview (cluster table); ≥ 0 = that cluster's files */
  drilled: number;
  drilledStars: readonly number[];
  titles: readonly string[];
  dates: readonly (number | null)[];
  formatDate: (ms: number | null) => string;
  /** concept links per file in the drilled cluster (null until loaded) */
  linkCount: ((star: number) => number) | null;
  coverage: number | null;
  onEnter: (cluster: number) => void;
  onOpenStar: (star: number) => void;
  onClose?: () => void;
}

/**
 * The accessible list view — the same model as the canvas, in a table. Overview:
 * every cluster with files, drawn links and its strongest shared concepts (a row
 * drills in). Inside a cluster: its files, 100 at a time. The footnote states the
 * data's limits (concept cap, coverage, estimated particles).
 */
export function WebList(p: WebListProps) {
  const [page, setPage] = useState(1);
  const [pageFor, setPageFor] = useState(p.drilled);
  if (pageFor !== p.drilled) { setPageFor(p.drilled); setPage(1); }
  const clusters = useMemo(() => clusterRows(p.model), [p.model]);
  const files = useMemo(
    () => (p.drilled >= 0 ? fileRows(p.drilledStars, p.titles, p.dates, p.formatDate, p.linkCount, page) : null),
    [p.drilled, p.drilledStars, p.titles, p.dates, p.formatDate, p.linkCount, page],
  );
  const notes = listFootnote(p.model, p.drilled >= 0 ? p.coverage : null);

  return (
    <div className="flex flex-col" style={{ fontFamily: GALAXY_FONT_STACK }}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={p.titleId} className="text-[18px] font-semibold leading-snug text-text-primary">
          {p.drilled >= 0 ? `${p.model.labels[p.drilled]} · ${p.model.sizes[p.drilled].toLocaleString('en-US')} files` : `All clusters · ${p.model.labels.length}`}
        </h2>
        {p.onClose && (
          <button
            type="button"
            onClick={p.onClose}
            aria-label="Close list"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-text-secondary transition-colors duration-150 hover:bg-white/[0.06] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ×
          </button>
        )}
      </div>

      {files == null ? (
        <table className="mt-3 w-full border-collapse text-left">
          <caption className="sr-only">Clusters, largest first: files, drawn links and strongest shared concepts. Each row enters the cluster.</caption>
          <thead>
            <tr className="text-[12px] uppercase tracking-[0.12em] text-text-secondary">
              <th scope="col" className="pb-1.5 font-semibold">Cluster</th>
              <th scope="col" className="pb-1.5 pl-2 text-right font-semibold">Files</th>
              <th scope="col" className="pb-1.5 pl-2 text-right font-semibold">Links</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {clusters.map(r => {
              const col = p.palette[r.cluster] ?? '#888888';
              return (
                <tr key={r.cluster}>
                  <th scope="row" className="py-0 font-normal">
                    <button
                      type="button"
                      onClick={() => p.onEnter(r.cluster)}
                      className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-md py-2 pr-1 text-left transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
                        <span className={`truncate text-[15px] ${r.unsorted ? 'italic text-text-secondary' : 'text-text-primary'}`}>
                          {r.label}{r.unsorted ? ' (no project tag)' : ''}
                        </span>
                      </span>
                      <span className="pl-4 text-[12px] leading-snug text-text-secondary">
                        {r.concepts.length ? r.concepts.join(' · ') : r.orphan ? 'no link with ≥ 3 specific shared concepts' : '—'}
                      </span>
                    </button>
                  </th>
                  <td className="pl-2 text-right align-middle text-[14px] tabular-nums text-text-primary">{r.files.toLocaleString('en-US')}</td>
                  <td className="pl-2 text-right align-middle text-[14px] tabular-nums text-text-secondary">{r.links}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <>
          <ul className="mt-3 flex flex-col divide-y divide-white/[0.05]" aria-label={`Files, newest first (${files.rows.length} of ${files.total})`}>
            {files.rows.map(r => (
              <li key={r.star}>
                <button
                  type="button"
                  onClick={() => p.onOpenStar(r.star)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md py-2 pr-1 text-left transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-text-primary">{r.title}</span>
                    <span className="block text-[12px] text-text-secondary">
                      {r.date}{r.links != null ? ` · ${r.links} concept link${r.links === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  <span aria-hidden className="text-[14px] text-text-secondary">›</span>
                </button>
              </li>
            ))}
          </ul>
          {files.more && (
            <button
              type="button"
              onClick={() => setPage(v => v + 1)}
              className="mt-2 min-h-11 rounded-xl border border-white/[0.1] text-[15px] text-text-primary transition-colors duration-150 hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Show {Math.min(100, files.total - files.rows.length)} more · {files.rows.length.toLocaleString('en-US')} of {files.total.toLocaleString('en-US')}
            </button>
          )}
        </>
      )}

      <ul className="mt-4 flex flex-col gap-1.5 border-t border-white/[0.06] pt-3">
        {notes.map(n => <li key={n} className="text-[12px] leading-relaxed text-text-secondary">{n}</li>)}
      </ul>
    </div>
  );
}
