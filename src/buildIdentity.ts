/**
 * buildIdentity.ts — "which commit is this bundle?", readable from inside the app.
 *
 * The value is injected by `vite.config.ts` (see `scripts/buildIdentity.mjs`) as a
 * JSON string in `__WATERSHED_BUILD_IDENTITY__`. The SAME object is emitted to
 * `build/build-identity.json` by the same plugin, so the static file and the
 * in-bundle value can never disagree — one resolution per build, two surfaces.
 *
 * Importing this module installs the identity on `globalThis.__WATERSHED_BUILD__`
 * so a browser console can read it without any app state:
 *
 *   > __WATERSHED_BUILD__
 *   { commit: '…', wasmStamp: '…', glueBytes: 27029, wasmBytes: 33840, … }
 *
 * Nothing here throws: a missing or malformed define degrades to `unknown`, which
 * disables the provenance assertion in WatershedWasm rather than failing a boot.
 */

declare const __WATERSHED_BUILD_IDENTITY__: string | undefined;

/** Sentinel for a value that could not be resolved at build time (no git, no wasm). */
export const UNKNOWN = 'unknown';

/** Global key the identity is installed under. */
export const BUILD_IDENTITY_GLOBAL = '__WATERSHED_BUILD__';

export interface BuildIdentity {
  /** Identity payload schema version. */
  schema: number;
  /** Full git SHA of HEAD at build time, or `unknown`. */
  commit: string;
  /** Short git SHA, or `unknown`. */
  commitShort: string;
  /** True when tracked files were modified at build time. */
  dirty: boolean;
  /** ISO timestamp of the build. */
  builtAt: string;
  /** WASM_ARTIFACT_STAMP — sha256 over glue JS **and** the wasm binary. */
  wasmStamp: string;
  /** Unhashed passenger file names, as served from the deploy root. */
  glueFile: string;
  wasmFile: string;
  /** Byte sizes of the passengers this bundle was built against. 0 = unknown. */
  glueBytes: number;
  wasmBytes: number;
}

export const UNKNOWN_BUILD_IDENTITY: BuildIdentity = {
  schema: 1,
  commit: UNKNOWN,
  commitShort: UNKNOWN,
  dirty: false,
  builtAt: new Date(0).toISOString(),
  wasmStamp: UNKNOWN,
  glueFile: 'watershed_native.js',
  wasmFile: 'watershed_native.wasm',
  glueBytes: 0,
  wasmBytes: 0,
};

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Normalise an arbitrary payload (JSON string, parsed object, or junk) into a
 * BuildIdentity. Pure and total — unknown/missing fields fall back to sentinels.
 */
export function parseBuildIdentity(raw: unknown): BuildIdentity {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      return { ...UNKNOWN_BUILD_IDENTITY };
    }
  }
  if (source == null || typeof source !== 'object') return { ...UNKNOWN_BUILD_IDENTITY };

  const record = source as Record<string, unknown>;
  return {
    schema: num(record.schema) || UNKNOWN_BUILD_IDENTITY.schema,
    commit: str(record.commit, UNKNOWN),
    commitShort: str(record.commitShort, str(record.commit, UNKNOWN).slice(0, 7) || UNKNOWN),
    dirty: record.dirty === true,
    builtAt: str(record.builtAt, UNKNOWN_BUILD_IDENTITY.builtAt),
    wasmStamp: str(record.wasmStamp, UNKNOWN),
    glueFile: str(record.glueFile, UNKNOWN_BUILD_IDENTITY.glueFile),
    wasmFile: str(record.wasmFile, UNKNOWN_BUILD_IDENTITY.wasmFile),
    glueBytes: num(record.glueBytes),
    wasmBytes: num(record.wasmBytes),
  };
}

/** True when the identity carries usable passenger sizes to assert against. */
export function hasPassengerSizes(identity: BuildIdentity): boolean {
  return identity.glueBytes > 0 && identity.wasmBytes > 0;
}

/** One-line summary, used in logs and in the provenance-mismatch banner. */
export function formatBuildIdentity(identity: BuildIdentity): string {
  return (
    `commit=${identity.commitShort}${identity.dirty ? '-dirty' : ''} ` +
    `stamp=${identity.wasmStamp} ` +
    `glue=${identity.glueBytes}B wasm=${identity.wasmBytes}B ` +
    `builtAt=${identity.builtAt}`
  );
}

/** The identity this bundle was built with. */
export const BUILD_IDENTITY: BuildIdentity = parseBuildIdentity(
  typeof __WATERSHED_BUILD_IDENTITY__ === 'string' ? __WATERSHED_BUILD_IDENTITY__ : undefined,
);

/**
 * Install the identity on a global so `__WATERSHED_BUILD__` is readable from a
 * browser console. Returns what was installed (identical object, not a copy).
 */
export function installBuildIdentity(
  target: Record<string, unknown> | undefined = typeof globalThis !== 'undefined'
    ? (globalThis as unknown as Record<string, unknown>)
    : undefined,
  identity: BuildIdentity = BUILD_IDENTITY,
): BuildIdentity {
  if (target) target[BUILD_IDENTITY_GLOBAL] = identity;
  return identity;
}

installBuildIdentity();
