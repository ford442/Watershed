/**
 * Stage 4 — applyInput (#559 C, from `RunnerPhysicsStep.ts`): sprint, the jump
 * machine (and the auto-jump assist), dodge + impact detection, footsteps,
 * then the movement impulses.
 */
import { VEHICLE_TUNING } from '../../../../constants/vehicleTuning';
import type { PlayerControls } from '../../../../input/playerControls';
import { getLiveAssists } from '../../../../systems/settings/accessRuntime';
import { autoJumpDue, createAutoJumpState } from '../../../../systems/map/autoJump';
import { DEG_TO_RAD, RUNNER_SPRINT } from '../../constants';
import { handleDodgeAndCollision } from '../RunnerPhysicsHelpers';
import {
  getHorizontalCameraForward,
  computeStrafeEligibility,
  buildCameraRelativeDirsInto,
  tickSprintStamina,
  tickJumpStateMachine,
  tickFootstepAudio,
} from '../runnerAirControl';
import type { StepFrame } from './stepFrame';

/** The auto-jump assist's per-page state (which gap it last jumped). */
const autoJumpState = createAutoJumpState();

/** Controls: sprint, the jump machine, dodge + impact detection, footsteps, then the movement impulses. */
export function applyInput(f: StepFrame): void {
  const input = tickInputMachines(f);
  applyMovementInput(f, input);
}

/**
 * Sprint stamina, the jump machine, dodge + impact detection and footsteps,
 * then this step's input latched into `prevFrame`. Returns the controls read.
 * The sprint result stays in `s.sprint` for the movement stage.
 */
function tickInputMachines(f: StepFrame): PlayerControls {
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
  const { jump, leftward, rightward, dodge, sprint, backward } = input;
  // Auto-jump assist (#558 D.1): a press of its own just before an authored gap.
  let autoJump = false;
  if (getLiveAssists().autoJump && js.state !== 'airborne') {
    const at = body.translation();
    autoJump = autoJumpDue(autoJumpState, args.game.state().currentSegmentIndex, at.x, at.z);
  }
  const jumpJustPressed = (jump && !prevFrame.current.jumpPressed) || autoJump;
  const dodgeJustPressed = dodge && !prevFrame.current.dodgePressed;

  // === SPRINT STAMINA (Zustand-backed, no stale closures) ===
  const sp = sprintArgs;
  sp.dt = dt;
  sp.sprint = sprint;
  sp.jumpState = js;
  sp.sprintLockedRef = vehicleState.sprintLockedRef;
  sp.game = args.game.state();
  tickSprintStamina(sp, s.sprint);

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
  da.game = args.game.state();
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
  return input;
}

/** === MOVEMENT INPUT === flow, then forward / backward / strafe impulses. */
function applyMovementInput(f: StepFrame, input: PlayerControls): void {
  const { args, s, dt } = f;
  const { camera, vehicleState } = args;
  const { slopeState, jumpState, dodgeState } = vehicleState;
  const js = jumpState.current;
  const { leftward, rightward, forward, backward } = input;
  const { isSprinting, movementMul } = s.sprint;

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

// The helpers' argument objects, reused (#521 D): see RunnerPhysicsStep.ts.
const sprintArgs = {} as Parameters<typeof tickSprintStamina>[0];
const jumpArgs = {} as Parameters<typeof tickJumpStateMachine>[0];
const dodgeArgs = {} as Parameters<typeof handleDodgeAndCollision>[0];
const footstepArgs = {} as Parameters<typeof tickFootstepAudio>[0];
