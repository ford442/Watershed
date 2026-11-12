/**
 * runnerFovKick.ts — the runner's speed FOV kick (#486 D comfort settings).
 *
 * Presentation only: RunnerVehicle runs it per frame after the camera follow
 * (it moved out of the physics step with the follow, #556 A). Reads the
 * player's comfort settings, so it is not sim code.
 */
import type * as THREE from 'three';
import { getComfort } from '../../systems/settings/comfortRuntime';
import { runnerTargetFov } from '../../systems/settings/comfort';

type Vec3 = { x: number; y: number; z: number };

/** Speed-based FOV kick with waterfall segment punch. */
export function updateRunnerFovKick({
  camera,
  vel,
  dt,
  fovState,
  currentSegmentIndex,
}: {
  camera: THREE.PerspectiveCamera;
  vel: Vec3;
  dt: number;
  /**
   * The smoothed FOV. Its own shape on purpose: a `{ current }` ref shares one
   * hidden class with every ref in the app, so a double stored in it is boxed
   * (a fresh heap number every step).
   */
  fovState: { fov: number };
  currentSegmentIndex: number;
}) {
  const isWaterfallSeg = currentSegmentIndex === 14 || currentSegmentIndex === 29;
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  // Base FOV and the kick's strength are the player's comfort settings (#486 D).
  const targetFov = runnerTargetFov(hSpeed, isWaterfallSeg, getComfort());
  fovState.fov += (targetFov - fovState.fov) * (1 - Math.exp(-dt * 5));
  if (Math.abs(camera.fov - fovState.fov) > 0.05) {
    camera.fov = fovState.fov;
    camera.updateProjectionMatrix();
  }
}

