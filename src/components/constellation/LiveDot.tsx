import { useEffect, useState, useSyncExternalStore } from 'react';
import { getReducedMotion, subscribeReducedMotion } from '../../lib/three';
import { liveAnnouncement, liveLabel, liveState } from '../../lib/constellation/poll-state';
import type { LiveState } from '../../lib/constellation/poll-state';

const DOT: Record<LiveState, string> = {
  live: '#34d399',
  stale: '#fbbf24',
  offline: '#f87171',
  paused: '#6b7280',
};

interface LiveDotProps {
  lastOkAt: number | null;
  lastErr: boolean;
  hidden: boolean;
  nextAt: number | null;
  /** the one screen-reader announcer on the page (state changes only) */
  announce?: boolean;
  className?: string;
}

/**
 * Real poll health, not decoration: green < 15 s since the last successful
 * poll, amber to 60 s, red after that or on error, grey while the tab is
 * hidden. Owns its own 1 s ticker so the page does not re-render every second.
 */
export function LiveDot({ lastOkAt, lastErr, hidden, nextAt, announce = false, className }: LiveDotProps) {
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const state = liveState(now, lastOkAt, lastErr, hidden);
  const label = liveLabel(state, now, lastOkAt, nextAt == null ? 0 : nextAt - now);
  const color = DOT[state];

  return (
    <span className={`inline-flex items-center gap-2 text-[12px] font-mono text-white/60 ${className ?? ''}`}>
      {/* the seconds counter ticks every 1 s: keep it out of the live region */}
      {announce && <span className="sr-only" role="status" aria-live="polite">{liveAnnouncement(state)}</span>}
      <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
        {state === 'live' && !reducedMotion && (
          <span className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping" style={{ background: color }} />
        )}
        <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      </span>
      <span className="tabular-nums whitespace-nowrap" aria-hidden="true">{label}</span>
    </span>
  );
}
