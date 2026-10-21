import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { snapHeights, snapTo, cycleSnap, SNAP_ORDER } from '../../lib/ui/sheet-snap';
import type { SnapPoint } from '../../lib/ui/sheet-snap';

interface SheetProps {
  snap: SnapPoint;
  onSnapChange: (s: SnapPoint) => void;
  /** present → the sheet can be dragged / flicked / Esc'd closed */
  onClose?: () => void;
  snaps?: readonly SnapPoint[];
  /** id of the visible heading inside */
  labelledBy: string;
  reducedMotion: boolean;
  children: ReactNode;
  /** content rendered in the drag zone next to the handle (title row) */
  header?: ReactNode;
  className?: string;
  /**
   * 'region': below full the sheet is a non-modal labelled region (a persistent card),
   * a dialog only when full. Default 'dialog' at every snap (a sheet the user opened).
   */
  nonModalRole?: 'dialog' | 'region';
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); };
  }, []);
  return h;
}

/**
 * Generic bottom sheet (phones): snap points peek 168 px · half · 92 %, a drag
 * handle + header as the only drag zone (content scrolls with overscroll-contain),
 * home-indicator safe area, Esc to close, aria-modal and focus moved in while full.
 */
export function Sheet({ snap, onSnapChange, onClose, snaps = SNAP_ORDER, labelledBy, reducedMotion, children, header, className, nonModalRole = 'dialog' }: SheetProps) {
  const vh = useViewportHeight();
  const heights = snapHeights(vh, 0);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; y0: number; h0: number; samples: { t: number; y: number }[] } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const returnFocus = useRef<Element | null>(null);
  const full = snap === 'full';

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  // full = modal: move focus inside
  useEffect(() => {
    if (!full) return;
    const el = ref.current;
    if (!el || el.contains(document.activeElement)) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus({ preventScroll: true });
  }, [full]);

  const close = useCallback(() => {
    if (onClose) onClose();
    else onSnapChange(snaps[0]);
  }, [onClose, onSnapChange, snaps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = ref.current;
      if (!el || (!full && !el.contains(document.activeElement))) return;
      // capture phase + preventDefault: page-level shortcuts (bubble phase) skip a handled Esc
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, close]);

  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (!full || e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    if (target.closest('button:not([data-sheet-handle]), a, input')) return; // header buttons stay buttons
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const h0 = ref.current?.getBoundingClientRect().height ?? heights[snap];
    drag.current = { id: e.pointerId, y0: e.clientY, h0, samples: [{ t: e.timeStamp, y: e.clientY }] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    if (d.samples.length > 6) d.samples.shift();
    const h = Math.max(48, Math.min(heights.full, d.h0 + (d.y0 - e.clientY)));
    if (Math.abs(d.y0 - e.clientY) > 4) setDragH(h);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (dragH == null) { setDragH(null); return; }
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = b.t > a.t ? (a.y - b.y) / (b.t - a.t) : 0; // px/ms, + = growing
    const next = snapTo(dragH, v, heights, snaps, !!onClose);
    setDragH(null);
    if (next === 'close') close();
    else onSnapChange(next);
  };

  const height = dragH ?? heights[snap];
  return (
    <section
      ref={ref}
      role={full ? 'dialog' : nonModalRole}
      aria-modal={full || nonModalRole === 'dialog' ? full : undefined}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={onKeyDownTrap}
      className={`ui-sheet fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-[20px] border-t border-white/[0.09] shadow-[0_-24px_80px_rgba(0,0,0,0.55)] outline-none ${reducedMotion ? '' : 'ui-sheet-in'} ${className ?? ''}`}
      style={{
        height: `calc(${Math.round(height)}px + env(safe-area-inset-bottom, 0px))`,
        maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: 'linear-gradient(180deg, rgba(14,15,32,0.96) 0%, rgba(8,8,18,0.98) 100%)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        transition: dragH != null || reducedMotion ? 'none' : 'height 0.26s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div
        className="shrink-0 touch-none select-none px-5 pt-1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          data-sheet-handle
          onClick={() => onSnapChange(cycleSnap(snap, snaps))}
          aria-label={snap === 'full' ? 'Collapse sheet' : 'Expand sheet'}
          className="mx-auto flex h-11 w-24 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/25" />
        </button>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
    </section>
  );
}
