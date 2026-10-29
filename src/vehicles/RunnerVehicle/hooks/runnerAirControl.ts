import * as THREE from 'three';
import { MOVEMENT, PLAYER_SPAWN, WATER_LEVEL } from '../../../constants/game';
import { isAutumnLike } from '../../../configs/biomes';
import { useGameStore } from '../../../systems/GameState';
import { cancelLaunch } from '../../../systems/score/LaunchScoringSession';
import {
  getSegmentFrames,
  resolveRaftEnvelope,
  resolveSegmentEnvelope,
  resolveSegmentEnvelopeInto,
  type SegmentEnvelope,
  type VerticalBounds,
} from '../../../systems/map/segmentFrames';
import { getActiveSurvivalModifiers } from '../../../systems/journey/runSession';
import { BANK_CONFIG, JUMP_CONFIG, RUNNER_SPRINT } from '../constants';
import { playJumpSound, playLandSound, playFootstep } from '../audio';
import { triggerCameraShake } from '../../../hooks/useCameraShake';
import { getComfort } from '../../../systems/settings/comfortRuntime';
import { runnerTargetFov } from '../../../systems/settings/comfort';
import type { RapierBody } from '../../../physics/rapierTypes';
import type { RunnerJumpData } from './useRunnerPhysics';

type Vec3 = { x: number; y: number; z: number };

/** Camera-follow target, reused every step. */
const _cameraTarget = new THREE.Vector3();

/**
 * Global sanity bounds. `yMin`/`yMax` are **margins** below / above the active
 * segment's centreline (the track descends hundreds of metres, so an absolute
 * `y < -80` clip fired a few segments into every map); they are absolute only
 * before the treadmill has published any segment. `xzMax`/`speedMax` are
 * absolute.
 */
export const POSITION_SANE = { yMin: -80, yMax: 250, xzMax: 6000, speedMax: 100 };

/**
 * World-space vertical envelope for the player at `pos`: the authored
 * `safeZone` of the segment they are on, else the `POSITION_SANE` margins —
 * both relative to that segment's centreline (`segmentFrames.ts`).
 */
export const resolveActiveEnvelope = (pos: { z: number }): SegmentEnvelope =>
  resolveSegmentEnvelope(getSegmentFrames(), pos, POSITION_SANE);

/** `resolveActiveEnvelope` into `out` (no allocation; the per-step readers). */
export const resolveActiveEnvelopeInto = (out: SegmentEnvelope, pos: { z: number }): SegmentEnvelope =>
  resolveSegmentEnvelopeInto(out, getSegmentFrames(), pos, POSITION_SANE);

/**
 * The raft's envelope at `pos`: depth below the staged surface it floats on
 * (`resolveRaftEnvelope`), the runner margins' ceiling.
 */
export const resolveActiveRaftEnvelope = (pos: { z: number }, waterLevel: number | null): SegmentEnvelope =>
  resolveRaftEnvelope(getSegmentFrames(), pos, POSITION_SANE, waterLevel);

/**
 * Merge a resolved (world-space) vertical envelope onto the global bounds.
 * Only the vertical (y) axis is ever per-segment; xz/speed stay global.
 */
export const getEffectivePositionBounds = (envelope?: VerticalBounds | null) =>
  getEffectivePositionBoundsInto({ yMin: 0, yMax: 0, xzMax: 0, speedMax: 0 }, envelope);

export type PositionBounds = { yMin: number; yMax: number; xzMax: number; speedMax: number };

/** `getEffectivePositionBounds` into `out` (no allocation). */
export function getEffectivePositionBoundsInto(out: PositionBounds, envelope?: VerticalBounds | null): PositionBounds {
  out.yMin = envelope?.yMin ?? POSITION_SANE.yMin;
  out.yMax = envelope?.yMax ?? POSITION_SANE.yMax;
  out.xzMax = POSITION_SANE.xzMax;
  out.speedMax = POSITION_SANE.speedMax;
  return out;
}

/**
 * The one OOB wipeout path, shared by the runner physics step and the
 * vehicle-agnostic lifecycle check (whichever sees the fall first). Idempotent
 * while a wipeout is already in flight. An authored `respawnAt` overrides the
 * checkpoint table's respawn segment.
 */
export function triggerOutOfBoundsWipeout(envelope: Pick<SegmentEnvelope, 'respawnAt'>): void {
  const game = useGameStore.getState();
  if (game.isWipeout) return;
  if (envelope.respawnAt !== undefined) {
    game.setRespawnSegmentIndex(envelope.respawnAt);
  }
  cancelLaunch();
  game.setIsWipeout(true);
}

export const isFiniteVec3 = (v: Vec3) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export const isFiniteImpulse = (impulse: Vec3) => isFiniteVec3(impulse);

export const isCameraWarm = (camera: THREE.Camera) => {
  const camPos = camera.position;
  if (!Number.isFinite(camPos.x) || !Number.isFinite(camPos.y) || !Number.isFinite(camPos.z)) {
    return false;
  }
  return camera.matrixWorld.elements.every(Number.isFinite);
};

export const resetCameraToSpawn = (camera: THREE.Camera, noPointerLock: boolean) => {
  const [sx, sy, sz] = PLAYER_SPAWN.position;
  const [cx, cy, cz] = PLAYER_SPAWN.fallbackCamera;
  if (noPointerLock) {
    camera.position.set(sx, sy + 40, sz);
    camera.lookAt(sx, sy, sz);
  } else {
    camera.position.set(cx, cy, cz);
    camera.rotation.set(0, 0, 0);
  }
  camera.updateMatrixWorld(true);
};

export const getHorizontalCameraForward = (
  camera: THREE.Camera,
  cameraWarm: boolean,
  out: THREE.Vector3,
) => {
  if (cameraWarm) {
    camera.getWorldDirection(out);
    out.y = 0;
    if (out.lengthSq() > 0.001) {
      out.normalize();
      return out;
    }
  }
  return out.set(0, 0, -1);
};

export const isPositionSane = (
  pos: Vec3,
  bounds: { yMin: number; yMax: number; xzMax: number } = POSITION_SANE,
) =>
  pos.y >= bounds.yMin &&
  pos.y <= bounds.yMax &&
  Math.abs(pos.x) <= bounds.xzMax &&
  Math.abs(pos.z) <= bounds.xzMax;

export const holdBodyAtSpawn = (
  body: Pick<RapierBody, 'setTranslation' | 'setLinvel' | 'setAngvel'>,
  target?: Vec3,
) => {
  const [sx, sy, sz] = PLAYER_SPAWN.position;
  body.setTranslation(target ?? { x: sx, y: sy, z: sz }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
};

/** Slope-biased jump / coyote kick-off impulse (forward + bank normal blend). */
export function computeJumpImpulse({
  jumpForce,
  sinSlope,
  jumpForwardDir,
  groundNormal,
  bankAngle,
}: {
  jumpForce: number;
  sinSlope: number;
  jumpForwardDir: { x: number; z: number };
  groundNormal: { x: number; z: number };
  bankAngle: number;
}): Vec3 {
  const forwardBias = jumpForce * sinSlope * JUMP_CONFIG.SLOPE_FORWARD_BIAS;
  const bankBlend = Math.min(
    0.5,
    Math.abs(bankAngle) / BANK_CONFIG.KICKOFF_MAX_BANK_DEG,
  );
  return {
    x: jumpForwardDir.x * forwardBias + groundNormal.x * jumpForce * bankBlend,
    y: jumpForce,
    z: jumpForwardDir.z * forwardBias + groundNormal.z * jumpForce * bankBlend,
  };
}

/** Strafe allowed outside jump commit, recovery, and active dodge. */
export function computeStrafeEligibility(
  jsState: string,
  commitTimer: number,
  dodgeState: string,
): boolean {
  const inCommitPhase = jsState === 'airborne' && commitTimer > 0;
  return !inCommitPhase && jsState !== 'recovering' && dodgeState !== 'dodging';
}

/** Camera-relative horizontal forward/right for movement impulses. */
export function buildCameraRelativeDirs(
  camera: THREE.Camera,
  cameraWarm: boolean,
): { forwardDir: THREE.Vector3; rightDir: THREE.Vector3 } {
  const forwardDir = new THREE.Vector3();
  const rightDir = new THREE.Vector3();
  buildCameraRelativeDirsInto(camera, cameraWarm, forwardDir, rightDir);
  return { forwardDir, rightDir };
}

/** `buildCameraRelativeDirs` into caller-owned vectors (no allocation). */
export function buildCameraRelativeDirsInto(
  camera: THREE.Camera,
  cameraWarm: boolean,
  forwardDir: THREE.Vector3,
  rightDir: THREE.Vector3,
): void {
  getHorizontalCameraForward(camera, cameraWarm, forwardDir);
  rightDir.crossVectors(forwardDir, camera.up);
  if (rightDir.lengthSq() > 0.001) {
    rightDir.normalize();
  } else {
    rightDir.set(1, 0, 0);
  }
}

export interface SprintResult {
  isSprinting: boolean;
  movementMul: number;
}

/**
 * Sprint stamina drain/regen + exhaustion lock hysteresis. Writes `out` when
 * given (the runner step's scratch), else returns a fresh result.
 */
export function tickSprintStamina(
  {
    dt,
    sprint,
    jumpState,
    sprintLockedRef,
  }: {
    dt: number;
    sprint: boolean;
    jumpState: { state: string };
    sprintLockedRef: { current: boolean };
  },
  out: SprintResult = { isSprinting: false, movementMul: 1 },
): SprintResult {
  const storeState = useGameStore.getState();
  let stamina = storeState.sprintStamina;

  // Integrated by SimCore's survival system (#521 A) in the active gameplay
  // profile's climate (#521 B); the runner only reads the result.
  const survivalMods = getActiveSurvivalModifiers();
  const staminaDrainMul = survivalMods?.staminaDrainMultiplier ?? 1;
  const staminaRegenMul = survivalMods?.staminaRegenMultiplier ?? 1;
  const movementMul = survivalMods?.movementMultiplier ?? 1;

  if (stamina <= RUNNER_SPRINT.EXHAUSTION_THRESHOLD) {
    sprintLockedRef.current = true;
  } else if (sprintLockedRef.current && stamina >= RUNNER_SPRINT.RECOVERY_THRESHOLD) {
    sprintLockedRef.current = false;
  }

  const isAirborne = jumpState.state === 'airborne';
  const isSprinting = sprint && !sprintLockedRef.current && !isAirborne;

  if (isSprinting) {
    stamina = Math.max(0, stamina - RUNNER_SPRINT.DRAIN_RATE * staminaDrainMul * dt);
  } else if (isAirborne) {
    stamina = Math.min(1, stamina + RUNNER_SPRINT.REGEN_AIRBORNE * staminaRegenMul * dt);
  } else {
    stamina = Math.min(1, stamina + RUNNER_SPRINT.REGEN_GROUNDED * staminaRegenMul * dt);
  }
  // A write only on change: a store set builds a new state object, and full
  // stamina while running is the steady state.
  if (stamina !== storeState.sprintStamina) storeState.setSprintStamina(stamina);

  out.isSprinting = isSprinting;
  out.movementMul = movementMul;
  return out;
}

export interface JumpStateMachineArgs {
  js: RunnerJumpData;
  dt: number;
  isGrounded: boolean;
  jump: boolean;
  jumpJustPressed: boolean;
  vel: Vec3;
  pos: Vec3;
  sinSlope: number;
  jumpForwardDir: { x: number; z: number };
  slopeState: { current: { currentMultiplier: number; lastGroundNormal: { x: number; z: number }; bankAngle: number } };
  applyImpulseWithDebugTracking: (tag: string, impulse: Vec3) => void;
  setLinvelSafe: (nextVel: Vec3) => void;
}

/** Jump / coyote / double-jump / landing state machine (mutates js in place). */
export function tickJumpStateMachine(args: JumpStateMachineArgs) {
  const { js, dt, isGrounded } = args;
  if (isGrounded) {
    js.timeSinceGrounded = 0;
  } else {
    js.timeSinceGrounded += dt;
  }

  switch (js.state) {
    case 'grounded': {
      tickJumpGrounded(args);
      break;
    }

    case 'airborne': {
      tickJumpAirborne(args);
      break;
    }

    case 'landing': {
      js.state = 'recovering';
      js.recoveryTimer = JUMP_CONFIG.RECOVERY_DURATION;
      break;
    }

    case 'recovering': {
      js.recoveryTimer -= dt;

      if (js.recoveryTimer <= 0) {
        if (isGrounded) {
          js.state = 'grounded';
        } else {
          js.state = 'airborne';
        }
      }
      break;
    }
  }
}

/** 'grounded': walking off an edge goes airborne; a jump press launches. */
function tickJumpGrounded(args: JumpStateMachineArgs): void {
  const { js, isGrounded, jumpJustPressed, vel, pos, sinSlope, jumpForwardDir, slopeState, applyImpulseWithDebugTracking } = args;
  if (!isGrounded) {
    js.state = 'airborne';
    js.hasDoubleJumped = false;
    js.airTime = 0;
    js.verticalVelocityOnLeave = vel.y;
    js.lastGroundY = pos.y;
  } else if (jumpJustPressed) {
    const jumpForce = JUMP_CONFIG.FORCE * Math.max(0.8, slopeState.current.currentMultiplier);
    const gn = slopeState.current.lastGroundNormal;
    applyImpulseWithDebugTracking(
      'jump',
      computeJumpImpulse({
        jumpForce,
        sinSlope,
        jumpForwardDir,
        groundNormal: gn,
        bankAngle: slopeState.current.bankAngle,
      }),
    );

    js.state = 'airborne';
    js.hasDoubleJumped = false;
    js.airTime = 0;
    js.commitTimer = JUMP_CONFIG.COMMIT_DURATION;
    js.verticalVelocityOnLeave = jumpForce;
    js.jumpReleased = false;

    playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
  }
}

/** 'airborne': jump cut, coyote jump, double jump, then landing — in that order. */
function tickJumpAirborne(args: JumpStateMachineArgs): void {
  const {
    js, dt, isGrounded, jump, jumpJustPressed, vel, sinSlope, jumpForwardDir, slopeState,
    applyImpulseWithDebugTracking, setLinvelSafe,
  } = args;
  js.airTime += dt;

  if (js.commitTimer > 0) {
    js.commitTimer -= dt;
  }

  if (!jump && !js.jumpReleased && vel.y > 0) {
    js.jumpReleased = true;
    setLinvelSafe({
      x: vel.x,
      y: vel.y * MOVEMENT.JUMP_CUT_MULTIPLIER,
      z: vel.z,
    });
  }

  if (
    jumpJustPressed &&
    js.timeSinceGrounded <= MOVEMENT.COYOTE_TIME &&
    js.airTime < 0.15 &&
    !js.hasDoubleJumped
  ) {
    const jumpForce = JUMP_CONFIG.FORCE * 0.9;
    const gn = slopeState.current.lastGroundNormal;
    applyImpulseWithDebugTracking(
      'coyoteJump',
      computeJumpImpulse({
        jumpForce,
        sinSlope,
        jumpForwardDir,
        groundNormal: gn,
        bankAngle: slopeState.current.bankAngle,
      }),
    );
    js.hasDoubleJumped = false;
    js.commitTimer = JUMP_CONFIG.COMMIT_DURATION;
    js.jumpReleased = false;
    playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
    js.airTime = 0;
    js.timeSinceGrounded = 999;
  }

  if (jumpJustPressed && !js.hasDoubleJumped && js.airTime > 0.05) {
    const doubleJumpForce = JUMP_CONFIG.DOUBLE_JUMP_FORCE;
    const newVelY = Math.max(vel.y * 0.3, 0) + doubleJumpForce;
    setLinvelSafe({ x: vel.x, y: newVelY, z: vel.z });

    js.hasDoubleJumped = true;
    js.jumpReleased = false;
    playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z), true);
  }

  if (isGrounded && js.airTime > 0.05) {
    js.state = 'landing';

    const impactVel = Math.abs(vel.y);
    playLandSound(impactVel);

    if (impactVel > JUMP_CONFIG.HIGH_IMPACT_THRESHOLD) {
      const shakeIntensity = Math.min(
        1.0,
        (impactVel - JUMP_CONFIG.HIGH_IMPACT_THRESHOLD) / 10,
      );
      triggerCameraShake(shakeIntensity);
    }
  }
}

/** Grounded footstep distance accumulator + material pick. */
export function tickFootstepAudio({
  isGrounded,
  jumpState,
  vel,
  posY,
  dt,
  footstepState,
  currentBiome,
}: {
  isGrounded: boolean;
  jumpState: string;
  vel: Vec3;
  posY: number;
  dt: number;
  footstepState: {
    current: {
      distanceTraveled: number;
      lastStepDistance: number;
      stepInterval: number;
    };
  };
  currentBiome: string;
}) {
  if (!(isGrounded && jumpState === 'grounded')) return;
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (speed <= 0.5) return;

  footstepState.current.distanceTraveled += speed * dt;
  if (
    footstepState.current.distanceTraveled - footstepState.current.lastStepDistance >=
    footstepState.current.stepInterval
  ) {
    footstepState.current.lastStepDistance = footstepState.current.distanceTraveled;
    const material = isAutumnLike(currentBiome) ? 'moss' : 'rock';
    const isWet = posY < WATER_LEVEL + 1.0;
    playFootstep(material, isWet);
  }
}

/** First-person camera follow / top-down screenshot mode. */
export function applyRunnerCameraFollow({
  camera,
  pos,
  posOk,
  noPointerLock,
}: {
  camera: THREE.PerspectiveCamera;
  pos: Vec3;
  posOk: boolean;
  noPointerLock: boolean;
}) {
  if (!posOk) return;

  const camPos = camera.position;
  if (!Number.isFinite(camPos.x) || !Number.isFinite(camPos.y) || !Number.isFinite(camPos.z)) {
    camPos.set(pos.x, pos.y + 1.65, pos.z);
  }

  if (noPointerLock) {
    camera.position.set(pos.x, pos.y + 40, pos.z);
    camera.lookAt(pos.x, pos.y, pos.z);
  } else {
    camera.position.lerp(_cameraTarget.set(pos.x, pos.y + 1.65, pos.z), 0.12);
  }

  if (
    !Number.isFinite(camera.position.x) ||
    !Number.isFinite(camera.position.y) ||
    !Number.isFinite(camera.position.z)
  ) {
    camera.position.set(pos.x, pos.y + 1.65, pos.z);
  }
}

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
