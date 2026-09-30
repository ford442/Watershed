import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseSweSimBackend,
  demoteSweSimBackendToWasm,
  demoteSweSimBackendToWasmMain,
  resetSweSimBackendForTests,
  resolveSweSimBackend,
  resolveSweSimBackendDecision,
} from './sweBackend';
import * as gate from '../../rendering/nativeWebgpuGate';
import * as chores from '../../rendering/gpuChores/device';

const device = (limits: Partial<GPUSupportedLimits> = {}) => ({
  limits: { maxStorageBuffersPerShaderStage: 8, maxComputeWorkgroupSizeX: 256, ...limits } as GPUSupportedLimits,
});

describe('chooseSweSimBackend', () => {
  it('runs the WGSL twin only on a native-WebGPU device behind an open gate', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: true, device: device() })).toEqual({
      backend: 'wgsl',
      reason: 'native-webgpu',
    });
  });

  it('keeps WASM — in the sim worker — on a WebGL2 session (no registered device)', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: true, device: null, workerAvailable: true })).toEqual({
      backend: 'wasm-worker',
      reason: 'no-webgpu-device',
    });
  });

  it('steps WASM on the main thread under ?simWorker=0 or without Worker', () => {
    expect(
      chooseSweSimBackend({ nativeWebgpuGate: true, device: null, workerAvailable: true, search: '?simWorker=0' }),
    ).toEqual({ backend: 'wasm-main', reason: 'sim-worker-off' });
    expect(chooseSweSimBackend({ nativeWebgpuGate: true, device: null, workerAvailable: false })).toEqual({
      backend: 'wasm-main',
      reason: 'no-worker',
    });
  });

  it('never moves the WGSL twin into the worker — it needs the renderer’s device', () => {
    expect(
      chooseSweSimBackend({ nativeWebgpuGate: true, device: device(), workerAvailable: true, search: '?simWorker=1' }),
    ).toEqual({ backend: 'wgsl', reason: 'native-webgpu' });
  });

  it('keeps WASM while the native gate is closed, even with a device', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: false, device: device(), workerAvailable: true }).reason).toBe('gate-closed');
  });

  it('keeps WASM on a device below the kernels’ limits', () => {
    expect(
      chooseSweSimBackend({
        nativeWebgpuGate: true,
        device: device({ maxStorageBuffersPerShaderStage: 2 }),
        workerAvailable: true,
      }).reason,
    ).toBe('device-limits');
    expect(
      chooseSweSimBackend({
        nativeWebgpuGate: true,
        device: device({ maxComputeWorkgroupSizeX: 32 }),
        workerAvailable: true,
      }).reason,
    ).toBe('device-limits');
  });

  it('honours ?swe=wasm for A/B checks, with ?simWorker=0 still choosing the thread', () => {
    expect(
      chooseSweSimBackend({ nativeWebgpuGate: true, device: device(), workerAvailable: true, search: '?swe=wasm' }),
    ).toEqual({ backend: 'wasm-worker', reason: 'query-wasm' });
    expect(
      chooseSweSimBackend({
        nativeWebgpuGate: true,
        device: device(),
        workerAvailable: true,
        search: '?swe=wasm&simWorker=0',
      }),
    ).toEqual({ backend: 'wasm-main', reason: 'sim-worker-off' });
  });
});

describe('resolveSweSimBackend', () => {
  afterEach(() => {
    resetSweSimBackendForTests();
    vi.restoreAllMocks();
  });

  it('is main-thread WASM on a session with no WebGPU device and no Worker (jsdom)', () => {
    vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(null);
    expect(resolveSweSimBackend()).toBe('wasm-main');
  });

  it('is sim-worker WASM when Worker exists, and demotes to the main thread on a failed handshake', () => {
    vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(null);
    vi.stubGlobal('Worker', function Worker() {});
    try {
      expect(resolveSweSimBackend()).toBe('wasm-worker');
      demoteSweSimBackendToWasmMain();
      expect(resolveSweSimBackendDecision()).toEqual({ backend: 'wasm-main', reason: 'sim-worker-failed' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('decides once per session — a device appearing later does not switch solvers', () => {
    const getDevice = vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(null);
    vi.spyOn(gate, 'canEnableNativeWebgpu').mockReturnValue(true);
    expect(resolveSweSimBackend()).toBe('wasm-main');
    getDevice.mockReturnValue(device() as unknown as GPUDevice);
    expect(resolveSweSimBackend()).toBe('wasm-main');
  });

  it('picks WGSL on a native-WebGPU session, and can be demoted before anything steps', () => {
    vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(device() as unknown as GPUDevice);
    vi.spyOn(gate, 'canEnableNativeWebgpu').mockReturnValue(true);
    expect(resolveSweSimBackendDecision()).toEqual({ backend: 'wgsl', reason: 'native-webgpu' });
    demoteSweSimBackendToWasm();
    expect(resolveSweSimBackendDecision()).toEqual({ backend: 'wasm-main', reason: 'wgsl-init-failed' });
  });
});
