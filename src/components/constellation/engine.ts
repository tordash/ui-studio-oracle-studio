// Fleet Constellation — three.js engine (plain three, no R3F, no effect composer).
//
// Draw-call budget (per frame), the same on phone and desktop:
//   1  stars    — static far starfield (decorative, no motion)
//   1  shell    — icosphere, Fresnel rim + dotted graticule
//   1  ribbons  — every edge + every pulse, one instanced draw (C-D1)
//   1  nodes    — one Points, shared GLOW_POINT_FRAG (no bloom, C-D6)
//   1  rings    — selected / hot / flash / hollow mac-tor (C-D2)
//   ─────────
//   5 total (cap 6). 0 lights.
//
// Rendering is on demand: the rAF loop runs only while lib/constellation/
// loop-state keepAlive() says something real moves, and it is suspended when
// the tab is hidden, the page is hidden (pagehide) or the canvas scrolls
// offscreen. The shader clock uTime starts at UTIME_START and only advances
// while frames render, so a pulse never jumps after a pause.

import * as THREE from 'three';
import type { Graph } from '../../lib/constellation/aggregate';
import type { GraphEdge } from '../../lib/constellation/aggregate';
import type { ParsedMsg } from '../../lib/constellation/parse';
import { assignSticky, rankScore, slerpUnit, easeInOut, arcControl, SHELL_R, SLOT_MOVE_MS } from '../../lib/constellation/layout';
import type { SlotState, Vec3 } from '../../lib/constellation/layout';
import { oracleColor, NODE_COLOR } from '../../lib/constellation/colors';
import { UTIME_START, newFireRing, packFire, pushFire, schedulePulses } from '../../lib/constellation/schedule';
import type { Fire, FireRing } from '../../lib/constellation/schedule';
import { edgeDim, pulseDuration } from '../../lib/constellation/ribbon-geom';
import { edgeWidthPx } from '../../lib/constellation/width';
import { keepAlive, clampDt, drawCallBudget } from '../../lib/constellation/loop-state';
import { hexToRgb01 } from '../../lib/galaxy/mapping';
import { mulberry32 } from '../../lib/galaxy/clusters';
import { bindRenderGate, cappedPixelRatio, isPhoneLike, GLOW_POINT_FRAG } from '../../lib/three';
import { STAR_VERT, STAR_FRAG, SHELL_VERT, SHELL_FRAG, NODE_VERT, RING_VERT, RING_FRAG } from './shaders';
import { RibbonLayer } from './ribbon';
import { OrbitRig } from './orbit';
import { DomLabelPool } from './labels';
import type { LabelItem } from './labels';
import { chooseLabels, labelPriority, backside } from '../../lib/constellation/label-pool';
import { pickNode, pickEdge, bezierSamples } from '../../lib/constellation/pick';
import { introState, igniteStagger, driftOn, DRIFT_RAD_S, INTRO_END_S, REPLAY_START_S } from '../../lib/constellation/intro';
import type { ScreenNode } from '../../lib/constellation/pick';

const FOV = 50;
const MAX_NODES = 64;
const CLEAR = 0x04050b;
const HOT_MS = 2 * 60_000;
const DIM_UNFOCUSED = 0.2;
const HOME = { dist: 24, yaw: 0, pitch: 0.18 };
const FLASH_S = 0.4;

export type PulseMode = 'first' | 'live' | 'catchup';

/** node visual diameter, CSS px: 6 + 5·sqrt(activity), cap 34 */
export const nodeSizePx = (activity: number) => Math.min(34, 6 + 5 * Math.sqrt(Math.max(0, activity)));

export interface HoverInfo {
  kind: 'node' | 'edge';
  /** node key, or edge pairKey */
  key: string;
  /** CSS px inside the canvas */
  x: number;
  y: number;
}

export interface ConstellationCallbacks {
  /** WebGL init failed or the context was lost → show the 2D fallback at once */
  onContextLost: () => void;
  /** tap / click / label button: a node key, or null for empty space */
  onSelect: (key: string | null) => void;
  /** desktop hover over a node or an arc; null = nothing */
  onHover: (h: HoverInfo | null) => void;
}

export interface ViewInput {
  /** focused keys; empty = no focus */
  focus: ReadonlySet<string>;
  selected: string | null;
  /** hide kind 'node' (mac-tor) */
  hideHostNodes: boolean;
}

interface NodeRt {
  key: string;
  kind: 'oracle' | 'node';
  /** current unit direction (animated) */
  dir: Vec3;
  from: Vec3;
  to: Vec3;
  moveStart: number;
}

declare global {
  interface Window {
    __constellation?: {
      info: () => Record<string, number>;
      bench: (ms?: number) => Promise<{ fps: number; frames: number; calls: number }>;
    };
  }
}

export class ConstellationEngine {
  protected container: HTMLElement;
  protected cb: ConstellationCallbacks;
  protected reduced: boolean;
  protected phone = isPhoneLike();

  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  private stars: THREE.Points;
  private starMat: THREE.ShaderMaterial;
  private shell: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial;
  private nodes: THREE.Points;
  private nodeMat: THREE.ShaderMaterial;
  private rings: THREE.Points;
  private ringMat: THREE.ShaderMaterial;
  private nodeAttr: Record<'position' | 'aColor' | 'aSize' | 'aAlpha' | 'aHot' | 'aRank', THREE.BufferAttribute>;
  private ringAttr: Record<'position' | 'aColor' | 'aSize' | 'aAlpha' | 'aFlags' | 'aFlash', THREE.BufferAttribute>;
  private ribbons: RibbonLayer;

  protected width = 1;
  protected height = 1;
  protected pixelRatio = 1;

  // camera: orbit rig around the shell centre
  protected orbit: OrbitRig;
  protected homeDist = HOME.dist;
  private labels: DomLabelPool;
  private hovered: string | null = null;
  private labelsDirty = true;
  private poseKey: number[] = [];
  private tmpV = new THREE.Vector3();
  protected lastInputAt = 0;

  // data
  protected graph: Graph | null = null;
  protected slotState: SlotState | null = null;
  protected rt = new Map<string, NodeRt>();
  /** draw order = graph.nodes order */
  protected order: string[] = [];
  protected view: ViewInput = { focus: new Set(), selected: null, hideHostNodes: false };
  /** drawn edges, instance order */
  protected edgeList: GraphEdge[] = [];
  private edgeIdx = new Map<string, number>();
  private fireRings = new Map<string, FireRing>();
  private arrivals: { key: string; at: number }[] = [];
  private flashes = new Map<string, { start: number; k: number }>();
  private newRing = new Set<string>();
  private pulseUntil = 0;
  private flashUntil = 0;

  // loop
  private raf = 0;
  private last = 0;
  protected time = UTIME_START;
  protected introT = 0;
  protected introOn = false;
  private visible = !document.hidden;
  private pageShown = true;
  private onScreen = true;
  private benchUntil = 0;
  protected framesRendered = 0;
  protected disposed = false;

  private unbindGate: (() => void) | null = null;
  private ro: ResizeObserver | null = null;

  constructor(container: HTMLElement, cb: ConstellationCallbacks, reducedMotion: boolean) {
    this.container = container;
    this.cb = cb;
    this.reduced = reducedMotion;
    this.width = Math.max(1, container.clientWidth);
    this.height = Math.max(1, container.clientHeight);
    this.pixelRatio = cappedPixelRatio();

    // antialias on desktop only: the shaders do their own soft edges on the phone
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.phone, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(CLEAR, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'pan-y';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(FOV, this.width / this.height, 0.1, 600);

    // ── starfield (static) ──
    const count = this.phone ? 1200 : 3000;
    const rand = mulberry32(20261019);
    const sp = new Float32Array(count * 3), ss = new Float32Array(count), sa = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 120 + rand() * 120;
      const s = Math.sqrt(1 - u * u);
      sp[i * 3] = r * s * Math.cos(th); sp[i * 3 + 1] = r * u; sp[i * 3 + 2] = r * s * Math.sin(th);
      ss[i] = 1 + rand() * 0.6;
      sa[i] = 0.35 + rand() * 0.25;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sgeo.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    sgeo.setAttribute('aAlpha', new THREE.BufferAttribute(sa, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uPixelRatio: { value: this.pixelRatio } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(sgeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 0;
    this.scene.add(this.stars);

    // ── shell ──
    this.shellMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
      uniforms: {
        uRim: { value: new THREE.Vector3(...hexToRgb01('#3b4a7a')) },
        uGrid: { value: new THREE.Vector3(...hexToRgb01('#8ea2ff')) },
        uFade: { value: 1 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(SHELL_R * 0.995, this.phone ? 3 : 4), this.shellMat);
    this.shell.renderOrder = 1;
    this.scene.add(this.shell);

    // ── nodes + rings (preallocated for MAX_NODES) ──
    const mk = (n: number) => { const a = new THREE.BufferAttribute(new Float32Array(MAX_NODES * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.nodeAttr = { position: mk(3), aColor: mk(3), aSize: mk(1), aAlpha: mk(1), aHot: mk(1), aRank: mk(1) };
    this.ringAttr = { position: mk(3), aColor: mk(3), aSize: mk(1), aAlpha: mk(1), aFlags: mk(4), aFlash: mk(2) };
    // rings share the node position buffer: one upload moves both
    this.ringAttr.position = this.nodeAttr.position;
    const ngeo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(this.nodeAttr)) ngeo.setAttribute(k, a);
    ngeo.setDrawRange(0, 0);
    const shared = {
      uPixelRatio: { value: this.pixelRatio },
      uIntroT: { value: 99 },
      uStagger: { value: 0.06 },
      uCenterZ: { value: -HOME.dist },
      uRefDist: { value: HOME.dist },
      uR: { value: SHELL_R },
    };
    this.nodeMat = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT, fragmentShader: GLOW_POINT_FRAG,
      uniforms: shared,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.nodes = new THREE.Points(ngeo, this.nodeMat);
    this.nodes.frustumCulled = false;
    this.nodes.renderOrder = 3;
    this.scene.add(this.nodes);

    const rgeo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(this.ringAttr)) rgeo.setAttribute(k, a);
    rgeo.setDrawRange(0, 0);
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: { ...shared, uTime: { value: this.time }, uMotion: { value: reducedMotion ? 0 : 1 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.rings = new THREE.Points(rgeo, this.ringMat);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    this.scene.add(this.rings);

    // ── ribbons: all edges + pulses, one instanced draw ──
    this.ribbons = new RibbonLayer(SHELL_R);
    this.scene.add(this.ribbons.mesh);

    this.homeDist = this.fitDistance();
    this.orbit = new OrbitRig(canvas, { ...HOME, dist: this.homeDist }, { phone: this.phone, reduced: reducedMotion }, {
      onTap: this.onTap,
      onHover: this.onHoverAt,
      onInput: this.onInput,
      onChange: this.requestRender,
    });
    this.labels = new DomLabelPool(container, key => this.cb.onSelect(key));
    this.lastInputAt = performance.now();
    this.applyCamera();
    this.bindEvents();
    this.exposeDebug();
    this.requestRender();
  }

  // ── public API ──

  /** uTime "now" (seconds) — pulse schedules are expressed in this clock. */
  clock(): number { return this.time; }

  isPhone(): boolean { return this.phone; }

  setGraph(graph: Graph) {
    const first = !this.graph && graph.nodes.length > 0;
    this.graph = graph;
    const ranking = graph.nodes
      .map(n => ({ key: n.key, score: rankScore(n.activity, n.heat) }))
      .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    this.slotState = assignSticky(this.slotState, ranking, graph.now);
    const now = performance.now();
    const st = this.slotState;
    for (const n of graph.nodes) {
      const idx = st.assign.get(n.key);
      if (idx === undefined) continue;
      const target = st.slots[idx];
      const r = this.rt.get(n.key);
      if (!r) {
        this.rt.set(n.key, { key: n.key, kind: n.kind, dir: target, from: target, to: target, moveStart: -1 });
      } else if (r.to !== target) {
        r.kind = n.kind;
        if (this.reduced) { r.dir = r.from = r.to = target; r.moveStart = -1; }
        else { r.from = r.dir; r.to = target; r.moveStart = now; }
      }
    }
    this.order = graph.nodes.filter(n => st.assign.has(n.key)).slice(0, MAX_NODES).map(n => n.key);
    if (first) this.startIntro();
    this.writeNodes();
    this.writeRibbons();
    this.requestRender();
  }

  setView(view: ViewInput) {
    const prevSel = this.view.selected;
    this.view = view;
    if (view.selected && view.selected !== prevSel) this.flyTo(view.selected);
    this.labelsDirty = true;
    this.writeNodes();
    this.writeRibbons();
    this.requestRender();
  }

  /**
   * New messages from one poll → pulses (T5 schedule). 'first' replays during
   * the intro; reduced motion gets static "new" rings instead.
   */
  pulse(msgs: readonly ParsedMsg[], mode: PulseMode) {
    const lead = mode === 'first' && this.introOn ? Math.max(0.05, REPLAY_START_S - this.introT) : 0.05;
    const r = schedulePulses({ msgs, startS: this.time + lead, nowMs: Date.now(), mode, reducedMotion: this.reduced });
    this.newRing = r.newRing;
    this.applyFires(r.fires);
    for (const k of r.catchUpFlash) this.flashes.set(k, { start: this.time, k: 0.5 });
    if (r.catchUpFlash.size) this.flashUntil = Math.max(this.flashUntil, this.time + FLASH_S);
    this.writeNodes();
    this.requestRender();
  }

  /** Ease (0.9 s) so the node sits front-centre at 0.85× home distance; snaps under reduced motion. */
  flyTo(key: string) {
    const r = this.rt.get(key);
    if (!r) return;
    const d = r.dir;
    this.finishIntro();
    this.orbit.easeTo({ yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1]))), dist: this.homeDist * 0.85 }, 0.9);
    this.requestRender();
  }

  resetCamera() {
    this.orbit.reset();
    this.requestRender();
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.orbit.setReducedMotion(reduced);
    this.ringMat.uniforms.uMotion.value = reduced ? 0 : 1;
    if (reduced) this.finishIntro();
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unbindEvents();
    this.orbit.dispose();
    this.labels.dispose();
    this.disposeScene();
    this.scene.clear();
    this.renderer.dispose();
    // after unbindEvents(): the resulting webglcontextlost must not trigger the 2D fallback
    this.renderer.forceContextLoss();
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
    if (window.__constellation && this.debugToken === window.__constellation) delete window.__constellation;
  }

  // ── internals ──

  protected disposeScene() {
    this.ribbons.dispose();
    this.stars.geometry.dispose();
    this.starMat.dispose();
    this.shell.geometry.dispose();
    this.shellMat.dispose();
    this.nodes.geometry.dispose();
    this.nodeMat.dispose();
    this.rings.geometry.dispose();
    this.ringMat.dispose();
  }

  protected startIntro() {
    if (this.reduced) return;
    this.introOn = true;
    this.introT = 0;
    this.orbit.setCurrent(introState(0, { reduced: false, home: this.homePose() }).pose);
  }

  private homePose() { return { ...HOME, dist: this.homeDist }; }

  protected finishIntro() {
    this.introOn = false;
    this.introT = 99;
    this.nodeMat.uniforms.uIntroT.value = 99;
  }

  protected isHidden(key: string): boolean {
    const r = this.rt.get(key);
    return !!r && r.kind === 'node' && this.view.hideHostNodes;
  }

  /** dim factor for focus / selection; 1 = full */
  protected dimOf(key: string): number {
    const f = this.view.focus;
    if (f.size > 0 && !f.has(key)) return DIM_UNFOCUSED;
    return 1;
  }

  /** Rewrite every node + ring attribute from graph + view (data changes only). */
  protected writeNodes() {
    const g = this.graph;
    if (!g) return;
    const byKey = new Map(g.nodes.map(n => [n.key, n]));
    const na = this.nodeAttr, ra = this.ringAttr;
    const now = g.now;
    let i = 0;
    for (const key of this.order) {
      const n = byKey.get(key);
      const r = this.rt.get(key);
      if (!n || !r) continue;
      const hex = n.kind === 'node' ? NODE_COLOR : oracleColor(n.key);
      const [cr, cg, cb] = hexToRgb01(hex);
      const hidden = this.isHidden(key);
      const dim = this.dimOf(key);
      const size = nodeSizePx(n.activity);
      na.position.setXYZ(i, r.dir[0] * SHELL_R, r.dir[1] * SHELL_R, r.dir[2] * SHELL_R);
      na.aColor.setXYZ(i, cr, cg, cb);
      na.aSize.setX(i, size);
      // hollow host node: no core disc, the ring draws it
      na.aAlpha.setX(i, hidden || n.kind === 'node' ? 0 : (0.45 + 0.55 * n.heat) * dim);
      na.aHot.setX(i, now - n.lastTs < HOT_MS ? 0.6 : 0.15 * n.heat);
      na.aRank.setX(i, i);
      ra.aColor.setXYZ(i, cr, cg, cb);
      ra.aSize.setX(i, size);
      ra.aAlpha.setX(i, hidden ? 0 : dim);
      ra.aFlags.setXYZW(i, this.view.selected === key ? 1 : 0, now - n.lastTs < HOT_MS ? 1 : 0, n.kind === 'node' ? 1 : 0, this.newRing.has(key) ? 1 : 0);
      const fl = this.flashes.get(key);
      ra.aFlash.setXY(i, fl ? fl.start : 0, fl ? fl.k : 0);
      i++;
    }
    this.nodes.geometry.setDrawRange(0, i);
    this.rings.geometry.setDrawRange(0, i);
    this.nodeMat.uniforms.uStagger.value = igniteStagger(i);
    for (const a of Object.values(na)) a.needsUpdate = true;
    for (const a of Object.values(ra)) a.needsUpdate = true;
  }

  private colorOf(key: string): [number, number, number] {
    const r = this.rt.get(key);
    return hexToRgb01(r?.kind === 'node' ? NODE_COLOR : oracleColor(key));
  }

  private curveOf(a: string, b: string): [Vec3, Vec3, Vec3] {
    const da = this.rt.get(a)!.dir, db = this.rt.get(b)!.dir;
    const from: Vec3 = [da[0] * SHELL_R, da[1] * SHELL_R, da[2] * SHELL_R];
    const to: Vec3 = [db[0] * SHELL_R, db[1] * SHELL_R, db[2] * SHELL_R];
    return [from, to, arcControl(from, to, SHELL_R)];
  }

  /** Rebuild every ribbon instance from graph + view (data changes only). */
  protected writeRibbons() {
    const g = this.graph;
    if (!g) return;
    const list = g.edges.filter(e => this.rt.has(e.a) && this.rt.has(e.b) && !this.isHidden(e.a) && !this.isHidden(e.b));
    this.ribbons.ensure(list.length);
    this.edgeIdx.clear();
    list.forEach((e, i) => {
      this.edgeIdx.set(e.key, i);
      let ring = this.fireRings.get(e.key);
      if (!ring) { ring = newFireRing(); this.fireRings.set(e.key, ring); }
      const [from, to, ctrl] = this.curveOf(e.a, e.b);
      this.ribbons.write(i, {
        from, to, ctrl,
        width: edgeWidthPx(e.count),
        colA: this.colorOf(e.a),
        colB: this.colorOf(e.b),
        heat: e.heat,
        share: e.count > 0 ? e.countAB / e.count : 0.5,
        fire: packFire(ring),
        dim: edgeDim(e, this.view.focus, this.view.selected),
      });
    });
    this.edgeList = list;
    this.ribbons.commit(list.length);
  }

  /** Endpoints moved (slot slerp): re-upload the curve attributes only. */
  private moveRibbons() {
    this.edgeList.forEach((e, i) => {
      const [from, to, ctrl] = this.curveOf(e.a, e.b);
      this.ribbons.patch(i, 'aFrom', from);
      this.ribbons.patch(i, 'aTo', to);
      this.ribbons.patch(i, 'aCtrl', ctrl);
    });
  }

  private applyFires(fires: readonly Fire[]) {
    for (const f of fires) {
      const i = this.edgeIdx.get(f.edge);
      const ring = this.fireRings.get(f.edge);
      if (i === undefined || !ring) continue;
      pushFire(ring, f.at, f.dir);
      this.ribbons.patch(i, 'aFire', packFire(ring));
      const e = this.edgeList[i];
      const [from, to] = this.curveOf(e.a, e.b);
      const dur = pulseDuration(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]));
      this.arrivals.push({ key: f.to, at: f.at + dur });
      this.pulseUntil = Math.max(this.pulseUntil, f.at + dur * 1.25);
    }
  }

  /** Pulse heads reaching their receiver → 400 ms flash ring. */
  private stepArrivals() {
    if (this.arrivals.length === 0) return;
    let changed = false;
    this.arrivals = this.arrivals.filter(a => {
      if (a.at > this.time) return true;
      this.flashes.set(a.key, { start: this.time, k: 1 });
      this.flashUntil = Math.max(this.flashUntil, this.time + FLASH_S);
      changed = true;
      return false;
    });
    if (changed) this.writeNodes();
  }

  /** Advance slot slerps; returns true while any node is moving. */
  protected stepSlots(now: number): boolean {
    let moving = false;
    let i = 0;
    const pos = this.nodeAttr.position;
    for (const key of this.order) {
      const r = this.rt.get(key);
      if (!r) continue;
      if (r.moveStart >= 0) {
        const k = Math.min(1, (now - r.moveStart) / SLOT_MOVE_MS);
        r.dir = slerpUnit(r.from, r.to, easeInOut(k));
        if (k >= 1) { r.dir = r.to; r.moveStart = -1; } else moving = true;
        pos.setXYZ(i, r.dir[0] * SHELL_R, r.dir[1] * SHELL_R, r.dir[2] * SHELL_R);
        pos.needsUpdate = true;
      }
      i++;
    }
    return moving;
  }

  protected fitDistance(): number {
    // keep the shell + outward arcs (~1.2 R) inside the shorter side
    const aspect = this.width / this.height;
    return Math.min(40, Math.max(18, HOME.dist / Math.min(1, aspect) ** 0.8));
  }

  protected applyCamera() {
    const { yaw, pitch, dist } = this.orbit.cur;
    const cp = Math.cos(pitch);
    this.camera.position.set(Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    // view-space z of the shell centre, for back-hemisphere fades
    const cz = -dist;
    this.nodeMat.uniforms.uCenterZ.value = cz;
    this.nodeMat.uniforms.uRefDist.value = this.homeDist;
  }

  /** Camera easing / damping. Returns true while the camera moves. */
  protected stepCamera(dt: number): boolean {
    return this.orbit.step(dt, this.time);
  }

  /** Labels follow the camera or the data; skipped on pulse-only frames. */
  protected afterFrame(): void {
    if (this.poseChanged() || this.labelsDirty) {
      this.labelsDirty = false;
      this.layoutLabels();
    }
  }

  private poseChanged(): boolean {
    const p = this.camera.position;
    const now = [p.x, p.y, p.z, this.width, this.height];
    const k = this.poseKey;
    let changed = k.length !== now.length;
    if (!changed) for (let i = 0; i < now.length; i++) if (k[i] !== now[i]) { changed = true; break; }
    if (changed) this.poseKey = now;
    return changed;
  }

  /** CSS px of a world point; NaN when behind the camera. */
  private project(x: number, y: number, z: number): [number, number] {
    const v = this.tmpV.set(x, y, z).project(this.camera);
    if (!(v.z > -1 && v.z < 1)) return [NaN, NaN];
    return [(v.x + 1) * 0.5 * this.width, (1 - v.y) * 0.5 * this.height];
  }

  private camDir(): Vec3 {
    const p = this.camera.position;
    const l = Math.hypot(p.x, p.y, p.z) || 1;
    return [p.x / l, p.y / l, p.z / l];
  }

  private screenNodes(): ScreenNode[] {
    const byKey = new Map(this.graph?.nodes.map(n => [n.key, n]) ?? []);
    const cd = this.camDir();
    return this.order.map(key => {
      const r = this.rt.get(key)!;
      const [x, y] = this.project(r.dir[0] * SHELL_R, r.dir[1] * SHELL_R, r.dir[2] * SHELL_R);
      const d = r.dir[0] * cd[0] + r.dir[1] * cd[1] + r.dir[2] * cd[2];
      const n = byKey.get(key);
      return { x, y, r: nodeSizePx(n?.activity ?? 0) / 2, visible: !this.isHidden(key) && !backside(d) };
    });
  }

  private layoutLabels() {
    const g = this.graph;
    if (!g) return;
    const keys = chooseLabels(this.order, this.view.selected, this.hovered);
    const cd = this.camDir();
    const byKey = new Map(g.nodes.map(n => [n.key, n]));
    const items: LabelItem[] = keys.map(key => {
      const r = this.rt.get(key)!;
      const n = byKey.get(key)!;
      const d = r.dir[0] * cd[0] + r.dir[1] * cd[1] + r.dir[2] * cd[2];
      const [x, y] = backside(d) || this.isHidden(key) ? [NaN, NaN] : this.project(r.dir[0] * SHELL_R, r.dir[1] * SHELL_R, r.dir[2] * SHELL_R);
      const hex = n.kind === 'node' ? NODE_COLOR : oracleColor(key);
      return {
        key,
        text: n.kind === 'node' ? `${n.label} · node` : n.label,
        color: `${hex}cc`,
        x,
        y: y - nodeSizePx(n.activity) / 2 - 4,
        priority: labelPriority(key, this.order.indexOf(key), this.view.selected, this.hovered),
      };
    });
    this.labels.update(items, this.width, this.height);
  }

  private onTap = (x: number, y: number) => {
    const i = pickNode(x, y, this.screenNodes());
    this.cb.onSelect(i >= 0 ? this.order[i] : null);
  };

  private onHoverAt = (x: number, y: number) => {
    let h: HoverInfo | null = null;
    if (Number.isFinite(x)) {
      const i = pickNode(x, y, this.screenNodes());
      if (i >= 0) h = { kind: 'node', key: this.order[i], x, y };
      else {
        const samples = this.edgeList.map(e => {
          const [from, to, ctrl] = this.curveOf(e.a, e.b);
          return bezierSamples(from, ctrl, to).map(p => this.project(p[0], p[1], p[2]));
        });
        const j = pickEdge(x, y, samples);
        if (j >= 0) h = { kind: 'edge', key: this.edgeList[j].key, x, y };
      }
    }
    const nodeKey = h?.kind === 'node' ? h.key : null;
    if (nodeKey !== this.hovered) { this.hovered = nodeKey; this.labelsDirty = true; this.requestRender(); }
    this.renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
    this.cb.onHover(h);
  };

  private onInput = () => {
    this.lastInputAt = performance.now();
    this.finishIntro();
  };

  /** A pulse head, a pending arrival or a flash ring is on screen. */
  protected pulsesLive(): boolean {
    return this.time < this.pulseUntil || this.time < this.flashUntil || this.arrivals.length > 0;
  }

  /** Idle drift (C-D8): 8 s without input, nothing selected, not reduced motion, intro over. */
  protected driftAllowed(): boolean {
    return !this.introOn && driftOn(performance.now() - this.lastInputAt, this.view.selected != null, this.reduced);
  }

  requestRender = () => {
    if (this.disposed || this.raf || !this.visible || !this.pageShown || !this.onScreen) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frameLoop);
  };

  private frameLoop = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.visible || !this.pageShown || !this.onScreen) return;
    const dt = clampDt(now - this.last);
    this.last = now;
    this.time += dt;

    let draw = 1;
    if (this.introOn) {
      this.introT += dt;
      this.nodeMat.uniforms.uIntroT.value = this.introT;
      const f = introState(this.introT, { reduced: this.reduced, home: this.homePose() });
      if (f.dolly < 1) this.orbit.setCurrent(f.pose);
      draw = f.ribbons;
      if (this.introT >= INTRO_END_S) this.finishIntro();
    } else if (this.driftAllowed()) {
      this.orbit.drift(DRIFT_RAD_S * dt);
    }
    const slerp = this.stepSlots(now);
    if (slerp) this.moveRibbons();
    this.stepArrivals();
    const easing = this.stepCamera(dt);
    this.applyCamera();
    this.ringMat.uniforms.uTime.value = this.time;
    this.ribbons.setUniforms({
      time: this.time,
      draw,
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      centerZ: -this.orbit.cur.dist,
    });
    if (slerp) this.labelsDirty = true;
    this.afterFrame();

    this.renderer.render(this.scene, this.camera);
    this.framesRendered++;

    if (keepAlive({
      reduced: this.reduced, intro: this.introOn, pulses: this.pulsesLive(), slerp, easing,
      drift: this.driftAllowed(), selected: this.view.selected != null, bench: now < this.benchUntil,
    })) {
      this.raf = requestAnimationFrame(this.frameLoop);
    }
  };

  private stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    // immediate fallback, no grace period (errata)
    this.cb.onContextLost();
  };

  private onVisibility = (visible: boolean) => {
    this.visible = visible;
    if (visible) this.requestRender(); else this.stop();
  };

  private onScreenChange = (onScreen: boolean) => {
    this.onScreen = onScreen;
    if (onScreen) this.requestRender(); else this.stop();
  };

  // pagehide is not covered by the shared render gate (Q1): local listener
  private onPageHide = () => { this.pageShown = false; this.stop(); };
  private onPageShow = () => { this.pageShown = true; this.visible = !document.hidden; this.requestRender(); };

  protected onResize = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = cappedPixelRatio();
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w; this.height = h; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.homeDist = this.fitDistance();
    this.orbit.setHome({ ...HOME, dist: this.homeDist });
    this.labelsDirty = true;
    this.starMat.uniforms.uPixelRatio.value = pr;
    this.nodeMat.uniforms.uPixelRatio.value = pr;
    this.onResized();
    this.requestRender();
  };

  /** Subclass hook: pixel ratio / size changed. */
  protected onResized(): void {}

  protected bindEvents() {
    const c = this.renderer.domElement;
    c.addEventListener('webglcontextlost', this.onContextLost);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(this.container);
    } else {
      window.addEventListener('resize', this.onResize);
    }
    this.unbindGate = bindRenderGate(this.container, { onVisibility: this.onVisibility, onScreen: this.onScreenChange });
  }

  protected unbindEvents() {
    const c = this.renderer.domElement;
    c.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    this.unbindGate?.();
    this.ro = null;
    this.unbindGate = null;
  }

  // ── verify hook for the gated browser batch (T16) ──

  private debugToken: Window['__constellation'] | undefined;

  protected extraInfo(): Record<string, number> { return {}; }

  private exposeDebug() {
    const info = () => {
      const r = this.renderer.info;
      return {
        calls: r.render.calls,
        points: r.render.points,
        triangles: r.render.triangles,
        geometries: r.memory.geometries,
        textures: r.memory.textures,
        nodes: this.order.length,
        edges: this.edgeList.length,
        drawCallBudget: drawCallBudget(this.phone),
        pixelRatio: this.pixelRatio,
        reducedMotion: this.reduced ? 1 : 0,
        framesRendered: this.framesRendered,
        looping: this.raf ? 1 : 0,
        ...this.extraInfo(),
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
    window.__constellation = this.debugToken;
  }
}
