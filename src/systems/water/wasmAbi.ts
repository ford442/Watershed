/**
 * wasmAbi.ts — the TypeScript half of the watershed_native C ABI (#467).
 *
 * `emscripten/bindings.cpp` exports plain `extern "C"` functions named
 * `ws_<name>`; the glue exposes them as `Module._ws_<name>`. `WASM_ABI` below
 * is the one table that lists them: `bindNativeModule` binds every entry onto
 * a `WatershedNativeModule`, and the integration tests assert every entry
 * exists in the binary with the declared arity. Scalar exports are bound
 * directly (no cwrap, no wrapper closure). The three results that used to be
 * Embind value objects take a trailing out-pointer; the binding passes a
 * scratch block reserved once per module and reads it back into an object.
 *
 * Changing a signature means: bindings.cpp, this table, the interface below,
 * ws_getVersion() / WASM_ABI_VERSION, and WASM.md — together.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** 3-component float vector returned by computeFlowForce. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface NativeWaterForceResult {
  forceX: number;
  forceY: number;
  forceZ: number;
  buoyancy: number;
  drag: number;
  flow: number;
  turbulence: number;
  submergedRatio: number;
}

export interface NativeWaterForceSample {
  position: Vec3;
  velocity: Vec3;
  flowDirection: { x: number; z: number };
}

export interface NativeWaterForceConfig {
  flowSpeed: number;
  waterLevel: number;
  raftMass: number;
  raftVolume: number;
  dragCoefficient: number;
  frontalArea: number;
  sideArea: number;
  timeSeconds: number;
  turbulenceStrength: number;
  turbulenceFrequency: number;
}

/** routedEdgeState result (ABI 10+). */
export interface RoutedEdge {
  /** Free-surface perturbation at the upstream edge (m), the `h` datum. */
  eta: number;
  /** Downstream (−Z) inflow speed of that stage over a zero bed (m/s). */
  speed: number;
}

// ---------------------------------------------------------------------------
// Constants mirrored from the C++ headers
// ---------------------------------------------------------------------------

/** ABI this table describes — ws_getVersion() in bindings.cpp. */
export const WASM_ABI_VERSION = 12;

/**
 * Minimum ABI accepted. ABI 12 replaced Embind with the C ABI, so nothing
 * older can be bound at all: the floor is the table's own version.
 */
export const MIN_WASM_ABI_VERSION = 12;

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in common.h. */
export const WATER_FORCE_INPUT_STRIDE = 8;
export const WATER_FORCE_OUTPUT_STRIDE = 8;

/** SoA planes in allocateParticleSoA (px…scale). Mirrored by PARTICLE_SOA_PLANES in particles.h. */
export const PARTICLE_SOA_PLANES = 9;

/** Reservoirs per routed segment — ROUTING_SUBREACHES in emscripten/routing.h. */
export const ROUTING_SUBREACHES = 4;

/**
 * Typed view into WASM linear memory that survives ALLOW_MEMORY_GROWTH.
 * Growth replaces the ArrayBuffer; prior views detach (byteLength === 0)
 * and reads/writes go nowhere with no throw. Reuse `prev` when it still
 * aliases the live heap; otherwise rebuild.
 */
export function heapF32(
  mod: { HEAPF32: Float32Array },
  ptr: number,
  count: number,
  prev?: Float32Array,
): Float32Array {
  if (prev && prev.byteLength !== 0 && prev.buffer === mod.HEAPF32.buffer) {
    return prev;
  }
  return new Float32Array(mod.HEAPF32.buffer, ptr, count);
}

// ---------------------------------------------------------------------------
// The bound module
// ---------------------------------------------------------------------------

/**
 * The module as game code sees it. Pointers are WASM heap byte offsets from
 * allocateGrid / allocateParticleSoA. Field conventions (h is a free-surface
 * perturbation, b the bed above the floor datum, …) are documented in
 * emscripten/swe.h and WASM.md.
 */
export interface WatershedNativeModule {
  // Emscripten typed heap views (the glue replaces them on memory growth)
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;

  /** ABI version (12: plain C ABI). */
  getVersion(): number;

  // ---- Water forces ----
  calculateBuoyancyAndDrag(
    raftMass: number, submergedVolume: number,
    waterVelocityX: number, waterVelocityZ: number,
  ): number;

  calculateWaterForce(
    posX: number, posY: number, posZ: number,
    velX: number, velY: number, velZ: number,
    flowDirX: number, flowDirZ: number,
    flowSpeed: number,
    waterLevel: number,
    raftMass: number,
    raftVolume: number,
    dragCoefficient: number,
    frontalArea: number,
    sideArea: number,
    timeSeconds: number,
    turbulenceStrength: number,
    turbulenceFrequency: number,
  ): NativeWaterForceResult;

  /**
   * Batch ABI.
   *   input  stride 8: [posX, posY, posZ, velX, velY, velZ, flowDirX, flowDirZ]
   *   output stride 8: [forceX, forceY, forceZ, buoyancy, drag, flow, turbulence, submergedRatio]
   */
  computeWaterForcesBatch(
    inputPtr: number, outputPtr: number, sampleCount: number,
    flowSpeed: number, waterLevel: number,
    raftMass: number, raftVolume: number,
    dragCoefficient: number, frontalArea: number, sideArea: number,
    timeSeconds: number,
    turbulenceStrength: number, turbulenceFrequency: number,
  ): void;

  /** Archimedes buoyancy F_b = ρ · V · g (N). */
  computeBuoyancy(submergedVolume: number, waterDensity: number, gravity: number): number;

  /** Drag magnitude F_d = ½ · ρ · |v|² · C_d · A (N). */
  computeDragForce(vx: number, vy: number, vz: number, cd: number, area: number, density: number): number;

  /** River-current force on a partially submerged object (N). */
  computeFlowForce(
    vx: number, vy: number, vz: number,
    fx: number, fy: number, fz: number,
    flowSpeed: number, mass: number, submergedRatio: number,
    cd: number, area: number,
  ): Vec3;

  // ---- Shallow water ----
  /** Advance the nonlinear SWE grid one CFL-clamped step. `bPtr` 0 = flat bed. */
  stepShallowWater(
    hPtr: number, uPtr: number, wPtr: number, bPtr: number,
    width: number, height: number,
    dt: number, g: number, dx: number, H: number,
  ): void;

  /** stepShallowWater with the upstream (+Z, last-row) edge held at the routed stage `edgeEta`. */
  stepShallowWaterInflow(
    hPtr: number, uPtr: number, wPtr: number, bPtr: number,
    width: number, height: number,
    dt: number, g: number, dx: number, H: number,
    edgeEta: number,
  ): void;

  /** Authored hydro source term (kind 0 inflow, 1 vortex, 2 braid, 3 roughness). */
  applySWEEvent(
    hPtr: number, uPtr: number, wPtr: number, bPtr: number,
    width: number, height: number,
    dx: number, originX: number, originZ: number, H: number,
    kind: number, cx: number, cz: number, radius: number, strength: number, dt: number,
  ): void;

  /**
   * Scroll h / u / w / b by whole cells: `dst[x, z] = src[x - shiftX, z - shiftZ]`.
   * Entering cells take (inflowEta, inflowU, inflowW); `bPtr` may be 0.
   */
  scrollShallowWater(
    hPtr: number, uPtr: number, wPtr: number, bPtr: number,
    width: number, height: number,
    shiftX: number, shiftZ: number,
    inflowEta: number, inflowU: number, inflowW: number,
  ): void;

  /** Pre-size the solver scratch so no step / scroll allocates mid-call. */
  reserveShallowWaterScratch(width: number, height: number): void;

  /** Allocate `count` zero-initialised floats; returns a byte offset. */
  allocateGrid(count: number): number;
  /** Free a pointer returned by allocateGrid. */
  freeGrid(ptr: number): void;

  // ---- Channel routing (arrays are allocateGrid pointers) ----
  routeReachSteady(
    lengthsPtr: number, slopesPtr: number, widthsPtr: number, nSeg: number,
    Q: number, storagePtr: number, outflowPtr: number,
  ): void;
  routeReach(
    lengthsPtr: number, slopesPtr: number, widthsPtr: number, nSeg: number,
    inflowQ: number, dt: number, storagePtr: number, outflowPtr: number,
  ): void;
  routeReachTravelTime(
    lengthsPtr: number, slopesPtr: number, widthsPtr: number, nSeg: number,
    Q: number, lagPtr: number,
  ): void;
  /** Routed discharge → edge stage η (m) and inflow speed (m/s). Qref ↦ exactly (0, 0). */
  routedEdgeState(Q: number, Qref: number, H: number, g: number): RoutedEdge;

  // ---- gpu-chores (not SWE) ----
  reduceF32Grid(srcPtr: number, count: number, out3Ptr: number): void;
  histogramF32(srcPtr: number, count: number, rangeMin: number, rangeMax: number, binsPtr: number): void;
  lumaHistogramU8(rgbaPtr: number, pixelCount: number, binsPtr: number): void;
  downsampleF32(srcPtr: number, srcW: number, srcH: number, dstPtr: number, dstW: number, dstH: number): void;
  blurSeparableF32(srcPtr: number, dstPtr: number, width: number, height: number): void;

  // ---- Particle SoA ----
  allocateParticleSoA(capacity: number): number;
  freeParticleSoA(ptr: number): void;
  initWaterfallParticles(
    base: number, capacity: number, active: number,
    width: number, height: number, depthZ: number,
    fanSpreadRad: number, seed: number,
  ): number;
  stepWaterfallParticles(
    base: number, capacity: number, active: number,
    dt: number, width: number, height: number, depthZ: number, seed: number,
  ): number;
  stepSplashParticles(
    base: number, capacity: number, count: number,
    dt: number, gravityY: number, damp: number,
  ): void;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

type HeapViewName = 'HEAPF32' | 'HEAP32' | 'HEAPU8';
export type WasmAbiFunctionName = Exclude<keyof WatershedNativeModule, HeapViewName>;

type OutReader = (f32: Float32Array, at: number) => unknown;

export interface WasmAbiEntry {
  /** Parameter count of `ws_<name>` in bindings.cpp, out-pointer included. */
  readonly arity: number;
  /** `u32` results come back from wasm as signed i32 and are re-read unsigned. */
  readonly returns?: 'u32';
  /** Floats written through the trailing out-pointer, and how to read them back. */
  readonly out?: { readonly floats: number; readonly read: OutReader };
}

const readWaterForce: OutReader = (f, i) => ({
  forceX: f[i], forceY: f[i + 1], forceZ: f[i + 2],
  buoyancy: f[i + 3], drag: f[i + 4], flow: f[i + 5],
  turbulence: f[i + 6], submergedRatio: f[i + 7],
} satisfies NativeWaterForceResult);
const readVec3: OutReader = (f, i) => ({ x: f[i], y: f[i + 1], z: f[i + 2] } satisfies Vec3);
const readRoutedEdge: OutReader = (f, i) => ({ eta: f[i], speed: f[i + 1] } satisfies RoutedEdge);

/** Every export of the module, keyed by its TS name; the C symbol is `ws_<name>`. */
export const WASM_ABI = {
  getVersion: { arity: 0 },
  calculateBuoyancyAndDrag: { arity: 4 },
  calculateWaterForce: { arity: 19, out: { floats: 8, read: readWaterForce } },
  computeWaterForcesBatch: { arity: 13 },
  computeBuoyancy: { arity: 3 },
  computeDragForce: { arity: 6 },
  computeFlowForce: { arity: 12, out: { floats: 3, read: readVec3 } },
  stepShallowWater: { arity: 10 },
  stepShallowWaterInflow: { arity: 11 },
  applySWEEvent: { arity: 16 },
  scrollShallowWater: { arity: 11 },
  reserveShallowWaterScratch: { arity: 2 },
  allocateGrid: { arity: 1 },
  freeGrid: { arity: 1 },
  routeReach: { arity: 8 },
  routeReachSteady: { arity: 7 },
  routeReachTravelTime: { arity: 6 },
  routedEdgeState: { arity: 5, out: { floats: 2, read: readRoutedEdge } },
  reduceF32Grid: { arity: 3 },
  histogramF32: { arity: 5 },
  lumaHistogramU8: { arity: 3 },
  downsampleF32: { arity: 6 },
  blurSeparableF32: { arity: 4 },
  allocateParticleSoA: { arity: 1 },
  freeParticleSoA: { arity: 1 },
  initWaterfallParticles: { arity: 8, returns: 'u32' },
  stepWaterfallParticles: { arity: 8, returns: 'u32' },
  stepSplashParticles: { arity: 6 },
} as const satisfies Record<WasmAbiFunctionName, WasmAbiEntry>;

/** C symbol as the glue exposes it. */
export function wasmExportName(name: WasmAbiFunctionName): `_ws_${WasmAbiFunctionName}` {
  return `_ws_${name}`;
}

type RawExport = (...args: number[]) => number;

/** What the Emscripten factory resolves to: heap views plus `_ws_*` exports. */
export interface RawWatershedModule {
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  [exportName: `_ws_${string}`]: RawExport | undefined;
}

/** A required `_ws_*` export the binary does not have. */
export class WasmAbiMismatchError extends Error {
  constructor(detail: string) {
    super(`watershed_native ABI mismatch: ${detail}`);
    this.name = 'WasmAbiMismatchError';
  }
}

/** Names in WASM_ABI with no `_ws_*` function on `raw`. */
export function missingAbiExports(raw: Partial<RawWatershedModule>): WasmAbiFunctionName[] {
  const record = raw as Record<string, unknown>;
  return (Object.keys(WASM_ABI) as WasmAbiFunctionName[])
    .filter((name) => typeof record[wasmExportName(name)] !== 'function');
}

/**
 * Bind the raw factory result to the `WatershedNativeModule` surface. Throws
 * `WasmAbiMismatchError` when any table entry is missing — the loader treats
 * that like a stamp mismatch (TS fallback, HUD banner).
 */
export function bindNativeModule(raw: RawWatershedModule): WatershedNativeModule {
  const missing = missingAbiExports(raw);
  if (missing.length > 0) {
    throw new WasmAbiMismatchError(`missing ${missing.map((n) => wasmExportName(n)).join(', ')}`);
  }
  const fn = (name: WasmAbiFunctionName): RawExport => raw[wasmExportName(name)] as RawExport;

  // One scratch block for every out-pointer result. Calls are synchronous and
  // each reader copies the floats out before returning, so they can share it.
  const outFloats = Math.max(
    ...Object.values(WASM_ABI).map((e: WasmAbiEntry) => e.out?.floats ?? 0),
  );
  const outPtr = fn('allocateGrid')(outFloats);
  const outAt = outPtr >>> 2;

  const bound: Record<string, unknown> = {};
  Object.defineProperties(bound, {
    HEAPF32: { get: () => raw.HEAPF32, enumerable: true },
    HEAP32: { get: () => raw.HEAP32, enumerable: true },
    HEAPU8: { get: () => raw.HEAPU8, enumerable: true },
  });

  for (const name of Object.keys(WASM_ABI) as WasmAbiFunctionName[]) {
    const entry: WasmAbiEntry = WASM_ABI[name];
    const call = fn(name);
    const out = entry.out;
    if (out) {
      bound[name] = (...args: number[]) => {
        call(...args, outPtr);
        return out.read(raw.HEAPF32, outAt);
      };
    } else if (entry.returns === 'u32') {
      bound[name] = (...args: number[]) => call(...args) >>> 0;
    } else {
      bound[name] = call;
    }
  }
  return bound as unknown as WatershedNativeModule;
}
