/**
 * raftCameraSync.ts — the third-person camera onto the raft (#577 A.1).
 *
 * The raft's frame used to end its physics stage by moving the camera (the
 * follow lerp behind the hull, the speed FOV). The physics is a SimCore step
 * now and can run 0..N times in a render frame, so the camera is the host's:
 * `useRaftControls` calls this once per frame, after SimCore. Gameplay reads
 * the camera's position (the treadmill, the segment under it), so a headless
 * raft run calls it too, on a plain three camera.
 */
import * as THREE from 'three';
import { CAMERA } from './constants';
import { raftTargetFov, type ComfortEffective } from '../../systems/settings/comfort';
import type { RapierBody } from '../../physics/rapierTypes';

/** What the follow carries between frames. */
export interface RaftCameraState {
  fov: number;
}

export function createRaftCameraState(): RaftCameraState {
  return { fov: 75 };
}

const target = new THREE.Vector3();

/** Follow the body; ease the FOV toward the speed's (comfort-scaled). */
export function syncRaftCamera(
  camera: THREE.Camera,
  body: RapierBody,
  state: RaftCameraState,
  comfort: Readonly<ComfortEffective>,
): void {
  const pos = body.translation();
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const angVel = body.angvel();
  const leanOffset = -angVel.y * CAMERA.LEAN_FACTOR;

  target.set(
    pos.x - vel.x * CAMERA.VELOCITY_LAG + leanOffset,
    pos.y + CAMERA.BASE_OFFSET_Y,
    pos.z + CAMERA.BASE_OFFSET_Z - vel.z * CAMERA.VELOCITY_LAG,
  );
  camera.position.lerp(target, CAMERA.LERP_SPEED);
  camera.lookAt(pos.x, pos.y, pos.z);

  // Base FOV and kick strength are the player's comfort settings (#486 D); the
  // authored headroom (FOV_MAX − FOV_BASE) still caps the kick.
  const targetFov = raftTargetFov(
    speed,
    CAMERA.FOV_SPEED_REFERENCE,
    CAMERA.FOV_SPEED_SCALE,
    CAMERA.FOV_MAX - CAMERA.FOV_BASE,
    comfort,
  );
  state.fov += (targetFov - state.fov) * CAMERA.FOV_LERP;
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = state.fov;
    camera.updateProjectionMatrix();
  }
}
