// One palette per doc type, shared by the badges and the 3D glow (decision S2).
export const TYPE_COLORS: Record<string, string> = {
  learning: '#60a5fa',
  principle: '#c084fc',
  retro: '#4ade80',
  pattern: '#f59e0b',
  trace: '#38bdf8',
  thread: '#a78bfa',
  resonance: '#fb7185',
  handoff: '#22d3ee',
};

/** Unknown / missing type. */
export const TYPE_COLOR_FALLBACK = '#888';

export function getTypeColor(type: string | null | undefined): string {
  return (type && TYPE_COLORS[type]) || TYPE_COLOR_FALLBACK;
}
