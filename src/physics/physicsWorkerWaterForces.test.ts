import {
  computePhysicsWorkerWaterForces,
  diagnosticsFromHullResult,
  hullSampleFromState,
  PHYSICS_WORKER_IMPULSE_SCALE,
} from './physicsWorkerWaterForces';
import { calculateWaterForceFallback } from '../systems/water/WatershedWasm';
import { FORCE_RESULT_STRIDE, FORCE_SAMPLE_STRIDE } from '../sim/simForces';
import type { WorkerRaftState } from './rapierWorkerProtocol';

const SAMPLE_STATE: WorkerRaftState = {
  position: [0, 0.45, -10],
  rotation: [0, 0, 0, 1],
  velocity: [0.2, 0, -1.4],
  angularVelocity: [0, 0, 0],
};

describe('physicsWorkerWaterForces', () => {
  it('packs the hull sample for the sim worker: state, authored flow cap and config', () => {
    const sample = hullSampleFromState(SAMPLE_STATE, {
      enabled: true,
      flowSpeed: 4.5,
      waterLevel: 0.5,
      raftMass: 150,
      raftVolume: 1.2,
      dragCoefficient: 0.47,
      frontalArea: 1.05,
      sideArea: 0.7,
      timeSeconds: 12.5,
      turbulenceStrength: 0.08,
      turbulenceFrequency: 2.4,
      flowDirX: 0,
      flowDirZ: -1,
      simFlow: true,
    });
    expect(sample).toHaveLength(FORCE_SAMPLE_STRIDE);
    // Float64: the position reaches sampleSWEFlow with the bits Rapier gave.
    expect(Array.from(sample)).toEqual([0, 0.45, -10, 0.2, 0, -1.4, 4.5, 1, 0.5, 150, 1.2, 0.47, 1.05, 0.7, 12.5, 0.08, 2.4]);
  });

  it('reads a sim-worker result as wasm diagnostics with the sampled flow', () => {
    const result = new Float64Array(FORCE_RESULT_STRIDE);
    result.set([1, 2, 3, 4, 5, 6, 7, 0.5, 0.6, -0.8, 2.25, 0.1, 1.3, 3]);
    const diagnostics = diagnosticsFromHullResult(result, 42);
    expect(diagnostics).toMatchObject({ source: 'wasm', computeMicros: 42, forceX: 1, forceZ: 3, submergedRatio: 0.5 });
    expect(diagnostics.sampledFlow).toEqual({
      dirX: 0.6, dirZ: -0.8, speed: 2.25, surfaceOffset: 0.1, depth: 1.3, wet: true, source: 'swe',
    });
  });

  it('uses the TypeScript water-force math when the sim worker has no force for the tick', () => {
    const diagnostics = computePhysicsWorkerWaterForces(
      SAMPLE_STATE,
      {
        enabled: true,
        flowSpeed: 4.5,
        waterLevel: 0.5,
        raftMass: 150,
        raftVolume: 1.2,
        dragCoefficient: 0.47,
        frontalArea: 1.05,
        sideArea: 0.7,
        timeSeconds: 12.5,
        turbulenceStrength: 0.08,
        turbulenceFrequency: 2.4,
        flowDirX: 0,
        flowDirZ: -1,
      },
    );

    const expected = calculateWaterForceFallback(
      {
        position: { x: 0, y: 0.45, z: -10 },
        velocity: { x: 0.2, y: 0, z: -1.4 },
        flowDirection: { x: 0, z: -1 },
      },
      {
        flowSpeed: 4.5,
        waterLevel: 0.5,
        raftMass: 150,
        raftVolume: 1.2,
        dragCoefficient: 0.47,
        frontalArea: 1.05,
        sideArea: 0.7,
        timeSeconds: 12.5,
        turbulenceStrength: 0.08,
        turbulenceFrequency: 2.4,
      },
    );

    expect(diagnostics.source).toBe('fallback');
    expect(diagnostics.forceX).toBeCloseTo(expected.forceX, 3);
    expect(diagnostics.forceZ).toBeCloseTo(expected.forceZ, 3);
    expect(diagnostics.submergedRatio).toBeCloseTo(expected.submergedRatio, 5);
    expect(diagnostics.buoyancy).toBe(expected.buoyancy);
    expect(diagnostics.computeMicros).toBeGreaterThanOrEqual(0);
  });

  it('returns disabled diagnostics when worker water forces are turned off', () => {
    const diagnostics = computePhysicsWorkerWaterForces(
      SAMPLE_STATE,
      {
        enabled: false,
        flowSpeed: 1,
        waterLevel: 0.5,
        raftMass: 150,
        raftVolume: 1.2,
        dragCoefficient: 0.47,
        frontalArea: 1,
        sideArea: 1,
        timeSeconds: 0,
        turbulenceStrength: 0,
        turbulenceFrequency: 1,
        flowDirX: 0,
        flowDirZ: -1,
      },
    );

    expect(diagnostics.source).toBe('disabled');
    expect(diagnostics.submergedRatio).toBe(0);
  });
});

describe('physics worker impulse scale', () => {
  it('matches the main-thread WaterForceSystem scale', () => {
    expect(PHYSICS_WORKER_IMPULSE_SCALE).toBe(0.001);
  });
});
