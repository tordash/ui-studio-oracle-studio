import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GalaxyData } from '../../lib/galaxy/mapping';
import type { GalaxyCluster } from '../../lib/galaxy/clusters';
import { GalaxyEngine } from './engine';
import type { GalaxyEngineCallbacks } from './engine';

interface GalaxyViewProps extends GalaxyEngineCallbacks {
  data: GalaxyData;
  clusters: GalaxyCluster[];
  states: Float32Array;
  selected: number;
  reducedMotion: boolean;
  /** Filled with the live engine so the page can call flyTo / frame / goHome / zoomBy. */
  engineRef: RefObject<GalaxyEngine | null>;
  className?: string;
}

/** Thin React shell: owns the engine's lifecycle (create on data, dispose on unmount). */
export function GalaxyView({
  data, clusters, states, selected, reducedMotion, engineRef, className,
  onHover, onHoverAnchor, onOpen, onContextLost,
}: GalaxyViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef<GalaxyEngineCallbacks>({ onHover, onHoverAnchor, onOpen, onContextLost });
  const reducedRef = useRef(reducedMotion);

  useEffect(() => {
    cbRef.current = { onHover, onHoverAnchor, onOpen, onContextLost };
  }, [onHover, onHoverAnchor, onOpen, onContextLost]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: GalaxyEngine;
    try {
      engine = new GalaxyEngine(host, data, clusters, {
        onHover: (i, t) => cbRef.current.onHover(i, t),
        onHoverAnchor: (x, y, v) => cbRef.current.onHoverAnchor(x, y, v),
        onOpen: i => cbRef.current.onOpen(i),
        onContextLost: () => cbRef.current.onContextLost(),
      }, reducedRef.current);
    } catch (e) {
      console.error('Galaxy: WebGL init failed', e);
      cbRef.current.onContextLost();
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [data, clusters, engineRef]);

  useEffect(() => { engineRef.current?.setStates(states); }, [states, data, clusters, engineRef]);
  useEffect(() => { engineRef.current?.setSelected(selected); }, [selected, data, clusters, engineRef]);
  useEffect(() => {
    reducedRef.current = reducedMotion;
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, engineRef]);

  return <div ref={hostRef} className={className} style={{ cursor: 'grab' }} />;
}
