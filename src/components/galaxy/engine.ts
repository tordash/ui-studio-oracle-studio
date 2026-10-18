// Knowledge Galaxy — three.js engine (plain three, no R3F/drei/postprocessing).
//
// Draw-call budget (per frame):
//   1  stars        — ONE THREE.Points, custom shader (size attenuation, soft disc, additive)
//   1  halo         — 2-vertex Points for hover + selected glow rings
//   1  backdrop     — far star-field layer (decorative, not data, not pickable, parallax only)
//   ≤12 nebulae     — one Sprite per cluster (shared radial texture)
//   ≤12 labels      — one canvas-texture Sprite per cluster
//   ───────────────
//   ≤27 total, independent of star count (5.7k today, ~13k after arra #58).
//
// Rendering is on-demand: the rAF loop only runs while the camera is easing,
// the intro plays, or search matches pulse — otherwise it sleeps. It is also
// suspended when the tab is hidden or the canvas scrolls offscreen.

import * as THREE from 'three';
import type { GalaxyData } from '../../lib/galaxy/mapping';
import { galaxyTypeColor, hexToRgb01, STATE_HIDDEN, STATE_MATCH } from '../../lib/galaxy/mapping';
import type { GalaxyCluster } from '../../lib/galaxy/clusters';
import { ScreenGrid, projectPoints } from '../../lib/galaxy/pick-grid';
import { mulberry32 } from '../../lib/galaxy/clusters';
import { frameBounds, frameDistance } from '../../lib/galaxy/frame';

/** Thai-capable system font stack — no webfont, so canvas labels never race a font load. */
export const GALAXY_FONT_STACK =
  '"Sukhumvit Set", "Thonburi", "Noto Sans Thai", "Leelawadee UI", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

const FOV = 50;
const STAR_WORLD_SIZE = 0.17;
const MIN_DIST = 1.6;
const MAX_DIST = 90;
const BACKDROP_COUNT = 1400;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // free the probe context right away — iOS Safari caps live WebGL contexts
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function isPhoneLike(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const short = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999);
  return coarse && short <= 820;
}

/** DPR cap: 2 on desktop, 1.5 on phones (shared mobile budget). */
export function cappedPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, isPhoneLike() ? 1.5 : 2);
}

// ── Shaders ─────────────────────────────────────────────────────────────

const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aBright;
  attribute float aState;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uMotion;
  uniform float uIntro;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    if (aState > 2.5) { // hidden by type filter
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float size = aSize;
    float alpha = aBright;
    float hot = 0.0;
    if (aState > 1.5) {            // search match: pulse (static boost under reduced motion)
      float p = 0.5 + 0.5 * sin(uTime * 3.4 + aPhase * 6.2831853);
      size *= 1.9 + 0.9 * p * uMotion;
      alpha = 1.0;
      hot = 0.55 + 0.45 * p * uMotion;
    } else if (aState > 0.5) {     // dimmed (non-match / other project)
      size *= 0.75;
      alpha *= 0.1;
    }
    float px = size * ${STAR_WORLD_SIZE.toFixed(3)} * uScale * uPixelRatio / max(0.001, -mv.z);
    gl_PointSize = clamp(px, 1.6 * uPixelRatio, 46.0 * uPixelRatio) * mix(0.2, 1.0, uIntro);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = alpha * uIntro;
    vHot = hot;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;   // 0 centre → 1 edge
    if (d > 1.0) discard;
    float core = smoothstep(0.42, 0.0, d);
    float glow = pow(1.0 - d, 2.4) * (0.5 + 0.6 * vHot);
    float a = (core * 0.9 + glow) * vAlpha * 0.78;
    vec3 col = mix(vColor, vec3(1.0), core * (0.45 + 0.35 * vHot));
    gl_FragColor = vec4(col, a);
  }
`;

const HALO_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aKind;     // 0 hover, 1 selected
  attribute float aActive;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vKind;
  varying float vActive;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float breathe = 1.0 + 0.06 * sin(uTime * 2.2) * uMotion * aKind; // only advances while matches pulse
    gl_PointSize = (aKind > 0.5 ? 54.0 : 38.0) * uPixelRatio * breathe * aActive;
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vKind = aKind;
    vActive = aActive;
  }
`;

const HALO_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vKind;
  varying float vActive;
  void main() {
    if (vActive < 0.5) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float ringR = vKind > 0.5 ? 0.62 : 0.55;
    float ring = smoothstep(0.075, 0.0, abs(d - ringR));
    float outer = vKind > 0.5 ? smoothstep(0.04, 0.0, abs(d - 0.88)) * 0.35 : 0.0;
    float bloom = pow(1.0 - d, 3.0) * (vKind > 0.5 ? 0.85 : 0.6);
    float a = ring * (vKind > 0.5 ? 0.95 : 0.7) + outer + bloom;
    vec3 col = mix(vColor, vec3(1.0), 0.35 + ring * 0.3);
    gl_FragColor = vec4(col, a);
  }
`;

const BACKDROP_VERT = /* glsl */ `
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

const BACKDROP_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.0 - d) * vAlpha);
  }
`;

// ── Canvas textures ─────────────────────────────────────────────────────

function radialTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Two-line label: name, then "concept · 720" / "folder · 620" in the cluster tint. */
function labelTexture(cluster: GalaxyCluster, tint: string): { tex: THREE.CanvasTexture; aspect: number } {
  const scale = 2; // render at 2× for crisp text
  const nameFont = `600 ${15 * scale}px ${GALAXY_FONT_STACK}`;
  const metaFont = `500 ${10.5 * scale}px ${GALAXY_FONT_STACK}`;
  const meta = `${cluster.kind === 'folder' ? 'folder' : 'concept'} · ${cluster.size.toLocaleString()}`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = nameFont;
  const nameW = g.measureText(cluster.label).width;
  g.font = metaFont;
  const metaW = g.measureText(meta).width + 14 * scale;
  const padX = 8 * scale;
  const w = Math.ceil(Math.max(nameW, metaW) + padX * 2);
  const h = Math.ceil(44 * scale);
  c.width = w;
  c.height = h;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,8,0.85)';
  g.shadowBlur = 6 * scale;
  g.font = nameFont;
  g.fillStyle = 'rgba(240,243,255,0.94)';
  g.fillText(cluster.label, w / 2, 19 * scale);
  g.font = metaFont;
  g.fillStyle = tint;
  g.globalAlpha = 0.85;
  const metaX = w / 2 + 6 * scale;
  g.fillText(meta, metaX, 36 * scale);
  // tiny glyph: filled dot for concept, hollow square for folder
  const mw = g.measureText(meta).width;
  const gx = metaX - mw / 2 - 9 * scale;
  const gy = 32.5 * scale;
  g.shadowBlur = 0;
  if (cluster.kind === 'folder') {
    g.strokeStyle = tint;
    g.lineWidth = 1.2 * scale;
    g.strokeRect(gx - 3 * scale, gy - 3 * scale, 6 * scale, 6 * scale);
  } else {
    g.beginPath();
    g.arc(gx, gy, 3 * scale, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: w / h };
}

// ── Engine ──────────────────────────────────────────────────────────────

export interface GalaxyEngineCallbacks {
  /** Hovered/armed star changed (-1 = none). `touch` tells the UI to show the "tap again" hint. */
  onHover: (idx: number, touch: boolean) => void;
  /** Called with the CSS-pixel anchor of the hovered star whenever it moves on screen. */
  onHoverAnchor: (x: number, y: number, visible: boolean) => void;
  /** Second tap / click on the armed star. */
  onOpen: (idx: number) => void;
  onContextLost: () => void;
}

interface Damped { cur: number; goal: number }

declare global {
  interface Window {
    __galaxy?: {
      info: () => Record<string, number>;
      bench: (ms?: number) => Promise<{ fps: number; frames: number; calls: number }>;
    };
  }
}

export class GalaxyEngine {
  private container: HTMLElement;
  private data: GalaxyData;
  private cb: GalaxyEngineCallbacks;
  private reduced: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private stateAttr: THREE.BufferAttribute;
  private halo: THREE.Points;
  private haloMat: THREE.ShaderMaterial;
  private backdrop: THREE.Points;
  private backdropMat: THREE.ShaderMaterial;
  private nebulaTex: THREE.CanvasTexture;
  private nebulae: THREE.Sprite[] = [];
  private labels: { sprite: THREE.Sprite; aspect: number }[] = [];

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  // camera rig: orbit (yaw, pitch, dist) around a target, all exponentially damped
  private yaw: Damped = { cur: 0, goal: 0 };
  private pitch: Damped = { cur: 0.28, goal: 0.28 };
  private dist: Damped = { cur: 26, goal: 26 };
  private target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  private home = { target: new THREE.Vector3(), dist: 26, yaw: 0, pitch: 0.28 };
  private speed = 6;

  private raf = 0;
  private last = 0;
  private time = 0;
  private introStart = -1;
  private intro = 1;
  private visible = !document.hidden;
  private onScreen = true;
  private benchUntil = 0;
  private framesRendered = 0;
  private disposed = false;

  private states: Float32Array;
  private hasMatches = false;
  private hoverIdx = -1;
  private armedIdx = -1;
  private selectedIdx = -1;

  // picking
  private grid = new ScreenGrid(32);
  private gridDirty = true;
  private projX: Float32Array;
  private projY: Float32Array;
  private projZ: Float32Array;
  private vp = new THREE.Matrix4();

  // pointers
  private pointers = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, yaw: 0, pitch: 0, dragged: false, multi: false };
  private pinch = { d0: 1, dist0: 26 };

  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;

  constructor(container: HTMLElement, data: GalaxyData, clusters: GalaxyCluster[], cb: GalaxyEngineCallbacks, reducedMotion: boolean) {
    this.container = container;
    this.data = data;
    this.cb = cb;
    this.reduced = reducedMotion;
    this.states = new Float32Array(data.count);
    this.projX = new Float32Array(data.count);
    this.projY = new Float32Array(data.count);
    this.projZ = new Float32Array(data.count);

    this.width = Math.max(1, container.clientWidth);
    this.height = Math.max(1, container.clientHeight);
    this.pixelRatio = cappedPixelRatio();

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('aria-label', `Knowledge galaxy: ${data.count} documents`);
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(FOV, this.width / this.height, 0.05, 600);

    // ── stars: ONE Points ──
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(data.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(data.brightness, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
    this.stateAttr = new THREE.BufferAttribute(this.states, 1);
    this.stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', this.stateAttr);
    geo.computeBoundingSphere();
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
        uScale: { value: 1 },
        uMotion: { value: reducedMotion ? 0 : 1 },
        uIntro: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 2;
    this.scene.add(this.stars);

    // ── halo (hover + selected) ──
    const hgeo = new THREE.BufferGeometry();
    hgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    hgeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(6), 3));
    hgeo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    hgeo.setAttribute('aActive', new THREE.BufferAttribute(new Float32Array([0, 0]), 1));
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
        uMotion: { value: reducedMotion ? 0 : 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Points(hgeo, this.haloMat);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 3;
    this.scene.add(this.halo);

    // ── backdrop: far star-field layer (decorative only) ──
    const rand = mulberry32(20261018);
    const bp = new Float32Array(BACKDROP_COUNT * 3);
    const bs = new Float32Array(BACKDROP_COUNT);
    const ba = new Float32Array(BACKDROP_COUNT);
    const bc = new Float32Array(BACKDROP_COUNT * 3);
    for (let i = 0; i < BACKDROP_COUNT; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 140 + rand() * 120;
      const s = Math.sqrt(1 - u * u);
      bp[i * 3] = r * s * Math.cos(th); bp[i * 3 + 1] = r * u; bp[i * 3 + 2] = r * s * Math.sin(th);
      bs[i] = 0.8 + rand() * rand() * 2.2;
      ba[i] = 0.12 + rand() * 0.32;
      const warm = rand() < 0.18;
      bc[i * 3] = warm ? 1.0 : 0.78; bc[i * 3 + 1] = warm ? 0.88 : 0.85; bc[i * 3 + 2] = warm ? 0.75 : 1.0;
    }
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bgeo.setAttribute('aSize', new THREE.BufferAttribute(bs, 1));
    bgeo.setAttribute('aAlpha', new THREE.BufferAttribute(ba, 1));
    bgeo.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
    this.backdropMat = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: { uPixelRatio: { value: this.pixelRatio }, uIntro: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.backdrop = new THREE.Points(bgeo, this.backdropMat);
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = 0;
    this.scene.add(this.backdrop);

    // ── nebulae + labels (≤12 each) ──
    this.nebulaTex = radialTexture();
    for (const cl of clusters) {
      const typeHex = galaxyTypeColor(cl.dominantType);
      const [r, g, b] = hexToRgb01(typeHex);
      const tint = new THREE.Color().setRGB(r * 0.6 + 0.62 * 0.4, g * 0.6 + 0.55 * 0.4, b * 0.6 + 0.95 * 0.4, THREE.SRGBColorSpace);
      const nm = new THREE.SpriteMaterial({
        map: this.nebulaTex, color: tint, transparent: true, opacity: 0.085,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const neb = new THREE.Sprite(nm);
      neb.position.set(cl.cx, cl.cy, cl.cz);
      const s = Math.max(1.5, cl.spread * 3.4);
      neb.scale.set(s, s, 1);
      neb.renderOrder = 1;
      this.scene.add(neb);
      this.nebulae.push(neb);

      const { tex, aspect } = labelTexture(cl, typeHex);
      const lm = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, opacity: 0.9,
      });
      const sp = new THREE.Sprite(lm);
      sp.center.set(0.5, 0);
      sp.position.set(cl.cx, cl.cy + Math.min(cl.spread * 0.55, 2.2), cl.cz);
      sp.renderOrder = 4;
      this.scene.add(sp);
      this.labels.push({ sprite: sp, aspect });
    }

    // ── camera home: centroid of the data, distance fitted to the viewport ──
    const n = data.count;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += data.positions[i * 3]; cy += data.positions[i * 3 + 1]; cz += data.positions[i * 3 + 2]; }
    if (n > 0) this.home.target.set(cx / n, cy / n, cz / n);
    this.home.dist = this.fitDistance();
    this.home.pitch = data.flat ? 0 : 0.28;
    this.goHome(true);

    if (!reducedMotion && n > 0) {
      // eased intro: start far and swung round, glide home; stars fade in
      this.dist.cur = this.home.dist * 2.6;
      this.yaw.cur = -1.05;
      this.pitch.cur = 0.75;
      this.speed = 1.5;
      this.intro = 0;
      this.introStart = -1;
    }

    this.applySizeUniforms();
    this.bindEvents();
    this.exposeDebug();
    this.requestRender();
  }

  // ── public API ──

  setStates(states: Float32Array) {
    if (states.length !== this.states.length) return;
    this.states.set(states);
    this.stateAttr.needsUpdate = true;
    let m = false;
    for (let i = 0; i < states.length; i++) if (states[i] === STATE_MATCH) { m = true; break; }
    this.hasMatches = m;
    this.gridDirty = true;
    if (this.hoverIdx >= 0 && states[this.hoverIdx] === STATE_HIDDEN) this.setHover(-1, false);
    this.requestRender();
  }

  setSelected(idx: number) {
    this.selectedIdx = idx;
    this.updateHalo();
    this.requestRender();
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.starMat.uniforms.uMotion.value = reduced ? 0 : 1;
    this.haloMat.uniforms.uMotion.value = reduced ? 0 : 1;
    if (reduced) this.finishIntro();
    this.requestRender();
  }

  /** Ease the camera to a star (jump under reduced motion). */
  flyTo(idx: number) {
    if (idx < 0 || idx >= this.data.count) return;
    const p = this.data.positions;
    this.goalTarget.set(p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]);
    this.dist.goal = Math.max(MIN_DIST, Math.min(this.dist.goal, 3.4));
    this.speed = 3.2;
    this.finishIntro();
    if (this.reduced) this.snap();
    this.requestRender();
  }

  /** Frame a set of stars (e.g. search matches): centroid + p85 radius, fitted on both axes. */
  frame(indices: Iterable<number>) {
    const b = frameBounds(this.data.positions, indices);
    if (!b) return;
    this.goalTarget.set(b.cx, b.cy, b.cz);
    this.dist.goal = frameDistance(b, FOV, this.camera.aspect, { minDist: 4, maxDist: Math.max(4, this.home.dist) });
    this.speed = 2.6;
    this.finishIntro();
    if (this.reduced) this.snap();
    this.requestRender();
  }

  goHome(immediate = false) {
    this.goalTarget.copy(this.home.target);
    this.dist.goal = this.home.dist;
    this.yaw.goal = this.home.yaw;
    this.pitch.goal = this.home.pitch;
    this.speed = 3;
    if (immediate || this.reduced) this.snap();
    this.requestRender();
  }

  /** Re-anchor the tooltip after the UI re-rendered its content (size may have changed). */
  refreshHoverAnchor() {
    if (this.hoverIdx >= 0) this.emitHoverAnchor();
  }

  zoomBy(f: number) {
    this.dist.goal = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist.goal * f));
    if (this.reduced) this.snap();
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unbindEvents();
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.halo.geometry.dispose();
    this.haloMat.dispose();
    this.backdrop.geometry.dispose();
    this.backdropMat.dispose();
    for (const s of this.nebulae) s.material.dispose();
    this.nebulaTex.dispose();
    for (const l of this.labels) { l.sprite.material.map?.dispose(); l.sprite.material.dispose(); }
    // Sprite geometry is a shared module-level buffer in three — don't dispose it.
    this.scene.clear();
    this.renderer.dispose();
    // after unbindEvents(): the resulting webglcontextlost must not trigger the 2D fallback
    this.renderer.forceContextLoss();
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
    if (window.__galaxy && this.debugToken === window.__galaxy) delete window.__galaxy;
  }

  // ── internals ──

  private fitDistance(): number {
    // the normalised PCA cube spans ±GALAXY_RADIUS (10); fit ~11.5 units, wider on portrait screens
    const half = 11.5;
    const base = half / Math.tan((FOV * Math.PI) / 360);
    return Math.min(MAX_DIST, base / Math.min(1, this.width / this.height) ** 0.6);
  }

  private snap() {
    this.yaw.cur = this.yaw.goal;
    this.pitch.cur = this.pitch.goal;
    this.dist.cur = this.dist.goal;
    this.target.copy(this.goalTarget);
  }

  private finishIntro() {
    if (this.intro < 1) {
      this.intro = 1;
      this.starMat.uniforms.uIntro.value = 1;
      this.backdropMat.uniforms.uIntro.value = 1;
    }
  }

  private applySizeUniforms() {
    const scale = this.height / (2 * Math.tan((FOV * Math.PI) / 360));
    this.starMat.uniforms.uScale.value = scale;
    this.starMat.uniforms.uPixelRatio.value = this.pixelRatio;
    this.haloMat.uniforms.uPixelRatio.value = this.pixelRatio;
    this.backdropMat.uniforms.uPixelRatio.value = this.pixelRatio;
    // sizeAttenuation:false sprites — scale.y in NDC units; want ~44 CSS px tall labels
    this.camera.updateProjectionMatrix();
    const p11 = this.camera.projectionMatrix.elements[5];
    const labelPx = this.width < 520 ? 38 : 44;
    const sy = (2 * labelPx) / (this.height * p11);
    for (const l of this.labels) l.sprite.scale.set(sy * l.aspect, sy, 1);
  }

  private stepCamera(dt: number): boolean {
    const k = 1 - Math.exp(-this.speed * dt);
    let moving = false;
    for (const d of [this.yaw, this.pitch, this.dist]) {
      const diff = d.goal - d.cur;
      if (Math.abs(diff) > 1e-4 * Math.max(1, Math.abs(d.goal))) { d.cur += diff * k; moving = true; } else d.cur = d.goal;
    }
    const td = this.goalTarget.distanceTo(this.target);
    if (td > 1e-4) { this.target.lerp(this.goalTarget, k); moving = true; } else this.target.copy(this.goalTarget);
    if (!moving && this.speed !== 6 && this.intro >= 1) this.speed = 6;

    const cp = Math.cos(this.pitch.cur);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw.cur) * cp * this.dist.cur,
      this.target.y + Math.sin(this.pitch.cur) * this.dist.cur,
      this.target.z + Math.cos(this.yaw.cur) * cp * this.dist.cur,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    if (moving) this.gridDirty = true;
    return moving;
  }

  requestRender = () => {
    if (this.disposed || this.raf || !this.visible || !this.onScreen) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frameLoop);
  };

  private frameLoop = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.visible || !this.onScreen) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;

    let introActive = false;
    if (this.intro < 1) {
      if (this.introStart < 0) this.introStart = now;
      const t = Math.min(1, (now - this.introStart) / 1600);
      this.intro = 1 - Math.pow(1 - t, 3);
      this.starMat.uniforms.uIntro.value = this.intro;
      this.backdropMat.uniforms.uIntro.value = this.intro;
      introActive = this.intro < 1;
    }

    const moving = this.stepCamera(dt);
    // only data moves: search matches pulse. Selection halo is static (battery).
    const pulsing = !this.reduced && this.hasMatches;
    if (pulsing) {
      this.time += dt;
      this.starMat.uniforms.uTime.value = this.time;
      this.haloMat.uniforms.uTime.value = this.time;
    }

    // labels recede as the camera dives into a star
    const lo = Math.max(0.22, Math.min(0.9, (this.dist.cur - 3) / 9));
    for (const l of this.labels) l.sprite.material.opacity = lo * Math.max(0.25, this.intro);

    if (moving && this.hoverIdx >= 0) this.emitHoverAnchor();

    this.renderer.render(this.scene, this.camera);
    this.framesRendered++;

    if (moving || pulsing || introActive || now < this.benchUntil) {
      this.raf = requestAnimationFrame(this.frameLoop);
    }
  };

  private rebuildGrid() {
    this.camera.updateMatrixWorld();
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    projectPoints(this.data.positions, this.vp.elements, this.width, this.height, this.projX, this.projY, this.projZ);
    const st = this.states;
    this.grid.build(this.projX, this.projY, this.projZ, this.width, this.height, i => st[i] !== STATE_HIDDEN);
    this.gridDirty = false;
  }

  private pick(x: number, y: number, radius: number): number {
    if (this.gridDirty) this.rebuildGrid();
    return this.grid.pick(x, y, radius);
  }

  private setHover(idx: number, touch: boolean) {
    if (idx === this.hoverIdx) return;
    this.hoverIdx = idx;
    this.armedIdx = idx;
    this.updateHalo();
    this.cb.onHover(idx, touch);
    if (idx >= 0) this.emitHoverAnchor();
    else this.cb.onHoverAnchor(0, 0, false);
    this.container.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    this.requestRender();
  }

  private emitHoverAnchor() {
    const i = this.hoverIdx;
    if (i < 0) return;
    const v = new THREE.Vector3(this.data.positions[i * 3], this.data.positions[i * 3 + 1], this.data.positions[i * 3 + 2]).project(this.camera);
    const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
    this.cb.onHoverAnchor((v.x + 1) * 0.5 * this.width, (1 - v.y) * 0.5 * this.height, vis);
  }

  private updateHalo() {
    const pos = this.halo.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.halo.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const act = this.halo.geometry.getAttribute('aActive') as THREE.BufferAttribute;
    const p = this.data.positions, c = this.data.colors;
    [this.hoverIdx === this.selectedIdx ? -1 : this.hoverIdx, this.selectedIdx].forEach((idx, slot) => {
      if (idx >= 0) {
        pos.setXYZ(slot, p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]);
        col.setXYZ(slot, c[idx * 3], c[idx * 3 + 1], c[idx * 3 + 2]);
        act.setX(slot, 1);
      } else act.setX(slot, 0);
    });
    pos.needsUpdate = true; col.needsUpdate = true; act.needsUpdate = true;
  }

  // ── events ──

  private local(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent) => {
    const canvas = this.renderer.domElement;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      this.down = { x: p.x, y: p.y, yaw: this.yaw.goal, pitch: this.pitch.goal, dragged: false, multi: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), dist0: this.dist.goal };
      this.down.multi = true;
      this.down.dragged = true;
    }
    this.finishIntro();
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.dist.goal = Math.max(MIN_DIST, Math.min(MAX_DIST, this.pinch.dist0 * (this.pinch.d0 / d)));
        if (this.reduced) this.dist.cur = this.dist.goal;
        this.requestRender();
        return;
      }
      const dx = p.x - this.down.x, dy = p.y - this.down.y;
      if (!this.down.dragged && Math.hypot(dx, dy) > 6) {
        this.down.dragged = true;
        this.container.style.cursor = 'grabbing';
        this.setHover(-1, false);
      }
      if (this.down.dragged && !this.down.multi) {
        this.yaw.goal = this.down.yaw - dx * 0.0055;
        this.pitch.goal = Math.max(-1.35, Math.min(1.35, this.down.pitch + dy * 0.0055));
        this.speed = 10;
        if (this.reduced) { this.yaw.cur = this.yaw.goal; this.pitch.cur = this.pitch.goal; }
        this.requestRender();
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const idx = this.pick(p.x, p.y, 12);
      this.setHover(idx, false);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.pointers.size === 0) {
      if (!this.down.dragged && !this.down.multi) this.tap(this.local(e), e.pointerType);
      this.container.style.cursor = this.hoverIdx >= 0 ? 'pointer' : 'grab';
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) this.setHover(-1, false);
  };

  private tap(p: { x: number; y: number }, pointerType: string) {
    const touch = pointerType !== 'mouse';
    const idx = this.pick(p.x, p.y, touch ? 22 : 12);
    if (idx < 0) { this.setHover(-1, touch); return; }
    if (idx === this.armedIdx) {
      // clear hover first so engine + UI agree (no orphan halo after the sheet closes)
      this.setHover(-1, touch);
      this.cb.onOpen(idx);
      this.flyTo(idx);
    } else {
      this.setHover(idx, touch);
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0012)));
    this.zoomBy(f);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cb.onContextLost();
  };

  private onVisibility = () => {
    this.visible = !document.hidden;
    if (this.visible) this.requestRender();
    else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  };

  private onResize = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = cappedPixelRatio();
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    const wasHome = Math.abs(this.dist.goal - this.home.dist) < 1e-3;
    this.width = w; this.height = h; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.home.dist = this.fitDistance();
    if (wasHome) this.dist.goal = this.home.dist;
    this.applySizeUniforms();
    this.gridDirty = true;
    this.requestRender();
  };

  private bindEvents() {
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(this.container);
    } else {
      window.addEventListener('resize', this.onResize);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(entries => {
        const e = entries[entries.length - 1];
        this.onScreen = !!e && e.isIntersecting;
        if (this.onScreen) this.requestRender();
        else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      });
      this.io.observe(this.container);
    }
  }

  private unbindEvents() {
    const c = this.renderer.domElement;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('webglcontextlost', this.onContextLost);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.ro = null;
    this.io = null;
  }

  // ── verify hooks for the gated browser batch ──

  private debugToken: Window['__galaxy'] | undefined;

  private exposeDebug() {
    const info = () => {
      const r = this.renderer.info;
      return {
        calls: r.render.calls,
        points: r.render.points,
        triangles: r.render.triangles,
        geometries: r.memory.geometries,
        textures: r.memory.textures,
        stars: this.data.count,
        pixelRatio: this.pixelRatio,
        reducedMotion: this.reduced ? 1 : 0,
        framesRendered: this.framesRendered,
        looping: this.raf ? 1 : 0,
      };
    };
    const bench = (ms = 3000) => new Promise<{ fps: number; frames: number; calls: number }>(resolve => {
      const f0 = this.framesRendered;
      const t0 = performance.now();
      this.benchUntil = t0 + ms;
      this.requestRender();
      setTimeout(() => {
        const frames = this.framesRendered - f0;
        resolve({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), frames, calls: this.renderer.info.render.calls });
      }, ms + 50);
    });
    this.debugToken = { info, bench };
    window.__galaxy = this.debugToken;
  }
}
