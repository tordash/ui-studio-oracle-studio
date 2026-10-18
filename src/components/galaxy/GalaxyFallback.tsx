import { useMemo } from 'react';
import type { GalaxyData } from '../../lib/galaxy/mapping';
import { formatDay, galaxyTypeColor } from '../../lib/galaxy/mapping';
import type { GalaxyCluster } from '../../lib/galaxy/clusters';

const LIST_LIMIT = 150;

interface GalaxyFallbackProps {
  data: GalaxyData;
  clusters: GalaxyCluster[];
  reason: 'no-webgl' | 'context-lost';
  matches: Set<number> | null;
  onOpen: (idx: number) => void;
}

/** No-WebGL / lost-context fallback: same data as a numbers card + a 2D list. The page never goes blank. */
export function GalaxyFallback({ data, clusters, reason, matches, onOpen }: GalaxyFallbackProps) {
  const list = useMemo(() => {
    const idx = matches && matches.size > 0 ? [...matches] : Array.from({ length: data.count }, (_, i) => i);
    idx.sort((a, b) => (data.dates[b] ?? -Infinity) - (data.dates[a] ?? -Infinity));
    return idx.slice(0, LIST_LIMIT);
  }, [data, matches]);

  const types = Object.entries(data.typeCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="absolute inset-0 overflow-y-auto px-4 sm:px-8 pt-20 pb-10">
      <div className="max-w-[760px] mx-auto flex flex-col gap-6">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {reason === 'no-webgl' ? '3D unavailable on this device — showing the same data in 2D' : 'Graphics context lost — showing the same data in 2D'}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
            <Stat value={data.count} label="stars (documents)" />
            {types.map(([t, n]) => <Stat key={t} value={n} label={t} color={galaxyTypeColor(t)} />)}
            <Stat value={data.dateSourceCounts.path} label="dated by path" />
            <Stat value={data.dateSourceCounts.undated} label="undated" />
          </div>
          {clusters.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {clusters.map(c => (
                <span key={c.id} className="px-2.5 py-1 rounded-full text-[12px] text-text-secondary bg-white/[0.04] border border-white/[0.06]">
                  {c.kind === 'folder' ? '▢ ' : '● '}{c.label} <span className="text-text-muted tabular-nums">{c.size.toLocaleString()}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted mb-2">
            {matches && matches.size > 0 ? `${matches.size.toLocaleString()} matches` : 'Most recent'} · showing {list.length}
          </div>
          <ul className="flex flex-col divide-y divide-white/[0.05]">
            {list.map(i => (
              <li key={data.docs[i].id}>
                <button
                  type="button"
                  onClick={() => onOpen(i)}
                  className="w-full text-left py-2.5 flex items-center gap-3 rounded-md transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: galaxyTypeColor(data.docs[i].type), opacity: 0.35 + 0.65 * data.brightness[i] }} />
                  <span className="flex-1 min-w-0 truncate text-[14px] text-text-primary">{data.titles[i]}</span>
                  <span className="shrink-0 text-[12px] text-text-muted tabular-nums">{formatDay(data.dates[i])}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tabular-nums text-text-primary" style={color ? { color } : undefined}>{value.toLocaleString()}</span>
      <span className="text-[12px] text-text-muted">{label}</span>
    </div>
  );
}
