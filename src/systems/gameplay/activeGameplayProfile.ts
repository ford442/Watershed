/**
 * activeGameplayProfile.ts — the gameplay profile in force under the player
 * (#521 B).
 *
 * Written by one place only, the SimCore `gameplay-profile` system
 * (gameplaySimSystem.ts), once per fixed step; read by the water forces (flow
 * cap), survival (cold, wind drying) and the vehicles' impact events (surface).
 * A plain module object, mutated in place: readers on the frame path allocate
 * nothing.
 */
import { copyGameplayProfile, createGameplayProfile, type GameplayProfile } from './gameplayProfile';

const active: GameplayProfile = createGameplayProfile();

/** The live profile (the same object every call; do not hold field values across steps). */
export function getActiveGameplayProfile(): Readonly<GameplayProfile> {
  return active;
}

/** Publish the step's profile. The gameplay-profile system and tests are the only callers. */
export function publishActiveGameplayProfile(next: Readonly<GameplayProfile>): void {
  copyGameplayProfile(active, next);
}

/** Back to the default biome's row (tests). */
export function resetActiveGameplayProfileForTests(): void {
  copyGameplayProfile(active, createGameplayProfile());
}
