/**
 * Feature flag for the co-located Rapier + watershed_native physics worker path.
 *
 * The worker path is the DEFAULT on browsers that expose `Worker` + `WebAssembly`
 * (see docs/reference/ADR_WASM_RAPIER_WATER_FORCES.md). Resolution order:
 *
 *   1. `?physicsWorker=0` (or legacy `?raftWorker=0`) — hard kill switch, always wins.
 *   2. Missing `Worker` / `WebAssembly` — cannot run the worker path at all.
 *   3. `?physicsWorker=1` — explicit opt-in (e.g. when the setting says off).
 *   4. Settings preference `'on'` / `'off'`.
 *   5. Default: on.
 *
 * A WASM *load* failure is handled one layer down: the worker falls back to the
 * TypeScript force math (`getWorkerWasm` returns null), and RaftVehicle keeps the
 * main-thread Rapier body authoritative if the worker itself never becomes ready.
 */

/** Player-facing preference stored in the settings panel. */
export type PhysicsWorkerPreference = 'auto' | 'on' | 'off';

export type PhysicsWorkerReason =
  | 'query-off'
  | 'query-on'
  | 'setting-off'
  | 'setting-on'
  | 'default-on'
  | 'no-worker'
  | 'no-wasm';

export interface PhysicsWorkerDecision {
  enabled: boolean;
  reason: PhysicsWorkerReason;
}

export interface PhysicsWorkerEnvironment {
  /** Query string (with or without a leading '?'). Defaults to window.location.search. */
  search?: string;
  /** Override capability detection (tests). */
  hasWorker?: boolean;
  hasWasm?: boolean;
  /** Settings-panel preference. Defaults to 'auto'. */
  preference?: PhysicsWorkerPreference;
}

/** Human-readable explanation for the debug panel. */
export const PHYSICS_WORKER_REASON_LABELS: Record<PhysicsWorkerReason, string> = {
  'query-off': 'disabled by ?physicsWorker=0',
  'query-on': 'forced by ?physicsWorker=1',
  'setting-off': 'disabled in settings',
  'setting-on': 'enabled in settings',
  'default-on': 'default on',
  'no-worker': 'Worker unavailable',
  'no-wasm': 'WebAssembly unavailable',
};

function readParams(search?: string): URLSearchParams {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  return new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
}

/** First of `physicsWorker` / `raftWorker` that is present, normalised to '1' | '0' | null. */
function readQueryOverride(params: URLSearchParams): '1' | '0' | null {
  for (const key of ['physicsWorker', 'raftWorker']) {
    const value = params.get(key);
    if (value === '1' || value === 'true') return '1';
    if (value === '0' || value === 'false') return '0';
  }
  return null;
}

function detectWorkerSupport(): boolean {
  return typeof Worker !== 'undefined';
}

function detectWasmSupport(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';
}

/**
 * Resolve whether the physics worker path should run, and why.
 * Pure — every environment input can be injected, so this is unit-testable.
 */
export function resolvePhysicsWorker(
  env: PhysicsWorkerEnvironment = {},
): PhysicsWorkerDecision {
  const params = readParams(env.search);
  const override = readQueryOverride(params);

  // 1. Kill switch always wins, even over capability detection.
  if (override === '0') return { enabled: false, reason: 'query-off' };

  // 2. Capability gate.
  const hasWorker = env.hasWorker ?? detectWorkerSupport();
  if (!hasWorker) return { enabled: false, reason: 'no-worker' };
  const hasWasm = env.hasWasm ?? detectWasmSupport();
  if (!hasWasm) return { enabled: false, reason: 'no-wasm' };

  // 3. Explicit opt-in beats the stored preference.
  if (override === '1') return { enabled: true, reason: 'query-on' };

  // 4. Settings preference.
  const preference = env.preference ?? 'auto';
  if (preference === 'off') return { enabled: false, reason: 'setting-off' };
  if (preference === 'on') return { enabled: true, reason: 'setting-on' };

  // 5. Default on.
  return { enabled: true, reason: 'default-on' };
}

/**
 * Convenience boolean. Kept as the historical entry point so callers that don't
 * care about the reason stay unchanged.
 */
export function isPhysicsWorkerEnabled(
  searchOrEnv?: string | PhysicsWorkerEnvironment,
): boolean {
  const env: PhysicsWorkerEnvironment =
    typeof searchOrEnv === 'string' ? { search: searchOrEnv } : (searchOrEnv ?? {});
  return resolvePhysicsWorker(env).enabled;
}
