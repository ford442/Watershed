/**
 * Shared water-force fixtures.
 *
 * These sample/config pairs are the contract between the C++ implementation
 * (emscripten/forces.cpp) and its TypeScript mirror (`calculateWaterForceFallback`
 * in WatershedWasm.ts). waterForceParity.test.ts pins the TS results to the
 * committed expectations below, and — when run with WATERSHED_WASM_INTEGRATION=1
 * — additionally asserts the native module agrees within a float epsilon.
 *
 * Cases deliberately cover: fully submerged, straddling the waterline, airborne
 * (no submersion), diagonal flow, and a turbulence-active tick.
 */

import type {
  NativeWaterForceConfig,
  NativeWaterForceSample,
} from '../../systems/water/WatershedWasm';

export interface WaterForceFixture {
  name: string;
  sample: NativeWaterForceSample;
  config: NativeWaterForceConfig;
}

const RAFT_CONFIG: NativeWaterForceConfig = {
  flowSpeed: 4.5,
  waterLevel: 0.5,
  raftMass: 150,
  raftVolume: 1.2,
  dragCoefficient: 0.47,
  frontalArea: 1.05,
  sideArea: 0.7,
  timeSeconds: 12.5,
  turbulenceStrength: 0,
  turbulenceFrequency: 2.4,
};

export const WATER_FORCE_FIXTURES: WaterForceFixture[] = [
  {
    name: 'raft fully submerged, straight downstream flow',
    sample: {
      position: { x: 0, y: 0.2, z: -10 },
      velocity: { x: 0.2, y: 0, z: -1.4 },
      flowDirection: { x: 0, z: -1 },
    },
    config: RAFT_CONFIG,
  },
  {
    name: 'raft straddling the waterline',
    sample: {
      position: { x: 1.5, y: 0.55, z: -24 },
      velocity: { x: -0.4, y: 0.6, z: -3.2 },
      flowDirection: { x: 0, z: -1 },
    },
    config: RAFT_CONFIG,
  },
  {
    name: 'raft airborne — no submersion, no force',
    sample: {
      position: { x: 0, y: 3.4, z: -40 },
      velocity: { x: 0, y: -2.2, z: -6.0 },
      flowDirection: { x: 0, z: -1 },
    },
    config: RAFT_CONFIG,
  },
  {
    name: 'diagonal flow around a meander',
    sample: {
      position: { x: -2.1, y: 0.3, z: -55 },
      velocity: { x: 1.1, y: -0.2, z: -5.4 },
      flowDirection: { x: 0.6, z: -0.8 },
    },
    config: { ...RAFT_CONFIG, flowSpeed: 7.2 },
  },
  {
    name: 'turbulence active (rapids tick)',
    sample: {
      position: { x: 0.8, y: 0.35, z: -88 },
      velocity: { x: -0.9, y: 0.1, z: -7.8 },
      flowDirection: { x: 0, z: -1 },
    },
    config: { ...RAFT_CONFIG, turbulenceStrength: 0.12, timeSeconds: 31.75 },
  },
  {
    name: 'runner body (light, high drag) in slow water',
    sample: {
      position: { x: 0, y: 0.4, z: -120 },
      velocity: { x: 0.05, y: -0.3, z: -2.1 },
      flowDirection: { x: 0, z: -1 },
    },
    config: {
      flowSpeed: 1.2,
      waterLevel: 0.5,
      raftMass: 82,
      raftVolume: 0.08,
      dragCoefficient: 1.0,
      frontalArea: 0.45,
      sideArea: 0.35,
      timeSeconds: 4.25,
      turbulenceStrength: 0.075,
      turbulenceFrequency: 2.4,
    },
  },
];
