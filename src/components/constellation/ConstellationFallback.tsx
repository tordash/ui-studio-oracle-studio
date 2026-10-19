import type { Graph } from '../../lib/constellation/aggregate';
import { busiestPair, pairRows } from '../../lib/constellation/summary';
import { oracleColor, NODE_COLOR } from '../../lib/constellation/colors';

interface ConstellationFallbackProps {
  graph: Graph;
  reason: 'no-webgl' | 'context-lost';
  /** windowLabel() */
  label: string;
}

/** No-WebGL / lost-context fallback: the same graph as a numbers card + pair table. The page never goes blank. */
export function ConstellationFallback({ graph, reason, label }: ConstellationFallbackProps) {
  const rows = pairRows(graph);
  const top = busiestPair(graph);
  const kinds = new Map(graph.nodes.map(n => [n.key, n.kind]));
  const color = (k: string) => (kinds.get(k) === 'node' ? NODE_COLOR : oracleColor(k));
  const oracles = graph.nodes.filter(n => n.kind === 'oracle').length;

  return (
    <div className="absolute inset-0 overflow-y-auto px-4 sm:px-6 pt-24 pb-6">
      <div className="max-w-[760px] mx-auto flex flex-col gap-5">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="text-[12px] uppercase tracking-[0.14em] text-white/45">
            {reason === 'no-webgl' ? '3D unavailable on this device — the same data in 2D' : 'Graphics context lost — the same data in 2D'}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
            <Stat value={String(oracles)} label="oracles" />
            <Stat value={String(graph.msgs.length)} label={label.replace(/^\d+ msgs? /, '')} />
            <Stat value={top ? `${top.labelA} ⇄ ${top.labelB}` : '—'} label={top ? `busiest pair · ${top.count}` : 'busiest pair'} />
          </div>
        </div>
        {rows.length > 0 && (
          <table className="w-full text-left text-[13px] font-mono">
            <caption className="sr-only">Message counts per oracle pair</caption>
            <thead>
              <tr className="text-[12px] uppercase tracking-[0.12em] text-white/40">
                <th scope="col" className="py-2 font-medium">Pair</th>
                <th scope="col" className="py-2 font-medium text-right">Msgs</th>
                <th scope="col" className="py-2 font-medium text-right">→ / ←</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {rows.map(r => (
                <tr key={r.key}>
                  <td className="py-2.5 pr-3">
                    <span style={{ color: color(r.a) }}>{r.labelA}</span>
                    <span className="text-white/30"> ⇄ </span>
                    <span style={{ color: color(r.b) }}>{r.labelB}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-white/85">{r.count}</td>
                  <td className="py-2.5 text-right tabular-nums text-white/50">{r.countAB} / {r.countBA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xl font-semibold tabular-nums text-white/90 truncate">{value}</span>
      <span className="text-[12px] text-white/45">{label}</span>
    </div>
  );
}
