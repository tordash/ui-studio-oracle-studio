// Shared 3D device checks — WebGL probe + DPR cap (Galaxy, Constellation, Brain Core, Timeline).

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
