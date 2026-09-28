/**
 * simWorkerProtocol — typed messages between the main thread and the sim
 * worker (#455). Same style as physics/rapierWorkerProtocol.ts.
 *
 * Phase A: the worker owns the SWE grid and its WASM instance. The main thread
 * still decides *when* to step and with what (dt, events, routed edge), so the
 * command stream — and therefore the field — is the one `createWasmSweSim`
 * would compute on the main thread. Commands are applied strictly in order.
 */
import type { SweEventCall, SweStepInput } from '../systems/water/sweSim';
import type { SweInflow } from '../systems/water/sweScroll';
import type { SimFrame } from './SimFrame';

/**
 * Queued `addSurface` calls as flat (index, amount) pairs, applied in order
 * before the command they ride on — the same order `applyDisturbances` adds
 * them on the main-thread path, so the sums round identically.
 */
export type SurfaceOps = number[];

export interface SimStepPayload extends Omit<SweStepInput, 'events'> {
  events: SweEventCall[];
}

export type SimWorkerCommand =
  | {
      type: 'INIT';
      /**
       * Page-resolved, stamped URLs of the glue and the wasm (`resolvePublicAsset`).
       * The worker's own location is its script, not the page, so it cannot find
       * public/ by itself.
       */
      assets: { glue: string; wasm: string };
    }
  | { type: 'CONFIGURE'; gridId: number; width: number; height: number; dx: number }
  | { type: 'COMMIT_BED'; gridId: number; b: Float32Array }
  | { type: 'SCROLL'; gridId: number; surface: SurfaceOps; shiftX: number; shiftZ: number; inflow: SweInflow }
  | { type: 'STEP'; gridId: number; surface: SurfaceOps; input: SimStepPayload }
  | { type: 'RETURN_FRAME'; buffer: ArrayBuffer }
  | { type: 'DISPOSE_GRID'; gridId: number };

export type SimWorkerResponse =
  | { type: 'READY'; abi: number }
  | { type: 'FRAME'; frame: SimFrame }
  | { type: 'ERROR'; error: string; fatal: boolean };

export interface SimWorkerLike {
  postMessage(message: SimWorkerCommand, transfer?: Transferable[]): void;
  terminate?(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SimWorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<SimWorkerResponse>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}
