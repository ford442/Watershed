import {
  diagnosticsFromHullResult,
  hullSampleFromState,
  PHYSICS_WORKER_IMPULSE_SCALE,
} from './physicsWorkerWaterForces';
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
});

describe('physics worker impulse scale', () => {
  it('matches the main-thread WaterForceSystem scale', () => {
    expect(PHYSICS_WORKER_IMPULSE_SCALE).toBe(0.001);
  });
});
