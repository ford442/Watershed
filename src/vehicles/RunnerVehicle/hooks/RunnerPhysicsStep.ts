import { handleDodgeAndCollision, calculateSlopeAngle, calculateSlopeMultiplier } from './RunnerPhysicsHelpers';
import {
  buildGroundRayOrigin,
  hasTerrainBelow,
  updateUngroundedHysteresis,
  resolvePlayerGroundRay,
  isTerrainGroundHit,
} from './runnerGroundRay';
import {
  getEffectivePositionBounds,
  resolveActiveEnvelope,
  triggerOutOfBoundsWipeout,
  isFiniteVec3,
  isFiniteImpulse,
  isCameraWarm,
  resetCameraToSpawn,
  getHorizontalCameraForward,
  isPositionSane,
  holdBodyAtSpawn,
  computeStrafeEligibility,
  buildCameraRelativeDirs,
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
import {
    SMOOTHING_FACTOR, DEG_TO_RAD,
    BANK_CONFIG, RUNNER_SPRINT
} from '../constants';
import { playJumpSound } from '../audio';
import { triggerCameraShake } from '../../../hooks/useCameraShake';
import {
  tryFireShelfLaunch,
  getShelfDownstreamSpeed,
  isInsideShelfTrigger,
  type ShelfTrigger,
} from '../../utils/shelfLaunch';
import {
  tickLaunchScoring,
  hasActiveLaunch,
} from '../../../systems/score/LaunchScoringSession';
import { gameEvents } from '../../../systems/events/GameEvents';
import { bodyUserData as userDataOf, type RapierBody, type RapierNamespace, type RapierWorld } from '../../../physics/rapierTypes';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RunnerPhysicsState } from './useRunnerPhysics';

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

export function updateRunnerPhysics({
  delta: dt, world, body, rapier, camera, controls, vehicleState,
  shelfLaunchFiredRef,
  shelfTriggerRef,
}: RunnerPhysicsStepArgs) {
  const {
    vehicle, slopeState, jumpState, ungroundedFramesRef, dodgeState, platformState,
    appliedGravMultRef, sprintLockedRef, jumpForwardDirRef, footstepState,
    prevFrame, collisionState, fovRef, debugState, debugSnapshotRef
  } = vehicleState;

  const noPointerLock = typeof window !== 'undefined' && window.location.search.includes('no-pointer-lock');

    const pos = body.translation();
    const vel = body.linvel();
    // Debug overlay clock: sim ms, so the contact / impulse windows age with the sim.
    if (Number.isFinite(dt) && dt > 0) debugState.current.simMs += dt * 1000;
    vehicle.current.advanceClock(dt);
    const now = debugState.current.simMs;

    const dtOk = Number.isFinite(dt) && dt > 0 && dt < 0.5;
    const posOk = isFiniteVec3(pos);
    const velOk = isFiniteVec3(vel);
    let cameraWarm = isCameraWarm(camera);
    if (!cameraWarm) {
      resetCameraToSpawn(camera, noPointerLock);
      cameraWarm = isCameraWarm(camera);
    }

    if (!Number.isFinite(slopeState.current.currentMultiplier)) {
      slopeState.current.currentMultiplier = 1.0;
    }
    if (!Number.isFinite(slopeState.current.targetMultiplier)) {
      slopeState.current.targetMultiplier = 1.0;
    }

    // Vertical bounds are relative to the segment under the player — the track
    // descends hundreds of metres, so an absolute clip is wrong (segmentFrames.ts).
    const envelope = posOk ? resolveActiveEnvelope(pos) : null;
    const positionBounds = getEffectivePositionBounds(envelope);

    const bodyUserData = userDataOf(body);
    const holdAtSpawn = () => {
      // After an OOB the body is parked on its checkpoint until the terrain ray
      // lands again; without the latch the terrain-warm hold below would yank
      // it to the world-origin spawn in the meantime.
      const latched = bodyUserData.__holdTarget as Vec3 | undefined;
      const respawnPoint =
        latched ??
        (envelope?.respawnAt !== undefined
          ? useGameStore.getState().spawnPoints[envelope.respawnAt]
          : undefined);
      holdBodyAtSpawn(body, respawnPoint);
    };

    // F-8: defer gameplay impulses until body, camera, terrain, and velocity are sane.
    let physicsWarm = false;

    const frameImpulses = new Map<string, { x: number; y: number; z: number }>();
    const applyImpulseWithDebugTracking = (tag: string, impulse: Vec3) => {
      if (!physicsWarm || !isFiniteImpulse(impulse)) return;
      body.applyImpulse(impulse, true);
      const prev = frameImpulses.get(tag);
      if (prev) {
        prev.x += impulse.x;
        prev.y += impulse.y;
        prev.z += impulse.z;
      } else {
        frameImpulses.set(tag, { x: impulse.x, y: impulse.y, z: impulse.z });
      }
    };
    const setLinvelSafe = (nextVel: Vec3) => {
      if (!physicsWarm || !isFiniteVec3(nextVel)) return;
      body.setLinvel(nextVel, true);
    };

    if (!posOk) {
      const snapshot = debugSnapshotRef.current;
      snapshot.position = { x: pos.x, y: pos.y, z: pos.z };
      snapshot.linearVelocity = { x: vel.x, y: vel.y, z: vel.z };
      snapshot.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
      if (typeof window !== 'undefined') {
        window.__watershedPhysicsDebug = snapshot;
      }
      return;
    }

    const speedMag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const velSane = velOk && Number.isFinite(speedMag) && speedMag <= positionBounds.speedMax;
    const posSane = isPositionSane(pos, positionBounds);

    if (!posSane || !velSane) {
      // A finite, in-xz body outside the vertical envelope of a live run is a
      // fall (off the waterfall, into the vortex eye, through the open floor):
      // wipe out and park on the checkpoint, not the world-origin spawn.
      const verticalOob =
        velSane &&
        bodyUserData.__terrainReady === true &&
        isPositionSane(pos, { ...positionBounds, yMin: -Infinity, yMax: Infinity });
      if (verticalOob && envelope) {
        triggerOutOfBoundsWipeout(envelope);
        const game = useGameStore.getState();
        const target = game.spawnPoints[envelope.respawnAt ?? game.respawnSegmentIndex];
        if (target) bodyUserData.__holdTarget = { x: target.x, y: target.y, z: target.z };
      }
      holdAtSpawn();
      bodyUserData.__terrainReady = false;
      try {
        body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        bodyUserData.__bootBodyType = 'kinematic';
      } catch (_e) { /* body type unavailable */ }
      const snapshot = debugSnapshotRef.current;
      const [sx, sy, sz] = PLAYER_SPAWN.position;
      snapshot.position = { x: sx, y: sy, z: sz };
      snapshot.linearVelocity = { x: 0, y: 0, z: 0 };
      snapshot.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
      if (typeof window !== 'undefined') {
        window.__watershedPhysicsDebug = snapshot;
      }
      return;
    }

    // === SLOPE DETECTION ===
    const slopeAngle = calculateSlopeAngle({ body, world, rapier, slopeState });

    const {
      hit: groundHit,
      toi: groundRayDistance,
      hitPoint: groundRayHitPoint,
      rawGrounded,
    } = resolvePlayerGroundRay(world, rapier, body, pos);

    // Terrain is "ready" once there is canyon under the runner — not only within
    // the grounded reach. The meander spawn stands ~6 m over its floor, past the
    // 5 m grounded ray: a variable-dt boot only got there because its first
    // (large) step dropped the body before the hold began, and a fixed-dt
    // scripted boot held it in mid-air forever.
    if (
      isTerrainGroundHit(groundRayDistance) ||
      (!bodyUserData.__terrainReady && hasTerrainBelow(world, rapier, body, pos))
    ) {
      bodyUserData.__terrainReady = true;
      bodyUserData.__holdTarget = undefined;
    }
    const terrainWarm = !!bodyUserData.__terrainReady;
    if (!terrainWarm) {
      holdAtSpawn();
      if (bodyUserData.__bootBodyType !== 'kinematic') {
        body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        bodyUserData.__bootBodyType = 'kinematic';
      }
    } else if (bodyUserData.__bootBodyType === 'kinematic') {
      body.setBodyType(rapier.RigidBodyType.Dynamic, true);
      bodyUserData.__bootBodyType = 'dynamic';
    }

    physicsWarm = dtOk && posOk && velOk && velSane && posSane && cameraWarm && terrainWarm;

    // Hysteresis: require GROUNDED_HYSTERESIS_FRAMES consecutive misses before going airborne.
    // This prevents spurious state changes when the player skims over small rocks/lips.
    const groundedHysteresis = updateUngroundedHysteresis(
      ungroundedFramesRef.current,
      rawGrounded,
    );
    ungroundedFramesRef.current = groundedHysteresis.ungroundedFrames;
    const isGrounded = groundedHysteresis.isGrounded;
    slopeState.current.isGrounded = isGrounded;

    // === SHELF LAUNCH AIR-TIME SCORING (physics-step time) ===
    try {
      const physicsDt =
        typeof world.timestep === 'number' && world.timestep > 0 ? world.timestep : dt;
      tickLaunchScoring({
        physicsDt,
        bodyHandle: body.handle,
        position: pos,
        contactSurface: isGrounded
          ? 'terrain'
          : pos.y < WATER_LEVEL + 0.55
            ? 'water'
            : 'airborne',
        vehicle: 'runner',
      });

      if (
        !hasActiveLaunch() &&
        shelfTriggerRef.current &&
        !isInsideShelfTrigger(pos, shelfTriggerRef.current)
      ) {
        shelfLaunchFiredRef.current = false;
      }
    } catch (_e) {
      // Never let scoring break the physics step.
    }

    // Goal 2: Platform detection via raycast handle registry
    platformState.current.isOnPlatform = false;
    if (rawGrounded && groundHit) {
      try {
        const collider = groundHit.collider;
        const parent = collider?.parent?.();
        if (parent) {
          if (isFloatingPlatform(parent.handle)) {
            platformState.current.isOnPlatform = true;
            const pVel = parent.linvel?.();
            if (pVel) {
              platformState.current.platformVelocity.set(pVel.x, pVel.y, pVel.z);
            }
          }
          parent.free?.();
        }
      } catch {
        // Ignore colliders without parent
      }
      groundHit.free?.();
    }

    if (isGrounded) {
      slopeState.current.currentAngle = slopeAngle;
      // Base pitch multiplier
      let baseMult = calculateSlopeMultiplier(slopeAngle);
      // Bank bonus: steep canyon walls contribute an additional flow/speed boost
      const absBankDeg = Math.abs(slopeState.current.bankAngle);
      if (absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
        const bankT = Math.min(1.0, (absBankDeg - BANK_CONFIG.ASSIST_THRESHOLD) /
                                     (BANK_CONFIG.MAX_BANK_DEG - BANK_CONFIG.ASSIST_THRESHOLD));
        baseMult = Math.min(1.5, baseMult + bankT * BANK_CONFIG.BANK_SPEED_BONUS);
      }
      slopeState.current.targetMultiplier = baseMult;
    } else {
      slopeState.current.targetMultiplier = THREE.MathUtils.lerp(
        slopeState.current.targetMultiplier,
        1.0,
        dt * 2.0
      );
    }

    slopeState.current.currentMultiplier = THREE.MathUtils.lerp(
      slopeState.current.currentMultiplier,
      slopeState.current.targetMultiplier,
      Math.min(1.0, dt * SMOOTHING_FACTOR)
    );

    // === BANK ASSIST (canyon U-wall riding) ===
    // When the player is on a steep lateral bank, apply two forces:
    //  1. A "plant" impulse directed into the bank face (opposite horizontal normal component)
    //     that acts like centripetal force and grows with speed so the player stays planted.
    //  2. Anti-roll torque impulses that damp capsule tumbling around the X and Z world axes.
    const bankAngle = slopeState.current.bankAngle;
    const absBankDeg = Math.abs(bankAngle);
    if (isGrounded && absBankDeg > BANK_CONFIG.ASSIST_THRESHOLD) {
      const bankT = Math.min(1.0, (absBankDeg - BANK_CONFIG.ASSIST_THRESHOLD) /
                                   (BANK_CONFIG.MAX_BANK_DEG - BANK_CONFIG.ASSIST_THRESHOLD));
      const gn = slopeState.current.lastGroundNormal;
      const speed2D = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const speedFactor = 1.0 + speed2D * BANK_CONFIG.SPEED_ASSIST_SCALE;
      const plantMag = BANK_CONFIG.ASSIST_STRENGTH * bankT * speedFactor * dt;
      // Push player into bank face (negate horizontal normal → toward wall surface)
      if (isFiniteVec3(gn)) {
        applyImpulseWithDebugTracking('bankAssist', { x: -gn.x * plantMag, y: 0, z: -gn.z * plantMag });
      }
      // Damp capsule angular velocity on X and Z to prevent tumbling on steep walls
      const angVel = body.angvel();
      const antiRoll = BANK_CONFIG.ANTI_ROLL_STRENGTH * bankT * dt;
      if (physicsWarm && isFiniteVec3(angVel)) {
        body.applyTorqueImpulse({
          x: -angVel.x * antiRoll,
          y: 0,
          z: -angVel.z * antiRoll,
        }, true);
      }
    }

    // === GRAVITY MULTIPLIER (waterfall / steep rapids) ===
    // Apply waterfallGravityMultiplier from Zustand to the Rapier world without
    // subscribing to the store (avoiding a React re-render every frame).
    const gravMultCurrent = useGameStore.getState().waterfallGravityMultiplier;
    if (gravMultCurrent !== appliedGravMultRef.current) {
      appliedGravMultRef.current = gravMultCurrent;
      // Mutate in-place to avoid an unnecessary object allocation
      world.gravity.x = 0;
      world.gravity.y = PHYSICS.GRAVITY * gravMultCurrent;
      world.gravity.z = 0;
    }

    // === WATERFALL LAUNCH-SHELF v2 (segment 14) ===
    // One-shot launch when crossing the authored slab shelf at speed.
    try {
      const launch = tryFireShelfLaunch({
        currentSegmentIndex: useGameStore.getState().currentSegmentIndex,
        position: pos,
        velocity: vel,
        trigger: shelfTriggerRef.current,
        firedRef: shelfLaunchFiredRef,
        speedThreshold: VEHICLE_TUNING.shelfLaunch.speedThreshold,
        vehicleScale: VEHICLE_TUNING.shelfLaunch.runnerScale,
      });
      if (launch) {
        applyImpulseWithDebugTracking('shelfLaunch', launch.impulse);
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

    // === CAMERA FORWARD DIRECTION (used for slope-biased jump and dodge) ===
    const jumpForwardDir = jumpForwardDirRef.current;
    getHorizontalCameraForward(camera, cameraWarm, jumpForwardDir);

    // Pre-compute slope trig used by both grounded and coyote-time jump paths
    const slopeRad = Math.abs(slopeState.current.currentAngle) * DEG_TO_RAD;
    const sinSlope = Math.sin(slopeRad);

    // === JUMP STATE MACHINE ===
    const js = jumpState.current;
    const { jump, leftward, rightward, dodge, sprint, forward, backward } = controls.getControls();
    const jumpJustPressed = jump && !prevFrame.current.jumpPressed;
    const dodgeJustPressed = dodge && !prevFrame.current.dodgePressed;

    // === SPRINT STAMINA (Zustand-backed, no stale closures) ===
    const { isSprinting, movementMul } = tickSprintStamina({
      dt,
      posY: pos.y,
      vel,
      sprint,
      jumpState: js,
      sprintLockedRef,
    });

    tickJumpStateMachine({
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
    });

    handleDodgeAndCollision({
        dodgeState, dodgeJustPressed, isGrounded, camera, leftward, rightward, backward, dt,
        body, pos, vel, prevFrame, vehicle, collisionState, debugState, now,
        applyImpulseWithDebugTracking, rapier, world,
    });
    // === FOOTSTEP AUDIO (F1) ===
    tickFootstepAudio({
      isGrounded,
      jumpState: js.state,
      vel,
      posY: pos.y,
      dt,
      footstepState,
      currentBiome: collisionState.current.currentBiome,
    });

    // Store previous frame state
    prevFrame.current.wasGrounded = isGrounded;
    prevFrame.current.jumpPressed = jump;
    prevFrame.current.dodgePressed = dodge;
    prevFrame.current.velocity.set(vel.x, vel.y, vel.z);

    // === MOVEMENT INPUT ===
    // forward/backward already read above to avoid TDZ in handleDodgeAndCollision.

    const { forwardDir, rightDir } = buildCameraRelativeDirs(camera, cameraWarm);

    // === APPLY FORCES ===
    const flowResponsiveness = VEHICLE_TUNING.flowResponsiveness;
    const flowMultiplier = Number.isFinite(slopeState.current.currentMultiplier)
      ? slopeState.current.currentMultiplier
      : 1.0;

    // Recovery state: reduced turn speed
    const recoveryFactor = js.state === 'recovering'
      ? 0.5  // 50% speed during recovery
      : 1.0;

    applyImpulseWithDebugTracking('flow', { x: 0, y: 0, z: -flowResponsiveness * flowMultiplier * dt });

    const baseSpeed = VEHICLE_TUNING.baseSpeed;
    const sprintMultiplier = isSprinting ? RUNNER_SPRINT.SPEED_MULTIPLIER : 1.0;
    const speed = baseSpeed * flowMultiplier * recoveryFactor * sprintMultiplier * movementMul;

    if (forward) {
      applyImpulseWithDebugTracking('forwardInput', {
        x: forwardDir.x * speed * dt,
        y: 0,
        z: forwardDir.z * speed * dt
      });
    }
    if (backward) {
      applyImpulseWithDebugTracking('backwardInput', {
        x: forwardDir.x * -speed * 0.6 * dt,
        y: 0,
        z: forwardDir.z * -speed * 0.6 * dt
      });
    }

    // Strafe with commit/recovery restrictions
    const canStrafe = computeStrafeEligibility(
      js.state,
      js.commitTimer,
      dodgeState.current.state,
    );

    if (canStrafe) {
      if (leftward) {
        applyImpulseWithDebugTracking('leftwardInput', {
          x: rightDir.x * -speed * 0.8 * dt,
          y: 0,
          z: rightDir.z * -speed * 0.8 * dt
        });
      }
      if (rightward) {
        applyImpulseWithDebugTracking('rightwardInput', {
          x: rightDir.x * speed * 0.8 * dt,
          y: 0,
          z: rightDir.z * speed * 0.8 * dt
        });
      }
    }

    // Goal 2: Helper to set friction on all colliders
    const setBodyFriction = (frictionValue: number) => {
      debugState.current.friction = frictionValue;
      try {
        const n = body.numColliders();
        for (let i = 0; i < n; i++) {
          body.collider(i).setFriction(frictionValue);
        }
      } catch (e) {
        // Fallback: friction not adjustable on this body
      }
    };

    // === SLOPE-AWARE HORIZONTAL SPEED CAP ===
    // Reward momentum on steep downhill terrain while preventing physics explosions.
    // Effective cap = maxHorizontalSpeed * (1 + slopeBonusScale * (flowMultiplier - 1))
    // so steep sections scale the limit proportionally to slopeBonusScale.
    const effectiveMaxH = VEHICLE_TUNING.maxHorizontalSpeed *
      (1 + VEHICLE_TUNING.slopeBonusScale * (flowMultiplier - 1));
    const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (horizSpeed > effectiveMaxH && Number.isFinite(horizSpeed) && horizSpeed > 0) {
      const scale = effectiveMaxH / horizSpeed;
      setLinvelSafe({ x: vel.x * scale, y: vel.y, z: vel.z * scale });
    }

    // Goal 2: Slide mechanic — activate on steep forward pitch OR steep lateral bank
    const isSlideInput = controls.getControls().brake &&
      (slopeAngle > MOVEMENT.SLIDE_MIN_SLOPE ||
       Math.abs(slopeState.current.bankAngle) > MOVEMENT.SLIDE_MIN_SLOPE);
    if (isSlideInput && isGrounded) {
      // Reduce friction during slide for speed boost; on a bank the slide runs along the wall
      setBodyFriction(MOVEMENT.SLIDE_FRICTION);
      const slideBoost = MOVEMENT.SLIDE_SPEED_BOOST;
      applyImpulseWithDebugTracking('slideBoost', {
        x: forwardDir.x * speed * (slideBoost - 1.0) * dt,
        y: 0,
        z: forwardDir.z * speed * (slideBoost - 1.0) * dt
      });
    } else {
      // Restore friction based on current material
      // On steep banks, use lower friction to allow smooth wall-riding
      const baseFriction = vehicle.current.getConfig().friction;
      const absBankForFriction = Math.abs(slopeState.current.bankAngle);
      const friction = absBankForFriction > BANK_CONFIG.ASSIST_THRESHOLD
        ? THREE.MathUtils.lerp(
            baseFriction,
            MOVEMENT.SLIDE_FRICTION * BANK_CONFIG.BANK_FRICTION_MULTIPLIER,
            Math.min(1.0, (absBankForFriction - BANK_CONFIG.ASSIST_THRESHOLD) /
                          (BANK_CONFIG.MAX_BANK_DEG - BANK_CONFIG.ASSIST_THRESHOLD))
          )
        : baseFriction;
      setBodyFriction(friction);
    }

    // Goal 2: Platform riding - apply platform velocity to player
    if (platformState.current.isOnPlatform) {
      const pVel = platformState.current.platformVelocity;
      const transfer = MOVEMENT.PLAYER_MOMENTUM_TRANSFER ?? 0.3;
      applyImpulseWithDebugTracking('platformTransfer', {
        x: (pVel.x - vel.x) * transfer,
        y: (pVel.y - vel.y) * transfer * 0.5, // Less vertical transfer
        z: (pVel.z - vel.z) * transfer
      });
    }

    // === IN-WATER PHYSICS ===
    // Shallow-water running: lower damping, lateral current push.
    const inShallowWater = pos.y < WATER_LEVEL + 1.0;
    if (inShallowWater) {
      try {
        body.setLinearDamping(VEHICLE_TUNING.linearDampingShallowWater);
      } catch (_e) { /* damping setter unavailable */ }
      const w = window as unknown as { __watershedFlowSpeed?: number };
      const segFlow = (typeof window !== 'undefined' && Number.isFinite(w.__watershedFlowSpeed))
        ? (w.__watershedFlowSpeed as number)
        : 1.0;
      const currentPush = 0.3 * segFlow * dt;
      applyImpulseWithDebugTracking('waterCurrent', {
        x: forwardDir.x * currentPush,
        y: 0,
        z: forwardDir.z * currentPush,
      });
    } else {
      try {
        body.setLinearDamping(VEHICLE_TUNING.linearDampingAir);
      } catch (_e) { /* damping setter unavailable */ }
    }

    // Camera follow (first-person, smooth)
    applyRunnerCameraFollow({ camera, pos, posOk, noPointerLock });

    // FOV kick — speed-based expansion + waterfall punch
    updateRunnerFovKick({
      camera,
      vel,
      dt,
      fovRef,
      currentSegmentIndex: useGameStore.getState().currentSegmentIndex,
    });

    frameImpulses.forEach((impulse, tag) => {
      const mag = Math.sqrt(impulse.x * impulse.x + impulse.y * impulse.y + impulse.z * impulse.z);
      if (mag < 0.001) return;
      debugState.current.recentImpulses.push({ tag, at: now, impulse });
    });
    debugState.current.recentImpulses = debugState.current.recentImpulses
      .filter((entry) => now - entry.at <= 2000)
      .slice(-16);
    debugState.current.recentContacts = debugState.current.recentContacts
      .filter((entry) => now - entry.at <= 2500)
      .slice(-8);

    const snapshot = debugSnapshotRef.current;
    snapshot.position = { x: pos.x, y: pos.y, z: pos.z };
    snapshot.linearVelocity = { x: vel.x, y: vel.y, z: vel.z };
    const angVel = body.angvel();
    snapshot.angularVelocity = { x: angVel.x, y: angVel.y, z: angVel.z };
    snapshot.speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    snapshot.slopeAngle = slopeState.current.currentAngle;
    snapshot.bankAngle = slopeState.current.bankAngle;
    snapshot.isGrounded = isGrounded;
    snapshot.jumpState = js.state;
    snapshot.friction = debugState.current.friction;
    snapshot.waterfallGravityMultiplier = gravMultCurrent;
    snapshot.effectiveG = PHYSICS.GRAVITY * gravMultCurrent;
    snapshot.extraGravity = PHYSICS.GRAVITY * (gravMultCurrent - 1);
    snapshot.currentSegmentIndex = useGameStore.getState().currentSegmentIndex;
    snapshot.groundRay = {
      origin: buildGroundRayOrigin(pos),
      hitPoint: groundRayHitPoint,
      distance: groundRayDistance,
    };
    snapshot.groundNormal = {
      x: slopeState.current.lastGroundNormal.x,
      y: slopeState.current.lastGroundNormal.y,
      z: slopeState.current.lastGroundNormal.z,
    };
    snapshot.recentImpulses = debugState.current.recentImpulses;
    snapshot.recentContacts = debugState.current.recentContacts;

    bodyUserData.physicsDebug = snapshot;
    if (typeof window !== 'undefined') {
      window.__watershedPhysicsDebug = snapshot;
    }

}
