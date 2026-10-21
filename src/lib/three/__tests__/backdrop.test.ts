import { describe, it, expect } from 'bun:test';
import { backdropArrays, createBackdrop, BACKDROP_COUNT, BACKDROP_SEED } from '../backdrop';
import { mulberry32 } from '../../galaxy/clusters';

// The loop exactly as it stood inline in components/galaxy/engine.ts before the promotion.
function galaxyOriginal() {
  const BACKDROP_COUNT_ORIG = 1400;
  const rand = mulberry32(20261018);
  const bp = new Float32Array(BACKDROP_COUNT_ORIG * 3);
  const bs = new Float32Array(BACKDROP_COUNT_ORIG);
  const ba = new Float32Array(BACKDROP_COUNT_ORIG);
  const bc = new Float32Array(BACKDROP_COUNT_ORIG * 3);
  for (let i = 0; i < BACKDROP_COUNT_ORIG; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 140 + rand() * 120;
    const s = Math.sqrt(1 - u * u);
    bp[i * 3] = r * s * Math.cos(th); bp[i * 3 + 1] = r * u; bp[i * 3 + 2] = r * s * Math.sin(th);
    bs[i] = 0.8 + rand() * rand() * 2.2;
    ba[i] = 0.12 + rand() * 0.32;
    const warm = rand() < 0.18;
    bc[i * 3] = warm ? 1.0 : 0.78; bc[i * 3 + 1] = warm ? 0.88 : 0.85; bc[i * 3 + 2] = warm ? 0.75 : 1.0;
  }
  return { positions: bp, sizes: bs, alphas: ba, colors: bc };
}

describe('promoted backdrop', () => {
  it('produces byte-identical data to the galaxy original', () => {
    expect(BACKDROP_COUNT).toBe(1400);
    expect(BACKDROP_SEED).toBe(20261018);
    const a = backdropArrays();
    const o = galaxyOriginal();
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(o.positions.buffer))).toBe(true);
    expect(Buffer.from(a.sizes.buffer).equals(Buffer.from(o.sizes.buffer))).toBe(true);
    expect(Buffer.from(a.alphas.buffer).equals(Buffer.from(o.alphas.buffer))).toBe(true);
    expect(Buffer.from(a.colors.buffer).equals(Buffer.from(o.colors.buffer))).toBe(true);
  });
  it('creates the same Points setup (renderOrder 0, never culled, uIntro/uPixelRatio uniforms)', () => {
    const { points, material } = createBackdrop(1.5);
    expect(points.geometry.getAttribute('position').count).toBe(1400);
    expect(points.renderOrder).toBe(0);
    expect(points.frustumCulled).toBe(false);
    expect(material.uniforms.uPixelRatio.value).toBe(1.5);
    expect(material.uniforms.uIntro.value).toBe(1);
    expect(material.depthWrite).toBe(false);
    points.geometry.dispose();
    material.dispose();
  });
});
