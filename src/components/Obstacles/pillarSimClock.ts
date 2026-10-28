/**
 * pillarSimClock.ts — the sim clocks behind a crumbling pillar (#521 A).
 *
 * A pillar's crack (0.15 s before it shatters and drops its collider) and the
 * life of its debris (4 s before a fragment is released) are gameplay, so they
 * count sim seconds. They used to be advanced by Rock's and PillarFragmentPool's
 * own useFrame deltas; SimCore's `pillars` system now advances both once per
 * fixed step, and the components only read them.
 */
import { PILLAR_CRACK_DURATION_S } from './pillarCrumble';

export const PILLAR_SIM_ORDER = 50;

export interface PillarCrack {
  /** Sim seconds since the impact. */
  elapsedSec: number;
  /** Runs once, when the crack has lasted PILLAR_CRACK_DURATION_S. */
  onShatter: () => void;
}

const cracks = new Map<string, PillarCrack>();

/** Start (or restart) the crack for a pillar key (`${segmentId}:${pillarIndex}`). */
export function beginPillarCrack(key: string, onShatter: () => void): PillarCrack {
  const crack: PillarCrack = { elapsedSec: 0, onShatter };
  cracks.set(key, crack);
  return crack;
}

/** The pillar left the scene (unmount) or was reset: its crack never completes. */
export function cancelPillarCrack(key: string): void {
  cracks.delete(key);
}

/** Advance every live crack; a finished one is removed, then its `onShatter` runs. */
export function stepPillarCracks(dtSec: number): void {
  if (cracks.size === 0) return;
  for (const [key, crack] of cracks) {
    crack.elapsedSec += dtSec;
    if (crack.elapsedSec >= PILLAR_CRACK_DURATION_S) {
      cracks.delete(key);
      crack.onShatter();
    }
  }
}

export function resetPillarCracks(): void {
  cracks.clear();
}

/**
 * Sim seconds the debris pool has aged. Debris has colliders, so its lifetime
 * is gameplay: never wall time.
 */
let fragmentClockSec = 0;

export function advancePillarFragmentClock(dtSec: number): void {
  fragmentClockSec += Math.max(0, dtSec);
}

export function getPillarFragmentClock(): number {
  return fragmentClockSec;
}
