import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useState } from 'react';
import { updateRunnerPhysics, type RunnerPhysicsStepArgs } from './RunnerPhysicsStep';
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
  // One argument object for the step, rewritten each frame (a literal per
  // frame was the step's caller's garbage, #521 D).
  const [stepArgs] = useState(() => ({} as RunnerPhysicsStepArgs));

  useFrame((_state, delta) => {
    if (!bodyRef.current) return;
    stepArgs.delta = delta;
    stepArgs.world = world;
    stepArgs.body = bodyRef.current;
    stepArgs.rapier = rapier;
    // The runner is first-person: R3F's default camera is a PerspectiveCamera.
    stepArgs.camera = camera as THREE.PerspectiveCamera;
    stepArgs.controls = controls;
    stepArgs.vehicleState = vehicleState;
    stepArgs.shelfLaunchFiredRef = shelfLaunchFiredRef;
    stepArgs.shelfTriggerRef = shelfTriggerRef;
    updateRunnerPhysics(stepArgs);
  });
}
