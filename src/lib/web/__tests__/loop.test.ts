import { describe, it, expect } from 'bun:test';
import { loopShouldRun, targetFps, frameDue, wrapClock } from '../loop-state';
import { debugInfo } from '../debug';
import { BUDGETS } from '../budget';

describe('loopShouldRun', () => {
  const base = { visible: true, onScreen: true, reduced: false, moving: false };
  it('motion on: continuous while visible and on screen', () => {
    expect(loopShouldRun(base)).toBe(true);
    expect(loopShouldRun({ ...base, visible: false })).toBe(false);
    expect(loopShouldRun({ ...base, onScreen: false })).toBe(false);
    expect(loopShouldRun({ ...base, contextLost: true })).toBe(false);
  });
  it('reduced motion: on demand (0 fps idle), runs only while something moves', () => {
    expect(loopShouldRun({ ...base, reduced: true })).toBe(false);
    expect(loopShouldRun({ ...base, reduced: true, moving: true })).toBe(true);
    expect(loopShouldRun({ ...base, reduced: true, benching: true })).toBe(true);
    expect(loopShouldRun({ ...base, reduced: true, moving: true, visible: false })).toBe(false);
  });
});

describe('frame pacing', () => {
  it('phones idle at 30 fps, 60 during gestures; low tier stays 30', () => {
    expect(targetFps(BUDGETS.mid, false)).toBe(30);
    expect(targetFps(BUDGETS.mid, true)).toBe(60);
    expect(targetFps(BUDGETS.high, false)).toBe(60);
    expect(targetFps(BUDGETS.low, true)).toBe(30);
  });
  it('frameDue skips frames under a 30 fps cap', () => {
    expect(frameDue(1016, 1000, 60)).toBe(true);
    expect(frameDue(1016, 1000, 30)).toBe(false);
    expect(frameDue(1032, 1000, 30)).toBe(true);
  });
  it('wrapClock wraps at the 600 s period', () => {
    expect(wrapClock(601)).toBeCloseTo(1, 9);
    expect(wrapClock(-1)).toBeCloseTo(599, 9);
  });
});

describe('__web.info() shape', () => {
  it('is a flat record of numbers (+ tier / mote source strings)', () => {
    const info = debugInfo({
      renderer: { calls: 9, points: 100, triangles: 6900, geometries: 9, textures: 0 },
      stars: 13089, clusters: 77, interLinks: 138, pulses: 600, motesTotal: 77970, motesDrawn: 24000,
      intraSegments: 0, intraPulses: 0, pixelRatio: 1.5, tier: 'mid', reducedMotion: true,
      framesRendered: 12, looping: false, drillCluster: -1, drill: 0, fps: 30,
      governor: { steps: 0, moteScale: 1, pulseScale: 1, dprDelta: 0, lastP75: null }, moteSource: 'estimate',
    });
    expect(Object.keys(info).sort()).toEqual([
      'calls', 'clusters', 'dprDelta', 'drill', 'drillCluster', 'frameP75', 'framesRendered', 'geometries',
      'governorSteps', 'interLinks', 'intraPulses', 'intraSegments', 'looping', 'moteScale', 'moteSource',
      'motesDrawn', 'motesTotal', 'pixelRatio', 'points', 'pulseScale', 'pulses', 'reducedMotion', 'stars',
      'targetFps', 'textures', 'tier', 'triangles',
    ]);
    expect(info.looping).toBe(0);
    expect(info.reducedMotion).toBe(1);
    expect(info.frameP75).toBe(-1);
    for (const [k, v] of Object.entries(info)) {
      if (k === 'tier' || k === 'moteSource') expect(typeof v).toBe('string');
      else expect(typeof v).toBe('number');
    }
  });
});
