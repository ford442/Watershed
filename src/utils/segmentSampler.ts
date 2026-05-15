import * as THREE from 'three';

export interface SegmentFlowSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
  distance: number;
  flowSpeed: number;
  canyonWidth: number;
  state: string;
}

const _tmpPoint = new THREE.Vector3();
const _tmpTangent = new THREE.Vector3();
const _tmpLateral = new THREE.Vector3();

export function sampleSegmentFlow(segment: any, worldPosition: THREE.Vector3): SegmentFlowSample | null {
  if (!segment?.segmentPath) return null;

  const curve: THREE.CatmullRomCurve3 = segment.segmentPath;
  const steps = 24;
  let bestT = 0;
  let bestDistance = Infinity;

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const point = curve.getPoint(t, _tmpPoint);
    const distance = point.distanceTo(worldPosition);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }

  const point = curve.getPoint(bestT, _tmpPoint).clone();
  const rawTangent = curve.getTangent(bestT, _tmpTangent);
  if (rawTangent.lengthSq() < 1e-6) return null; // degenerate curve — skip
  const tangent = rawTangent.normalize();
  const rawLateral = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
  const lateral = rawLateral.lengthSq() < 1e-6
    ? new THREE.Vector3(1, 0, 0) // fallback when tangent is vertical
    : rawLateral.normalize();

  return {
    point,
    tangent,
    lateral,
    distance: bestDistance,
    flowSpeed: segment.flowSpeed ?? 1,
    canyonWidth: segment.width ?? 35,
    state: segment.segmentState ?? 'Normal',
  };
}
