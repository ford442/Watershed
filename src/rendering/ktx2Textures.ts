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
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** Where `build-textures.mjs` copies three's Basis transcoder. Relative like the JPGs. */
export const BASIS_TRANSCODER_PATH = './basis/';

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

const decisions = new WeakMap<object, boolean>();

/** Whether this renderer should load the KTX2 set. Cached per renderer. */
export function shouldUseKtx2(renderer: unknown): boolean {
  if (!renderer || typeof renderer !== 'object') return false;
  const cached = decisions.get(renderer);
  if (cached !== undefined) return cached;
  let decision: boolean;
  try {
    // detectSupport only reads extensions/features into workerConfig; the
    // workers spin up on the first load, not here.
    const probe = new KTX2Loader().detectSupport(renderer as DetectableRenderer);
    decision = hasCompressedTarget((probe as unknown as { workerConfig: CompressionSupport | null }).workerConfig);
  } catch {
    decision = false;
  }
  decisions.set(renderer, decision);
  return decision;
}

/** The loader `useLoader` constructs, configured for this renderer. */
export function configureKtx2Loader(loader: KTX2Loader, renderer: unknown): void {
  loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  loader.detectSupport(renderer as DetectableRenderer);
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
