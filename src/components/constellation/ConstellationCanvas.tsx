import { useEffect, useRef } from 'react';
import type { Graph } from '../../lib/constellation/aggregate';
import { ConstellationEngine } from './engine';
import type { ViewInput } from './engine';

export interface ConstellationCanvasProps {
  graph: Graph;
  view: ViewInput;
  reducedMotion: boolean;
  onContextLost: () => void;
  className?: string;
}

/** Thin React shell: owns the engine's lifecycle; props flow into it imperatively. */
export function ConstellationCanvas({ graph, view, reducedMotion, onContextLost, className }: ConstellationCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ConstellationEngine | null>(null);
  const lostRef = useRef(onContextLost);
  const reducedRef = useRef(reducedMotion);

  useEffect(() => { lostRef.current = onContextLost; }, [onContextLost]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ConstellationEngine;
    try {
      engine = new ConstellationEngine(host, { onContextLost: () => lostRef.current() }, reducedRef.current);
    } catch (e) {
      console.error('Constellation: WebGL init failed', e);
      lostRef.current();
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useEffect(() => { engineRef.current?.setGraph(graph); }, [graph]);
  useEffect(() => { engineRef.current?.setView(view); }, [view]);
  useEffect(() => {
    reducedRef.current = reducedMotion;
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return <div ref={hostRef} className={className} />;
}

export default ConstellationCanvas;
