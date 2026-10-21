/**
 * segmentSampler — the cached sampler (#502 D) finds the same nearest sample
 * as walking the curve, and evaluates each segment's curve only once.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createSegmentFlowSample, sampleSegmentFlow } from './segmentSampler';

function curve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -6, 0),
    new THREE.Vector3(8, -8, -30),
    new THREE.Vector3(-5, -11, -60),
    new THREE.Vector3(2, -14, -95),
  ]);
}

/** The pre-#502 walk: 25 getPoint calls, nearest wins (first on ties). */
function reference(path: THREE.CatmullRomCurve3, at: THREE.Vector3) {
  let bestT = 0;
  let best = Infinity;
  for (let i = 0; i <= 24; i += 1) {
    const d = path.getPoint(i / 24).distanceTo(at);
    if (d < best) {
      best = d;
      bestT = i / 24;
    }
  }
  return { point: path.getPoint(bestT), tangent: path.getTangent(bestT).normalize(), distance: best };
}

describe('sampleSegmentFlow', () => {
  it('matches the uncached walk and writes into the caller’s target', () => {
    const path = curve();
    const segment = { segmentPath: path, flowSpeed: 1.4, width: 28, segmentState: 'HighFlow' };
    const target = createSegmentFlowSample();
    for (const at of [new THREE.Vector3(1, -7, -12), new THREE.Vector3(-4, -12, -70), new THREE.Vector3(30, 0, 10)]) {
      const got = sampleSegmentFlow(segment, at, target);
      expect(got).toBe(target);
      const want = reference(path, at);
      expect(got!.point.distanceTo(want.point)).toBeLessThan(1e-12);
      expect(got!.tangent.distanceTo(want.tangent)).toBeLessThan(1e-12);
      expect(got!.distance).toBeCloseTo(want.distance, 10);
      expect(Math.abs(got!.lateral.dot(got!.tangent))).toBeLessThan(1e-9);
    }
    expect(target).toMatchObject({ flowSpeed: 1.4, canyonWidth: 28, state: 'HighFlow' });
  });

  it('evaluates a segment’s curve once, not every frame', () => {
    const path = curve();
    const getPoint = vi.spyOn(path, 'getPoint');
    const segment = { segmentPath: path };
    const target = createSegmentFlowSample();
    const at = new THREE.Vector3(0, -8, -20);
    sampleSegmentFlow(segment, at, target);
    const first = getPoint.mock.calls.length;
    for (let frame = 0; frame < 30; frame += 1) sampleSegmentFlow(segment, at, target);
    expect(getPoint.mock.calls.length).toBe(first);
  });

  it('is null without a path', () => {
    expect(sampleSegmentFlow({}, new THREE.Vector3(), createSegmentFlowSample())).toBeNull();
  });
});
