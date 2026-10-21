import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GpuTier } from '../../lib/three/gpu-tier';
import { WebEngine } from './engine';
import type { WebEngineCallbacks, WebEngineData } from './engine';

interface WebViewProps extends WebEngineCallbacks {
  data: WebEngineData;
  tier: GpuTier;
  reducedMotion: boolean;
  /** filled with the live engine so the page can drive drill / zoom / selection */
  engineRef: RefObject<WebEngine | null>;
  /** called once per engine instance, after it is created */
  onReady: (engine: WebEngine) => void;
  className?: string;
}

/** Thin React shell (GalaxyView pattern): owns the engine's lifecycle — create on data, dispose on unmount. */
export function WebView({
  data, tier, reducedMotion, engineRef, onReady, className,
  onArm, onOpenStar, onEnterCluster, onHome, onPose, onContextLost,
}: WebViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef<WebEngineCallbacks>({ onArm, onOpenStar, onEnterCluster, onHome, onPose, onContextLost });
  const readyRef = useRef(onReady);
  const reducedRef = useRef(reducedMotion);

  useEffect(() => {
    cbRef.current = { onArm, onOpenStar, onEnterCluster, onHome, onPose, onContextLost };
    readyRef.current = onReady;
  }, [onArm, onOpenStar, onEnterCluster, onHome, onPose, onContextLost, onReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: WebEngine;
    try {
      engine = new WebEngine(host, data, {
        onArm: (t, touch) => cbRef.current.onArm(t, touch),
        onOpenStar: i => cbRef.current.onOpenStar(i),
        onEnterCluster: c => cbRef.current.onEnterCluster(c),
        onHome: () => cbRef.current.onHome(),
        onPose: a => cbRef.current.onPose(a),
        onContextLost: () => cbRef.current.onContextLost(),
      }, { reducedMotion: reducedRef.current, tier });
    } catch (e) {
      console.error('Knowledge Web: WebGL init failed', e);
      cbRef.current.onContextLost();
      return;
    }
    engineRef.current = engine;
    readyRef.current(engine);
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [data, tier, engineRef]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, engineRef]);

  return <div ref={hostRef} className={className} style={{ cursor: 'grab' }} />;
}
