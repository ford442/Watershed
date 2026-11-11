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

/** What the sampler reads of a segment — `SegmentData` satisfies it; every field may be absent. */
export interface FlowSampledSegment {
  segmentPath?: THREE.Curve<THREE.Vector3> | null;
  flowSpeed?: number;
  width?: number;
  segmentState?: string;
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

/**
 * The path lateral (#535 B): the horizontal unit vector to the right of a path tangent,
 * `tangent × up = (−t.z, 0, t.x)`, normalised. This is the one definition — every
 * placement, prop layout, flow sample and set-piece reads it from here, on one sign.
 * A vertical tangent has no lateral: the result is (0, 0, 0), as `crossVectors(t, up)
 * .normalize()` gave at the sites this replaced (`pathLateralOrX` picks +X instead).
 * Bit-identical to the `crossVectors` form: the cross with (0, 1, 0) is exact.
 */
export function pathLateral(tangent: Readonly<THREE.Vector3Like>, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-tangent.z, 0, tangent.x).normalize();
}

/** `pathLateral`, with +X where the tangent is (near) vertical — a body always gets a side. */
export function pathLateralOrX(tangent: Readonly<THREE.Vector3Like>, out: THREE.Vector3): THREE.Vector3 {
  out.set(-tangent.z, 0, tangent.x);
  if (out.lengthSq() < 1e-6) return out.set(1, 0, 0);
  return out.normalize();
}

/** Point, unit tangent and lateral of a path at parameter `t`. */
export interface PathFrame {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: THREE.Vector3;
}

export function createPathFrame(): PathFrame {
  return { point: new THREE.Vector3(), tangent: new THREE.Vector3(), lateral: new THREE.Vector3() };
}

/**
 * The path's frame at curve parameter `t` (`getPoint` / `getTangent`, not the arc-length
 * `getPointAt`), written into `out` with no allocation.
 */
export function sampleFrameAt(path: THREE.Curve<THREE.Vector3>, t: number, out: PathFrame): PathFrame {
  path.getPoint(t, out.point);
  path.getTangent(t, out.tangent).normalize();
  pathLateral(out.tangent, out.lateral);
  return out;
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
 * frame (VehicleTuner; the deleted WaterFlowForces was the other caller).
 */
const cache = new WeakMap<THREE.Curve<THREE.Vector3>, Float64Array>();
const STRIDE = 6;
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
  segment: FlowSampledSegment | null | undefined,
  worldPosition: THREE.Vector3,
  target: SegmentFlowSample,
): SegmentFlowSample | null {
  if (!segment?.segmentPath) return null;

  const samples = samplesFor(segment.segmentPath);
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
  pathLateralOrX(target.tangent, target.lateral);
  target.distance = Math.sqrt(bestDistanceSq);
  target.flowSpeed = segment.flowSpeed ?? 1;
  target.canyonWidth = segment.width ?? 35;
  target.state = segment.segmentState ?? 'Normal';
  return target;
}
