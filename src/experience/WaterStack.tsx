import type { RefObject } from 'react';
import { WATER_LEVEL } from '../constants/game';
import WaterReflection from '../components/WaterReflection';
import { SplashSystem } from '../systems/SplashSystem';
import WaterForceSystem from '../systems/WaterForceSystem';
import { useLOD } from '../systems/LODManager';
import type { VehicleRigidBodyRef, VehicleType } from './types';

interface WaterReflectionLayerProps {
  enabled: boolean;
  enableReflections: boolean;
}

/** Planar water reflection pass — mounted outside the Rapier physics world. */
export function WaterReflectionLayer({ enabled, enableReflections }: WaterReflectionLayerProps) {
  const { config } = useLOD();

  if (!enabled || !enableReflections || !config.enableReflections) return null;

  return (
    <WaterReflection
      waterLevel={WATER_LEVEL}
      resolution={config.reflectionResolution}
      updateInterval={config.reflectionUpdateInterval}
      reflectionStrength={config.reflectionStrength}
    />
  );
}

interface WaterPhysicsEffectsProps {
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  vehicleType: VehicleType;
  enabled: boolean;
  flowSpeed: number;
  wasmWaterTest?: boolean;
}

/** Splash / mist / bow-wave water-contact VFX — mounted inside Physics. */
export function WaterPhysicsEffects({
  vehicleRef,
  vehicleType,
  enabled,
  flowSpeed,
  wasmWaterTest = false,
}: WaterPhysicsEffectsProps) {
  if (!enabled) return null;

  return (
    <>
      {!wasmWaterTest && (
        <WaterForceSystem
          vehicleRef={vehicleRef}
          vehicleType={vehicleType}
          flowSpeed={flowSpeed}
          waterLevel={WATER_LEVEL}
        />
      )}
      <SplashSystem
        playerRef={vehicleRef}
        waterLevel={WATER_LEVEL}
        waterWidth={12}
        flowSpeed={flowSpeed}
        isRaft={vehicleType === 'raft'}
        maxVelocity={15}
      />
    </>
  );
}

/**
 * Water surface adjuncts wired at scene root.
 * FlowingWater mesh lives on TrackSegment; use the named exports for correct Physics nesting.
 */
export default function WaterStack(props: WaterReflectionLayerProps & WaterPhysicsEffectsProps) {
  return (
    <>
      <WaterReflectionLayer enabled={props.enabled} enableReflections={props.enableReflections} />
      <WaterPhysicsEffects
        vehicleRef={props.vehicleRef}
        vehicleType={props.vehicleType}
        enabled={props.enabled}
        flowSpeed={props.flowSpeed}
      />
    </>
  );
}
