/**
 * gpuLossRecovery — one place for "the GPU went away" (#466 Phase C).
 *
 *   WebGL2 (GLSL, and the node renderer's WebGL2 backend): `webglcontextlost`
 *     → onLost('context-lost'); `webglcontextrestored` → onRestored(). The
 *     browser decides when the context comes back.
 *   Native WebGPU: there is no restore event — a lost GPUDevice stays lost — so
 *     three's `renderer.onDeviceLost` → onLost('device-lost') then onRestored()
 *     straight away; the remount builds a new renderer, which requests a new
 *     device. three already ignores `reason: 'destroyed'` (its own disposal),
 *     so an intentional Canvas remount can't loop back through here.
 *
 * App routes onRestored into the same Canvas epoch bump WebGL restore always
 * used. Run state lives in Zustand outside the Canvas, so the run survives.
 * The returned detach removes every listener and hook (the old inline handlers
 * were never removed).
 */

export type GpuLossKind = 'context-lost' | 'device-lost';

export interface GpuLossCallbacks {
  onLost(kind: GpuLossKind, detail?: string): void;
  onRestored(kind: GpuLossKind): void;
}

interface DeviceLossInfo {
  api?: string;
  message?: string;
  reason?: string | null;
}

interface LossCapableRenderer {
  domElement?: HTMLCanvasElement;
  isWebGPURenderer?: boolean;
  backend?: { isWebGPUBackend?: boolean; device?: { destroy?: () => void } };
  onDeviceLost?: (info: DeviceLossInfo) => void;
  getContext?: () => WebGLRenderingContext | WebGL2RenderingContext;
}

function isNativeWebGPU(gl: LossCapableRenderer): boolean {
  return gl.isWebGPURenderer === true && gl.backend?.isWebGPUBackend === true;
}

export function attachGpuLossHandlers(renderer: unknown, callbacks: GpuLossCallbacks): () => void {
  const gl = renderer as LossCapableRenderer;
  let detached = false;
  const cleanups: Array<() => void> = [];

  const canvas = gl.domElement;
  if (canvas) {
    const onContextLost = (event: Event) => {
      event.preventDefault(); // without this the browser never restores
      if (!detached) callbacks.onLost('context-lost');
    };
    const onContextRestored = () => {
      if (!detached) callbacks.onRestored('context-lost');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    });
  }

  if (isNativeWebGPU(gl)) {
    const previous = gl.onDeviceLost;
    gl.onDeviceLost = (info: DeviceLossInfo) => {
      previous?.call(gl, info); // three's default: logs, marks the renderer lost
      if (detached) return;
      callbacks.onLost('device-lost', info?.message ?? undefined);
      callbacks.onRestored('device-lost');
    };
    cleanups.push(() => {
      gl.onDeviceLost = previous;
    });
  }

  return () => {
    if (detached) return;
    detached = true;
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * Debug only (`?debugGpuLoss=1`): lose the GPU the way a driver reset would.
 * WebGL: WEBGL_lose_context (restores after a second). WebGPU: destroy the
 * device — which three treats as its own disposal and filters out — then
 * report the loss through the same hook a real one takes.
 */
export function simulateGpuLoss(renderer: unknown): GpuLossKind | null {
  const gl = renderer as LossCapableRenderer;
  if (isNativeWebGPU(gl)) {
    gl.backend?.device?.destroy?.();
    gl.onDeviceLost?.({ api: 'WebGPU', message: 'debug: simulated device loss (device.destroy())', reason: 'unknown' });
    return 'device-lost';
  }
  const ctx = gl.getContext?.();
  const ext = ctx?.getExtension('WEBGL_lose_context');
  if (!ext) return null;
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), 1000);
  return 'context-lost';
}

export function isGpuLossDebugEnabled(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  const value = new URLSearchParams(search).get('debugGpuLoss');
  return value === '1' || value === 'true';
}
