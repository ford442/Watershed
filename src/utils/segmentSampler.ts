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

/** A reusable result for `sampleSegmentFlow`: callers keep two and swap the closer one in. */
export function createSegmentFlowSample(): SegmentFlowSample {
  return {
    point: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    lateral: new THREE.Vector3(),
    distance: Infinity,
    flowSpeed: 1,
    canyonWidth: 35,
    state: 'Normal',
  };
}

/** Samples along the path; the nearest one is the body's position on the segment. */
const STEPS = 24;
const SAMPLES = STEPS + 1;

/**
 * Per-segment cache (#502 D), keyed on the segment's curve — one per segment
 * id, rebuilt by ChunkManager when a pool slot is reused, never mutated — and
 * the sample index: xyz of the point and the unit tangent at t = index / STEPS
 * (tangent length 0 marks a degenerate sample). Built on first use, so the
 * per-frame cost per body is SAMPLES distance tests and no curve evaluation;
 * it used to be 25 `getPoint` calls and 4 `Vector3` allocations per body per
 * frame (WaterFlowForces, VehicleTuner).
 */
const cache = new WeakMap<THREE.Curve<THREE.Vector3>, Float64Array>();
const STRIDE = 6;
const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

function samplesFor(curve: THREE.Curve<THREE.Vector3>): Float64Array {
  let samples = cache.get(curve);
  if (samples) return samples;
  samples = new Float64Array(SAMPLES * STRIDE);
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / STEPS;
    curve.getPoint(t, _p);
    curve.getTangent(t, _t);
    const o = index * STRIDE;
    samples[o] = _p.x;
    samples[o + 1] = _p.y;
    samples[o + 2] = _p.z;
    if (_t.lengthSq() >= 1e-6) _t.normalize();
    else _t.set(0, 0, 0);
    samples[o + 3] = _t.x;
    samples[o + 4] = _t.y;
    samples[o + 5] = _t.z;
  }
  cache.set(curve, samples);
  return samples;
}

/**
 * The nearest of the path's samples to `worldPosition`, written into `target`.
 * Returns `target`, or null when the segment has no path or the nearest
 * sample's tangent is degenerate (`target` is then left as it was).
 */
export function sampleSegmentFlow(
  segment: any,
  worldPosition: THREE.Vector3,
  target: SegmentFlowSample,
): SegmentFlowSample | null {
  if (!segment?.segmentPath) return null;

  const samples = samplesFor(segment.segmentPath as THREE.Curve<THREE.Vector3>);
  let best = 0;
  let bestDistanceSq = Infinity;
  for (let index = 0; index < SAMPLES; index += 1) {
    const o = index * STRIDE;
    const dx = samples[o] - worldPosition.x;
    const dy = samples[o + 1] - worldPosition.y;
    const dz = samples[o + 2] - worldPosition.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDistanceSq) {
      bestDistanceSq = d2;
      best = index;
    }
  }

  const o = best * STRIDE;
  if (samples[o + 3] === 0 && samples[o + 4] === 0 && samples[o + 5] === 0) return null; // degenerate curve — skip
  target.point.set(samples[o], samples[o + 1], samples[o + 2]);
  target.tangent.set(samples[o + 3], samples[o + 4], samples[o + 5]);
  target.lateral.crossVectors(target.tangent, UP);
  if (target.lateral.lengthSq() < 1e-6) target.lateral.set(1, 0, 0); // fallback when tangent is vertical
  else target.lateral.normalize();
  target.distance = Math.sqrt(bestDistanceSq);
  target.flowSpeed = segment.flowSpeed ?? 1;
  target.canyonWidth = segment.width ?? 35;
  target.state = segment.segmentState ?? 'Normal';
  return target;
}
