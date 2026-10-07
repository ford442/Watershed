/**
 * nativeOwner — where this session's one `watershed_native` lives, for the
 * systems that only borrow it (splash / waterfall particles).
 *
 * - `wasm-worker`: the sim worker's module. Callers post to it; nothing on
 *   this thread instantiates the binary.
 * - `wasm-main` (`?simWorker=0`, no Worker, or a worker whose handshake
 *   failed): the main-thread module (`getWasm`, shared with WaterForceSystem).
 * - `wgsl`: none. A native-WebGPU session steps the WGSL twin and integrates
 *   particles in JS; it does not load WASM to move sprites.
 *
 * Besides WaterForceSystem's own `wasm-main` path, this is the only place
 * that may call `getWasm()` (singleNativeInstance.test.ts).
 */
import {
  getWasm,
  isWasmInitTimeoutError,
  isWasmProvenanceMismatchError,
  type WatershedNativeModule,
} from '../systems/water/WatershedWasm';
import { resolveSweSimBackendDecision } from '../systems/water/sweBackend';
import { getSimWorkerProxy, type SimWorkerProxy } from './createSimWorkerProxy';

export type NativeOwner =
  | { kind: 'worker'; proxy: SimWorkerProxy }
  | { kind: 'main'; wasm: WatershedNativeModule }
  | { kind: 'none' };

const NONE: NativeOwner = { kind: 'none' };

export async function resolveNativeOwner(): Promise<NativeOwner> {
  if (resolveSweSimBackendDecision().backend === 'wgsl') return NONE;
  if (resolveSweSimBackendDecision().backend === 'wasm-worker') {
    try {
      const proxy = await getSimWorkerProxy();
      // A worker that died mid-session is not replaced by a second module.
      return proxy.failed ? NONE : { kind: 'worker', proxy };
    } catch {
      // Handshake failed: the session demotes to the main-thread module
      // (WaterForceSystem does the same, and getWasm is shared).
    }
  }
  try {
    return { kind: 'main', wasm: await getWasm() };
  } catch {
    return NONE;
  }
}

export type NativeStatus =
  | { status: 'loading' }
  | { status: 'ready'; where: 'worker' | 'main'; abi: number }
  /** Native WebGPU: the session has no module, by design. */
  | { status: 'none' }
  | { status: 'failed'; error: string; timedOut: boolean; mismatched: boolean };

function failedStatus(error: unknown): NativeStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 'failed',
    error: message,
    timedOut: isWasmInitTimeoutError(error) || message.includes('did not report READY'),
    mismatched: isWasmProvenanceMismatchError(error),
  };
}

/**
 * The HUD's native-init signal: the sim worker's READY handshake on a WebGL
 * boot (its ABI), the shared main-thread load under `wasm-main`, nothing on
 * native WebGPU. Never instantiates a module the session would not have.
 */
export async function probeNativeStatus(): Promise<NativeStatus> {
  const backend = resolveSweSimBackendDecision().backend;
  if (backend === 'wgsl') return { status: 'none' };
  if (backend === 'wasm-worker') {
    try {
      const proxy = await getSimWorkerProxy();
      if (proxy.failed) return failedStatus(new Error(proxy.failed));
      return { status: 'ready', where: 'worker', abi: proxy.abi };
    } catch {
      // Handshake failed: the session demotes to the main-thread module.
    }
  }
  try {
    const wasm = await getWasm();
    return { status: 'ready', where: 'main', abi: wasm.getVersion() };
  } catch (error) {
    return failedStatus(error);
  }
}
