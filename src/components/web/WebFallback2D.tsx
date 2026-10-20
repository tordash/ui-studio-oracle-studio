import { useEffect, useRef } from 'react';
import type { InterEdge } from '../../lib/web/inter';
import { project2D, ctrl2D, quad2D } from '../../lib/web/project2d';
import { pickCore } from '../../lib/web/pick';
import { declutterLabels } from '../../lib/galaxy/labels';
import { bindRenderGate } from '../../lib/three';
import { pulseSpeed } from '../../lib/web/budget';
import { xxhash } from '../../lib/web/hash';
import { GALAXY_FONT_STACK } from '../galaxy/engine';

interface WebFallback2DProps {
  centres: ArrayLike<number>;
  radii: ArrayLike<number>;
  palette: readonly string[];
  labels: readonly string[];
  sizes: ArrayLike<number>;
  edges: readonly InterEdge[];
  unsorted: number;
  reducedMotion: boolean;
  maxLabels: number;
  onEnter: (cluster: number) => void;
  /** e.g. "77 nodes (one per cluster), 138 links …" */
  summary: string;
}

/** Canvas2D present? (probe once; a missing 2D context means the list is all we can show) */
export function canvas2dAvailable(): boolean {
  try { return !!document.createElement('canvas').getContext('2d'); } catch { return false; }
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * No-WebGL / lost-context view (port of pages/Graph.tsx:338-375 draw()): the same
 * layout projected to 2D, links stroked by weight (Unsorted dashed), pulses as
 * moving dots — static under reduced motion. Tapping a cluster enters it (the
 * list beside it shows the files).
 */
export function WebFallback2D(p: WebFallback2DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(p);
  useEffect(() => { propsRef.current = p; });

  useEffect(() => {
    const host = wrap.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0, visible = !document.hidden, onScreen = true, t0 = performance.now();
    let proj = project2D(propsRef.current.centres, propsRef.current.radii, 1, 1);
    let W = 1, H = 1;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      proj = project2D(propsRef.current.centres, propsRef.current.radii, W, H, 28);
    };

    const draw = (now: number) => {
      const q = propsRef.current;
      const time = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const C = q.radii.length;
      let gx = 0, gy = 0;
      for (let c = 0; c < C; c++) { gx += proj.x[c]; gy += proj.y[c]; }
      gx /= Math.max(1, C); gy /= Math.max(1, C);
      const maxW = q.edges.reduce((m, e) => Math.max(m, e.w), 0) || 1;
      // links
      for (const e of q.edges) {
        const wn = e.w / maxW;
        const ax = proj.x[e.a], ay = proj.y[e.a], bx = proj.x[e.b], by = proj.y[e.b];
        const [qx, qy] = ctrl2D(ax, ay, bx, by, gx, gy);
        const dashed = e.a === q.unsorted || e.b === q.unsorted;
        ctx.setLineDash(dashed ? [5, 6] : []);
        ctx.lineWidth = 1 + 3 * wn;
        ctx.strokeStyle = rgba(q.palette[e.a] ?? '#888888', (0.16 + 0.46 * wn) * (dashed ? 0.5 : 1));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(qx, qy, bx, by);
        ctx.stroke();
        if (!q.reducedMotion) {
          const t = (time * pulseSpeed(wn) + xxhash(0x7075, e.a * 131 + e.b)) % 1;
          const [px, py] = quad2D(ax, ay, qx, qy, bx, by, t);
          ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
          ctx.beginPath();
          ctx.arc(px, py, 1.6 + wn, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      // clusters
      for (let c = 0; c < C; c++) {
        const col = q.palette[c] ?? '#888888';
        const g = ctx.createRadialGradient(proj.x[c], proj.y[c], 0, proj.x[c], proj.y[c], proj.r[c]);
        g.addColorStop(0, rgba(col, c === q.unsorted ? 0.28 : 0.42));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(proj.x[c], proj.y[c], proj.r[c], 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(proj.x[c], proj.y[c], 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // labels (decluttered, biggest first)
      ctx.font = `600 13px ${GALAXY_FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const items = Array.from({ length: C }, (_, c) => ({
        x: proj.x[c], y: proj.y[c] - Math.min(proj.r[c], 40) - 4,
        w: ctx.measureText(q.labels[c]).width + 12, h: 18, priority: q.sizes[c],
      }));
      const placed = declutterLabels(items, W, H, { margin: 6 });
      const order = items.map((_, i) => i).sort((a, b) => items[b].priority - items[a].priority);
      let shown = 0;
      for (const i of order) {
        if (!placed[i].visible || shown >= q.maxLabels) continue;
        shown++;
        ctx.fillStyle = 'rgba(240, 243, 255, 0.92)';
        ctx.fillText(q.labels[i], items[i].x + placed[i].dx, items[i].y + placed[i].dy);
      }
    };

    const loop = (now: number) => {
      raf = 0;
      draw(now);
      if (!propsRef.current.reducedMotion && visible && onScreen) raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf && visible && onScreen) raf = requestAnimationFrame(loop); };

    resize();
    kick();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); kick(); }) : null;
    ro?.observe(host);
    const unbind = bindRenderGate(host, {
      onVisibility: v => { visible = v; if (v) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
      onScreen: s => { onScreen = s; if (s) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    });
    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const q = propsRef.current;
      const c = pickCore(proj.x, proj.y, new Float32Array(q.radii.length), proj.r, x, y);
      if (c >= 0) q.onEnter(c);
    };
    canvas.addEventListener('click', onClick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      unbind();
      canvas.removeEventListener('click', onClick);
    };
    // geometry is read through propsRef; restart only when motion preference flips
  }, [p.reducedMotion]);

  return (
    <div ref={wrap} className="relative h-[min(58vh,520px)] w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <canvas ref={canvasRef} role="img" aria-label={p.summary} aria-describedby="web-list-summary" className="block cursor-pointer" />
    </div>
  );
}
