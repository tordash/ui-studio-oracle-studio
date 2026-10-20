// Knowledge Web — deterministic hashes (ports of pages/Graph3D.tsx:31-62, KlakMath style).
// Same arithmetic as Graph3D (golden-value tested), tuples instead of THREE.Vector3 so
// this stays three-free.

export type Vec3 = [number, number, number];

/** KlakMath XXHash → [0, 1). Byte-for-byte the Graph3D version. */
export function xxhash(seed: number, data: number): number {
  let h = ((seed + 374761393) >>> 0);
  h = ((h + (data * 3266489917 >>> 0)) >>> 0);
  h = ((((h << 17) | (h >>> 15)) * 668265263) >>> 0);
  h ^= h >>> 15;
  h = ((h * 2246822519) >>> 0);
  h ^= h >>> 13;
  h = ((h * 3266489917) >>> 0);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Uniform point on the unit sphere. */
export function hashOnSphere(seed: number, data: number): Vec3 {
  const phi = xxhash(seed, data) * Math.PI * 2;
  const cosTheta = xxhash(seed, data + 0x10000000) * 2 - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  return [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta];
}

/** Surface-biased point in the unit ball (radius 0.2–1.0). */
export function hashInSphere(seed: number, data: number): Vec3 {
  const d = hashOnSphere(seed, data);
  const raw = xxhash(seed + 77, data + 0x20000000);
  const r = 0.2 + 0.8 * raw * raw;
  return [d[0] * r, d[1] * r, d[2] * r];
}

/** FNV-1a of a string → uint32 (same mix as lib/planets/orbits.ts hashTilt). */
export function fnv1a(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
