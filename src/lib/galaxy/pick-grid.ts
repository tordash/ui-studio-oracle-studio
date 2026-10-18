// Knowledge Galaxy — GPU-free picking.
//
// Stars are projected to screen space once per camera change (O(n), ~13k
// multiply-adds), bucketed into a uniform 2D grid via counting sort, and a pick
// only scans the few cells under the pointer. No raycaster, no per-move O(n).

/**
 * Project world positions with a column-major 4×4 view-projection matrix
 * (three.js `Matrix4.elements`) into CSS-pixel coordinates.
 * Points behind the camera or outside the clip volume get x = NaN.
 */
export function projectPoints(
  positions: ArrayLike<number>,
  m: ArrayLike<number>,
  width: number,
  height: number,
  outX: Float32Array,
  outY: Float32Array,
  outDepth: Float32Array,
): void {
  const n = Math.floor(positions.length / 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) { outX[i] = NaN; outY[i] = NaN; outDepth[i] = Infinity; continue; }
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    const cz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / cw;
    if (cz < -1 || cz > 1) { outX[i] = NaN; outY[i] = NaN; outDepth[i] = Infinity; continue; }
    outX[i] = (cx + 1) * 0.5 * width;
    outY[i] = (1 - cy) * 0.5 * height;
    outDepth[i] = cz;
  }
}

export class ScreenGrid {
  readonly cell: number;
  private cols = 0;
  private rows = 0;
  private cellStart = new Int32Array(1);
  private items = new Int32Array(0);
  private xs = new Float32Array(0);
  private ys = new Float32Array(0);
  private depth = new Float32Array(0);

  constructor(cell = 32) {
    this.cell = cell;
  }

  /**
   * Bucket projected points. `include(i)` false → skipped (hidden / filtered
   * stars are never pickable). Arrays are kept by reference.
   */
  build(xs: Float32Array, ys: Float32Array, depth: Float32Array, width: number, height: number, include?: (i: number) => boolean): void {
    const cell = this.cell;
    const cols = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(height / cell));
    const nCells = cols * rows;
    const n = xs.length;
    const cellOf = new Int32Array(n);
    const counts = new Int32Array(nCells + 1);
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      if (!(x >= 0 && x < width && y >= 0 && y < height) || (include && !include(i))) { cellOf[i] = -1; continue; }
      const c = Math.floor(y / cell) * cols + Math.floor(x / cell);
      cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let c = 0; c < nCells; c++) counts[c + 1] += counts[c];
    const items = new Int32Array(counts[nCells]);
    const fill = counts.slice(0, nCells);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c >= 0) items[fill[c]++] = i;
    }
    this.cols = cols; this.rows = rows;
    this.cellStart = counts; this.items = items;
    this.xs = xs; this.ys = ys; this.depth = depth;
  }

  /** Nearest star to (x, y) within `radius` px; near-ties go to the star closer to the camera. -1 if none. */
  pick(x: number, y: number, radius: number): number {
    const { cell, cols, rows, cellStart, items, xs, ys, depth } = this;
    if (cols === 0) return -1;
    const r2 = radius * radius;
    const c0 = Math.max(0, Math.floor((x - radius) / cell));
    const c1 = Math.min(cols - 1, Math.floor((x + radius) / cell));
    const r0 = Math.max(0, Math.floor((y - radius) / cell));
    const r1 = Math.min(rows - 1, Math.floor((y + radius) / cell));
    let best = -1, bestD2 = Infinity, bestZ = Infinity;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const id = r * cols + c;
        for (let k = cellStart[id]; k < cellStart[id + 1]; k++) {
          const i = items[k];
          const dx = xs[i] - x, dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          // within 2px of the current best → prefer the nearer-to-camera star
          if (d2 + 4 < bestD2 || (Math.abs(d2 - bestD2) <= 4 && depth[i] < bestZ)) {
            best = i; bestD2 = d2; bestZ = depth[i];
          }
        }
      }
    }
    return best;
  }
}
