import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseSweSimBackend,
  demoteSweSimBackendToWasm,
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

  it('keeps WASM on a WebGL2 session (no registered device)', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: true, device: null })).toEqual({
      backend: 'wasm',
      reason: 'no-webgpu-device',
    });
  });

  it('keeps WASM while the native gate is closed, even with a device', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: false, device: device() }).reason).toBe('gate-closed');
  });

  it('keeps WASM on a device below the kernels’ limits', () => {
    expect(
      chooseSweSimBackend({ nativeWebgpuGate: true, device: device({ maxStorageBuffersPerShaderStage: 2 }) }).reason,
    ).toBe('device-limits');
    expect(
      chooseSweSimBackend({ nativeWebgpuGate: true, device: device({ maxComputeWorkgroupSizeX: 32 }) }).reason,
    ).toBe('device-limits');
  });

  it('honours ?swe=wasm for A/B checks', () => {
    expect(chooseSweSimBackend({ nativeWebgpuGate: true, device: device(), search: '?swe=wasm' })).toEqual({
      backend: 'wasm',
      reason: 'query-wasm',
    });
  });
});

describe('resolveSweSimBackend', () => {
  afterEach(() => {
    resetSweSimBackendForTests();
    vi.restoreAllMocks();
  });

  it('is WASM on a session with no WebGPU device', () => {
    vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(null);
    expect(resolveSweSimBackend()).toBe('wasm');
  });

  it('decides once per session — a device appearing later does not switch solvers', () => {
    const getDevice = vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(null);
    vi.spyOn(gate, 'canEnableNativeWebgpu').mockReturnValue(true);
    expect(resolveSweSimBackend()).toBe('wasm');
    getDevice.mockReturnValue(device() as unknown as GPUDevice);
    expect(resolveSweSimBackend()).toBe('wasm');
  });

  it('picks WGSL on a native-WebGPU session, and can be demoted before anything steps', () => {
    vi.spyOn(chores, 'getSessionGpuDevice').mockReturnValue(device() as unknown as GPUDevice);
    vi.spyOn(gate, 'canEnableNativeWebgpu').mockReturnValue(true);
    expect(resolveSweSimBackendDecision()).toEqual({ backend: 'wgsl', reason: 'native-webgpu' });
    demoteSweSimBackendToWasm();
    expect(resolveSweSimBackendDecision()).toEqual({ backend: 'wasm', reason: 'wgsl-init-failed' });
  });
});
