// Fleet Constellation — nodes on a sphere shell, stable slots (pure).
//
// Slots are Fibonacci points sorted by dot(slot, +z) — slot 0 is dead centre
// front (the camera's home direction). The busiest node takes slot 0, but
// nodes are sticky so the layout does not jump on every poll:
//   - re-rank at most every RERANK_MS
//   - at a re-rank a node moves only if its rank moved ≥ 2 places AND its
//     score differs > 25 % from the occupant of its target slot (they swap)
//   - a new node takes the best free slot at any time
//   - the slot set only grows (2N > M), remapping each node to the nearest
//     free new slot, so nothing reshuffles
// The camera never chases nodes; nodes migrate (slerp, SLOT_MOVE_MS).

export type Vec3 = [number, number, number];

export interface Ranked { key: string; score: number }

export interface SlotState {
  /** unit vectors, front-sorted */
  slots: Vec3[];
  /** node key → slot index */
  assign: Map<string, number>;
  /** last re-rank time (ms) */
  lastRank: number;
  /** nodes whose slot changed in this call (animate them) */
  moved: Set<string>;
}

export const SHELL_R = 10;
export const RERANK_MS = 60_000;
export const SLOT_MOVE_MS = 1200;
const RANK_STEP = 2;
const SCORE_GAP = 0.25;
const FRONT: Vec3 = [0, 0, 1];

export const slotCount = (n: number) => Math.min(64, Math.max(16, 2 * n));

export const rankScore = (activity: number, heat: number) => activity * (0.5 + 0.5 * heat);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function fibonacciSlots(M: number): Vec3[] {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const out: Vec3[] = [];
  for (let i = 0; i < M; i++) {
    const z = 1 - (2 * (i + 0.5)) / M;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = i * ga;
    out.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }
  return out.sort((a, b) => dot(b, FRONT) - dot(a, FRONT));
}

const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);

function bestFree(used: Set<number>, M: number): number {
  for (let i = 0; i < M; i++) if (!used.has(i)) return i;
  return -1;
}

/** `ranking` is sorted by score desc (index = rank). */
export function assignSticky(prev: SlotState | null, ranking: readonly Ranked[], now: number): SlotState {
  const moved = new Set<string>();
  const present = new Set(ranking.map(r => r.key));

  if (!prev) {
    const slots = fibonacciSlots(slotCount(ranking.length));
    const assign = new Map<string, number>();
    ranking.forEach((r, i) => { if (i < slots.length) assign.set(r.key, i); });
    return { slots, assign, lastRank: now, moved };
  }

  const rerank = now - prev.lastRank >= RERANK_MS;
  let slots = prev.slots;
  let assign = new Map(prev.assign);
  // absent nodes keep their slot between re-ranks; a re-rank releases them
  if (rerank) for (const k of [...assign.keys()]) if (!present.has(k)) assign.delete(k);

  // grow only: remap to the nearest free new slot, front-most nodes first
  const need = slotCount(Math.max(ranking.length, assign.size));
  if (need > slots.length) {
    const next = fibonacciSlots(need);
    const used = new Set<number>();
    const remapped = new Map<string, number>();
    const old = [...assign.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k, idx] of old) {
      const p = slots[idx];
      let best = -1, bestD = -Infinity;
      for (let j = 0; j < next.length; j++) {
        if (used.has(j)) continue;
        const d = dot(p, next[j]);
        if (d > bestD) { bestD = d; best = j; }
      }
      used.add(best);
      remapped.set(k, best);
      moved.add(k);
    }
    slots = next;
    assign = remapped;
  }

  if (rerank) {
    const score = new Map(ranking.map(r => [r.key, r.score]));
    const occupant = new Map<number, string>();
    for (const [k, i] of assign) occupant.set(i, k);
    ranking.forEach((r, target) => {
      const cur = assign.get(r.key);
      if (cur === undefined || cur === target || Math.abs(cur - target) < RANK_STEP || target >= slots.length) return;
      const occ = occupant.get(target);
      if (occ !== undefined) {
        if (relDiff(r.score, score.get(occ) ?? 0) <= SCORE_GAP) return;
        assign.set(occ, cur);
        occupant.set(cur, occ);
        moved.add(occ);
      } else {
        occupant.delete(cur);
      }
      assign.set(r.key, target);
      occupant.set(target, r.key);
      moved.add(r.key);
    });
  }

  const used = new Set(assign.values());
  for (const r of ranking) {
    if (assign.has(r.key)) continue;
    const i = bestFree(used, slots.length);
    if (i < 0) break;
    assign.set(r.key, i);
    used.add(i);
  }

  return { slots, assign, lastRank: rerank ? now : prev.lastRank, moved };
}

/** Quadratic Bézier control point: bows outward above the shell. */
export function arcControl(a: Vec3, b: Vec3, R: number): Vec3 {
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const s: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  let dir: Vec3;
  if (Math.hypot(s[0], s[1], s[2]) < 1e-6 * Math.max(1, R)) {
    // antipodal: midpoint ≈ centre → stable perpendicular
    const ua = norm(a);
    let p = cross(ua, [0, 1, 0]);
    if (Math.hypot(p[0], p[1], p[2]) < 1e-6) p = cross(ua, [1, 0, 0]);
    dir = norm(p);
  } else {
    dir = norm(s);
  }
  const k = R * (1 + (0.35 * chord) / (2 * R));
  return [dir[0] * k, dir[1] * k, dir[2] * k];
}

/** Great-circle interpolation between unit vectors. */
export function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const w = Math.acos(d);
  const sw = Math.sin(w);
  if (sw < 1e-6) {
    if (d > 0) return a;
    const p = norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));
    const c = Math.cos(Math.PI * t), s = Math.sin(Math.PI * t);
    return [a[0] * c + p[0] * s, a[1] * c + p[1] * s, a[2] * c + p[2] * s];
  }
  const ka = Math.sin((1 - t) * w) / sw, kb = Math.sin(t * w) / sw;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
