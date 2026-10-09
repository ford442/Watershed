import { useEffect } from 'react';
import * as THREE from 'three';
import { useLoader, useThree } from '@react-three/fiber';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { TRACK_ROCK_TEXTURE_PATHS, TRACK_ROCK_TEXTURE_PATHS_KTX2 } from '../constants/trackTextures';
import { configureKtx2Loader, shouldUseKtx2 } from '../rendering/ktx2Textures';

/**
 * Warms the drei/THREE texture cache during the boot loader so the first START
 * click does not re-trigger a full-screen asset overlay.
 */
export default function BootAssetPreloader() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    // Same loader + URLs as TrackManager, so its useLoader call hits this cache.
    if (shouldUseKtx2(gl)) {
      useLoader.preload(KTX2Loader, [...TRACK_ROCK_TEXTURE_PATHS_KTX2], (loader) =>
        configureKtx2Loader(loader as KTX2Loader, gl),
      );
    } else {
      useLoader.preload(THREE.TextureLoader, [...TRACK_ROCK_TEXTURE_PATHS]);
    }
  }, [gl]);

  return null;
}
