import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hasCompressedTarget, ktx2LoaderModule, rendererMayUseKtx2, shouldUseKtx2, tagRockColorSpaces } from './ktx2Textures';
import { TRACK_ROCK_TEXTURE_PATHS, TRACK_ROCK_TEXTURE_PATHS_KTX2 } from '../constants/trackTextures';

function webglRenderer(extensions: string[]) {
  return { extensions: { has: (name: string) => extensions.includes(name), get: () => null } };
}

describe('KTX2 rock textures', () => {
  it('needs at least one block-compressed target format', () => {
    expect(hasCompressedTarget(null)).toBe(false);
    expect(hasCompressedTarget({ astcSupported: false, bptcSupported: false })).toBe(false);
    expect(hasCompressedTarget({ etc2Supported: true })).toBe(true);
    expect(hasCompressedTarget({ dxtSupported: true })).toBe(true);
  });

  it('keeps the JPGs on a GPU with no compressed format (transcoding to RGBA32 would cost more)', async () => {
    expect(await shouldUseKtx2(webglRenderer([]))).toBe(false);
    expect(await shouldUseKtx2(webglRenderer(['WEBGL_compressed_texture_s3tc']))).toBe(true);
    expect(await shouldUseKtx2(null)).toBe(false);
  });

  it('never fetches the KTX2 loader chunk for a GPU that cannot use it', async () => {
    ktx2LoaderModule.reset();
    expect(rendererMayUseKtx2(webglRenderer([]))).toBe(false);
    await shouldUseKtx2(webglRenderer([]));
    expect(ktx2LoaderModule.get()).toBeNull();
    await shouldUseKtx2(webglRenderer(['EXT_texture_compression_bptc']));
    expect(ktx2LoaderModule.get()).not.toBeNull();
  });

  it('asks a node renderer for its texture-compression features', async () => {
    const renderer = { isWebGPURenderer: true, hasFeature: (f: string) => f === 'texture-compression-bc' };
    expect(await shouldUseKtx2(renderer)).toBe(true);
  });

  it('ships the same maps, in the same order, in both formats', () => {
    const stem = (p: string) => p.replace(/^.*Rock031_(?:1K-JPG_)?/, '').replace(/\.\w+$/, '');
    expect(TRACK_ROCK_TEXTURE_PATHS_KTX2.map(stem)).toEqual(TRACK_ROCK_TEXTURE_PATHS.map(stem));
  });

  it('tags the albedo sRGB and the data maps linear, so the one output encode is not doubled', () => {
    const maps = Array.from({ length: 5 }, () => new THREE.Texture());
    tagRockColorSpaces(maps);
    expect(maps[0].colorSpace).toBe(THREE.SRGBColorSpace);
    for (const map of maps.slice(1)) expect(map.colorSpace).toBe(THREE.NoColorSpace);
  });
});
