/**
 * wasmTrapMarker.ts — the boot-path half of wasmTrap.ts (#502 B): the message
 * marker a named trap carries, reading the function back out of a message
 * (after a worker hop the error is only a string), and the `?wasmTrapTest=1`
 * flag. The stack parser lives in wasmTrap.ts and is loaded on demand.
 */

/** Marker in a WasmTrapError message; nativeOwner.ts reads the function after it. */
export const WASM_TRAP_MARKER = 'wasm trap in';

/** The function a WasmTrapError message names (directly or after a worker hop), else null. */
export function trapFunctionOf(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const at = message.indexOf(WASM_TRAP_MARKER);
  if (at < 0) return null;
  return /^\s*([^\s:]+)/.exec(message.slice(at + WASM_TRAP_MARKER.length))?.[1] ?? null;
}

/** `?wasmTrapTest=1`: call the Debug-only `ws_trapTest` export after bind. */
export function wantsWasmTrapTest(search?: string): boolean {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  return new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`).get('wasmTrapTest') === '1';
}
