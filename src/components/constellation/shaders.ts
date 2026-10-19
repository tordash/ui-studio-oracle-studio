// Fleet Constellation — GLSL for the starfield, shell, nodes and rings.
// Nodes use the shared GLOW_POINT_FRAG (no bloom anywhere, C-D6). Every
// material is an unlit ShaderMaterial: 0 lights.

/** Static far starfield: decorative, no motion. */
export const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
  }
`;

export const STAR_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vec3(0.84, 0.88, 1.0), (1.0 - d) * vAlpha);
  }
`;

/** One icosphere: Fresnel rim + dotted 15° graticule, static. */
export const SHELL_VERT = /* glsl */ `
  varying vec3 vUnit;
  varying vec3 vViewN;
  varying vec3 vViewPos;
  void main() {
    vUnit = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vViewN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

export const SHELL_FRAG = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uGrid;
  uniform float uFade;
  varying vec3 vUnit;
  varying vec3 vViewN;
  varying vec3 vViewPos;
  const float PI = 3.14159265;
  void main() {
    vec3 V = normalize(-vViewPos);
    float rim = pow(1.0 - abs(dot(normalize(vViewN), V)), 2.5);
    float lat = asin(clamp(vUnit.y, -1.0, 1.0));
    float lon = atan(vUnit.z, vUnit.x);
    float cell = PI / 12.0;
    float onLat = smoothstep(0.04, 0.0, abs(fract(lat / cell + 0.5) - 0.5));
    float onLon = smoothstep(0.04, 0.0, abs(fract(lon / cell + 0.5) - 0.5)) * (1.0 - smoothstep(0.82, 0.98, abs(vUnit.y)));
    float dotted = step(0.55, fract((lat + lon) * 38.0));
    float grid = max(onLat, onLon) * dotted;
    vec3 col = uRim * rim * 0.18 + uGrid * grid * 0.05;
    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;

/**
 * Nodes: one Points. Size = CSS px × DPR with a clamped distance attenuation
 * (far nodes stay tappable); back-hemisphere nodes fade as a depth cue.
 * Intro ignite: rank-ordered, ≤ 60 ms apart (lib/constellation/intro), slight overshoot.
 */
export const NODE_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aHot;
  attribute float aRank;
  uniform float uPixelRatio;
  uniform float uIntroT;
  uniform float uStagger;
  uniform float uCenterZ;
  uniform float uRefDist;
  uniform float uR;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  float ignite(float r) {
    float t = clamp((uIntroT - 0.3 - uStagger * r) / 0.45, 0.0, 1.0);
    float c1 = 1.70158;
    float c3 = c1 + 1.0;
    return 1.0 + c3 * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0);
  }
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float g = ignite(aRank);
    float atten = clamp(uRefDist / max(0.001, -mv.z), 0.7, 1.3);
    float back = 1.0 - 0.6 * smoothstep(0.0, uR, uCenterZ - mv.z);
    gl_PointSize = aSize * 2.0 * atten * uPixelRatio * max(g, 0.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = aAlpha * back * clamp(g, 0.0, 1.0);
    vHot = aHot;
  }
`;

/**
 * Rings: a second Points over the nodes (the glow disc cannot draw rings).
 * aFlags = (selected, hot, hollow host node, reduced-motion "new" ring).
 * aFlash = (uTime the flash started, strength) — pulse arrival / catch-up.
 */
export const RING_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec4 aFlags;
  attribute vec2 aFlash;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uMotion;
  uniform float uIntroT;
  uniform float uCenterZ;
  uniform float uRefDist;
  uniform float uR;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec4 vFlags;
  varying float vFlashAge;
  varying float vFlashK;
  varying float vBreath;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float atten = clamp(uRefDist / max(0.001, -mv.z), 0.7, 1.3);
    float back = 1.0 - 0.6 * smoothstep(0.0, uR, uCenterZ - mv.z);
    gl_PointSize = (aSize * 2.4 + 18.0) * atten * uPixelRatio;
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vAlpha = aAlpha * back * clamp((uIntroT - 1.0) / 0.4, 0.0, 1.0);
    vFlags = aFlags;
    vFlashAge = aFlash.x > 0.0 ? uTime - aFlash.x : -1.0;
    vFlashK = aFlash.y;
    vBreath = 1.0 + 0.06 * sin(uTime * 3.14159265) * uMotion;
  }
`;

export const RING_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying vec4 vFlags;
  varying float vFlashAge;
  varying float vFlashK;
  varying float vBreath;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float a = 0.0;
    if (vFlags.z > 0.5) a += smoothstep(0.07, 0.0, abs(d - 0.3)) * 0.9;
    if (vFlags.x > 0.5) a += smoothstep(0.035, 0.0, abs(d - 0.5 * vBreath)) * 0.95;
    if (vFlags.y > 0.5) {
      float dash = step(0.5, fract(atan(p.y, p.x) * 12.0 / 6.2831853));
      a += smoothstep(0.03, 0.0, abs(d - 0.62)) * dash * 0.6;
    }
    if (vFlags.w > 0.5) a += smoothstep(0.04, 0.0, abs(d - 0.74)) * 0.55;
    if (vFlashAge >= 0.0 && vFlashAge < 0.4) {
      float k = vFlashAge / 0.4;
      a += smoothstep(0.05, 0.0, abs(d - (0.3 + 0.65 * k))) * (1.0 - k) * vFlashK;
    }
    if (a <= 0.0) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.3), a * vAlpha);
  }
`;
