import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { RaftVehicle as RaftVehicleClass, SurfaceMaterial, MATERIAL_FROM_BIOME } from '../systems/VehicleSystem';
import { CollisionParticles } from '../components/CollisionParticles';
import { getAudioManager, AudioManager } from '../systems/AudioSystem';
import { RAFT, WATER_DENSITY, GRAVITY, HUMAN_DENSITY, PLAYER_SPAWN, WATER_LEVEL } from '../constants/game';
import { calculateFlowForce, applyWaterForce } from '../physics/WaterForces';
import { createRapierWorkerProxy } from '../physics/createRapierWorkerProxy';
import type { RapierWorkerProxy } from '../physics/RapierWorkerProxy';
import type { WorkerRaftState } from '../physics/rapierWorkerProtocol';
import { usePlayerControls } from '../hooks/usePlayerControls';

// Buoyancy and water physics configuration
// Uses scientifically accurate densities from Wolfram Alpha:
// - Fresh water: 1000 kg/m³
// - Human body: 1038 kg/m³ (slightly sinks)
// - Buoyancy formula: F_b = ρ_water * V_displaced * g
const WATER_PHYSICS = {
  LEVEL: RAFT.WATER_LEVEL,
  RAFT_HEIGHT: RAFT.HEIGHT,
  RAFT_WIDTH: RAFT.WIDTH,
  RAFT_LENGTH: RAFT.LENGTH,
  RAFT_VOLUME: RAFT.VOLUME,
  RAFT_MASS: RAFT.MASS,

  // Scientific buoyancy: max force when fully submerged
  // F_b = 1000 kg/m³ * 1.8 m³ * 9.8 m/s² = 17640 N
  // Scaled for gameplay physics: 2940 N
  BUOYANCY_MAX_FORCE: RAFT.BUOYANCY_MAX_FORCE,

  // Drag coefficient for blunt body in turbulent flow (~0.47)
  DRAG_COEFFICIENT: RAFT.DRAG_COEFFICIENT,

  // Cross-sectional areas for drag calculation (m²)
  DRAG_AREA_FRONT: RAFT.DRAG_AREA_FRONT,
  DRAG_AREA_SIDE: RAFT.DRAG_AREA_SIDE,

  TURBULENCE_FREQ: RAFT.TURBULENCE_FREQ,
  TURBULENCE_AMP: RAFT.TURBULENCE_AMP,
  TIP_THRESHOLD_SPEED: RAFT.TIP_THRESHOLD_SPEED,
  TIP_SUBMERGE_THRESHOLD: RAFT.TIP_SUBMERGE_THRESHOLD,
  TIP_FORCE_MAGNITUDE: RAFT.TIP_FORCE_MAGNITUDE,
  ROTATION_DAMPING: RAFT.ROTATION_DAMPING,
};

// Scientific density constants
const DENSITY = {
  WATER: WATER_DENSITY,      // 1000 kg/m³
  HUMAN: HUMAN_DENSITY,      // 1038 kg/m³ (slightly negative buoyancy)
  RAFT: RAFT.MASS / RAFT.VOLUME, // ~83 kg/m³ (highly buoyant)
} as const;

// Tipping mechanics
const TIPPING = {
  RIGHTING_THRESHOLD: RAFT.RIGHTING_THRESHOLD_DEG * (Math.PI / 180),
  RIGHTING_TORQUE: RAFT.RIGHTING_TORQUE,
  DANGER_THRESHOLD: RAFT.DANGER_THRESHOLD_DEG * (Math.PI / 180),
  DANGER_TIME: RAFT.DANGER_TIME,
  RESET_HEIGHT: RAFT.RESET_HEIGHT,
};

// Paddle input configuration
const PADDLE = {
  THRUST_FORCE: RAFT.PADDLE_THRUST_FORCE,
  TORQUE_FORCE: RAFT.PADDLE_TORQUE_FORCE,
  FOAM_PARTICLE_COUNT: RAFT.PADDLE_FOAM_PARTICLE_COUNT,
  FOAM_LIFETIME: RAFT.PADDLE_FOAM_LIFETIME,
};

// Stamina system configuration
const STAMINA = {
  MAX: RAFT.STAMINA_MAX,
  COST: RAFT.STAMINA_COST_PER_STROKE,
  REGEN_RATE: RAFT.STAMINA_REGEN_RATE,
  REGEN_DELAY: RAFT.STAMINA_REGEN_DELAY,
  EXHAUSTED_THRESHOLD: RAFT.STAMINA_EXHAUSTED_THRESHOLD,
  POWER_CURVE: RAFT.STAMINA_POWER_CURVE,
  EXHAUSTED_RECOVERY_MULTIPLIER: 3, // must recover to threshold * this before usable
};

// Brake configuration
const BRAKE = {
  DRAG_MULTIPLIER: RAFT.BRAKE_DRAG_MULTIPLIER,
  ANGULAR_DRAG: RAFT.BRAKE_ANGULAR_DRAG,
};

// Collision response configuration
const COLLISION = {
  BOUNCE_FORCE: RAFT.COLLISION_BOUNCE_FORCE,
  SPIN_FORCE: RAFT.COLLISION_SPIN_FORCE,
  STUN_DURATION: RAFT.COLLISION_STUN_DURATION,
  STUN_MAX: RAFT.COLLISION_STUN_MAX,
  WALL_FORWARD_RETAIN: RAFT.COLLISION_WALL_FORWARD_RETAIN,
  STUN_EFFECTIVENESS: 0.3,    // multiplier on input while stunned
  STUN_IMPACT_THRESHOLD: 10,  // min impact force to trigger stun
  IMPACT_FORCE_SCALE: 20,     // normalization for bounce strength
  SPIN_IMPACT_THRESHOLD: 15,  // normalization for spin strength
  BOUNCE_VERTICAL_DAMPING: 0.45, // vertical bounce for satisfying wall pop
  CONTACT_BURST_COUNT: 10,    // shed particles spawned on hard wall contact
  WALL_LATERAL_RATIO: 0.6,    // impact is "mostly lateral" if |dx|/|dz| > this
};

// Forward bias after paddle — keeps momentum from killing flow feel
const BIAS = {
  DURATION: RAFT.PADDLE_FORWARD_BIAS_DURATION,
  FORCE: RAFT.PADDLE_FORWARD_BIAS_FORCE,
};

// Camera dynamics configuration
const CAMERA = {
  BASE_OFFSET_Y: RAFT.CAMERA_BASE_OFFSET_Y,
  BASE_OFFSET_Z: RAFT.CAMERA_BASE_OFFSET_Z,
  VELOCITY_LAG: RAFT.CAMERA_VELOCITY_LAG,
  LEAN_FACTOR: RAFT.CAMERA_LEAN_FACTOR,
  LERP_SPEED: RAFT.CAMERA_LERP_SPEED,
  FOV_BASE: RAFT.CAMERA_FOV_BASE,
  FOV_SPEED_SCALE: RAFT.CAMERA_FOV_SPEED_SCALE,
  FOV_MAX: RAFT.CAMERA_FOV_MAX,
  FOV_LERP: RAFT.CAMERA_FOV_LERP,
  FOV_SPEED_REFERENCE: 15,   // speed at which FOV reaches max increase
};

// Water shedding particle config
const SHED = {
  EMISSION_RATE_BASE: 0.08,   // seconds between particle spawns at min speed
  EMISSION_RATE_FAST: 0.03,   // seconds between particle spawns at max speed
  MIN_SPEED: 2.0,             // min raft speed to emit
  MIN_SUBMERGED: 0.15,        // min submerged ratio to emit
  LIFETIME: 0.8,
  SIZE_BASE: 0.06,
  SIZE_SPEED_SCALE: 0.02,     // additional size per m/s above MIN_SPEED
  COUNT_LIMIT: 40,            // max active shed particles (increased for higher speed)
  SPEED_REF: 12,              // reference speed for max emission rate
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

interface StaminaState {
  current: number;
  regenDelay: number;
  isExhausted: boolean;
}

interface StunState {
  active: boolean;
  timer: number;
}

interface ShedParticle {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  scale: number;
}

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
  const pitch = 0.95 + Math.random() * 0.1;
  audioManager.playSound(sound, 0.8, pitch);
};

const playRaftTipSound = () => {
  initAudio();
  if (!audioManager) return;

  audioManager.playSound('raft_creak', 0.7, 1.0);
  setTimeout(() => {
    audioManager?.playSound('water_crash', 1.0, 0.9);
  }, 100);
};

const RaftVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const { camera } = useThree();
  const { world } = useRapier();
  const useWorkerPhysics = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('raftWorker') === '1';

  // Goal 2: Unified player controls hook
  const controls = usePlayerControls();

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

  // Stamina system state
  const staminaState = useRef<StaminaState>({
    current: STAMINA.MAX,
    regenDelay: 0,
    isExhausted: false,
  });

  // Collision stun state
  const stunState = useRef<StunState>({
    active: false,
    timer: 0,
  });

  // Camera FOV tracking
  const currentFov = useRef(CAMERA.FOV_BASE);

  // Forward bias timer: keeps momentum for BIAS.DURATION seconds after a paddle stroke
  const forwardBiasTimer = useRef(0);

  // Raft deck material ref for wetness darkening
  const raftMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const raftBaseColor = useRef(new THREE.Color('saddlebrown'));

  // Goal 2: Water-shedding particle trail
  const shedParticles = useRef<ShedParticle[]>([]);
  const nextShedId = useRef(0);
  const shedTimer = useRef(0);

  const timeRef = useRef(0);
  const nextParticleId = useRef(0);
  const workerProxyRef = useRef<RapierWorkerProxy | null>(null);
  const workerReadyRef = useRef(false);
  const workerStepPendingRef = useRef(false);
  const workerLatencyLogRef = useRef(0);

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
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(...PLAYER_SPAWN.position));
      vehicle.current.setSurfaceMaterial(SurfaceMaterial.WATER);
      if (useWorkerPhysics) {
        const proxy = createRapierWorkerProxy();
        workerProxyRef.current = proxy;
        proxy.init({
          raft: {
            position: [...PLAYER_SPAWN.position],
            halfExtents: [WATER_PHYSICS.RAFT_WIDTH * 0.5, WATER_PHYSICS.RAFT_HEIGHT * 0.5, WATER_PHYSICS.RAFT_LENGTH * 0.5],
            mass: WATER_PHYSICS.RAFT_MASS,
            linearDamping: 2,
            angularDamping: 2.5,
          },
          staticColliders: [
            {
              position: [0, WATER_PHYSICS.LEVEL - 0.65, -80],
              halfExtents: [28, 0.25, 220],
            },
          ],
        }).then((workerState) => {
          workerReadyRef.current = true;
          syncBodyFromWorkerState(bodyRef.current, workerState);
          return proxy.applyImpulse([0, 2, 0]);
        }).catch((error) => {
          console.warn('[RaftVehicle] Rapier worker init failed; using main-thread physics', error);
          workerReadyRef.current = false;
          workerProxyRef.current?.dispose();
          workerProxyRef.current = null;
          bodyRef.current?.applyImpulse?.({ x: 0, y: 2, z: 0 }, true);
        });
      } else {
        bodyRef.current.applyImpulse({ x: 0, y: 2, z: 0 }, true);
      }
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
    return () => {
      window.removeEventListener('biome-change', handleBiomeChange);
      workerProxyRef.current?.dispose();
      workerProxyRef.current = null;
    };
  }, [useWorkerPhysics]);

  const syncBodyFromWorkerState = (body: any, workerState: WorkerRaftState | null) => {
    if (!body || !workerState) return;
    const [px, py, pz] = workerState.position;
    const [rx, ry, rz, rw] = workerState.rotation;
    const [vx, vy, vz] = workerState.velocity;
    const [avx, avy, avz] = workerState.angularVelocity;
    body.setTranslation({ x: px, y: py, z: pz }, true);
    body.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    body.setAngvel({ x: avx, y: avy, z: avz }, true);
  };

  const applyWorkerImpulse = (impulse: THREE.Vector3) => {
    const proxy = workerProxyRef.current;
    if (!proxy || !workerReadyRef.current) return;
    proxy.applyImpulse([impulse.x, impulse.y, impulse.z]).catch((error) => {
      console.warn('[RaftVehicle] Rapier worker impulse failed', error);
    });
  };

  const stepWorkerProxy = (body: any, delta: number) => {
    const proxy = workerProxyRef.current;
    if (!proxy || !workerReadyRef.current || workerStepPendingRef.current) return;

    workerStepPendingRef.current = true;
    proxy.step(delta).then((workerState) => {
      syncBodyFromWorkerState(body, workerState);
      const now = performance.now();
      if (now - workerLatencyLogRef.current > 2000) {
        workerLatencyLogRef.current = now;
        console.info(`[RaftVehicle] Rapier worker RTT avg ${proxy.averageLatencyMs.toFixed(3)}ms`);
      }
    }).catch((error) => {
      console.warn('[RaftVehicle] Rapier worker step failed', error);
    }).finally(() => {
      workerStepPendingRef.current = false;
    });
  };

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

    buoyancyState.current.buoyancyForce = buoyancyForce;
    buoyancyState.current.isFloating = submergedRatio > 0.1;
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
      timeRef.current
    );
    applyWaterForce(body, flowForce, delta, true);
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
   * Update stamina state each frame (regen, exhaustion tracking)
   */
  const updateStamina = (delta: number) => {
    const st = staminaState.current;

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
    const st = staminaState.current;

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
    const { paddleLeft, paddleRight, forward } = controls.getControls();

    paddleState.current.leftPaddle = paddleLeft;
    paddleState.current.rightPaddle = paddleRight;

    // If stunned, reduce input effectiveness
    const stunMultiplier = stunState.current.active ? COLLISION.STUN_EFFECTIVENESS : 1.0;

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
      forwardBiasTimer.current = BIAS.DURATION;

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
      forwardBiasTimer.current = BIAS.DURATION;
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
      forwardBiasTimer.current = BIAS.DURATION;
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

    shedParticles.current.push({
      id: nextShedId.current++,
      position: new THREE.Vector3(pos.x + sternOffset.x, pos.y + sternOffset.y, pos.z + sternOffset.z).add(spread),
      velocity: vel,
      life: SHED.LIFETIME,
      scale: particleSize,
    });

    // Trim excess particles
    if (shedParticles.current.length > SHED.COUNT_LIMIT) {
      shedParticles.current.shift();
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
      shedParticles.current.push({
        id: nextShedId.current++,
        position: contactPoint.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4)),
        velocity: vel,
        life: SHED.LIFETIME * (0.6 + Math.random() * 0.6),
        scale: SHED.SIZE_BASE * 1.5 + Math.random() * 0.06 * forceFactor,
      });
    }

    // Trim if over limit
    if (shedParticles.current.length > SHED.COUNT_LIMIT) {
      shedParticles.current.splice(0, shedParticles.current.length - SHED.COUNT_LIMIT);
    }
  };

  /**
   * Reset raft to safe position after tipping
   */
  const resetRaft = (body: any) => {
    playRaftTipSound();

    const safePos = tippingState.current.lastSafePosition.clone();
    safePos.y = Math.max(safePos.y, WATER_PHYSICS.LEVEL + TIPPING.RESET_HEIGHT);

    body.setTranslation(safePos, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)), true);

    tippingState.current.dangerTime = 0;
    tippingState.current.isTipped = false;

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
    camera.position.lerp(targetPos, CAMERA.LERP_SPEED);
    camera.lookAt(pos.x, pos.y, pos.z);

    const targetFov = Math.min(
      CAMERA.FOV_MAX,
      CAMERA.FOV_BASE + (speed / CAMERA.FOV_SPEED_REFERENCE) * CAMERA.FOV_SPEED_SCALE
    );
    currentFov.current += (targetFov - currentFov.current) * CAMERA.FOV_LERP;
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = currentFov.current;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    return { pos, vel, speed };
  };

  const updateWorkerPhysicsFrame = (body: any, delta: number) => {
    const { paddleLeft, paddleRight, forward } = controls.getControls();
    paddleState.current.leftPaddle = paddleLeft;
    paddleState.current.rightPaddle = paddleRight;

    const rot = body.rotation();
    const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);

    if ((paddleLeft && paddleRight) || forward) {
      const power = consumeStamina();
      if (power > 0) {
        applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * power * delta));
      }
    } else if (paddleLeft) {
      const power = consumeStamina();
      if (power > 0) {
        applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.7 * power * delta));
        applyWorkerImpulse(rightDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.5 * power * delta));
      }
    } else if (paddleRight) {
      const power = consumeStamina();
      if (power > 0) {
        applyWorkerImpulse(forwardDir.multiplyScalar(PADDLE.THRUST_FORCE * 0.7 * power * delta));
        applyWorkerImpulse(rightDir.multiplyScalar(-PADDLE.THRUST_FORCE * 0.5 * power * delta));
      }
    }

    stepWorkerProxy(body, delta);
    updateCameraFromBody(body);

    window.dispatchEvent(new CustomEvent('raft-stamina', {
      detail: {
        current: staminaState.current.current,
        max: STAMINA.MAX,
        isExhausted: staminaState.current.isExhausted,
      }
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

    // Update stamina regeneration
    updateStamina(delta);

    // Update stun timer
    if (stunState.current.active) {
      stunState.current.timer -= delta;
      if (stunState.current.timer <= 0) {
        stunState.current.active = false;
        stunState.current.timer = 0;
      }
    }

    if (useWorkerPhysics && workerProxyRef.current) {
      updateWorkerPhysicsFrame(body, delta);
      return;
    }

    // Calculate submersion
    const submergedRatio = calculateSubmergedRatio(pos.y);
    buoyancyState.current.submergedRatio = submergedRatio;

    // Apply water physics
    applyBuoyancy(body, submergedRatio, delta);

    if (submergedRatio > 0) {
      applyDrag(body, delta);
    }

    // Goal 2: Apply flow-map-based water force
    if (submergedRatio > 0.1) {
      applyFlowForce(body, delta);
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

    // Forward bias: carry post-paddle momentum by applying a mild fwd nudge
    if (forwardBiasTimer.current > 0) {
      forwardBiasTimer.current -= delta;
      if (!stunState.current.active) {
        const rot = body.rotation();
        const fwdDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
        const biasFraction = forwardBiasTimer.current / BIAS.DURATION;
        body.applyImpulse({
          x: fwdDir.x * BIAS.FORCE * biasFraction * delta,
          y: 0,
          z: fwdDir.z * BIAS.FORCE * biasFraction * delta,
        }, true);
      }
    }

    // Fallback WASD (strafing) if no paddle input
    const { leftward, rightward, backward, forward, paddleLeft, paddleRight } = controls.getControls();

    // Brake mechanic: S/backward key applies broadside drag
    if (backward) {
      applyBrake(body, delta);
    }

    if (!paddleLeft && !paddleRight && !forward) {
      if (leftward || rightward) {
        vehicle.current.setInput({
          moveX: rightward ? 1 : leftward ? -1 : 0,
        });
        vehicle.current.update(delta);
      }
    }

    // Subtle raft wetness: darken deck proportional to submersion + any spray
    if (raftMaterialRef.current) {
      const wetnessLevel = submergedRatio * 0.6 + (speed > 4 ? Math.min(0.25, (speed - 4) * 0.03) : 0);
      const darken = 1.0 - wetnessLevel * 0.35;
      raftMaterialRef.current.color.copy(raftBaseColor.current).multiplyScalar(darken);
    }

    // === DYNAMIC CAMERA ===
    const { vel, speed } = updateCameraFromBody(body);

    // Update foam particles
    paddleState.current.foamParticles = paddleState.current.foamParticles
      .map(p => ({
        ...p,
        position: p.position.clone().add(p.velocity.clone().multiplyScalar(delta)),
        life: p.life - delta,
      }))
      .filter(p => p.life > 0);

    // Goal 2: Update water-shedding particles (velocity-reactive emission rate)
    if (speed > SHED.MIN_SPEED && submergedRatio > SHED.MIN_SUBMERGED) {
      const speedRatio = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));
      const emissionRate = SHED.EMISSION_RATE_BASE - speedRatio * (SHED.EMISSION_RATE_BASE - SHED.EMISSION_RATE_FAST);
      shedTimer.current += delta;
      if (shedTimer.current > emissionRate) {
        shedTimer.current = 0;
        spawnShedParticle(body);
      }
    }

    shedParticles.current = shedParticles.current
      .map(p => ({
        ...p,
        position: p.position.clone().add(p.velocity.clone().multiplyScalar(delta)),
        velocity: p.velocity.clone().add(new THREE.Vector3(0, -1.5 * delta, 0)), // gravity
        life: p.life - delta,
      }))
      .filter(p => p.life > 0);

    // === COLLISION DETECTION WITH ELASTIC BOUNCE ===
    const prevVel = collisionState.current.prevVelocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVel.x, vel.y - prevVel.y, vel.z - prevVel.z);
    const impactForce = velocityDelta.length() / delta;

    // Detect collision with terrain (when not mostly submerged)
    if (impactForce > 6 && submergedRatio < 0.8) {
      const material = MATERIAL_FROM_BIOME[collisionState.current.currentBiome] || SurfaceMaterial.ROCK;
      const contactPoint = new THREE.Vector3(pos.x, pos.y - WATER_PHYSICS.RAFT_HEIGHT / 2, pos.z);

      vehicle.current.processCollision(
        material,
        impactForce,
        contactPoint,
        new THREE.Vector3(vel.x, vel.y, vel.z)
      );

      const forceFactor = Math.min(1, impactForce / COLLISION.IMPACT_FORCE_SCALE);

      // Determine if this is a lateral wall hit vs a head-on rock impact.
      // Wall hits: |dx| >> |dz|.  Retain Z forward momentum for wall-riding feel.
      const dxAbs = Math.abs(velocityDelta.x);
      const dzAbs = Math.abs(velocityDelta.z);
      const isLateralWallHit = dxAbs > dzAbs * COLLISION.WALL_LATERAL_RATIO;

      if (isLateralWallHit) {
        // Wall-ride: bounce X hard, retain most of Z forward velocity
        const bounceX = -velocityDelta.x * forceFactor * COLLISION.BOUNCE_FORCE * 0.08;
        const popY = Math.abs(velocityDelta.x) * forceFactor * COLLISION.BOUNCE_VERTICAL_DAMPING * 0.06;
        body.applyImpulse({ x: bounceX, y: popY, z: 0 }, true);
      } else {
        // Head-on: full reflect, vertical pop for waterfall rocks
        const bounceDir = velocityDelta.clone().normalize().multiplyScalar(-forceFactor * COLLISION.BOUNCE_FORCE * 0.1);
        body.applyImpulse({ x: bounceDir.x, y: Math.abs(bounceDir.y) * COLLISION.BOUNCE_VERTICAL_DAMPING + 0.5, z: bounceDir.z }, true);
      }

      // Spin on impact (satisfying rotation — stronger on glancing lateral hits)
      const spinDir = Math.sign(vel.x) || 1;
      const spinScale = isLateralWallHit ? 1.6 : 1.0;
      body.applyTorqueImpulse({
        x: 0,
        y: spinDir * COLLISION.SPIN_FORCE * Math.min(1, impactForce / COLLISION.SPIN_IMPACT_THRESHOLD) * spinScale,
        z: 0,
      }, true);

      // Stun duration scales with impact force, capped at STUN_MAX
      if (impactForce > COLLISION.STUN_IMPACT_THRESHOLD) {
        const scaledStun = COLLISION.STUN_DURATION + forceFactor * (COLLISION.STUN_MAX - COLLISION.STUN_DURATION);
        stunState.current.active = true;
        stunState.current.timer = Math.min(scaledStun, COLLISION.STUN_MAX);

        // Dispatch wall-impact event so camera shake can respond
        window.dispatchEvent(new CustomEvent('raft-wall-impact', {
          detail: { force: impactForce, isWall: isLateralWallHit },
        }));
      }

      // Contact burst: shed particles scatter from impact point on any significant hit
      if (impactForce > 8) {
        spawnContactBurst(body, contactPoint, impactForce);
      }

      // CollisionParticles for very hard hits
      if (impactForce > vehicle.current['highImpactThreshold']) {
        const newParticle = {
          id: Date.now(),
          material,
          position: contactPoint.clone(),
          intensity: forceFactor,
        };
        collisionState.current.activeParticles.push(newParticle);
      }
    }

    collisionState.current.prevVelocity.set(vel.x, vel.y, vel.z);

    // Dispatch stamina state for UI consumption
    window.dispatchEvent(new CustomEvent('raft-stamina', {
      detail: {
        current: staminaState.current.current,
        max: STAMINA.MAX,
        isExhausted: staminaState.current.isExhausted,
      }
    }));
  });

  return (
    <group>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        mass={150}
        restitution={0.4}
        linearDamping={2.0}
        angularDamping={2.5}
        position={PLAYER_SPAWN.position}
      >
        {/* Raft deck — material ref for runtime wetness darkening */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[WATER_PHYSICS.RAFT_WIDTH, WATER_PHYSICS.RAFT_HEIGHT, WATER_PHYSICS.RAFT_LENGTH]} />
          <meshStandardMaterial
            ref={raftMaterialRef}
            color="saddlebrown"
            roughness={0.85}
            metalness={0.05}
          />
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

      {/* Goal 2: Water-shedding trail particles */}
      {shedParticles.current.map(particle => (
        <mesh
          key={`shed-${particle.id}`}
          position={[particle.position.x, particle.position.y, particle.position.z]}
        >
          <sphereGeometry args={[particle.scale * (particle.life / SHED.LIFETIME)]} />
          <meshBasicMaterial
            color="#dff4ff"
            transparent
            opacity={(particle.life / SHED.LIFETIME) * 0.5}
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
