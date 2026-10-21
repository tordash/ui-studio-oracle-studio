// GPU tier for mobile budgets — builds on isPhoneLike (device.ts).
//   low  = no WebGL2, or deviceMemory ≤ 2 GB, or a phone with ≤ 4 logical cores
//   mid  = phone-like
//   high = everything else
// deviceMemory is Chromium-only and hardwareConcurrency may be rounded by the
// browser; missing values never demote a device on their own.

import { isPhoneLike } from './device';

export type GpuTier = 'low' | 'mid' | 'high';

export interface TierProbe {
  webgl2: boolean;
  phone: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function classifyTier(p: TierProbe): GpuTier {
  if (!p.webgl2) return 'low';
  if (typeof p.deviceMemory === 'number' && p.deviceMemory > 0 && p.deviceMemory <= 2) return 'low';
  if (p.phone && typeof p.hardwareConcurrency === 'number' && p.hardwareConcurrency > 0 && p.hardwareConcurrency <= 4) return 'low';
  return p.phone ? 'mid' : 'high';
}

function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // iOS caps live contexts
    return true;
  } catch {
    return false;
  }
}

/** Reads the current device. Call once per page mount (it creates a throwaway context). */
export function probeGpuTier(): GpuTier {
  if (typeof window === 'undefined') return 'high';
  const nav = navigator as Navigator & { deviceMemory?: number };
  return classifyTier({
    webgl2: webgl2Available(),
    phone: isPhoneLike(),
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  });
}
