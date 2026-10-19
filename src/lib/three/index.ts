// Barrel for the shared 3D seed (decision S1). Plain three.js helpers, no React.
export { webglAvailable, isPhoneLike, cappedPixelRatio } from './device';
export { subscribeReducedMotion, getReducedMotion } from './reduced-motion';
export { bindRenderGate } from './render-gate';
export type { RenderGateHandlers } from './render-gate';
export { GLOW_POINT_FRAG } from './shaders';
