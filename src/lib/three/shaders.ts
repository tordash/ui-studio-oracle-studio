// Shared GLSL — glow instead of bloom (no postprocessing anywhere, decision S3).

/**
 * Soft-disc glow point fragment shader, for additive THREE.Points.
 * The vertex shader must write these varyings:
 *   vColor  vec3   star colour (0..1)
 *   vAlpha  float  final opacity
 *   vHot    float  0 = calm, 1 = hot (larger glow + whiter core, e.g. search match)
 */
export const GLOW_POINT_FRAG = /* glsl */ `
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
