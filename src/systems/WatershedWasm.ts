/**
 * WatershedWasm.ts — TypeScript bindings for the Watershed C++ WASM module
 *
 * Provides a typed, lazy-loaded interface to `public/watershed_native.js`,
 * which is compiled from `emscripten/main.cpp` via `npm run build:wasm`.
 *
 * Quick start
 * -----------
 *   import { getWasm, createSWEGrid } from '../systems/WatershedWasm';
 *
 *   // Load once (e.g. in a useEffect or game-init hook):
 *   const wasm = await getWasm();
 *
 *   // Buoyancy — Archimedes' principle:
 *   const force = wasm.computeBuoyancy(0.5, 1000, 9.80665);
 *
 *   // Shallow-water grid (per-frame simulation):
 *   const grid = createSWEGrid(wasm, 32, 32, 0.5);
 *   grid.h.fill(1.0);  // flat starting surface
 *   // In useFrame / game loop:
 *   wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr,
 *     grid.width, grid.height, delta, 9.8, grid.dx, 1.0);
 *   // When component unmounts:
 *   grid.dispose();
 */

import { getAssetBaseUrl } from '../utils/assetBaseUrl';

// ---------------------------------------------------------------------------
// Native module interface (produced by Embind + MODULARIZE=1)
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

export const WATER_FORCE_INPUT_STRIDE = 8;
export const WATER_FORCE_OUTPUT_STRIDE = 8;

/**
 * Shape of the WASM module after Emscripten initialisation.
 * All numeric heap views share the same underlying ArrayBuffer.
 */
export interface WatershedNativeModule {
  // Emscripten typed heap views
  HEAPF32: Float32Array;
  HEAP32:  Int32Array;
  HEAPU8:  Uint8Array;

  // ---- Module version ----
  /** Returns the integer module version (bump on ABI changes). */
  getVersion(): number;

  calculateBuoyancyAndDrag(
    raftMass: number,
    submergedVolume: number,
    waterVelocityX: number,
    waterVelocityZ: number,
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

  computeWaterForcesBatch(
    inputPtr: number,
    outputPtr: number,
    sampleCount: number,
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
  ): void;

  // ---- Buoyancy physics ----
  /**
   * Compute upward Archimedes buoyancy force.
   * F_b = ρ_water × V_displaced × g
   *
   * @param submergedVolume  Volume below waterline (m³)
   * @param waterDensity     Fluid density — default 1000 kg/m³
   * @param gravity          Gravitational accel — default 9.80665 m/s²
   * @returns Upward force (N)
   */
  computeBuoyancy(submergedVolume: number,
                  waterDensity: number,
                  gravity: number): number;

  // ---- Drag force ----
  /**
   * Compute drag force magnitude.
   * F_d = ½ · ρ · |v|² · C_d · A
   *
   * @param vx, vy, vz   Velocity vector (m/s)
   * @param cd           Drag coefficient (raft ≈ 0.47, person ≈ 1.0)
   * @param area         Cross-sectional area facing flow (m²)
   * @param density      Fluid density (kg/m³)
   * @returns Drag force magnitude (N)
   */
  computeDragForce(vx: number, vy: number, vz: number,
                   cd: number, area: number, density: number): number;

  // ---- Water flow force ----
  /**
   * Compute river-current force on a partially submerged object.
   * Apply the returned Vec3 as an impulse to the Rapier rigid body.
   *
   * @param vx..vz          Object velocity (m/s)
   * @param fx..fz          Current direction (unit vector)
   * @param flowSpeed        River speed (m/s)
   * @param mass            Object mass (kg)
   * @param submergedRatio  Fraction submerged [0, 1]
   * @param cd              Drag coefficient
   * @param area            Cross-sectional area (m²)
   * @returns Force vector (N)
   */
  computeFlowForce(
    vx: number, vy: number, vz: number,
    fx: number, fy: number, fz: number,
    flowSpeed: number,
    mass: number,
    submergedRatio: number,
    cd: number,
    area: number,
  ): Vec3;

  // ---- Shallow Water Equations ----
  /**
   * Advance the linearised SWE grid one time step.
   * Grid pointers must be byte-offsets obtained from allocateGrid().
   *
   * @param hPtr    Height field (WASM heap byte offset)
   * @param uPtr    X-velocity field (WASM heap byte offset)
   * @param wPtr    Z-velocity field (WASM heap byte offset)
   * @param width   Grid columns
   * @param height  Grid rows
   * @param dt      Desired time step (s) — internally CFL-clamped
   * @param g       Gravity (m/s²)
   * @param dx      Cell size (m)
   * @param H       Mean resting water depth for linearisation (m)
   */
  stepShallowWater(
    hPtr: number, uPtr: number, wPtr: number,
    width: number, height: number,
    dt: number, g: number, dx: number, H: number,
  ): void;

  // ---- Memory helpers ----
  /**
   * Allocate `count` zero-initialised floats in WASM heap.
   * @returns Byte-offset pointer; use with HEAPF32.
   */
  allocateGrid(count: number): number;

  /** Free a pointer returned by allocateGrid. */
  freeGrid(ptr: number): void;
}

// ---------------------------------------------------------------------------
// Factory type (MODULARIZE=1 + EXPORT_NAME='createWatershedNative')
// ---------------------------------------------------------------------------
type WatershedNativeFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<WatershedNativeModule>;

// ---------------------------------------------------------------------------
// Singleton loader
// ---------------------------------------------------------------------------
let _modulePromise: Promise<WatershedNativeModule> | null = null;

function resolvePublicAsset(path: string): string {
  const rawBase = getAssetBaseUrl();
  const baseWithSlash = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const envBase =
    typeof process !== 'undefined' && typeof process.env.WATERSHED_WASM_BASE === 'string'
      ? process.env.WATERSHED_WASM_BASE
      : undefined;
  const runtimeHref =
    typeof window !== 'undefined'
      ? window.location.href
      : typeof globalThis.location?.href === 'string'
        ? globalThis.location.href
        : envBase;
  const absoluteBase =
    runtimeHref
      ? new URL(baseWithSlash, runtimeHref).href
      : baseWithSlash;
  return new URL(path, absoluteBase).href;
}

/**
 * Load (or return the cached) Watershed WASM module.
 *
 * Safe to call many times — subsequent calls return the same promise.
 * The module is loaded from `/watershed_native.js` (Vite serves this from
 * the `public/` directory).
 *
 * @returns Resolved WatershedNativeModule
 */
export async function getWasm(): Promise<WatershedNativeModule> {
  if (_modulePromise) return _modulePromise;

  _modulePromise = (async () => {
    // Dynamic import keeps the glue JS out of the main bundle.
    // webpackIgnore comment is harmless with Vite but prevents bundler errors
    // if the project is ever processed by webpack.
    // Use eval-like dynamic import to prevent bundlers from trying to resolve
    // the WASM glue JS at build time (the file is produced by Emscripten).
    const wasmJsUrl = resolvePublicAsset('watershed_native.js');
    const mod = typeof process !== 'undefined' && process.env.WATERSHED_WASM_INTEGRATION === '1'
      ? await import(/* @vite-ignore */ wasmJsUrl) as { default: WatershedNativeFactory }
      : await (new Function('url', 'return import(url)') as (url: string) => Promise<unknown>)(wasmJsUrl) as {
          default: WatershedNativeFactory;
        };

    const factory = mod.default;
    return factory({
      locateFile: (path: string, _prefix: string) => {
        // Direct the glue JS to load all auxiliary files (including .wasm)
        // from the public root, regardless of the Vite base path.
        return resolvePublicAsset(path);
      },
    });
  })();

  return _modulePromise;
}

// ---------------------------------------------------------------------------
// Shallow Water Equations (SWE) grid helper
// ---------------------------------------------------------------------------

/** A SWE simulation grid allocated in WASM linear memory. */
export interface SWEGrid {
  /** Grid width (columns). */
  width:  number;
  /** Grid height (rows). */
  height: number;
  /** Cell size (m). */
  dx:     number;
  /** WASM heap byte-offset for the height field. */
  hPtr:   number;
  /** WASM heap byte-offset for the X-velocity field. */
  uPtr:   number;
  /** WASM heap byte-offset for the Z-velocity field. */
  wPtr:   number;
  /** Live Float32 view into the WASM heap — water height. */
  h:      Float32Array;
  /** Live Float32 view into the WASM heap — X velocity. */
  u:      Float32Array;
  /** Live Float32 view into the WASM heap — Z velocity. */
  w:      Float32Array;
  /** Free all WASM heap allocations.  Call when the grid is no longer needed. */
  dispose(): void;
}

export interface NativeWaterForceBatch {
  sampleCount: number;
  inputPtr: number;
  outputPtr: number;
  input: Float32Array;
  output: Float32Array;
  setSample(index: number, sample: NativeWaterForceSample): void;
  compute(config: NativeWaterForceConfig): Float32Array;
  readResult(index: number): NativeWaterForceResult;
  dispose(): void;
}

/**
 * Allocate a Shallow Water Equations grid in WASM linear memory.
 *
 * The returned Float32Array views (`h`, `u`, `w`) are live windows directly
 * into WASM memory — writes are immediately visible to `stepShallowWater`.
 *
 * @param mod     Loaded WatershedNativeModule (from getWasm())
 * @param width   Grid columns
 * @param height  Grid rows
 * @param dx      Cell size in metres (default 0.5)
 *
 * @example
 *   const wasm = await getWasm();
 *   const grid = createSWEGrid(wasm, 32, 32, 0.5);
 *
 *   // Set a Gaussian splash at the centre
 *   const cx = grid.width  / 2;
 *   const cz = grid.height / 2;
 *   for (let z = 0; z < grid.height; z++) {
 *     for (let x = 0; x < grid.width; x++) {
 *       const d = Math.hypot(x - cx, z - cz);
 *       grid.h[z * grid.width + x] = 1.0 + 0.4 * Math.exp(-d * d / 10);
 *     }
 *   }
 *
 *   // Per-frame in useFrame:
 *   wasm.stepShallowWater(grid.hPtr, grid.uPtr, grid.wPtr,
 *     grid.width, grid.height, delta, 9.8, grid.dx, 1.0);
 *
 *   // On unmount:
 *   grid.dispose();
 */
export function createSWEGrid(
  mod: WatershedNativeModule,
  width:  number,
  height: number,
  dx:     number = 0.5,
): SWEGrid {
  const count = width * height;

  const hPtr = mod.allocateGrid(count);
  const uPtr = mod.allocateGrid(count);
  const wPtr = mod.allocateGrid(count);

  // HEAPF32 is a Float32Array view; each element is 4 bytes,
  // so the byte-offset ptr maps to element index ptr / 4... but because
  // HEAPF32 was already created as a Float32Array over the raw buffer,
  // we can pass the byte offset directly and let the Float32Array
  // constructor handle the alignment (Emscripten guarantees 4-byte alignment).
  const buffer = mod.HEAPF32.buffer;
  const h = new Float32Array(buffer, hPtr, count);
  const u = new Float32Array(buffer, uPtr, count);
  const w = new Float32Array(buffer, wPtr, count);

  return {
    width, height, dx,
    hPtr, uPtr, wPtr,
    h, u, w,
    dispose() {
      mod.freeGrid(hPtr);
      mod.freeGrid(uPtr);
      mod.freeGrid(wPtr);
    },
  };
}

export function createWaterForceBatch(
  mod: WatershedNativeModule,
  sampleCount: number,
): NativeWaterForceBatch {
  const inputPtr = mod.allocateGrid(sampleCount * WATER_FORCE_INPUT_STRIDE);
  const outputPtr = mod.allocateGrid(sampleCount * WATER_FORCE_OUTPUT_STRIDE);
  const input = new Float32Array(
    mod.HEAPF32.buffer,
    inputPtr,
    sampleCount * WATER_FORCE_INPUT_STRIDE,
  );
  const output = new Float32Array(
    mod.HEAPF32.buffer,
    outputPtr,
    sampleCount * WATER_FORCE_OUTPUT_STRIDE,
  );

  return {
    sampleCount,
    inputPtr,
    outputPtr,
    input,
    output,
    setSample(index, sample) {
      if (index < 0 || index >= sampleCount) {
        throw new RangeError(`Water force sample ${index} out of range`);
      }
      const offset = index * WATER_FORCE_INPUT_STRIDE;
      input[offset + 0] = sample.position.x;
      input[offset + 1] = sample.position.y;
      input[offset + 2] = sample.position.z;
      input[offset + 3] = sample.velocity.x;
      input[offset + 4] = sample.velocity.y;
      input[offset + 5] = sample.velocity.z;
      input[offset + 6] = sample.flowDirection.x;
      input[offset + 7] = sample.flowDirection.z;
    },
    compute(config) {
      mod.computeWaterForcesBatch(
        inputPtr,
        outputPtr,
        sampleCount,
        config.flowSpeed,
        config.waterLevel,
        config.raftMass,
        config.raftVolume,
        config.dragCoefficient,
        config.frontalArea,
        config.sideArea,
        config.timeSeconds,
        config.turbulenceStrength,
        config.turbulenceFrequency,
      );
      return output;
    },
    readResult(index) {
      if (index < 0 || index >= sampleCount) {
        throw new RangeError(`Water force result ${index} out of range`);
      }
      const offset = index * WATER_FORCE_OUTPUT_STRIDE;
      return {
        forceX: output[offset + 0],
        forceY: output[offset + 1],
        forceZ: output[offset + 2],
        buoyancy: output[offset + 3],
        drag: output[offset + 4],
        flow: output[offset + 5],
        turbulence: output[offset + 6],
        submergedRatio: output[offset + 7],
      };
    },
    dispose() {
      mod.freeGrid(inputPtr);
      mod.freeGrid(outputPtr);
    },
  };
}

// ---------------------------------------------------------------------------
// Physics convenience wrappers (pure-TS fallbacks for offline / test use)
// ---------------------------------------------------------------------------

/**
 * Pure-TypeScript buoyancy calculation — matches C++ implementation.
 * Useful in unit tests or when WASM is unavailable.
 */
export function buoyancyFallback(
  submergedVolume: number,
  waterDensity = 1000,
  gravity = 9.80665,
): number {
  if (submergedVolume <= 0) return 0;
  return waterDensity * submergedVolume * gravity;
}

/**
 * Pure-TypeScript drag force — matches C++ implementation.
 */
export function dragForceFallback(
  vx: number, vy: number, vz: number,
  cd: number, area: number, density: number,
): number {
  const speedSq = vx*vx + vy*vy + vz*vz;
  if (speedSq <= 0) return 0;
  return 0.5 * density * speedSq * cd * area;
}

export function calculateBuoyancyAndDragFallback(
  raftMass: number,
  submergedVolume: number,
  waterVelocityX: number,
  waterVelocityZ: number,
): number {
  const buoyancy = buoyancyFallback(submergedVolume);
  const waterSpeedSq = waterVelocityX * waterVelocityX + waterVelocityZ * waterVelocityZ;
  const drag = 0.5 * 1000 * waterSpeedSq * 0.47 * 1.8;
  return Math.max(0, buoyancy - Math.max(0, raftMass) * 9.80665) + drag;
}

export function calculateWaterForceFallback(
  sample: NativeWaterForceSample,
  config: NativeWaterForceConfig,
): NativeWaterForceResult {
  const raftHeight = 0.35;
  const bottomY = sample.position.y - raftHeight * 0.5;
  const submergedRatio = Math.min(1, Math.max(0, (config.waterLevel - bottomY) / raftHeight));
  if (submergedRatio <= 0) {
    return {
      forceX: 0, forceY: 0, forceZ: 0,
      buoyancy: 0, drag: 0, flow: 0, turbulence: 0, submergedRatio: 0,
    };
  }

  const buoyancy = buoyancyFallback(config.raftVolume * submergedRatio);
  const forceY = Math.max(0, buoyancy - config.raftMass * 9.80665 * 0.35);
  const flowLen = Math.hypot(sample.flowDirection.x, sample.flowDirection.z) || 1;
  const flowDirX = sample.flowDirection.x / flowLen;
  const flowDirZ = sample.flowDirection.z / flowLen;
  const relX = flowDirX * config.flowSpeed - sample.velocity.x;
  const relZ = flowDirZ * config.flowSpeed - sample.velocity.z;
  const relSpeedSq = relX * relX + relZ * relZ;
  const relSpeed = Math.sqrt(relSpeedSq);
  const projectedArea =
    config.frontalArea * Math.abs(flowDirZ) +
    config.sideArea * Math.abs(flowDirX);
  const flow = relSpeedSq > 0
    ? 0.5 * 1000 * relSpeedSq * config.dragCoefficient * projectedArea * submergedRatio
    : 0;

  const speed = Math.hypot(sample.velocity.x, sample.velocity.y, sample.velocity.z);
  const dragArea = config.frontalArea + config.sideArea * 0.35;
  const drag = speed > 0
    ? 0.5 * 1000 * speed * speed * config.dragCoefficient * dragArea * submergedRatio
    : 0;

  const turbulence = Math.max(0, config.turbulenceStrength) * 1000 * submergedRatio;
  const turbX = Math.sin(config.timeSeconds * config.turbulenceFrequency + sample.position.z * 0.37);
  const turbZ = Math.cos(config.timeSeconds * config.turbulenceFrequency * 1.31 + sample.position.x * 0.29);

  return {
    forceX: (relSpeed > 0 ? (relX / relSpeed) * flow : 0) -
      (speed > 0 ? (sample.velocity.x / speed) * drag : 0) +
      turbX * turbulence,
    forceY: forceY - (speed > 0 ? (sample.velocity.y / speed) * drag * 0.2 : 0),
    forceZ: (relSpeed > 0 ? (relZ / relSpeed) * flow : 0) -
      (speed > 0 ? (sample.velocity.z / speed) * drag : 0) +
      turbZ * turbulence,
    buoyancy,
    drag,
    flow,
    turbulence,
    submergedRatio,
  };
}
