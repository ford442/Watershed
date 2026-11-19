/**
 * Stage 5 — integrate (#559 C, from `RunnerPhysicsStep.ts`): the slope-aware
 * speed cap, slide / bank friction, platform riding.
 */
import * as THREE from 'three';
import { MOVEMENT } from '../../../../constants/game';
import { VEHICLE_TUNING } from '../../../../constants/vehicleTuning';
import { RUNNER_CONTACT_FRICTION } from '../../../../systems/vehicle/VehicleSystem';
import { BANK_CONFIG } from '../../constants';
import { bankT, type StepFrame } from './stepFrame';

/**
 * Contact friction `f.friction` on every collider of the body (debug-mirrored).
 * Written to Rapier only when it changes (Rapier keeps it): the value rides in
 * a field, not an argument, so the steady state passes no double across a call.
 */
function applyBodyFriction(f: StepFrame): void {
  const { s } = f;
  const { body, vehicleState } = f.args;
  vehicleState.debugState.current.friction = f.friction;
  try {
    const n = body.numColliders();
    if (s.applied.body === body && s.applied.colliders === n && s.applied.friction === f.friction) return;
    for (let i = 0; i < n; i++) body.collider(i).setFriction(f.friction);
    s.applied.body = body;
    s.applied.colliders = n;
    s.applied.friction = f.friction;
  } catch (_e) {
    // Fallback: friction not adjustable on this body
  }
}

/** The slope-aware speed cap, slide / bank friction, platform riding. */
export function integrate(f: StepFrame): void {
  const { args, s, dt, vel, isGrounded } = f;
  const { vehicleState } = args;
  const slope = vehicleState.slopeState.current;
  const flowMultiplier = Number.isFinite(slope.currentMultiplier) ? slope.currentMultiplier : 1.0;

  // === SLOPE-AWARE HORIZONTAL SPEED CAP ===
  // Reward momentum on steep downhill terrain while preventing physics explosions:
  // cap = maxHorizontalSpeed * (1 + slopeBonusScale * (flowMultiplier - 1)).
  const effectiveMaxH = VEHICLE_TUNING.maxHorizontalSpeed *
    (1 + VEHICLE_TUNING.slopeBonusScale * (flowMultiplier - 1));
  const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (horizSpeed > effectiveMaxH && Number.isFinite(horizSpeed) && horizSpeed > 0) {
    const scale = effectiveMaxH / horizSpeed;
    const lv = s.impulse;
    lv.x = vel.x * scale;
    lv.y = vel.y;
    lv.z = vel.z * scale;
    s.setLinvelSafe(lv);
  }

  // Goal 2: Slide mechanic — activate on steep forward pitch OR steep lateral bank
  const isSlideInput = args.controls.getControls().brake &&
    (f.slopeAngle > MOVEMENT.SLIDE_MIN_SLOPE ||
     Math.abs(slope.bankAngle) > MOVEMENT.SLIDE_MIN_SLOPE);
  const { forwardDir } = s;
  if (isSlideInput && isGrounded) {
    // Reduce friction during slide for speed boost; on a bank the slide runs along the wall
    f.friction = MOVEMENT.SLIDE_FRICTION;
    applyBodyFriction(f);
    const slideBoost = MOVEMENT.SLIDE_SPEED_BOOST;
    const im = s.impulse;
    im.x = forwardDir.x * f.speed * (slideBoost - 1.0) * dt;
    im.y = 0;
    im.z = forwardDir.z * f.speed * (slideBoost - 1.0) * dt;
    s.applyImpulse('slideBoost', im);
  } else {
    // The runner's own contact friction; on steep banks lower, for smooth wall-riding.
    const absBank = Math.abs(slope.bankAngle);
    f.friction = absBank > BANK_CONFIG.ASSIST_THRESHOLD
      ? THREE.MathUtils.lerp(
          RUNNER_CONTACT_FRICTION,
          MOVEMENT.SLIDE_FRICTION * BANK_CONFIG.BANK_FRICTION_MULTIPLIER,
          bankT(absBank),
        )
      : RUNNER_CONTACT_FRICTION;
    applyBodyFriction(f);
  }

  // Goal 2: Platform riding - apply platform velocity to player
  const platform = vehicleState.platformState.current;
  if (platform.isOnPlatform) {
    const pVel = platform.platformVelocity;
    const transfer = MOVEMENT.PLAYER_MOMENTUM_TRANSFER ?? 0.3;
    const im = s.impulse;
    im.x = (pVel.x - vel.x) * transfer;
    im.y = (pVel.y - vel.y) * transfer * 0.5; // Less vertical transfer
    im.z = (pVel.z - vel.z) * transfer;
    s.applyImpulse('platformTransfer', im);
  }
}
