import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRaftPhysicsRuntime, type RaftPhysicsRuntimeDeps } from './raftPhysicsRuntime';
import { WATER_PHYSICS } from '../constants';
import { stagedWaterLevel } from '../../../systems/water/sampleSWEFlow';
import {
  publishVehicleWaterLevel,
  resetVehicleWaterLevelForTests,
} from '../../../systems/water/vehicleWaterDatum';
import type { ParticlePool } from '../../../components/particlePool';

function makeDeps(sampleWaterLevel?: () => number | null): RaftPhysicsRuntimeDeps {
  return {
    buoyancyState: { current: { submergedRatio: 0, buoyancyForce: 0, isFloating: false } },
    tippingState: {
      current: { rollAngle: 0, pitchAngle: 0, dangerTime: 0, isTipped: false, lastSafePosition: new THREE.Vector3() },
    },
    paddleState: { current: { leftPaddle: false, rightPaddle: false } },
    staminaState: { current: { current: 100, regenDelay: 0, isExhausted: false } },
    stunState: { current: { active: false, timer: 0 } },
    forwardBiasTimer: { current: 0 },
    foamParticles: { spawn: () => {} } as unknown as ParticlePool,
    shedParticles: { spawn: () => {} } as unknown as ParticlePool,
    camera: new THREE.PerspectiveCamera(),
    controls: { getControls: () => ({}) as never },
    stepWorkerProxy: () => {},
    currentFov: { current: 75 },
    ...(sampleWaterLevel ? { sampleWaterLevel } : {}),
  };
}

afterEach(() => resetVehicleWaterLevelForTests());

describe('raftPhysicsRuntime — floating reads the staged datum', () => {
  // A raft deep in a map: the sheet is hundreds of metres below the old
  // absolute WATER_LEVEL, which reported every hull here as fully submerged.
  const sheet = -212.4;
  const halfHull = WATER_PHYSICS.RAFT_HEIGHT / 2;
  // Riding the still sheet: the hull straddles it, a fraction under.
  const raftY = sheet + halfHull * 0.4;

  it('is floating on the still sheet', () => {
    const level = { current: stagedWaterLevel(sheet, { surfaceOffset: 0 }) };
    const deps = makeDeps(() => level.current);
    const runtime = createRaftPhysicsRuntime(deps);
    expect(runtime.updateBuoyancy(raftY)).toBeGreaterThan(0.1);
    expect(deps.buoyancyState.current.isFloating).toBe(true);
  });

  it('a hydroEvent lowering the stage 0.5 m un-floats the raft the same frame the hull sample does', () => {
    // The stub bridge: one staged level, the number the hull force reads.
    const level = { current: stagedWaterLevel(sheet, { surfaceOffset: 0 }) };
    const deps = makeDeps(() => level.current);
    const runtime = createRaftPhysicsRuntime(deps);
    runtime.updateBuoyancy(raftY);
    expect(deps.buoyancyState.current.isFloating).toBe(true);

    // The stage drops: the hull bottom is now above the surface the force reads.
    level.current = stagedWaterLevel(sheet, { surfaceOffset: -0.5 });
    const hullSampleSubmerged = raftY - halfHull < level.current;
    runtime.updateBuoyancy(raftY);
    expect(hullSampleSubmerged).toBe(false);
    expect(deps.buoyancyState.current.isFloating).toBe(hullSampleSubmerged);
    expect(deps.buoyancyState.current.submergedRatio).toBe(0);
  });

  it('defaults to the datum the force bridge publishes', () => {
    const deps = makeDeps();
    const runtime = createRaftPhysicsRuntime(deps);
    publishVehicleWaterLevel(sheet);
    runtime.updateBuoyancy(raftY);
    expect(deps.buoyancyState.current.isFloating).toBe(true);

    publishVehicleWaterLevel(sheet - 0.5);
    runtime.updateBuoyancy(raftY);
    expect(deps.buoyancyState.current.isFloating).toBe(false);
  });

  it('no water under the raft is not floating (off the sheet, or before the first force frame)', () => {
    const deps = makeDeps();
    const runtime = createRaftPhysicsRuntime(deps);
    expect(runtime.calculateSubmergedRatio(raftY)).toBe(0);
    publishVehicleWaterLevel(null);
    runtime.updateBuoyancy(raftY);
    expect(deps.buoyancyState.current.isFloating).toBe(false);
  });
});
