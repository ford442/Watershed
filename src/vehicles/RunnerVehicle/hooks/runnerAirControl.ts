import * as THREE from 'three';
import { MOVEMENT, PLAYER_SPAWN, WATER_LEVEL } from '../../../constants/game';
import { isAutumnLike, isBiomeId, type BiomeId } from '../../../configs/biomes';
import { useGameStore } from '../../../systems/GameState';
import { tickRunSurvival } from '../../../systems/journey/runSession';
import { BANK_CONFIG, JUMP_CONFIG, RUNNER_SPRINT } from '../constants';
import { playJumpSound, playLandSound, playFootstep } from '../audio';
import { triggerCameraShake } from '../utils';

type Vec3 = { x: number; y: number; z: number };

export const POSITION_SANE = { yMin: -80, yMax: 250, xzMax: 6000, speedMax: 100 };

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

export const isPositionSane = (pos: Vec3) =>
  pos.y >= POSITION_SANE.yMin &&
  pos.y <= POSITION_SANE.yMax &&
  Math.abs(pos.x) <= POSITION_SANE.xzMax &&
  Math.abs(pos.z) <= POSITION_SANE.xzMax;

export const holdBodyAtSpawn = (body: {
  setTranslation: Function;
  setLinvel: Function;
  setAngvel: Function;
}) => {
  const [sx, sy, sz] = PLAYER_SPAWN.position;
  body.setTranslation({ x: sx, y: sy, z: sz }, true);
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
  getHorizontalCameraForward(camera, cameraWarm, forwardDir);

  const rightDir = new THREE.Vector3();
  rightDir.crossVectors(forwardDir, camera.up);
  if (rightDir.lengthSq() > 0.001) {
    rightDir.normalize();
  } else {
    rightDir.set(1, 0, 0);
  }
  return { forwardDir, rightDir };
}

/** Sprint stamina drain/regen + exhaustion lock hysteresis. */
export function tickSprintStamina({
  dt,
  posY,
  vel,
  sprint,
  jumpState,
  sprintLockedRef,
}: {
  dt: number;
  posY: number;
  vel: Vec3;
  sprint: boolean;
  jumpState: { state: string };
  sprintLockedRef: { current: boolean };
}): { isSprinting: boolean; movementMul: number } {
  const storeState = useGameStore.getState();
  let stamina = storeState.sprintStamina;

  const biomeId: BiomeId = isBiomeId(storeState.currentBiome)
    ? storeState.currentBiome
    : 'canyonSummer';
  const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const survivalMods = tickRunSurvival({
    dt,
    biomeId,
    inWater: posY < WATER_LEVEL + 0.55,
    windSpeed: horizontalSpeed,
  });
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
  storeState.setSprintStamina(stamina);

  return { isSprinting, movementMul };
}

/** Jump / coyote / double-jump / landing state machine (mutates js in place). */
export function tickJumpStateMachine({
  js,
  dt,
  isGrounded,
  jump,
  jumpJustPressed,
  vel,
  pos,
  sinSlope,
  jumpForwardDir,
  slopeState,
  applyImpulseWithDebugTracking,
  setLinvelSafe,
}: {
  js: any;
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
}) {
  if (isGrounded) {
    js.timeSinceGrounded = 0;
  } else {
    js.timeSinceGrounded += dt;
  }

  switch (js.state) {
    case 'grounded': {
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
      break;
    }

    case 'airborne': {
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
    const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
    camera.position.lerp(targetPos, 0.12);
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
  fovRef,
  currentSegmentIndex,
}: {
  camera: THREE.PerspectiveCamera;
  vel: Vec3;
  dt: number;
  fovRef: { current: number };
  currentSegmentIndex: number;
}) {
  const isWaterfallSeg = currentSegmentIndex === 14 || currentSegmentIndex === 29;
  const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const targetFov = 75 + Math.min(12, hSpeed * 0.45) + (isWaterfallSeg ? 10 : 0);
  fovRef.current += (targetFov - fovRef.current) * (1 - Math.exp(-dt * 5));
  if (Math.abs(camera.fov - fovRef.current) > 0.05) {
    camera.fov = fovRef.current;
    camera.updateProjectionMatrix();
  }
}
