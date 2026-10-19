// Fleet Constellation — instanced arc-ribbon geometry (pure; C-D1).
//
// WebGL ignores `linewidth`, so "edge thickness = message count" needs real
// geometry: one base strip (SEGMENTS × 2 triangles, attributes t and side),
// instanced once per edge. The vertex shader evaluates the quadratic Bézier,
// projects it, and offsets ± width/2 in screen pixels. Pulses ride in the
// same draw call through aFire (the T5 ring).

export const RIBBON_SEGMENTS = 32;
/** aDim for edges outside the focus set / not touching the selection */
export const DIM_OUT = 0.15;

/** Instance attributes, in upload order: [name, floats]. */
export const INSTANCE_LAYOUT = [
  ['aFrom', 3], ['aTo', 3], ['aCtrl', 3], ['aWidth', 1], ['aColA', 3], ['aColB', 3],
  ['aHeat', 1], ['aShare', 1], ['aFire', 4], ['aDim', 1],
] as const satisfies readonly (readonly [string, number])[];

export type InstanceName = (typeof INSTANCE_LAYOUT)[number][0];

export const instanceFloats = () => INSTANCE_LAYOUT.reduce((s, [, k]) => s + k, 0);

export interface RibbonStrip {
  /** 0 → 1 along the curve, per vertex */
  t: Float32Array;
  /** −1 / +1 across the ribbon */
  side: Float32Array;
  index: Uint16Array;
}

/** (segments + 1) × 2 vertices, segments × 6 indices. */
export function ribbonStrip(segments: number = RIBBON_SEGMENTS): RibbonStrip {
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

export interface RibbonInstance {
  from: readonly number[];
  to: readonly number[];
  ctrl: readonly number[];
  /** CSS px */
  width: number;
  colA: readonly number[];
  colB: readonly number[];
  heat: number;
  /** countAB / count — biases the colour gradient toward the dominant sender */
  share: number;
  /** packFire(ring) */
  fire: readonly number[];
  dim: number;
}

const FIELD: Record<InstanceName, keyof RibbonInstance> = {
  aFrom: 'from', aTo: 'to', aCtrl: 'ctrl', aWidth: 'width', aColA: 'colA', aColB: 'colB',
  aHeat: 'heat', aShare: 'share', aFire: 'fire', aDim: 'dim',
};

/** Write instance `i` into per-attribute arrays (each sized capacity × floats). */
export function writeInstance(arrays: Record<string, Float32Array>, i: number, v: RibbonInstance) {
  for (const [name, k] of INSTANCE_LAYOUT) {
    const val = v[FIELD[name]];
    const arr = arrays[name];
    if (typeof val === 'number') arr[i * k] = val;
    else for (let j = 0; j < k; j++) arr[i * k + j] = val[j] ?? 0;
  }
}

/** Selection wins over focus; untouched edges dim to DIM_OUT. */
export function edgeDim(e: { a: string; b: string }, focus: ReadonlySet<string>, selected: string | null): number {
  if (selected) return e.a === selected || e.b === selected ? 1 : DIM_OUT;
  if (focus.size > 0) return focus.has(e.a) || focus.has(e.b) ? 1 : DIM_OUT;
  return 1;
}

/** Pulse travel time, seconds, for a chord in world units. */
export const pulseDuration = (chord: number) => 1.2 + 0.04 * chord;
