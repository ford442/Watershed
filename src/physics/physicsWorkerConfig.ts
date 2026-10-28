import { WATER_PHYSICS } from '../constants/waterPhysics';
import type { PhysicsWorkerTickParams } from './physicsWorkerRegistry';
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
    simFlow: params.simFlow ?? false,
  };
}
