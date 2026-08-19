/**
 * Session GPUDevice owner for gpu-chores and HeightmapFlow.
 *
 * Never calls requestAdapter/requestDevice. The renderer registers a device
 * only when Three's backend is real WebGPU. A WebGL session leaves this null
 * so chores cannot stand up a second graphics context.
 */

import {
  detectGpuComputeSupport,
  publishGpuComputeBreadcrumbs,
  readGpuComputeDiagnostics,
} from './support';

let sessionDevice: GPUDevice | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Pull Three.js WebGPURenderer.backend.device when the backend is native WebGPU. */
export function extractRendererGpuDevice(renderer: unknown): GPUDevice | null {
  if (!renderer || typeof renderer !== 'object') return null;
  const backend = (renderer as { backend?: { isWebGPUBackend?: boolean; device?: GPUDevice } })
    .backend;
  if (!backend?.isWebGPUBackend) return null;
  return backend.device ?? null;
}

export function registerSessionGpuDevice(device: GPUDevice | null): void {
  sessionDevice = device;
  const support = detectGpuComputeSupport(device);
  publishGpuComputeBreadcrumbs(support, readGpuComputeDiagnostics(device));
  notify();
}

export function getSessionGpuDevice(): GPUDevice | null {
  return sessionDevice;
}

export function subscribeSessionGpuDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSessionGpuDevice(): void {
  sessionDevice = null;
  notify();
}
