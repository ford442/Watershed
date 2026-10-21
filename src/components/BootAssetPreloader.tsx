import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { preloadRockTextures } from '../rendering/ktx2Textures';

/**
 * Warms the rock-texture cache during the boot loader so the first START
 * click does not re-trigger a full-screen asset overlay.
 */
export default function BootAssetPreloader() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    // Same resource TrackManager reads, so its Suspense read hits this cache.
    preloadRockTextures(gl);
  }, [gl]);

  return null;
}
