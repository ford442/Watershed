/**
 * pillarCrumble.ts — Pure helpers for seg-22 crumbling column pillars.
 *
 * Speed gating mirrors shelfLaunch.ts: only high-velocity impacts trigger
 * demolition; slower hits leave the pillar intact and let normal wipeout
 * physics handle the player.
 */

import * as THREE from 'three';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';
import type { Vec3 } from '../../vehicles/utils/shelfLaunch';

/** Minimum player speed (m/s) to shatter a crumbling pillar. */
export const PILLAR_CRUMBLE_SPEED_THRESHOLD = VEHICLE_TUNING.pillarCrumble.speedThreshold;

/** Brief cracking phase before fragments spawn (seconds). */
export const PILLAR_CRACK_DURATION_S = 0.15;

/** Fragment lifetime before despawn (seconds). */
export const PILLAR_FRAGMENT_LIFETIME_S = 4.0;

/** Target fragment count per shattered pillar (clamped by global pool). */
export const PILLAR_FRAGMENT_COUNT_MIN = 6;
export const PILLAR_FRAGMENT_COUNT_MAX = 10;

export type PillarPhase = 'intact' | 'cracking' | 'shattered';

export interface PillarFragmentSpawn {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  impulse: THREE.Vector3;
}

export interface PillarImpactInput {
  playerSpeed: number;
  phase: PillarPhase;
  speedThreshold?: number;
}

export interface PillarImpactResult {
  shouldCrack: boolean;
  reason: 'already_broken' | 'too_slow' | 'ok';
}

/** Returns whether a pillar contact should begin the cracking phase. */
export function evaluatePillarImpact(input: PillarImpactInput): PillarImpactResult {
  if (input.phase !== 'intact') {
    return { shouldCrack: false, reason: 'already_broken' };
  }

  const threshold = input.speedThreshold ?? PILLAR_CRUMBLE_SPEED_THRESHOLD;
  if (!Number.isFinite(input.playerSpeed) || input.playerSpeed < threshold) {
    return { shouldCrack: false, reason: 'too_slow' };
  }

  return { shouldCrack: true, reason: 'ok' };
}

export function isPlayerRigidBody(
  body: { userData?: unknown; bodyType?: () => number } | null | undefined,
  rapierDynamicType: number,
): boolean {
  if (!body) return false;
  const userData = body.userData as Record<string, unknown> | undefined;
  if (userData?.isPlayer === true) return true;
  try {
    return body.bodyType?.() === rapierDynamicType;
  } catch {
    return false;
  }
}

export function vec3FromRapier(v: { x: number; y: number; z: number }): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function horizontalSpeed(velocity: Vec3): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

/**
 * Deterministic fragment layout + outward scatter impulses for one pillar.
 */
export function buildPillarFragments(args: {
  center: THREE.Vector3;
  columnScale: THREE.Vector3;
  impactDir: THREE.Vector3;
  seed: number;
  count: number;
}): PillarFragmentSpawn[] {
  const { center, columnScale, impactDir, seed, count } = args;
  const fragments: PillarFragmentSpawn[] = [];
  const baseImpulse = VEHICLE_TUNING.pillarCrumble.fragmentImpulse;

  for (let i = 0; i < count; i++) {
    const s = seed + i * 97;
    const angle = (i / count) * Math.PI * 2 + seededUnit(s) * 0.6;
    const radius = 0.25 + seededUnit(s + 3) * 0.55;
    const height = 0.4 + seededUnit(s + 7) * (columnScale.y * 0.85);

    const offset = new THREE.Vector3(
      Math.cos(angle) * radius * columnScale.x,
      height,
      Math.sin(angle) * radius * columnScale.z,
    );

    const position = center.clone().add(offset);
    const fragmentScale = new THREE.Vector3(
      0.22 + seededUnit(s + 11) * 0.18,
      0.18 + seededUnit(s + 13) * 0.22,
      0.22 + seededUnit(s + 17) * 0.18,
    ).multiply(columnScale.clone().multiplyScalar(0.22));

    const outward = offset.clone().normalize();
    if (outward.lengthSq() < 1e-6) {
      outward.copy(impactDir).normalize();
    }

    const impulse = outward
      .clone()
      .multiplyScalar(baseImpulse * (0.65 + seededUnit(s + 19) * 0.7))
      .add(new THREE.Vector3(0, baseImpulse * (0.35 + seededUnit(s + 23) * 0.4), 0))
      .add(impactDir.clone().multiplyScalar(baseImpulse * 0.25));

    const rotation = new THREE.Euler(
      seededUnit(s + 29) * Math.PI,
      seededUnit(s + 31) * Math.PI,
      seededUnit(s + 37) * Math.PI,
    );

    fragments.push({ position, rotation, scale: fragmentScale, impulse });
  }

  return fragments;
}

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
