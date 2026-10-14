/**
 * waterForceAuthority.test.ts — two water-force paths, one owner per tick (#467).
 */

import { describe, expect, it } from 'vitest';
import { calculateWaterForceFallback } from '../systems/water/waterForceFallback';
import { WATER_FORCE_FIXTURES } from './__tests__/waterForceFixtures';
import { computeHullMirrorForce } from './hullMirrorForce';
import { PHYSICS_WORKER_IMPULSE_SCALE } from './physicsWorkerWaterForces';
import type { WaterForceDiagnostics } from './rapierWorkerProtocol';
import {
  pickHullForce,
  resolveWaterForceOwner,
  WATER_FORCE_IMPULSE_SCALE,
  type WaterForceOwner,
} from './waterForceAuthority';

const force = (source: WaterForceDiagnostics['source'], forceX: number): WaterForceDiagnostics => ({
  source,
  forceX,
  forceY: 0,
  forceZ: 0,
  buoyancy: 0,
  drag: 0,
  flow: 0,
  turbulence: 0,
  submergedRatio: 1,
});

describe('resolveWaterForceOwner — the two-way choice', () => {
  const cases: Array<{ simWorkerForces: boolean; expected: WaterForceOwner }> = [
    { simWorkerForces: true, expected: 'sim-worker' },
    { simWorkerForces: false, expected: 'ts-mirror' },
  ];
  for (const { simWorkerForces, expected } of cases) {
    it(`simWorkerForces=${simWorkerForces} → ${expected}`, () => {
      expect(resolveWaterForceOwner({ simWorkerForces })).toBe(expected);
    });
  }

  it('has exactly two owners', () => {
    const owners = new Set([true, false].map((simWorkerForces) => resolveWaterForceOwner({ simWorkerForces })));
    expect([...owners].sort()).toEqual(['sim-worker', 'ts-mirror']);
  });
});

describe('pickHullForce — the Rapier worker applies one force and computes none', () => {
  it('takes the sim worker force when the hull link has a fresh one', () => {
    const fromSim = force('wasm', 5);
    const picked = pickHullForce(fromSim, force('fallback', 9));
    expect(picked).toEqual({ owner: 'sim-worker', force: fromSim });
  });

  it('takes the main thread mirror when the link has none (startup, stale, unlinked)', () => {
    const mirror = force('fallback', 9);
    expect(pickHullForce(null, mirror)).toEqual({ owner: 'ts-mirror', force: mirror });
  });

  it('applies nothing when neither exists', () => {
    expect(pickHullForce(null, undefined)).toBeNull();
    expect(pickHullForce(null, null)).toBeNull();
  });
});

describe('computeHullMirrorForce — the TS mirror the hull falls back to', () => {
  it('is calculateWaterForceFallback on the tick params, for every fixture', () => {
    for (const fixture of WATER_FORCE_FIXTURES) {
      const mirror = computeHullMirrorForce(
        { position: fixture.sample.position, velocity: fixture.sample.velocity },
        {
          enabled: true,
          ...fixture.config,
          flowDirX: fixture.sample.flowDirection.x,
          flowDirZ: fixture.sample.flowDirection.z,
        },
      );
      const expected = calculateWaterForceFallback(fixture.sample, fixture.config);
      expect(mirror.source).toBe('fallback');
      expect(mirror.forceX).toBe(expected.forceX);
      expect(mirror.forceY).toBe(expected.forceY);
      expect(mirror.forceZ).toBe(expected.forceZ);
      expect(mirror.submergedRatio).toBe(expected.submergedRatio);
    }
  });

  it('reports disabled when water forces are off', () => {
    const fixture = WATER_FORCE_FIXTURES[0];
    const mirror = computeHullMirrorForce(
      { position: fixture.sample.position, velocity: fixture.sample.velocity },
      { enabled: false, ...fixture.config, flowDirX: 0, flowDirZ: -1 },
    );
    expect(mirror.source).toBe('disabled');
    expect(mirror.forceX).toBe(0);
  });

  it('uses one impulse scale on every path', () => {
    expect(WATER_FORCE_IMPULSE_SCALE).toBe(0.001);
    expect(PHYSICS_WORKER_IMPULSE_SCALE).toBe(WATER_FORCE_IMPULSE_SCALE);
  });
});

describe('SWE velocity into calculateWaterForceFallback', () => {
  const fixture = WATER_FORCE_FIXTURES[0];
  const plusXSample = {
    ...fixture.sample,
    velocity: { x: 0, y: 0, z: 0 },
    flowDirection: { x: 1, z: 0 },
  };
  const downstreamSample = {
    ...plusXSample,
    flowDirection: { x: 0, z: -1 },
  };

  it('a body in a SWE cell with u>0, w=0 receives force along +X, not (0, −1)', () => {
    const plusX = calculateWaterForceFallback(plusXSample, fixture.config);
    const downstream = calculateWaterForceFallback(downstreamSample, fixture.config);
    expect(plusX.submergedRatio).toBeGreaterThan(0);
    expect(plusX.forceX).toBeGreaterThan(0);
    expect(Math.abs(plusX.forceX)).toBeGreaterThan(Math.abs(plusX.forceZ));
    expect(plusX.forceX).not.toBeCloseTo(downstream.forceX, 2);
    expect(downstream.forceZ).toBeLessThan(0);
  });
});
