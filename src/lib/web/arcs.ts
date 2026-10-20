// Knowledge Web — link geometry for the GPU (pure).
//   ribbonStrip  : base strip (aT, aSide) instanced once per inter-cluster link
//   buildArcs    : per-link instance data — Bézier from centre to centre, the control
//                  point pushed away from the layout centroid by 0.25 · length so arcs
//                  don't cut through the core; width 1–4 px and alpha by weight;
//                  links touching Unsorted are dashed and at 50 % alpha (ต่อ Q2)
//   buildPulses  : flowing particles per link (1 + round(3ŵ) desktop, 1 + round(ŵ) phone),
//                  strongest links first under the tier cap; speed 0.15 + 0.25ŵ

import type { GpuTier } from '../three/gpu-tier';
import { pulsesPerEdge, pulseSpeed } from './budget';
import { quantizeCycles } from './motes';
import { xxhash } from './hash';
import type { IntraResult } from './intra';

export const RIBBON_SEGMENTS = 24;
export const ARC_BOW = 0.25;

export interface RibbonStrip { t: Float32Array; side: Float32Array; index: Uint16Array }

/** (segments + 1) × 2 vertices, segments × 2 triangles. */
export function ribbonStrip(segments = RIBBON_SEGMENTS): RibbonStrip {
  const n = segments + 1;
  const t = new Float32Array(n * 2), side = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    t[i * 2] = t[i * 2 + 1] = i / segments;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  const index = new Uint16Array(segments * 6);
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }
  return { t, side, index };
}

export type V3 = [number, number, number];

/** Control point: midpoint pushed away from the centroid by ARC_BOW · |p2 − p0|. */
export function arcCtrl(p0: ArrayLike<number>, p2: ArrayLike<number>, centroid: ArrayLike<number>): V3 {
  const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2, mz = (p0[2] + p2[2]) / 2;
  const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  let dx = mx - centroid[0], dy = my - centroid[1], dz = mz - centroid[2];
  let dl = Math.hypot(dx, dy, dz);
  if (dl < 1e-6) {
    // midpoint on the centroid: bow perpendicular to the link, toward +y where possible
    const ex = (p2[0] - p0[0]) / (len || 1), ey = (p2[1] - p0[1]) / (len || 1), ez = (p2[2] - p0[2]) / (len || 1);
    const ux = Math.abs(ey) < 0.99 ? 0 : 1, uy = Math.abs(ey) < 0.99 ? 1 : 0;
    // n = e × (u × e) = u − (u·e) e
    const d = ux * ex + uy * ey;
    dx = ux - d * ex; dy = uy - d * ey; dz = -d * ez;
    dl = Math.hypot(dx, dy, dz) || 1;
  }
  const k = (ARC_BOW * len) / dl;
  return [mx + dx * k, my + dy * k, mz + dz * k];
}

export function bezierPoint(p0: ArrayLike<number>, c: ArrayLike<number>, p2: ArrayLike<number>, t: number): V3 {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1],
    u * u * p0[2] + 2 * u * t * c[2] + t * t * p2[2],
  ];
}

export interface ArcEdge { a: number; b: number; w: number }

export interface ArcSet {
  count: number;
  p0: Float32Array;
  p2: Float32Array;
  ctrl: Float32Array;
  /** width px, alpha, dash count (0 solid), edge index */
  style: Float32Array;
  ends: Float32Array;
  colA: Float32Array;
  colB: Float32Array;
  /** the weight that maps to ŵ = 1 */
  maxW: number;
}

/** colours: rgb 0..1 per cluster (C × 3). */
export function buildArcs(
  edges: readonly ArcEdge[],
  centres: ArrayLike<number>,
  colours: ArrayLike<number>,
  unsorted: number,
  centroid: ArrayLike<number>,
): ArcSet {
  const n = edges.length;
  const maxW = edges.reduce((m, e) => Math.max(m, e.w), 0) || 1;
  const out: ArcSet = {
    count: n, maxW,
    p0: new Float32Array(n * 3), p2: new Float32Array(n * 3), ctrl: new Float32Array(n * 3),
    style: new Float32Array(n * 4), ends: new Float32Array(n * 2),
    colA: new Float32Array(n * 3), colB: new Float32Array(n * 3),
  };
  edges.forEach((e, i) => {
    const pa = [centres[e.a * 3], centres[e.a * 3 + 1], centres[e.a * 3 + 2]];
    const pb = [centres[e.b * 3], centres[e.b * 3 + 1], centres[e.b * 3 + 2]];
    const c = arcCtrl(pa, pb, centroid);
    out.p0.set(pa, i * 3); out.p2.set(pb, i * 3); out.ctrl.set(c, i * 3);
    const wn = e.w / maxW;
    const dashed = e.a === unsorted || e.b === unsorted;
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    out.style[i * 4] = 1 + 3 * wn;
    out.style[i * 4 + 1] = (0.16 + 0.46 * wn) * (dashed ? 0.5 : 1);
    out.style[i * 4 + 2] = dashed ? Math.max(6, Math.round(len / 1.4)) : 0;
    out.style[i * 4 + 3] = i;
    out.ends[i * 2] = e.a; out.ends[i * 2 + 1] = e.b;
    for (let k = 0; k < 3; k++) { out.colA[i * 3 + k] = colours[e.a * 3 + k]; out.colB[i * 3 + k] = colours[e.b * 3 + k]; }
  });
  return out;
}

export interface PulseSet {
  count: number;
  p0: Float32Array;
  p2: Float32Array;
  ctrl: Float32Array;
  /** speed (cycles/s), offset 0..1, edge index, size px */
  pulse: Float32Array;
  ends: Float32Array;
  color: Float32Array;
}

/** Pulses for every arc, strongest links first, at most `cap` in total. */
export function buildPulses(arcs: ArcSet, edges: readonly ArcEdge[], tier: GpuTier, cap: number): PulseSet {
  const order = edges.map((_, i) => i).sort((x, y) => edges[y].w - edges[x].w || x - y);
  const plan: { edge: number; k: number; of: number }[] = [];
  for (const i of order) {
    const per = pulsesPerEdge(tier, edges[i].w / arcs.maxW);
    for (let k = 0; k < per; k++) {
      if (plan.length >= cap) break;
      plan.push({ edge: i, k, of: per });
    }
    if (plan.length >= cap) break;
  }
  const n = plan.length;
  const out: PulseSet = {
    count: n,
    p0: new Float32Array(n * 3), p2: new Float32Array(n * 3), ctrl: new Float32Array(n * 3),
    pulse: new Float32Array(n * 4), ends: new Float32Array(n * 2), color: new Float32Array(n * 3),
  };
  plan.forEach(({ edge, k, of }, q) => {
    for (let d = 0; d < 3; d++) {
      out.p0[q * 3 + d] = arcs.p0[edge * 3 + d];
      out.p2[q * 3 + d] = arcs.p2[edge * 3 + d];
      out.ctrl[q * 3 + d] = arcs.ctrl[edge * 3 + d];
      // a touch of white so pulses read on top of their own ribbon
      out.color[q * 3 + d] = 0.55 * (arcs.colA[edge * 3 + d] + arcs.colB[edge * 3 + d]) / 2 + 0.45;
    }
    const wn = edges[edge].w / arcs.maxW;
    out.pulse[q * 4] = quantizeCycles(pulseSpeed(wn));
    out.pulse[q * 4 + 1] = (k / of + xxhash(0x7075, edge) * 0.5) % 1;
    out.pulse[q * 4 + 2] = edge;
    out.pulse[q * 4 + 3] = 2.6 + 1.6 * wn;
    out.ends[q * 2] = arcs.ends[edge * 2];
    out.ends[q * 2 + 1] = arcs.ends[edge * 2 + 1];
  });
  return out;
}

/** Sample an arc into `segments + 1` world points (for screen-space picking). */
export function arcPolyline(arcs: Pick<ArcSet, 'p0' | 'p2' | 'ctrl'>, edge: number, segments = RIBBON_SEGMENTS): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  const p0 = arcs.p0.subarray(edge * 3, edge * 3 + 3);
  const p2 = arcs.p2.subarray(edge * 3, edge * 3 + 3);
  const c = arcs.ctrl.subarray(edge * 3, edge * 3 + 3);
  for (let s = 0; s <= segments; s++) out.set(bezierPoint(p0, c, p2, s / segments), s * 3);
  return out;
}

// ── intra-cluster segments (drill) ─────────────────────────────────────


export interface IntraSegments {
  count: number;
  /** star indices (global) */
  i: Int32Array;
  j: Int32Array;
  /** cosine (vector-layer extras carry 0.5: /api/similar scores are not usable) */
  s: Float32Array;
  /** 0 = concept link (solid), > 0 = dots per segment (vector neighbour) */
  dots: Float32Array;
  /** 1 = touches the armed star */
  focus: Uint8Array;
}

export interface IntraSegmentOptions {
  /** tier cap for the base layer (4k desktop / 1.5k mid / 800 low) */
  cap: number;
  /** strongest links drawn per file in the base layer */
  perFile?: number;
  /** armed star: ALL its links (K = 6) are added and flagged */
  focusStar?: number;
  /** in-cluster /api/similar neighbours of the focus star (dotted vector layer) */
  vector?: readonly number[];
}

export const VECTOR_DOTS = 14;

/**
 * Base layer: each file's strongest `perFile` (2) links, de-duplicated, strongest
 * first, capped. Then the armed star's full neighbour list and its vector
 * neighbours on top (flagged), so tapping a star always reveals all of its links.
 */
export function buildIntraSegments(r: IntraResult, o: IntraSegmentOptions): IntraSegments {
  const perFile = o.perFile ?? 2;
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const base = new Map<string, { i: number; j: number; s: number }>();
  for (let li = 0; li < r.members.length; li++) {
    const f = r.members[li];
    const end = Math.min(r.nbrOff[li + 1], r.nbrOff[li] + perFile);
    for (let q = r.nbrOff[li]; q < end; q++) {
      const g = r.nbr[q];
      const k = key(f, g);
      if (!base.has(k)) base.set(k, { i: Math.min(f, g), j: Math.max(f, g), s: r.score[q] });
    }
  }
  const sorted = [...base.values()].sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j).slice(0, Math.max(0, o.cap));
  const rows = sorted.map(x => ({ ...x, dots: 0, focus: 0 }));
  const index = new Map(rows.map((x, n) => [key(x.i, x.j), n] as const));

  const f = o.focusStar ?? -1;
  if (f >= 0) {
    // the focus star's own list (members is ascending → binary search)
    let lo = 0, hi = r.members.length - 1, li = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (r.members[mid] === f) { li = mid; break; }
      if (r.members[mid] < f) lo = mid + 1; else hi = mid - 1;
    }
    if (li >= 0) {
      for (let q = r.nbrOff[li]; q < r.nbrOff[li + 1]; q++) {
        const g = r.nbr[q];
        const k = key(f, g);
        const at = index.get(k);
        if (at != null) rows[at].focus = 1;
        else { index.set(k, rows.length); rows.push({ i: Math.min(f, g), j: Math.max(f, g), s: r.score[q], dots: 0, focus: 1 }); }
      }
    }
    for (const g of o.vector ?? []) {
      if (g === f || g < 0) continue;
      const k = key(f, g);
      const at = index.get(k);
      if (at != null) { rows[at].focus = 1; continue; } // concept link wins: solid
      index.set(k, rows.length);
      rows.push({ i: Math.min(f, g), j: Math.max(f, g), s: 0.5, dots: VECTOR_DOTS, focus: 1 });
    }
  }
  const n = rows.length;
  const out: IntraSegments = {
    count: n, i: new Int32Array(n), j: new Int32Array(n), s: new Float32Array(n), dots: new Float32Array(n), focus: new Uint8Array(n),
  };
  rows.forEach((x, q) => { out.i[q] = x.i; out.j[q] = x.j; out.s[q] = x.s; out.dots[q] = x.dots; out.focus[q] = x.focus; });
  return out;
}

export interface IntraPulses { count: number; i: Int32Array; j: Int32Array; speed: Float32Array; offset: Float32Array }

/** One pulse on each of the strongest concept links (vector extras get none), at most `cap`. */
export function buildIntraPulses(seg: IntraSegments, cap: number): IntraPulses {
  const pick: number[] = [];
  for (let q = 0; q < seg.count && pick.length < cap; q++) if (seg.dots[q] === 0) pick.push(q);
  // segments are strongest-first except the appended focus rows; keep that order
  const n = pick.length;
  const out: IntraPulses = { count: n, i: new Int32Array(n), j: new Int32Array(n), speed: new Float32Array(n), offset: new Float32Array(n) };
  pick.forEach((q, k) => {
    out.i[k] = seg.i[q]; out.j[k] = seg.j[q];
    out.speed[k] = quantizeCycles(0.2 + 0.35 * Math.max(0, Math.min(1, seg.s[q])));
    out.offset[k] = xxhash(0x1e7a, seg.i[q] * 7919 + seg.j[q]);
  });
  return out;
}
