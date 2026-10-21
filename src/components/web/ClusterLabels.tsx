import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { declutterLabels } from '../../lib/galaxy/labels';
import { labelEligible, sizeRanks, LABEL_INSET_X, LABEL_INSET_Y } from '../../lib/web/labels';
import type { LabelAnchor } from './engine';
import { GALAXY_FONT_STACK } from '../galaxy/engine';

export type LabelLayoutFn = (anchors: LabelAnchor[]) => void;

interface ClusterLabelsProps {
  labels: readonly string[];
  sizes: ArrayLike<number>;
  palette: readonly string[];
  unsorted: number;
  /** cluster shown with priority + highlighted (-1 none) */
  armed: number;
  /** hide every label (inside a drill the header names the cluster) */
  hidden: boolean;
  /** ≤ 12 on phones, ≤ 24 on desktop */
  maxVisible: number;
  /** labels always offered for the N biggest clusters; the rest appear as they grow on screen (zoom) */
  topN: number;
  /** filled with the imperative layout function the engine's onPose calls */
  layoutRef: RefObject<LabelLayoutFn | null>;
  onTap: (cluster: number) => void;
}

/**
 * Cluster labels as real DOM buttons over the canvas: crisp Thai text, ≥ 44 px
 * targets, keyboard focus. Positioned imperatively on camera moves (no React
 * render per frame). Only the top-N by size, the armed one and clusters drawn big
 * enough on screen are candidates (lib/web/labels — zooming in reveals the rest);
 * galaxy's declutterLabels then keeps the bigger (or armed) one on any pill overlap.
 */
export function ClusterLabels({ labels, sizes, palette, unsorted, armed, hidden, maxVisible, topN, layoutRef, onTap }: ClusterLabelsProps) {
  const host = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const dims = useRef<{ w: number; h: number }[]>([]);
  const last = useRef<LabelAnchor[] | null>(null);
  const state = useRef({ armed, hidden, maxVisible, topN });
  const ranks = useMemo(() => sizeRanks(sizes), [sizes]);

  useLayoutEffect(() => {
    state.current = { armed, hidden, maxVisible, topN };
  }, [armed, hidden, maxVisible, topN]);

  // measure with display restored (visibility stays hidden), then take hidden pills out of
  // layout: display:none, not visibility:hidden, so 400 off-screen labels are not text at rest
  useLayoutEffect(() => {
    dims.current = btns.current.map(b => {
      if (!b) return { w: 0, h: 0 };
      b.style.display = '';
      const d = { w: b.offsetWidth, h: b.offsetHeight };
      if (b.style.visibility !== 'visible') b.style.display = 'none';
      return d;
    });
  }, [labels]);

  useEffect(() => {
    const layout: LabelLayoutFn = anchors => {
      last.current = anchors;
      const el = host.current;
      if (!el) return;
      const W = el.clientWidth, H = el.clientHeight;
      const { armed: a, hidden: hide, maxVisible: cap, topN: top } = state.current;
      const items = anchors.map(an => {
        const d = dims.current[an.cluster] ?? { w: 0, h: 0 };
        const ok = an.ok && labelEligible(an, ranks, a, top);
        return {
          x: ok ? an.x : NaN,
          y: ok ? an.y : NaN,
          w: d.w, h: d.h,
          priority: an.cluster === a ? Number.MAX_SAFE_INTEGER : sizes[an.cluster] ?? 0,
        };
      });
      const placed = hide ? null : declutterLabels(items, W, H, { margin: 8, insetX: LABEL_INSET_X, insetY: LABEL_INSET_Y });
      const order = anchors.map((_, i) => i).sort((x, y) => items[y].priority - items[x].priority);
      let shown = 0;
      for (const i of order) {
        const b = btns.current[anchors[i].cluster];
        if (!b) continue;
        const p = placed?.[i];
        const show = !!p && p.visible && shown < cap;
        if (show) {
          shown++;
          const it = items[i];
          b.style.transform = `translate3d(${Math.round(it.x - it.w / 2 + p.dx)}px, ${Math.round(it.y - it.h + p.dy)}px, 0)`;
          b.style.display = '';
          b.style.visibility = 'visible';
          b.tabIndex = 0;
          b.removeAttribute('aria-hidden');
        } else {
          b.style.visibility = 'hidden';
          b.style.display = 'none';
          b.tabIndex = -1;
          b.setAttribute('aria-hidden', 'true');
        }
      }
    };
    layoutRef.current = layout;
    if (last.current) layout(last.current);
    return () => { if (layoutRef.current === layout) layoutRef.current = null; };
  }, [layoutRef, sizes, ranks]);

  // re-run the last layout when armed / hidden / caps change (no camera move needed)
  useEffect(() => {
    if (last.current) layoutRef.current?.(last.current);
  }, [armed, hidden, maxVisible, topN, layoutRef]);

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-label="Cluster labels">
      {labels.map((label, c) => {
        const col = palette[c] ?? '#888888';
        const on = c === armed;
        return (
          <button
            key={c}
            ref={el => { btns.current[c] = el; }}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            aria-label={`${label}, ${Number(sizes[c] ?? 0).toLocaleString('en-US')} files${c === unsorted ? ' without a project tag' : ''}`}
            aria-pressed={on}
            onClick={() => onTap(c)}
            className="web-label pointer-events-auto absolute left-0 top-0 flex min-h-11 items-center px-1 outline-none focus-visible:[&>span]:outline focus-visible:[&>span]:outline-2 focus-visible:[&>span]:outline-accent"
            style={{ visibility: 'hidden', fontFamily: GALAXY_FONT_STACK }}
          >
            <span
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] leading-none transition-colors duration-150 ${on ? 'text-text-primary' : 'text-text-primary/90'}`}
              style={{
                background: on ? `${col}2e` : 'rgba(9, 10, 22, 0.58)',
                borderColor: on ? `${col}99` : 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                fontStyle: c === unsorted ? 'italic' : undefined,
              }}
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
              <span className="max-w-[16ch] truncate">{label}</span>
              <span className="tabular-nums text-text-secondary">{Number(sizes[c] ?? 0).toLocaleString('en-US')}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
