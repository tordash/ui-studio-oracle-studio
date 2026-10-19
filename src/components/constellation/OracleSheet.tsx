import { useEffect, useRef, useState } from 'react';
import type { SheetData } from '../../lib/constellation/sheet';
import { relTime, truncateBody } from '../../lib/constellation/sheet';
import { oracleColor, NODE_COLOR } from '../../lib/constellation/colors';
import { GALAXY_FONT_STACK } from '../galaxy/engine';

interface OracleSheetProps {
  data: SheetData;
  /** graph clock (last successful poll) */
  now: number;
  onClose: () => void;
  /** focus this node + one partner */
  onPartner: (partner: string) => void;
  /** only passed on localhost (C-D4) */
  onTerminal?: () => void;
}

const colorOf = (key: string, kind: 'oracle' | 'node') => (kind === 'node' ? NODE_COLOR : oracleColor(key));

/**
 * Oracle detail, all from feed data: a 360 px right panel at ≥ 768 px, a
 * 62 svh bottom sheet on the phone (drag the handle down to close). Esc
 * closes. Message bodies render as React text (never HTML) in the system
 * Thai-capable font stack.
 */
export function OracleSheet({ data, now, onClose, onPartner, onTerminal }: OracleSheetProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number } | null>(null);
  const color = colorOf(data.key, data.kind);
  const maxPartner = Math.max(1, ...data.partners.map(p => p.count));

  useEffect(() => { closeBtn.current?.focus({ preventScroll: true }); }, [data.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (k: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="oracle-sheet-title"
      className="fixed z-[60] inset-x-0 bottom-0 h-[62svh] rounded-t-2xl border-t md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:h-[100dvh] md:w-[360px] md:rounded-none md:border-t-0 md:border-l border-white/[0.08] flex flex-col shadow-[0_-24px_80px_rgba(0,0,0,0.55)]"
      style={{ background: 'linear-gradient(180deg, rgba(14,15,32,0.95) 0%, rgba(6,7,16,0.98) 100%)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', fontFamily: GALAXY_FONT_STACK }}
    >
      <div
        className="md:hidden flex justify-center pt-2.5 pb-1 touch-none"
        onPointerDown={e => { drag.current = { y: e.clientY }; }}
        onPointerUp={e => { if (drag.current && e.clientY - drag.current.y > 60) onClose(); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <span aria-hidden="true" className="w-10 h-1.5 rounded-full bg-white/20" />
      </div>

      <header className="px-5 pt-3 md:pt-6 pb-4 border-b border-white/[0.06] flex items-start gap-3">
        <span className={`mt-1.5 w-3 h-3 rounded-full shrink-0 ${data.kind === 'node' ? 'border-2' : ''}`} style={data.kind === 'node' ? { borderColor: color } : { background: color }} />
        <div className="min-w-0 flex-1">
          <h3 id="oracle-sheet-title" className="text-[18px] font-semibold text-white/95 truncate">{data.label}</h3>
          <p className="text-[12px] text-white/45">{data.kind === 'node' ? 'node · not an oracle' : 'oracle'} · last seen {relTime(now, data.lastTs)}</p>
        </div>
        <button
          ref={closeBtn}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 w-11 h-11 -mr-2 -mt-2 rounded-full text-white/50 hover:text-white hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-[12px] text-white/45">sent</dt><dd className="text-2xl font-semibold tabular-nums text-white/90">{data.sent}</dd></div>
          <div><dt className="text-[12px] text-white/45">received</dt><dd className="text-2xl font-semibold tabular-nums text-white/90">{data.recv}</dd></div>
          <div className="col-span-2 text-[12px] text-white/45">first seen {relTime(now, data.firstTs)} in this window</div>
        </dl>

        {onTerminal && (
          <button
            type="button"
            onClick={onTerminal}
            className="self-start min-h-[36px] px-3 rounded-lg border border-white/10 text-[13px] font-mono text-white/75 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            Open terminal
          </button>
        )}

        {data.partners.length > 0 && (
          <section aria-label="Partners">
            <h4 className="text-[12px] uppercase tracking-[0.12em] text-white/40 mb-2">Partners</h4>
            <ul className="flex flex-col gap-1">
              {data.partners.map(p => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => onPartner(p.key)}
                    className="w-full text-left rounded-md px-2 py-1.5 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate" style={{ color: colorOf(p.key, p.kind) }}>{p.label}</span>
                      <span className="shrink-0 font-mono tabular-nums text-[12px] text-white/50">{p.count} · {p.out} → · {p.in} ←</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden flex" aria-hidden="true">
                      <span style={{ width: `${(p.out / maxPartner) * 100}%`, background: color, opacity: 0.8 }} />
                      <span style={{ width: `${(p.in / maxPartner) * 100}%`, background: colorOf(p.key, p.kind), opacity: 0.55 }} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Recent messages">
          <h4 className="text-[12px] uppercase tracking-[0.12em] text-white/40 mb-2">Recent</h4>
          {data.recent.length === 0 && <p className="text-[13px] text-white/40">No messages in this window.</p>}
          <ul className="flex flex-col divide-y divide-white/[0.05]">
            {data.recent.map(m => {
              const open = expanded.has(m.key);
              const tb = truncateBody(m.body);
              return (
                <li key={m.key} className="py-2.5">
                  <div className="flex items-baseline gap-1.5 text-[12px] font-mono">
                    <span style={{ color: oracleColor(m.from) }}>{m.fromLabel}</span>
                    <span className="text-white/30">→</span>
                    <span style={{ color: oracleColor(m.to) }}>{m.toLabel}</span>
                    <span className="ml-auto text-white/35 tabular-nums">{relTime(now, m.t)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-white/75 break-words">
                    {open ? m.body : tb.text}
                    {tb.cut && (
                      <button
                        type="button"
                        onClick={() => toggle(m.key)}
                        className="ml-1.5 text-[12px] text-white/40 hover:text-white/70"
                        aria-expanded={open}
                      >
                        {open ? 'less' : `+${tb.rest} more`}
                      </button>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </aside>
  );
}
