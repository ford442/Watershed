/**
 * runnerCameraSync.ts — the first-person camera onto the runner's body (#556 A).
 *
 * The physics step used to end by moving the camera (follow lerp, the
 * top-down harness view, the speed FOV kick — that last one is
 * presentation only and lives in runnerFovKick.ts). The camera is presentation, and
 * a SimCore step can run 0..N times in a render frame, so the follow is the
 * R3F host's: RunnerVehicle calls this once per frame, at the frame position
 * the step used to have. It follows only while the last step ran to its camera
 * stage (`followCamera`), as the inline follow did.
 *
 * Gameplay still reads the camera's orientation (camera-relative movement)
 * and its position (segment / treadmill sampling), so a headless run calls
 * this too, on a plain three camera, after each step.
 */
import type * as THREE from 'three';
import type { RapierBody } from '../../physics/rapierTypes';
import type { RunnerPhysicsState } from './hooks/runnerPhysicsState';

/** Eye height over the body's origin (m). */
const EYE_HEIGHT = 1.65;
/** The top-down harness view's height over the body (m). */
const TOP_DOWN_HEIGHT = 40;
/** Per-frame follow fraction (frame-rate dependent, as it always was). */
const FOLLOW_LERP = 0.12;

/**
 * The camera onto the body (position; the top-down view's look-at), when the
 * last step allows it. Field writes, not `Vector3.set(…)` / `.lerp(…)` with a
 * computed argument: called from a frame callback rather than inlined into the
 * step, those calls boxed the computed doubles (`runnerStep.alloc.perf.test.ts`).
 * The arithmetic is `Vector3.lerp`'s, operation for operation.
 */
export function syncRunnerCamera(camera: THREE.PerspectiveCamera, body: RapierBody, state: RunnerPhysicsState): void {
  if (!state.stepScratch.followCamera) return;
  const pos = body.translation();
  const px = pos.x;
  const py = pos.y;
  const pz = pos.z;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;

  const cam = camera.position;
  if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.z)) {
    cam.x = px;
    cam.y = py + EYE_HEIGHT;
    cam.z = pz;
  }

  if (state.stepScratch.noPointerLock) {
    cam.x = px;
    cam.y = py + TOP_DOWN_HEIGHT;
    cam.z = pz;
    camera.lookAt(px, py, pz);
  } else {
    cam.x += (px - cam.x) * FOLLOW_LERP;
    cam.y += (py + EYE_HEIGHT - cam.y) * FOLLOW_LERP;
    cam.z += (pz - cam.z) * FOLLOW_LERP;
  }

  if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.z)) {
    cam.x = px;
    cam.y = py + EYE_HEIGHT;
    cam.z = pz;
  }
}
