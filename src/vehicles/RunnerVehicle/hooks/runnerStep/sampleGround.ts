/**
 * Stage 2 — sampleGround (#559 C, from `RunnerPhysicsStep.ts`): slope, ground
 * ray, terrain readiness (the boot hold), grounded hysteresis, launch scoring,
 * platforms.
 */
import { WATER_LEVEL } from '../../../../constants/game';
import { isFloatingPlatform } from '../../../../systems/pools/FloatingObjectRegistry';
import { tickLaunchScoring, hasActiveLaunch } from '../../../../systems/score/LaunchScoringSession';
import { isInsideShelfTrigger } from '../../../utils/shelfLaunch';
import { JUMP_CONFIG } from '../../constants';
import { sampleSlope } from '../RunnerPhysicsHelpers';
import { hasTerrainBelow, resolvePlayerGroundRayInto, isTerrainGroundHit } from '../runnerGroundRay';
import { holdAtSpawn, type StepFrame } from './stepFrame';

/** Slope, ground ray, terrain readiness (the boot hold), grounded hysteresis, launch scoring, platforms. */
export function sampleGround(f: StepFrame): void {
  const { args, s, pos } = f;
  const { body, world, rapier, vehicleState, shelfTriggerRef, shelfLaunchFiredRef } = args;
  const { slopeState, ungroundedFramesRef, platformState } = vehicleState;

  const sl = slopeArgs;
  sl.body = body;
  sl.world = world;
  sl.rapier = rapier;
  sl.slopeState = slopeState;
  sl.pos = pos;
  sampleSlope(sl);
  f.slopeAngle = slopeState.current.sampledAngle;
  const ground = resolvePlayerGroundRayInto(s.ground, world, rapier, body, pos);

  // Terrain is "ready" once there is canyon under the runner — not only within
  // the grounded reach. The meander spawn stands ~6 m over its floor, past the
  // 5 m grounded ray: a variable-dt boot only got there because its first
  // (large) step dropped the body before the hold began, and a fixed-dt
  // scripted boot held it in mid-air forever.
  const ud = f.userData;
  if (isTerrainGroundHit(ground.toi) || (!ud.__terrainReady && hasTerrainBelow(world, rapier, body, pos))) {
    ud.__terrainReady = true;
    ud.__holdTarget = undefined;
  }
  const terrainWarm = !!ud.__terrainReady;
  if (!terrainWarm) {
    holdAtSpawn(f, s.envelope);
    if (ud.__bootBodyType !== 'kinematic') {
      body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      ud.__bootBodyType = 'kinematic';
    }
  } else if (ud.__bootBodyType === 'kinematic') {
    body.setBodyType(rapier.RigidBodyType.Dynamic, true);
    ud.__bootBodyType = 'dynamic';
  }
  s.physicsWarm = f.sane && terrainWarm;

  // Hysteresis: GROUNDED_HYSTERESIS_FRAMES consecutive misses before going airborne, so
  // skimming small rocks / lips does not flip the state (updateUngroundedHysteresis, inline).
  const hysteresisFrames = JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES;
  const ungrounded = ground.rawGrounded ? 0 : Math.min(ungroundedFramesRef.current + 1, hysteresisFrames);
  ungroundedFramesRef.current = ungrounded;
  f.isGrounded = ground.rawGrounded || ungrounded < hysteresisFrames;
  slopeState.current.isGrounded = f.isGrounded;

  // === SHELF LAUNCH AIR-TIME SCORING (physics-step time) ===
  try {
    const la = launchArgs;
    la.physicsDt = typeof world.timestep === 'number' && world.timestep > 0 ? world.timestep : f.dt;
    la.bodyHandle = body.handle;
    la.position = pos;
    la.contactSurface = f.isGrounded ? 'terrain' : pos.y < WATER_LEVEL + 0.55 ? 'water' : 'airborne';
    tickLaunchScoring(la);
    if (!hasActiveLaunch() && shelfTriggerRef.current && !isInsideShelfTrigger(pos, shelfTriggerRef.current)) {
      shelfLaunchFiredRef.current = false;
    }
  } catch (_e) {
    // Never let scoring break the physics step.
  }

  // Goal 2: Platform detection via raycast handle registry
  platformState.current.isOnPlatform = false;
  const groundHit = ground.hit;
  if (ground.rawGrounded && groundHit) {
    try {
      const collider = groundHit.collider;
      const parent = collider?.parent?.();
      if (parent) {
        if (isFloatingPlatform(parent.handle)) {
          platformState.current.isOnPlatform = true;
          const pVel = parent.linvel?.();
          if (pVel) platformState.current.platformVelocity.set(pVel.x, pVel.y, pVel.z);
        }
        parent.free?.();
      }
    } catch {
      // Ignore colliders without parent
    }
    groundHit.free?.();
  }
}

// The helpers' argument objects, reused (#521 D): see RunnerPhysicsStep.ts.
const launchArgs: Parameters<typeof tickLaunchScoring>[0] = {
  physicsDt: 0, bodyHandle: 0, position: { x: 0, y: 0, z: 0 }, contactSurface: 'airborne', vehicle: 'runner',
};
const slopeArgs = {} as Parameters<typeof sampleSlope>[0];
