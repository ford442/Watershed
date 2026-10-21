/**
 * wasmTrap.ts — name the function a watershed_native trap happened in (#502).
 *
 * A release binary ships no name section, so a trap's stack reads
 * `wasm-function[57]:0x1a2b`. `emscripten/watershed_native.symbols` (emitted by
 * `--emit-symbol-map`, committed with the pair, copied into build-sourcemaps/)
 * maps that index back to `ws_stepShallowWater`. A Debug build carries its own
 * names, so its stack already reads `at ws_trapTest (wasm://…)`.
 *
 * - `describeWasmTrap(error, symbols?)` → the function name (or `wasm-function[N]`
 *   when there is no map), for the HUD's native-status row.
 * - `?wasmTrapTest=1` in a Debug build makes the loader call `ws_trapTest`
 *   (a `__builtin_trap()`) right after bind, so the whole path can be checked.
 * - `scripts/wasm-symbolicate.mjs` does the same offline for a field report.
 *
 * The parser stays off the boot path: the main-thread loader imports this
 * module only when a trap test traps; the entry carries wasmTrapMarker.ts.
 */

import type { RawWatershedModule } from './wasmAbi';
import { WASM_TRAP_MARKER } from './wasmTrapMarker';

/** Index → name, from a `N:name` per line symbol map. */
export type WasmSymbolMap = ReadonlyMap<number, string>;

export function parseWasmSymbolMap(text: string): WasmSymbolMap {
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const index = Number(line.slice(0, colon));
    const name = line.slice(colon + 1).trim();
    if (Number.isInteger(index) && index >= 0 && name) map.set(index, name);
  }
  return map;
}

/**
 * A wasm frame as V8 (`at name (…wasm-function[N]…)`) or SpiderMonkey
 * (`name@…wasm-function[N]…`) prints it, or as a source-mapped stack does
 * (`at name (wasm://wasm/…:1:12881)` — Node / vitest rewrite the index into a
 * byte offset, keeping only the name).
 */
export interface WasmFrame {
  /** Function index, when the stack kept it. */
  index: number | null;
  /** The engine's own name for the frame (a Debug build's name section), if any. */
  name: string | null;
}

const V8_FRAME = /at\s+(?:(\S+)\s+\()?[^\n]*?wasm-function\[(\d+)\]/;
const SM_FRAME = /(?:^|\n)\s*([^@\s]*)@[^\n]*?wasm-function\[(\d+)\]/;
const MAPPED_FRAME = /at\s+(\S+)\s+\(wasm:\/\/[^\n)]*\)/;

/** V8 prefixes names from a name section with the module: `watershed_native.wasm.ws_trapTest`, `$ws_trapTest`. */
function bareName(engineName: string | undefined): string | null {
  if (!engineName || engineName.startsWith('wasm://')) return null;
  return engineName.replace(/^.*[.$]/, '') || null;
}

/** The innermost wasm frame of a stack, or null when the stack has none. */
export function innermostWasmFrame(stack: string): WasmFrame | null {
  const match = V8_FRAME.exec(stack) ?? SM_FRAME.exec(stack);
  const mapped = MAPPED_FRAME.exec(stack);
  // Whichever wasm frame comes first is the innermost.
  if (match && (!mapped || match.index <= mapped.index)) {
    return { index: Number(match[2]), name: bareName(match[1]) };
  }
  if (mapped) return { index: null, name: bareName(mapped[1]) };
  return null;
}

function isRuntimeError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError?: new () => Error } }).WebAssembly?.RuntimeError;
  return (RuntimeError !== undefined && error instanceof RuntimeError) || error.name === 'RuntimeError';
}

/**
 * The function a wasm trap happened in: the symbol map's name for the
 * innermost wasm frame, else the engine's own name, else `wasm-function[N]`.
 * Null when `error` is not a wasm trap (or its stack has no wasm frame).
 */
export function describeWasmTrap(error: unknown, symbols?: WasmSymbolMap | null): string | null {
  if (!isRuntimeError(error) || typeof error.stack !== 'string') return null;
  const frame = innermostWasmFrame(error.stack);
  if (!frame) return null;
  const mapped = frame.index !== null ? symbols?.get(frame.index) : undefined;
  return mapped ?? frame.name ?? (frame.index !== null ? `wasm-function[${frame.index}]` : null);
}

/** A trap, rethrown with the function it happened in (WASM_TRAP_MARKER). */
export class WasmTrapError extends Error {
  readonly trapFunction: string;

  constructor(trapFunction: string, cause: Error) {
    super(`watershed_native ${WASM_TRAP_MARKER} ${trapFunction}: ${cause.message}`);
    this.name = 'WasmTrapError';
    this.trapFunction = trapFunction;
  }
}

/** `error` as a WasmTrapError when it is a wasm trap, else unchanged. */
export function withTrapFunction(error: unknown, symbols?: WasmSymbolMap | null): unknown {
  const fn = describeWasmTrap(error, symbols);
  return fn ? new WasmTrapError(fn, error as Error) : error;
}

/**
 * `?wasmTrapTest=1` (wasmLoader.ts, after bind): call the Debug-only
 * `ws_trapTest` and throw the WasmTrapError naming where it trapped, using the
 * symbol map next to the wasm when one is served. A release binary has no
 * hook; the flag is then ignored with a warning.
 */
export async function runWasmTrapTest(raw: RawWatershedModule, wasmUrl: string): Promise<void> {
  const trapTest = raw._ws_trapTest;
  if (typeof trapTest !== 'function') {
    console.warn('[Watershed WASM] ?wasmTrapTest=1 needs a Debug build (pnpm build:wasm:debug); ignored');
    return;
  }
  try {
    trapTest();
  } catch (error) {
    let symbols: WasmSymbolMap | null = null;
    try {
      const response = await fetch(new URL('watershed_native.symbols', wasmUrl).href);
      if (response.ok) symbols = parseWasmSymbolMap(await response.text());
    } catch {
      // No map: the engine's own name, or the index.
    }
    throw withTrapFunction(error, symbols);
  }
}
