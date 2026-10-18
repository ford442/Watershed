/**
 * ktx2Textures — compressed rock textures when the GPU can take them (#466 Phase D).
 *
 * `scripts/build-textures.mjs` encodes the Rock031 set to KTX2 (ETC1S/UASTC,
 * mipmapped, rows stored bottom-first). KTX2Loader transcodes to whatever
 * block format the GPU has (ASTC / BC7 / ETC2 / S3TC…), so the textures stay
 * compressed in VRAM and skip the JPG decode stall during segment streaming.
 * A GPU with none of those would get uncompressed RGBA32 out of the
 * transcoder, which costs more than the JPGs, so it keeps the JPGs instead.
 *
 * Session constant per renderer: the format choice never changes mid-run, so
 * the hook in TrackManager calls one loader for the whole session.
 */
import * as THREE from 'three';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { TRACK_ROCK_TEXTURE_PATHS, TRACK_ROCK_TEXTURE_PATHS_KTX2 } from '../constants/trackTextures';
import { lazyModule } from '../utils/lazyModule';

/** Where `build-textures.mjs` copies three's Basis transcoder. Relative like the JPGs. */
export const BASIS_TRANSCODER_PATH = './basis/';

/** KTX2Loader + zstddec + ktx-parse (~80 kB pre-minify) stay out of the entry chunk: a GPU with
 *  no compressed target never fetches them, and the rest fetch them alongside the textures. */
export const ktx2LoaderModule = lazyModule(() => import('three/examples/jsm/loaders/KTX2Loader.js'));

type CompressionSupport = Record<
  'astcSupported' | 'etc1Supported' | 'etc2Supported' | 'dxtSupported' | 'bptcSupported' | 'pvrtcSupported',
  boolean
>;

/** True when at least one block-compressed target format exists on this GPU. */
export function hasCompressedTarget(support: Partial<CompressionSupport> | null | undefined): boolean {
  if (!support) return false;
  return Boolean(
    support.astcSupported ||
      support.bptcSupported ||
      support.etc2Supported ||
      support.dxtSupported ||
      support.etc1Supported ||
      support.pvrtcSupported,
  );
}

type DetectableRenderer = Parameters<KTX2Loader['detectSupport']>[0];

/** The WebGL extensions / WebGPU features KTX2Loader.detectSupport reads. */
const WEBGL_COMPRESSION_EXTENSIONS = [
  'WEBGL_compressed_texture_astc',
  'WEBGL_compressed_texture_etc1',
  'WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_s3tc',
  'EXT_texture_compression_bptc',
  'WEBGL_compressed_texture_pvrtc',
  'WEBKIT_WEBGL_compressed_texture_pvrtc',
] as const;
const WEBGPU_COMPRESSION_FEATURES = [
  'texture-compression-astc',
  'texture-compression-etc1',
  'texture-compression-etc2',
  'texture-compression-s3tc',
  'texture-compression-bc',
  'texture-compression-pvrtc',
] as const;

/**
 * Cheap pre-check, no loader needed: does the GPU expose any compressed format at all?
 * `detectSupport` can only switch formats *off* from this set (its Linux/Mesa filter), so a
 * `false` here is final and the loader chunk is never fetched.
 */
export function rendererMayUseKtx2(renderer: unknown): boolean {
  if (!renderer || typeof renderer !== 'object') return false;
  try {
    const r = renderer as {
      isWebGPURenderer?: boolean;
      hasFeature?: (name: string) => boolean;
      extensions?: { has: (name: string) => boolean };
    };
    if (r.isWebGPURenderer === true) {
      return WEBGPU_COMPRESSION_FEATURES.some((name) => Boolean(r.hasFeature?.(name)));
    }
    return WEBGL_COMPRESSION_EXTENSIONS.some((name) => Boolean(r.extensions?.has(name)));
  } catch {
    return false;
  }
}

const decisions = new WeakMap<object, Promise<boolean>>();

/**
 * Whether this renderer should load the KTX2 set. Cached per renderer.
 * Settles `false` without fetching the loader when `rendererMayUseKtx2` does.
 */
export function shouldUseKtx2(renderer: unknown): Promise<boolean> {
  if (!rendererMayUseKtx2(renderer)) return Promise.resolve(false);
  const key = renderer as object;
  let decision = decisions.get(key);
  if (!decision) {
    decision = ktx2LoaderModule.load().then(
      ({ KTX2Loader: Loader }) => {
        try {
          // detectSupport only reads extensions/features into workerConfig; the
          // workers spin up on the first load, not here.
          const probe = new Loader().detectSupport(renderer as DetectableRenderer);
          return hasCompressedTarget((probe as unknown as { workerConfig: CompressionSupport | null }).workerConfig);
        } catch {
          return false;
        }
      },
      () => false,
    );
    decisions.set(key, decision);
  }
  return decision;
}

/** A loader configured for this renderer. */
export function configureKtx2Loader(loader: KTX2Loader, renderer: unknown): void {
  loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  loader.detectSupport(renderer as DetectableRenderer);
}

/**
 * The five Rock031 maps (colour, normal, roughness, AO, displacement), KTX2 when the GPU
 * takes it, else the JPGs. One load per renderer, shared by `BootAssetPreloader` (which
 * starts it during the boot loader) and `TrackManager` (which reads it under Suspense).
 * Loaders use three's default LoadingManager, so drei's progress bar sees both.
 */
async function loadRockTextures(renderer: unknown): Promise<THREE.Texture[]> {
  if (await shouldUseKtx2(renderer)) {
    const { KTX2Loader: Loader } = await ktx2LoaderModule.load();
    const loader = new Loader();
    configureKtx2Loader(loader, renderer);
    return Promise.all(TRACK_ROCK_TEXTURE_PATHS_KTX2.map((url) => loader.loadAsync(url)));
  }
  const loader = new THREE.TextureLoader();
  return Promise.all(TRACK_ROCK_TEXTURE_PATHS.map((url) => loader.loadAsync(url)));
}

type RockResource =
  | { status: 'pending'; promise: Promise<void> }
  | { status: 'ready'; value: THREE.Texture[] }
  | { status: 'failed'; error: unknown };

const rockResources = new WeakMap<object, RockResource>();

function rockResourceFor(renderer: object): RockResource {
  let resource = rockResources.get(renderer);
  if (!resource) {
    const pending: RockResource = {
      status: 'pending',
      promise: loadRockTextures(renderer).then(
        (value) => {
          rockResources.set(renderer, { status: 'ready', value });
        },
        (error: unknown) => {
          rockResources.set(renderer, { status: 'failed', error });
        },
      ),
    };
    resource = pending;
    rockResources.set(renderer, resource);
  }
  return resource;
}

/** Start the rock-texture load without reading it (the boot preloader). */
export function preloadRockTextures(renderer: object): void {
  rockResourceFor(renderer);
}

/** Suspense read: the textures once loaded, else throws the pending promise (or the load error). */
export function readRockTextures(renderer: object): THREE.Texture[] {
  const resource = rockResourceFor(renderer);
  if (resource.status === 'ready') return resource.value;
  if (resource.status === 'failed') throw resource.error;
  throw resource.promise;
}

/**
 * Colour-space tagging both paths share. The KTX2 colour map already carries
 * sRGB from its DFD; the JPG doesn't, and an untagged sRGB albedo would be
 * encoded twice now that the post chain ends with one sRGB encode (#466).
 */
export function tagRockColorSpaces(textures: readonly (THREE.Texture | null | undefined)[]): void {
  textures.forEach((texture, index) => {
    if (!texture) return;
    const colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (texture.colorSpace === colorSpace) return;
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
  });
}
