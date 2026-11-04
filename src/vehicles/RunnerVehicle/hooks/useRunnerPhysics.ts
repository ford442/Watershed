import { useState } from 'react';
import * as THREE from 'three';
import { JumpState, DodgeState, DebugImpulse, DebugContact, PhysicsDebugSnapshot } from '../constants';
import { createCollisionTracker, RUNNER_CONTACT_FRICTION } from '../../../systems/vehicle/VehicleSystem';
import { PHYSICS } from '../../../constants/game';
import { ParticlePool } from '../../../components/particlePool';
import { COLLISION_PARTICLE_CAPACITY } from '../../../components/CollisionParticles';
import { createRunnerStepScratch } from './runnerStepScratch';

/** A ref-shaped holder (the step mutates `.current`, as it did on `useRef`s). */
const ref = <T,>(current: T): { current: T } => ({ current });

function createSlopeState() {
  return {
    currentAngle: 0,
    targetMultiplier: 1.0,
    currentMultiplier: 1.0,
    lastGroundNormal: new THREE.Vector3(0, 1, 0),
    isGrounded: false,
    /** Lateral bank angle in degrees; positive = leaning left, negative = leaning right */
    bankAngle: 0,
    /** This step's sampled surface pitch (sampleSlope); `currentAngle` takes it while grounded. */
    sampledAngle: 0,
  };
}

function createJumpState() {
  return {
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
  };
}

function createDebugSnapshot(): PhysicsDebugSnapshot {
  return {
    position: { x: 0, y: 0, z: 0 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    slopeAngle: 0,
    bankAngle: 0,
    isGrounded: false,
    jumpState: 'grounded',
    friction: RUNNER_CONTACT_FRICTION,
    waterfallGravityMultiplier: 1,
    effectiveG: PHYSICS.GRAVITY,
    extraGravity: 0,
    currentSegmentIndex: 0,
    groundRay: {
      origin: { x: 0, y: 0, z: 0 },
      hitPoint: null,
      distance: null,
    },
    groundNormal: { x: 0, y: 0, z: 0 },
    recentImpulses: [],
    recentContacts: [],
  };
}

/**
 * Everything the runner's physics step reads and writes, built once per
 * mounted runner. Plain holders, not `useRef(new …)` — a `useRef` argument is
 * evaluated (and its vectors allocated) on every render (#521 D).
 */
export function createRunnerPhysicsState() {
  return {
    /** Impact events and their sim clock (was the RunnerVehicle class). */
    vehicle: createCollisionTracker(),
    slopeState: ref(createSlopeState()),
    jumpState: ref(createJumpState()),
    // Grounded hysteresis: counts frames without ground contact before switching to ungrounded
    ungroundedFramesRef: ref(0),
    // Goal 2: Dodge state machine
    dodgeState: ref({
      state: 'ready' as DodgeState,
      timer: 0,
      direction: new THREE.Vector3(1, 0, 0),
      nearMissAwarded: false,
    }),
    // Goal 2: Platform riding state
    platformState: ref({
      isOnPlatform: false,
      platformVelocity: new THREE.Vector3(0, 0, 0),
    }),
    // Track last applied gravity multiplier to avoid redundant world.gravity mutations
    appliedGravMultRef: ref(1.0),
    // Sprint stamina hysteresis: when stamina hits 0, sprint is locked out until RECOVERY_THRESHOLD
    sprintLockedRef: ref(false),
    // Reusable Vector3 for camera forward direction (avoids per-frame heap allocations)
    jumpForwardDirRef: ref(new THREE.Vector3()),
    // Footstep tracking
    footstepState: ref({
      distanceTraveled: 0,
      lastStepDistance: 0,
      stepInterval: 2.5, // Units between steps
    }),
    // Previous frame state for transition detection
    prevFrame: ref({
      wasGrounded: true,
      jumpPressed: false,
      dodgePressed: false,
      velocity: new THREE.Vector3(),
    }),
    collisionState: ref({
      currentBiome: 'canyonSummer' as string,
      /** Collision bursts, drawn by ParticlePoolMesh in RunnerVehicle. */
      particles: new ParticlePool(COLLISION_PARTICLE_CAPACITY),
    }),
    fovState: { fov: 75 },
    debugState: ref({
      recentImpulses: [] as DebugImpulse[],
      recentContacts: [] as DebugContact[],
      friction: RUNNER_CONTACT_FRICTION,
      /** Sim milliseconds stepped (the debug overlay's contact/impulse clock). */
      simMs: 0,
    }),
    debugSnapshotRef: ref(createDebugSnapshot()),
    /** The physics step's reused per-step scratch (runnerStepScratch.ts). */
    stepScratch: createRunnerStepScratch(),
  };
}

export function useRunnerPhysicsState() {
  const [state] = useState(createRunnerPhysicsState);
  return state;
}

export type RunnerPhysicsState = ReturnType<typeof createRunnerPhysicsState>;
export type RunnerJumpData = RunnerPhysicsState['jumpState']['current'];
