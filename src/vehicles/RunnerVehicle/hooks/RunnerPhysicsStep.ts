/**
 * RunnerPhysicsStep.ts — one physics step of the first-person runner.
 *
 * `updateRunnerPhysics` runs the stages in a fixed order (#521 C): the order is
 * the behaviour — impulses accumulate into Rapier in the order they are
 * applied, so a stage never moves:
 *
 *   checkBodySanity → sampleGround → applyTerrainResponse → applyInput →
 *   integrate → applyWaterForces → applyCamera → writeTelemetry
 *
 * Every stage works on the runner's reused scratch (`runnerStepScratch.ts`):
 * steady-state running allocates nothing of ours (#521 D;
 * `runnerStep.alloc.perf.test.ts`). The debug snapshot and its `window`
 * global are built only on a `?debug` / `?physicsDebug` / `?screenshot` page.
 * Survival is integrated by SimCore's `survival` system; the step reads its
 * modifiers (sprint).
 */
import { handleDodgeAndCollision, sampleSlope, calculateSlopeMultiplier } from './RunnerPhysicsHelpers';
import {
  hasTerrainBelow,
  resolvePlayerGroundRayInto,
  isTerrainGroundHit,
} from './runnerGroundRay';
import {
  getEffectivePositionBoundsInto,
  resolveActiveEnvelopeInto,
  triggerOutOfBoundsWipeout,
  isFiniteVec3,
  isCameraWarm,
  resetCameraToSpawn,
  getHorizontalCameraForward,
  isPositionSane,
  holdBodyAtSpawn,
  computeStrafeEligibility,
  buildCameraRelativeDirsInto,
  tickSprintStamina,
  tickJumpStateMachine,
  tickFootstepAudio,
  applyRunnerCameraFollow,
  updateRunnerFovKick,
} from './runnerAirControl';
import * as THREE from 'three';
import { WATER_LEVEL, PLAYER_SPAWN, MOVEMENT, PHYSICS } from '../../../constants/game';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { isFloatingPlatform } from '../../../systems/pools/FloatingObjectRegistry';
import { useGameStore } from '../../../systems/GameState';
import { RUNNER_CONTACT_FRICTION } from '../../../systems/vehicle/VehicleSystem';
import { SMOOTHING_FACTOR, DEG_TO_RAD, BANK_CONFIG, JUMP_CONFIG, RUNNER_SPRINT } from '../constants';
import { playJumpSound } from '../audio';
import { triggerCameraShake } from '../../../hooks/useCameraShake';
import {
  tryFireShelfLaunch,
  getShelfDownstreamSpeed,
  isInsideShelfTrigger,
  type ShelfTrigger,
} from '../../utils/shelfLaunch';
import { tickLaunchScoring, hasActiveLaunch } from '../../../systems/score/LaunchScoringSession';
import { gameEvents } from '../../../systems/events/GameEvents';
import { bodyUserData as userDataOf, type RapierBody, type RapierNamespace, type RapierWorld } from '../../../physics/rapierTypes';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RunnerPhysicsState } from './useRunnerPhysics';
import {
  RUNNER_IMPULSE_TAGS,
  resetImpulseTally,
  type RunnerStepScratch,
} from './runnerStepScratch';

type Vec3 = { x: number; y: number; z: number };

export interface RunnerPhysicsStepArgs {
  delta: number;
  world: RapierWorld;
  body: RapierBody;
  rapier: RapierNamespace;
  camera: THREE.PerspectiveCamera;
  controls: { getControls: () => PlayerControls };
  vehicleState: RunnerPhysicsState;
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: ShelfTrigger | null };
}

/** One step's reads, shared by the stages (one per runner, rewritten each step). */
interface StepFrame {
  args: RunnerPhysicsStepArgs;
  s: RunnerStepScratch;
  dt: number;
  pos: Vec3;
  vel: Vec3;
  /** Sim ms (the debug overlay's clock). */
  now: number;
  noPointerLock: boolean;
  dtOk: boolean;
  posOk: boolean;
  /** Body, velocity, camera and dt all sane (F-8); terrain readiness is added in sampleGround. */
  sane: boolean;
  cameraWarm: boolean;
  isGrounded: boolean;
  slopeAngle: number;
  gravMult: number;
  userData: Record<string, unknown>;
  /** The control state read for this step. */
  controls: PlayerControls | null;
  speed: number;
  /** Contact friction / linear damping this step wants on the body. */
  friction: number;
  damping: number;
}

const stepFrames = new WeakMap<RunnerStepScratch, StepFrame>();

function frameFor(args: RunnerPhysicsStepArgs): StepFrame {
  const s = args.vehicleState.stepScratch;
  let f = stepFrames.get(s);
  if (!f) {
    f = {
      args, s, dt: 0, pos: s.impulse, vel: s.impulse, now: 0, noPointerLock: false,
      dtOk: false, posOk: false, sane: false, cameraWarm: false, isGrounded: false,
      slopeAngle: 0, gravMult: 1, userData: {}, controls: null, speed: 0,
      friction: RUNNER_CONTACT_FRICTION, damping: 0,
    };
    stepFrames.set(s, f);
  }
  f.args = args;
  return f;
}

export function updateRunnerPhysics(args: RunnerPhysicsStepArgs): void {
  const f = frameFor(args);
  if (!checkBodySanity(f)) return;
  sampleGround(f);
  applyTerrainResponse(f);
  applyInput(f);
  integrate(f);
  applyWaterForces(f);
  applyCamera(f);
  writeTelemetry(f);
}

/** Park the body: on its OOB latch, else the envelope's respawn point, else the spawn. */
function holdAtSpawn(f: StepFrame, envelope: RunnerStepScratch['envelope'] | null): void {
  // After an OOB the body is parked on its checkpoint until the terrain ray
  // lands again; without the latch the terrain-warm hold would yank it to the
  // world-origin spawn in the meantime.
  const latched = f.userData.__holdTarget as Vec3 | undefined;
  const respawnPoint =
    latched ??
    (envelope?.respawnAt !== undefined ? useGameStore.getState().spawnPoints[envelope.respawnAt] : undefined);
  holdBodyAtSpawn(f.args.body, respawnPoint);
}

/** Read body, clock and camera. False when the body is not finite or out of bounds (held, maybe wiped out). */
function checkBodySanity(f: StepFrame): boolean {
  const { args, s } = f;
  const { body, camera, vehicleState, rapier } = args;
  const { slopeState, debugState } = vehicleState;
  const dt = args.delta;
  f.dt = dt;
  f.noPointerLock = s.noPointerLock;
  s.body = body;
  // F-8: defer gameplay impulses until body, camera, terrain, and velocity are sane.
  s.physicsWarm = false;
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
      triggerOutOfBoundsWipeout(envelope);
      const game = useGameStore.getState();
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

/** Slope, ground ray, terrain readiness (the boot hold), grounded hysteresis, launch scoring, platforms. */
function sampleGround(f: StepFrame): void {
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

/** Bank-assist bonus 0..1 for a bank steeper than the assist threshold. */
function bankT(absBankDeg: number): number {
  return Math.min(1.0, (absBankDeg - BANK_CONFIG.ASSIST_THRESHOLD) /
                       (BANK_CONFIG.MAX_BANK_DEG - BANK_CONFIG.ASSIST_THRESHOLD));
}

/** Slope speed multiplier, bank assist, the waterfall gravity multiplier, the segment-14 launch shelf. */
function applyTerrainResponse(f: StepFrame): void {
  const { args, s, dt, vel, pos, isGrounded } = f;
  const { body, world, vehicleState, shelfTriggerRef, shelfLaunchFiredRef } = args;
  const slope = vehicleState.slopeState.current;

  if (isGrounded) {
    slope.currentAngle = f.slopeAngle;
    // Base pitch multiplier, plus a bank bonus: steep canyon walls add flow / speed.
    let baseMult = calculateSlopeMultiplier(f.slopeAngle);
    const absBankDeg = Math.abs(slope.bankAngle);
    if (absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
      baseMult = Math.min(1.5, baseMult + bankT(absBankDeg) * BANK_CONFIG.BANK_SPEED_BONUS);
    }
    slope.targetMultiplier = baseMult;
  } else {
    slope.targetMultiplier = THREE.MathUtils.lerp(slope.targetMultiplier, 1.0, dt * 2.0);
  }
  slope.currentMultiplier = THREE.MathUtils.lerp(
    slope.currentMultiplier,
    slope.targetMultiplier,
    Math.min(1.0, dt * SMOOTHING_FACTOR),
  );

  // === BANK ASSIST (canyon U-wall riding) ===
  // On a steep lateral bank: a "plant" impulse into the bank face that grows
  // with speed (centripetal, keeps the player on the wall), and anti-roll
  // torque that damps capsule tumbling around world X and Z.
  const absBankDeg = Math.abs(slope.bankAngle);
  if (isGrounded && absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
    const t = bankT(absBankDeg);
    const gn = slope.lastGroundNormal;
    const speed2D = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const speedFactor = 1.0 + speed2D * BANK_CONFIG.SPEED_ASSIST_SCALE;
    const plantMag = BANK_CONFIG.ASSIST_STRENGTH * t * speedFactor * dt;
    // Push player into bank face (negate horizontal normal → toward wall surface)
    if (isFiniteVec3(gn)) {
      const im = s.impulse;
      im.x = -gn.x * plantMag;
      im.y = 0;
      im.z = -gn.z * plantMag;
      s.applyImpulse('bankAssist', im);
    }
    const angVel = body.angvel();
    const antiRoll = BANK_CONFIG.ANTI_ROLL_STRENGTH * t * dt;
    if (s.physicsWarm && isFiniteVec3(angVel)) {
      const torque = s.impulse;
      torque.x = -angVel.x * antiRoll;
      torque.y = 0;
      torque.z = -angVel.z * antiRoll;
      body.applyTorqueImpulse(torque, true);
    }
  }

  // === GRAVITY MULTIPLIER (waterfall / steep rapids) ===
  // The store's waterfallGravityMultiplier onto the Rapier world, read without
  // subscribing (no re-render) and written only on change, in place.
  f.gravMult = useGameStore.getState().waterfallGravityMultiplier;
  if (f.gravMult !== vehicleState.appliedGravMultRef.current) {
    vehicleState.appliedGravMultRef.current = f.gravMult;
    world.gravity.x = 0;
    world.gravity.y = PHYSICS.GRAVITY * f.gravMult;
    world.gravity.z = 0;
  }

  // === WATERFALL LAUNCH-SHELF v2 (segment 14) ===
  // One-shot launch when crossing the authored slab shelf at speed.
  try {
    const sa = shelfArgs;
    sa.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
    sa.position = pos;
    sa.velocity = vel;
    sa.trigger = shelfTriggerRef.current;
    sa.firedRef = shelfLaunchFiredRef;
    const launch = tryFireShelfLaunch(sa);
    if (launch) {
      s.applyImpulse('shelfLaunch', launch.impulse);
      triggerCameraShake(0.45, 0.25);
      playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
      gameEvents.emit('shelfLaunch', {
        bodyHandle: body.handle,
        launchPos: pos,
        downstreamSpeed: getShelfDownstreamSpeed(vel),
      });
    }
  } catch (_e) {
    // Defensive: never let launch logic crash the physics step.
  }
}

/** Controls: sprint, the jump machine, dodge + impact detection, footsteps, then the movement impulses. */
function applyInput(f: StepFrame): void {
  const { args, s, dt, vel, pos, isGrounded } = f;
  const { body, camera, controls, vehicleState, world, rapier } = args;
  const { slopeState, jumpState, dodgeState, prevFrame, jumpForwardDirRef } = vehicleState;

  // === CAMERA FORWARD DIRECTION (used for slope-biased jump and dodge) ===
  const jumpForwardDir = jumpForwardDirRef.current;
  getHorizontalCameraForward(camera, f.cameraWarm, jumpForwardDir);
  // Slope trig shared by the grounded and coyote-time jump paths.
  const sinSlope = Math.sin(Math.abs(slopeState.current.currentAngle) * DEG_TO_RAD);

  const js = jumpState.current;
  const input = controls.getControls();
  f.controls = input;
  const { jump, leftward, rightward, dodge, sprint, forward, backward } = input;
  const jumpJustPressed = jump && !prevFrame.current.jumpPressed;
  const dodgeJustPressed = dodge && !prevFrame.current.dodgePressed;

  // === SPRINT STAMINA (Zustand-backed, no stale closures) ===
  const sp = sprintArgs;
  sp.dt = dt;
  sp.sprint = sprint;
  sp.jumpState = js;
  sp.sprintLockedRef = vehicleState.sprintLockedRef;
  const { isSprinting, movementMul } = tickSprintStamina(sp, s.sprint);

  const ja = jumpArgs;
  ja.js = js;
  ja.dt = dt;
  ja.isGrounded = isGrounded;
  ja.jump = jump;
  ja.jumpJustPressed = jumpJustPressed;
  ja.vel = vel;
  ja.pos = pos;
  ja.sinSlope = sinSlope;
  ja.jumpForwardDir = jumpForwardDir;
  ja.slopeState = slopeState;
  ja.applyImpulseWithDebugTracking = s.applyImpulse;
  ja.setLinvelSafe = s.setLinvelSafe;
  tickJumpStateMachine(ja);

  const da = dodgeArgs;
  da.dodgeState = dodgeState;
  da.dodgeJustPressed = dodgeJustPressed;
  da.isGrounded = isGrounded;
  da.camera = camera;
  da.leftward = leftward;
  da.rightward = rightward;
  da.backward = backward;
  da.dt = dt;
  da.body = body;
  da.pos = pos;
  da.vel = vel;
  da.prevFrame = prevFrame;
  da.vehicle = vehicleState.vehicle;
  da.collisionState = vehicleState.collisionState;
  da.debugState = vehicleState.debugState;
  da.now = f.now;
  da.applyImpulseWithDebugTracking = s.applyImpulse;
  da.rapier = rapier;
  da.world = world;
  handleDodgeAndCollision(da);

  // === FOOTSTEP AUDIO (F1) ===
  const fa = footstepArgs;
  fa.isGrounded = isGrounded;
  fa.jumpState = js.state;
  fa.vel = vel;
  fa.posY = pos.y;
  fa.dt = dt;
  fa.footstepState = vehicleState.footstepState;
  fa.currentBiome = vehicleState.collisionState.current.currentBiome;
  tickFootstepAudio(fa);

  // Store previous frame state
  prevFrame.current.wasGrounded = isGrounded;
  prevFrame.current.jumpPressed = jump;
  prevFrame.current.dodgePressed = dodge;
  prevFrame.current.velocity.set(vel.x, vel.y, vel.z);

  // === MOVEMENT INPUT ===
  const { forwardDir, rightDir } = s;
  buildCameraRelativeDirsInto(camera, f.cameraWarm, forwardDir, rightDir);

  const flowMultiplier = Number.isFinite(slopeState.current.currentMultiplier)
    ? slopeState.current.currentMultiplier
    : 1.0;
  // Recovery state: reduced turn speed (50% during recovery)
  const recoveryFactor = js.state === 'recovering' ? 0.5 : 1.0;
  const im = s.impulse;
  im.x = 0;
  im.y = 0;
  im.z = -VEHICLE_TUNING.flowResponsiveness * flowMultiplier * dt;
  s.applyImpulse('flow', im);

  const sprintMultiplier = isSprinting ? RUNNER_SPRINT.SPEED_MULTIPLIER : 1.0;
  const speed = VEHICLE_TUNING.baseSpeed * flowMultiplier * recoveryFactor * sprintMultiplier * movementMul;
  f.speed = speed;

  if (forward) {
    im.x = forwardDir.x * speed * dt;
    im.y = 0;
    im.z = forwardDir.z * speed * dt;
    s.applyImpulse('forwardInput', im);
  }
  if (backward) {
    im.x = forwardDir.x * -speed * 0.6 * dt;
    im.y = 0;
    im.z = forwardDir.z * -speed * 0.6 * dt;
    s.applyImpulse('backwardInput', im);
  }
  // Strafe with commit/recovery restrictions
  if (computeStrafeEligibility(js.state, js.commitTimer, dodgeState.current.state)) {
    if (leftward) {
        im.x = rightDir.x * -speed * 0.8 * dt;
      im.y = 0;
      im.z = rightDir.z * -speed * 0.8 * dt;
      s.applyImpulse('leftwardInput', im);
    }
    if (rightward) {
        im.x = rightDir.x * speed * 0.8 * dt;
      im.y = 0;
      im.z = rightDir.z * speed * 0.8 * dt;
      s.applyImpulse('rightwardInput', im);
    }
  }
}

/**
 * Contact friction `f.friction` on every collider of the body (debug-mirrored).
 * Written to Rapier only when it changes (Rapier keeps it): the value rides in
 * a field, not an argument, so the steady state passes no double across a call.
 */
function applyBodyFriction(f: StepFrame): void {
  const { s } = f;
  const { body, vehicleState } = f.args;
  vehicleState.debugState.current.friction = f.friction;
  try {
    const n = body.numColliders();
    if (s.applied.body === body && s.applied.colliders === n && s.applied.friction === f.friction) return;
    for (let i = 0; i < n; i++) body.collider(i).setFriction(f.friction);
    s.applied.body = body;
    s.applied.colliders = n;
    s.applied.friction = f.friction;
  } catch (_e) {
    // Fallback: friction not adjustable on this body
  }
}

/** `body.setLinearDamping(f.damping)`, only when it changes (Rapier keeps it). */
function applyBodyDamping(f: StepFrame): void {
  const { s } = f;
  const { body } = f.args;
  if (s.applied.dampingBody === body && s.applied.damping === f.damping) return;
  try {
    body.setLinearDamping(f.damping);
    s.applied.dampingBody = body;
    s.applied.damping = f.damping;
  } catch (_e) { /* damping setter unavailable */ }
}

/** The slope-aware speed cap, slide / bank friction, platform riding. */
function integrate(f: StepFrame): void {
  const { args, s, dt, vel, isGrounded } = f;
  const { vehicleState } = args;
  const slope = vehicleState.slopeState.current;
  const flowMultiplier = Number.isFinite(slope.currentMultiplier) ? slope.currentMultiplier : 1.0;

  // === SLOPE-AWARE HORIZONTAL SPEED CAP ===
  // Reward momentum on steep downhill terrain while preventing physics explosions:
  // cap = maxHorizontalSpeed * (1 + slopeBonusScale * (flowMultiplier - 1)).
  const effectiveMaxH = VEHICLE_TUNING.maxHorizontalSpeed *
    (1 + VEHICLE_TUNING.slopeBonusScale * (flowMultiplier - 1));
  const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (horizSpeed > effectiveMaxH && Number.isFinite(horizSpeed) && horizSpeed > 0) {
    const scale = effectiveMaxH / horizSpeed;
    const lv = s.impulse;
    lv.x = vel.x * scale;
    lv.y = vel.y;
    lv.z = vel.z * scale;
    s.setLinvelSafe(lv);
  }

  // Goal 2: Slide mechanic — activate on steep forward pitch OR steep lateral bank
  const isSlideInput = args.controls.getControls().brake &&
    (f.slopeAngle > MOVEMENT.SLIDE_MIN_SLOPE ||
     Math.abs(slope.bankAngle) > MOVEMENT.SLIDE_MIN_SLOPE);
  const { forwardDir } = s;
  if (isSlideInput && isGrounded) {
    // Reduce friction during slide for speed boost; on a bank the slide runs along the wall
    f.friction = MOVEMENT.SLIDE_FRICTION;
    applyBodyFriction(f);
    const slideBoost = MOVEMENT.SLIDE_SPEED_BOOST;
    const im = s.impulse;
    im.x = forwardDir.x * f.speed * (slideBoost - 1.0) * dt;
    im.y = 0;
    im.z = forwardDir.z * f.speed * (slideBoost - 1.0) * dt;
    s.applyImpulse('slideBoost', im);
  } else {
    // The runner's own contact friction; on steep banks lower, for smooth wall-riding.
    const absBank = Math.abs(slope.bankAngle);
    f.friction = absBank > BANK_CONFIG.ASSIST_THRESHOLD
      ? THREE.MathUtils.lerp(
          RUNNER_CONTACT_FRICTION,
          MOVEMENT.SLIDE_FRICTION * BANK_CONFIG.BANK_FRICTION_MULTIPLIER,
          bankT(absBank),
        )
      : RUNNER_CONTACT_FRICTION;
    applyBodyFriction(f);
  }

  // Goal 2: Platform riding - apply platform velocity to player
  const platform = vehicleState.platformState.current;
  if (platform.isOnPlatform) {
    const pVel = platform.platformVelocity;
    const transfer = MOVEMENT.PLAYER_MOMENTUM_TRANSFER ?? 0.3;
    const im = s.impulse;
    im.x = (pVel.x - vel.x) * transfer;
    im.y = (pVel.y - vel.y) * transfer * 0.5; // Less vertical transfer
    im.z = (pVel.z - vel.z) * transfer;
    s.applyImpulse('platformTransfer', im);
  }
}

/** Shallow-water running: lower damping and the segment's current along the run. */
function applyWaterForces(f: StepFrame): void {
  const { s, dt, pos } = f;
  if (pos.y < WATER_LEVEL + 1.0) {
    f.damping = VEHICLE_TUNING.linearDampingShallowWater;
    applyBodyDamping(f);
    const w = window as unknown as { __watershedFlowSpeed?: number };
    const segFlow = (typeof window !== 'undefined' && Number.isFinite(w.__watershedFlowSpeed))
      ? (w.__watershedFlowSpeed as number)
      : 1.0;
    const currentPush = 0.3 * segFlow * dt;
    const im = s.impulse;
    im.x = s.forwardDir.x * currentPush;
    im.y = 0;
    im.z = s.forwardDir.z * currentPush;
    s.applyImpulse('waterCurrent', im);
  } else {
    f.damping = VEHICLE_TUNING.linearDampingAir;
    applyBodyDamping(f);
  }
}

/** First-person follow (or the top-down harness view) and the speed FOV kick. */
function applyCamera(f: StepFrame): void {
  const { args, dt, pos, vel } = f;
  const ca = cameraArgs;
  ca.camera = args.camera;
  ca.pos = pos;
  ca.posOk = f.posOk;
  ca.noPointerLock = f.noPointerLock;
  applyRunnerCameraFollow(ca);

  const fa = fovArgs;
  fa.camera = args.camera;
  fa.vel = vel;
  fa.dt = dt;
  fa.fovState = args.vehicleState.fovState;
  fa.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
  updateRunnerFovKick(fa);
}

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
function writeTelemetry(f: StepFrame): void {
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
  snapshot.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
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
  if (typeof window !== 'undefined') window.__watershedPhysicsDebug = snapshot;
}

function setVec(out: Vec3, x: number, y: number, z: number): void {
  out.x = x;
  out.y = y;
  out.z = z;
}

/** The early-out paths' snapshot: pose and segment only (debug pages). */
function publishSnapshotPose(f: StepFrame, px: number, py: number, pz: number, vx: number, vy: number, vz: number): void {
  if (!f.s.debugGlobals) return;
  const snapshot = f.args.vehicleState.debugSnapshotRef.current;
  setVec(snapshot.position, px, py, pz);
  setVec(snapshot.linearVelocity, vx, vy, vz);
  snapshot.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
  if (typeof window !== 'undefined') window.__watershedPhysicsDebug = snapshot;
}

// The helpers' argument objects, reused: rewritten field by field each step
// instead of a fresh literal per call (#521 D). Module-level is safe — a step
// runs to completion and nothing keeps the object.
const launchArgs: Parameters<typeof tickLaunchScoring>[0] = {
  physicsDt: 0, bodyHandle: 0, position: { x: 0, y: 0, z: 0 }, contactSurface: 'airborne', vehicle: 'runner',
};
const shelfArgs: Parameters<typeof tryFireShelfLaunch>[0] = {
  currentSegmentIndex: 0,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  trigger: null,
  firedRef: { current: false },
  speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
  vehicleScale: VEHICLE_TUNING.shelfLaunch.runnerScale,
};
const slopeArgs = {} as Parameters<typeof sampleSlope>[0];
const sprintArgs = {} as Parameters<typeof tickSprintStamina>[0];
const jumpArgs = {} as Parameters<typeof tickJumpStateMachine>[0];
const dodgeArgs = {} as Parameters<typeof handleDodgeAndCollision>[0];
const footstepArgs = {} as Parameters<typeof tickFootstepAudio>[0];
const cameraArgs = {} as Parameters<typeof applyRunnerCameraFollow>[0];
const fovArgs = {} as Parameters<typeof updateRunnerFovKick>[0];
