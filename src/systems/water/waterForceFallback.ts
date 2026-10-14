/**
 * waterForceFallback.ts — the pure-TypeScript twin of emscripten/forces.cpp.
 *
 * What runs when watershed_native is unavailable (`?simWorker=0` with no WASM,
 * a failed or mismatched load, tests). Held to the C++ by the parity tests in
 * src/physics/__tests__/waterForceParity.test.ts — change one, change the other.
 */

import type {
  NativeWaterForceConfig,
  NativeWaterForceResult,
  NativeWaterForceSample,
} from './wasmAbi';

/**
 * Pure-TypeScript buoyancy calculation — matches C++ implementation.
 * Useful in unit tests or when WASM is unavailable.
 */
export function buoyancyFallback(
  submergedVolume: number,
  waterDensity = 1000,
  gravity = 9.80665,
): number {
  if (submergedVolume <= 0) return 0;
  return waterDensity * submergedVolume * gravity;
}

/**
 * Pure-TypeScript drag force — matches C++ implementation.
 */
export function dragForceFallback(
  vx: number, vy: number, vz: number,
  cd: number, area: number, density: number,
): number {
  const speedSq = vx*vx + vy*vy + vz*vz;
  if (speedSq <= 0) return 0;
  return 0.5 * density * speedSq * cd * area;
}

export function calculateBuoyancyAndDragFallback(
  raftMass: number,
  submergedVolume: number,
  waterVelocityX: number,
  waterVelocityZ: number,
): number {
  const buoyancy = buoyancyFallback(submergedVolume);
  const waterSpeedSq = waterVelocityX * waterVelocityX + waterVelocityZ * waterVelocityZ;
  const drag = 0.5 * 1000 * waterSpeedSq * 0.47 * 1.8;
  return Math.max(0, buoyancy - Math.max(0, raftMass) * 9.80665) + drag;
}

export function calculateWaterForceFallback(
  sample: NativeWaterForceSample,
  config: NativeWaterForceConfig,
): NativeWaterForceResult {
  const raftHeight = 0.35;
  const bottomY = sample.position.y - raftHeight * 0.5;
  const submergedRatio = Math.min(1, Math.max(0, (config.waterLevel - bottomY) / raftHeight));
  if (submergedRatio <= 0) {
    return {
      forceX: 0, forceY: 0, forceZ: 0,
      buoyancy: 0, drag: 0, flow: 0, turbulence: 0, submergedRatio: 0,
    };
  }

  const buoyancy = buoyancyFallback(config.raftVolume * submergedRatio);
  const forceY = Math.max(0, buoyancy - config.raftMass * 9.80665 * 0.35);
  const flowLen = Math.hypot(sample.flowDirection.x, sample.flowDirection.z) || 1;
  const flowDirX = sample.flowDirection.x / flowLen;
  const flowDirZ = sample.flowDirection.z / flowLen;
  const relX = flowDirX * config.flowSpeed - sample.velocity.x;
  const relZ = flowDirZ * config.flowSpeed - sample.velocity.z;
  const relSpeedSq = relX * relX + relZ * relZ;
  const relSpeed = Math.sqrt(relSpeedSq);
  const projectedArea =
    config.frontalArea * Math.abs(flowDirZ) +
    config.sideArea * Math.abs(flowDirX);
  const flow = relSpeedSq > 0
    ? 0.5 * 1000 * relSpeedSq * config.dragCoefficient * projectedArea * submergedRatio
    : 0;

  const speed = Math.hypot(sample.velocity.x, sample.velocity.y, sample.velocity.z);
  const dragArea = config.frontalArea + config.sideArea * 0.35;
  const drag = speed > 0
    ? 0.5 * 1000 * speed * speed * config.dragCoefficient * dragArea * submergedRatio
    : 0;

  const turbulence = Math.max(0, config.turbulenceStrength) * 1000 * submergedRatio;
  const turbX = Math.sin(config.timeSeconds * config.turbulenceFrequency + sample.position.z * 0.37);
  const turbZ = Math.cos(config.timeSeconds * config.turbulenceFrequency * 1.31 + sample.position.x * 0.29);

  return {
    forceX: (relSpeed > 0 ? (relX / relSpeed) * flow : 0) -
      (speed > 0 ? (sample.velocity.x / speed) * drag : 0) +
      turbX * turbulence,
    forceY: forceY - (speed > 0 ? (sample.velocity.y / speed) * drag * 0.2 : 0),
    forceZ: (relSpeed > 0 ? (relZ / relSpeed) * flow : 0) -
      (speed > 0 ? (sample.velocity.z / speed) * drag : 0) +
      turbZ * turbulence,
    buoyancy,
    drag,
    flow,
    turbulence,
    submergedRatio,
  };
}
