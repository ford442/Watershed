/**
 * AssetPack — fetch and decode one authored asset pack (#536 A.2).
 *
 * `loadPack(id)` reads `packs/<id>/manifest.json`, then each `.glb` it lists at its stamped
 * URL, checks the bytes against the manifest (size + sha256, so a stale cache or a partial
 * deploy is a load failure, never a wrong mesh), and decodes them with three's GLTFLoader +
 * MeshoptDecoder (EXT_meshopt_compression; no Draco). KTX2Loader comes along only when an
 * asset says it carries textures. All three loaders are dynamic imports: none of this is in
 * the entry chunk, and a run that never needs a pack never fetches the loader code.
 *
 * One load per pack per session; a failed load is forgotten so a later request retries.
 * Decoded subtrees are owned here and never added to a scene: `instantiateAsset`
 * (AssetRegistry) clones them. Phase B moves the decode itself to the sim worker
 * (`PARSE_GLB`); the manifest contract and this module's result type stay the same.
 */
import type * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ktx2LoaderModule, configureKtx2Loader } from '../rendering/ktx2Textures';
import { lazyModule } from '../utils/lazyModule';
import { parsePackManifest, packBaseUrl, packFileUrl, type PackAssetEntry, type PackId, type PackManifest } from './packManifest';

/** One decoded asset: its manifest row and one subtree per LOD level (lod0 first). */
export interface PackAsset {
  readonly name: string;
  readonly entry: PackAssetEntry;
  readonly levels: readonly THREE.Object3D[];
}

export interface LoadedPack {
  readonly manifest: PackManifest;
  readonly assets: ReadonlyMap<string, PackAsset>;
}

export interface LoadPackOptions {
  /** Deploy base; defaults to Vite's BASE_URL (`./` in a build). */
  base?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** Needed only by a pack with KTX2 textures (KTX2Loader.detectSupport reads it). */
  renderer?: unknown;
}

/** GLTFLoader + MeshoptDecoder as one lazy unit (the same GLTFLoader module ReachStreamer imports). */
const gltfModules = lazyModule(() =>
  Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]),
);

async function createLoader(withTextures: boolean, renderer: unknown): Promise<GLTFLoader> {
  const [{ GLTFLoader: Loader }, { MeshoptDecoder }] = await gltfModules.load();
  await MeshoptDecoder.ready;
  const loader = new Loader().setMeshoptDecoder(MeshoptDecoder);
  if (withTextures) {
    if (!renderer) throw new Error('asset pack: a textured pack needs the renderer for KTX2 support detection');
    const { KTX2Loader } = await ktx2LoaderModule.load();
    const ktx2 = new KTX2Loader();
    configureKtx2Loader(ktx2, renderer);
    loader.setKTX2Loader(ktx2);
  }
  return loader;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  // crypto.subtle is secure-context only; a plain-http LAN preview still gets the size check.
  if (!subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Check fetched bytes against the manifest row. Exported for the tests. */
export async function verifyAssetBytes(name: string, entry: PackAssetEntry, bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`asset pack: ${name} is ${bytes.byteLength} B, manifest says ${entry.bytes} B`);
  }
  const hash = await sha256Hex(bytes);
  if (hash !== null && hash !== entry.sha256) {
    throw new Error(`asset pack: ${name} sha256 ${hash.slice(0, 12)}… does not match the manifest`);
  }
}

/** Pick each baked level (`lod0`, `lod1`, …) out of a decoded scene. Exported for the tests. */
export function levelsOf(name: string, entry: PackAssetEntry, scene: THREE.Object3D): THREE.Object3D[] {
  return entry.lods.map((_, i) => {
    const level = scene.getObjectByName(`lod${i}`);
    if (!level) throw new Error(`asset pack: ${name} has no lod${i} node (manifest lists ${entry.lods.length})`);
    // Detach from the decoded scene; keep its transform (meshopt quantisation puts the
    // dequantisation scale / offset on the node under it, never on the level itself).
    level.removeFromParent();
    return level;
  });
}

async function fetchBytes(fetchImpl: typeof fetch, url: string): Promise<ArrayBuffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`asset pack: ${url} → HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function loadPackUncached(id: PackId, options: LoadPackOptions): Promise<LoadedPack> {
  const base = options.base ?? import.meta.env.BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  // The manifest is the one unstamped file: it names the stamp, so it always revalidates.
  const response = await fetchImpl(`${packBaseUrl(id, base)}manifest.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`asset pack: ${id}/manifest.json → HTTP ${response.status}`);
  const manifest = parsePackManifest(await response.json(), id);

  const entries = Object.entries(manifest.assets);
  const withTextures = entries.some(([, entry]) => entry.textures);
  const [loader, buffers] = await Promise.all([
    createLoader(withTextures, options.renderer),
    Promise.all(entries.map(([, entry]) => fetchBytes(fetchImpl, packFileUrl(manifest, entry.file, base)))),
  ]);

  const assets = new Map<string, PackAsset>();
  for (let i = 0; i < entries.length; i += 1) {
    const [name, entry] = entries[i] as [string, PackAssetEntry];
    const bytes = buffers[i] as ArrayBuffer;
    await verifyAssetBytes(name, entry, bytes);
    const gltf = await loader.parseAsync(bytes, packBaseUrl(id, base));
    assets.set(name, { name, entry, levels: levelsOf(name, entry, gltf.scene) });
  }
  return { manifest, assets };
}

const packs = new Map<PackId, Promise<LoadedPack>>();

/** Load (or join the load of) one pack. A failure is not cached: the next call retries. */
export function loadPack(id: PackId, options: LoadPackOptions = {}): Promise<LoadedPack> {
  let pending = packs.get(id);
  if (!pending) {
    pending = loadPackUncached(id, options);
    packs.set(id, pending);
    pending.catch(() => {
      if (packs.get(id) === pending) packs.delete(id);
    });
  }
  return pending;
}

/** Test seam: forget every pack and the loader modules. */
export function resetAssetPacks(): void {
  packs.clear();
  gltfModules.reset();
}
