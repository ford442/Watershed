/**
 * sweSim — one live shallow-water field per session, on one backend (#435).
 *
 * `WaterForceSystem` drives the field through this interface so the frame
 * loop is the same whether the solver is the C++ WASM stepper (on the main
 * thread, or in the sim worker — `src/sim/workerSweSim.ts`) or its WGSL twin
 * (`WgslSweSim.ts`). Which one runs is decided once, at boot, by
 * `resolveSweSimBackend()` — never both in one session.
 *
 * Readers (`sampleSWEFlow` → Rapier, the height texture, gpu-chores) see `h`,
 * `u`, `w`, `b` as plain Float32Arrays either way. On WASM they are live heap
 * views, current the moment `step()` returns. On WGSL the field lives on the
 * GPU and these are a mirror refreshed by an async readback, so they trail the
 * GPU by the readback latency (one step at the budgeted rates). `fieldVersion`
 * bumps whenever the mirror changes, which is what upload consumers key on.
 */
import { heapF32, warnRejected, WS_OK, type WatershedNativeModule } from './wasmAbi';
import type { SWEGrid } from './WatershedWasm';
import { createSWEGrid } from './WatershedWasm';
import type { SweSimBackend } from './sweBackend';
import { SWE_REST_INFLOW, type SweInflow } from './sweScroll';

/** One `applySWEEvent` call, in world XZ (kinds: 0 inflow, 1 vortex, 2 braid, 3 roughness, 4 surge — ABI 14). */
export interface SweEventCall {
  kind: number;
  cx: number;
  cz: number;
  radius: number;
  strength: number;
  dt: number;
}

export interface SweStepInput {
  dt: number;
  g: number;
  /** Still-water depth over a zero bed (m). */
  H: number;
  /**
   * World XZ of grid cell (0, 0) — the window is player-centred and moves. Only
   * used to place `events`; the solver itself is origin-blind, which is why the
   * caller must `scroll()` the field whenever this moves a whole cell.
   */
  originX: number;
  originZ: number;
  /** Authored hydro events applied after the step, in this order. */
  events: readonly SweEventCall[];
  /**
   * Routed stage at the upstream (+Z, high-row) edge, as a free-surface
   * perturbation (m) — `routedEdgeState(Q, Qref).eta`. Undefined keeps every
   * edge transmissive (the pre-routing step); 0 is the reference discharge and
   * leaves still water still. See swe.h `stepShallowWaterInflow`.
   */
  edgeEta?: number;
}

export interface SweSim {
  readonly backend: SweSimBackend;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  /** Free-surface perturbation η (0 at rest), velocities, and bed — swe.h ABI. */
  readonly h: Float32Array;
  readonly u: Float32Array;
  readonly w: Float32Array;
  /** Bed. Rasterize into it, then call `commitBed()`. */
  readonly b: Float32Array;
  /** Bumps whenever h/u/w/b reflect a newer step. */
  readonly fieldVersion: number;
  /** Publish a rewritten `b` to the solver. */
  commitBed(): void;
  /**
   * Add to η at a cell before the next step (splash disturbances). A
   * non-finite amount or an out-of-range / non-integer index is dropped at
   * this door (#533): one NaN here used to spread two cells per step.
   */
  addSurface(index: number, amount: number): void;
  /**
   * Scroll the field through the index frame by whole cells so it stays fixed in
   * world space while the window moves (swe.h `scrollShallowWater`, ABI 9).
   * `shift` is how far the content moves: (oldOrigin − newOrigin) / dx, so a
   * window travelling downstream (−Z) has a positive `shiftZ`. Cells that leave
   * are dropped, cells that enter take `inflow` (rest by default) and the bed
   * plane extends its nearest edge. Call it BEFORE re-rasterizing `b` and before
   * `step()`. Bumps `fieldVersion` — the mirror changed, so the height texture
   * must be re-uploaded against the new origin. Non-finite or zero shifts do
   * nothing.
   */
  scroll(shiftX: number, shiftZ: number, inflow?: SweInflow): void;
  /**
   * Integrate `input.dt` (≤ 4 CFL sub-steps, swe.h), then `input.events`.
   * Whatever the sub-step cap left over is reported by `takeShortfall()`.
   */
  step(input: SweStepInput): void;
  /**
   * Simulated time `step()` was asked for but the solver did not integrate
   * (the sub-step cap, ABI 17), summed since the last call, then reset to 0.
   * Known at once on wasm-main; on wasm-worker it rides the frame and on wgsl
   * the readback, so it arrives a step later. sweHost.ts re-queues it, so the
   * field and the clocks fed by `dt` (simTime, the surge front, hydro events)
   * integrate the same total time.
   */
  takeShortfall(): number;
  /**
   * The SWE flow texture's bytes for the field at `fieldVersion` (#533): RGBA
   * f32 (u, w, depth, div) per cell, the sweSurfaceField.ts layout, depth over
   * `meanDepth`. A stable array for the sim's life, so the flow DataTexture
   * uses it as its backing store and the main thread copies nothing per step.
   * wasm-main packs here (one `packSurfaceField` call into a heap block);
   * wasm-worker / wgsl return the plane that arrived with the field (packed in
   * the worker / on the GPU with the step's H), moved with the mirror on scroll.
   */
  packSurface(meanDepth: number): Float32Array;
  dispose(): void;
}

/**
 * The C++ stepper on the WASM heap. Runs on the main thread as the `wasm-main`
 * backend, and inside the sim worker (src/sim/simWorkerCore.ts) behind the
 * `wasm-worker` backend — same code, same field.
 */
export function createWasmSweSim(
  wasm: WatershedNativeModule,
  width: number,
  height: number,
  dx: number,
): SweSim {
  const grid: SWEGrid = createSWEGrid(wasm, width, height, dx);
  // η is a free-surface *perturbation* (swe.h ABI): at rest it is 0, not H.
  grid.h.fill(0);
  let fieldVersion = 0;
  let shortfall = 0;
  const count = width * height;
  // The packed flow texture, on the heap next to the grid. The heap is fixed
  // (ALLOW_MEMORY_GROWTH=0), so the view is made once and is the texture's
  // backing store for the sim's life.
  const surfacePtr = wasm.allocateGrid(4 * count);
  const surface = heapF32(wasm, surfacePtr, 4 * count);

  return {
    backend: 'wasm-main',
    width,
    height,
    dx,
    get h() { return grid.h; },
    get u() { return grid.u; },
    get w() { return grid.w; },
    get b() { return grid.b; },
    get fieldVersion() { return fieldVersion; },
    commitBed() {
      // The solver reads the heap directly; nothing to publish.
    },
    addSurface(index, amount) {
      if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(amount)) return;
      grid.h[index] += amount;
    },
    scroll(shiftX, shiftZ, inflow = SWE_REST_INFLOW) {
      if (!Number.isFinite(shiftX) || !Number.isFinite(shiftZ)) return;
      const sx = Math.max(-width, Math.min(width, Math.trunc(shiftX)));
      const sz = Math.max(-height, Math.min(height, Math.trunc(shiftZ)));
      if (sx === 0 && sz === 0) return;
      wasm.scrollShallowWater(
        grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
        width, height, sx, sz, inflow.eta, inflow.u, inflow.w,
      );
      fieldVersion += 1;
    },
    step({ dt, g, H, originX, originZ, events, edgeEta }) {
      // A NaN dt slips past `dt <= 0` checks and writes NaN into every cell
      // for good. swe.cpp rejects it too; this keeps it off the boundary.
      // Only the solver step is skipped: events carry their own dt.
      const solve = Number.isFinite(dt) && dt > 0;
      let integrated = 0;
      if (solve && edgeEta !== undefined) {
        integrated = wasm.stepShallowWaterInflow(grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr, width, height, dt, g, dx, H, edgeEta);
      } else if (solve) {
        integrated = wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr, width, height, dt, g, dx, H);
      }
      // A rejected step (0) integrated nothing either; the caller's dt is
      // re-queued all the same, and the dev warning names the call.
      if (solve) {
        if (integrated === 0) warnRejected('stepShallowWater', `dt=${dt} g=${g} dx=${dx} H=${H}`);
        shortfall += Math.max(0, dt - integrated);
      }
      for (const e of events) {
        const status = wasm.applySWEEvent(
          grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
          width, height, dx, originX, originZ, H,
          e.kind, e.cx, e.cz, e.radius, e.strength, e.dt,
        );
        if (status !== WS_OK) warnRejected('applySWEEvent', `kind=${e.kind}`);
      }
      fieldVersion += 1;
    },
    takeShortfall() {
      const owed = shortfall;
      shortfall = 0;
      return owed;
    },
    packSurface(meanDepth) {
      const status = wasm.packSurfaceField(
        grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr, width, height, meanDepth, dx, surfacePtr,
      );
      // Rejected (a non-finite meanDepth): the plane keeps its last packing.
      if (status !== WS_OK) warnRejected('packSurfaceField', `meanDepth=${meanDepth}`);
      return surface;
    },
    dispose() {
      wasm.freeGrid(surfacePtr);
      grid.dispose();
    },
  };
}
