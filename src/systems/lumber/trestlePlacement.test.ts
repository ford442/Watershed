import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placeTrestlePlanks } from './trestlePlacement';
import {
  TRESTLE_DECK_HEIGHT,
  TRESTLE_SPAN_T0,
  TRESTLE_SPAN_T1,
  resolveTrestleSpan,
} from './trestleSpan';

const WATER_LEVEL = 0.5;

function straightPath(length = 95): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -1, -length / 3),
    new THREE.Vector3(0, -2, (-length * 2) / 3),
    new THREE.Vector3(0, -3, -length),
  ]);
}

function span(overrides: Partial<Parameters<typeof resolveTrestleSpan>[0]> = {}) {
  return resolveTrestleSpan({
    hasBridge: true,
    segmentState: 'Normal',
    segmentIndex: 10,
    hour: 0,
    waterWidth: 8,
    pathLength: 95,
    ...overrides,
  });
}

describe('placeTrestlePlanks', () => {
  it('lays the deck on the water surface, not on the missing floor', () => {
    const placements = placeTrestlePlanks(span(), straightPath(), WATER_LEVEL);
    expect(placements).toHaveLength(12);
    for (const placement of placements) {
      expect(placement.position.y).toBeCloseTo(WATER_LEVEL + TRESTLE_DECK_HEIGHT, 6);
      expect(Number.isFinite(placement.yaw)).toBe(true);
    }
  });

  it('walks downstream in order, inside the authored span', () => {
    const path = straightPath();
    const placements = placeTrestlePlanks(span(), path, WATER_LEVEL);

    const first = path.getPoint(TRESTLE_SPAN_T0).z;
    const last = path.getPoint(TRESTLE_SPAN_T1).z;
    for (const placement of placements) {
      expect(placement.position.z).toBeLessThanOrEqual(first);
      expect(placement.position.z).toBeGreaterThanOrEqual(last);
    }

    const zs = placements.map((p) => p.position.z);
    expect([...zs].sort((a, b) => b - a)).toEqual(zs);
  });

  it('leaves a hole where the span says one is', () => {
    const flood = span({ segmentState: 'WashedOut' });
    const placements = placeTrestlePlanks(flood, straightPath(), WATER_LEVEL);
    expect(placements.map((p) => p.index)).toEqual(flood.planks.map((p) => p.index));
    for (const missing of flood.missing) {
      expect(placements.some((p) => p.index === missing)).toBe(false);
    }
  });

  it('renders nothing without a span or a path', () => {
    expect(placeTrestlePlanks(span({ hasBridge: false }), straightPath(), WATER_LEVEL)).toEqual([]);
    expect(placeTrestlePlanks(span(), null, WATER_LEVEL)).toEqual([]);
  });
});
