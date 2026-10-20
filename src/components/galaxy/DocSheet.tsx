import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { GalaxyData } from '../../lib/galaxy/mapping';
import { chunkCount, formatDay, galaxyTypeColor } from '../../lib/galaxy/mapping';
import { DocDetailView } from '../../pages/DocDetail';
import { GALAXY_FONT_STACK } from './engine';
import { Sheet } from '../ui/Sheet';
import type { SnapPoint } from '../../lib/ui/sheet-snap';

const WIDE_QUERY = '(min-width: 640px)';
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getWide = () => window.matchMedia(WIDE_QUERY).matches;

interface DocSheetBodyProps {
  data: GalaxyData;
  idx: number;
  titleId: string;
  /** Related list (Knowledge Web), shown between the header and the document */
  related?: ReactNode;
  /** close button (side panel only — the bottom sheet has its own handle + Esc) */
  onClose?: () => void;
  closeRef?: React.Ref<HTMLButtonElement>;
  /** horizontal padding: the side panel pads itself, the bottom sheet pads its scroller */
  padded: boolean;
  /** render only the header (the side panel keeps it fixed above its scroller) */
  headerOnly?: boolean;
}

/**
 * Header (renders instantly from the map record: title, type, date, path, project,
 * concepts) + the doc body via DocDetailView in embedded mode + an optional Related slot.
 */
export function DocSheetBody({ data, idx, titleId, related, onClose, closeRef, padded, headerOnly }: DocSheetBodyProps) {
  const doc = data.docs[idx];
  const color = galaxyTypeColor(doc.type);
  const ds = data.dateSources[idx];
  const chunks = chunkCount(doc);
  const dateLabel =
    ds === 'path' ? `${formatDay(data.dates[idx])}` :
    ds === 'indexed' ? `indexed ${formatDay(data.dates[idx])}` : 'undated';

  return (
    <>
      <header className={`relative pb-5 border-b border-white/[0.06] ${padded ? 'px-6 pt-6' : 'pt-1'}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-60"
          style={{ background: `radial-gradient(420px 120px at 20% 0%, ${color}33, transparent 70%)` }}
        />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>
            <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
            {doc.type}
            <span className="text-text-secondary font-medium normal-case tracking-normal">· {dateLabel}</span>
          </div>
          {onClose && (
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close document"
              className="-mt-2 -mr-3 w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-text-secondary text-xl leading-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              ×
            </button>
          )}
        </div>
        <h2
          id={titleId}
          className="relative mt-3 text-[22px] leading-[1.25] font-semibold text-text-primary tracking-[-0.01em] break-words"
          style={{ fontFamily: GALAXY_FONT_STACK }}
        >
          {data.titles[idx]}
        </h2>
        <div className="relative mt-2 text-[12px] font-mono text-text-secondary break-all leading-relaxed">{doc.source_file}</div>
        {(doc.project || chunks != null) && (
          <div className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-secondary">
            {doc.project && <span>{doc.project.replace(/^github\.com\//, '')}</span>}
            {chunks != null && <span>{chunks} chunk{chunks === 1 ? '' : 's'}</span>}
          </div>
        )}
        {doc.concepts?.length > 0 && (
          <div className="relative mt-3 flex flex-wrap gap-1.5">
            {doc.concepts.slice(0, 10).map(c => (
              <span key={c} className="px-2 py-0.5 rounded-full text-[12px] text-text-secondary bg-white/[0.05] border border-white/[0.06]">
                {c}
              </span>
            ))}
          </div>
        )}
      </header>
      {!headerOnly && <DocSheetContent data={data} idx={idx} related={related} padded={padded} />}
    </>
  );
}

/** Related slot + the document body (DocDetailView, embedded). */
export function DocSheetContent({ data, idx, related, padded }: Pick<DocSheetBodyProps, 'data' | 'idx' | 'related' | 'padded'>) {
  const doc = data.docs[idx];
  return (
    <>
      {related && <div className={padded ? 'px-6 pt-4' : 'pt-4'}>{related}</div>}
      <div className={padded ? 'px-6 py-5' : 'py-5'}>
        <DocDetailView
          key={doc.id}
          id={encodeURIComponent(doc.id)}
          embedded
          fallbackSource={{ path: doc.source_file, project: doc.project }}
        />
      </div>
    </>
  );
}

interface DocSheetProps {
  data: GalaxyData;
  idx: number;
  reducedMotion: boolean;
  onClose: () => void;
  related?: ReactNode;
  /** 'responsive' (default): side panel ≥ 640 px, bottom sheet below (ต่อ Q6). 'side': always the panel. */
  variant?: 'responsive' | 'side';
}

/** Responsive shell: right side panel on wide screens, bottom sheet on phones. */
export function DocSheet({ data, idx, reducedMotion, onClose, related, variant = 'responsive' }: DocSheetProps) {
  const wide = useSyncExternalStore(subscribeWide, getWide, () => true);
  if (variant === 'side' || wide) {
    return <SidePanel data={data} idx={idx} reducedMotion={reducedMotion} onClose={onClose} related={related} />;
  }
  return <BottomDocSheet data={data} idx={idx} reducedMotion={reducedMotion} onClose={onClose} related={related} />;
}

function SidePanel({ data, idx, reducedMotion, onClose, related }: Omit<DocSheetProps, 'variant'>) {
  const [closing, setClosing] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);

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
      e.preventDefault(); // capture phase: page shortcuts see a handled Esc
      if (reducedMotion) onClose();
      else setClosing(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, reducedMotion]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="galaxy-sheet-title"
      className={`galaxy-sheet fixed top-0 right-0 z-[60] h-[100dvh] w-full sm:w-[460px] flex flex-col border-l border-white/[0.08] shadow-[-24px_0_80px_rgba(0,0,0,0.55)] ${closing ? 'galaxy-sheet-out' : 'galaxy-sheet-in'}`}
      style={{
        background: 'linear-gradient(180deg, rgba(14,15,32,0.94) 0%, rgba(8,8,18,0.97) 100%)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
      onAnimationEnd={() => { if (closing) onClose(); }}
    >
      <DocSheetBody data={data} idx={idx} titleId="galaxy-sheet-title" onClose={requestClose} closeRef={closeBtn} padded headerOnly />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <DocSheetContent data={data} idx={idx} related={related} padded />
      </div>
    </aside>
  );
}

function BottomDocSheet({ data, idx, reducedMotion, onClose, related }: Omit<DocSheetProps, 'variant'>) {
  const [snap, setSnap] = useState<SnapPoint>('full');
  // a new document opens full again
  const [shownIdx, setShownIdx] = useState(idx);
  if (shownIdx !== idx) { setShownIdx(idx); setSnap('full'); }
  return (
    <Sheet
      snap={snap}
      onSnapChange={setSnap}
      onClose={onClose}
      snaps={['half', 'full']}
      labelledBy="galaxy-sheet-title"
      reducedMotion={reducedMotion}
    >
      <DocSheetBody data={data} idx={idx} titleId="galaxy-sheet-title" related={related} padded={false} />
    </Sheet>
  );
}
