/**
 * useVehicleTunerSim — the host of SimCore's `vehicle-tuner` (#577 A.2).
 *
 * TrackManager used to mount `<VehicleTuner>`, a component that stepped the
 * tuner in a `useFrame`. The step is a SimCore system now
 * (systems/vehicle/vehicleTunerSimSystem.ts); this hook registers it over the
 * <Physics> world and the vehicle's body for TrackManager's mount, and plays
 * the tuner's `vehicle-surge` cues (the step calls no audio).
 */
import { useEffect, type RefObject } from 'react';
import { useRapier } from '@react-three/rapier';
import { simCore } from '../sim/core/SimCore';
import { createVehicleTunerSimSystem, type TunedBody } from '../systems/vehicle/vehicleTunerSimSystem';
import { gameEvents } from '../systems/events/GameEvents';
import { getAudioManager } from '../systems/audio/AudioSystem';
import type { VehicleRigidBodyRef } from '../experience/types';
import type { RapierNamespace, RapierWorldQueries } from '../physics/rapierTypes';

export function useVehicleTunerSim(targetRef: RefObject<VehicleRigidBodyRef | null> | undefined): void {
  const { world, rapier } = useRapier();
  useEffect(() => {
    if (!targetRef) return undefined;
    const off = simCore.register(
      createVehicleTunerSimSystem({
        world: world as unknown as RapierWorldQueries,
        rapier: rapier as unknown as Pick<RapierNamespace, 'Ray'>,
        // The mounted vehicle is a Rapier body; the tuner reads parts VehicleRigidBodyRef leaves out.
        getBody: () => (targetRef.current as unknown as TunedBody | null) ?? null,
      }),
    );
    const offCue = gameEvents.on('vehicle-surge', ({ kind }) => {
      if (kind === 'boost') getAudioManager()?.playSound('boost', 0.9, 1.0);
      else getAudioManager()?.playSound('raft_creak', 0.4, 1.05);
    });
    return () => {
      offCue();
      off();
    };
  }, [targetRef, world, rapier]);
}
