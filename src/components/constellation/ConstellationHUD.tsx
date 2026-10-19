import type { WindowId } from '../../lib/constellation/aggregate';
import { LiveDot } from './LiveDot';

const WINDOW_CHIPS: { id: WindowId; label: string }[] = [
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: 'all', label: 'All' },
];

interface ConstellationHUDProps {
  lastOkAt: number | null;
  lastErr: boolean;
  hidden: boolean;
  nextAt: number | null;
  w: WindowId;
  onWindow: (w: WindowId) => void;
  /** windowLabel(): "N msgs since HH:MM[ · partial …]" */
  label: string;
  /** feed events whose recipient could not be parsed (shown only when > 0) */
  malformed: number;
  /** events may have been dropped between two polls */
  gap: boolean;
}

/** Overlay: title + live dot (top-left), window chips (top-right), honesty label. */
export function ConstellationHUD({ lastOkAt, lastErr, hidden, nextAt, w, onWindow, label, malformed, gap }: ConstellationHUDProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[15px] sm:text-[17px] font-semibold tracking-[0.02em] text-white/90">Fleet Constellation</h2>
          <LiveDot lastOkAt={lastOkAt} lastErr={lastErr} hidden={hidden} nextAt={nextAt} announce className="pointer-events-auto" />
        </div>
        <p className="text-[12px] font-mono text-white/45 tabular-nums">
          {label}
          {gap && <span className="text-amber-300/80"> · gap: some events may be missing</span>}
          {malformed > 0 && <span className="text-white/35"> · {malformed} unparsed</span>}
        </p>
      </div>
      <div role="group" aria-label="Time window" className="pointer-events-auto flex shrink-0 rounded-full border border-white/10 bg-[#04050b]/70 p-0.5 backdrop-blur-sm">
        {WINDOW_CHIPS.map(c => (
          <button
            key={c.id}
            type="button"
            aria-pressed={w === c.id}
            onClick={() => onWindow(c.id)}
            className={`min-w-[44px] min-h-[32px] px-3 rounded-full text-[12px] font-mono transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 ${
              w === c.id ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
