import { useRef, useState } from 'react';
import * as THREE from 'three';
import { BuoyancyState, TippingState, PaddleState, StaminaState, StunState, SHED, STAMINA } from '../constants';
import { ParticlePool } from '../../../components/particlePool';
import { COLLISION_PARTICLE_CAPACITY } from '../../../components/CollisionParticles';

/** Paddle foam: a few per stroke, 1 s each. */
const FOAM_PARTICLE_CAPACITY = 48;

export interface RaftCollisionState {
  currentBiome: string;
  /** Collision bursts, drawn by ParticlePoolMesh in RaftVehicle. */
  particles: ParticlePool;
  prevVelocity: THREE.Vector3;
}

export function useRaftPhysicsState() {
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
    lastSafePosition: new THREE.Vector3(),
  });

  const paddleState = useRef<PaddleState>({
    leftPaddle: false,
    rightPaddle: false,
  });

  const staminaState = useRef<StaminaState>({
    current: STAMINA.MAX,
    regenDelay: 0,
    isExhausted: false,
  });

  const stunState = useRef<StunState>({
    active: false,
    timer: 0,
  });

  const forwardBiasState = useRef(0);
  // Stepped and drawn by ParticlePoolMesh; physics only spawns into them.
  // Lazy useState, not a useRef initialiser: that would build a pool per render.
  const [foamParticles] = useState(() => new ParticlePool(FOAM_PARTICLE_CAPACITY));
  const [shedParticles] = useState(() => new ParticlePool(SHED.COUNT_LIMIT));
  const [collisionParticles] = useState(() => new ParticlePool(COLLISION_PARTICLE_CAPACITY));

  const collisionState = useRef<RaftCollisionState>({
    currentBiome: 'canyonSummer',
    particles: collisionParticles,
    prevVelocity: new THREE.Vector3(),
  });

  return {
    buoyancyState, tippingState, paddleState, staminaState, stunState,
    forwardBiasState, foamParticles, shedParticles, collisionState,
  };
}
