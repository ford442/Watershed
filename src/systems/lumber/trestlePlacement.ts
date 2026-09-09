/**
 * trestlePlacement — TrestleSpan curve parameters → world deck placements.
 *
 * Split from `BreakableTrestle` so the geometry the player lands on can be
 * asserted without mounting Rapier, and from `trestleSpan` so that module stays
 * free of Three.js.
 */

import * as THREE from 'three';
import { TRESTLE_DECK_HEIGHT, type TrestlePlank, type TrestleSpan } from './trestleSpan';

export interface TrestlePlankPlacement extends TrestlePlank {
  position: THREE.Vector3;
  /** Yaw aligning the board across the channel. */
  yaw: number;
}

/**
 * Resolve every surviving board onto the segment path.
 *
 * Boards sit on the water surface plus `TRESTLE_DECK_HEIGHT`, not on the path
 * point: the gap segment's floor is missing by design (`openFloor`), so the
 * deck is the only thing with a height that means anything there.
 */
export function placeTrestlePlanks(
  span: TrestleSpan,
  segmentPath: THREE.CatmullRomCurve3 | null | undefined,
  waterLevel: number,
): TrestlePlankPlacement[] {
  if (!span.present || !segmentPath) return [];

  const placements: TrestlePlankPlacement[] = [];
  for (const plank of span.planks) {
    const t = THREE.MathUtils.clamp(plank.t, 0, 1);
    const point = segmentPath.getPoint(t);
    const tangent = segmentPath.getTangent(t).normalize();
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z) ||
      !Number.isFinite(tangent.x)
    ) {
      continue;
    }

    const binormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const position = point.clone().addScaledVector(binormal, plank.lateralOffset);
    position.y = waterLevel + TRESTLE_DECK_HEIGHT;

    placements.push({
      ...plank,
      position,
      yaw: Math.atan2(tangent.x, tangent.z),
    });
  }
  return placements;
}
