import { useRef } from 'react';
import * as THREE from 'three';
import { BuoyancyState, TippingState, PaddleState, StaminaState, StunState, ShedParticle, STAMINA } from '../constants';
import { SurfaceMaterial } from '../../../systems/VehicleSystem';

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
    foamParticles: [],
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
  const shedParticles = useRef<ShedParticle[]>([]);

  const collisionState = useRef({
    currentBiome: 'canyonSummer',
    activeParticles: [] as Array<{
      id: number;
      material: SurfaceMaterial;
      position: THREE.Vector3;
      intensity: number;
    }>,
    prevVelocity: new THREE.Vector3(),
  });

  const sharedPhysicsState = useRef({
    linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
  });

  const lastWorkerSync = useRef(0);

  return {
    buoyancyState, tippingState, paddleState, staminaState, stunState,
    forwardBiasState, shedParticles, collisionState, sharedPhysicsState, lastWorkerSync
  };
}
