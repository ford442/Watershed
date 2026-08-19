/**
 * PillarFragmentRegistry — global cap on live pillar debris rigid bodies.
 *
 * Mirrors the FloatingObjectRegistry pattern: a module-level counter so
 * fragment spawns across segments share one budget (max 30 live fragments).
 */

export const MAX_LIVE_PILLAR_FRAGMENTS = 30;

let liveFragmentCount = 0;

/** How many fragment slots are currently in use. */
export function getLivePillarFragmentCount(): number {
  return liveFragmentCount;
}

/**
 * Try to reserve fragment slots. Returns the number actually granted
 * (may be less than requested when the global cap is reached).
 */
export function tryAcquirePillarFragmentSlots(requested: number): number {
  const available = MAX_LIVE_PILLAR_FRAGMENTS - liveFragmentCount;
  const granted = Math.max(0, Math.min(requested, available));
  liveFragmentCount += granted;
  return granted;
}

/** Release fragment slots when debris despawns or the pool is cleared. */
export function releasePillarFragmentSlots(count: number): void {
  liveFragmentCount = Math.max(0, liveFragmentCount - count);
}

/** Reset on run restart / level unload. */
export function clearPillarFragmentRegistry(): void {
  liveFragmentCount = 0;
}
