/**
 * workerSweSim — a `SweSim` whose solver runs in the sim worker (#455 Phase A).
 *
 * Same contract as the WGSL backend's CPU mirror (WgslSweSim.ts): readers see
 * h / u / w / b as stable Float32Arrays on the main thread. Each published
 * frame is copied into the mirror and its buffer handed straight back to the
 * worker — readers such as gpu-chores hold `h` across awaits, so the mirror must
 * never be a buffer that gets transferred away. `fieldVersion` bumps when a
 * frame lands (one message hop after `step()`), and on `scroll()`.
 *
 *   step():   queued addSurface ops ride along, applied in order before the step
 *   scroll(): same shift applied to the mirror at once (TS twin, bit-exact)
 *   commitBed(): a copy of `b` is transferred; the mirror keeps its own
 *   Frames published before the worker saw the latest scroll or bed commit are
 *   discarded, so the mirror never pairs a field with a window or bed it was
 *   not computed on.
 *
 * The worker steps exactly the stream of commands the main-thread stepper would
 * see, so the field is the same field — it just arrives a message later.
 */
import type { SweSim, SweStepInput } from '../systems/water/sweSim';
import { SWE_REST_INFLOW, scrollField } from '../systems/water/sweScroll';
import { viewSimFrame } from './SimFrame';
import type { SimWorkerProxy } from './createSimWorkerProxy';

export function createWorkerSweSim(
  proxy: SimWorkerProxy,
  width: number,
  height: number,
  dx: number,
): SweSim {
  const count = width * height;
  const gridId = proxy.allocateGridId();

  const mirror = new Float32Array(4 * count);
  const h = mirror.subarray(0, count);
  const u = mirror.subarray(count, 2 * count);
  const w = mirror.subarray(2 * count, 3 * count);
  const b = mirror.subarray(3 * count, 4 * count);

  let surface: number[] = [];
  let epoch = 0;
  let fieldVersion = 0;
  let disposed = false;

  const takeSurface = () => {
    const ops = surface;
    surface = [];
    return ops;
  };

  proxy.post({ type: 'CONFIGURE', gridId, width, height, dx });
  const unsubscribe = proxy.onFrame(gridId, (frame) => {
    // Taken before a scroll / bed commit the mirror already has: drop it.
    if (!disposed && frame.epoch === epoch && frame.width === width && frame.height === height) {
      const planes = viewSimFrame(frame.buffer, count);
      h.set(planes.eta);
      u.set(planes.u);
      w.set(planes.w);
      b.set(planes.b);
      fieldVersion += 1;
    }
    proxy.returnFrame(frame.buffer);
  });

  return {
    backend: 'wasm-worker',
    width,
    height,
    dx,
    h,
    u,
    w,
    b,
    get fieldVersion() {
      return fieldVersion;
    },
    commitBed() {
      if (disposed) return;
      const copy = b.slice();
      proxy.post({ type: 'COMMIT_BED', gridId, b: copy }, [copy.buffer]);
      epoch += 1;
    },
    addSurface(index, amount) {
      if (index < 0 || index >= count) return;
      surface.push(index, amount);
    },
    scroll(shiftX, shiftZ, inflow = SWE_REST_INFLOW) {
      if (disposed) return;
      if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return;
      const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
      const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
      if (sx === 0 && sz === 0) return;
      proxy.post({
        type: 'SCROLL',
        gridId,
        surface: takeSurface(),
        shiftX: sx,
        shiftZ: sz,
        inflow: { eta: inflow.eta, u: inflow.u, w: inflow.w },
      });
      scrollField({ h, u, w, b }, width, height, sx, sz, inflow);
      epoch += 1;
      fieldVersion += 1;
    },
    step(input: SweStepInput) {
      if (disposed) return;
      proxy.post({
        type: 'STEP',
        gridId,
        surface: takeSurface(),
        input: { ...input, events: input.events.slice() },
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      proxy.post({ type: 'DISPOSE_GRID', gridId });
    },
  };
}
