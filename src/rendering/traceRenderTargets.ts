import * as THREE from 'three';
import { traceCounter, traceName, traceRecording } from '../debug/trace/traceProbe';

const FIRST_BOUND = traceName('render targets first bound');
const RESIZES = traceName('render target resizes');

type RenderTargetRenderer = {
  setRenderTarget(
    target: THREE.RenderTarget | null,
    activeCubeFace?: number,
    activeMipmapLevel?: number,
  ): void;
};

let installed = false;
let firstBound = 0;
let resizes = 0;

/** Sample cumulative allocation-related counters once per recorded frame. */
export function sampleRenderTargetTrace(): void {
  if (!traceRecording()) return;
  traceCounter(FIRST_BOUND, firstBound);
  traceCounter(RESIZES, resizes);
}

/**
 * Trace render targets when they first reach the renderer and whenever their
 * dimensions actually change. A first bind is the closest observable
 * allocation point shared by WebGL and WebGPU renderers.
 */
export function installRenderTargetTrace(rendererValue: object): () => void {
  if (installed) return () => {};
  installed = true;

  const renderer = rendererValue as RenderTargetRenderer;
  const originalSetRenderTarget = renderer.setRenderTarget;
  const seen = new WeakSet<THREE.RenderTarget>();
  firstBound = 0;
  const tracedSetRenderTarget = function (
    this: RenderTargetRenderer,
    target: THREE.RenderTarget | null,
    activeCubeFace?: number,
    activeMipmapLevel?: number,
  ) {
    if (target && !seen.has(target)) {
      seen.add(target);
      firstBound += 1;
    }
    return originalSetRenderTarget.call(this, target, activeCubeFace, activeMipmapLevel);
  };
  renderer.setRenderTarget = tracedSetRenderTarget;

  const prototype = THREE.RenderTarget.prototype;
  const originalSetSize = prototype.setSize;
  resizes = 0;
  const tracedSetSize = function (this: THREE.RenderTarget, width: number, height: number, depth = 1) {
    if (this.width !== width || this.height !== height || this.depth !== depth) {
      resizes += 1;
    }
    return originalSetSize.call(this, width, height, depth);
  };
  prototype.setSize = tracedSetSize;

  return () => {
    if (renderer.setRenderTarget === tracedSetRenderTarget) {
      renderer.setRenderTarget = originalSetRenderTarget;
    }
    if (prototype.setSize === tracedSetSize) prototype.setSize = originalSetSize;
    installed = false;
  };
}
