/**
 * Pure spawn-gate helpers for SplashSystem — unit-testable without R3F.
 */

export const CRUISE_MIN_SPEED = 1.0;
export const CRUISE_BASE_COUNT = 5;
export const CRUISE_MAX_COUNT = 20;
export const CRUISE_COOLDOWN = 0.08; // seconds between cruise bursts

export const MIST_MIN_SUBMERGED = 0.6;
export const MIST_MIN_SPEED = 2.0;
export const FOAM_MIN_SPEED = 2.0;

export type WaterContactEdge = 'none' | 'entry' | 'exit';

/** Detect water entry/exit edges from previous and current submerged flags. */
export function detectWaterContactEdge(
  wasInWater: boolean,
  isInWater: boolean,
): WaterContactEdge {
  if (isInWater && !wasInWater) return 'entry';
  if (!isInWater && wasInWater) return 'exit';
  return 'none';
}

/**
 * Cruise splash particle count from speed, flow, and LOD density.
 * Returns 0 when below min speed.
 */
export function cruiseSplashCount(
  speed: number,
  maxVelocity: number,
  flowSpeed: number,
  particleDensity: number,
): number {
  if (speed <= CRUISE_MIN_SPEED) return 0;
  const denom = Math.max(0.001, maxVelocity - CRUISE_MIN_SPEED);
  const t = Math.min(1, (speed - CRUISE_MIN_SPEED) / denom);
  return Math.floor(
    (CRUISE_BASE_COUNT + t * (CRUISE_MAX_COUNT - CRUISE_BASE_COUNT)) *
      (0.5 + flowSpeed * 0.5) *
      particleDensity,
  );
}

/** Mist crown gate + spawn count (raft only). */
export function mistSpawnCount(
  isRaft: boolean,
  submergedRatio: number,
  speed: number,
  flowSpeed: number,
  particleDensity: number,
): number {
  if (!isRaft || submergedRatio < MIST_MIN_SUBMERGED || speed <= MIST_MIN_SPEED) {
    return 0;
  }
  const opacity = Math.min(1, Math.max(0, (speed - 2) / 5));
  return Math.floor(opacity * 2 * flowSpeed * particleDensity);
}

/**
 * Which VFX events fire this frame.
 * On entry/exit edges, cruise is suppressed so the same contact does not double-spawn.
 */
export function resolveSplashFrameEvents(
  wasInWater: boolean,
  isInWater: boolean,
  isNearWater: boolean,
  speed: number,
  maxVelocity: number,
  flowSpeed: number,
  particleDensity: number,
  cruiseCooldownRemaining: number,
): {
  edge: WaterContactEdge;
  entrySplash: boolean;
  exitSplash: boolean;
  cruiseCount: number;
  foamEligible: boolean;
} {
  const edge = detectWaterContactEdge(wasInWater, isInWater);
  const entrySplash = edge === 'entry';
  const exitSplash = edge === 'exit';

  // Entry/exit win the frame — skip continuous cruise to avoid stacked VFX.
  let cruiseCount = 0;
  if (edge === 'none' && isNearWater && cruiseCooldownRemaining <= 0) {
    cruiseCount = cruiseSplashCount(speed, maxVelocity, flowSpeed, particleDensity);
  }

  const foamEligible =
    isInWater && speed > FOAM_MIN_SPEED && edge === 'none';

  return { edge, entrySplash, exitSplash, cruiseCount, foamEligible };
}

/** Raft submerged ratio from body Y relative to water surface. */
export function raftSubmergedRatio(
  bodyY: number,
  waterLevel: number,
  raftHeight = 0.3,
): number {
  return Math.max(
    0,
    Math.min(1, (waterLevel + raftHeight / 2 - bodyY) / raftHeight + 0.5),
  );
}

/** Entry/exit arc spawn count scaled by intensity and LOD density. */
export function entryExitSplashCount(
  intensity: number,
  particleDensity: number,
): number {
  return Math.max(1, Math.floor((10 + intensity * 15) * particleDensity));
}

/** Foam trail burst count scaled by LOD density. */
export function foamTrailCount(particleDensity: number): number {
  return Math.max(1, Math.floor((3 + Math.random() * 3) * particleDensity));
}
