/**
 * Registry contract — compile-time half of the map registry drift guard.
 *
 * This module deliberately lives OUTSIDE `*.test.ts` because
 * `tsconfig.typecheck.json` excludes test files from the `pnpm typecheck`
 * gate. Type-level assertions written in a test file would never bite in CI;
 * written here they do. `registry.contract.test.ts` consumes the runtime
 * helpers below so both halves stay in one place.
 *
 * Drift classes caught here, at `tsc` time:
 *   - an id added to `MapRegistryId` but never registered in `MAP_REGISTRY`
 *   - an entry added to `MAP_REGISTRY` whose key is not in `MapRegistryId`
 *   - either of the above drifting from `CANONICAL_MAP_REGISTRY_IDS`, the
 *     single hand-maintained list the runtime tests check `Object.keys` against
 */

import { MAP_REGISTRY, type MapDefinition, type MapRegistryId } from './registry';

/**
 * Canonical, hand-maintained registry id list.
 *
 * Adding a map means adding it here too — that is the point. The type-level
 * assertions below fail `pnpm typecheck` if this list and `MapRegistryId`
 * and `MAP_REGISTRY`'s keys ever disagree in either direction.
 */
export const CANONICAL_MAP_REGISTRY_IDS = ['glacial', 'lumber', 'meander', 'hydro', 'delta'] as const;

export type CanonicalMapRegistryId = (typeof CANONICAL_MAP_REGISTRY_IDS)[number];

// -----------------------------------------------------------------------------
// Type-level assertion helpers
// -----------------------------------------------------------------------------

/** Compiles only when `T` is exactly `true`. */
export type Assert<T extends true> = T;

/**
 * Invariant (both-directions) type equality. The deferred-conditional trick is
 * required — a plain `A extends B ? B extends A ? true : false : false` is
 * distributive and would silently pass for unions.
 */
export type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false;

// -----------------------------------------------------------------------------
// Compile-time contract
// -----------------------------------------------------------------------------

/** The canonical list and the `MapRegistryId` union describe the same set. */
export type CanonicalListMatchesUnion = Assert<Equals<CanonicalMapRegistryId, MapRegistryId>>;

/** Every registry key is a `MapRegistryId`, and every `MapRegistryId` is registered. */
export type RegistryKeysMatchUnion = Assert<Equals<keyof typeof MAP_REGISTRY, MapRegistryId>>;

/** The canonical list and the actual registry keys describe the same set. */
export type CanonicalListMatchesRegistryKeys = Assert<
  Equals<CanonicalMapRegistryId, keyof typeof MAP_REGISTRY>
>;

// -----------------------------------------------------------------------------
// Runtime helpers (consumed by registry.contract.test.ts)
// -----------------------------------------------------------------------------

/**
 * Typed identity over a registry id.
 *
 * Passing a string that is not a `MapRegistryId` is a compile error, so the
 * contract test's `Object.keys(MAP_REGISTRY).map(assertMapRegistryId)` sweep is
 * a runtime check whose *shape* is also pinned at `tsc` time.
 */
export function assertMapRegistryId(id: MapRegistryId): MapRegistryId {
  return id;
}

/**
 * StartMenu metadata contract: an entry either is menu-visible and fully
 * described, or is explicitly `menuHidden`. Returns the reason it fails so the
 * test can report which field drifted.
 */
export function menuMetadataViolation(def: MapDefinition): string | null {
  if (def.menuHidden) return null;
  if (!def.difficulty) return 'missing difficulty';
  if (typeof def.estimatedDurationSec !== 'number') return 'missing estimatedDurationSec';
  if (!Number.isFinite(def.estimatedDurationSec) || def.estimatedDurationSec <= 0) {
    return `estimatedDurationSec must be a positive finite number (got ${def.estimatedDurationSec})`;
  }
  return null;
}

/** Every authored `LevelData` reachable from the registry, keyed for reporting. */
export function registeredLevelDataEntries(): Array<{ label: string; levelData: unknown }> {
  const entries: Array<{ label: string; levelData: unknown }> = [];
  for (const id of CANONICAL_MAP_REGISTRY_IDS) {
    const def = MAP_REGISTRY[id];
    entries.push({ label: id, levelData: def.levelData });
    if (def.continuation) {
      entries.push({ label: `${id}.continuation`, levelData: def.continuation.levelData });
    }
  }
  return entries;
}
