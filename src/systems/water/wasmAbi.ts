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
export const WASM_ABI_VERSION = 14;

/**
 * Minimum ABI accepted. ABI 12 replaced Embind with the C ABI, so nothing
 * older can be bound at all; ABI 13 (#487) added the terrain exports and ABI
 * 14 lateral routing inflow, and bindNativeModule requires every table entry,
 * so the floor is the table's own version.
 */
export const MIN_WASM_ABI_VERSION = 14;

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in common.h. */
export const WATER_FORCE_INPUT_STRIDE = 8;
export const WATER_FORCE_OUTPUT_STRIDE = 8;

/** SoA planes in allocateParticleSoA (px…scale). Mirrored by PARTICLE_SOA_PLANES in particles.h. */
export const PARTICLE_SOA_PLANES = 9;

/** Reservoirs per routed segment — ROUTING_SUBREACHES in emscripten/routing.h. */
export const ROUTING_SUBREACHES = 4;

/**
 * `count` floats of WASM linear memory at byte offset `ptr`. The heap is a
 * fixed size (ALLOW_MEMORY_GROWTH=0, emscripten/CMakeLists.txt), so its
 * ArrayBuffer never changes: make the view once, when the block is
 * allocated, and keep it for the block's life.
 */
export function heapF32(mod: { HEAPF32: Float32Array }, ptr: number, count: number): Float32Array {
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
  // Emscripten typed heap views: one fixed-size heap, so bound once
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;

  /** ABI version (12: plain C ABI; 13: terrain tiles). */
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
  /**
   * routeReach plus `lateralPtr` (nSeg floats, m³/s) joining each segment at
   * its top (ABI 14). 0 = no plane = routeReach.
   */
  routeReachLateral(
    lengthsPtr: number, slopesPtr: number, widthsPtr: number, nSeg: number,
    inflowQ: number, lateralPtr: number, dt: number, storagePtr: number, outflowPtr: number,
  ): void;
  routeReachTravelTime(
    lengthsPtr: number, slopesPtr: number, widthsPtr: number, nSeg: number,
    Q: number, lagPtr: number,
  ): void;
  /** Routed discharge → edge stage η (m) and inflow speed (m/s). Qref ↦ exactly (0, 0). */
  routedEdgeState(Q: number, Qref: number, H: number, g: number): RoutedEdge;

  // ---- Terrain tiles (ABI 13, #487; layout in emscripten/terrain.h) ----
  /**
   * Fill TERRAIN_TILE_PLANES plane-major planes at `outPtr`. `channelPtr` holds
   * `channelCount` packed samples (0 = default channel). Returns the vertex
   * count, or 0 on invalid input.
   */
  buildTerrainTile(
    pathLength: number, canyonWidth: number, waterWidth: number,
    segmentsX: number, segmentsZ: number, profile: number,
    rockNoise: number, hasTube: number, tubeCurl: number, tubeCeiling: number,
    channelPtr: number, channelCount: number, outPtr: number,
  ): number;
  /** One plane of wall-shell heights at `outPtr`. Returns the vertex count, or 0. */
  buildWallShell(
    pathLength: number, shellWidth: number, segmentsX: number, segmentsZ: number,
    profile: number, wallHeight: number, segmentId: number, outPtr: number,
  ): number;

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
  routeReachLateral: { arity: 9 },
  routeReachSteady: { arity: 7 },
  routeReachTravelTime: { arity: 6 },
  routedEdgeState: { arity: 5, out: { floats: 2, read: readRoutedEdge } },
  buildTerrainTile: { arity: 13 },
  buildWallShell: { arity: 8 },
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

/** Marker in a WasmHeapExhaustedError message (nativeOwner.ts classifies it for the HUD). */
export const HEAP_EXHAUSTED_MARKER = 'heap exhausted';

/**
 * `allocateGrid(count > 0)` returned 0 (#502): the heap could not grow to
 * `count` floats. Thrown by the bound `allocateGrid` instead of handing a 0
 * offset on to a writer — in wasm, address 0 is writable, so a null grid
 * silently corrupts low memory.
 */
export class WasmHeapExhaustedError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(`watershed_native ${HEAP_EXHAUSTED_MARKER}: allocateGrid(${count}) returned 0`);
    this.name = 'WasmHeapExhaustedError';
    this.count = count;
  }
}

/**
 * `allocateGrid` for each count, all or nothing: when one allocation throws,
 * the blocks already allocated are freed before the error propagates, so a
 * partial failure (the second of two grids) does not leak the first.
 */
export function allocateGrids(
  wasm: Pick<WatershedNativeModule, 'allocateGrid' | 'freeGrid'>,
  counts: readonly number[],
): number[] {
  const ptrs: number[] = [];
  try {
    for (const count of counts) ptrs.push(count > 0 ? wasm.allocateGrid(count) : 0);
  } catch (error) {
    for (const ptr of ptrs) if (ptr) wasm.freeGrid(ptr);
    throw error;
  }
  return ptrs;
}

export function isWasmHeapExhaustedError(error: unknown): boolean {
  return error instanceof WasmHeapExhaustedError
    || (error instanceof Error && error.message.includes(HEAP_EXHAUSTED_MARKER));
}

/**
 * Exports whose JS arity disagrees with the table (#502). The release glue
 * wraps each export as `(a, c, …) => …` with exactly the C parameter count,
 * so `fn.length` is the binary's arity; a length of 0 is an unwrapped variadic
 * shim (the ASSERTIONS=2 debug glue, test fakes) and is not checked.
 */
export function arityMismatches(raw: Partial<RawWatershedModule>): string[] {
  const record = raw as Record<string, unknown>;
  const bad: string[] = [];
  for (const name of Object.keys(WASM_ABI) as WasmAbiFunctionName[]) {
    const exported = record[wasmExportName(name)];
    if (typeof exported !== 'function' || exported.length === 0) continue;
    const want = (WASM_ABI[name] as WasmAbiEntry).arity;
    if (exported.length !== want) bad.push(`${wasmExportName(name)} takes ${exported.length}, table says ${want}`);
  }
  return bad;
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
  // Arity parity is a unit test against the committed glue; dev builds also
  // check the binary actually served, so a stale pair fails at bind rather
  // than as a mis-sliced argument list deep in a step.
  if (import.meta.env.DEV) {
    const arity = arityMismatches(raw);
    if (arity.length > 0) throw new WasmAbiMismatchError(`arity ${arity.join('; ')}`);
  }
  const fn = (name: WasmAbiFunctionName): RawExport => raw[wasmExportName(name)] as RawExport;

  // One scratch block for every out-pointer result. Calls are synchronous and
  // each reader copies the floats out before returning, so they can share it.
  const outFloats = Math.max(
    ...Object.values(WASM_ABI).map((e: WasmAbiEntry) => e.out?.floats ?? 0),
  );
  const rawAllocateGrid = fn('allocateGrid');
  const allocateGrid = (count: number): number => {
    const ptr = rawAllocateGrid(count);
    if (ptr === 0 && count > 0) throw new WasmHeapExhaustedError(count);
    return ptr;
  };
  const outPtr = allocateGrid(outFloats);
  const outAt = outPtr >>> 2;
  const heap = raw.HEAPF32;

  // The heap cannot grow, so the glue's views are final: bind them as values.
  const bound: Record<string, unknown> = {
    HEAPF32: raw.HEAPF32,
    HEAP32: raw.HEAP32,
    HEAPU8: raw.HEAPU8,
  };

  for (const name of Object.keys(WASM_ABI) as WasmAbiFunctionName[]) {
    const entry: WasmAbiEntry = WASM_ABI[name];
    const call = fn(name);
    const out = entry.out;
    if (name === 'allocateGrid') {
      bound[name] = allocateGrid;
    } else if (out) {
      bound[name] = (...args: number[]) => {
        call(...args, outPtr);
        return out.read(heap, outAt);
      };
    } else if (entry.returns === 'u32') {
      bound[name] = (...args: number[]) => call(...args) >>> 0;
    } else {
      bound[name] = call;
    }
  }
  return bound as unknown as WatershedNativeModule;
}
