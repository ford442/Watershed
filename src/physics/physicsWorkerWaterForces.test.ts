import {
  computePhysicsWorkerWaterForces,
  packRaftWaterSample,
  PHYSICS_WORKER_IMPULSE_SCALE,
  readWaterForceDiagnostics,
} from './physicsWorkerWaterForces';
import { calculateWaterForceFallback } from '../systems/WatershedWasm';
import type { WorkerRaftState } from './rapierWorkerProtocol';

const SAMPLE_STATE: WorkerRaftState = {
  position: [0, 0.45, -10],
  rotation: [0, 0, 0, 1],
  velocity: [0.2, 0, -1.4],
  angularVelocity: [0, 0, 0],
};

describe('physicsWorkerWaterForces', () => {
  it('packs the ADR 8-float input stride', () => {
    const input = new Float32Array(8);
    packRaftWaterSample(SAMPLE_STATE, 0, -1, input);
    expect(input[0]).toBe(0);
    expect(input[1]).toBeCloseTo(0.45, 5);
    expect(input[2]).toBe(-10);
    expect(input[3]).toBeCloseTo(0.2, 5);
    expect(input[4]).toBe(0);
    expect(input[5]).toBeCloseTo(-1.4, 5);
    expect(input[6]).toBe(0);
    expect(input[7]).toBe(-1);
  });

  it('falls back to TypeScript water-force math when WASM is unavailable', () => {
    const input = new Float32Array(8);
    const output = new Float32Array(8);
    const batch = {
      inputPtr: 0,
      outputPtr: 0,
      input,
      output,
    };

    const diagnostics = computePhysicsWorkerWaterForces(
      null,
      batch,
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
    // Same force payload; `computeMicros` is wall-clock, so compare without it.
    const { computeMicros, ...payload } = diagnostics;
    expect(readWaterForceDiagnostics(output, 'fallback')).toEqual(payload);
    expect(computeMicros).toBeGreaterThanOrEqual(0);
  });

  it('returns disabled diagnostics when worker water forces are turned off', () => {
    const diagnostics = computePhysicsWorkerWaterForces(
      null,
      {
        inputPtr: 0,
        outputPtr: 0,
        input: new Float32Array(8),
        output: new Float32Array(8),
      },
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
