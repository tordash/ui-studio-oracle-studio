// Knowledge Web worker — a thin dispatcher; all logic lives in lib/web/worker-core.ts (unit-tested).
// Loaded by src/workers/make-web-worker.ts as a module worker (Vite bundles it, no dependency).
import { createCoreState, handleWebRequest } from '../lib/web/worker-core';
import type { WebRequest } from '../lib/web/protocol';

// tsconfig.app.json compiles with the DOM lib only; the members used here exist with
// compatible signatures on both Window and DedicatedWorkerGlobalScope.
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<WebRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

const state = createCoreState();

scope.onmessage = (ev: MessageEvent<WebRequest>) => {
  const { res, transfer } = handleWebRequest(state, ev.data);
  scope.postMessage(res, transfer);
};
