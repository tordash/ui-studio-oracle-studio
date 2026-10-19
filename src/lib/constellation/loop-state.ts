// Fleet Constellation — render-loop policy (pure). The engine renders on
// demand and keeps the rAF loop alive only while something real moves:
// intro, live pulses, slot slerps, a camera ease, or the idle drift (C-D8,
// off while something is selected). Under reduced motion only a camera ease
// (user input) or a verify bench keeps it alive, so it is 0 fps at rest.

export interface KeepAliveInput {
  reduced: boolean;
  intro: boolean;
  /** a pulse head or arrival flash is on screen */
  pulses: boolean;
  /** a node is moving between slots */
  slerp: boolean;
  /** the camera is easing (input, select, reset) */
  easing: boolean;
  /** idle drift allowed right now */
  drift: boolean;
  selected: boolean;
  /** verify bench window */
  bench: boolean;
}

/** Per-frame draw calls: stars, shell, ribbons, nodes, rings. No composer (C-D6). */
const CALLS = { stars: 1, shell: 1, ribbons: 1, nodes: 1, rings: 1 };
export const DRAW_CALL_CAP = 6;

export function keepAlive(i: KeepAliveInput): boolean {
  if (i.bench || i.easing || i.slerp) return true;
  if (i.reduced) return false;
  if (i.intro || i.pulses) return true;
  return i.drift && !i.selected;
}

export function drawCallBudget(phone: boolean): number {
  // same scene on both: the phone only gets fewer stars and a coarser shell
  void phone;
  return CALLS.stars + CALLS.shell + CALLS.ribbons + CALLS.nodes + CALLS.rings;
}

/** Real clock delta (ms → s), clamped to [1 ms, 50 ms]. */
export const clampDt = (ms: number) => Math.min(0.05, Math.max(0.001, ms / 1000));
