import * as THREE from 'three';
import type { PlacementTransform } from './types';

/** Pure layout helpers for TrackSegmentMeshes (#371). */

export function buildLumberPropPositions(opts: {
  isLumberFlume: boolean;
  driftwood: PlacementTransform[] | undefined;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  pathLength: number;
  waterLevel: number;
}): THREE.Vector3[] {
  const { isLumberFlume, driftwood, segmentPath, pathLength, waterLevel } = opts;
  if (!isLumberFlume) return [];
  const fromDriftwood = (driftwood || [])
    .slice(0, 10)
    .map((t) => t.position.clone());
  if (fromDriftwood.length > 0) return fromDriftwood;
  if (!segmentPath || pathLength <= 0) return [];
  return [0.2, 0.45, 0.7].map((t) => {
    const p = segmentPath.getPoint(t);
    p.y = waterLevel + 0.15;
    return p;
  });
}

export function buildIndustrialPositions(opts: {
  isHydroDam: boolean;
  segmentPath: THREE.CatmullRomCurve3 | null | undefined;
  pathLength: number;
  waterLevel: number;
  hasBridge?: boolean;
  vortexConfig?: { centerT?: number; radius: number; lateralOffset?: number } | null;
}): {
  pipes: THREE.Vector3[];
  railings: THREE.Vector3[];
  catwalks: THREE.Vector3[];
  gates: THREE.Vector3[];
} {
  const { isHydroDam, segmentPath, pathLength, waterLevel, hasBridge, vortexConfig } = opts;
  if (!isHydroDam || !segmentPath || pathLength <= 0) {
    return { pipes: [], railings: [], catwalks: [], gates: [] };
  }
  const sample = (ts: number[], lateral: number, yOff: number) =>
    ts.map((t) => {
      const p = segmentPath.getPoint(t);
      const tangent = segmentPath.getTangent(t).normalize();
      const binormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      p.addScaledVector(binormal, lateral);
      p.y = waterLevel + yOff;
      return p;
    });
  return {
    pipes: sample([0.2, 0.55, 0.85], 4.5, 1.2),
    railings: sample([0.3, 0.6], 3.2, 1.6),
    catwalks: hasBridge ? sample([0.5], 0, 2.2) : sample([0.45], 2.8, 1.8),
    gates: vortexConfig ? sample([vortexConfig.centerT ?? 0.55], 0, 1.4) : [],
  };
}

export function buildVortexCenter(
  vortexConfig: { centerT?: number; lateralOffset?: number } | null | undefined,
  segmentPath: THREE.CatmullRomCurve3 | null | undefined,
): THREE.Vector3 | null {
  if (!vortexConfig || !segmentPath) return null;
  const t = THREE.MathUtils.clamp(vortexConfig.centerT ?? 0.55, 0, 1);
  const p = segmentPath.getPoint(t);
  const tangent = segmentPath.getTangent(t).normalize();
  const binormal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  p.addScaledVector(binormal, vortexConfig.lateralOffset ?? 0);
  return p;
}
