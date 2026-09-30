/// <reference lib="webworker" />
/**
 * simWorker — the one WASM instance that steps the SWE field off the main
 * thread (#455 Phase A). Commands that arrive while the module loads are
 * queued and replayed in order; a load failure answers with a fatal ERROR so
 * the main thread falls back to the main-thread stepper instead of waiting.
 */
import { getWorkerWasm } from '../physics/workerWasm';
import { createSimWorkerCore, type SimWorkerCore } from './simWorkerCore';
import type { SimWorkerCommand, SimWorkerResponse } from './simWorkerProtocol';

const ctx = self as DedicatedWorkerGlobalScope;

let core: SimWorkerCore | null = null;
let booting = false;
const queued: SimWorkerCommand[] = [];

const post = (response: SimWorkerResponse, transfer: Transferable[] = []) => {
  ctx.postMessage(response, transfer);
};

const run = (command: SimWorkerCommand) => {
  try {
    core!.handle(command);
  } catch (error) {
    post({ type: 'ERROR', error: error instanceof Error ? error.message : String(error), fatal: true });
  }
};

const boot = async (assets: { glue: string; wasm: string } | undefined) => {
  const wasm = assets
    ? await getWorkerWasm('[sim worker] native init failed; SWE falls back to the main thread', (path) =>
        path.endsWith('.wasm') ? assets.wasm : assets.glue,
      )
    : null;
  if (!wasm) {
    queued.length = 0;
    post({ type: 'ERROR', error: 'watershed_native failed to load in the sim worker', fatal: true });
    return;
  }
  core = createSimWorkerCore(wasm, post);
  for (const command of queued.splice(0)) run(command);
};

ctx.addEventListener('message', (event: MessageEvent<SimWorkerCommand>) => {
  if (core) {
    run(event.data);
    return;
  }
  queued.push(event.data);
  if (!booting) {
    booting = true;
    // The proxy's first message is INIT; it carries where public/ lives.
    void boot(event.data.type === 'INIT' ? event.data.assets : undefined);
  }
});
