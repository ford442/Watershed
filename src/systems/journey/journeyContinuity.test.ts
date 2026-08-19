/**
 * journeyContinuity.test.ts — Pure handoff join + biome kickoff helpers.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  blendWaterLevel,
  blendWidthsOverSegments,
  joinWaypoints,
  planBiomeTransitionKickoff,
  planMapHandoff,
  HANDOFF_BLEND_SEGMENTS,
} from './journeyContinuity';

describe('joinWaypoints', () => {
  it('translates next waypoints so the first point meets the previous end', () => {
    const prev = [
      { x: 0, y: -2, z: 10 },
      { x: 0, y: -2, z: 0 },
    ];
    const next = [
      { x: 100, y: 5, z: 50 },
      { x: 100, y: 5, z: 40 },
      { x: 102, y: 4, z: 30 },
    ];

    const { joinedWaypoints, offset } = joinWaypoints(prev, next);

    expect(offset.x).toBeCloseTo(-100);
    expect(offset.y).toBeCloseTo(-7);
    expect(offset.z).toBeCloseTo(-50);

    // After offset + tangent nudge, first point stays near the previous end.
    expect(joinedWaypoints[0].x).toBeCloseTo(0, 1);
    expect(joinedWaypoints[0].y).toBeCloseTo(-2, 1);
    expect(joinedWaypoints[0].z).toBeCloseTo(0, 1);
  });

  it('preserves relative spacing of the next path', () => {
    const prev = [
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(0, 0, 0),
    ];
    const next = [
      new THREE.Vector3(5, 0, 5),
      new THREE.Vector3(5, 0, -5),
    ];
    const { joinedWaypoints } = joinWaypoints(prev, next);
    const dx = joinedWaypoints[1].x - joinedWaypoints[0].x;
    const dz = joinedWaypoints[1].z - joinedWaypoints[0].z;
    expect(dx).toBeCloseTo(0);
    // ensureTangentContinuity nudges the joint by ~0.01 along the prev tangent
    expect(dz).toBeCloseTo(-10, 1);
  });

  it('returns empty join for empty next waypoints', () => {
    const result = joinWaypoints([{ x: 0, y: 0, z: 0 }], []);
    expect(result.joinedWaypoints).toEqual([]);
  });
});

describe('blendWidthsOverSegments', () => {
  it('blends width and waterWidth over the default segment count', () => {
    const steps = blendWidthsOverSegments(40, 12, 80, 24);
    expect(steps).toHaveLength(HANDOFF_BLEND_SEGMENTS);
    expect(steps[0].width).toBeCloseTo(40);
    expect(steps[0].waterWidth).toBeCloseTo(12);
    expect(steps[steps.length - 1].width).toBeCloseTo(80);
    expect(steps[steps.length - 1].waterWidth).toBeCloseTo(24);
  });

  it('uses a single step when blendCount is 1', () => {
    const steps = blendWidthsOverSegments(10, 5, 20, 8, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0].width).toBeCloseTo(20);
    expect(steps[0].waterWidth).toBeCloseTo(8);
  });
});

describe('blendWaterLevel', () => {
  it('lerps water Y across the seam', () => {
    expect(blendWaterLevel(0.5, 1.5, 0)).toBeCloseTo(0.5);
    expect(blendWaterLevel(0.5, 1.5, 0.5)).toBeCloseTo(1.0);
    expect(blendWaterLevel(0.5, 1.5, 1)).toBeCloseTo(1.5);
  });
});

describe('planMapHandoff', () => {
  it('plans hydro → delta with continuity fields', () => {
    const plan = planMapHandoff({
      fromMapId: 'hydro',
      toMapId: 'delta',
      lastSegmentIndex: 15,
      lastWidth: 40,
      lastWaterWidth: 14,
    });
    expect(plan).not.toBeNull();
    expect(plan!.fromMapId).toBe('hydro');
    expect(plan!.toMapId).toBe('delta');
    expect(plan!.initialBiome).toBe('delta');
    expect(plan!.preserveSurvival).toBe(true);
    expect(plan!.preserveScore).toBe(true);
    expect(plan!.preserveVehicleMotion).toBe(true);
    expect(plan!.widthBlend.length).toBeGreaterThanOrEqual(1);
    expect(plan!.biomeTransitionSeconds).toBeGreaterThan(0);
    // Hydro wires continuation.levelData → next starts at hydro totalSegments.
    expect(plan!.nextMapStartIndex).toBe(16);
  });

  it('plans meander → hydro via nextMapId', () => {
    const plan = planMapHandoff({
      fromMapId: 'meander',
      lastSegmentIndex: 38,
    });
    expect(plan).not.toBeNull();
    expect(plan!.toMapId).toBe('hydro');
    expect(plan!.nextMapStartIndex).toBe(39);
  });

  it('returns null for the final campaign map', () => {
    expect(
      planMapHandoff({ fromMapId: 'delta', lastSegmentIndex: 8 }),
    ).toBeNull();
  });
});

describe('planBiomeTransitionKickoff', () => {
  it('requests a crossfade (not a hard snap)', () => {
    const kickoff = planBiomeTransitionKickoff('delta', 2.5);
    expect(kickoff).toEqual({
      biomeId: 'delta',
      durationSeconds: 2.5,
      mode: 'crossfade',
    });
  });
});
