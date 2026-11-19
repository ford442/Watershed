/**
 * wasmAbi.ts — the TypeScript half of the watershed_native C ABI (#467, #575).
 *
 * The exports are declared once, in emscripten/abi.def; scripts/gen-abi.mjs
 * writes their branded interface (`WatershedNativeExports`), the `WASM_ABI`
 * table (arity, out-pointer readers) and the mirrored constants into
 * wasmAbi.generated.ts, which this module re-exports. What is hand-written
 * here: the value types the batch helpers use, `bindNativeModule` (binds every
 * table entry onto a `WatershedNativeModule`, or rejects), and the heap
 * helpers. Scalar exports are bound directly (no cwrap, no wrapper closure);
 * an out-pointer result passes a scratch block reserved once per module.
 *
 * Changing a signature means editing abi.def and running `pnpm gen:abi`;
 * `gen-abi --check` (pnpm typecheck) fails until the generated files agree.
 */
import {
  WASM_ABI,
  WS_BAD_ARG,
  WS_OK,
  WS_PARTIAL,
  WS_REJECTED,
  type WasmAbiEntry,
  type WasmAbiFunctionName,
  type WatershedNativeExports,
} from './wasmAbi.generated';

export {
  PARTICLE_SOA_PLANES,
  ROUTING_SUBREACHES,
  SWE_EVENT_MAX_RADIUS,
  SWE_EVENT_MAX_STRENGTH,
  WASM_ABI,
  WASM_ABI_VERSION,
  WATER_FORCE_INPUT_STRIDE,
  WATER_FORCE_OUTPUT_STRIDE,
  WS_BAD_ARG,
  WS_OK,
  WS_PARTIAL,
  WS_REJECTED,
  type RoutedEdge,
  type WasmAbiEntry,
  type WasmAbiFunctionName,
} from './wasmAbi.generated';
export type * from './wasmUnits';
import type { Ptr } from './wasmUnits';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** 3-component float vector (a force sample's position / velocity). */
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

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

const warnedRejections = new Set<string>();

/**
 * A native call did not return WS_OK (#533, #575). WS_REJECTED / WS_BAD_ARG
 * wrote nothing; WS_PARTIAL wrote every row but zeroed (and flagged) some.
 * Warns once per export per session, in dev only; the caller decides what to
 * read instead (never an untouched output buffer as if it were fresh).
 */
export function warnRejected(name: string, detail: string, status: number = WS_REJECTED): void {
  if (!import.meta.env.DEV || warnedRejections.has(name)) return;
  warnedRejections.add(name);
  const what = status === WS_PARTIAL
    ? 'refused some rows (zeroed and flagged)'
    : status === WS_BAD_ARG
      ? 'got an argument past its documented maximum; nothing was written'
      : 'rejected its arguments; nothing was written';
  console.warn(`[watershed_native] ${name} ${what} (${detail})`);
}

/**
 * The same heap block, addressed as `T` elements (#575). allocateGrid is the
 * module's one allocator, so a block of n floats is also the 256 uint32 bins
 * of a histogram or 4n RGBA8 bytes: say so at the call (`asPtr<U32>(bins)`)
 * instead of the brand silently passing. Keep the Ptr<F32> for freeGrid.
 */
export function asPtr<T extends string>(ptr: number): Ptr<T> {
  return ptr as Ptr<T>;
}

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
 * The module as game code sees it: the generated exports plus the heap views.
 * Pointers are WASM heap byte offsets from allocateGrid / allocateParticleSoA.
 * Field conventions (h is a free-surface perturbation, b the bed above the
 * floor datum, …) are documented in emscripten/swe.h and WASM.md.
 */
export interface WatershedNativeModule extends WatershedNativeExports {
  // Emscripten typed heap views: one fixed-size heap, so bound once
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
}

// ---------------------------------------------------------------------------
// Binding the table
// ---------------------------------------------------------------------------

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
  const heap = { HEAPF32: raw.HEAPF32, HEAP32: raw.HEAP32 };

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
    } else if (out && entry.fold !== undefined) {
      // A status export whose TS face is its out value (the particle seeds):
      // a refused call warns and hands back the argument it would replace.
      const fold = entry.fold;
      bound[name] = (...args: number[]) => {
        const status = call(...args, outPtr);
        if (status === WS_OK) return out.read(heap, outAt);
        warnRejected(name, `status ${status}`, status);
        return args[fold];
      };
    } else if (out) {
      bound[name] = (...args: number[]) => {
        call(...args, outPtr);
        return out.read(heap, outAt);
      };
    } else {
      bound[name] = call;
    }
  }
  return bound as unknown as WatershedNativeModule;
}
