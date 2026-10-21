// Knowledge Web — render-loop decisions (pure).
//   motion on      → continuous while visible + on screen (pulses flow, motes orbit, stars drift)
//   reduced motion → on demand: only while something moves (camera ease, drill snap), 0 fps idle
//   hidden tab / offscreen / lost context → stopped
// Frame pacing: phones cap the idle loop at 30 fps and run 60 during gestures.

import type { TierBudget } from './budget';
import { TIME_PERIOD } from './motes';

export interface LoopInputs {
  visible: boolean;
  onScreen: boolean;
  reduced: boolean;
  /** camera easing, drill morph or intro still running */
  moving: boolean;
  /** __web.bench() forces frames */
  benching?: boolean;
  contextLost?: boolean;
}

export function loopShouldRun(i: LoopInputs): boolean {
  if (!i.visible || !i.onScreen || i.contextLost) return false;
  if (i.benching) return true;
  return i.reduced ? i.moving : true;
}

/** Target fps: activeFps while the user is touching / the camera moves, idleFps otherwise. */
export function targetFps(b: Pick<TierBudget, 'idleFps' | 'activeFps'>, active: boolean): number {
  return active ? b.activeFps : b.idleFps;
}

/** True when enough time passed since the last rendered frame for `fps` (2 ms slack for vsync jitter). */
export function frameDue(now: number, lastRender: number, fps: number): boolean {
  if (fps >= 60) return true;
  return now - lastRender >= 1000 / fps - 2;
}

/** Shader clock: seconds, wrapped every TIME_PERIOD (rates are quantised, so the wrap is seamless). */
export function wrapClock(seconds: number): number {
  const t = seconds % TIME_PERIOD;
  return t < 0 ? t + TIME_PERIOD : t;
}
