import * as THREE from 'three';
import { useGameStore } from '../../../systems/GameState';
import { WATER_PHYSICS } from '../../../constants/waterPhysics';
import {
  TIPPING, PADDLE, STAMINA, BRAKE, COLLISION, BIAS, CAMERA, SHED,
  type BuoyancyState, type PaddleState, type StaminaState, type StunState, type TippingState,
} from '../constants';
import { playPaddleSound, playRaftTipSound } from '../audio';
import type { PlayerControls } from '../../../hooks/usePlayerControls';
import type { RapierBody, Vec3Like } from '../../../physics/rapierTypes';
import type { ParticlePool } from '../../../components/particlePool';
import { publishRaftSurvival } from '../../../systems/journey/runSession';
import { getComfort } from '../../../systems/settings/comfortRuntime';
import { raftTargetFov } from '../../../systems/settings/comfort';
import { clamp01 } from '../../../math/scalar';
import { createRng } from '../../../math/random';
import { getVehicleWaterLevel } from '../../../systems/water/vehicleWaterDatum';

/** This module's seeded stream (#503 A): draws are reproducible run to run. */
const random = createRng(0x6e0183eb);

// Per-step scratch (#503 B): these run inside useFrame every physics step,
// where `new` is invisible to @react-three/no-new-in-loop.
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _cameraTarget = new THREE.Vector3();
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;

/** The body's rotation as a THREE quaternion (scratch — use before the next call). */
function bodyQuaternion(body: RapierBody): THREE.Quaternion {
  const r = body.rotation();
  return _quat.set(r.x, r.y, r.z, r.w);
}

/** A hull more than this fraction under the surface is floating (survival `inWater`). */
export const FLOATING_SUBMERGED_RATIO = 0.1;

export type RaftImpulse = [number, number, number];

export interface RaftPhysicsRuntimeDeps {
  buoyancyState: { current: BuoyancyState };
  tippingState: { current: TippingState };
  paddleState: { current: PaddleState };
  staminaState: { current: StaminaState };
  stunState: { current: StunState };
  forwardBiasTimer: { current: number };
  /** Paddle foam and the stern/contact shed spray, drawn by ParticlePoolMesh. */
  foamParticles: ParticlePool;
  shedParticles: ParticlePool;
  camera: THREE.Camera;
  controls: { getControls: () => PlayerControls };
  stepWorkerProxy: (body: RapierBody, delta: number, impulses?: RaftImpulse[]) => void;
  currentFov: { current: number };
  /**
   * The staged water level over the raft — the datum the hull's buoyancy reads
   * (vehicleWaterDatum.ts); null where no water covers it. Injectable for tests.
   */
  sampleWaterLevel?: () => number | null;
}

/**
 * One raft's runtime state, shared by the step functions below: the injected
 * deps, the water datum it samples, and the survival paddle multipliers.
 */
interface RaftRuntimeCtx {
  deps: RaftPhysicsRuntimeDeps;
  sampleWaterLevel: () => number | null;
  /** Paddle-economy multipliers from the last survival tick (1 = unaffected). */
  paddleModifiers: { cost: number; regen: number };
}

/**
 * Fraction of the hull below the staged surface — the same level the water
 * force reads, so a lowered stage grounds the hull and this check together.
 * No water under the raft (off the sheet, before the first force frame) is 0.
 */
function calculateSubmergedRatio(rt: RaftRuntimeCtx, raftY: number): number {
  const waterLevel = rt.sampleWaterLevel();
  if (waterLevel === null) return 0;
  const raftHalfHeight = WATER_PHYSICS.RAFT_HEIGHT / 2;
  const raftBottom = raftY - raftHalfHeight;
  const raftTop = raftY + raftHalfHeight;

  if (raftBottom >= waterLevel) return 0;
  if (raftTop <= waterLevel) return 1;

  const submergedHeight = waterLevel - raftBottom;
  return clamp01(submergedHeight / WATER_PHYSICS.RAFT_HEIGHT);
}

function applyTurbulence(rt: RaftRuntimeCtx, body: RapierBody, time: number, delta: number) {
  if (!rt.deps.buoyancyState.current.isFloating) return;

  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const speedFactor = Math.min(1, speed / 5);
  const calm = useGameStore.getState().currentBiome === 'delta';
  const amp =
    WATER_PHYSICS.TURBULENCE_AMP *
    speedFactor *
    (calm ? WATER_PHYSICS.CALM_TURBULENCE_SCALE : 1);

  const pitchWobble = Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ) * amp +
    Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ * 1.7) * amp * 0.3;
  const rollWobble = Math.cos(time * WATER_PHYSICS.TURBULENCE_FREQ * 1.3) * amp * 0.8 +
    Math.sin(time * WATER_PHYSICS.TURBULENCE_FREQ * 2.1) * amp * 0.2;

  const euler = _euler.setFromQuaternion(bodyQuaternion(body));
  euler.x += pitchWobble * delta * 2;
  euler.z += rollWobble * delta * 2;

  body.setRotation(_quat.setFromEuler(euler), true);
}

function applyTippingForce(body: RapierBody, submergedRatio: number, delta: number) {
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const calm = useGameStore.getState().currentBiome === 'delta';
  const tipThreshold = calm
    ? WATER_PHYSICS.CALM_TIP_THRESHOLD_SPEED
    : WATER_PHYSICS.TIP_THRESHOLD_SPEED;

  if (speed < tipThreshold || submergedRatio < WATER_PHYSICS.TIP_SUBMERGE_THRESHOLD) {
    return;
  }

  const tipMagnitude =
    WATER_PHYSICS.TIP_FORCE_MAGNITUDE *
    ((speed - tipThreshold) / 5) *
    (calm ? WATER_PHYSICS.CALM_TIP_SCALE : 1);

  body.applyTorqueImpulse({
    x: vel.z * tipMagnitude * delta * 0.1,
    y: 0,
    z: -vel.x * tipMagnitude * delta * 0.15
  }, true);
}

function dampenRotation(body: RapierBody, delta: number) {
  const angVel = body.angvel();
  const damping = Math.pow(WATER_PHYSICS.ROTATION_DAMPING, delta * 60);

  body.setAngvel({
    x: angVel.x * damping,
    y: angVel.y * damping,
    z: angVel.z * damping
  }, true);
}

/**
 * Handle tipping mechanics - righting torque and danger detection
 */
function handleTipping(rt: RaftRuntimeCtx, body: RapierBody, delta: number): boolean {
  const euler = _euler.setFromQuaternion(bodyQuaternion(body));

  rt.deps.tippingState.current.rollAngle = euler.z;
  rt.deps.tippingState.current.pitchAngle = euler.x;

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
    rt.deps.tippingState.current.dangerTime += delta;

    if (rt.deps.tippingState.current.dangerTime > TIPPING.DANGER_TIME) {
      rt.deps.tippingState.current.isTipped = true;
      return true;
    }
  } else {
    rt.deps.tippingState.current.dangerTime = Math.max(0, rt.deps.tippingState.current.dangerTime - delta * 2);

    // Update last safe position when stable
    if (maxTilt < TIPPING.RIGHTING_THRESHOLD * 0.5) {
      const t = body.translation();
      rt.deps.tippingState.current.lastSafePosition.set(t.x, t.y, t.z);
    }
  }

  return false;
}

/**
 * Survival coupling for the raft (Track A v2).
 *
 * The runner ticks survival from RunnerPhysicsStep; the raft is the other half of
 * that loop. `inWater` is the raft actually floating rather than a height test —
 * a raft riding a wave crest is still soaking its occupant.
 *
 * Returns the live modifiers so the paddle economy can read them; null when no
 * run session is active (free-play / editor), in which case stamina behaves
 * exactly as it did before survival existed.
 */
function tickRaftSurvival(rt: RaftRuntimeCtx) {
  return publishRaftSurvival(rt.deps.buoyancyState.current.isFloating === true);
}

/**
 * Update stamina state each frame (regen, exhaustion tracking)
 */
function updateStamina(rt: RaftRuntimeCtx, delta: number) {
  const st = rt.deps.staminaState.current;

  // Regen delay countdown
  if (st.regenDelay > 0) {
    st.regenDelay -= delta;
    return;
  }

  // Regenerate stamina — wetness and cold exposure slow the refill.
  if (st.current < STAMINA.MAX) {
    st.current = Math.min(
      STAMINA.MAX,
      st.current + STAMINA.REGEN_RATE * rt.paddleModifiers.regen * delta,
    );
  }

  // Clear exhaustion when recovered enough
  if (st.isExhausted && st.current > STAMINA.EXHAUSTED_THRESHOLD * STAMINA.EXHAUSTED_RECOVERY_MULTIPLIER) {
    st.isExhausted = false;
  }
}

/**
 * Consume stamina for a paddle stroke; returns effective power multiplier (0-1)
 */
function consumeStamina(rt: RaftRuntimeCtx): number {
  const st = rt.deps.staminaState.current;

  if (st.isExhausted || st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
    return 0;
  }

  // Cold, stiff hands and a soaked jacket make each stroke cost more.
  st.current = Math.max(0, st.current - STAMINA.COST * rt.paddleModifiers.cost);
  st.regenDelay = STAMINA.REGEN_DELAY;

  if (st.current < STAMINA.EXHAUSTED_THRESHOLD) {
    st.isExhausted = true;
  }

  // Power scales with remaining stamina (power curve makes it forgiving)
  const ratio = st.current / STAMINA.MAX;
  return Math.pow(ratio, STAMINA.POWER_CURVE);
}

/**
 * Apply brake forces (broadside drag) when S/backward is held
 */
function applyBrake(body: RapierBody, delta: number) {
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
}

/**
 * Stroke strength per paddle, 0..1. A keyboard key reports a full 1; a gamepad
 * trigger reports how far it is pulled (`paddleLeftAxis` / `paddleRightAxis`,
 * #486 B), so a half-pull is a half-strength stroke. Both paddles (or W) average
 * the two; W alone is a full stroke.
 */
function paddleStrokeScales(c: {
  paddleLeft: boolean;
  paddleRight: boolean;
  paddleLeftAxis?: number;
  paddleRightAxis?: number;
}) {
  const strokeLeft = c.paddleLeft ? Math.max(0.35, Math.min(1, c.paddleLeftAxis ?? 1)) : 0;
  const strokeRight = c.paddleRight ? Math.max(0.35, Math.min(1, c.paddleRightAxis ?? 1)) : 0;
  const strokeBoth =
    c.paddleLeft && c.paddleRight ? (strokeLeft + strokeRight) / 2 : c.paddleLeft ? strokeLeft : c.paddleRight ? strokeRight : 1;
  return { strokeLeft, strokeRight, strokeBoth };
}

/**
 * Apply paddle forces based on Q/E input with stamina-gated power
 */
function applyPaddleForces(rt: RaftRuntimeCtx, body: RapierBody, delta: number) {
  const controls = rt.deps.controls.getControls();
  const { paddleLeft, paddleRight, forward } = controls;
  const { strokeLeft, strokeRight, strokeBoth } = paddleStrokeScales(controls);

  rt.deps.paddleState.current.leftPaddle = paddleLeft;
  rt.deps.paddleState.current.rightPaddle = paddleRight;

  // If stunned, reduce input effectiveness
  const stunMultiplier = rt.deps.stunState.current.active ? COLLISION.STUN_EFFECTIVENESS : 1.0;

  const rot = bodyQuaternion(body);
  const forwardDir = _forward.set(0, 0, -1).applyQuaternion(rot);
  const rightDir = _right.set(1, 0, 0).applyQuaternion(rot);

  // Both paddles or W key = straight forward
  if ((paddleLeft && paddleRight) || forward) {
    const power = consumeStamina(rt) * strokeBoth * stunMultiplier;
    if (power <= 0) return;

    body.applyImpulse({
      x: forwardDir.x * PADDLE.THRUST_FORCE * power * delta,
      y: 0,
      z: forwardDir.z * PADDLE.THRUST_FORCE * power * delta
    }, true);

    // Arm forward bias to retain momentum after this stroke
    rt.deps.forwardBiasTimer.current = BIAS.DURATION;

    // Spawn foam on both sides
    if (random() > 0.7) {
      spawnFoamParticle(rt, body, 'left');
      spawnFoamParticle(rt, body, 'right');
    }
    return;
  }

  // Left paddle (Q) - apply force at left attachment point, rotate left
  if (paddleLeft) {
    const power = consumeStamina(rt) * strokeLeft * stunMultiplier;
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

    if (random() > 0.6) {
      spawnFoamParticle(rt, body, 'left');
      playPaddleSound('left');
    }
    rt.deps.forwardBiasTimer.current = BIAS.DURATION;
  }

  // Right paddle (E) - apply force at right attachment point, rotate right
  if (paddleRight) {
    const power = consumeStamina(rt) * strokeRight * stunMultiplier;
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

    if (random() > 0.6) {
      spawnFoamParticle(rt, body, 'right');
      playPaddleSound('right');
    }
    rt.deps.forwardBiasTimer.current = BIAS.DURATION;
  }
}

/**
 * Spawn a foam particle for paddle visual feedback
 */
function spawnFoamParticle(rt: RaftRuntimeCtx, body: RapierBody, side: 'left' | 'right') {
  const pos = body.translation();
  const offset = _offset
    .set(side === 'left' ? -1.2 : 1.2, -0.2, side === 'left' ? 0.5 : -0.5)
    .applyQuaternion(bodyQuaternion(body));

  rt.deps.foamParticles.spawn({
    x: pos.x + offset.x,
    y: pos.y + offset.y,
    z: pos.z + offset.z,
    vx: (random() - 0.5) * 0.5,
    vy: random() * 0.3,
    vz: (random() - 0.5) * 0.5,
    life: PADDLE.FOAM_LIFETIME,
    size: 0.15 + random() * 0.1,
  });
}

/** Linear RGB of the shed spray (#e0f0ff). */
const SHED_COLOR = new THREE.Color('#e0f0ff');
/** Shed spray falls slowly — the old per-frame `velocity.y -= 1.5·dt`. */
const SHED_GRAVITY = -1.5;

/**
 * Goal 2: Spawn a water-shedding particle trailing the raft
 * Particle size and spread scale with current speed for velocity-reactive VFX
 */
function spawnShedParticle(rt: RaftRuntimeCtx, body: RapierBody) {
  const pos = body.translation();
  const rot = bodyQuaternion(body);
  const bodyVel = body.linvel();
  const speed = Math.sqrt(bodyVel.x * bodyVel.x + bodyVel.z * bodyVel.z);
  const speedFactor = Math.min(1, (speed - SHED.MIN_SPEED) / (SHED.SPEED_REF - SHED.MIN_SPEED));

  // Spawn at the stern (raft moves -Z, so stern is +Z relative to raft)
  const stern = _offset.set(0, -0.1, 1.6).applyQuaternion(rot);
  const px = pos.x + stern.x + (random() - 0.5) * (0.8 + speedFactor * 0.6); // wider spread at speed
  const py = pos.y + stern.y + random() * 0.2;
  const pz = pos.z + stern.z + (random() - 0.5) * (0.4 + speedFactor * 0.3);

  // Velocity opposes raft motion + slight upward arc, stronger at speed
  const vel = _velocity.set(
    (random() - 0.5) * (0.6 + speedFactor * 0.8),
    0.3 + random() * (0.4 + speedFactor * 0.4),
    0.5 + random() * (0.5 + speedFactor * 0.5),
  ).applyQuaternion(rot);

  rt.deps.shedParticles.spawn({
    x: px, y: py, z: pz,
    vx: vel.x, vy: vel.y, vz: vel.z,
    life: SHED.LIFETIME,
    size: SHED.SIZE_BASE + speedFactor * SHED.SIZE_SPEED_SCALE + random() * 0.03,
    gravity: SHED_GRAVITY,
    r: SHED_COLOR.r, g: SHED_COLOR.g, b: SHED_COLOR.b,
  });
}

/**
 * Spawn a burst of shed particles at a wall contact point.
 * Gives the "shedding water on hard impact" feel without a full particle system.
 */
function spawnContactBurst(rt: RaftRuntimeCtx, contactPoint: Vec3Like, impactForce: number) {
  const forceFactor = Math.min(1, impactForce / COLLISION.IMPACT_FORCE_SCALE);
  const count = Math.floor(COLLISION.CONTACT_BURST_COUNT * forceFactor) + 4;

  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = 1.5 + random() * 3.0 * forceFactor;
    rt.deps.shedParticles.spawn({
      x: contactPoint.x + (random() - 0.5) * 0.4,
      y: contactPoint.y + 0.1,
      z: contactPoint.z + (random() - 0.5) * 0.4,
      vx: Math.cos(angle) * speed,
      vy: 0.8 + random() * 2.0 * forceFactor,
      vz: Math.sin(angle) * speed,
      life: SHED.LIFETIME * (0.6 + random() * 0.6),
      size: SHED.SIZE_BASE * 1.5 + random() * 0.06 * forceFactor,
      gravity: SHED_GRAVITY,
      r: SHED_COLOR.r, g: SHED_COLOR.g, b: SHED_COLOR.b,
    });
  }
}

/**
 * Reset raft to safe position after tipping
 */
function resetRaft(rt: RaftRuntimeCtx, body: RapierBody) {
  playRaftTipSound();

  const safePos = rt.deps.tippingState.current.lastSafePosition.clone();
  // Clear of the surface the raft was last floating on, never an absolute y.
  const waterLevel = rt.sampleWaterLevel();
  if (waterLevel !== null) safePos.y = Math.max(safePos.y, waterLevel + TIPPING.RESET_HEIGHT);

  body.setTranslation(safePos, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.setRotation(IDENTITY_ROTATION, true);

  rt.deps.tippingState.current.dangerTime = 0;
  rt.deps.tippingState.current.isTipped = false;
}

function updateCameraFromBody(rt: RaftRuntimeCtx, body: RapierBody) {
  const pos = body.translation();
  const vel = body.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  const velLagX = -vel.x * CAMERA.VELOCITY_LAG;
  const velLagZ = -vel.z * CAMERA.VELOCITY_LAG;
  const angVel = body.angvel();
  const leanOffset = -angVel.y * CAMERA.LEAN_FACTOR;

  const targetPos = _cameraTarget.set(
    pos.x + velLagX + leanOffset,
    pos.y + CAMERA.BASE_OFFSET_Y,
    pos.z + CAMERA.BASE_OFFSET_Z + velLagZ
  );
  rt.deps.camera.position.lerp(targetPos, CAMERA.LERP_SPEED);
  rt.deps.camera.lookAt(pos.x, pos.y, pos.z);

  // Base FOV and kick strength are the player's comfort settings (#486 D); the
  // authored headroom (FOV_MAX − FOV_BASE) still caps the kick.
  const targetFov = raftTargetFov(
    speed,
    CAMERA.FOV_SPEED_REFERENCE,
    CAMERA.FOV_SPEED_SCALE,
    CAMERA.FOV_MAX - CAMERA.FOV_BASE,
    getComfort(),
  );
  rt.deps.currentFov.current += (targetFov - rt.deps.currentFov.current) * CAMERA.FOV_LERP;
  if ('fov' in rt.deps.camera) {
    (rt.deps.camera as THREE.PerspectiveCamera).fov = rt.deps.currentFov.current;
    (rt.deps.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }

  return { pos, vel, speed };
}

function updateWorkerPhysicsFrame(rt: RaftRuntimeCtx, body: RapierBody, delta: number) {
  const controls = rt.deps.controls.getControls();
  const { paddleLeft, paddleRight, forward } = controls;
  const { strokeLeft, strokeRight, strokeBoth } = paddleStrokeScales(controls);
  rt.deps.paddleState.current.leftPaddle = paddleLeft;
  rt.deps.paddleState.current.rightPaddle = paddleRight;

  const rot = bodyQuaternion(body);
  const forwardDir = _forward.set(0, 0, -1).applyQuaternion(rot);
  const rightDir = _right.set(1, 0, 0).applyQuaternion(rot);
  // Posted to the worker (structured clone), so a fresh small array per step.
  const impulses: RaftImpulse[] = [];

  if ((paddleLeft && paddleRight) || forward) {
    const power = consumeStamina(rt) * strokeBoth;
    if (power > 0) {
      impulses.push([
        forwardDir.x * PADDLE.THRUST_FORCE * power * delta,
        forwardDir.y * PADDLE.THRUST_FORCE * power * delta,
        forwardDir.z * PADDLE.THRUST_FORCE * power * delta,
      ]);
    }
  } else if (paddleLeft) {
    const power = consumeStamina(rt) * strokeLeft;
    if (power > 0) {
      impulses.push([
        forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * power * delta,
        forwardDir.y * PADDLE.THRUST_FORCE * 0.7 * power * delta,
        forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * power * delta,
      ]);
      impulses.push([
        rightDir.x * PADDLE.THRUST_FORCE * 0.5 * power * delta,
        rightDir.y * PADDLE.THRUST_FORCE * 0.5 * power * delta,
        rightDir.z * PADDLE.THRUST_FORCE * 0.5 * power * delta,
      ]);
    }
  } else if (paddleRight) {
    const power = consumeStamina(rt) * strokeRight;
    if (power > 0) {
      impulses.push([
        forwardDir.x * PADDLE.THRUST_FORCE * 0.7 * power * delta,
        forwardDir.y * PADDLE.THRUST_FORCE * 0.7 * power * delta,
        forwardDir.z * PADDLE.THRUST_FORCE * 0.7 * power * delta,
      ]);
      impulses.push([
        -rightDir.x * PADDLE.THRUST_FORCE * 0.5 * power * delta,
        -rightDir.y * PADDLE.THRUST_FORCE * 0.5 * power * delta,
        -rightDir.z * PADDLE.THRUST_FORCE * 0.5 * power * delta,
      ]);
    }
  }

  rt.deps.stepWorkerProxy(body, delta, impulses);
  updateCameraFromBody(rt, body);
}

/** Refresh the buoyancy state from the staged datum; returns the submerged ratio. */
function updateBuoyancy(rt: RaftRuntimeCtx, raftY: number): number {
  const submergedRatio = calculateSubmergedRatio(rt, raftY);
  rt.deps.buoyancyState.current.submergedRatio = submergedRatio;
  rt.deps.buoyancyState.current.isFloating = submergedRatio > FLOATING_SUBMERGED_RATIO;
  return submergedRatio;
}

/**
 * The raft's physics runtime: the module's step functions bound to one raft's
 * deps. Built once per raft (useRaftControls), never per frame.
 */
export function createRaftPhysicsRuntime(deps: RaftPhysicsRuntimeDeps) {
  const rt: RaftRuntimeCtx = {
    deps,
    sampleWaterLevel: deps.sampleWaterLevel ?? getVehicleWaterLevel,
    paddleModifiers: { cost: 1, regen: 1 },
  };
  return {
    calculateSubmergedRatio: (raftY: number) => calculateSubmergedRatio(rt, raftY),
    updateBuoyancy: (raftY: number) => updateBuoyancy(rt, raftY),
    applyTurbulence: (body: RapierBody, time: number, delta: number) => applyTurbulence(rt, body, time, delta),
    applyTippingForce,
    dampenRotation,
    handleTipping: (body: RapierBody, delta: number) => handleTipping(rt, body, delta),
    tickRaftSurvival: () => tickRaftSurvival(rt),
    paddleModifiers: rt.paddleModifiers,
    updateStamina: (delta: number) => updateStamina(rt, delta),
    consumeStamina: () => consumeStamina(rt),
    applyBrake,
    applyPaddleForces: (body: RapierBody, delta: number) => applyPaddleForces(rt, body, delta),
    spawnFoamParticle: (body: RapierBody, side: 'left' | 'right') => spawnFoamParticle(rt, body, side),
    spawnShedParticle: (body: RapierBody) => spawnShedParticle(rt, body),
    spawnContactBurst: (contactPoint: Vec3Like, impactForce: number) => spawnContactBurst(rt, contactPoint, impactForce),
    resetRaft: (body: RapierBody) => resetRaft(rt, body),
    updateCameraFromBody: (body: RapierBody) => updateCameraFromBody(rt, body),
    updateWorkerPhysicsFrame: (body: RapierBody, delta: number) => updateWorkerPhysicsFrame(rt, body, delta),
  };
}

export type RaftPhysicsRuntime = ReturnType<typeof createRaftPhysicsRuntime>;
