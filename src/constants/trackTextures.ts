/** Canonical PBR texture paths for canyon rock walls (shared by boot preload + TrackManager). */
export const TRACK_ROCK_TEXTURE_PATHS = [
  './Rock031_1K-JPG_Color.jpg',
  './Rock031_1K-JPG_NormalGL.jpg',
  './Rock031_1K-JPG_Roughness.jpg',
  './Rock031_1K-JPG_AmbientOcclusion.jpg',
  './Rock031_1K-JPG_Displacement.jpg',
] as const;

/**
 * The same set as KTX2 (scripts/build-textures.mjs), same order. Loaded instead
 * of the JPGs when the GPU has a compressed target format (ktx2Textures.ts).
 */
export const TRACK_ROCK_TEXTURE_PATHS_KTX2 = [
  './textures/Rock031_Color.ktx2',
  './textures/Rock031_NormalGL.ktx2',
  './textures/Rock031_Roughness.ktx2',
  './textures/Rock031_AmbientOcclusion.ktx2',
  './textures/Rock031_Displacement.ktx2',
] as const;
