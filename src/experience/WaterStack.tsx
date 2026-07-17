import type { RefObject } from 'react';
import { WATER_LEVEL } from '../constants/game';
import WaterReflection from '../components/WaterReflection';
import WaterInteraction from '../components/WaterInteraction';
import { SplashSystem } from '../systems/SplashSystem';
import WaterForceSystem from '../systems/WaterForceSystem';
import type { VehicleRigidBodyRef, VehicleType } from './types';

interface WaterReflectionLayerProps {
  enabled: boolean;
  enableReflections: boolean;
}

/** Planar water reflection pass — mounted outside the Rapier physics world. */
export function WaterReflectionLayer({ enabled, enableReflections }: WaterReflectionLayerProps) {
  if (!enabled || !enableReflections) return null;

  return <WaterReflection waterLevel={WATER_LEVEL} resolution={1024} updateInterval={2} />;
}

interface WaterPhysicsEffectsProps {
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  vehicleType: VehicleType;
  enabled: boolean;
  flowSpeed: number;
  wasmWaterTest?: boolean;
}

/** Splash particles and player–water interaction — mounted inside Physics. */
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
      />
      <WaterInteraction
        target={vehicleRef}
        isRaft={vehicleType === 'raft'}
        waterLevel={WATER_LEVEL}
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
