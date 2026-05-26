/**
 * WatershedWasm.test.ts
 *
 * Tests for the WatershedWasm TypeScript bindings.
 *
 * Because the C++ WASM module is not available in the Jest / jsdom environment,
 * these tests focus on:
 *   1. Module exports — verifying that all expected symbols are exported.
 *   2. Pure-TS fallback functions — buoyancyFallback, dragForceFallback.
 *   3. Mock WASM module — validates createSWEGrid memory management and the
 *      full API surface against a lightweight mock.
 *   4. Physics correctness — reference values derived from the C++ formulas.
 */

import {
  buoyancyFallback,
  dragForceFallback,
  createSWEGrid,
  getWasm,
  type Vec3,
  type WatershedNativeModule,
  type SWEGrid,
} from '../WatershedWasm';

// ---------------------------------------------------------------------------
// 1. Export surface
// ---------------------------------------------------------------------------

describe('WatershedWasm — module exports', () => {
  it('exports getWasm function', () => {
    expect(typeof getWasm).toBe('function');
  });

  it('exports createSWEGrid function', () => {
    expect(typeof createSWEGrid).toBe('function');
  });

  it('exports buoyancyFallback function', () => {
    expect(typeof buoyancyFallback).toBe('function');
  });

  it('exports dragForceFallback function', () => {
    expect(typeof dragForceFallback).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. buoyancyFallback — physics correctness
// ---------------------------------------------------------------------------

describe('buoyancyFallback', () => {
  // F_b = ρ_water × V × g
  // 1 m³ @ 1000 kg/m³ @ 9.80665 m/s² = 9806.65 N
  it('returns F_b = ρ × V × g for a 1 m³ fully-submerged volume', () => {
    const force = buoyancyFallback(1.0, 1000, 9.80665);
    expect(force).toBeCloseTo(9806.65, 1);
  });

  it('scales linearly with submerged volume', () => {
    const f1 = buoyancyFallback(1.0, 1000, 9.80665);
    const f2 = buoyancyFallback(2.0, 1000, 9.80665);
    expect(f2).toBeCloseTo(f1 * 2, 3);
  });

  it('returns 0 for zero volume', () => {
    expect(buoyancyFallback(0, 1000, 9.8)).toBe(0);
  });

  it('returns 0 for negative volume', () => {
    expect(buoyancyFallback(-0.5, 1000, 9.8)).toBe(0);
  });

  it('uses default water density 1000 kg/m³ when not specified', () => {
    const withDefault  = buoyancyFallback(1.0);
    const withExplicit = buoyancyFallback(1.0, 1000, 9.80665);
    expect(withDefault).toBeCloseTo(withExplicit, 3);
  });

  it('honours custom fluid densities (e.g. seawater 1025 kg/m³)', () => {
    const force = buoyancyFallback(1.0, 1025, 9.80665);
    expect(force).toBeCloseTo(10051.82, 1);
  });
});

// ---------------------------------------------------------------------------
// 3. dragForceFallback — physics correctness
// ---------------------------------------------------------------------------

describe('dragForceFallback', () => {
  // F_d = ½ × ρ × |v|² × C_d × A
  // v = [1,0,0] m/s, ρ = 1000, C_d = 0.47, A = 1 m²
  // F_d = 0.5 × 1000 × 1 × 0.47 × 1 = 235 N
  it('computes drag for v=[1,0,0], Cd=0.47, A=1, ρ=1000', () => {
    const force = dragForceFallback(1, 0, 0, 0.47, 1.0, 1000);
    expect(force).toBeCloseTo(235, 1);
  });

  it('scales with v² (doubling speed quadruples drag)', () => {
    const f1 = dragForceFallback(1, 0, 0, 0.47, 1.0, 1000);
    const f2 = dragForceFallback(2, 0, 0, 0.47, 1.0, 1000);
    expect(f2).toBeCloseTo(f1 * 4, 3);
  });

  it('returns 0 for zero velocity', () => {
    expect(dragForceFallback(0, 0, 0, 0.47, 1.0, 1000)).toBe(0);
  });

  it('is independent of velocity direction (uses magnitude)', () => {
    const fX = dragForceFallback(2, 0, 0, 0.47, 1.0, 1000);
    const fZ = dragForceFallback(0, 0, 2, 0.47, 1.0, 1000);
    expect(fX).toBeCloseTo(fZ, 5);
  });

  it('scales linearly with C_d', () => {
    const f1 = dragForceFallback(1, 0, 0, 0.47, 1.0, 1000);
    const f2 = dragForceFallback(1, 0, 0, 0.94, 1.0, 1000);
    expect(f2).toBeCloseTo(f1 * 2, 3);
  });

  it('scales linearly with area', () => {
    const f1 = dragForceFallback(1, 0, 0, 0.47, 1.0, 1000);
    const f2 = dragForceFallback(1, 0, 0, 0.47, 3.0, 1000);
    expect(f2).toBeCloseTo(f1 * 3, 3);
  });
});

// ---------------------------------------------------------------------------
// 4. Mock WatershedNativeModule + createSWEGrid
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock of WatershedNativeModule backed by a real ArrayBuffer
 * so that Float32Array views work correctly.
 */
function buildMockModule(): WatershedNativeModule {
  // Allocate 1 MB of backing memory to simulate WASM heap
  const HEAP_SIZE = 1024 * 1024;
  const buffer    = new ArrayBuffer(HEAP_SIZE);
  const HEAPF32   = new Float32Array(buffer);
  const allocations = new Map<number, number>(); // ptr → count
  let   nextPtr = 4; // start at byte 4 (avoid null-ptr confusion)

  const mod: WatershedNativeModule = {
    HEAPF32,
    HEAP32:  new Int32Array(buffer),
    HEAPU8:  new Uint8Array(buffer),

    getVersion:  () => 1,

    computeBuoyancy(v, rho, g) { return rho * v * g; },

    computeDragForce(vx, vy, vz, cd, area, density) {
      const spd = vx*vx + vy*vy + vz*vz;
      return spd <= 0 ? 0 : 0.5 * density * spd * cd * area;
    },

    computeFlowForce(vx, vy, vz, fx, fy, fz, spd, _m, sub, cd, area): Vec3 {
      const rwx = fx*spd - vx;
      const rwy = fy*spd - vy;
      const rwz = fz*spd - vz;
      const sq  = rwx*rwx + rwy*rwy + rwz*rwz;
      if (sq <= 0) return { x: 0, y: 0, z: 0 };
      const mag = Math.sqrt(sq);
      const f   = 0.5 * 1000 * sq * cd * area * Math.min(1, Math.max(0, sub));
      return { x: f*rwx/mag, y: f*rwy/mag, z: f*rwz/mag };
    },

    stepShallowWater(hPtr, uPtr, wPtr, w, h, dt, g, dx, H) {
      // Minimal no-op: just verify ptrs are valid numbers
      if (!Number.isFinite(hPtr) || !Number.isFinite(uPtr) ||
          !Number.isFinite(wPtr) || w <= 0 || h <= 0) {
        throw new Error('stepShallowWater: invalid arguments');
      }
    },

    allocateGrid(count): number {
      if (count <= 0) return 0;
      const byteCount = count * 4;
      const ptr = nextPtr;
      // Zero-initialise the region
      new Float32Array(buffer, ptr, count).fill(0);
      allocations.set(ptr, count);
      // Advance pointer with 4-byte alignment for Float32Array compatibility
      nextPtr = ptr + byteCount + (4 - (byteCount % 4)) % 4;
      return ptr;
    },

    freeGrid(ptr): void {
      allocations.delete(ptr);
    },
  };

  return mod;
}

describe('createSWEGrid', () => {
  let mod: WatershedNativeModule;

  beforeEach(() => {
    mod = buildMockModule();
  });

  it('creates a grid with correct dimensions', () => {
    const grid = createSWEGrid(mod, 8, 4, 0.5);
    expect(grid.width).toBe(8);
    expect(grid.height).toBe(4);
    expect(grid.dx).toBe(0.5);
    grid.dispose();
  });

  it('provides Float32Array views of length width × height', () => {
    const grid = createSWEGrid(mod, 8, 4, 0.5);
    const count = 8 * 4;
    expect(grid.h.length).toBe(count);
    expect(grid.u.length).toBe(count);
    expect(grid.w.length).toBe(count);
    grid.dispose();
  });

  it('initialises all fields to zero', () => {
    const grid = createSWEGrid(mod, 8, 4, 0.5);
    expect(grid.h.every(v => v === 0)).toBe(true);
    expect(grid.u.every(v => v === 0)).toBe(true);
    expect(grid.w.every(v => v === 0)).toBe(true);
    grid.dispose();
  });

  it('writes to the h view are visible at hPtr in HEAPF32', () => {
    const grid = createSWEGrid(mod, 4, 4, 0.5);
    grid.h[0] = 3.14;
    // The same buffer underlies both the grid view and HEAPF32
    const heapVal = new Float32Array(mod.HEAPF32.buffer, grid.hPtr, 1)[0];
    expect(heapVal).toBeCloseTo(3.14, 4);
    grid.dispose();
  });

  it('three grids have distinct, non-overlapping pointers', () => {
    const grid = createSWEGrid(mod, 4, 4, 0.5);
    expect(grid.hPtr).not.toBe(grid.uPtr);
    expect(grid.uPtr).not.toBe(grid.wPtr);
    expect(grid.hPtr).not.toBe(grid.wPtr);
    grid.dispose();
  });

  it('dispose() does not throw', () => {
    const grid = createSWEGrid(mod, 4, 4, 0.5);
    expect(() => grid.dispose()).not.toThrow();
  });

  it('passes valid args to stepShallowWater without throwing', () => {
    const grid = createSWEGrid(mod, 4, 4, 0.5);
    expect(() =>
      mod.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr,
        grid.width, grid.height, 0.016, 9.8, grid.dx, 1.0)
    ).not.toThrow();
    grid.dispose();
  });

  it('uses default dx = 0.5 when omitted', () => {
    const grid = createSWEGrid(mod, 4, 4);
    expect(grid.dx).toBe(0.5);
    grid.dispose();
  });
});

// ---------------------------------------------------------------------------
// 5. Mock module physics — verify computeFlowForce direction
// ---------------------------------------------------------------------------

describe('mock computeFlowForce', () => {
  let mod: WatershedNativeModule;

  beforeEach(() => {
    mod = buildMockModule();
  });

  it('returns zero force when object moves with the current', () => {
    // Object moving exactly at flow speed → relative velocity = 0
    const force = mod.computeFlowForce(
      0, 0, -2,   // object vel = (0, 0, -2)
      0, 0, -1,   // flow dir  = (0, 0, -1) (normalised)
      2,          // flowSpeed = 2 m/s
      80, 1.0, 0.47, 1.0
    );
    expect(force.x).toBeCloseTo(0, 5);
    expect(force.y).toBeCloseTo(0, 5);
    expect(force.z).toBeCloseTo(0, 5);
  });

  it('returns zero force when submergedRatio = 0', () => {
    const force = mod.computeFlowForce(
      0, 0, 0,
      0, 0, -1,
      2, 80, 0.0, 0.47, 1.0
    );
    expect(force.x).toBeCloseTo(0, 5);
    expect(force.y).toBeCloseTo(0, 5);
    expect(force.z).toBeCloseTo(0, 5);
  });

  it('returns downstream force when object is stationary', () => {
    // flow in -Z, object stationary → force should push in -Z direction
    const force = mod.computeFlowForce(
      0, 0, 0,    // object vel
      0, 0, -1,   // flow dir
      2,          // flow speed
      80, 1.0, 0.47, 1.0
    );
    expect(force.z).toBeLessThan(0); // pushed downstream (−Z)
  });
});

// ---------------------------------------------------------------------------
// 6. getWasm — lazy-load behaviour (dynamic import is mocked)
// ---------------------------------------------------------------------------

describe('getWasm', () => {
  // We cannot actually load the WASM in Jest/jsdom, but we can verify that
  // getWasm() returns a Promise.
  it('returns a Promise', () => {
    // Reset module-level cache by re-importing via jest module isolation
    // is not straightforward, so we just check the return type.
    const result = getWasm().catch(() => {
      // Expected to reject in jsdom (no /watershed_native.js)
    });
    expect(result).toBeInstanceOf(Promise);
  });
});
