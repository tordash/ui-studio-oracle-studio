// Shared far star-field backdrop (decorative only: not data, not pickable, parallax only).
// Promoted unchanged from components/galaxy/engine.ts (Knowledge Galaxy) so Knowledge Web
// reuses it: same seed, count, shaders and uniforms → the galaxy renders byte-identically.

import * as THREE from 'three';
import { mulberry32 } from '../galaxy/clusters';

export const BACKDROP_COUNT = 1400;
export const BACKDROP_SEED = 20261018;

export const BACKDROP_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uIntro;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    // far layer follows the camera at 92% → only 8% of camera translation shows: parallax depth
    vec3 p = position + cameraPosition * 0.92;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha * uIntro;
    vColor = aColor;
  }
`;

export const BACKDROP_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.0 - d) * vAlpha);
  }
`;

export interface BackdropArrays {
  positions: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  colors: Float32Array;
}

/** The backdrop's vertex data (pure; seeded). */
export function backdropArrays(count = BACKDROP_COUNT, seed = BACKDROP_SEED): BackdropArrays {
  const rand = mulberry32(seed);
  const bp = new Float32Array(count * 3);
  const bs = new Float32Array(count);
  const ba = new Float32Array(count);
  const bc = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
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

/** The backdrop Points (renderOrder 0, never culled). Callers own `uIntro` / `uPixelRatio` and disposal. */
export function createBackdrop(pixelRatio: number, count = BACKDROP_COUNT, seed = BACKDROP_SEED): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const a = backdropArrays(count, seed);
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
  bgeo.setAttribute('aSize', new THREE.BufferAttribute(a.sizes, 1));
  bgeo.setAttribute('aAlpha', new THREE.BufferAttribute(a.alphas, 1));
  bgeo.setAttribute('aColor', new THREE.BufferAttribute(a.colors, 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERT,
    fragmentShader: BACKDROP_FRAG,
    uniforms: { uPixelRatio: { value: pixelRatio }, uIntro: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(bgeo, material);
  points.frustumCulled = false;
  points.renderOrder = 0;
  return { points, material };
}
