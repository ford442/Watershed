/**
 * waterForceAuthority.test.ts — one owner per tick; local ABI is calculateWaterForceFallback.
 */

import { describe, expect, it } from 'vitest';
import { calculateWaterForceFallback } from '../systems/water/WatershedWasm';
import { WATER_FORCE_FIXTURES } from './__tests__/waterForceFixtures';
import {
  applyLocalAbiWaterForceIfOwner,
  localAbiWaterImpulse,
  RAFT_WATER_FORCE_IMPULSE_SCALE,
  resolveRaftWaterForceOwner,
  shouldApplyLocalAbiWaterForce,
  shouldSkipMainThreadVehicleForce,
  type RaftWaterForceOwner,
} from './waterForceAuthority';

describe('resolveRaftWaterForceOwner', () => {
  const cases: Array<{
    workerPhysicsReady: boolean;
    waterForceSystemActive: boolean;
    expected: RaftWaterForceOwner;
  }> = [
    { workerPhysicsReady: true, waterForceSystemActive: true, expected: 'worker' },
    { workerPhysicsReady: true, waterForceSystemActive: false, expected: 'worker' },
    { workerPhysicsReady: false, waterForceSystemActive: true, expected: 'main-thread-abi' },
    { workerPhysicsReady: false, waterForceSystemActive: false, expected: 'local-abi' },
  ];

  cases.forEach(({ workerPhysicsReady, waterForceSystemActive, expected }) => {
    it(`worker=${workerPhysicsReady} wfs=${waterForceSystemActive} → ${expected}`, () => {
      const owner = resolveRaftWaterForceOwner({
        workerPhysicsReady,
        waterForceSystemActive,
      });
      expect(owner).toBe(expected);
      const owners = [owner];
      expect(new Set(owners).size).toBe(1);
    });
  });

  it('never selects two owners when worker and WaterForceSystem are both live', () => {
    const owner = resolveRaftWaterForceOwner({
      workerPhysicsReady: true,
      waterForceSystemActive: true,
    });
    expect(owner).toBe('worker');
    expect(shouldApplyLocalAbiWaterForce(owner)).toBe(false);
  });

  it('WaterForceSystem skips the vehicle body when the worker is active', () => {
    expect(shouldSkipMainThreadVehicleForce(true, true)).toBe(true);
    expect(shouldSkipMainThreadVehicleForce(true, false)).toBe(false);
    expect(shouldSkipMainThreadVehicleForce(false, true)).toBe(false);
  });
});

describe('applyLocalAbiWaterForceIfOwner', () => {
  const fixture = WATER_FORCE_FIXTURES[0];
  const impulses: Array<{ x: number; y: number; z: number }> = [];
  const body = {
    translation: () => fixture.sample.position,
    linvel: () => fixture.sample.velocity,
    applyImpulse: (impulse: { x: number; y: number; z: number }) => {
      impulses.push(impulse);
    },
  };
  const delta = 1 / 60;

  it('does not apply impulse when the worker owns the tick', () => {
    impulses.length = 0;
    const result = applyLocalAbiWaterForceIfOwner(
      'worker',
      body,
      fixture.config,
      delta,
      fixture.sample.flowDirection,
    );
    expect(result).toBeNull();
    expect(impulses).toHaveLength(0);
  });

  it('does not apply impulse when WaterForceSystem owns the tick', () => {
    impulses.length = 0;
    const result = applyLocalAbiWaterForceIfOwner(
      'main-thread-abi',
      body,
      fixture.config,
      delta,
      fixture.sample.flowDirection,
    );
    expect(result).toBeNull();
    expect(impulses).toHaveLength(0);
  });

  it('applies calculateWaterForceFallback (not WaterForces.ts) when local ABI owns the tick', () => {
    impulses.length = 0;
    const expectedForce = calculateWaterForceFallback(fixture.sample, fixture.config);
    const result = applyLocalAbiWaterForceIfOwner(
      'local-abi',
      body,
      fixture.config,
      delta,
      fixture.sample.flowDirection,
    );
    expect(result).not.toBeNull();
    expect(result!.forceX).toBeCloseTo(expectedForce.forceX, 4);
    expect(result!.forceY).toBeCloseTo(expectedForce.forceY, 4);
    expect(result!.forceZ).toBeCloseTo(expectedForce.forceZ, 4);
    expect(impulses).toHaveLength(1);
    expect(impulses[0]).toEqual(localAbiWaterImpulse(expectedForce, delta));
    expect(RAFT_WATER_FORCE_IMPULSE_SCALE).toBe(0.001);
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

  it('local ABI applies the +X sample when it owns the tick', () => {
    const impulses: Array<{ x: number; y: number; z: number }> = [];
    const body = {
      translation: () => plusXSample.position,
      linvel: () => plusXSample.velocity,
      applyImpulse: (impulse: { x: number; y: number; z: number }) => {
        impulses.push(impulse);
      },
    };
    const result = applyLocalAbiWaterForceIfOwner(
      'local-abi',
      body,
      fixture.config,
      1 / 60,
      plusXSample.flowDirection,
    );
    expect(result).not.toBeNull();
    expect(result!.forceX).toBeGreaterThan(0);
    expect(impulses).toHaveLength(1);
    expect(impulses[0].x).toBeGreaterThan(0);
  });
});
