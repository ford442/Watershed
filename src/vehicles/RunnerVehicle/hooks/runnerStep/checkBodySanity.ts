/**
 * Stage 1 — checkBodySanity (#559 C, from `RunnerPhysicsStep.ts`): read body,
 * clock and camera; hold (and maybe wipe out) a body that is not finite or is
 * out of its segment's envelope.
 */
import { PLAYER_SPAWN } from '../../../../constants/game';
import { bodyUserData as userDataOf } from '../../../../physics/rapierTypes';
import {
  getEffectivePositionBoundsInto,
  resolveActiveEnvelopeInto,
  triggerOutOfBoundsWipeout,
  isFiniteVec3,
  isCameraWarm,
  resetCameraToSpawn,
  isPositionSane,
} from '../runnerAirControl';
import { resetImpulseTally } from '../runnerStepScratch';
import { holdAtSpawn, type StepFrame } from './stepFrame';
import { publishSnapshotPose } from './writeTelemetry';

/** Read body, clock and camera. False when the body is not finite or out of bounds (held, maybe wiped out). */
export function checkBodySanity(f: StepFrame): boolean {
  const { args, s } = f;
  const { body, camera, vehicleState, rapier } = args;
  const { slopeState, debugState } = vehicleState;
  const dt = args.delta;
  f.dt = dt;
  f.noPointerLock = s.noPointerLock;
  s.body = body;
  // F-8: defer gameplay impulses until body, camera, terrain, and velocity are sane.
  s.physicsWarm = false;
  s.followCamera = false;
  resetImpulseTally(s);

  const pos = body.translation();
  const vel = body.linvel();
  f.pos = pos;
  f.vel = vel;
  // Debug overlay clock: sim ms, so the contact / impulse windows age with the sim.
  if (Number.isFinite(dt) && dt > 0) debugState.current.simMs += dt * 1000;
  vehicleState.vehicle.advanceClockBy(f);
  f.now = debugState.current.simMs;

  f.dtOk = Number.isFinite(dt) && dt > 0 && dt < 0.5;
  f.posOk = isFiniteVec3(pos);
  const velOk = isFiniteVec3(vel);
  f.cameraWarm = isCameraWarm(camera);
  if (!f.cameraWarm) {
    resetCameraToSpawn(camera, f.noPointerLock);
    f.cameraWarm = isCameraWarm(camera);
  }
  if (!Number.isFinite(slopeState.current.currentMultiplier)) slopeState.current.currentMultiplier = 1.0;
  if (!Number.isFinite(slopeState.current.targetMultiplier)) slopeState.current.targetMultiplier = 1.0;

  // Vertical bounds are relative to the segment under the player — the track
  // descends hundreds of metres, so an absolute clip is wrong (segmentFrames.ts).
  const envelope = f.posOk ? resolveActiveEnvelopeInto(s.envelope, pos) : null;
  const bounds = getEffectivePositionBoundsInto(s.bounds, envelope);
  f.userData = userDataOf(body);

  if (!f.posOk) {
    publishSnapshotPose(f, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z);
    return false;
  }

  const speedMag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  const velSane = velOk && Number.isFinite(speedMag) && speedMag <= bounds.speedMax;
  const posSane = isPositionSane(pos, bounds);
  if (!posSane || !velSane) {
    // A finite, in-xz body outside the vertical envelope of a live run is a
    // fall (off the waterfall, into the vortex eye, through the open floor):
    // wipe out and park on the checkpoint, not the world-origin spawn.
    const verticalOob =
      velSane &&
      f.userData.__terrainReady === true &&
      isPositionSane(pos, { ...bounds, yMin: -Infinity, yMax: Infinity });
    if (verticalOob && envelope) {
      triggerOutOfBoundsWipeout(args.game.state(), envelope);
      const game = args.game.state();
      const target = game.spawnPoints[envelope.respawnAt ?? game.respawnSegmentIndex];
      if (target) f.userData.__holdTarget = { x: target.x, y: target.y, z: target.z };
    }
    holdAtSpawn(f, envelope);
    f.userData.__terrainReady = false;
    try {
      body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      f.userData.__bootBodyType = 'kinematic';
    } catch (_e) { /* body type unavailable */ }
    const [sx, sy, sz] = PLAYER_SPAWN.position;
    publishSnapshotPose(f, sx, sy, sz, 0, 0, 0);
    return false;
  }

  f.sane = f.dtOk && velOk && velSane && posSane && f.cameraWarm;
  return true;
}
