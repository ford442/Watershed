import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { usePlayerControls } from '../hooks/usePlayerControls';
import * as THREE from 'three';
import { RunnerVehicle as RunnerVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { getAudioManager, AudioManager } from '../systems/AudioSystem';
import { WATER_LEVEL, PLAYER_SPAWN, MOVEMENT } from '../constants/game';
import { isFloatingPlatform } from '../systems/FloatingObjectRegistry';
import { useGameStore } from '../systems/GameState';

// Slope detection configuration
const RAYCAST_ORIGIN_OFFSET = 0.5;
const RAYCAST_DISTANCE = 5.0;
const SMOOTHING_FACTOR = 5.0;

// Jump state machine configuration
const JUMP_CONFIG = {
  FORCE: 44.9,
  DOUBLE_JUMP_FORCE: 36.7,
  COMMIT_DURATION: 0.1,      // 0.1s strafe disable on jump
  RECOVERY_DURATION: 0.3,    // 0.3s recovery after landing
  HIGH_IMPACT_THRESHOLD: 5,  // units/s vertical velocity for camera shake
  GROUND_CHECK_DIST: 1.5,
};

// Acceleration multipliers based on slope angle
const SLOPE_RANGES = {
  FLAT: { max: 15, multiplier: 1.0 },
  GENTLE_DOWNSLOPE: { min: 15, max: 45, minMult: 1.0, maxMult: 1.5 },
  STEEP_DOWNSLOPE: { min: 45, max: 90, multiplier: 1.5 },
  UPSLOPE: { min: -45, max: 0, minMult: 0.6, maxMult: 0.8 },
  STEEP_UPSLOPE: { min: -90, max: -45, multiplier: 0.6 },
};

// Jump states
type JumpState = 'grounded' | 'airborne' | 'landing' | 'recovering';

// Dodge states
type DodgeState = 'ready' | 'dodging' | 'cooldown';

// Audio manager reference
let audioManager: AudioManager | null = null;

// Initialize audio on first interaction
const initAudio = () => {
  if (!audioManager) {
    // Will be initialized by Experience component
    audioManager = getAudioManager();
  }
};

// Sound helpers
const playJumpSound = (velocity: number, isDouble: boolean = false) => {
  initAudio();
  if (!audioManager) return;
  
  // Pitch scales with velocity: 0.8-1.2x
  const pitch = 0.8 + Math.min(0.4, velocity / 50);
  const sound = isDouble ? 'double_jump' : 'jump';
  audioManager.playSound(sound, 1.0, pitch);
};

const playLandSound = (impactForce: number) => {
  initAudio();
  if (!audioManager) return;
  
  // Volume scales with force, select sound based on intensity
  let sound = 'land_soft';
  let volume = 0.5;
  
  if (impactForce > 10) {
    sound = 'land_impact';
    volume = Math.min(1.0, impactForce / 15);
  } else if (impactForce > 5) {
    sound = 'land_hard';
    volume = 0.7;
  }
  
  audioManager.playSound(sound, volume, 1.0);
};

const playFootstep = (material: string, isWet: boolean) => {
  initAudio();
  if (!audioManager) return;
  
  const sound = AudioManager.getFootstepSound(material, isWet);
  // Muffled if wet (lower pitch), crisper if dry
  const pitch = isWet ? 0.85 : 1.0;
  const volume = isWet ? 0.6 : 0.5;
  
  audioManager.playSound(sound, volume, pitch);
};

const playDodgeSound = () => {
  initAudio();
  if (!audioManager) return;
  audioManager.playSound('dodge', 0.8, 1.0);
};

// Camera shake effect
const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  window.dispatchEvent(new CustomEvent('camera-shake', {
    detail: { intensity, duration }
  }));
};

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const controls = usePlayerControls(camera);

  const vehicle = useRef(new RunnerVehicleClass());
  
  // Slope detection state
  const slopeState = useRef({
    currentAngle: 0,
    targetMultiplier: 1.0,
    currentMultiplier: 1.0,
    lastGroundNormal: new THREE.Vector3(0, 1, 0),
    isGrounded: false,
  });

  // Jump state machine
  const jumpState = useRef({
    state: 'grounded' as JumpState,
    hasDoubleJumped: false,
    airTime: 0,
    commitTimer: 0,
    recoveryTimer: 0,
    lastGroundY: 0,
    verticalVelocityOnLeave: 0,
    // Goal 2: Coyote time
    timeSinceGrounded: 0,
    // Goal 2: Variable jump height
    jumpReleased: true,
  });
  
  // Goal 2: Dodge state machine
  const dodgeState = useRef({
    state: 'ready' as DodgeState,
    timer: 0,
    direction: new THREE.Vector3(1, 0, 0),
  });
  
  // Goal 2: Platform riding state
  const platformState = useRef({
    isOnPlatform: false,
    platformVelocity: new THREE.Vector3(0, 0, 0),
    platformBody: null as any,
  });

  // Track last applied gravity multiplier to avoid redundant world.gravity mutations
  const appliedGravMultRef = useRef(1.0);

  // Footstep tracking
  const footstepState = useRef({
    distanceTraveled: 0,
    lastStepDistance: 0,
    stepInterval: 2.5, // Units between steps
  });

  // Previous frame state for transition detection
  const prevFrame = useRef({
    wasGrounded: true,
    jumpPressed: false,
    dodgePressed: false,
    velocity: new THREE.Vector3(),
  });

  // Collision & material state
  const collisionState = useRef({
    currentBiome: 'summer' as string,
    activeParticles: [] as Array<{
      id: number;
      material: SurfaceMaterial;
      position: THREE.Vector3;
      intensity: number;
    }>,
  });

  // Goal 2: Collision groups for i-frames
  const defaultCollisionGroups = useRef(0);

  useImperativeHandle(forwardedRef, () => bodyRef.current);

  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      // Set initial material
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.ROCK);
      // Store default collision groups for i-frame toggling
      defaultCollisionGroups.current = bodyRef.current.collisionGroups?.() ?? 0;
    }
    
    // Listen for biome changes
    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'summer';
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.ROCK;
      vehicle.current.setSurfaceMaterial(material);
      
      // Goal 2: Apply material friction to rigid body
      if (bodyRef.current) {
        const friction = vehicle.current.getConfig().friction;
        // We'll override friction dynamically in useFrame based on material
      }
    };
    
    window.addEventListener('biome-change', handleBiomeChange);
    return () => window.removeEventListener('biome-change', handleBiomeChange);
  }, []);

  const calculateSlopeAngle = (): number => {
    if (!bodyRef.current || !world) return 0;
    
    const pos = bodyRef.current.translation();
    const rayLength = RAYCAST_DISTANCE;
    
    const castRay = (offsetX: number, offsetZ: number): number | null => {
      const origin = {
        x: pos.x + offsetX,
        y: pos.y + RAYCAST_ORIGIN_OFFSET,
        z: pos.z + offsetZ
      };
      const ray = new rapier.Ray(origin, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, rayLength, true);
      const toi = hit ? (typeof (hit as any).timeOfImpact === 'function' ? (hit as any).timeOfImpact() : hit.timeOfImpact) : null;
      if (hit && typeof (hit as any).free === 'function') (hit as any).free();
      if (typeof (ray as any).free === 'function') (ray as any).free();
      if (toi === null) return null;
      return origin.y - toi;
    };
    
    const sampleDist = 0.5;
    const hCenter = castRay(0, 0);
    const hForward = castRay(0, -sampleDist);
    const hBack = castRay(0, sampleDist);
    // Also sample lateral direction for full 3D surface normal (banked canyon walls)
    const hLeft = castRay(-sampleDist, 0);
    const hRight = castRay(sampleDist, 0);
    
    if (hCenter === null) return 0;
    
    let slopeZ = 0;
    let samples = 0;
    
    if (hForward !== null) {
      slopeZ += (hForward - hCenter) / sampleDist;
      samples++;
    }
    if (hBack !== null) {
      slopeZ += (hCenter - hBack) / sampleDist;
      samples++;
    }
    
    if (samples === 0) return 0;
    
    slopeZ /= samples;

    // Compute lateral (X-axis) slope for full surface normal
    let slopeX = 0;
    let samplesX = 0;
    if (hLeft !== null) { slopeX += (hLeft - hCenter) / sampleDist; samplesX++; }
    if (hRight !== null) { slopeX += (hCenter - hRight) / sampleDist; samplesX++; }
    if (samplesX > 0) slopeX /= samplesX;

    // Compute and store the full 3D surface normal from height gradients:
    // For height field h(x,z), the outward normal ∝ (-∂h/∂x, 1, -∂h/∂z)
    const nx = -slopeX;
    const ny = 1.0;
    const nz = -slopeZ;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen > 0.001) {
      slopeState.current.lastGroundNormal.set(nx / nLen, ny / nLen, nz / nLen);
    }

    const angleRad = Math.atan(slopeZ);
    let angleDeg = (angleRad * 180) / Math.PI;
    angleDeg = Math.max(-60, Math.min(60, angleDeg));
    
    return angleDeg;
  };

  const calculateSlopeMultiplier = (angle: number): number => {
    if (Math.abs(angle) <= SLOPE_RANGES.FLAT.max) {
      return SLOPE_RANGES.FLAT.multiplier;
    }
    
    if (angle > SLOPE_RANGES.FLAT.max && angle <= SLOPE_RANGES.GENTLE_DOWNSLOPE.max) {
      const t = (angle - SLOPE_RANGES.GENTLE_DOWNSLOPE.min) / 
                (SLOPE_RANGES.GENTLE_DOWNSLOPE.max - SLOPE_RANGES.GENTLE_DOWNSLOPE.min);
      return THREE.MathUtils.lerp(
        SLOPE_RANGES.GENTLE_DOWNSLOPE.minMult,
        SLOPE_RANGES.GENTLE_DOWNSLOPE.maxMult,
        t
      );
    }
    
    if (angle > SLOPE_RANGES.GENTLE_DOWNSLOPE.max) {
      return SLOPE_RANGES.STEEP_DOWNSLOPE.multiplier;
    }
    
    if (angle < 0 && angle >= SLOPE_RANGES.UPSLOPE.min) {
      const t = Math.abs(angle) / Math.abs(SLOPE_RANGES.UPSLOPE.min);
      return THREE.MathUtils.lerp(
        SLOPE_RANGES.UPSLOPE.maxMult,
        SLOPE_RANGES.UPSLOPE.minMult,
        t
      );
    }
    
    if (angle < SLOPE_RANGES.UPSLOPE.min) {
      return SLOPE_RANGES.STEEP_UPSLOPE.multiplier;
    }
    
    return 1.0;
  };

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body || !world) return;

    const pos = body.translation();
    const vel = body.linvel();
    const dt = Math.min(delta, 0.05); // Cap delta for stability

    // === SLOPE DETECTION ===
    const slopeAngle = calculateSlopeAngle();
    
    const groundRay = new rapier.Ray(
      { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z },
      { x: 0, y: -1, z: 0 }
    );
    const groundHit = world.castRay(groundRay, RAYCAST_DISTANCE, true);
    if (typeof (groundRay as any).free === 'function') (groundRay as any).free();
    const isGrounded = !!groundHit;
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
      slopeState.current.targetMultiplier = calculateSlopeMultiplier(slopeAngle);
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

    // === GRAVITY MULTIPLIER (waterfall / steep rapids) ===
    // Apply waterfallGravityMultiplier from Zustand to the Rapier world without
    // subscribing to the store (avoiding a React re-render every frame).
    const gravMult = useGameStore.getState().waterfallGravityMultiplier;
    if (gravMult !== appliedGravMultRef.current) {
      appliedGravMultRef.current = gravMult;
      world.gravity = { x: 0, y: -9.8 * gravMult, z: 0 };
    }

    // === CAMERA FORWARD DIRECTION (used for slope-biased jump and dodge) ===
    const jumpForwardDir = new THREE.Vector3();
    camera.getWorldDirection(jumpForwardDir);
    jumpForwardDir.y = 0;
    if (jumpForwardDir.lengthSq() > 0.001) jumpForwardDir.normalize();

    // === JUMP STATE MACHINE ===
    const js = jumpState.current;
    const { jump, leftward, rightward, dodge, sprint } = controls.getControls();
    const jumpJustPressed = jump && !prevFrame.current.jumpPressed;
    const dodgeJustPressed = dodge && !prevFrame.current.dodgePressed;

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
          // Add a forward component proportional to slope steepness (sin of angle)
          const slopeRad = Math.abs(slopeState.current.currentAngle) * Math.PI / 180;
          const forwardBias = jumpForce * Math.sin(slopeRad) * 0.45;
          body.applyImpulse({
            x: jumpForwardDir.x * forwardBias,
            y: jumpForce,
            z: jumpForwardDir.z * forwardBias
          }, true);
          
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
          const slopeRad = Math.abs(slopeState.current.currentAngle) * Math.PI / 180;
          const forwardBias = jumpForce * Math.sin(slopeRad) * 0.45;
          body.applyImpulse({
            x: jumpForwardDir.x * forwardBias,
            y: jumpForce,
            z: jumpForwardDir.z * forwardBias
          }, true);
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

    // === DODGE STATE MACHINE (Goal 2) ===
    const ds = dodgeState.current;
    switch (ds.state) {
      case 'ready': {
        if (dodgeJustPressed && isGrounded) {
          ds.state = 'dodging';
          ds.timer = MOVEMENT.DODGE_DURATION;
          
          // Determine dodge direction from input
          const forwardDir = new THREE.Vector3();
          camera.getWorldDirection(forwardDir);
          forwardDir.y = 0;
          forwardDir.normalize();
          const rightDir = new THREE.Vector3();
          rightDir.crossVectors(forwardDir, camera.up).normalize();
          
          ds.direction.set(0, 0, 0);
          if (leftward) {
            ds.direction.sub(rightDir);
          } else if (rightward) {
            ds.direction.add(rightDir);
          } else if (controls.getControls().backward) {
            ds.direction.sub(forwardDir);
          } else {
            ds.direction.add(forwardDir);
          }
          if (ds.direction.lengthSq() < 0.001) {
            ds.direction.copy(rightDir); // Default dodge right
          }
          ds.direction.normalize();
          
          // Apply dodge impulse
          body.applyImpulse({
            x: ds.direction.x * MOVEMENT.DODGE_FORCE,
            y: 2.0, // Slight upward lift
            z: ds.direction.z * MOVEMENT.DODGE_FORCE
          }, true);
          
          // I-frames: temporarily disable collision with obstacles (not ground)
          // We achieve this by applying a collision group mask if supported
          try {
            // Rapier doesn't have simple collision group toggling on RigidBody ref,
            // so we use a flag that other systems can check
            body.userData = { ...body.userData, isDodging: true };
          } catch (e) { /* ignore */ }
          
          playDodgeSound();
          triggerCameraShake(0.3, 0.15);
          
          // Broadcast dodge state for HUD
          window.dispatchEvent(new CustomEvent('player-dodge', { detail: { state: 'start' } }));
          useGameStore.getState().setIsDodging(true);
        }
        break;
      }
      
      case 'dodging': {
        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'cooldown';
          ds.timer = MOVEMENT.DODGE_COOLDOWN;
          try {
            body.userData = { ...body.userData, isDodging: false };
          } catch (e) { /* ignore */ }
          window.dispatchEvent(new CustomEvent('player-dodge', { detail: { state: 'end' } }));
          useGameStore.getState().setIsDodging(false);
        }
        break;
      }
      
      case 'cooldown': {
        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'ready';
        }
        break;
      }
    }

    // === COLLISION DETECTION ===
    // Check for sudden velocity changes indicating collision
    const prevVelocity = prevFrame.current.velocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVelocity.x, vel.y - prevVelocity.y, vel.z - prevVelocity.z);
    const impactForce = velocityDelta.length() / dt;
    
    // Detect high-impact collision (skip if dodging with i-frames)
    const isDodging = ds.state === 'dodging' && ds.timer > (MOVEMENT.DODGE_DURATION - MOVEMENT.DODGE_I_FRAMES);
    if (impactForce > 8 && !isGrounded && !isDodging) {
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = new THREE.Vector3(pos.x, pos.y - 0.5, pos.z);
      
      vehicle.current.processCollision(
        material,
        impactForce,
        contactPoint,
        new THREE.Vector3(vel.x, vel.y, vel.z)
      );
      
      // Add visual particles for high impact
      if (impactForce > vehicle.current['highImpactThreshold']) {
        const newParticle = {
          id: Date.now(),
          material,
          position: contactPoint.clone(),
          intensity: Math.min(1, impactForce / 20),
        };
        collisionState.current.activeParticles.push(newParticle);
      }
    }

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
    const { forward, backward } = controls.getControls();

    // Camera-relative direction
    const forwardDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();

    const rightDir = new THREE.Vector3();
    rightDir.crossVectors(forwardDir, camera.up).normalize();

    // === APPLY FORCES ===
    const flowResponsiveness = 14;
    const flowMultiplier = slopeState.current.currentMultiplier;
    
    // Recovery state: reduced turn speed
    const recoveryFactor = js.state === 'recovering' 
      ? 0.5  // 50% speed during recovery
      : 1.0;

    body.applyImpulse(
      { x: 0, y: 0, z: -flowResponsiveness * flowMultiplier * dt },
      true
    );

    const baseSpeed = 32;
    const speed = baseSpeed * flowMultiplier * recoveryFactor;

    if (forward) {
      body.applyImpulse({
        x: forwardDir.x * speed * dt,
        y: 0,
        z: forwardDir.z * speed * dt
      }, true);
    }
    if (backward) {
      body.applyImpulse({
        x: forwardDir.x * -speed * 0.6 * dt,
        y: 0,
        z: forwardDir.z * -speed * 0.6 * dt
      }, true);
    }

    // Strafe with commit/recovery restrictions
    const inCommitPhase = js.state === 'airborne' && js.commitTimer > 0;
    const canStrafe = !inCommitPhase && js.state !== 'recovering' && ds.state !== 'dodging';

    if (canStrafe) {
      if (leftward) {
        body.applyImpulse({
          x: rightDir.x * -speed * 0.8 * dt,
          y: 0,
          z: rightDir.z * -speed * 0.8 * dt
        }, true);
      }
      if (rightward) {
        body.applyImpulse({
          x: rightDir.x * speed * 0.8 * dt,
          y: 0,
          z: rightDir.z * speed * 0.8 * dt
        }, true);
      }
    }

    // Goal 2: Helper to set friction on all colliders
    const setBodyFriction = (frictionValue: number) => {
      try {
        const n = body.numColliders();
        for (let i = 0; i < n; i++) {
          body.collider(i).setFriction(frictionValue);
        }
      } catch (e) {
        // Fallback: friction not adjustable on this body
      }
    };

    // Goal 2: Slide mechanic
    const isSlideInput = controls.getControls().brake && slopeAngle > MOVEMENT.SLIDE_MIN_SLOPE;
    if (isSlideInput && isGrounded) {
      // Reduce friction during slide for speed boost
      setBodyFriction(MOVEMENT.SLIDE_FRICTION);
      const slideBoost = MOVEMENT.SLIDE_SPEED_BOOST;
      body.applyImpulse({
        x: forwardDir.x * speed * (slideBoost - 1.0) * dt,
        y: 0,
        z: forwardDir.z * speed * (slideBoost - 1.0) * dt
      }, true);
    } else {
      // Restore friction based on current material
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const friction = vehicle.current.getConfig().friction;
      setBodyFriction(friction);
    }

    // Goal 2: Platform riding - apply platform velocity to player
    if (platformState.current.isOnPlatform && platformState.current.platformBody) {
      const pVel = platformState.current.platformVelocity;
      const transfer = MOVEMENT.PLAYER_MOMENTUM_TRANSFER ?? 0.3;
      body.applyImpulse({
        x: (pVel.x - vel.x) * transfer,
        y: (pVel.y - vel.y) * transfer * 0.5, // Less vertical transfer
        z: (pVel.z - vel.z) * transfer
      }, true);
    }

    // === IN-WATER PHYSICS ===
    // Shallow-water running: lower damping, lateral current push.
    const inShallowWater = pos.y < WATER_LEVEL + 1.0;
    if (inShallowWater) {
      try {
        body.setLinearDamping(0.35 * 0.85);
      } catch (_e) { /* damping setter unavailable */ }
      const w = window as unknown as { __watershedFlowSpeed?: number };
      const segFlow = (typeof window !== 'undefined' && Number.isFinite(w.__watershedFlowSpeed))
        ? (w.__watershedFlowSpeed as number)
        : 1.0;
      const currentPush = 0.3 * segFlow * dt;
      body.applyImpulse({
        x: forwardDir.x * currentPush,
        y: 0,
        z: forwardDir.z * currentPush,
      }, true);
    } else {
      try {
        body.setLinearDamping(0.35);
      } catch (_e) { /* damping setter unavailable */ }
    }

    // Camera follow (first-person, smooth)
    // Guard against NaN from Rapier during physics init — lerping NaN permanently corrupts camera matrix
    if (isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z)) {
      const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
      camera.position.lerp(targetPos, 0.12);
    }
  });

  // Remove completed particles
  const removeParticle = (id: number) => {
    collisionState.current.activeParticles = collisionState.current.activeParticles.filter(p => p.id !== id);
  };

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={PLAYER_SPAWN.position}
        mass={75}
        friction={0.04}
        restitution={0.15}
        linearDamping={0.35}
        angularDamping={0.9}
      >
        <CapsuleCollider args={[0.4, 0.5]} />
      </RigidBody>
      
      {/* Collision particle effects */}
      {collisionState.current.activeParticles.map(particle => (
        <CollisionParticles
          key={particle.id}
          material={particle.material}
          position={particle.position}
          intensity={particle.intensity}
          onComplete={() => removeParticle(particle.id)}
        />
      ))}
    </>
  );
});

export default RunnerVehicle;
