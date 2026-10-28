/**
 * activeGameplayProfile.ts — the gameplay profile in force under the player
 * (#521 B).
 *
 * Written by one place only, the SimCore `gameplay-profile` system
 * (gameplaySimSystem.ts), once per fixed step; read by the water forces (flow
 * cap), survival (cold, wind drying) and the vehicles (surface). A plain module
 * object, mutated in place: readers on the frame path allocate nothing.
 */
import type { SurfaceMaterial } from '../vehicle/surfaceMaterial';
import { copyGameplayProfile, createGameplayProfile, type GameplayProfile } from './gameplayProfile';

const active: GameplayProfile = createGameplayProfile();
const surfaceListeners = new Set<(surface: SurfaceMaterial) => void>();

/** The live profile (the same object every call; do not hold field values across steps). */
export function getActiveGameplayProfile(): Readonly<GameplayProfile> {
  return active;
}

/**
 * Publish the step's profile. Surface listeners hear a change of surface, not
 * every step. The gameplay-profile system and tests are the only callers.
 */
export function publishActiveGameplayProfile(next: Readonly<GameplayProfile>): void {
  const surfaceChanged = next.surface !== active.surface;
  copyGameplayProfile(active, next);
  if (surfaceChanged) for (const listener of surfaceListeners) listener(active.surface);
}

/**
 * Hear the surface under the player change (the vehicles set their collider
 * friction from it). Changes only: read `getActiveGameplayProfile().surface`
 * for the current one.
 */
export function subscribeGameplaySurface(listener: (surface: SurfaceMaterial) => void): () => void {
  surfaceListeners.add(listener);
  return () => {
    surfaceListeners.delete(listener);
  };
}

/** Back to the default biome's row with no listeners (tests). */
export function resetActiveGameplayProfileForTests(): void {
  surfaceListeners.clear();
  copyGameplayProfile(active, createGameplayProfile());
}
