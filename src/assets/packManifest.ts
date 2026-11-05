/**
 * packManifest — the typed contract of `public/packs/<pack>/manifest.json` (#536 A.1/A.2).
 *
 * `scripts/build-assets.mjs` writes the manifest; this module is the only reader. Packs ship
 * as static files beside the bundle, so a manifest is untrusted input (a stale cache, a
 * partial deploy): `parsePackManifest` checks every field the runtime uses and throws on the
 * first mismatch instead of letting a malformed row reach a loader. Hand-written rather than
 * an ajv schema on purpose: it is ~1 kB in the lazy pack chunk, never in the entry.
 *
 * Worker-safe: no three, no DOM. Phase B parses packs on the sim worker with the same module.
 */

/** Pack ids. `core` holds what every run can need regardless of biome (vehicles, cosmetics);
 *  the biome packs (`glacial`, `lumber`, `meander`, `hydro`, `delta`) arrive with phase B. */
export type PackId = 'core';

export const PACK_MANIFEST_SCHEMA = 1;

/** One baked level: drawn from `distance` metres (THREE.LOD semantics). */
export interface PackLod {
  readonly distance: number;
  readonly triangles: number;
}

export interface PackBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface PackAssetEntry {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceSha256: string;
  readonly bounds: PackBounds;
  readonly lods: readonly PackLod[];
  /** True when the .glb references KTX2 images (the loader then brings KTX2Loader). */
  readonly textures: boolean;
}

export interface PackManifest {
  readonly schema: number;
  readonly pack: PackId;
  /** sha256 over the pack's files, 16 hex: every file is fetched as `<file>?v=<stamp>`. */
  readonly stamp: string;
  readonly assets: Readonly<Record<string, PackAssetEntry>>;
}

const PACK_IDS: readonly PackId[] = ['core'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec3(value: unknown, where: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new Error(`${where}: expected [x, y, z]`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function parseLods(value: unknown, where: string): PackLod[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where}: lods must be a non-empty array`);
  let previous = -1;
  return value.map((raw: unknown, i) => {
    if (!isObject(raw) || !isFiniteNumber(raw.distance) || !isFiniteNumber(raw.triangles)) {
      throw new Error(`${where}.lods[${i}]: expected { distance, triangles }`);
    }
    if (i === 0 ? raw.distance !== 0 : raw.distance <= previous) {
      throw new Error(`${where}.lods[${i}]: distances start at 0 and increase`);
    }
    previous = raw.distance;
    return { distance: raw.distance, triangles: raw.triangles };
  });
}

function parseAsset(name: string, raw: unknown): PackAssetEntry {
  const where = `assets['${name}']`;
  if (!isObject(raw)) throw new Error(`${where}: expected an object`);
  const { file, bytes, sha256, sourceSha256, bounds, lods, textures } = raw;
  // A file is a bare name in the pack directory: no path segments, nothing to traverse.
  if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.glb$/.test(file)) throw new Error(`${where}.file: expected <name>.glb`);
  if (!isFiniteNumber(bytes) || bytes <= 0) throw new Error(`${where}.bytes: expected a positive size`);
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${where}.sha256: expected 64 hex`);
  if (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceSha256)) {
    throw new Error(`${where}.sourceSha256: expected 64 hex`);
  }
  if (!isObject(bounds) || !isFiniteNumber(bounds.radius)) throw new Error(`${where}.bounds: expected min/max/center/radius`);
  if (typeof textures !== 'boolean') throw new Error(`${where}.textures: expected a boolean`);
  return {
    file,
    bytes,
    sha256,
    sourceSha256,
    bounds: {
      min: vec3(bounds.min, `${where}.bounds.min`),
      max: vec3(bounds.max, `${where}.bounds.max`),
      center: vec3(bounds.center, `${where}.bounds.center`),
      radius: bounds.radius,
    },
    lods: parseLods(lods, where),
    textures,
  };
}

/** Validate a fetched manifest against the pack it was requested for. Throws on mismatch. */
export function parsePackManifest(json: unknown, expected: PackId): PackManifest {
  if (!isObject(json)) throw new Error('pack manifest: expected an object');
  if (json.schema !== PACK_MANIFEST_SCHEMA) {
    throw new Error(`pack manifest: schema ${String(json.schema)}, this build reads ${PACK_MANIFEST_SCHEMA}`);
  }
  if (typeof json.pack !== 'string' || !PACK_IDS.includes(json.pack as PackId) || json.pack !== expected) {
    throw new Error(`pack manifest: pack '${String(json.pack)}', expected '${expected}'`);
  }
  if (typeof json.stamp !== 'string' || !/^[0-9a-f]{16}$/.test(json.stamp)) {
    throw new Error('pack manifest: stamp must be 16 hex');
  }
  if (!isObject(json.assets)) throw new Error('pack manifest: assets must be an object');
  const assets: Record<string, PackAssetEntry> = {};
  for (const [name, raw] of Object.entries(json.assets)) assets[name] = parseAsset(name, raw);
  return { schema: PACK_MANIFEST_SCHEMA, pack: expected, stamp: json.stamp, assets };
}

/** `packs/<pack>/` under the deploy base (`./` in a build, `/` under the dev server). */
export function packBaseUrl(pack: PackId, base: string): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}packs/${pack}/`;
}

/** A pack file's stamped URL: content-addressed by the manifest's stamp, so it can be
 *  cached immutable (public/.htaccess) and precached by name in phase C. */
export function packFileUrl(manifest: PackManifest, file: string, base: string): string {
  return `${packBaseUrl(manifest.pack, base)}${file}?v=${manifest.stamp}`;
}
