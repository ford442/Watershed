/**
 * Last stage — writeTelemetry (#559 C, from `RunnerPhysicsStep.ts`): the debug
 * overlay's impulse / contact windows and the physics snapshot (built only on
 * a `?debug` / `?physicsDebug` / `?screenshot` page), plus the early-out
 * paths' pose-only snapshot.
 */
import { PHYSICS } from '../../../../constants/game';
import { RUNNER_IMPULSE_TAGS } from '../runnerStepScratch';
import type { StepFrame, Vec3 } from './stepFrame';

/** Keep the newest `max` entries no older than `windowMs`, in place. */
function pruneWindow<T extends { at: number }>(list: T[], now: number, windowMs: number, max: number): void {
  let w = 0;
  for (let r = 0; r < list.length; r += 1) {
    if (now - list[r].at <= windowMs) list[w++] = list[r];
  }
  list.length = w;
  if (w > max) list.splice(0, w - max);
}

/** The debug overlay's impulse / contact windows and the physics snapshot. */
export function writeTelemetry(f: StepFrame): void {
  const { args, s, now, pos, vel, isGrounded } = f;
  const { body, vehicleState } = args;
  const debug = vehicleState.debugState.current;
  const telemetry = s.debugGlobals;

  if (telemetry) {
    for (let i = 0; i < RUNNER_IMPULSE_TAGS.length; i += 1) {
      const tag = RUNNER_IMPULSE_TAGS[i];
      if (!s.impulseUsed[tag]) continue;
      const impulse = s.impulseTotals[tag];
      const mag = Math.sqrt(impulse.x * impulse.x + impulse.y * impulse.y + impulse.z * impulse.z);
      if (mag < 0.001) continue;
      debug.recentImpulses.push({ tag, at: now, impulse: { x: impulse.x, y: impulse.y, z: impulse.z } });
    }
  }
  pruneWindow(debug.recentImpulses, now, 2000, 16);
  pruneWindow(debug.recentContacts, now, 2500, 8);
  if (!telemetry) return;

  const snapshot = vehicleState.debugSnapshotRef.current;
  setVec(snapshot.position, pos.x, pos.y, pos.z);
  setVec(snapshot.linearVelocity, vel.x, vel.y, vel.z);
  const angVel = body.angvel();
  setVec(snapshot.angularVelocity, angVel.x, angVel.y, angVel.z);
  const slope = vehicleState.slopeState.current;
  snapshot.speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  snapshot.slopeAngle = slope.currentAngle;
  snapshot.bankAngle = slope.bankAngle;
  snapshot.isGrounded = isGrounded;
  snapshot.jumpState = vehicleState.jumpState.current.state;
  snapshot.friction = debug.friction;
  snapshot.waterfallGravityMultiplier = f.gravMult;
  snapshot.effectiveG = PHYSICS.GRAVITY * f.gravMult;
  snapshot.extraGravity = PHYSICS.GRAVITY * (f.gravMult - 1);
  snapshot.currentSegmentIndex = args.game.state().currentSegmentIndex;
  const ground = s.ground;
  setVec(snapshot.groundRay.origin, ground.origin.x, ground.origin.y, ground.origin.z);
  snapshot.groundRay.hitPoint = ground.hitPoint
    ? { x: ground.hitPoint.x, y: ground.hitPoint.y, z: ground.hitPoint.z }
    : null;
  snapshot.groundRay.distance = ground.toi;
  setVec(snapshot.groundNormal, slope.lastGroundNormal.x, slope.lastGroundNormal.y, slope.lastGroundNormal.z);
  snapshot.recentImpulses = debug.recentImpulses;
  snapshot.recentContacts = debug.recentContacts;

  f.userData.physicsDebug = snapshot;
  f.args.debug.physicsDebug(snapshot);
}

function setVec(out: Vec3, x: number, y: number, z: number): void {
  out.x = x;
  out.y = y;
  out.z = z;
}

/** The early-out paths' snapshot: pose and segment only (debug pages). */
export function publishSnapshotPose(f: StepFrame, px: number, py: number, pz: number, vx: number, vy: number, vz: number): void {
  if (!f.s.debugGlobals) return;
  const snapshot = f.args.vehicleState.debugSnapshotRef.current;
  setVec(snapshot.position, px, py, pz);
  setVec(snapshot.linearVelocity, vx, vy, vz);
  snapshot.currentSegmentIndex = f.args.game.state().currentSegmentIndex;
  f.args.debug.physicsDebug(snapshot);
}
