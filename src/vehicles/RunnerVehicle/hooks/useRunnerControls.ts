import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { updateRunnerPhysics } from './RunnerPhysicsStep';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RunnerPhysicsState } from './useRunnerPhysics';
import type { ShelfTrigger } from '../../utils/shelfLaunch';

export function useRunnerControls({
  bodyRef, camera, controls, vehicleState,
  shelfLaunchFiredRef, shelfTriggerRef
}: {
  bodyRef: { current: RapierRigidBody | null };
  camera: THREE.Camera;
  controls: { getControls: () => PlayerControls };
  vehicleState: RunnerPhysicsState;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}) {
  const { world, rapier } = useRapier();

  useFrame((_state, delta) => {
    if (!bodyRef.current) return;
    updateRunnerPhysics({
        delta, world, body: bodyRef.current, rapier,
        // The runner is first-person: R3F's default camera is a PerspectiveCamera.
        camera: camera as THREE.PerspectiveCamera,
        controls, vehicleState,
        shelfLaunchFiredRef, shelfTriggerRef
    });
  });
}
