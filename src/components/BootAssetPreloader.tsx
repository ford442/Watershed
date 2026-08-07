import { useEffect } from 'react';
import { useTexture } from '@react-three/drei';
import { TRACK_ROCK_TEXTURE_PATHS } from '../constants/trackTextures';

/**
 * Warms the drei/THREE texture cache during the boot loader so the first START
 * click does not re-trigger a full-screen asset overlay.
 */
export default function BootAssetPreloader() {
  useEffect(() => {
    useTexture.preload([...TRACK_ROCK_TEXTURE_PATHS]);
  }, []);

  return null;
}
