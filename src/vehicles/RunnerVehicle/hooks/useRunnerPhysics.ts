import { useRef } from 'react';
import * as THREE from 'three';
import { JumpState, DodgeState, DebugImpulse, DebugContact, PhysicsDebugSnapshot } from '../constants';
import { RunnerVehicle as RunnerVehicleClass, SurfaceMaterial } from '../../../systems/VehicleSystem';
import { PHYSICS } from '../../../constants/game';

export function useRunnerPhysicsState() {
  const vehicle = useRef(new RunnerVehicleClass());

  // Slope detection state
  const slopeState = useRef({
    currentAngle: 0,
    targetMultiplier: 1.0,
    currentMultiplier: 1.0,
    lastGroundNormal: new THREE.Vector3(0, 1, 0),
    isGrounded: false,
    /** Lateral bank angle in degrees; positive = leaning left, negative = leaning right */
    bankAngle: 0,
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

  // Grounded hysteresis: counts frames without ground contact before switching to ungrounded
  const ungroundedFramesRef = useRef(0);

  // Goal 2: Dodge state machine
  const dodgeState = useRef({
    state: 'ready' as DodgeState,
    timer: 0,
    direction: new THREE.Vector3(1, 0, 0),
    nearMissAwarded: false,
  });

  // Goal 2: Platform riding state
  const platformState = useRef({
    isOnPlatform: false,
    platformVelocity: new THREE.Vector3(0, 0, 0),
    platformBody: null as any,
  });

  // Track last applied gravity multiplier to avoid redundant world.gravity mutations
  const appliedGravMultRef = useRef(1.0);

  // Sprint stamina hysteresis: when stamina hits 0, sprint is locked out until RECOVERY_THRESHOLD
  const sprintLockedRef = useRef(false);

  // Reusable Vector3 for camera forward direction (avoids per-frame heap allocations)
  const jumpForwardDirRef = useRef(new THREE.Vector3());

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
    currentBiome: 'canyonSummer' as string,
    activeParticles: [] as Array<{
      id: number;
      material: SurfaceMaterial;
      position: THREE.Vector3;
      intensity: number;
    }>,
  });

  // Goal 2: Collision groups for i-frames
  const defaultCollisionGroups = useRef(0);
  const fovRef = useRef(75);
  const debugState = useRef({
    recentImpulses: [] as DebugImpulse[],
    recentContacts: [] as DebugContact[],
    friction: 0.04,
  });
  const debugSnapshotRef = useRef<PhysicsDebugSnapshot>({
    position: { x: 0, y: 0, z: 0 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    slopeAngle: 0,
    bankAngle: 0,
    isGrounded: false,
    jumpState: 'grounded',
    friction: 0.04,
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
  });

  return {
    vehicle,
    slopeState,
    jumpState,
    ungroundedFramesRef,
    dodgeState,
    platformState,
    appliedGravMultRef,
    sprintLockedRef,
    jumpForwardDirRef,
    footstepState,
    prevFrame,
    collisionState,
    defaultCollisionGroups,
    fovRef,
    debugState,
    debugSnapshotRef
  };
}
