import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { RaftVehicle as RaftVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { getAudioManager, AudioManager } from '../systems/AudioSystem';

// Buoyancy and water physics configuration
const WATER_PHYSICS = {
  LEVEL: 0.5,
  RAFT_HEIGHT: 0.3,
  RAFT_WIDTH: 2,
  RAFT_LENGTH: 3,
  BUOYANCY_MAX_FORCE: 50,
  DRAG_COEFFICIENT: 0.3,
  TURBULENCE_FREQ: 2.0,
  TURBULENCE_AMP: 0.15,
  TIP_THRESHOLD_SPEED: 3,
  TIP_SUBMERGE_THRESHOLD: 0.5,
  TIP_FORCE_MAGNITUDE: 8,
  ROTATION_DAMPING: 0.95,
};

// Tipping mechanics
const TIPPING = {
  RIGHTING_THRESHOLD: 45 * (Math.PI / 180), // 45 degrees in radians
  RIGHTING_TORQUE: 15,
  DANGER_THRESHOLD: 70 * (Math.PI / 180),   // 70 degrees
  DANGER_TIME: 1.0,                          // 1 second
  RESET_HEIGHT: 2,                           // Safe height above water
};

// Paddle input configuration
const PADDLE = {
  THRUST_FORCE: 12,
  TORQUE_FORCE: 8,
  FOAM_PARTICLE_COUNT: 8,
  FOAM_LIFETIME: 0.6,
};

interface BuoyancyState {
  submergedRatio: number;
  buoyancyForce: number;
  isFloating: boolean;
}

interface TippingState {
  rollAngle: number;
  pitchAngle: number;
  dangerTime: number;
  isTipped: boolean;
  lastSafePosition: THREE.Vector3;
}

interface PaddleState {
  leftPaddle: boolean;
  rightPaddle: boolean;
  foamParticles: Array<{
    id: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    life: number;
    side: 'left' | 'right';
  }>;
}

// Custom hook for paddle keys (Q/E)
// Audio manager reference
let audioManager: AudioManager | null = null;

const initAudio = () => {
  if (!audioManager) {
    audioManager = getAudioManager();
  }
};

const playPaddleSound = (side: 'left' | 'right') => {
  initAudio();
  if (!audioManager) return;
  
  const sound = side === 'left' ? 'paddle_left' : 'paddle_right';
  // Slight pitch variation for natural feel
  const pitch = 0.95 + Math.random() * 0.1;
  audioManager.playSound(sound, 0.8, pitch);
};

const playRaftTipSound = () => {
  initAudio();
  if (!audioManager) return;
  
  // Play creaking sound
  audioManager.playSound('raft_creak', 0.7, 1.0);
  // Play water crash
  setTimeout(() => {
    audioManager?.playSound('water_crash', 1.0, 0.9);
  }, 100);
};

const usePaddleKeys = () => {
  const [keys, setKeys] = useState({ q: false, e: false });
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'q') setKeys(k => ({ ...k, q: true }));
      if (e.key.toLowerCase() === 'e') setKeys(k => ({ ...k, e: true }));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'q') setKeys(k => ({ ...k, q: false }));
      if (e.key.toLowerCase() === 'e') setKeys(k => ({ ...k, e: false }));
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  return keys;
};

const RaftVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const { camera, scene } = useThree();
  const { world } = useRapier();
  const [, getKeys] = useKeyboardControls();
  const paddleKeys = usePaddleKeys();
  
  const vehicle = useRef(new RaftVehicleClass());
  
  const buoyancyState = useRef<BuoyancyState>({
    submergedRatio: 0,
    buoyancyForce: 0,
    isFloating: false,
  });
  
  const tippingState = useRef<TippingState>({
    rollAngle: 0,
    pitchAngle: 0,
    dangerTime: 0,
    isTipped: false,
    lastSafePosition: new THREE.Vector3(0, 2, 0),
  });
  
  const paddleState = useRef<PaddleState>({
    leftPaddle: false,
    rightPaddle: false,
    foamParticles: [],
  });
  
  const timeRef = useRef(0);
  const nextParticleId = useRef(0);
  
  // Collision & material state
  const collisionState = useRef({
    currentBiome: 'summer' as string,
    activeParticles: [] as Array<{
      id: number;
      material: SurfaceMaterial;
      position: THREE.Vector3;
      intensity: number;
    }>,
    prevVelocity: new THREE.Vector3(),
  });
  
  useImperativeHandle(forwardedRef, () => bodyRef.current);
  
  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(0, 5, 0));
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.WATER);
      bodyRef.current.applyImpulse({ x: 0, y: 2, z: 0 }, true);
      tippingState.current.lastSafePosition.copy(bodyRef.current.translation());
    }
    
    // Listen for biome changes
    const handleBiomeChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const biome = customEvent.detail?.biome || 'summer';
      collisionState.current.currentBiome = biome;
      const material = MATERIAL_FROM_BIOME[biome] || SurfaceMaterial.WATER;
      vehicle.current.setSurfaceMaterial(material);
    };
    
    window.addEventListener('biome-change', handleBiomeChange);
    return () => window.removeEventListener('biome-change', handleBiomeChange);
  }, []);
  
  const calculateSubmergedRatio = (raftY: number): number => {
    const waterLevel = WATER_PHYSICS.LEVEL;
    const raftHalfHeight = WATER_PHYSICS.RAFT_HEIGHT / 2;
    const raftBottom = raftY - raftHalfHeight;
    const raftTop = raftY + raftHalfHeight;
    
    if (raftBottom >= waterLevel) return 0;
    if (raftTop <= waterLevel) return 1;
    
    const submergedHeight = waterLevel - raftBottom;
    return Math.max(0, Math.min(1, submergedHeight / WATER_PHYSICS.RAFT_HEIGHT));
  };
  
  const applyBuoyancy = (body: any, submergedRatio: number, delta: number) => {
    if (submergedRatio <= 0) return;
    
    const maxBuoyancy = WATER_PHYSICS.BUOYANCY_MAX_FORCE;
    const buoyancyForce = maxBuoyancy * submergedRatio;
    
    body.applyImpulse({
      x: 0,
      y: buoyancyForce * delta,
      z: 0
    }, true);
    
    buoyancyState.current.buoyancyForce = buoyancyForce;
    buoyancyState.current.isFloating = submergedRatio > 0.1;
  };
  
  const applyDrag = (body: any, delta: number) => {
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    
    if (speed < 0.1) return;
    
    const dragMagnitude = WATER_PHYSICS.DRAG_COEFFICIENT * speed * speed;
    const dragX = -(vel.x / speed) * dragMagnitude * delta;
    const dragZ = -(vel.z / speed) * dragMagnitude * delta;
    
    body.applyImpulse({ x: dragX, y: 0, z: dragZ }, true);
  };
  
  const applyTurbulence = (body: any, time: number, delta: number) => {
    if (!buoyancyState.current.isFloating) return;
    
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const speedFactor = Math.min(1, speed / 5);
    const amp = WATER_PHYSICS.TURBULENCE_AMP * speedFactor;
    
    const pitchWobble = Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ) * amp +
                       Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ * 1.7) * amp * 0.3;
    const rollWobble = Math.cos(time * WATER_PHYSICS.TURBULENCE_FREQ * 1.3) * amp * 0.8 +
                      Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ * 2.1) * amp * 0.2;
    
    const currentRot = body.rotation();
    const euler = new THREE.Euler().setFromQuaternion(currentRot);
    euler.x += pitchWobble * delta * 2;
    euler.z += rollWobble * delta * 2;
    
    const targetRot = new THREE.Quaternion().setFromEuler(euler);
    body.setRotation(targetRot, true);
  };
  
  const applyTippingForce = (body: any, submergedRatio: number, delta: number) => {
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    
    if (speed < WATER_PHYSICS.TIP_THRESHOLD_SPEED || submergedRatio < WATER_PHYSICS.TIP_SUBMERGE_THRESHOLD) {
      return;
    }
    
    const tipMagnitude = WATER_PHYSICS.TIP_FORCE_MAGNITUDE * 
                        ((speed - WATER_PHYSICS.TIP_THRESHOLD_SPEED) / 5);
    
    body.applyTorqueImpulse({
      x: vel.z * tipMagnitude * delta * 0.1,
      y: 0,
      z: -vel.x * tipMagnitude * delta * 0.15
    }, true);
  };
  
  const dampenRotation = (body: any, delta: number) => {
    const angVel = body.angvel();
    const damping = Math.pow(WATER_PHYSICS.ROTATION_DAMPING, delta * 60);
    
    body.setAngvel({
      x: angVel.x * damping,
      y: angVel.y * damping,
      z: angVel.z * damping
    }, true);
  };
  
  /**
   * Handle tipping mechanics - righting torque and danger detection
   */
  const handleTipping = (body: any, delta: number): boolean => {
    const rot = body.rotation();
    const euler = new THREE.Euler().setFromQuaternion(rot);
    
    tippingState.current.rollAngle = euler.z;
    tippingState.current.pitchAngle = euler.x;
    
    const absRoll = Math.abs(euler.z);
    const absPitch = Math.abs(euler.x);
    const maxTilt = Math.max(absRoll, absPitch);
    
    // Righting torque at 45°
    if (maxTilt > TIPPING.RIGHTING_THRESHOLD) {
      const rightingDirection = -Math.sign(euler.z);
      const rightingStrength = (maxTilt - TIPPING.RIGHTING_THRESHOLD) / (Math.PI / 2);
      
      body.applyTorqueImpulse({
        x: 0,
        y: 0,
        z: rightingDirection * TIPPING.RIGHTING_TORQUE * rightingStrength * delta
      }, true);
    }
    
    // Danger zone at 70°
    if (maxTilt > TIPPING.DANGER_THRESHOLD) {
      tippingState.current.dangerTime += delta;
      
      if (tippingState.current.dangerTime > TIPPING.DANGER_TIME) {
        // TIPPED! Reset to safe position
        tippingState.current.isTipped = true;
        return true;
      }
    } else {
      tippingState.current.dangerTime = Math.max(0, tippingState.current.dangerTime - delta * 2);
      
      // Update last safe position when stable
      if (maxTilt < TIPPING.RIGHTING_THRESHOLD * 0.5) {
        tippingState.current.lastSafePosition.copy(body.translation());
      }
    }
    
    return false;
  };
  
  /**
   * Apply paddle forces based on Q/E input
   */
  const applyPaddleForces = (body: any, delta: number) => {
    const { q: leftPaddle, e: rightPaddle } = paddleKeys;
    const { forward } = getKeys();
    
    paddleState.current.leftPaddle = leftPaddle;
    paddleState.current.rightPaddle = rightPaddle;
    
    const rot = body.rotation();
    const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);
    
    // Both paddles or W key = straight forward
    if ((leftPaddle && rightPaddle) || forward) {
      body.applyImpulse({
        x: forwardDir.x * PADDLE.THRUST_FORCE * delta,
        y: 0,
        z: forwardDir.z * PADDLE.THRUST_FORCE * delta
      }, true);
      
      // Spawn foam on both sides
      if (forward && Math.random() > 0.7) {
        spawnFoamParticle(body, 'left');
        spawnFoamParticle(body, 'right');
      }
      return;
    }
    
    // Left paddle (Q) - thrust right, rotate left
    if (leftPaddle) {
      // Forward thrust
      body.applyImpulse({
        x: forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * delta,
        y: 0,
        z: forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * delta
      }, true);
      
      // Lateral thrust to the right
      body.applyImpulse({
        x: rightDir.x * PADDLE.THRUST_FORCE * 0.5 * delta,
        y: 0,
        z: rightDir.z * PADDLE.THRUST_FORCE * 0.5 * delta
      }, true);
      
      // Torque to rotate left
      body.applyTorqueImpulse({
        x: 0,
        y: -PADDLE.TORQUE_FORCE * delta,
        z: 0
      }, true);
      
      // Spawn foam and play sound
      if (Math.random() > 0.6) {
        spawnFoamParticle(body, 'left');
        // F1: Play paddle sound
        playPaddleSound('left');
      }
    }
    
    // Right paddle (E) - thrust left, rotate right
    if (rightPaddle) {
      // Forward thrust
      body.applyImpulse({
        x: forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * delta,
        y: 0,
        z: forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * delta
      }, true);
      
      // Lateral thrust to the left
      body.applyImpulse({
        x: -rightDir.x * PADDLE.THRUST_FORCE * 0.5 * delta,
        y: 0,
        z: -rightDir.z * PADDLE.THRUST_FORCE * 0.5 * delta
      }, true);
      
      // Torque to rotate right
      body.applyTorqueImpulse({
        x: 0,
        y: PADDLE.TORQUE_FORCE * delta,
        z: 0
      }, true);
      
      // Spawn foam and play sound
      if (Math.random() > 0.6) {
        spawnFoamParticle(body, 'right');
        // F1: Play paddle sound
        playPaddleSound('right');
      }
    }
  };
  
  /**
   * Spawn a foam particle for paddle visual feedback
   */
  const spawnFoamParticle = (body: any, side: 'left' | 'right') => {
    const pos = body.translation();
    const rot = body.rotation();
    
    const offset = new THREE.Vector3(
      side === 'left' ? -1.2 : 1.2,
      -0.2,
      side === 'left' ? 0.5 : -0.5
    ).applyQuaternion(rot);
    
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      Math.random() * 0.3,
      (Math.random() - 0.5) * 0.5
    );
    
    paddleState.current.foamParticles.push({
      id: nextParticleId.current++,
      position: new THREE.Vector3(pos.x + offset.x, pos.y + offset.y, pos.z + offset.z),
      velocity,
      life: PADDLE.FOAM_LIFETIME,
      side,
    });
  };
  
  /**
   * Reset raft to safe position after tipping
   */
  const resetRaft = (body: any) => {
    // F1: Play tip sound when raft capsizes
    playRaftTipSound();
    
    const safePos = tippingState.current.lastSafePosition.clone();
    safePos.y = Math.max(safePos.y, WATER_PHYSICS.LEVEL + TIPPING.RESET_HEIGHT);
    
    body.setTranslation(safePos, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)), true);
    
    tippingState.current.dangerTime = 0;
    tippingState.current.isTipped = false;
    
    // Dispatch event for UI feedback
    window.dispatchEvent(new CustomEvent('raft-tipped', {
      detail: { resetPosition: safePos }
    }));
  };
  
  useFrame((state, delta) => {
    if (!bodyRef.current || !world) return;
    
    const body = bodyRef.current;
    const pos = body.translation();
    
    // Check if tipped and needs reset
    if (tippingState.current.isTipped) {
      resetRaft(body);
      return;
    }
    
    timeRef.current += delta;
    
    // Calculate submersion
    const submergedRatio = calculateSubmergedRatio(pos.y);
    buoyancyState.current.submergedRatio = submergedRatio;
    
    // Apply water physics
    applyBuoyancy(body, submergedRatio, delta);
    
    if (submergedRatio > 0) {
      applyDrag(body, delta);
    }
    
    applyTurbulence(body, timeRef.current, delta);
    applyTippingForce(body, submergedRatio, delta);
    dampenRotation(body, delta);
    
    // Handle tipping mechanics
    const tipped = handleTipping(body, delta);
    if (tipped) {
      resetRaft(body);
      return;
    }
    
    // Apply paddle forces (overrides WASD for raft)
    applyPaddleForces(body, delta);
    
    // Fallback WASD (strafing) if no paddle input
    const { leftward, rightward } = getKeys();
    const { q: leftPaddle, e: rightPaddle } = paddleKeys;
    
    if (!leftPaddle && !rightPaddle && !getKeys().forward) {
      // Small strafe for fine adjustment
      if (leftward || rightward) {
        vehicle.current.setInput({
          moveX: rightward ? 1 : leftward ? -1 : 0,
        });
        vehicle.current.update(delta);
      }
    }
    
    // Camera follow
    const targetPos = new THREE.Vector3(pos.x, pos.y + 2.5, pos.z + 5);
    camera.position.lerp(targetPos, 0.1);
    camera.lookAt(pos.x, pos.y, pos.z);
    
    // Update foam particles
    paddleState.current.foamParticles = paddleState.current.foamParticles
      .map(p => ({
        ...p,
        position: p.position.clone().add(p.velocity.clone().multiplyScalar(delta)),
        life: p.life - delta,
      }))
      .filter(p => p.life > 0);
    
    // === COLLISION DETECTION ===
    const vel = body.linvel();
    const prevVel = collisionState.current.prevVelocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
    const impactForce = velocityDelta.length() / delta;
    
    // Detect collision with terrain (when not mostly submerged)
    if (impactForce > 6 && submergedRatio < 0.8) {
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = new THREE.Vector3(pos.x, pos.y - WATER_PHYSICS.RAFT_HEIGHT/2, pos.z);
      
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
    
    collisionState.current.prevVelocity.set(vel.x, vel.y, vel.z);
  });
  
  return (
    <group>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        mass={5}
        restitution={0.3}
        linearDamping={2.5}
        angularDamping={3}
        position={[0, 5, 0]}
      >
        {/* Raft deck */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[WATER_PHYSICS.RAFT_WIDTH, WATER_PHYSICS.RAFT_HEIGHT, WATER_PHYSICS.RAFT_LENGTH]} />
          <meshStandardMaterial color="saddlebrown" />
        </mesh>
        
        {/* Paddle indicators */}
        {paddleState.current.leftPaddle && (
          <mesh position={[-1.3, 0.2, 0.5]}>
            <sphereGeometry args={[0.15]} />
            <meshBasicMaterial color="white" transparent opacity={0.8} />
          </mesh>
        )}
        {paddleState.current.rightPaddle && (
          <mesh position={[1.3, 0.2, -0.5]}>
            <sphereGeometry args={[0.15]} />
            <meshBasicMaterial color="white" transparent opacity={0.8} />
          </mesh>
        )}
      </RigidBody>
      
      {/* Foam particles */}
      {paddleState.current.foamParticles.map(particle => (
        <mesh
          key={particle.id}
          position={[particle.position.x, particle.position.y, particle.position.z]}
        >
          <sphereGeometry args={[0.08 + particle.life * 0.05]} />
          <meshBasicMaterial 
            color="white" 
            transparent 
            opacity={particle.life / PADDLE.FOAM_LIFETIME * 0.7}
          />
        </mesh>
      ))}
      
      {/* Collision particle effects */}
      {collisionState.current.activeParticles.map(particle => (
        <CollisionParticles
          key={particle.id}
          material={particle.material}
          position={particle.position}
          intensity={particle.intensity}
          onComplete={() => {
            collisionState.current.activeParticles = collisionState.current.activeParticles.filter(p => p.id !== particle.id);
          }}
        />
      ))}
    </group>
  );
});

export default RaftVehicle;
