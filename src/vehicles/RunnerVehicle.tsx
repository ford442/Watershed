import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { RunnerVehicle as RunnerVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { getAudioManager, AudioManager } from '../systems/AudioSystem';

// Slope detection configuration
const RAYCAST_ORIGIN_OFFSET = 0.5;
const RAYCAST_DISTANCE = 5.0;
const SMOOTHING_FACTOR = 5.0;

// Jump state machine configuration
const JUMP_CONFIG = {
  FORCE: 22,
  DOUBLE_JUMP_FORCE: 18,
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

// Camera shake effect
const triggerCameraShake = (intensity: number, duration: number = 0.3) => {
  window.dispatchEvent(new CustomEvent('camera-shake', {
    detail: { intensity, duration }
  }));
};

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef(null);
  const { camera } = useThree();
  const { world } = useRapier();
  const [, getKeys] = useKeyboardControls();

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
  });
  
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

  useImperativeHandle(forwardedRef, () => bodyRef.current);

  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(0, 5, 0));
      // Set initial material
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.ROCK);
    }
    
    // Listen for biome changes
    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'summer';
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.ROCK;
      vehicle.current.setSurfaceMaterial(material);
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
      const ray = new world.Ray(origin, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, rayLength, true);
      
      if (hit) {
        const hitPoint = ray.pointAt(hit.timeOfImpact);
        return hitPoint.y;
      }
      return null;
    };
    
    const sampleDist = 0.5;
    const hCenter = castRay(0, 0);
    const hForward = castRay(0, -sampleDist);
    const hBack = castRay(0, sampleDist);
    
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

    // === SLOPE DETECTION ===
    const slopeAngle = calculateSlopeAngle();
    
    const groundRay = new world.Ray(
      { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z },
      { x: 0, y: -1, z: 0 }
    );
    const groundHit = world.castRay(groundRay, RAYCAST_DISTANCE, true);
    const isGrounded = !!groundHit;
    slopeState.current.isGrounded = isGrounded;
    
    if (isGrounded) {
      slopeState.current.currentAngle = slopeAngle;
      slopeState.current.targetMultiplier = calculateSlopeMultiplier(slopeAngle);
    } else {
      slopeState.current.targetMultiplier = THREE.MathUtils.lerp(
        slopeState.current.targetMultiplier,
        1.0,
        delta * 2.0
      );
    }

    slopeState.current.currentMultiplier = THREE.MathUtils.lerp(
      slopeState.current.currentMultiplier,
      slopeState.current.targetMultiplier,
      Math.min(1.0, delta * SMOOTHING_FACTOR)
    );

    // === JUMP STATE MACHINE ===
    const js = jumpState.current;
    const { jump, leftward, rightward } = getKeys();
    const jumpJustPressed = jump && !prevFrame.current.jumpPressed;

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
          // Initiate jump
          const jumpForce = JUMP_CONFIG.FORCE * Math.max(0.8, slopeState.current.currentMultiplier);
          body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
          
          js.state = 'airborne';
          js.hasDoubleJumped = false;
          js.airTime = 0;
          js.commitTimer = JUMP_CONFIG.COMMIT_DURATION;
          js.verticalVelocityOnLeave = jumpForce;
          
          // F1: Play jump sound with velocity-scaled pitch
          playJumpSound(Math.sqrt(vel.x * vel.x + vel.z * vel.z));
        }
        break;
      }

      case 'airborne': {
        js.airTime += delta;
        
        // Commit phase - disable strafe
        if (js.commitTimer > 0) {
          js.commitTimer -= delta;
        }

        // Double jump
        if (jumpJustPressed && !js.hasDoubleJumped) {
          const doubleJumpForce = JUMP_CONFIG.DOUBLE_JUMP_FORCE;
          // Cancel some downward velocity for responsive feel
          const newVelY = Math.max(vel.y * 0.3, 0) + doubleJumpForce;
          body.setLinvel({ x: vel.x, y: newVelY, z: vel.z }, true);
          
          js.hasDoubleJumped = true;
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
        js.recoveryTimer -= delta;
        
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

    // === COLLISION DETECTION ===
    // Check for sudden velocity changes indicating collision
    const prevVelocity = prevFrame.current.velocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVelocity.x, vel.y - prevVelocity.y, vel.z - prevVelocity.z);
    const impactForce = velocityDelta.length() / delta;
    
    // Detect high-impact collision
    if (impactForce > 8 && !isGrounded) {
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
        footstepState.current.distanceTraveled += speed * delta;
        
        if (footstepState.current.distanceTraveled - footstepState.current.lastStepDistance >= footstepState.current.stepInterval) {
          footstepState.current.lastStepDistance = footstepState.current.distanceTraveled;
          
          // Determine material and wetness
          const material = collisionState.current.currentBiome.includes('autumn') ? 'moss' : 'rock';
          const isWet = pos.y < waterLevel + 0.5;
          
          playFootstep(material, isWet);
        }
      }
    }

    // Store previous frame state
    prevFrame.current.wasGrounded = isGrounded;
    prevFrame.current.jumpPressed = jump;
    prevFrame.current.velocity.set(vel.x, vel.y, vel.z);

    // === MOVEMENT INPUT ===
    const { forward, backward } = getKeys();

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
      { x: 0, y: 0, z: -flowResponsiveness * flowMultiplier * delta },
      true
    );

    const baseSpeed = 32;
    const speed = baseSpeed * flowMultiplier * recoveryFactor;

    if (forward) {
      body.applyImpulse({
        x: forwardDir.x * speed * delta,
        y: 0,
        z: forwardDir.z * speed * delta
      }, true);
    }
    if (backward) {
      body.applyImpulse({
        x: forwardDir.x * -speed * 0.6 * delta,
        y: 0,
        z: forwardDir.z * -speed * 0.6 * delta
      }, true);
    }

    // Strafe with commit/recovery restrictions
    const inCommitPhase = js.state === 'airborne' && js.commitTimer > 0;
    const canStrafe = !inCommitPhase && js.state !== 'recovering';

    if (canStrafe) {
      if (leftward) {
        body.applyImpulse({
          x: rightDir.x * -speed * 0.8 * delta,
          y: 0,
          z: rightDir.z * -speed * 0.8 * delta
        }, true);
      }
      if (rightward) {
        body.applyImpulse({
          x: rightDir.x * speed * 0.8 * delta,
          y: 0,
          z: rightDir.z * speed * 0.8 * delta
        }, true);
      }
    }

    // Camera follow (first-person, smooth)
    const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
    camera.position.lerp(targetPos, 0.12);
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
        colliders="capsule"
        position={[0, 5, 0]}
        mass={1}
        friction={0.04}
        restitution={0.15}
        linearDamping={0.35}
        angularDamping={0.9}
      />
      
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
