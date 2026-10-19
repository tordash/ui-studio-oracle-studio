import type { GraphNode } from '../../lib/constellation/aggregate';
import { oracleColor, NODE_COLOR } from '../../lib/constellation/colors';

interface FilterBarProps {
  nodes: readonly GraphNode[];
  focus: readonly string[];
  onFocus: (next: string[]) => void;
  hideHostNodes: boolean;
  onHideHostNodes: (hide: boolean) => void;
}

/**
 * Focus chips (multi-select: only edges touching the focused set stay lit,
 * the rest dim but keep their slots), "hide <host>" for the mac-tor node, and
 * clear. One horizontal row that scrolls, with a hidden scrollbar.
 */
export function FilterBar({ nodes, focus, onFocus, hideHostNodes, onHideHostNodes }: FilterBarProps) {
  const hosts = nodes.filter(n => n.kind === 'node');
  const oracles = nodes.filter(n => n.kind === 'oracle');
  const toggle = (key: string) => onFocus(focus.includes(key) ? focus.filter(k => k !== key) : [...focus, key]);
  const active = focus.length > 0 || hideHostNodes;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-3 sm:px-6 sm:pb-4">
      <div
        role="toolbar"
        aria-label="Filter oracles"
        className="pointer-events-auto flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {oracles.map(n => {
          const on = focus.includes(n.key);
          const c = oracleColor(n.key);
          return (
            <button
              key={n.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(n.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-full border text-[12px] font-mono transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 ${
                on ? 'border-white/30 bg-white/[0.12] text-white' : 'border-white/[0.08] bg-[#04050b]/70 text-white/60 hover:text-white/85'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: c }} />
              {n.label}
            </button>
          );
        })}
        {hosts.length > 0 && (
          <button
            type="button"
            aria-pressed={hideHostNodes}
            onClick={() => onHideHostNodes(!hideHostNodes)}
            className={`shrink-0 inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-full border text-[12px] font-mono transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 ${
              hideHostNodes ? 'border-white/30 bg-white/[0.12] text-white' : 'border-white/[0.08] bg-[#04050b]/70 text-white/60 hover:text-white/85'
            }`}
          >
            <span className="w-2 h-2 rounded-full border" style={{ borderColor: NODE_COLOR }} />
            {hideHostNodes ? 'show' : 'hide'} {hosts.map(h => h.label).join(', ')}
          </button>
        )}
        {active && (
          <button
            type="button"
            onClick={() => { onFocus([]); onHideHostNodes(false); }}
            className="shrink-0 min-h-[32px] px-3 rounded-full text-[12px] font-mono text-white/45 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}
