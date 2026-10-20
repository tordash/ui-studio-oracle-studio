// Knowledge Web — GLSL. Glow instead of bloom (no postprocessing, lib/three/shaders.ts).
//
// Every moving thing moves in a vertex shader driven by uniforms: the CPU never
// rewrites positions per frame. All point shaders write the GLOW_POINT_FRAG
// contract (vColor, vAlpha, vHot). WEB_POS is the one place that decides where a
// star is, so stars, their chunk motes, the halo and intra links stay attached
// through drift and the drill morph.
//
// Clock: uTime wraps every TIME_PERIOD (600 s) on the CPU; every rate below is a
// whole number of cycles per period (see lib/web/motes.ts quantize*), so the wrap
// is seamless. uMotion = 0 under prefers-reduced-motion (no drift, no pulses,
// orbits frozen; LOD reveal still applies).

const TAU = '6.28318530718';
// drift: 30, 26, 22 turns per 600 s; cores breathe at 76
const W1 = ((2 * Math.PI * 30) / 600).toFixed(6);
const W2 = ((2 * Math.PI * 26) / 600).toFixed(6);
const W3 = ((2 * Math.PI * 22) / 600).toFixed(6);
const WB = ((2 * Math.PI * 76) / 600).toFixed(6);

/**
 * Shared position chunk. A star's cluster centre + its PCA offset, expanded by
 * uDrillScale while its cluster is the drilled one, + idle drift (≤ 2 % of R).
 */
export const WEB_POS = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uDrill;
  uniform float uDrillCluster;
  uniform float uDrillScale;
  float webIsDrilled(float cluster) {
    return 1.0 - step(0.5, abs(cluster - uDrillCluster));
  }
  // drilled cluster stays at 1, the others fade to 6 % as the morph runs
  float webClusterAlpha(float cluster) {
    return mix(1.0, mix(0.06, 1.0, webIsDrilled(cluster)), uDrill);
  }
  vec3 webStarPos(vec3 centre, vec3 off, float cluster, float phase, float radius) {
    vec3 o = mix(off, off * uDrillScale, uDrill * webIsDrilled(cluster));
    float t = uTime * uMotion;
    float p = phase * ${TAU};
    vec3 drift = vec3(
      sin(t * ${W1} + p),
      sin(t * ${W2} + p * 1.618 + 1.7),
      sin(t * ${W3} + p * 2.414 + 3.1)
    ) * (0.02 * radius * 0.57735);
    return centre + o + drift * uMotion;
  }
`;

/** Stars: one Points for every file. Port of galaxy STAR_VERT (px attenuation, dim/hot, clamp). */
export const STAR_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aCentre;
  attribute vec3 aOff;
  attribute vec4 aMeta;     // cluster, phase, cluster R, brightness
  attribute vec3 aColor;
  attribute float aState;   // 0 normal · 1 dim · 2 hot (armed / selected / related)
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uStarSize;
  uniform float uClampPx;
  uniform float uIntro;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec3 p = webStarPos(aCentre, aOff, aMeta.x, aMeta.y, aMeta.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float vis = webClusterAlpha(aMeta.x);
    float size = 1.0;
    float alpha = aMeta.w;
    float hot = 0.0;
    if (aState > 1.5) { size = 1.9; alpha = 1.0; hot = 0.75; }
    else if (aState > 0.5) { size = 0.75; alpha *= 0.14; }
    float px = size * uStarSize * uScale * uPixelRatio / max(0.001, -mv.z);
    gl_PointSize = clamp(px, 1.6 * uPixelRatio, uClampPx * uPixelRatio) * mix(0.2, 1.0, uIntro) * step(0.004, vis);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = alpha * vis * uIntro;
    vHot = hot;
  }
`;

/** Cluster cores: one soft "nebula heart" per cluster, breathing ±3 %. */
export const CORE_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aColor;
  attribute vec4 aMeta;     // cluster, R, state (0 normal · 1 dim · 2 hot), unsorted flag
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uIntro;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float vis = webClusterAlpha(aMeta.x) * (1.0 - 0.85 * uDrill * webIsDrilled(aMeta.x));
    float breathe = 1.0 + 0.03 * sin(uTime * uMotion * ${WB} + aMeta.x * 2.4) * uMotion;
    float px = aMeta.y * 1.3 * uScale * uPixelRatio / max(0.001, -mv.z) * breathe;
    gl_PointSize = clamp(px, 6.0 * uPixelRatio, 260.0 * uPixelRatio) * step(0.004, vis);
    gl_Position = projectionMatrix * mv;
    float a = aMeta.w > 0.5 ? 0.12 : 0.22;
    if (aMeta.z > 1.5) a *= 1.9; else if (aMeta.z > 0.5) a *= 0.35;
    vColor = aColor;
    vAlpha = a * vis * uIntro;
    vHot = aMeta.z > 1.5 ? 0.4 : 0.0;
  }
`;

/**
 * Chunk motes: one particle per chunk orbiting its star. LOD reveal: invisible
 * until the orbit spans ≥ 3 px, fully resolved at 10 px (same projection as stars).
 */
export const MOTE_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aCentre;
  attribute vec3 aOff;
  attribute vec4 aStar;     // star phase, cluster R, cluster, orbit radius × star size
  attribute vec4 aOrbit;    // normal θ, normal φ, phase, angular speed (rad/s)
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uStarSize;
  uniform float uIntro;
  uniform float uMoteAlpha;
  uniform vec3 uMoteColor;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec3 star = webStarPos(aCentre, aOff, aStar.z, aStar.x, aStar.y);
    float vis = webClusterAlpha(aStar.z);
    float r = aStar.w * uStarSize;
    vec3 n = vec3(sin(aOrbit.x) * cos(aOrbit.y), sin(aOrbit.x) * sin(aOrbit.y), cos(aOrbit.x));
    vec3 a = abs(n.y) < 0.99 ? normalize(cross(n, vec3(0.0, 1.0, 0.0))) : normalize(cross(n, vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, a);
    float ang = aOrbit.z * ${TAU} + aOrbit.w * uTime * uMotion;
    vec3 p = star + (a * cos(ang) + b * sin(ang)) * r;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float orbitPx = r * uScale / max(0.001, -mv.z);
    float lod = smoothstep(3.0, 10.0, orbitPx);
    gl_PointSize = clamp((0.9 + orbitPx * 0.06) * uPixelRatio, 1.0, 3.2 * uPixelRatio) * step(0.004, lod * vis);
    gl_Position = projectionMatrix * mv;
    vColor = uMoteColor;
    vAlpha = lod * vis * uMoteAlpha * uIntro;
    vHot = 0.0;
  }
`;

const BEZIER = /* glsl */ `
  vec3 webBezier(vec3 p0, vec3 c, vec3 p2, float t) {
    float u = 1.0 - t;
    return u * u * p0 + 2.0 * u * t * c + t * t * p2;
  }
`;

const FOCUS = /* glsl */ `
  uniform float uFocusCluster;   // armed / selected cluster, -1 none
  uniform float uFocusEdge;      // highlighted edge index, -1 none
  // 1 when this edge touches the focused cluster or is the focused edge
  float webFocusHit(vec2 ends, float edge) {
    return max(
      max(1.0 - step(0.5, abs(ends.x - uFocusCluster)), 1.0 - step(0.5, abs(ends.y - uFocusCluster))),
      1.0 - step(0.5, abs(edge - uFocusEdge))
    ) * step(-0.5, max(uFocusCluster, uFocusEdge));
  }
  // Graph3D focus rule: with a focus, other edges dim to 25 %; without one, all at 1
  float webFocus(vec2 ends, float edge) {
    float anyFocus = step(-0.5, max(uFocusCluster, uFocusEdge));
    return mix(1.0, mix(0.25, 1.0, webFocusHit(ends, edge)), anyFocus);
  }
`;

/**
 * Inter-cluster links: instanced camera-facing ribbons. Base strip = (aT, aSide);
 * per instance a quadratic Bézier projected to the screen and widened in px.
 * Faded out by the drill (uLinkAlpha = 1 − uDrill on the CPU side).
 */
export const RIBBON_VERT = /* glsl */ `
  ${BEZIER}
  ${FOCUS}
  attribute float aT;
  attribute float aSide;
  attribute vec3 aP0;
  attribute vec3 aP2;
  attribute vec3 aCtrl;
  attribute vec4 aStyle;    // width px, alpha, dash count (0 = solid), edge index
  attribute vec2 aEnds;     // cluster a, cluster b
  attribute vec3 aColA;
  attribute vec3 aColB;
  uniform vec2 uViewport;   // drawing-buffer px
  uniform float uPixelRatio;
  uniform float uLinkAlpha;
  uniform float uIntro;
  varying vec3 vLineColor;
  varying float vLineAlpha;
  varying float vLineT;
  varying float vDash;
  varying float vSide;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(webBezier(aP0, aCtrl, aP2, aT), 1.0);
    vec4 c0 = mvp * vec4(webBezier(aP0, aCtrl, aP2, max(0.0, aT - 0.02)), 1.0);
    vec4 c1 = mvp * vec4(webBezier(aP0, aCtrl, aP2, min(1.0, aT + 0.02)), 1.0);
    if (c.w <= 0.0 || c0.w <= 0.0 || c1.w <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vLineAlpha = 0.0; vLineColor = aColA; vLineT = aT; vDash = 0.0; vSide = 0.0;
      return;
    }
    vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uViewport;
    vec2 nrm = normalize(vec2(-d.y, d.x) + vec2(1e-6, 0.0));
    float w = aStyle.x * uPixelRatio + 1.0;   // +1 px for the soft edge
    c.xy += nrm * aSide * w / uViewport * c.w;
    gl_Position = c;
    float focus = webFocus(aEnds, aStyle.w);
    vLineColor = mix(aColA, aColB, aT);
    vLineAlpha = aStyle.y * focus * uLinkAlpha * uIntro;
    vLineT = aT;
    vDash = aStyle.z;
    vSide = aSide;
  }
`;

/** Ribbon / line fragment: soft edges; dashed (Unsorted links) via fract(arc position). */
export const LINE_FRAG = /* glsl */ `
  varying vec3 vLineColor;
  varying float vLineAlpha;
  varying float vLineT;
  varying float vDash;
  varying float vSide;
  void main() {
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float dash = vDash > 0.5 ? step(0.45, fract(vLineT * vDash)) : 1.0;
    float a = vLineAlpha * edge * dash;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vLineColor, a);
  }
`;

/**
 * Flowing pulses on inter links (Graph3D's traveling particles, on the GPU):
 * t = fract(uTime · speed + offset) along the same Bézier. Hidden under reduced motion.
 */
export const PULSE_VERT = /* glsl */ `
  ${BEZIER}
  ${FOCUS}
  uniform float uTime;
  uniform float uMotion;
  attribute vec3 aP0;
  attribute vec3 aP2;
  attribute vec3 aCtrl;
  attribute vec4 aPulse;    // speed (cycles/s), offset, edge index, size px
  attribute vec2 aEnds;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uLinkAlpha;
  uniform float uIntro;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    float t = fract(uTime * aPulse.x + aPulse.y);
    vec4 mv = modelViewMatrix * vec4(webBezier(aP0, aCtrl, aP2, t), 1.0);
    float focus = webFocus(aEnds, aPulse.z);
    float ends = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.92, 1.0, t));
    float a = uMotion * uLinkAlpha * uIntro * ends * mix(0.55, 1.0, focus) * focus;
    gl_PointSize = aPulse.w * uPixelRatio * mix(0.8, 1.35, focus) * step(0.004, a);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = a;
    vHot = 0.6 * webFocusHit(aEnds, aPulse.z);
  }
`;

/**
 * Intra-cluster links (drill only): LineSegments whose endpoints are stars, so each
 * vertex runs WEB_POS and the line stays attached. Fades in for uDrill > 0.6.
 * aLink.y = dots per segment (0 solid concept link, > 0 dotted vector neighbour).
 */
export const INTRA_LINE_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aCentre;
  attribute vec3 aOff;
  attribute vec4 aMeta;     // cluster, phase, cluster R, end (0 | 1)
  attribute vec3 aLink;     // strength 0..1, dots (0 = solid), focus (1 = touches the armed star)
  uniform vec3 uLinkColor;
  uniform float uHasFocus;  // 1 while a star is armed: its links brighten, the rest recede
  varying vec3 vLineColor;
  varying float vLineAlpha;
  varying float vLineT;
  varying float vDash;
  varying float vSide;
  void main() {
    vec3 p = webStarPos(aCentre, aOff, aMeta.x, aMeta.y, aMeta.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float show = smoothstep(0.6, 1.0, uDrill);
    float base = 0.14 + 0.5 * aLink.x;
    vLineColor = mix(uLinkColor, vec3(1.0), 0.35 * aLink.z * uHasFocus);
    vLineAlpha = show * mix(base, aLink.z > 0.5 ? 0.95 : base * 0.3, uHasFocus);
    vLineT = aMeta.w;
    vDash = aLink.y;
    vSide = 0.0;
  }
`;

/** Pulses on intra links: between two drifting stars of the drilled cluster. */
export const INTRA_PULSE_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aCentre;
  attribute vec3 aOffA;
  attribute vec3 aOffB;
  attribute vec4 aMetaA;    // cluster, phase A, cluster R, speed (cycles/s)
  attribute vec2 aMetaB;    // phase B, offset
  uniform vec3 uLinkColor;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec3 a = webStarPos(aCentre, aOffA, aMetaA.x, aMetaA.y, aMetaA.z);
    vec3 b = webStarPos(aCentre, aOffB, aMetaA.x, aMetaB.x, aMetaA.z);
    float t = fract(uTime * aMetaA.w + aMetaB.y);
    vec4 mv = modelViewMatrix * vec4(mix(a, b, t), 1.0);
    float a2 = uMotion * smoothstep(0.6, 1.0, uDrill) * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.9, 1.0, t));
    gl_PointSize = 2.6 * uPixelRatio * step(0.004, a2);
    gl_Position = projectionMatrix * mv;
    vColor = uLinkColor;
    vAlpha = 0.85 * a2;
    vHot = 0.3;
  }
`;

/** Halo ring for the armed (kind 0) and selected (kind 1) star. Port of galaxy HALO_VERT/FRAG. */
export const HALO_VERT = /* glsl */ `
  ${WEB_POS}
  attribute vec3 aCentre;
  attribute vec3 aOff;
  attribute vec4 aMeta;     // cluster, phase, cluster R, kind
  attribute vec3 aColor;
  attribute float aActive;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vKind;
  varying float vActive;
  void main() {
    vec3 p = webStarPos(aCentre, aOff, aMeta.x, aMeta.y, aMeta.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (aMeta.w > 0.5 ? 54.0 : 40.0) * uPixelRatio * aActive;
    vColor = aColor;
    vKind = aMeta.w;
    vActive = aActive;
  }
`;

export const HALO_FRAG = /* glsl */ `
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

/** Names of the point shaders that feed lib/three GLOW_POINT_FRAG. */
export const GLOW_POINT_SHADERS = ['STAR_VERT', 'CORE_VERT', 'MOTE_VERT', 'PULSE_VERT', 'INTRA_PULSE_VERT'] as const;
/** Names of the shaders that feed LINE_FRAG. */
export const LINE_SHADERS = ['RIBBON_VERT', 'INTRA_LINE_VERT'] as const;

/**
 * Attribute layouts (name → components) the engine allocates for each shader.
 * The shader test checks every `attribute` in the GLSL against these, so a
 * mismatch fails in bun instead of rendering garbage.
 */
export const LAYOUTS = {
  STAR_VERT: { aCentre: 3, aOff: 3, aMeta: 4, aColor: 3, aState: 1 },
  CORE_VERT: { position: 3, aColor: 3, aMeta: 4 },
  MOTE_VERT: { aCentre: 3, aOff: 3, aStar: 4, aOrbit: 4 },
  RIBBON_VERT: { aT: 1, aSide: 1, aP0: 3, aP2: 3, aCtrl: 3, aStyle: 4, aEnds: 2, aColA: 3, aColB: 3 },
  PULSE_VERT: { aP0: 3, aP2: 3, aCtrl: 3, aPulse: 4, aEnds: 2, aColor: 3 },
  INTRA_LINE_VERT: { aCentre: 3, aOff: 3, aMeta: 4, aLink: 3 },
  INTRA_PULSE_VERT: { aCentre: 3, aOffA: 3, aOffB: 3, aMetaA: 4, aMetaB: 2 },
  HALO_VERT: { aCentre: 3, aOff: 3, aMeta: 4, aColor: 3, aActive: 1 },
} as const;

/** Per-instance attributes of the ribbon (the rest are the shared base strip). */
export const RIBBON_INSTANCE_ATTRS = ['aP0', 'aP2', 'aCtrl', 'aStyle', 'aEnds', 'aColA', 'aColB'] as const;
