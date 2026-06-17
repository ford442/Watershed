import { handleDodgeAndCollision, calculateSlopeAngle, calculateSlopeMultiplier } from './RunnerPhysicsHelpers';
import * as THREE from 'three';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/VehicleSystem';
import { WATER_LEVEL, PLAYER_SPAWN, MOVEMENT, PHYSICS } from '../../../constants/game';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { isFloatingPlatform } from '../../../systems/FloatingObjectRegistry';
import { useGameStore } from '../../../systems/GameState';
import {
    RAYCAST_ORIGIN_OFFSET, RAYCAST_DISTANCE, SMOOTHING_FACTOR, DEG_TO_RAD,
    JUMP_CONFIG, SLOPE_RANGES, BANK_CONFIG, NEAR_MISS_SPEED_THRESHOLD, NEAR_MISS_RAY_LENGTH, NEAR_MISS_TOI_MIN, NEAR_MISS_TOI_MAX, RUNNER_SPRINT
} from '../constants';
import { playJumpSound, playLandSound, playFootstep, playDodgeSound } from '../audio';
import { triggerCameraShake } from '../utils';

export function updateRunnerPhysics({
  state, delta: dt, world, body, rapier, camera, controls, vehicleState
}) {
  const {
    vehicle, slopeState, jumpState, ungroundedFramesRef, dodgeState, platformState,
    appliedGravMultRef, sprintLockedRef, jumpForwardDirRef, footstepState,
    prevFrame, collisionState, defaultCollisionGroups, fovRef, debugState, debugSnapshotRef
  } = vehicleState;

  const noPointerLock = typeof window !== 'undefined' && window.location.search.includes('no-pointer-lock');

    const pos = body.translation();
    const vel = body.linvel();
    // dt is passed in
    const now = performance.now();
    const frameImpulses = new Map<string, { x: number; y: number; z: number }>();
    const applyImpulseWithDebugTracking = (tag: string, impulse: { x: number; y: number; z: number }) => {
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

    // === SLOPE DETECTION ===
    const slopeAngle = calculateSlopeAngle({ body, world, rapier, slopeState });

    const groundRay = new rapier.Ray(
      { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z },
      { x: 0, y: -1, z: 0 }
    );
    const groundHit = world.castRay(groundRay, RAYCAST_DISTANCE, true);
    const groundRayDistance = groundHit
      ? (typeof (groundHit as any).timeOfImpact === 'function'
          ? (groundHit as any).timeOfImpact()
          : groundHit.timeOfImpact)
      : null;
    const groundRayHitPoint = groundRayDistance !== null
      ? {
          x: pos.x,
          y: pos.y + RAYCAST_ORIGIN_OFFSET - groundRayDistance,
          z: pos.z,
        }
      : null;
    if (typeof (groundRay as any).free === 'function') (groundRay as any).free();

    // Hysteresis: require GROUNDED_HYSTERESIS_FRAMES consecutive misses before going airborne.
    // This prevents spurious state changes when the player skims over small rocks/lips.
    const rawGrounded = !!groundHit;
    if (rawGrounded) {
      ungroundedFramesRef.current = 0;
    } else {
      // Cap at threshold so the counter doesn't grow unbounded while airborne
      ungroundedFramesRef.current = Math.min(
        ungroundedFramesRef.current + 1,
        JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES
      );
    }
    const isGrounded = rawGrounded || ungroundedFramesRef.current < JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES;
    slopeState.current.isGrounded = isGrounded;

    // Goal 2: Platform detection via raycast handle registry
    platformState.current.isOnPlatform = false;
    platformState.current.platformBody = null;
    if (groundHit) {
      try {
        const collider = groundHit.collider;
        const parent = collider?.parent?.();
        if (parent) {
          if (isFloatingPlatform(parent.handle)) {
            platformState.current.isOnPlatform = true;
            platformState.current.platformBody = true; // used only as boolean at line 709
            const pVel = parent.linvel();
            platformState.current.platformVelocity.set(pVel.x, pVel.y, pVel.z);
          }
          if (typeof (parent as any).free === 'function') (parent as any).free();
        }
      } catch {
        // Ignore colliders without parent
      }
      if (typeof (groundHit as any).free === 'function') (groundHit as any).free();
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
      applyImpulseWithDebugTracking('bankAssist', { x: -gn.x * plantMag, y: 0, z: -gn.z * plantMag });
      // Damp capsule angular velocity on X and Z to prevent tumbling on steep walls
      const angVel = body.angvel();
      const antiRoll = BANK_CONFIG.ANTI_ROLL_STRENGTH * bankT * dt;
      body.applyTorqueImpulse({
        x: -angVel.x * antiRoll,
        y: 0,
        z: -angVel.z * antiRoll,
      }, true);
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

    // === CAMERA FORWARD DIRECTION (used for slope-biased jump and dodge) ===
    const jumpForwardDir = jumpForwardDirRef.current;
    camera.getWorldDirection(jumpForwardDir);
    jumpForwardDir.y = 0;
    if (jumpForwardDir.lengthSq() > 0.001) jumpForwardDir.normalize();

    // Pre-compute slope trig used by both grounded and coyote-time jump paths
    const slopeRad = Math.abs(slopeState.current.currentAngle) * DEG_TO_RAD;
    const sinSlope = Math.sin(slopeRad);

    // === JUMP STATE MACHINE ===
    const js = jumpState.current;
    const { jump, leftward, rightward, dodge, sprint, forward, backward } = controls.getControls();
    const jumpJustPressed = jump && !prevFrame.current.jumpPressed;
    const dodgeJustPressed = dodge && !prevFrame.current.dodgePressed;

    // === SPRINT STAMINA (Zustand-backed, no stale closures) ===
    // Read via getState() to avoid stale closure; never use the hook form in useFrame.
    const storeState = useGameStore.getState();
    let stamina = storeState.sprintStamina;

    // Hysteresis: once exhausted, lock sprint until RECOVERY_THRESHOLD is reached
    if (stamina <= RUNNER_SPRINT.EXHAUSTION_THRESHOLD) {
      sprintLockedRef.current = true;
    } else if (sprintLockedRef.current && stamina >= RUNNER_SPRINT.RECOVERY_THRESHOLD) {
      sprintLockedRef.current = false;
    }

    // Airborne sprint intent is ignored — no drain, faster recovery instead
    const isAirborne = js.state === 'airborne';
    const isSprinting = sprint && !sprintLockedRef.current && !isAirborne;

    if (isSprinting) {
      // Drain while grounded and sprinting
      stamina = Math.max(0, stamina - RUNNER_SPRINT.DRAIN_RATE * dt);
    } else if (isAirborne) {
      // Faster recovery while airborne
      stamina = Math.min(1, stamina + RUNNER_SPRINT.REGEN_AIRBORNE * dt);
    } else {
      // Normal grounded recovery when not sprinting
      stamina = Math.min(1, stamina + RUNNER_SPRINT.REGEN_GROUNDED * dt);
    }
    storeState.setSprintStamina(stamina);

    // Goal 2: Update coyote time
    if (isGrounded) {
      js.timeSinceGrounded = 0;
    } else {
      js.timeSinceGrounded += dt;
    }

    // State transitions
    switch (js.state) {
      case 'grounded': {
        if (!isGrounded) {
          // Left ground - became airborne
          js.state = 'airborne';
          js.hasDoubleJumped = false;
          js.airTime = 0;
          js.verticalVelocityOnLeave = vel.y;
          js.lastGroundY = pos.y;
        } else if (jumpJustPressed) {
          // Initiate jump with forward slope bias so downhill jumps carry momentum
          const jumpForce = JUMP_CONFIG.FORCE * Math.max(0.8, slopeState.current.currentMultiplier);
          // Add a forward component proportional to slope steepness
          const forwardBias = jumpForce * sinSlope * JUMP_CONFIG.SLOPE_FORWARD_BIAS;
          // On steep banks, blend a kick-off component along the surface normal's XZ plane
          // so the player bounces away from the wall rather than straight up.
          const gn = slopeState.current.lastGroundNormal;
          const bankBlend = Math.min(0.5, Math.abs(slopeState.current.bankAngle) / BANK_CONFIG.KICKOFF_MAX_BANK_DEG);
          applyImpulseWithDebugTracking('jump', {
            x: jumpForwardDir.x * forwardBias + gn.x * jumpForce * bankBlend,
            y: jumpForce,
            z: jumpForwardDir.z * forwardBias + gn.z * jumpForce * bankBlend,
          });

          js.state = 'airborne';
          js.hasDoubleJumped = false;
          js.airTime = 0;
          js.commitTimer = JUMP_CONFIG.COMMIT_DURATION;
          js.verticalVelocityOnLeave = jumpForce;
          js.jumpReleased = false;

          // F1: Play jump sound with velocity-scaled pitch
          playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
        }
        break;
      }

      case 'airborne': {
        js.airTime += dt;

        // Commit phase - disable strafe
        if (js.commitTimer > 0) {
          js.commitTimer -= dt;
        }

        // Goal 2: Variable jump height - early release cuts upward velocity
        if (!jump && !js.jumpReleased && vel.y > 0) {
          js.jumpReleased = true;
          body.setLinvel({
            x: vel.x,
            y: vel.y * MOVEMENT.JUMP_CUT_MULTIPLIER,
            z: vel.z
          }, true);
        }

        // Goal 2: Coyote time jump - if we just left ground, still allow jump
        if (jumpJustPressed && js.timeSinceGrounded <= MOVEMENT.COYOTE_TIME && js.airTime < 0.15 && !js.hasDoubleJumped) {
          const jumpForce = JUMP_CONFIG.FORCE * 0.9;
          const forwardBias = jumpForce * sinSlope * JUMP_CONFIG.SLOPE_FORWARD_BIAS;
          // Apply same bank kick-off bias as regular jump
          const gn = slopeState.current.lastGroundNormal;
          const bankBlend = Math.min(0.5, Math.abs(slopeState.current.bankAngle) / BANK_CONFIG.KICKOFF_MAX_BANK_DEG);
          applyImpulseWithDebugTracking('coyoteJump', {
            x: jumpForwardDir.x * forwardBias + gn.x * jumpForce * bankBlend,
            y: jumpForce,
            z: jumpForwardDir.z * forwardBias + gn.z * jumpForce * bankBlend,
          });
          js.hasDoubleJumped = false;
          js.commitTimer = JUMP_CONFIG.COMMIT_DURATION;
          js.jumpReleased = false;
          playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
          // Remain airborne but reset timers
          js.airTime = 0;
          js.timeSinceGrounded = 999;
        }

        // Double jump
        if (jumpJustPressed && !js.hasDoubleJumped && js.airTime > 0.05) {
          const doubleJumpForce = JUMP_CONFIG.DOUBLE_JUMP_FORCE;
          // Cancel some downward velocity for responsive feel
          const newVelY = Math.max(vel.y * 0.3, 0) + doubleJumpForce;
          body.setLinvel({ x: vel.x, y: newVelY, z: vel.z }, true);

          js.hasDoubleJumped = true;
          js.jumpReleased = false;
          // F1: Play double jump sound
          playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z), true);
        }

        // Landing detection
        if (isGrounded && js.airTime > 0.05) {
          js.state = 'landing';

          // Calculate impact velocity
          const impactVel = Math.abs(vel.y);

          // F1: Play landing sound scaled by impact force
          playLandSound(impactVel);

          // High impact landing check
          if (impactVel > JUMP_CONFIG.HIGH_IMPACT_THRESHOLD) {
            const shakeIntensity = Math.min(1.0, (impactVel - JUMP_CONFIG.HIGH_IMPACT_THRESHOLD) / 10);
            triggerCameraShake(shakeIntensity);
          }
        }
        break;
      }

      case 'landing': {
        // Immediate transition to recovery
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


    handleDodgeAndCollision({
        dodgeState, dodgeJustPressed, isGrounded, camera, leftward, rightward, forward, backward, dt,
        body, pos, vel, prevFrame, js, vehicle, collisionState, debugState, now
    });
    // === FOOTSTEP AUDIO (F1) ===
    if (isGrounded && js.state === 'grounded') {
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (speed > 0.5) {
        footstepState.current.distanceTraveled += speed * dt;

        if (footstepState.current.distanceTraveled - footstepState.current.lastStepDistance >= footstepState.current.stepInterval) {
          footstepState.current.lastStepDistance = footstepState.current.distanceTraveled;

          // Determine material and wetness
          const material = collisionState.current.currentBiome.includes('autumn') ? 'moss' : 'rock';
          const isWet = pos.y < WATER_LEVEL + 1.0;

          playFootstep(material, isWet);
        }
      }
    }

    // Store previous frame state
    prevFrame.current.wasGrounded = isGrounded;
    prevFrame.current.jumpPressed = jump;
    prevFrame.current.dodgePressed = dodge;
    prevFrame.current.velocity.set(vel.x, vel.y, vel.z);

    // === MOVEMENT INPUT ===
    // forward/backward already read above to avoid TDZ in handleDodgeAndCollision.

    // Camera-relative direction
    const forwardDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();

    const rightDir = new THREE.Vector3();
    rightDir.crossVectors(forwardDir, camera.up).normalize();

    // === APPLY FORCES ===
    const flowResponsiveness = VEHICLE_TUNING.flowResponsiveness;
    const flowMultiplier = slopeState.current.currentMultiplier;

    // Recovery state: reduced turn speed
    const recoveryFactor = js.state === 'recovering'
      ? 0.5  // 50% speed during recovery
      : 1.0;

    applyImpulseWithDebugTracking('flow', { x: 0, y: 0, z: -flowResponsiveness * flowMultiplier * dt });

    const baseSpeed = VEHICLE_TUNING.baseSpeed;
    const sprintMultiplier = isSprinting ? RUNNER_SPRINT.SPEED_MULTIPLIER : 1.0;
    const speed = baseSpeed * flowMultiplier * recoveryFactor * sprintMultiplier;

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
    const inCommitPhase = js.state === 'airborne' && js.commitTimer > 0;
    const canStrafe = !inCommitPhase && js.state !== 'recovering' && dodgeState.current.state !== 'dodging';

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
    if (horizSpeed > effectiveMaxH) {
      const scale = effectiveMaxH / horizSpeed;
      body.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
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
    if (platformState.current.isOnPlatform && platformState.current.platformBody) {
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
    // Guard against NaN from Rapier during physics init — lerping NaN permanently corrupts camera matrix
    if (isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z)) {
      // If a previous frame or external system left the camera position malformed,
      // snap it back to the body before any lerp/set so we don't propagate NaN/null.
      const camPos = camera.position;
      if (!Number.isFinite(camPos.x) || !Number.isFinite(camPos.y) || !Number.isFinite(camPos.z)) {
        camPos.set(pos.x, pos.y + 1.65, pos.z);
      }

      if (noPointerLock) {
        // Headless/screenshot mode: straight top-down view so the generated river/canyon is visible
        // even when PointerLockControls is unavailable.
        camera.position.set(pos.x, pos.y + 40, pos.z);
        camera.lookAt(pos.x, pos.y, pos.z);
      } else {
        const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
        camera.position.lerp(targetPos, 0.12);
      }

      // Final safety: if lerp somehow produced non-finite values, reset to body.
      if (!Number.isFinite(camera.position.x) || !Number.isFinite(camera.position.y) || !Number.isFinite(camera.position.z)) {
        camera.position.set(pos.x, pos.y + 1.65, pos.z);
      }
    }

    // FOV kick — speed-based expansion + waterfall punch
    {
      const segIdx = useGameStore.getState().currentSegmentIndex;
      const isWaterfallSeg = segIdx === 14 || segIdx === 29;
      // Horizontal speed only — vertical drops shouldn't affect FOV alone
      const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const targetFov = 75 + Math.min(12, hSpeed * 0.45) + (isWaterfallSeg ? 10 : 0);
      fovRef.current += (targetFov - fovRef.current) * (1 - Math.exp(-dt * 5));
      if (Math.abs(camera.fov - fovRef.current) > 0.05) {
        camera.fov = fovRef.current;
        camera.updateProjectionMatrix();
      }
    }

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

    const gravMult = useGameStore.getState().waterfallGravityMultiplier;
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
      origin: { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z },
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

    const bodyUserData = (body.userData ??= {});
    bodyUserData.physicsDebug = snapshot;
    if (typeof window !== 'undefined') {
      (window as any).__watershedPhysicsDebug = snapshot;
    }

}
