/**
 * surfaceMaterial.ts — the surface a vehicle is on, and the contact friction it
 * gives (#521 B). Three-free and Rapier-free, so the gameplay profile table
 * (systems/gameplay/) can name a surface without pulling in the vehicle classes.
 *
 * Which surface a segment has is the segment's `GameplayProfile.surface`, not a
 * biome lookup.
 */

export enum SurfaceMaterial {
  MOSS = 'moss',
  ROCK = 'rock',
  WOOD = 'wood',
  CONCRETE = 'concrete',
  WATER = 'water',
}

export const MATERIAL_FRICTION: Record<SurfaceMaterial, number> = {
  [SurfaceMaterial.MOSS]: 0.4,      // Slippery
  [SurfaceMaterial.WOOD]: 0.4,      // Slippery
  [SurfaceMaterial.ROCK]: 0.6,      // Medium
  [SurfaceMaterial.CONCRETE]: 0.8,  // Sticky
  [SurfaceMaterial.WATER]: 0.1,     // Sliding
};
