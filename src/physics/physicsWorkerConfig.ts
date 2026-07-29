import { WATER_LEVEL } from '../constants/game';
import { WATER_PHYSICS } from '../vehicles/RaftVehicle/constants';
import type { PhysicsWorkerTickParams } from './physicsWorkerRegistry';
import type { PhysicsWorkerWaterTickConfig } from './physicsWorkerWaterForces';
import type { WaterForceTickConfig } from './rapierWorkerProtocol';

export function buildRaftWorkerWaterForceConfig(
  params: PhysicsWorkerTickParams,
  timeSeconds: number,
  enabled = true,
): WaterForceTickConfig {
  return {
    enabled,
    flowSpeed: params.flowSpeed,
    waterLevel: params.waterLevel,
    raftMass: WATER_PHYSICS.RAFT_MASS,
    raftVolume: WATER_PHYSICS.RAFT_VOLUME,
    dragCoefficient: WATER_PHYSICS.DRAG_COEFFICIENT,
    frontalArea: WATER_PHYSICS.RAFT_WIDTH * WATER_PHYSICS.RAFT_HEIGHT,
    sideArea: WATER_PHYSICS.RAFT_LENGTH * WATER_PHYSICS.RAFT_HEIGHT,
    timeSeconds,
    turbulenceStrength: params.turbulenceStrength,
    turbulenceFrequency: params.turbulenceFrequency,
    flowDirX: params.flowDirX,
    flowDirZ: params.flowDirZ,
  };
}

export function defaultPhysicsWorkerTickParams(): PhysicsWorkerTickParams {
  return {
    flowSpeed: 1.2,
    waterLevel: WATER_LEVEL,
    turbulenceStrength: 0.1,
    turbulenceFrequency: 2.4,
    flowDirX: 0,
    flowDirZ: -1,
  };
}

export function toPhysicsWorkerWaterTickConfig(
  config: WaterForceTickConfig,
): PhysicsWorkerWaterTickConfig {
  return { ...config };
}
