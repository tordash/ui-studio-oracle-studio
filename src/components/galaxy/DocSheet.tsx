import { useEffect, useRef, useState } from 'react';
import type { GalaxyData } from '../../lib/galaxy/mapping';
import { chunkCount, formatDay, galaxyTypeColor } from '../../lib/galaxy/mapping';
import { DocDetailView } from '../../pages/DocDetail';
import { GALAXY_FONT_STACK } from './engine';

interface DocSheetProps {
  data: GalaxyData;
  idx: number;
  reducedMotion: boolean;
  onClose: () => void;
}

/**
 * Side sheet for a star. The header renders instantly from the map record
 * (title, type, date, path, project, concepts) — the doc body loads after via
 * the existing DocDetail view in embedded mode.
 */
export function DocSheet({ data, idx, reducedMotion, onClose }: DocSheetProps) {
  const [closing, setClosing] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const doc = data.docs[idx];
  const color = galaxyTypeColor(doc.type);
  const ds = data.dateSources[idx];
  const chunks = chunkCount(doc);

  const requestClose = () => {
    if (reducedMotion) onClose();
    else setClosing(true);
  };

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true });
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reducedMotion) onClose();
      else setClosing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, reducedMotion]);

  const dateLabel =
    ds === 'path' ? `${formatDay(data.dates[idx])}` :
    ds === 'indexed' ? `indexed ${formatDay(data.dates[idx])}` : 'undated';

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="galaxy-sheet-title"
      className={`galaxy-sheet fixed top-0 right-0 z-[60] h-[100dvh] w-full sm:w-[460px] flex flex-col border-l border-white/[0.08] shadow-[-24px_0_80px_rgba(0,0,0,0.55)] ${closing ? 'galaxy-sheet-out' : 'galaxy-sheet-in'}`}
      style={{ background: 'linear-gradient(180deg, rgba(14,15,32,0.94) 0%, rgba(8,8,18,0.97) 100%)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
      onAnimationEnd={() => { if (closing) onClose(); }}
    >
      <header className="relative px-6 pt-6 pb-5 border-b border-white/[0.06]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-60"
          style={{ background: `radial-gradient(420px 120px at 20% 0%, ${color}33, transparent 70%)` }}
        />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
            {doc.type}
            <span className="text-text-muted font-medium normal-case tracking-normal">· {dateLabel}</span>
          </div>
          <button
            ref={closeBtn}
            type="button"
            onClick={requestClose}
            aria-label="Close document"
            className="-mt-1 -mr-2 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-text-secondary text-xl leading-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            ×
          </button>
        </div>
        <h2
          id="galaxy-sheet-title"
          className="relative mt-3 text-[22px] leading-[1.25] font-semibold text-text-primary tracking-[-0.01em] break-words"
          style={{ fontFamily: GALAXY_FONT_STACK }}
        >
          {data.titles[idx]}
        </h2>
        <div className="relative mt-2 text-[12px] font-mono text-text-muted break-all leading-relaxed">{doc.source_file}</div>
        {(doc.project || chunks != null) && (
          <div className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-secondary">
            {doc.project && <span>{doc.project.replace(/^github\.com\//, '')}</span>}
            {chunks != null && <span>{chunks} chunk{chunks === 1 ? '' : 's'}</span>}
          </div>
        )}
        {doc.concepts?.length > 0 && (
          <div className="relative mt-3 flex flex-wrap gap-1.5">
            {doc.concepts.slice(0, 10).map(c => (
              <span key={c} className="px-2 py-0.5 rounded-full text-[11px] text-text-secondary bg-white/[0.05] border border-white/[0.06]">
                {c}
              </span>
            ))}
          </div>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
        <DocDetailView
          key={doc.id}
          id={encodeURIComponent(doc.id)}
          embedded
          fallbackSource={{ path: doc.source_file, project: doc.project }}
        />
      </div>
    </aside>
  );
}
