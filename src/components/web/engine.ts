// Knowledge Web — three.js engine (plain three, no R3F/drei/postprocessing).
//
// Draw calls per frame, independent of data size (≤ 10):
//   backdrop · cluster cores · stars · halo   (this file, T9)
//   inter ribbons · inter pulses · chunk motes (T10)
//   intra lines · intra pulses                 (T11)
//
// Every animated value lives in a vertex shader (components/web/shaders.ts); the CPU
// sets uniforms, and re-projects labels / the pick grid only when the camera pose
// changes. Loop (lib/web/loop-state.ts): continuous while motion is on and the view
// is visible + on screen (30 fps idle cap on phones), on demand under reduced motion,
// stopped when hidden. One renderer per page; dispose() frees it (iOS caps contexts).

import * as THREE from 'three';
import { bindRenderGate, GLOW_POINT_FRAG } from '../../lib/three';
import { createBackdrop } from '../../lib/three/backdrop';
import type { GpuTier } from '../../lib/three/gpu-tier';
import { BUDGETS, Governor, effectiveDpr } from '../../lib/web/budget';
import type { TierBudget } from '../../lib/web/budget';
import { loopShouldRun, targetFps, frameDue, wrapClock } from '../../lib/web/loop-state';
import { debugInfo } from '../../lib/web/debug';
import type { DebugInfo } from '../../lib/web/debug';
import {
  createRig, stepRig, snapRig, rigPosition, orbitGoal, pinchGoal, panGoal, worldPerPx, wheelFactor,
  isDoubleTap, clampDist, TAP_SLOP_PX, cdsTween, springSettled, DRILL_OMEGA,
} from '../../lib/web/camera';
import type { Spring } from '../../lib/web/camera';
import type { Rig, Vec3 } from '../../lib/web/camera';
import { fitSphereDistance, frameBounds, frameDistance } from '../../lib/galaxy/frame';
import { ScreenGrid, projectPoints } from '../../lib/galaxy/pick-grid';
import { DRILL_SCALE } from '../../lib/web/layout';
import type { WebScene } from '../../lib/web/scene';
import { starWorldPos, starWorldPositions, starsOf } from '../../lib/web/scene';
import { buildArcs, buildPulses, ribbonStrip, arcPolyline, buildIntraSegments, buildIntraPulses } from '../../lib/web/arcs';
import type { ArcEdge, ArcSet, PulseSet, IntraSegments } from '../../lib/web/arcs';
import type { IntraResult } from '../../lib/web/intra';
import { pickArc, pickCore, projectedRadius, STAR_PICK_MOUSE, STAR_PICK_TOUCH, ARC_PICK_PX } from '../../lib/web/pick';
import type { ScreenPolyline } from '../../lib/web/pick';
import { drillDrawRange, overviewDrawCount } from '../../lib/web/motes';
import type { MoteBuffers, MoteSource } from '../../lib/web/motes';
import {
  STAR_VERT, CORE_VERT, HALO_VERT, HALO_FRAG, RIBBON_VERT, LINE_FRAG, PULSE_VERT, MOTE_VERT, INTRA_LINE_VERT, INTRA_PULSE_VERT,
} from './shaders';

export const WEB_FOV = 50;
export const STAR_WORLD_SIZE = 0.17;
const MIN_DIST = 1.2;
const INTRO_MS = 1600;

/** What a tap / hover / keyboard selection points at. */
export type ArmTarget =
  | { kind: 'star'; index: number }
  | { kind: 'cluster'; index: number }
  | { kind: 'edge'; index: number };

/** A cluster's label anchor in CSS px (bottom-centre), emitted when the camera pose changes. */
export interface LabelAnchor { cluster: number; x: number; y: number; ok: boolean; radiusPx: number; depth: number }

export interface WebEngineCallbacks {
  /** armed target changed (null = cleared); touch → the UI shows "tap again" hints */
  onArm: (t: ArmTarget | null, touch: boolean) => void;
  /** second tap on an armed star */
  onOpenStar: (index: number) => void;
  /** second tap / double-tap on a cluster */
  onEnterCluster: (cluster: number) => void;
  /** double-tap on empty space */
  onHome: () => void;
  /** cluster label anchors after a pose change (CSS px) */
  onPose: (anchors: LabelAnchor[]) => void;
  onContextLost: () => void;
}

export interface WebEngineOptions {
  reducedMotion: boolean;
  tier: GpuTier;
}

/** Everything the engine draws, prepared off the GPU (lib/web). */
export interface WebEngineData {
  scene: WebScene;
  /** inter-cluster links in InterResult order — instance i is edge i everywhere in the UI */
  edges: readonly ArcEdge[];
  motes: MoteBuffers | null;
  moteSource: MoteSource;
}

type U = { value: number };

declare global {
  interface Window {
    __web?: {
      info: () => DebugInfo;
      bench: (ms?: number) => Promise<{ fps: number; frames: number; calls: number }>;
    };
  }
}

export class WebEngine {
  protected container: HTMLElement;
  protected sc: WebScene;
  protected cb: WebEngineCallbacks;
  protected reduced: boolean;
  protected tier: GpuTier;
  protected budget: TierBudget;
  protected governor = new Governor();

  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  protected width = 1;
  protected height = 1;
  protected pixelRatio = 1;

  /** Shared uniform objects: every material references the same {value} boxes. */
  protected U = {
    uTime: { value: 0 } as U,
    uMotion: { value: 1 } as U,
    uDrill: { value: 0 } as U,
    uDrillCluster: { value: -1 } as U,
    uDrillScale: { value: DRILL_SCALE } as U,
    uPixelRatio: { value: 1 } as U,
    uScale: { value: 1 } as U,
    uStarSize: { value: STAR_WORLD_SIZE } as U,
    uClampPx: { value: 46 } as U,
    uIntro: { value: 1 } as U,
    uFocusCluster: { value: -1 } as U,
    uFocusEdge: { value: -1 } as U,
    uLinkAlpha: { value: 1 } as U,
    uViewport: { value: new THREE.Vector2(1, 1) },
    uMoteAlpha: { value: 0.5 } as U,
    uMoteColor: { value: new THREE.Color(0.78, 0.86, 1.0) },
    uLinkColor: { value: new THREE.Color(0.6, 0.75, 1.0) },
    uHasFocus: { value: 0 } as U,
  };

  protected stars: THREE.Points;
  protected starMat: THREE.ShaderMaterial;
  protected states: Float32Array;
  protected stateAttr: THREE.BufferAttribute;
  protected cores: THREE.Points;
  protected coreMat: THREE.ShaderMaterial;
  protected coreMetaAttr: THREE.BufferAttribute;
  protected halo: THREE.Points;
  protected haloMat: THREE.ShaderMaterial;
  protected backdrop: THREE.Points;
  protected backdropMat: THREE.ShaderMaterial;

  // links (T10): instanced ribbons + flowing pulses
  protected arcs: ArcSet;
  protected edges: readonly ArcEdge[];
  protected ribbons: THREE.Mesh;
  protected pulseSet: PulseSet;
  protected pulses: THREE.Points;
  // chunk motes (T10): one attribute set, two draw orders
  protected moteData: MoteBuffers | null;
  protected moteSource: MoteSource;
  protected motesOverview: THREE.Points | null = null;
  protected motesDrill: THREE.Points | null = null;
  protected moteMat: THREE.ShaderMaterial | null = null;

  // drill (T11): spring-driven morph, intra links of the drilled cluster
  protected drillSpring: Spring = { x: 0, v: 0 };
  protected drillTarget = 0;
  protected drillCluster = -1;
  protected pendingDrill: number | null = null;
  protected intra: IntraResult | null = null;
  protected intraVector: { star: number; stars: number[] } | null = null;
  protected intraSeg: IntraSegments | null = null;
  protected intraLines: THREE.LineSegments | null = null;
  protected intraPulses: THREE.Points | null = null;
  protected intraPulseCount = 0;
  protected intraLineMat: THREE.ShaderMaterial;
  protected intraPulseMat: THREE.ShaderMaterial;

  // picking (T11): projections refreshed only when the pose or the morph changes
  protected grid = new ScreenGrid(32);
  protected pickDirty = true;
  protected starPos: Float32Array;
  protected projX: Float32Array;
  protected projY: Float32Array;
  protected projZ: Float32Array;
  protected coreX: Float32Array;
  protected coreY: Float32Array;
  protected coreZ: Float32Array;
  protected coreR: Float32Array;
  protected arcWorld: Float32Array[] = [];
  protected arcScreen: ScreenPolyline[] = [];

  // camera
  protected rig: Rig;
  protected home = { target: [0, 0, 0] as Vec3, dist: 40, yaw: 0, pitch: 0.32 };
  protected poseKey: number[] = [];
  protected tmpV = new THREE.Vector3();
  protected vp = new THREE.Matrix4();

  // loop
  protected raf = 0;
  protected lastFrame = 0;
  protected lastRender = 0;
  protected clock = 0;
  protected intro = 1;
  protected introStart = -1;
  protected visible = typeof document === 'undefined' ? true : !document.hidden;
  protected onScreen = true;
  protected contextLost = false;
  protected interacting = false;
  protected benchUntil = 0;
  protected framesRendered = 0;
  protected disposed = false;
  protected fps = 60;

  // selection
  protected armed: ArmTarget | null = null;
  protected selectedStar = -1;

  // pointers
  protected pointers = new Map<number, { x: number; y: number }>();
  protected down = { x: 0, y: 0, yaw: 0, pitch: 0, target: [0, 0, 0] as Vec3, dragged: false, multi: false, pan: false };
  protected pinch = { spread0: 1, dist0: 40, mx0: 0, my0: 0, target0: [0, 0, 0] as Vec3 };
  protected lastTap: { t: number; x: number; y: number } | null = null;

  protected unbindGate: (() => void) | null = null;
  protected ro: ResizeObserver | null = null;
  protected debugToken: Window['__web'] | undefined;

  constructor(container: HTMLElement, data: WebEngineData, cb: WebEngineCallbacks, opts: WebEngineOptions) {
    const sc = data.scene;
    this.container = container;
    this.sc = sc;
    this.edges = data.edges;
    this.moteData = data.motes;
    this.moteSource = data.moteSource;
    this.cb = cb;
    this.reduced = opts.reducedMotion;
    this.tier = opts.tier;
    this.budget = BUDGETS[opts.tier];
    this.states = new Float32Array(sc.n);

    this.width = Math.max(1, container.clientWidth);
    this.height = Math.max(1, container.clientHeight);
    this.pixelRatio = effectiveDpr(window.devicePixelRatio || 1, this.budget, this.governor.state);
    this.starPos = new Float32Array(sc.n * 3);
    this.projX = new Float32Array(sc.n);
    this.projY = new Float32Array(sc.n);
    this.projZ = new Float32Array(sc.n);
    this.coreX = new Float32Array(sc.C);
    this.coreY = new Float32Array(sc.C);
    this.coreZ = new Float32Array(sc.C);
    this.coreR = new Float32Array(sc.C);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Knowledge Web: ${sc.C} nodes (one per cluster), ${data.edges.length} links, ${sc.n.toLocaleString('en-US')} files`);
    canvas.setAttribute('aria-describedby', 'web-list-summary');
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(WEB_FOV, this.width / this.height, 0.05, 2000);
    this.U.uMotion.value = this.reduced ? 0 : 1;
    this.U.uClampPx.value = this.budget.starClampPx;

    // ── stars: ONE Points for every file ──
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('aCentre', new THREE.BufferAttribute(sc.starCentre, 3));
    sg.setAttribute('aOff', new THREE.BufferAttribute(sc.starOff, 3));
    sg.setAttribute('aMeta', new THREE.BufferAttribute(sc.starMeta, 4));
    sg.setAttribute('aColor', new THREE.BufferAttribute(sc.starColor, 3));
    this.stateAttr = new THREE.BufferAttribute(this.states, 1);
    this.stateAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aState', this.stateAttr);
    // three needs a `position` attribute to know the vertex count; the shader ignores it
    sg.setAttribute('position', new THREE.BufferAttribute(sc.starCentre, 3));
    this.starMat = this.pointsMaterial(STAR_VERT);
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 4;
    this.scene.add(this.stars);

    // ── cluster cores (one soft heart per cluster) ──
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(sc.centres, 3));
    cg.setAttribute('aColor', new THREE.BufferAttribute(sc.coreColor, 3));
    this.coreMetaAttr = new THREE.BufferAttribute(sc.coreMeta, 4);
    this.coreMetaAttr.setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('aMeta', this.coreMetaAttr);
    this.coreMat = this.pointsMaterial(CORE_VERT);
    this.cores = new THREE.Points(cg, this.coreMat);
    this.cores.frustumCulled = false;
    this.cores.renderOrder = 1;
    this.scene.add(this.cores);

    // ── halo: slot 0 armed star, slot 1 selected star ──
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    hg.setAttribute('aCentre', new THREE.BufferAttribute(new Float32Array(6), 3));
    hg.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(6), 3));
    hg.setAttribute('aMeta', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 0, 1, 1]), 4));
    hg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(6), 3));
    hg.setAttribute('aActive', new THREE.BufferAttribute(new Float32Array(2), 1));
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: this.U,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.halo = new THREE.Points(hg, this.haloMat);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 9;
    this.scene.add(this.halo);

    // ── backdrop (shared with Knowledge Galaxy) ──
    const bd = createBackdrop(this.pixelRatio);
    this.backdrop = bd.points;
    this.backdropMat = bd.material;
    this.scene.add(this.backdrop);

    // ── inter-cluster links: ONE instanced ribbon mesh + ONE pulse Points ──
    const b0 = sc.bounds;
    this.arcs = buildArcs(this.edges, sc.centres, sc.coreColor, sc.unsorted, [b0.cx, b0.cy, b0.cz]);
    this.ribbons = this.buildRibbons(this.arcs);
    this.scene.add(this.ribbons);
    this.pulseSet = buildPulses(this.arcs, this.edges, this.tier, this.budget.interPulses);
    this.pulses = this.buildPulsePoints(this.pulseSet);
    this.scene.add(this.pulses);

    // ── chunk motes (A5): overview = global permutation, drill = cluster slice ──
    if (this.moteData && this.moteData.count > 0) this.buildMotes(this.moteData);

    // ── intra links (drill only): materials now, geometry when the worker answers ──
    this.intraLineMat = new THREE.ShaderMaterial({
      vertexShader: INTRA_LINE_VERT, fragmentShader: LINE_FRAG, uniforms: this.U,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.intraPulseMat = this.pointsMaterial(INTRA_PULSE_VERT);
    this.arcWorld = this.edges.map((_, e) => arcPolyline(this.arcs, e));
    this.arcScreen = this.arcWorld.map(w => ({ xs: new Float32Array(w.length / 3), ys: new Float32Array(w.length / 3) }));
    this.applyBudgets();

    // ── camera home: fit the laid-out web ──
    const b = sc.bounds;
    this.home.target = [b.cx, b.cy, b.cz];
    this.rig = createRig({ dist: 40, target: this.home.target, yaw: this.home.yaw, pitch: this.home.pitch, minDist: MIN_DIST, maxDist: 400 });
    this.home.dist = this.fitHomeDistance();
    this.rig.maxDist = Math.max(60, this.home.dist * 3);
    this.goHome(true);
    if (!this.reduced && sc.n > 0) {
      // eased intro: swing in from afar while the stars fade up
      this.rig.dist.cur = this.home.dist * 2.2;
      this.rig.yaw.cur = -0.9;
      this.rig.pitch.cur = 0.7;
      this.rig.speed = 1.5;
      this.intro = 0;
      this.U.uIntro.value = 0;
    }

    this.applyViewport();
    this.bindEvents();
    this.exposeDebug();
    this.requestRender();
  }

  // ── public API ────────────────────────────────────────────────────────

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.U.uMotion.value = reduced ? 0 : 1;
    if (reduced) { this.finishIntro(); snapRig(this.rig); if (this.drillSpring.x !== this.drillTarget || this.pendingDrill != null) this.finishDrillNow(); }
    if (this.intraPulses) this.intraPulses.visible = !reduced && this.intraPulseCount > 0;
    this.applyBudgets();
    this.requestRender();
  }

  /** Reduced motion turned on mid-morph: land on the target state at once. */
  protected finishDrillNow() {
    if (this.pendingDrill != null) {
      const next = this.pendingDrill;
      this.pendingDrill = null;
      this.drillCluster = -1;
      this.beginDrill(next);
    }
    this.snapDrill();
    this.showMotes(this.drillTarget > 0);
  }

  /** Programmatic arming (list view, keyboard, URL). Does not call onArm back. */
  setArmed(t: ArmTarget | null) {
    this.armed = t;
    this.applySelection();
    this.rebuildIntra();
    this.requestRender();
  }

  /**
   * Enter a cluster (≥ 0) or go back to the overview (-1). Spring morph + camera flight;
   * instant under reduced motion. Switching from one drilled cluster to another goes
   * back out first, then in, so no cloud ever jumps.
   */
  setDrill(cluster: number) {
    const c = cluster >= 0 && cluster < this.sc.C ? cluster : -1;
    if (c === (this.pendingDrill ?? (this.drillTarget > 0 ? this.drillCluster : -1))) return;
    this.finishIntro();
    if (c >= 0 && this.drillCluster >= 0 && this.drillCluster !== c && this.drillSpring.x > 0.02 && !this.reduced) {
      this.pendingDrill = c;
      this.drillTarget = 0;
      this.clearIntra();
      this.requestRender();
      return;
    }
    this.pendingDrill = null;
    if (c >= 0) this.beginDrill(c);
    else {
      this.drillTarget = 0;
      this.clearIntra();
      this.showMotes(false);
      this.goHome();
    }
    if (this.reduced) this.snapDrill();
    this.requestRender();
  }

  /** Intra links for the drilled cluster arrived from the worker (null clears). */
  setIntra(cluster: number, r: IntraResult | null) {
    if (cluster !== this.drillCluster) return;
    this.intra = r;
    this.intraVector = null;
    this.rebuildIntra();
    this.requestRender();
  }

  /** In-cluster /api/similar neighbours of a star: drawn as the dotted vector layer. */
  setVectorNeighbours(star: number, stars: number[]) {
    this.intraVector = { star, stars };
    this.rebuildIntra();
    this.requestRender();
  }

  setFocusEdge(edge: number) {
    this.U.uFocusEdge.value = edge >= 0 && edge < this.arcs.count ? edge : -1;
    this.requestRender();
  }

  get drilledCluster(): number { return this.drillTarget > 0 ? this.drillCluster : -1; }

  setSelectedStar(i: number) {
    this.selectedStar = i >= 0 && i < this.sc.n ? i : -1;
    this.applySelection();
    this.rebuildIntra();
    this.requestRender();
  }

  zoomBy(f: number) {
    this.rig.dist.goal = clampDist(this.rig, this.rig.dist.goal * f);
    if (this.reduced) snapRig(this.rig);
    this.requestRender();
  }

  goHome(immediate = false) {
    if (this.drillTarget > 0 && this.drillCluster >= 0) { this.frameDrilled(); if (immediate || this.reduced) snapRig(this.rig); this.requestRender(); return; }
    this.rig.goalTarget = [...this.home.target] as Vec3;
    this.rig.dist.goal = this.home.dist;
    this.rig.yaw.goal = this.home.yaw;
    this.rig.pitch.goal = this.home.pitch;
    this.rig.speed = 3;
    if (immediate || this.reduced) snapRig(this.rig);
    this.requestRender();
  }

  /** Ease the camera toward a cluster (keyboard focus follows; jump under reduced motion). */
  focusCluster(c: number) {
    if (c < 0 || c >= this.sc.C) return;
    const sc = this.sc;
    this.rig.goalTarget = [sc.centres[c * 3], sc.centres[c * 3 + 1], sc.centres[c * 3 + 2]];
    this.rig.dist.goal = clampDist(this.rig, Math.max(fitSphereDistance(sc.radii[c] * 2.2, WEB_FOV, this.width / this.height), 8));
    this.rig.speed = 2.6;
    this.finishIntro();
    if (this.reduced) snapRig(this.rig);
    this.requestRender();
  }

  /** Ease the camera to a star (jump under reduced motion). */
  flyToStar(i: number) {
    if (i < 0 || i >= this.sc.n) return;
    const p = starWorldPos(this.sc, i, this.U.uDrill.value, this.U.uDrillCluster.value);
    this.rig.goalTarget = [p[0], p[1], p[2]];
    this.rig.dist.goal = clampDist(this.rig, Math.min(this.rig.dist.goal, 6));
    this.rig.speed = 3.2;
    this.finishIntro();
    if (this.reduced) snapRig(this.rig);
    this.requestRender();
  }

  /** CSS-px position of a star / cluster centre on screen (for anchoring cards). */
  screenOf(t: ArmTarget): { x: number; y: number; visible: boolean } {
    let p: number[];
    if (t.kind === 'star') p = starWorldPos(this.sc, t.index, this.U.uDrill.value, this.U.uDrillCluster.value);
    else if (t.kind === 'cluster') p = [this.sc.centres[t.index * 3], this.sc.centres[t.index * 3 + 1], this.sc.centres[t.index * 3 + 2]];
    else return { x: 0, y: 0, visible: false };
    const v = this.tmpV.set(p[0], p[1], p[2]).project(this.camera);
    return { x: (v.x + 1) * 0.5 * this.width, y: (1 - v.y) * 0.5 * this.height, visible: v.z > -1 && v.z < 1 };
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unbindEvents();
    this.disposeObjects();
    this.scene.clear();
    this.renderer.dispose();
    // after unbindEvents(): the resulting webglcontextlost must not trigger the 2D fallback
    this.renderer.forceContextLoss();
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) this.container.removeChild(canvas);
    if (window.__web && this.debugToken === window.__web) delete window.__web;
  }

  // ── building blocks ───────────────────────────────────────────────────

  protected pointsMaterial(vertexShader: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader, fragmentShader: GLOW_POINT_FRAG, uniforms: this.U,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  protected buildRibbons(arcs: ArcSet): THREE.Mesh {
    const strip = ribbonStrip();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strip.t.length * 3), 3));
    g.setAttribute('aT', new THREE.BufferAttribute(strip.t, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(strip.side, 1));
    g.setIndex(new THREE.BufferAttribute(strip.index, 1));
    g.setAttribute('aP0', new THREE.InstancedBufferAttribute(arcs.p0, 3));
    g.setAttribute('aP2', new THREE.InstancedBufferAttribute(arcs.p2, 3));
    g.setAttribute('aCtrl', new THREE.InstancedBufferAttribute(arcs.ctrl, 3));
    g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(arcs.style, 4));
    g.setAttribute('aEnds', new THREE.InstancedBufferAttribute(arcs.ends, 2));
    g.setAttribute('aColA', new THREE.InstancedBufferAttribute(arcs.colA, 3));
    g.setAttribute('aColB', new THREE.InstancedBufferAttribute(arcs.colB, 3));
    g.instanceCount = arcs.count;
    const m = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT, fragmentShader: LINE_FRAG, uniforms: this.U,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = arcs.count > 0;
    return mesh;
  }

  protected buildPulsePoints(p: PulseSet): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.p0, 3));
    g.setAttribute('aP0', new THREE.BufferAttribute(p.p0, 3));
    g.setAttribute('aP2', new THREE.BufferAttribute(p.p2, 3));
    g.setAttribute('aCtrl', new THREE.BufferAttribute(p.ctrl, 3));
    g.setAttribute('aPulse', new THREE.BufferAttribute(p.pulse, 4));
    g.setAttribute('aEnds', new THREE.BufferAttribute(p.ends, 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(p.color, 3));
    const pts = new THREE.Points(g, this.pointsMaterial(PULSE_VERT));
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    return pts;
  }

  protected buildMotes(m: MoteBuffers) {
    const centre = new THREE.BufferAttribute(m.centre, 3);
    const attrs: [string, THREE.BufferAttribute][] = [
      ['position', centre],
      ['aCentre', centre],
      ['aOff', new THREE.BufferAttribute(m.offset, 3)],
      ['aStar', new THREE.BufferAttribute(m.star, 4)],
      ['aOrbit', new THREE.BufferAttribute(m.orbit, 4)],
    ];
    this.moteMat = this.pointsMaterial(MOTE_VERT);
    // overview: indexed by the global seeded permutation → a draw-range prefix is a uniform sample
    const go = new THREE.BufferGeometry();
    for (const [n, a] of attrs) go.setAttribute(n, a);
    go.setIndex(new THREE.BufferAttribute(m.overviewIndex, 1));
    this.motesOverview = new THREE.Points(go, this.moteMat);
    // drill: the same attributes, non-indexed; draw range = the drilled cluster's (shuffled) slice
    const gd = new THREE.BufferGeometry();
    for (const [n, a] of attrs) gd.setAttribute(n, a);
    this.motesDrill = new THREE.Points(gd, this.moteMat);
    for (const p of [this.motesOverview, this.motesDrill]) {
      p.frustumCulled = false;
      p.renderOrder = 5;
      this.scene.add(p);
    }
    this.motesDrill.visible = false;
  }

  /** Tier caps × governor scales → draw ranges and visibility. */
  protected applyBudgets() {
    const g = this.governor.state;
    const pulseCount = Math.min(this.pulseSet.count, Math.floor(this.budget.interPulses * g.pulseScale));
    this.pulses.geometry.setDrawRange(0, pulseCount);
    this.pulses.visible = !this.reduced && pulseCount > 0;
    const m = this.moteData;
    if (m && this.motesOverview && this.motesDrill) {
      this.motesOverview.geometry.setDrawRange(0, overviewDrawCount(m.count, this.budget.motes, g.moteScale));
      const dc = this.U.uDrillCluster.value;
      if (dc >= 0) {
        const r = drillDrawRange(m.slices, dc, this.budget.motes, g.moteScale);
        this.motesDrill.geometry.setDrawRange(r.start, r.count);
      }
    }
  }

  protected beginDrill(c: number) {
    this.drillCluster = c;
    this.drillTarget = 1;
    this.U.uDrillCluster.value = c;
    this.intra = null;
    this.intraVector = null;
    this.clearIntra();
    const col = this.sc.coreColor;
    this.U.uLinkColor.value.setRGB(0.55 * col[c * 3] + 0.45, 0.55 * col[c * 3 + 1] + 0.45, 0.55 * col[c * 3 + 2] + 0.45);
    this.showMotes(true);
    this.applyBudgets();
    this.frameDrilled();
    this.pickDirty = true;
  }

  /** Camera to the drilled cluster's 85th-percentile radius at full expansion. */
  protected frameDrilled() {
    const c = this.drillCluster;
    const idx = starsOf(this.sc, c);
    const pos = starWorldPositions(this.sc, 1, c);
    const b = frameBounds(pos, idx, 0.85);
    if (!b) return;
    this.rig.goalTarget = [b.cx, b.cy, b.cz];
    this.rig.dist.goal = frameDistance({ radius: Math.max(b.radius, 1.5) }, WEB_FOV, this.camera.aspect, { minDist: 2.5, maxDist: this.home.dist });
    this.rig.speed = 2.6;
  }

  protected snapDrill() {
    this.drillSpring = { x: this.drillTarget, v: 0 };
    this.U.uDrill.value = this.drillTarget;
    if (this.drillTarget === 0) { this.drillCluster = -1; this.U.uDrillCluster.value = -1; }
    snapRig(this.rig);
    this.pickDirty = true;
  }

  /** Advance the morph; returns true while it still moves. */
  protected stepDrill(dt: number): boolean {
    if (this.drillCluster < 0 && this.pendingDrill == null) return false;
    const s = cdsTween(this.drillSpring, this.drillTarget, DRILL_OMEGA, dt);
    s.x = Math.max(0, Math.min(1, s.x));
    this.drillSpring = s;
    const settled = springSettled(s, this.drillTarget, 2e-3);
    if (settled) this.drillSpring = { x: this.drillTarget, v: 0 };
    this.U.uDrill.value = this.drillSpring.x;
    this.pickDirty = true;
    if (settled && this.drillTarget === 0) {
      this.drillCluster = -1;
      this.U.uDrillCluster.value = -1;
      if (this.pendingDrill != null) {
        const next = this.pendingDrill;
        this.pendingDrill = null;
        this.beginDrill(next);
        return true;
      }
      this.showMotes(false);
      return false;
    }
    return !settled;
  }

  protected showMotes(drill: boolean) {
    if (!this.motesOverview || !this.motesDrill) return;
    this.motesOverview.visible = !drill;
    this.motesDrill.visible = drill;
  }

  protected clearIntra() {
    this.intraSeg = null;
    this.intraKey = '';
    for (const o of [this.intraLines, this.intraPulses]) {
      if (!o) continue;
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.intraLines = null;
    this.intraPulses = null;
    this.intraPulseCount = 0;
    this.U.uHasFocus.value = 0;
  }

  /** (Re)build the intra layer: capped base links + the armed star's full list + its vector layer. */
  protected intraKey = '';

  protected rebuildIntra() {
    const r = this.intra;
    if (!r || this.drillCluster < 0 || r.cluster !== this.drillCluster) return;
    // the armed star, else the open one: its full link list + vector layer are drawn on top
    const pickFocus = (i: number) => (i >= 0 && this.sc.clusterOf[i] === this.drillCluster ? i : -1);
    const focus = this.armed?.kind === 'star' ? pickFocus(this.armed.index) : pickFocus(this.selectedStar);
    const vector = this.intraVector && this.intraVector.star === focus ? this.intraVector.stars : undefined;
    // hover re-arms often on desktop: rebuild only when what is drawn would change
    const key = `${r.cluster}|${r.edgeI.length}|${focus}|${vector ? vector.join(',') : ''}|${this.budget.intraSegments}|${this.governor.state.pulseScale}`;
    if (this.intraLines && key === this.intraKey) return;
    this.clearIntra();
    this.intraKey = key;
    const seg = buildIntraSegments(r, { cap: this.budget.intraSegments, focusStar: focus, vector });
    this.intraSeg = seg;
    this.U.uHasFocus.value = focus >= 0 ? 1 : 0;
    const sc = this.sc;

    // lines: 2 vertices per segment, both running WEB_POS so they follow the stars
    const n = seg.count * 2;
    const centre = new Float32Array(n * 3), off = new Float32Array(n * 3), meta = new Float32Array(n * 4), link = new Float32Array(n * 3);
    for (let q = 0; q < seg.count; q++) {
      for (let end = 0; end < 2; end++) {
        const star = end === 0 ? seg.i[q] : seg.j[q];
        const v = q * 2 + end;
        centre.set(sc.starCentre.subarray(star * 3, star * 3 + 3), v * 3);
        off.set(sc.starOff.subarray(star * 3, star * 3 + 3), v * 3);
        meta[v * 4] = sc.starMeta[star * 4];
        meta[v * 4 + 1] = sc.starMeta[star * 4 + 1];
        meta[v * 4 + 2] = sc.starMeta[star * 4 + 2];
        meta[v * 4 + 3] = end;
        link[v * 3] = Math.max(0, Math.min(1, (seg.s[q] - 0.12) / 0.6));
        link[v * 3 + 1] = seg.dots[q];
        link[v * 3 + 2] = seg.focus[q];
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(centre, 3));
    lg.setAttribute('aCentre', new THREE.BufferAttribute(centre, 3));
    lg.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
    lg.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
    lg.setAttribute('aLink', new THREE.BufferAttribute(link, 3));
    this.intraLines = new THREE.LineSegments(lg, this.intraLineMat);
    this.intraLines.frustumCulled = false;
    this.intraLines.renderOrder = 3;
    this.scene.add(this.intraLines);

    // pulses on the strongest concept links
    const cap = Math.floor(this.budget.intraPulses * this.governor.state.pulseScale);
    const p = buildIntraPulses(seg, cap);
    const m = p.count;
    const pc = new Float32Array(m * 3), oa = new Float32Array(m * 3), ob = new Float32Array(m * 3), ma = new Float32Array(m * 4), mb = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      const a = p.i[k], b = p.j[k];
      pc.set(sc.starCentre.subarray(a * 3, a * 3 + 3), k * 3);
      oa.set(sc.starOff.subarray(a * 3, a * 3 + 3), k * 3);
      ob.set(sc.starOff.subarray(b * 3, b * 3 + 3), k * 3);
      ma[k * 4] = sc.starMeta[a * 4];
      ma[k * 4 + 1] = sc.starMeta[a * 4 + 1];
      ma[k * 4 + 2] = sc.starMeta[a * 4 + 2];
      ma[k * 4 + 3] = p.speed[k];
      mb[k * 2] = sc.starMeta[b * 4 + 1];
      mb[k * 2 + 1] = p.offset[k];
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pc, 3));
    pg.setAttribute('aCentre', new THREE.BufferAttribute(pc, 3));
    pg.setAttribute('aOffA', new THREE.BufferAttribute(oa, 3));
    pg.setAttribute('aOffB', new THREE.BufferAttribute(ob, 3));
    pg.setAttribute('aMetaA', new THREE.BufferAttribute(ma, 4));
    pg.setAttribute('aMetaB', new THREE.BufferAttribute(mb, 2));
    this.intraPulses = new THREE.Points(pg, this.intraPulseMat);
    this.intraPulses.frustumCulled = false;
    this.intraPulses.renderOrder = 4;
    this.intraPulses.visible = !this.reduced && m > 0;
    this.intraPulseCount = m;
    this.scene.add(this.intraPulses);
  }

  // ── picking ──

  protected refreshPick() {
    if (!this.pickDirty) return;
    this.pickDirty = false;
    this.camera.updateMatrixWorld();
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const m = this.vp.elements, w = this.width, h = this.height, sc = this.sc;
    const dc = this.drillTarget > 0 ? this.drillCluster : -1;
    if (dc >= 0) {
      starWorldPositions(sc, this.U.uDrill.value, dc, this.starPos);
      projectPoints(this.starPos, m, w, h, this.projX, this.projY, this.projZ);
      const co = sc.clusterOf;
      this.grid.build(this.projX, this.projY, this.projZ, w, h, i => co[i] === dc);
      return;
    }
    projectPoints(sc.centres, m, w, h, this.coreX, this.coreY, this.coreZ);
    const cam = this.camera.position;
    for (let c = 0; c < sc.C; c++) {
      const d = Math.hypot(sc.centres[c * 3] - cam.x, sc.centres[c * 3 + 1] - cam.y, sc.centres[c * 3 + 2] - cam.z);
      this.coreR[c] = projectedRadius(sc.radii[c], d, this.U.uScale.value);
    }
    for (let e = 0; e < this.arcWorld.length; e++) {
      const s = this.arcScreen[e];
      projectPoints(this.arcWorld[e], m, w, h, s.xs, s.ys, new Float32Array(s.xs.length));
    }
  }

  protected disposeObjects() {
    this.clearIntra();
    this.intraLineMat.dispose();
    this.intraPulseMat.dispose();
    for (const o of [this.stars, this.cores, this.halo, this.backdrop, this.ribbons, this.pulses]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.motesOverview?.geometry.dispose();
    this.motesDrill?.geometry.dispose();
    this.moteMat?.dispose();
  }

  protected fitHomeDistance(): number {
    const d = fitSphereDistance(this.sc.bounds.radius, WEB_FOV, this.width / this.height, 1.05);
    return Math.max(8, d);
  }

  protected applyViewport() {
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.U.uScale.value = this.height / (2 * Math.tan((WEB_FOV * Math.PI) / 360));
    this.U.uPixelRatio.value = this.pixelRatio;
    this.backdropMat.uniforms.uPixelRatio.value = this.pixelRatio;
    this.U.uViewport.value.set(this.width * this.pixelRatio, this.height * this.pixelRatio);
    this.poseKey = [];
  }

  protected finishIntro() {
    if (this.intro < 1) {
      this.intro = 1;
      this.U.uIntro.value = 1;
      this.backdropMat.uniforms.uIntro.value = 1;
    }
  }

  /** Star states (hot halo targets), core states and link focus from armed/selected. */
  protected applySelection() {
    this.states.fill(0);
    const a = this.armed;
    const armedStar = a?.kind === 'star' ? a.index : -1;
    if (armedStar >= 0) this.states[armedStar] = 2;
    if (this.selectedStar >= 0) this.states[this.selectedStar] = 2;
    this.stateAttr.needsUpdate = true;

    const meta = this.sc.coreMeta;
    for (let c = 0; c < this.sc.C; c++) meta[c * 4 + 2] = a?.kind === 'cluster' && a.index === c ? 2 : 0;
    this.coreMetaAttr.needsUpdate = true;

    this.U.uFocusCluster.value = a?.kind === 'cluster' ? a.index : -1;
    this.U.uFocusEdge.value = a?.kind === 'edge' ? a.index : -1;
    this.writeHalo(0, armedStar === this.selectedStar ? -1 : armedStar);
    this.writeHalo(1, this.selectedStar);
  }

  protected writeHalo(slot: number, i: number) {
    const g = this.halo.geometry;
    const act = g.getAttribute('aActive') as THREE.BufferAttribute;
    if (i < 0) { act.setX(slot, 0); act.needsUpdate = true; return; }
    const sc = this.sc;
    (g.getAttribute('aCentre') as THREE.BufferAttribute).setXYZ(slot, sc.starCentre[i * 3], sc.starCentre[i * 3 + 1], sc.starCentre[i * 3 + 2]);
    (g.getAttribute('aOff') as THREE.BufferAttribute).setXYZ(slot, sc.starOff[i * 3], sc.starOff[i * 3 + 1], sc.starOff[i * 3 + 2]);
    const meta = g.getAttribute('aMeta') as THREE.BufferAttribute;
    meta.setXYZW(slot, sc.starMeta[i * 4], sc.starMeta[i * 4 + 1], sc.starMeta[i * 4 + 2], slot);
    (g.getAttribute('aColor') as THREE.BufferAttribute).setXYZ(slot, sc.starColor[i * 3], sc.starColor[i * 3 + 1], sc.starColor[i * 3 + 2]);
    act.setX(slot, 1);
    for (const n of ['aCentre', 'aOff', 'aMeta', 'aColor', 'aActive']) (g.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  // ── loop ──────────────────────────────────────────────────────────────

  requestRender = () => {
    if (this.disposed || this.raf || !this.visible || !this.onScreen || this.contextLost) return;
    const now = performance.now();
    if (this.lastFrame === 0 || now - this.lastFrame > 250) this.lastFrame = now;
    this.raf = requestAnimationFrame(this.frameLoop);
  };

  /** Per-frame work besides the camera; returns true while something still animates. */
  protected stepExtras(dt: number): boolean {
    const drilling = this.stepDrill(dt);
    this.U.uLinkAlpha.value = 1 - this.U.uDrill.value;
    this.ribbons.visible = this.arcs.count > 0 && this.U.uLinkAlpha.value > 0.003;
    this.pulses.visible = !this.reduced && this.U.uLinkAlpha.value > 0.003 && this.pulses.geometry.drawRange.count > 0;
    return drilling;
  }

  /** Called after the camera pose changed (projections are stale). */
  protected onPoseChanged() {
    this.pickDirty = true;
    this.emitAnchors();
  }

  protected frameLoop = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.visible || !this.onScreen || this.contextLost) return;
    const active = this.interacting || this.rigMoving;
    this.fps = targetFps(this.budget, active);
    if (!frameDue(now, this.lastRender, this.fps) && !this.reduced) {
      this.raf = requestAnimationFrame(this.frameLoop);
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    if (!this.reduced) {
      this.clock += dt;
      this.U.uTime.value = wrapClock(this.clock);
    }

    let introActive = false;
    if (this.intro < 1) {
      if (this.introStart < 0) this.introStart = now;
      const t = Math.min(1, (now - this.introStart) / INTRO_MS);
      this.intro = 1 - Math.pow(1 - t, 3);
      this.U.uIntro.value = this.intro;
      this.backdropMat.uniforms.uIntro.value = this.intro;
      introActive = this.intro < 1;
    }

    const extras = this.stepExtras(dt);
    this.rigMoving = stepRig(this.rig, dt);
    this.applyPose();
    if (this.poseChanged()) this.onPoseChanged();

    this.renderer.render(this.scene, this.camera);
    this.framesRendered++;
    if (!this.reduced && this.lastRender > 0) {
      if (this.governor.sample(now - this.lastRender, 1000 / this.fps)) this.applyGovernor();
    }
    this.lastRender = now;

    const moving = this.rigMoving || extras || introActive;
    if (loopShouldRun({ visible: this.visible, onScreen: this.onScreen, reduced: this.reduced, moving, benching: now < this.benchUntil, contextLost: this.contextLost })) {
      this.raf = requestAnimationFrame(this.frameLoop);
    }
  };

  protected rigMoving = false;

  /** Governor stepped down: re-apply DPR (motes / pulses are scaled by the stage that owns them). */
  protected applyGovernor() {
    this.applyBudgets();
    this.rebuildIntra();
    const pr = effectiveDpr(window.devicePixelRatio || 1, this.budget, this.governor.state);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.width, this.height);
      this.applyViewport();
    }
  }

  protected applyPose() {
    const p = rigPosition(this.rig);
    this.camera.position.set(p[0], p[1], p[2]);
    this.camera.lookAt(this.rig.target[0], this.rig.target[1], this.rig.target[2]);
    this.camera.updateMatrixWorld();
  }

  protected poseChanged(): boolean {
    const p = this.camera.position, t = this.rig.target;
    const now = [p.x, p.y, p.z, t[0], t[1], t[2], this.width, this.height, this.U.uDrill.value];
    const k = this.poseKey;
    let changed = k.length !== now.length;
    if (!changed) for (let i = 0; i < now.length; i++) if (k[i] !== now[i]) { changed = true; break; }
    if (changed) this.poseKey = now;
    return changed;
  }

  protected emitAnchors() {
    const sc = this.sc;
    const out: LabelAnchor[] = new Array(sc.C);
    for (let c = 0; c < sc.C; c++) {
      const R = sc.radii[c];
      const v = this.tmpV.set(sc.centres[c * 3], sc.centres[c * 3 + 1] + R * 1.02, sc.centres[c * 3 + 2]).project(this.camera);
      const ok = v.z > -1 && v.z < 1;
      const dist = this.camera.position.distanceTo(new THREE.Vector3(sc.centres[c * 3], sc.centres[c * 3 + 1], sc.centres[c * 3 + 2]));
      out[c] = {
        cluster: c,
        x: ok ? (v.x + 1) * 0.5 * this.width : NaN,
        y: ok ? (1 - v.y) * 0.5 * this.height : NaN,
        ok,
        radiusPx: (R * this.U.uScale.value) / Math.max(1e-3, dist),
        depth: v.z,
      };
    }
    this.cb.onPose(out);
  }

  // ── picking (stage hooks; T11 fills in clusters, links and stars) ─────

  protected pickAt(x: number, y: number, touch: boolean): ArmTarget | null {
    this.refreshPick();
    if (this.drillTarget > 0 && this.drillCluster >= 0) {
      const i = this.grid.pick(x, y, touch ? STAR_PICK_TOUCH : STAR_PICK_MOUSE);
      return i >= 0 ? { kind: 'star', index: i } : null;
    }
    const c = pickCore(this.coreX, this.coreY, this.coreZ, this.coreR, x, y);
    if (c >= 0) return { kind: 'cluster', index: c };
    const e = pickArc(this.arcScreen, x, y, touch ? ARC_PICK_PX : 10);
    return e >= 0 ? { kind: 'edge', index: e } : null;
  }

  protected sameTarget(a: ArmTarget | null, b: ArmTarget | null): boolean {
    return !!a && !!b && a.kind === b.kind && a.index === b.index;
  }

  protected arm(t: ArmTarget | null, touch: boolean) {
    if (this.sameTarget(t, this.armed) || (!t && !this.armed)) return;
    this.armed = t;
    this.applySelection();
    this.rebuildIntra();
    this.cb.onArm(t, touch);
    this.container.style.cursor = t ? 'pointer' : 'grab';
    this.requestRender();
  }

  protected tap(p: { x: number; y: number }, pointerType: string) {
    const touch = pointerType !== 'mouse';
    const t = this.pickAt(p.x, p.y, touch);
    const now = performance.now();
    const dbl = isDoubleTap(this.lastTap, now, p.x, p.y);
    this.lastTap = dbl ? null : { t: now, x: p.x, y: p.y };
    if (dbl) {
      if (!t) { this.cb.onHome(); return; }
      if (t.kind === 'cluster') { this.cb.onEnterCluster(t.index); return; }
    }
    if (!t) { this.arm(null, touch); return; }
    if (this.sameTarget(t, this.armed)) {
      // second tap on the armed target
      if (t.kind === 'star') this.cb.onOpenStar(t.index);
      else if (t.kind === 'cluster') this.cb.onEnterCluster(t.index);
      return;
    }
    this.arm(t, touch);
  }

  // ── events ────────────────────────────────────────────────────────────

  protected local(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  protected onPointerDown = (e: PointerEvent) => {
    const canvas = this.renderer.domElement;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.interacting = true;
    if (this.pointers.size === 1) {
      this.down = {
        x: p.x, y: p.y, yaw: this.rig.yaw.goal, pitch: this.rig.pitch.goal, target: [...this.rig.goalTarget] as Vec3,
        dragged: false, multi: false, pan: e.button === 2 || e.shiftKey,
      };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        spread0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), dist0: this.rig.dist.goal,
        mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, target0: [...this.rig.goalTarget] as Vec3,
      };
      this.down.multi = true;
      this.down.dragged = true;
    }
    this.finishIntro();
    this.requestRender();
  };

  protected onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        // two fingers: pinch-zoom + midpoint pan
        const [a, b] = [...this.pointers.values()];
        const spread = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.rig.dist.goal = pinchGoal(this.rig, this.pinch.dist0, this.pinch.spread0, spread);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = worldPerPx(this.rig.dist.cur, WEB_FOV, this.height);
        this.rig.goalTarget = panGoal(this.pinch.target0, this.rig.yaw.cur, this.rig.pitch.cur, mx - this.pinch.mx0, my - this.pinch.my0, k);
        this.rig.speed = 12;
        if (this.reduced) snapRig(this.rig);
        this.requestRender();
        return;
      }
      const dx = p.x - this.down.x, dy = p.y - this.down.y;
      if (!this.down.dragged && Math.hypot(dx, dy) > TAP_SLOP_PX) {
        this.down.dragged = true;
        this.container.style.cursor = 'grabbing';
      }
      if (this.down.dragged && !this.down.multi) {
        if (this.down.pan) {
          const k = worldPerPx(this.rig.dist.cur, WEB_FOV, this.height);
          this.rig.goalTarget = panGoal(this.down.target, this.rig.yaw.cur, this.rig.pitch.cur, dx, dy, k);
        } else {
          const g = orbitGoal(this.down, dx, dy);
          this.rig.yaw.goal = g.yaw;
          this.rig.pitch.goal = g.pitch;
        }
        this.rig.speed = 10;
        if (this.reduced) snapRig(this.rig);
        this.requestRender();
      }
      return;
    }
    // desktop hover arms whatever is under the cursor (the peek card shows it); empty space
    // keeps the last target so the card's buttons stay reachable — a click on empty space clears
    if (e.pointerType === 'mouse') {
      const t = this.pickAt(p.x, p.y, false);
      if (t) this.arm(t, false);
    }
  };

  protected onPointerUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.pointers.size === 0) {
      this.interacting = false;
      if (!this.down.dragged && !this.down.multi) this.tap(this.local(e), e.pointerType);
      this.container.style.cursor = this.armed ? 'pointer' : 'grab';
    } else if (this.pointers.size === 1) {
      // lifted one of two fingers: continue as a fresh one-finger orbit, never a tap
      const [q] = [...this.pointers.values()];
      this.down = { x: q.x, y: q.y, yaw: this.rig.yaw.goal, pitch: this.rig.pitch.goal, target: [...this.rig.goalTarget] as Vec3, dragged: true, multi: true, pan: false };
    }
  };

  protected onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.interacting = false;
  };

  protected onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.pointers.size === 0) this.container.style.cursor = this.armed ? 'pointer' : 'grab';
  };

  protected onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(wheelFactor(e.deltaY));
  };

  protected onContextMenu = (e: Event) => e.preventDefault();

  protected onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cb.onContextLost();
  };

  protected onVisibility = (visible: boolean) => {
    this.visible = visible;
    if (visible) this.requestRender();
    else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  };

  protected onScreenChange = (onScreen: boolean) => {
    this.onScreen = onScreen;
    if (onScreen) this.requestRender();
    else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  };

  protected onResize = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = effectiveDpr(window.devicePixelRatio || 1, this.budget, this.governor.state);
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    const wasHome = Math.abs(this.rig.dist.goal - this.home.dist) < 1e-3;
    this.width = w; this.height = h; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.applyViewport();
    this.home.dist = this.fitHomeDistance();
    if (wasHome) this.rig.dist.goal = this.home.dist;
    this.requestRender();
  };

  protected bindEvents() {
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerCancel);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContextMenu);
    c.addEventListener('webglcontextlost', this.onContextLost);
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
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('resize', this.onResize);
    this.ro?.disconnect();
    this.unbindGate?.();
    this.ro = null;
    this.unbindGate = null;
  }

  // ── verify hooks for the gated browser batch ──────────────────────────

  /** Stage-specific counters for info(); later stages extend it. */
  protected counters() {
    const drawn = (p: THREE.Points | null) => (p && p.visible ? Math.min(p.geometry.drawRange.count, this.moteData?.count ?? 0) : 0);
    return {
      interLinks: this.arcs.count,
      pulses: this.pulses.visible ? Math.min(this.pulses.geometry.drawRange.count, this.pulseSet.count) : 0,
      motesTotal: this.moteData?.count ?? 0,
      motesDrawn: drawn(this.motesOverview) + drawn(this.motesDrill),
      intraSegments: this.intraSeg?.count ?? 0,
      intraPulses: this.intraPulses?.visible ? this.intraPulseCount : 0,
      moteSource: this.moteSource,
    };
  }

  protected exposeDebug() {
    const info = () => {
      const r = this.renderer.info;
      return debugInfo({
        renderer: { calls: r.render.calls, points: r.render.points, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures },
        stars: this.sc.n,
        clusters: this.sc.C,
        ...this.counters(),
        pixelRatio: this.pixelRatio,
        tier: this.tier,
        reducedMotion: this.reduced,
        framesRendered: this.framesRendered,
        looping: this.raf !== 0,
        drillCluster: this.U.uDrillCluster.value,
        drill: this.U.uDrill.value,
        fps: this.fps,
        governor: this.governor.state,
      });
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
    window.__web = this.debugToken;
  }
}
