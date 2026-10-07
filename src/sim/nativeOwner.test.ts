/**
 * nativeOwner — the session's one module, per backend decision. The WASM
 * factory (`getWasm`) is reached only on `wasm-main` or a failed handshake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../systems/water/WatershedWasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../systems/water/WatershedWasm')>()),
  getWasm: vi.fn(),
}));

vi.mock('../systems/water/sweBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../systems/water/sweBackend')>()),
  resolveSweSimBackendDecision: vi.fn(),
}));

vi.mock('./createSimWorkerProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createSimWorkerProxy')>()),
  getSimWorkerProxy: vi.fn(),
}));

import { WasmInitTimeoutError, getWasm, type WatershedNativeModule } from '../systems/water/WatershedWasm';
import { resolveSweSimBackendDecision, type SweSimBackend } from '../systems/water/sweBackend';
import { getSimWorkerProxy, type SimWorkerProxy } from './createSimWorkerProxy';
import { probeNativeStatus, resolveNativeOwner } from './nativeOwner';

const mainModule = { getVersion: () => 11 } as unknown as WatershedNativeModule;

function decide(backend: SweSimBackend) {
  vi.mocked(resolveSweSimBackendDecision).mockReturnValue({ backend, reason: 'native-webgpu' });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveNativeOwner', () => {
  it('wgsl: no module, and neither the WASM factory nor the worker is touched', async () => {
    decide('wgsl');
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'none' });
    expect(getWasm).not.toHaveBeenCalled();
    expect(getSimWorkerProxy).not.toHaveBeenCalled();
  });

  it('wasm-worker: the READY sim worker, never the main-thread factory', async () => {
    decide('wasm-worker');
    const proxy = { failed: null } as unknown as SimWorkerProxy;
    vi.mocked(getSimWorkerProxy).mockResolvedValue(proxy);
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'worker', proxy });
    expect(getWasm).not.toHaveBeenCalled();
  });

  it('wasm-worker whose worker died: none — no second module', async () => {
    decide('wasm-worker');
    vi.mocked(getSimWorkerProxy).mockResolvedValue({ failed: 'boom' } as unknown as SimWorkerProxy);
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'none' });
    expect(getWasm).not.toHaveBeenCalled();
  });

  it('wasm-worker whose handshake failed: the main-thread module (the session demotes)', async () => {
    decide('wasm-worker');
    vi.mocked(getSimWorkerProxy).mockRejectedValue(new Error('Worker is not a constructor'));
    vi.mocked(getWasm).mockResolvedValue(mainModule);
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'main', wasm: mainModule });
  });

  it('wasm-main (?simWorker=0): the main-thread module — the kill switch', async () => {
    decide('wasm-main');
    vi.mocked(getWasm).mockResolvedValue(mainModule);
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'main', wasm: mainModule });
    expect(getSimWorkerProxy).not.toHaveBeenCalled();
  });

  it('a module that fails to load: none (JS integrate)', async () => {
    decide('wasm-main');
    vi.mocked(getWasm).mockRejectedValue(new Error('404'));
    await expect(resolveNativeOwner()).resolves.toEqual({ kind: 'none' });
  });
});

describe('probeNativeStatus', () => {
  it('reports the worker handshake ABI without loading a main-thread module', async () => {
    decide('wasm-worker');
    vi.mocked(getSimWorkerProxy).mockResolvedValue({ failed: null, abi: 11 } as unknown as SimWorkerProxy);
    await expect(probeNativeStatus()).resolves.toEqual({ status: 'ready', where: 'worker', abi: 11 });
    expect(getWasm).not.toHaveBeenCalled();
  });

  it('reports none on native WebGPU', async () => {
    decide('wgsl');
    await expect(probeNativeStatus()).resolves.toEqual({ status: 'none' });
    expect(getWasm).not.toHaveBeenCalled();
  });

  it('classifies a timed-out main-thread load', async () => {
    decide('wasm-main');
    vi.mocked(getWasm).mockRejectedValue(new WasmInitTimeoutError(8000));
    await expect(probeNativeStatus()).resolves.toMatchObject({ status: 'failed', timedOut: true, mismatched: false });
  });

  it('classifies a worker that died, from the cause it carried', async () => {
    decide('wasm-worker');
    vi.mocked(getSimWorkerProxy).mockResolvedValue({
      failed: 'watershed_native failed to load in the sim worker: watershed_native stamp mismatch: glue',
    } as unknown as SimWorkerProxy);
    await expect(probeNativeStatus()).resolves.toMatchObject({ status: 'failed', mismatched: true });
    expect(getWasm).not.toHaveBeenCalled();
  });
});
