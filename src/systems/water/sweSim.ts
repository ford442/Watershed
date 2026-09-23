/**
 * sweSim — one live shallow-water field per session, on one backend (#435).
 *
 * `WaterForceSystem` drives the field through this interface so the frame
 * loop is the same whether the solver is the C++ WASM stepper or its WGSL twin
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
import type { SWEGrid, WatershedNativeModule } from './WatershedWasm';
import { createSWEGrid } from './WatershedWasm';
import type { SweSimBackend } from './sweBackend';

/** One `applySWEEvent` call, in world XZ (ABI 8 kinds: 0 inflow … 3 roughness). */
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
  /** Grid origin in world XZ — the window is player-centred and moves. */
  originX: number;
  originZ: number;
  /** Authored hydro events applied after the step, in this order. */
  events: readonly SweEventCall[];
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
  /** Add to η at a cell before the next step (splash disturbances). */
  addSurface(index: number, amount: number): void;
  /** One CFL-clamped solver step, then `input.events`. */
  step(input: SweStepInput): void;
  dispose(): void;
}

/** The C++ stepper on the WASM heap — the WebGL2 (and default) path. */
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

  return {
    backend: 'wasm',
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
      grid.h[index] += amount;
    },
    step({ dt, g, H, originX, originZ, events }) {
      wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr, width, height, dt, g, dx, H);
      for (const e of events) {
        wasm.applySWEEvent(
          grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
          width, height, dx, originX, originZ, H,
          e.kind, e.cx, e.cz, e.radius, e.strength, e.dt,
        );
      }
      fieldVersion += 1;
    },
    dispose() {
      grid.dispose();
    },
  };
}
