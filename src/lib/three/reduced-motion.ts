// prefers-reduced-motion as a useSyncExternalStore source:
//   useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false)

export function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
export const getReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
