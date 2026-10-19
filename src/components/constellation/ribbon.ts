// Fleet Constellation — instanced arc ribbons: every edge + every pulse in ONE
// draw call (C-D1). Screen-space width × DPR, soft edge as AA (no MSAA needed
// on the phone), back-hemisphere arcs fade to ×0.35, pulse heads in the
// sender's colour × 2.2 (no bloom, C-D6), draw-on via uDraw, additive,
// depthWrite off.

import * as THREE from 'three';
import { INSTANCE_LAYOUT, RIBBON_SEGMENTS, ribbonStrip, writeInstance } from '../../lib/constellation/ribbon-geom';
import type { InstanceName, RibbonInstance } from '../../lib/constellation/ribbon-geom';

const RIBBON_VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute vec3 aCtrl;
  attribute float aWidth;
  attribute vec3 aColA;
  attribute vec3 aColB;
  attribute float aHeat;
  attribute float aShare;
  attribute vec4 aFire;
  attribute float aDim;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform float uCenterZ;
  uniform float uR;
  varying float vT;
  varying float vSide;
  varying vec3 vColA;
  varying vec3 vColB;
  varying float vHeat;
  varying float vShare;
  varying vec4 vFire;
  varying float vDim;
  varying float vBack;
  varying float vDur;
  varying float vHalfPx;
  vec3 bez(float t) {
    float u = 1.0 - t;
    return u * u * aFrom + 2.0 * u * t * aCtrl + t * t * aTo;
  }
  void main() {
    float t = aT;
    float e = 1.0 / 64.0;
    float fwd = t < 1.0 - e ? 1.0 : -1.0;
    vec3 p = bez(t);
    vec3 q = bez(t + e * fwd);
    vec4 mvP = modelViewMatrix * vec4(p, 1.0);
    vec4 c0 = projectionMatrix * mvP;
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
    vT = t;
    vSide = aSide;
    vColA = aColA;
    vColB = aColB;
    vHeat = aHeat;
    vShare = aShare;
    vFire = aFire;
    vDim = aDim;
    vBack = mix(1.0, 0.35, smoothstep(0.0, uR * 0.5, uCenterZ - mvP.z));
    vDur = 1.2 + 0.04 * length(aTo - aFrom);
    vHalfPx = aWidth * 0.5 + 1.0;
    if (c0.w <= 0.0 || c1.w <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 halfRes = uResolution * 0.5;
    vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * halfRes * fwd;
    float len = length(dir);
    dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    // + 1 px for the soft edge
    vec2 off = nrm * aSide * vHalfPx * uPixelRatio / halfRes;
    gl_Position = c0 + vec4(off * c0.w, 0.0, 0.0);
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uDraw;
  varying float vT;
  varying float vSide;
  varying vec3 vColA;
  varying vec3 vColB;
  varying float vHeat;
  varying float vShare;
  varying vec4 vFire;
  varying float vDim;
  varying float vBack;
  varying float vDur;
  varying float vHalfPx;
  void main() {
    if (vT > uDraw) discard;
    float soft = 1.0 - smoothstep(max(0.0, 1.0 - 1.5 / vHalfPx), 1.0, abs(vSide));
    float mixT = clamp(vT + (0.5 - vShare) * 0.6, 0.0, 1.0);
    vec3 col = mix(vColA, vColB, mixT) * (0.10 + 0.35 * vHeat);
    for (int k = 0; k < 4; k++) {
      float f = vFire[k];
      if (f == 0.0) continue;
      float dir = f > 0.0 ? 1.0 : -1.0;
      float head = (uTime - abs(f)) / vDur;
      if (head < 0.0 || head > 1.25) continue;
      float pos = dir > 0.0 ? vT : 1.0 - vT;
      float d = pos - head;
      float s = d > 0.0 ? 0.02 : 0.09;
      float glow = exp(-(d * d) / (2.0 * s * s));
      col += (dir > 0.0 ? vColA : vColB) * 2.2 * glow;
    }
    gl_FragColor = vec4(col * vBack * vDim, soft);
  }
`;

export interface RibbonUniforms {
  time: number;
  draw: number;
  width: number;
  height: number;
  pixelRatio: number;
  centerZ: number;
}

export class RibbonLayer {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private arrays: Record<string, Float32Array> = {};
  private attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  private capacity = 0;

  constructor(radius: number, capacity = 96) {
    const strip = ribbonStrip(RIBBON_SEGMENTS);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('aT', new THREE.BufferAttribute(strip.t, 1));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(strip.side, 1));
    // three needs a `position` attribute to size the draw; the shader never reads it
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strip.t.length * 3), 3));
    this.geometry.setIndex(new THREE.BufferAttribute(strip.index, 1));
    this.allocate(capacity);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uDraw: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uCenterZ: { value: -24 },
        uR: { value: radius },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  private allocate(capacity: number) {
    const old = this.arrays;
    // growing: free the old GL buffers (replaced attributes are otherwise orphaned until context loss);
    // three re-uploads the geometry on the next render
    if (this.capacity > 0) this.geometry.dispose();
    this.capacity = capacity;
    for (const [name, k] of INSTANCE_LAYOUT) {
      const arr = new Float32Array(capacity * k);
      if (old[name]) arr.set(old[name].subarray(0, Math.min(old[name].length, arr.length)));
      this.arrays[name] = arr;
      const attr = new THREE.InstancedBufferAttribute(arr, k);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.attrs[name] = attr;
      this.geometry.setAttribute(name, attr);
    }
  }

  /** Grow (never shrink) so `n` instances fit. */
  ensure(n: number) {
    if (n <= this.capacity) return;
    this.allocate(Math.max(n, this.capacity * 2));
  }

  write(i: number, inst: RibbonInstance) {
    writeInstance(this.arrays, i, inst);
  }

  /** Patch a single attribute of one instance (e.g. aFire after a pulse). */
  patch(i: number, name: InstanceName, values: readonly number[]) {
    const k = this.attrs[name].itemSize;
    for (let j = 0; j < k; j++) this.arrays[name][i * k + j] = values[j] ?? 0;
    this.attrs[name].needsUpdate = true;
  }

  /** Upload: all attributes, or only the named ones. */
  commit(count: number, names?: readonly InstanceName[]) {
    this.geometry.instanceCount = count;
    for (const n of names ?? INSTANCE_LAYOUT.map(([name]) => name)) this.attrs[n].needsUpdate = true;
  }

  setUniforms(u: RibbonUniforms) {
    const m = this.material.uniforms;
    m.uTime.value = u.time;
    m.uDraw.value = u.draw;
    m.uResolution.value.set(u.width * u.pixelRatio, u.height * u.pixelRatio);
    m.uPixelRatio.value = u.pixelRatio;
    m.uCenterZ.value = u.centerZ;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
