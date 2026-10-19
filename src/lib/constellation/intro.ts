// Fleet Constellation — camera intro + idle drift (pure). First data only,
// skippable by any input:
//   0–2.2 s   dolly from (dist 34, yaw −0.6, pitch 0.45) to home, ease-out-cubic
//   0.3–1.4 s nodes ignite in rank order, 60 ms apart, slight overshoot
//   1.2–2.4 s ribbons draw on
//   2.4–6.4 s the last ≤ 10 real messages replay as pulses
// Reduced motion shows the final frame at t = 0. Idle drift (C-D8): after
// 8 s without input, 0.02 rad/s, never while selected or under RM.

export interface Pose { yaw: number; pitch: number; dist: number }

export const INTRO_FROM: Pose = { dist: 34, yaw: -0.6, pitch: 0.45 };
export const DOLLY_S = 2.2;
export const IGNITE_START_S = 0.3;
export const IGNITE_END_S = 1.4;
export const IGNITE_DUR_S = 0.45;
export const IGNITE_STAGGER_S = 0.06;
export const RIBBON_START_S = 1.2;
export const RIBBON_END_S = 2.4;
export const REPLAY_START_S = 2.4;
export const INTRO_END_S = 6.4;
export const DRIFT_IDLE_MS = 8000;
export const DRIFT_RAD_S = 0.02;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export interface IntroFrame {
  pose: Pose;
  /** 0..1 eased */
  dolly: number;
  /** ribbon draw-on 0..1 */
  ribbons: number;
  /** inside the replay window */
  replay: boolean;
  done: boolean;
}

export function introState(t: number, { reduced, home }: { reduced: boolean; home: Pose }): IntroFrame {
  if (reduced) return { pose: { ...home }, dolly: 1, ribbons: 1, replay: false, done: true };
  const dolly = easeOutCubic(clamp01(t / DOLLY_S));
  const lerp = (a: number, b: number) => a + (b - a) * dolly;
  return {
    pose: { dist: lerp(INTRO_FROM.dist, home.dist), yaw: lerp(INTRO_FROM.yaw, home.yaw), pitch: lerp(INTRO_FROM.pitch, home.pitch) },
    dolly,
    ribbons: clamp01((t - RIBBON_START_S) / (RIBBON_END_S - RIBBON_START_S)),
    replay: t >= REPLAY_START_S && t < INTRO_END_S,
    done: t >= INTRO_END_S,
  };
}

/** Per-rank stagger: 60 ms, shrunk so the last of `n` nodes still lands by 1.4 s. */
export function igniteStagger(n: number): number {
  const room = IGNITE_END_S - IGNITE_START_S - IGNITE_DUR_S;
  return n > 1 ? Math.min(IGNITE_STAGGER_S, room / (n - 1)) : IGNITE_STAGGER_S;
}

/** Node scale 0 → 1 (with overshoot) for `rank` of `n`. */
export function igniteProgress(t: number, rank: number, n: number, reduced: boolean): number {
  if (reduced) return 1;
  const x = clamp01((t - IGNITE_START_S - igniteStagger(n) * rank) / IGNITE_DUR_S);
  return x <= 0 ? 0 : easeOutBack(x);
}

export function driftOn(idleMs: number, selected: boolean, reduced: boolean): boolean {
  return idleMs >= DRIFT_IDLE_MS && !selected && !reduced;
}
