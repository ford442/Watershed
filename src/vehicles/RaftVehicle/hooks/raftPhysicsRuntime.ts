import * as THREE from 'three';
import { calculateFlowForce, applyWaterForce } from '../../../physics/WaterForces';
import { WATER_DENSITY } from '../../../constants/game';
import { VEHICLE_TUNING } from '../../../constants/vehicleTuning';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/VehicleSystem';
import { useGameStore } from '../../../systems/GameState';
import {
  WATER_PHYSICS, DENSITY, TIPPING, PADDLE, STAMINA, BRAKE, COLLISION, BIAS, CAMERA, SHED,
} from '../constants';
import { playPaddleSound, playSplashSound, playCollisionSound, updateWaterRushingSound, playRaftTipSound } from '../audio';
import { triggerCameraShake } from '../../RunnerVehicle/utils';
import {
  tryFireShelfLaunch,
  getShelfDownstreamSpeed,
  isInsideShelfTrigger,
} from '../../utils/shelfLaunch';
import {
  // Shelf launch air-time scoring (physics-step time)
  tickLaunchScoring,
  hasActiveLaunch,
} from '../../../systems/LaunchScoringSession';

export interface RaftPhysicsRuntimeDeps {
  buoyancyState: { current: any };
  tippingState: { current: any };
  paddleState: { current: any };
  staminaState: { current: any };
  stunState: { current: any };
  forwardBiasTimer: { current: number };
  raftMaterialRef: { current: THREE.MeshStandardMaterial | null };
  raftBaseColor: { current: THREE.Color };
  shedParticles: { current: any[] };
  nextShedId: { current: number };
  shedTimer: { current: number };
  timeRef: { current: number };
  nextParticleId: { current: number };
  collisionState: { current: any };
  raftVehicle: { current: any };
  controls: { getControls: () => any };
  camera: THREE.Camera;
  workerProxyRef: { current: any };
  workerReadyRef: { current: boolean };
  workerStepPendingRef: { current: boolean };
  useWorkerPhysics: boolean;
  applyWorkerImpulse: (impulse: THREE.Vector3) => void;
  stepWorkerProxy: (body: any, delta: number) => void;
  currentFov: { current: number };
  shelfLaunchFiredRef: { current: boolean };
  shelfTriggerRef: { current: any };
}

export function createRaftPhysicsRuntime(deps: RaftPhysicsRuntimeDeps) {
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

/** Apply scientifically accurate buoyancy force */
const applyBuoyancy = (body: any, submergedRatio: number, delta: number) => {
  if (submergedRatio <= 0) return;

  const displacedVolume = WATER_PHYSICS.RAFT_VOLUME * submergedRatio;
  const maxBuoyancy = WATER_PHYSICS.BUOYANCY_MAX_FORCE;
  const buoyancyForce = maxBuoyancy * submergedRatio;

  body.applyImpulse({
    x: 0,
    y: buoyancyForce * delta,
    z: 0
  }, true);

  deps.buoyancyState.current.buoyancyForce = buoyancyForce;
  deps.buoyancyState.current.isFloating = submergedRatio > 0.1;
};

/** Apply scientifically accurate water drag */
const applyDrag = (body: any, delta: number) => {
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  if (speed < 0.1) return;

  const dragMagnitude = WATER_PHYSICS.DRAG_COEFFICIENT * speed * speed * WATER_DENSITY / 1000;
  const dragX = -(vel.x / speed) * dragMagnitude * delta;
  const dragZ = -(vel.z / speed) * dragMagnitude * delta;

  body.applyImpulse({ x: dragX, y: 0, z: dragZ }, true);
};

/** Goal 2: Apply flow-map-based water current force */
const applyFlowForce = (body: any, delta: number) => {
  const pos = body.translation();
  const flowForce = calculateFlowForce(
    new THREE.Vector3(pos.x, pos.y, pos.z),
    null, // No CPU flow map yet; downstream default is used
    { flowSpeed: 1.2, maxForce: 8, turbulence: 0.1, turbulenceFreq: 2.0 },
    deps.timeRef.current
  );
  applyWaterForce(body, flowForce, delta, true);
};

const applyTurbulence = (body: any, time: number, delta: number) => {
  if (!deps.buoyancyState.current.isFloating) return;

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

  deps.tippingState.current.rollAngle = euler.z;
  deps.tippingState.current.pitchAngle = euler.x;

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
    deps.tippingState.current.dangerTime += delta;

    if (deps.tippingState.current.dangerTime > TIPPING.DANGER_TIME) {
      deps.tippingState.current.isTipped = true;
      return true;
    }
  } else {
    deps.tippingState.current.dangerTime = Math.max(0, deps.tippingState.current.dangerTime - delta * 2);

    // Update last safe position when stable
    if (maxTilt < TIPPING.RIGHTING_THRESHOLD * 0.5) {
      deps.tippingState.current.lastSafePosition.copy(body.translation());
    }
  }

  return false;
};

/**
 * Update stamina state each frame (regen, exhaustion tracking)
 */
const updateStamina = (delta: number) => {
  const st = deps.staminaState.current;

  // Regen delay countdown
  if (st.regenDelay > 0) {
    st.regenDelay -= delta;
    return;
  }

  // Regenerate stamina
  if (st.current < STAMINA.MAX) {
    st.current = Math.min(STAMINA.MAX, st.current + STAMINA.REGEN_RATE * delta);
  }

  // Clear exhaustion when recovered enough
  if (st.isExhausted && st.current > STAMINA.EXHAUSTED_THRESHOLD * STAMINA.EXHAUSTED_RECOVERY_MULTIPLIER) {
    st.isExhausted = false;
  }
};

/**
 * Consume stamina for a paddle stroke; returns effective power multiplier (0-1)
 */
const consumeStamina = (): number => {
  const st = deps.staminaState.current;

  if (st.isExhausted || st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
    return 0;
  }

  st.current = Math.max(0, st.current - STAMINA.COST);
  st.regenDelay = STAMINA.REGEN_DELAY;

  if (st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
  }

  // Power scales with remaining stamina (power curve makes it forgiving)
  const ratio = st.current / STAMINA.MAX;
  return Math.pow(ratio, STAMINA.POWER_CURVE);
};

/**
 * Apply brake forces (broadside drag) when S/backward is held
 */
const applyBrake = (body: any, delta: number) => {
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (speed < 0.1) return;

  // Extra linear drag
  const brakeDrag = BRAKE.DRAG_MULTIPLIER * speed * delta;
  body.applyImpulse({
    x: -(vel.x / speed) * brakeDrag,
    y: 0,
    z: -(vel.z / speed) * brakeDrag,
  }, true);

  // Extra angular damping (stabilizes rotation while braking)
  const angVel = body.angvel();
  body.setAngvel({
    x: angVel.x * Math.max(0, 1 - BRAKE.ANGULAR_DRAG * delta),
    y: angVel.y * Math.max(0, 1 - BRAKE.ANGULAR_DRAG * delta),
    z: angVel.z * Math.max(0, 1 - BRAKE.ANGULAR_DRAG * delta),
  }, true);
};

/**
 * Apply paddle forces based on Q/E input with stamina-gated power
 */
const applyPaddleForces = (body: any, delta: number) => {
  const { paddleLeft, paddleRight, forward } = deps.controls.getControls();

  deps.paddleState.current.leftPaddle = paddleLeft;
  deps.paddleState.current.rightPaddle = paddleRight;

  // If stunned, reduce input effectiveness
  const stunMultiplier = deps.stunState.current.active ? COLLISION.STUN_EFFECTIVENESS : 1.0;

  const rot = body.rotation();
  const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
  const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);

  // Both paddles or W key = straight forward
  if ((paddleLeft && paddleRight) || forward) {
    const power = consumeStamina() * stunMultiplier;
    if (power <= 0) return;

    body.applyImpulse({
      x: forwardDir.x * PADDLE.THRUST_FORCE * power * delta,
      y: 0,
      z: forwardDir.z * PADDLE.THRUST_FORCE * power * delta
    }, true);

    // Arm forward bias to retain momentum after this stroke
    deps.forwardBiasTimer.current = BIAS.DURATION;

    // Spawn foam on both sides
    if (Math.random() > 0.7) {
      spawnFoamParticle(body, 'left');
      spawnFoamParticle(body, 'right');
    }
    return;
  }

  // Left paddle (Q) - apply force at left attachment point, rotate left
  if (paddleLeft) {
    const power = consumeStamina() * stunMultiplier;
    if (power <= 0) return;

    // Forward thrust component
    body.applyImpulse({
      x: forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * power * delta,
      y: 0,
      z: forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * power * delta
    }, true);

    // Lateral push from paddle attachment point
    body.applyImpulse({
      x: rightDir.x * PADDLE.THRUST_FORCE * 0.5 * power * delta,
      y: 0,
      z: rightDir.z * PADDLE.THRUST_FORCE * 0.5 * power * delta
    }, true);

    // Torque for rotation (paddle acts as lever)
    body.applyTorqueImpulse({
      x: 0,
      y: -PADDLE.TORQUE_FORCE * power * delta,
      z: 0
    }, true);

    if (Math.random() > 0.6) {
      spawnFoamParticle(body, 'left');
      playPaddleSound('left');
    }
    deps.forwardBiasTimer.current = BIAS.DURATION;
  }

  // Right paddle (E) - apply force at right attachment point, rotate right
  if (paddleRight) {
    const power = consumeStamina() * stunMultiplier;
    if (power <= 0) return;

    body.applyImpulse({
      x: forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * power * delta,
      y: 0,
      z: forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * power * delta
    }, true);

    body.applyImpulse({
      x: -rightDir.x * PADDLE.THRUST_FORCE * 0.5 * power * delta,
      y: 0,
      z: -rightDir.z * PADDLE.THRUST_FORCE * 0.5 * power * delta
    }, true);

    body.applyTorqueImpulse({
      x: 0,
      y: PADDLE.TORQUE_FORCE * power * delta,
      z: 0
    }, true);

    if (Math.random() > 0.6) {
      spawnFoamParticle(body, 'right');
      playPaddleSound('right');
    }
    deps.forwardBiasTimer.current = BIAS.DURATION;
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

  deps.paddleState.current.foamParticles.push({
    id: deps.nextParticleId.current++,
    position: new THREE.Vector3(pos.x + offset.x, pos.y + offset.y, pos.z + offset.z),
    velocity,
    life: PADDLE.FOAM_LIFETIME,
    side,
  });
};

/**
 * Goal 2: Spawn a water-shedding particle trailing the raft
 * Particle size and spread scale with current speed for velocity-reactive VFX
 */
const spawnShedParticle = (body: any) => {
  const pos = body.translation();
  const rot = body.rotation();
  const bodyVel = body.linvel();
  const speed = Math.sqrt(bodyVel.x * bodyVel.x + bodyVel.z * bodyVel.z);
  const speedFactor = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));

  // Spawn at the stern (raft moves -Z, so stern is +Z relative to raft)
  const sternOffset = new THREE.Vector3(0, -0.1, 1.6).applyQuaternion(rot);
  // Wider spread at higher speeds
  const spread = new THREE.Vector3(
    (Math.random() - 0.5) * (0.8 + speedFactor * 0.6),
    Math.random() * 0.2,
    (Math.random() - 0.5) * (0.4 + speedFactor * 0.3)
  );

  // Velocity opposes raft motion + slight upward arc, stronger at speed
  const vel = new THREE.Vector3(
    (Math.random() - 0.5) * (0.6 + speedFactor * 0.8),
    0.3 + Math.random() * (0.4 + speedFactor * 0.4),
    0.5 + Math.random() * (0.5 + speedFactor * 0.5)
  ).applyQuaternion(rot);

  const particleSize = SHED.SIZE_BASE + speedFactor * SHED.SIZE_SPEED_SCALE + Math.random() * 0.03;

  deps.shedParticles.current.push({
    id: deps.nextShedId.current++,
    position: new THREE.Vector3(pos.x + sternOffset.x, pos.y + sternOffset.y, pos.z + sternOffset.z).add(spread),
    velocity: vel,
    life: SHED.LIFETIME,
    scale: particleSize,
  });

  // Trim excess particles
  if (deps.shedParticles.current.length > SHED.COUNT_LIMIT) {
    deps.shedParticles.current.shift();
  }
};

/**
 * Spawn a burst of shed particles at a wall contact point.
 * Gives the "shedding water on hard impact" feel without a full particle system.
 */
const spawnContactBurst = (body: any, contactPoint: THREE.Vector3, impactForce: number) => {
  const forceFactor = Math.min(1, impactForce / COLLISION.IMPACT_FORCE_SCALE);
  const count = Math.floor(COLLISION.CONTACT_BURST_COUNT * forceFactor) + 4;
  const rot = body.rotation();

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.0 * forceFactor;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      0.8 + Math.random() * 2.0 * forceFactor,
      Math.sin(angle) * speed
    );
    deps.shedParticles.current.push({
      id: deps.nextShedId.current++,
      position: contactPoint.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4)),
      velocity: vel,
      life: SHED.LIFETIME * (0.6 + Math.random() * 0.6),
      scale: SHED.SIZE_BASE * 1.5 + Math.random() * 0.06 * forceFactor,
    });
  }

  // Trim if over limit
  if (deps.shedParticles.current.length > SHED.COUNT_LIMIT) {
    deps.shedParticles.current.splice(0, deps.shedParticles.current.length - SHED.COUNT_LIMIT);
  }
};

/**
 * Reset raft to safe position after tipping
 */
const resetRaft = (body: any) => {
  playRaftTipSound();

  const safePos = deps.tippingState.current.lastSafePosition.clone();
  safePos.y = Math.max(safePos.y, WATER_PHYSICS.LEVEL + TIPPING.RESET_HEIGHT);

  body.setTranslation(safePos, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)), true);

  deps.tippingState.current.dangerTime = 0;
  deps.tippingState.current.isTipped = false;

  window.dispatchEvent(new CustomEvent('raft-tipped', {
    detail: { resetPosition: safePos }
  }));
};

const updateCameraFromBody = (body: any) => {
  const pos = body.translation();
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  const velLagX = -vel.x * CAMERA.VELOCITY_LAG;
  const velLagZ = -vel.z * CAMERA.VELOCITY_LAG;
  const angVel = body.angvel();
  const leanOffset = -angVel.y * CAMERA.LEAN_FACTOR;

  const targetPos = new THREE.Vector3(
    pos.x + velLagX + leanOffset,
    pos.y + CAMERA.BASE_OFFSET_Y,
    pos.z + CAMERA.BASE_OFFSET_Z + velLagZ
  );
  deps.camera.position.lerp(targetPos, CAMERA.LERP_SPEED);
  deps.camera.lookAt(pos.x, pos.y, pos.z);

  const targetFov = Math.min(
    CAMERA.FOV_MAX,
    CAMERA.FOV_BASE + (speed / CAMERA.FOV_SPEED_REFERENCE) * CAMERA.FOV_SPEED_SCALE
  );
  deps.currentFov.current += (targetFov - deps.currentFov.current) * CAMERA.FOV_LERP;
  if ('fov' in deps.camera) {
    (deps.camera as THREE.PerspectiveCamera).fov = deps.currentFov.current;
    (deps.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }

  return { pos, vel, speed };
};

const updateWorkerPhysicsFrame = (body: any, delta: number) => {
  const { paddleLeft, paddleRight, forward } = deps.controls.getControls();
  deps.paddleState.current.leftPaddle = paddleLeft;
  deps.paddleState.current.rightPaddle = paddleRight;

  const rot = body.rotation();
  const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
  const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);

  if ((paddleLeft && paddleRight) || forward) {
    const power = consumeStamina();
    if (power > 0) {
      deps.applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * power * delta));
    }
  } else if (paddleLeft) {
    const power = consumeStamina();
    if (power > 0) {
      deps.applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.7 * power * delta));
      deps.applyWorkerImpulse(rightDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.5 * power * delta));
    }
  } else if (paddleRight) {
    const power = consumeStamina();
    if (power > 0) {
      deps.applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.7 * power * delta));
      deps.applyWorkerImpulse(rightDir.multiplyScalar(-PADDLE.THRUST_FORCE * 0.5 * power * delta));
    }
  }

  deps.stepWorkerProxy(body, delta);
  updateCameraFromBody(body);

  window.dispatchEvent(new CustomEvent('raft-stamina', {
    detail: {
      current: deps.staminaState.current.current,
      max: STAMINA.MAX,
      isExhausted: deps.staminaState.current.isExhausted,
    }
  }));
};

  return {
    calculateSubmergedRatio,
    applyBuoyancy,
    applyDrag,
    applyFlowForce,
    applyTurbulence,
    applyTippingForce,
    dampenRotation,
    handleTipping,
    updateStamina,
    consumeStamina,
    applyBrake,
    applyPaddleForces,
    spawnFoamParticle,
    spawnShedParticle,
    spawnContactBurst,
    resetRaft,
    updateCameraFromBody,
    updateWorkerPhysicsFrame,
  };
}
