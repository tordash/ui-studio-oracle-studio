// Knowledge Web — the `window.__web.info()` snapshot for the gated browser batch (pure).

export interface DebugInputs {
  renderer: { calls: number; points: number; triangles: number; geometries: number; textures: number };
  stars: number;
  clusters: number;
  interLinks: number;
  pulses: number;
  motesTotal: number;
  motesDrawn: number;
  intraSegments: number;
  intraPulses: number;
  pixelRatio: number;
  tier: string;
  reducedMotion: boolean;
  framesRendered: number;
  looping: boolean;
  drillCluster: number;
  drill: number;
  fps: number;
  governor: { steps: number; moteScale: number; pulseScale: number; dprDelta: number; lastP75: number | null };
  moteSource: string;
}

export type DebugInfo = Record<string, number | string>;

export function debugInfo(d: DebugInputs): DebugInfo {
  return {
    calls: d.renderer.calls,
    points: d.renderer.points,
    triangles: d.renderer.triangles,
    geometries: d.renderer.geometries,
    textures: d.renderer.textures,
    stars: d.stars,
    clusters: d.clusters,
    interLinks: d.interLinks,
    pulses: d.pulses,
    motesTotal: d.motesTotal,
    motesDrawn: d.motesDrawn,
    moteSource: d.moteSource,
    intraSegments: d.intraSegments,
    intraPulses: d.intraPulses,
    pixelRatio: d.pixelRatio,
    tier: d.tier,
    reducedMotion: d.reducedMotion ? 1 : 0,
    framesRendered: d.framesRendered,
    looping: d.looping ? 1 : 0,
    drillCluster: d.drillCluster,
    drill: +d.drill.toFixed(3),
    targetFps: d.fps,
    governorSteps: d.governor.steps,
    moteScale: d.governor.moteScale,
    pulseScale: d.governor.pulseScale,
    dprDelta: d.governor.dprDelta,
    frameP75: d.governor.lastP75 == null ? -1 : +d.governor.lastP75.toFixed(1),
  };
}
