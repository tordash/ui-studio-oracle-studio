import { useEffect, useRef } from 'react';
import type { Graph } from '../../lib/constellation/aggregate';
import type { ParsedMsg } from '../../lib/constellation/parse';
import { ConstellationEngine } from './engine';
import type { ConstellationCallbacks, HoverInfo, PulseMode, ViewInput } from './engine';

export interface PulseBatch {
  seq: number;
  added: ParsedMsg[];
  mode: PulseMode;
}

export interface ConstellationCanvasProps {
  graph: Graph;
  view: ViewInput;
  /** new messages from the latest poll → pulses */
  batch: PulseBatch | null;
  reducedMotion: boolean;
  onContextLost: () => void;
  onSelect: (key: string | null) => void;
  onHover: (h: HoverInfo | null) => void;
  className?: string;
}

/** Thin React shell: owns the engine's lifecycle; props flow into it imperatively. */
export function ConstellationCanvas({ graph, view, batch, reducedMotion, onContextLost, onSelect, onHover, className }: ConstellationCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ConstellationEngine | null>(null);
  const cbRef = useRef<ConstellationCallbacks>({ onContextLost, onSelect, onHover });
  const reducedRef = useRef(reducedMotion);
  const lastSeq = useRef(-1);

  useEffect(() => { cbRef.current = { onContextLost, onSelect, onHover }; }, [onContextLost, onSelect, onHover]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ConstellationEngine;
    try {
      engine = new ConstellationEngine(host, {
        onContextLost: () => cbRef.current.onContextLost(),
        onSelect: k => cbRef.current.onSelect(k),
        onHover: h => cbRef.current.onHover(h),
      }, reducedRef.current);
    } catch (e) {
      console.error('Constellation: WebGL init failed', e);
      cbRef.current.onContextLost();
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
      lastSeq.current = -1;
    };
  }, []);

  // order matters: the graph (edges) must exist before its pulses fire
  useEffect(() => { engineRef.current?.setGraph(graph); }, [graph]);
  useEffect(() => { engineRef.current?.setView(view); }, [view]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !batch || batch.seq === lastSeq.current) return;
    lastSeq.current = batch.seq;
    e.pulse(batch.added, batch.mode);
  }, [batch]);
  useEffect(() => {
    reducedRef.current = reducedMotion;
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return <div ref={hostRef} className={`relative ${className ?? ''}`} />;
}

export default ConstellationCanvas;
