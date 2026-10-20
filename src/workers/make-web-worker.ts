// Creates the Knowledge Web module worker, or null where workers are unavailable
// (the client then computes on the main thread). The `new Worker(new URL(…), { type: 'module' })`
// shape is what Vite detects to bundle the worker.
import type { WorkerLike } from '../lib/web/client';

export function makeWebWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./web.worker.ts', import.meta.url), { type: 'module', name: 'knowledge-web' });
  } catch {
    return null;
  }
}
