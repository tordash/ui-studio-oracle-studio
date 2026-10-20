import type { PeekAction, PeekRow, PeekView } from '../../lib/web/peek-model';
import { GALAXY_FONT_STACK } from '../galaxy/engine';

interface PeekCardProps {
  view: PeekView;
  palette: readonly string[];
  /** id of the heading, for the surrounding dialog / sheet's aria-labelledby */
  titleId: string;
  onAction: (id: PeekAction['id']) => void;
  onRow: (row: PeekRow) => void;
  onClose?: () => void;
}

/**
 * Body of the peek card (the tap equivalent of hover): what is armed, why it links,
 * and the next step. Rendered inside a desktop panel or a phone bottom sheet by the
 * page; every action is a ≥ 44 px button, nothing depends on hover.
 */
export function PeekCard({ view, palette, titleId, onAction, onRow, onClose }: PeekCardProps) {
  const tint = view.tint >= 0 ? palette[view.tint] ?? '#888888' : '#64b5f6';
  return (
    // shrink-0, never min-h-0: inside the desktop panel (flex column, max-height, overflow-y
    // auto) a shrinkable card squeezed its rows section and the notes drew over the last
    // link row (T21); at full height the PANEL scrolls instead
    <div className="flex shrink-0 flex-col" style={{ fontFamily: GALAXY_FONT_STACK }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: tint }}>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint, boxShadow: `0 0 10px ${tint}` }} />
            <span className="truncate">{view.eyebrow}</span>
          </div>
          <h2 id={titleId} className="mt-1.5 break-words text-[18px] font-semibold leading-snug tracking-[-0.01em] text-text-primary">
            {view.title}
          </h2>
          {view.subtitle && <p className="mt-1 text-[14px] leading-snug text-text-secondary">{view.subtitle}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-text-secondary transition-colors duration-150 hover:bg-white/[0.06] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ×
          </button>
        )}
      </div>

      {view.facts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {view.facts.map(f => (
            <span key={f} className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[12px] text-text-secondary">{f}</span>
          ))}
        </div>
      )}

      {view.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {view.actions.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAction(a.id)}
              className={`min-h-11 rounded-xl px-4 text-[15px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${i === 0
                ? 'text-[#06121f] hover:brightness-110'
                : 'border border-white/[0.1] text-text-primary hover:border-white/20'}`}
              style={i === 0 ? { background: tint } : undefined}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {view.rows.length > 0 && (
        <section className="mt-4 shrink-0" aria-label={view.rowsTitle || 'Details'}>
          {view.rowsTitle && (
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{view.rowsTitle}</h3>
          )}
          <ul className="flex flex-col divide-y divide-white/[0.05]">
            {view.rows.map(r => {
              const actionable = r.edge != null || r.cluster != null;
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`min-w-0 truncate text-[15px] ${r.muted ? 'text-text-secondary' : 'text-text-primary'}`}>{r.label}</span>
                    {r.value && <span className="shrink-0 tabular-nums text-[13px] text-text-secondary">{r.value}</span>}
                  </span>
                  {r.chips.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.chips.map(c => (
                        <span key={c.text} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[12px] text-text-secondary" title={c.detail}>
                          {c.text}{c.detail ? <span className="text-text-secondary/80"> {c.detail}</span> : null}
                        </span>
                      ))}
                    </span>
                  )}
                </>
              );
              return (
                <li key={r.key}>
                  {actionable ? (
                    <button
                      type="button"
                      onClick={() => onRow(r)}
                      className="flex min-h-11 w-full flex-col justify-center rounded-md px-1 py-2 text-left transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-11 flex-col justify-center px-1 py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {view.notes.map(n => (
            <li key={n} className="text-[13px] leading-snug text-text-secondary">{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
