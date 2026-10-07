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
 *
 * Phase B: the router lives in the worker, so the frame loop routes through
 * `scrollRouted` / `stepRouted` (the chain index rides along; the worker derives
 * the edge and the entering-cell state) and places the window with `setOrigin`
 * so the worker's force lookups use the frame's origin.
 */
import type { SweSim, SweStepInput } from '../systems/water/sweSim';
import { SWE_REST_INFLOW, scrollField, type SweInflow } from '../systems/water/sweScroll';
import { viewSimFrame } from './SimFrame';
import type { SimWorkerProxy } from './createSimWorkerProxy';
import type { SimRoute, SimScrollFill } from './simWorkerProtocol';

/** A `SweSim` whose solver, router and force sampling live in the sim worker. */
export interface WorkerSweSim extends SweSim {
  readonly backend: 'wasm-worker';
  readonly proxy: SimWorkerProxy;
  readonly gridId: number;
  /**
   * `scroll()` with the routed fill evaluated in the worker. `requireRouted`
   * scrolls only when a routed state exists (a freshly placed window). The
   * new window origin rides on the same message.
   */
  scrollRouted(
    shiftX: number,
    shiftZ: number,
    route: SimRoute,
    requireRouted: boolean,
    originX: number,
    originZ: number,
  ): void;
  /** `step()` with `edgeEta` from the worker's router, which then advances by `input.dt`. */
  stepRouted(input: SweStepInput, route: SimRoute): void;
  /** Tell the worker where cell (0, 0) is; posts only on change. */
  setOrigin(originX: number, originZ: number): void;
}

export function isWorkerSweSim(sim: SweSim | null): sim is WorkerSweSim {
  return sim !== null && sim.backend === 'wasm-worker' && 'stepRouted' in sim;
}

export function createWorkerSweSim(
  proxy: SimWorkerProxy,
  width: number,
  height: number,
  dx: number,
): WorkerSweSim {
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
  // The routed entering-cell state the worker last reported (mirror fill only).
  let reportedInflow: SweInflow | null = null;
  let placedX = Number.NaN;
  let placedZ = Number.NaN;

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
    if (!disposed) reportedInflow = frame.inflow;
    proxy.returnFrame(frame.buffer);
  });

  const clampShift = (shiftX: number, shiftZ: number): [number, number] | null => {
    if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return null;
    const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
    const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
    return sx === 0 && sz === 0 ? null : [sx, sz];
  };

  const postScroll = (
    sx: number,
    sz: number,
    fill: SimScrollFill,
    mirrorFill: SweInflow | null,
    origin?: { x: number; z: number },
  ) => {
    proxy.post({ type: 'SCROLL', gridId, surface: takeSurface(), shiftX: sx, shiftZ: sz, fill, origin });
    // The mirror moves at once; the next frame (same epoch) replaces all of it,
    // so the fill here is only what shows until then.
    if (mirrorFill) scrollField({ h, u, w, b }, width, height, sx, sz, mirrorFill);
    epoch += 1;
    fieldVersion += 1;
  };

  return {
    backend: 'wasm-worker',
    proxy,
    gridId,
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
      const shift = clampShift(shiftX, shiftZ);
      if (!shift) return;
      const fill = { eta: inflow.eta, u: inflow.u, w: inflow.w };
      postScroll(shift[0], shift[1], { kind: 'inflow', inflow: fill }, fill);
    },
    scrollRouted(shiftX, shiftZ, route, requireRouted, originX, originZ) {
      if (disposed) return;
      const shift = clampShift(shiftX, shiftZ);
      if (!shift) return;
      placedX = originX;
      placedZ = originZ;
      const mirrorFill = reportedInflow ?? (requireRouted ? null : SWE_REST_INFLOW);
      postScroll(
        shift[0],
        shift[1],
        { kind: 'routed', route: { chainIndex: route.chainIndex }, requireRouted },
        mirrorFill,
        { x: originX, z: originZ },
      );
    },
    setOrigin(originX, originZ) {
      if (disposed || (Object.is(originX, placedX) && Object.is(originZ, placedZ))) return;
      placedX = originX;
      placedZ = originZ;
      proxy.post({ type: 'ORIGIN', gridId, originX, originZ });
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
    stepRouted(input: SweStepInput, route: SimRoute) {
      if (disposed) return;
      const { edgeEta: _ignored, ...rest } = input;
      proxy.post({
        type: 'STEP',
        gridId,
        surface: takeSurface(),
        input: { ...rest, events: input.events.slice() },
        route: { chainIndex: route.chainIndex },
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
