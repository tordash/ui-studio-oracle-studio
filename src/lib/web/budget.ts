// Knowledge Web — per-tier GPU budgets (design §3.6) and the frame-time governor (pure).

import type { GpuTier } from '../three/gpu-tier';

export interface TierBudget {
  /** device-pixel-ratio cap */
  dprMax: number;
  /** star point-size clamp in CSS px (× DPR in the shader) */
  starClampPx: number;
  /** chunk motes drawn (seeded uniform sample; Infinity = all) */
  motes: number;
  /** flowing pulses on inter-cluster links */
  interPulses: number;
  /** intra-cluster link segments drawn in a drill */
  intraSegments: number;
  /** flowing pulses on intra links */
  intraPulses: number;
  /** loop fps while nothing is being touched (motion on) */
  idleFps: number;
  /** loop fps during gestures / camera moves */
  activeFps: number;
}

export const BUDGETS: Readonly<Record<GpuTier, Readonly<TierBudget>>> = {
  high: { dprMax: 2, starClampPx: 46, motes: Infinity, interPulses: 600, intraSegments: 4000, intraPulses: 400, idleFps: 60, activeFps: 60 },
  mid: { dprMax: 1.5, starClampPx: 28, motes: 24000, interPulses: 250, intraSegments: 1500, intraPulses: 150, idleFps: 30, activeFps: 60 },
  low: { dprMax: 1, starClampPx: 28, motes: 8000, interPulses: 120, intraSegments: 800, intraPulses: 60, idleFps: 30, activeFps: 30 },
};

/** Pulses on one inter link: 1 + round(3ŵ) on desktop, 1 + round(ŵ) on phones (ŵ = w / max w). */
export function pulsesPerEdge(tier: GpuTier, wNorm: number): number {
  const w = Math.max(0, Math.min(1, wNorm));
  return 1 + Math.round((tier === 'high' ? 3 : 1) * w);
}

/** Pulse speed along a link (cycles per second): stronger links flow faster. */
export function pulseSpeed(wNorm: number): number {
  return 0.15 + 0.25 * Math.max(0, Math.min(1, wNorm));
}

export interface GovernorState {
  steps: number;
  moteScale: number;
  pulseScale: number;
  dprDelta: number;
  /** p75 frame interval of the last full window (ms), or null before the first */
  lastP75: number | null;
}

export interface GovernorOptions {
  windowFrames: number;
  thresholdMs: number;
  maxSteps: number;
  /** intervals longer than this are pauses (tab switch, idle), not slow frames */
  gapMs: number;
}

export const GOVERNOR_DEFAULTS: Readonly<GovernorOptions> = { windowFrames: 90, thresholdMs: 24, maxSteps: 3, gapMs: 250 };

/**
 * Steps quality DOWN when the p75 frame interval over a 90-frame window exceeds
 * 24 ms: motes ×0.5 → pulses ×0.5 → DPR −0.25. At most 3 steps; never back up
 * within a session.
 */
export class Governor {
  private buf: number[] = [];
  private o: GovernorOptions;
  readonly state: GovernorState = { steps: 0, moteScale: 1, pulseScale: 1, dprDelta: 0, lastP75: null };

  constructor(opts: Partial<GovernorOptions> = {}) {
    this.o = { ...GOVERNOR_DEFAULTS, ...opts };
  }

  /** Feed one frame interval (ms). Returns true when quality just stepped down. */
  sample(intervalMs: number): boolean {
    if (!(intervalMs > 0) || intervalMs > this.o.gapMs) return false;
    if (this.state.steps >= this.o.maxSteps) return false;
    this.buf.push(intervalMs);
    if (this.buf.length < this.o.windowFrames) return false;
    const sorted = this.buf.slice().sort((a, b) => a - b);
    const p75 = sorted[Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1)];
    this.state.lastP75 = p75;
    this.buf.length = 0;
    if (p75 <= this.o.thresholdMs) return false;
    const s = ++this.state.steps;
    if (s === 1) this.state.moteScale = 0.5;
    else if (s === 2) this.state.pulseScale = 0.5;
    else this.state.dprDelta = -0.25;
    return true;
  }
}

/** Effective DPR for a tier after governor steps (never below 1, never above the device). */
export function effectiveDpr(deviceDpr: number, budget: Pick<TierBudget, 'dprMax'>, g: Pick<GovernorState, 'dprDelta'>): number {
  const base = Math.min(Math.max(1, deviceDpr || 1), budget.dprMax);
  return Math.max(1, base + g.dprDelta);
}
