// Knowledge Galaxy — screen-space label declutter (pure, no three / DOM).
//
// Labels are bottom-centre anchored boxes in CSS px (the sprite's both text
// lines). Per camera change (≤ 12 labels → O(n²) is fine):
//   1. anchor behind the camera or outside the canvas → hidden (never pin an
//      off-screen cluster's label to the edge)
//   2. clamp the box inside the canvas with a margin → dx/dy shift
//   3. greedy by priority (cluster size): a box that overlaps an already kept
//      box is hidden — the bigger cluster keeps its label

export interface LabelInput {
  /** anchor (bottom-centre of the label) in CSS px; NaN = behind the camera */
  x: number;
  y: number;
  w: number;
  h: number;
  /** higher wins an overlap (cluster member count) */
  priority: number;
}

export interface LabelPlacement {
  visible: boolean;
  /** CSS px shift applied to keep the box inside the canvas (+x right, +y down) */
  dx: number;
  dy: number;
}

export interface DeclutterOptions {
  /** min distance from the canvas edge, CSS px */
  margin?: number;
  /** transparent padding inside each box, ignored for the overlap test, CSS px */
  insetX?: number;
  insetY?: number;
}

export function declutterLabels(
  items: readonly LabelInput[],
  width: number,
  height: number,
  opts: DeclutterOptions = {},
): LabelPlacement[] {
  const margin = opts.margin ?? 8;
  const insetX = opts.insetX ?? 0;
  const insetY = opts.insetY ?? 0;
  const n = items.length;
  const out: LabelPlacement[] = new Array(n);
  const boxes: { l: number; t: number; r: number; b: number }[] = new Array(n);
  const candidates: number[] = [];

  for (let i = 0; i < n; i++) {
    const it = items[i];
    out[i] = { visible: false, dx: 0, dy: 0 };
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    if (it.x < 0 || it.x > width || it.y < 0 || it.y > height) continue;
    let l = it.x - it.w / 2;
    let t = it.y - it.h;
    let dx = 0, dy = 0;
    if (l < margin) dx = margin - l;
    else if (l + it.w > width - margin) dx = Math.max(margin - l, width - margin - (l + it.w));
    if (t < margin) dy = margin - t;
    else if (t + it.h > height - margin) dy = Math.max(margin - t, height - margin - (t + it.h));
    l += dx; t += dy;
    out[i] = { visible: false, dx, dy };
    boxes[i] = { l: l + insetX, t: t + insetY, r: l + it.w - insetX, b: t + it.h - insetY };
    candidates.push(i);
  }

  candidates.sort((a, b) => items[b].priority - items[a].priority || a - b);
  const kept: number[] = [];
  for (const i of candidates) {
    const a = boxes[i];
    let clash = false;
    for (const j of kept) {
      const k = boxes[j];
      if (a.l < k.r && k.l < a.r && a.t < k.b && k.t < a.b) { clash = true; break; }
    }
    if (!clash) { kept.push(i); out[i].visible = true; }
  }
  return out;
}
