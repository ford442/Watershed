import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyRockSampling,
  hasCompressedTarget,
  ktx2LoaderModule,
  rendererMaxAnisotropy,
  rendererMayUseKtx2,
  rockAnisotropyFor,
  shouldUseKtx2,
  tagRockColorSpaces,
} from './ktx2Textures';
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

describe('rock texture anisotropy', () => {
  it('caps at 8, 4 on low, and never exceeds the GPU', () => {
    expect(rockAnisotropyFor(16, 'high')).toBe(8);
    expect(rockAnisotropyFor(16, 'ultra')).toBe(8);
    expect(rockAnisotropyFor(16, 'low')).toBe(4);
    expect(rockAnisotropyFor(2, 'high')).toBe(2);
    expect(rockAnisotropyFor(0, 'high')).toBe(1);
    expect(rockAnisotropyFor(Number.NaN, 'medium')).toBe(1);
  });

  it('reads the limit from either renderer', () => {
    expect(rendererMaxAnisotropy({ capabilities: { getMaxAnisotropy: () => 16 } })).toBe(16);
    expect(rendererMaxAnisotropy({ getMaxAnisotropy: () => 8 })).toBe(8);
    expect(rendererMaxAnisotropy({})).toBe(1);
    expect(rendererMaxAnisotropy(null)).toBe(1);
  });

  it('sets wrap, tiling and anisotropy, and re-uploads only an uploaded texture whose anisotropy changed', () => {
    const fresh = new THREE.Texture();
    const uploaded = new THREE.Texture();
    uploaded.needsUpdate = true; // version 1: three has seen it
    const version = uploaded.version;
    applyRockSampling([fresh, uploaded, null], 8);
    for (const texture of [fresh, uploaded]) {
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.repeat.x).toBe(4);
      expect(texture.repeat.y).toBe(8);
      expect(texture.anisotropy).toBe(8);
    }
    expect(fresh.version).toBe(0);
    expect(uploaded.version).toBe(version + 1);

    applyRockSampling([uploaded], 8);
    expect(uploaded.version).toBe(version + 1);
  });
});

describe('Basis transcoder delivery', () => {
  it('leaves the transcoder path empty so KTX2Loader fetches its own hashed asset', async () => {
    const { configureKtx2Loader } = await import('./ktx2Textures');
    const { KTX2Loader } = await ktx2LoaderModule.load();
    const loader = new KTX2Loader();
    configureKtx2Loader(loader, { capabilities: {}, extensions: { has: () => false } });
    expect((loader as unknown as { transcoderPath: string }).transcoderPath).toBe('');
  });
});
