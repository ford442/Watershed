import * as THREE from 'three';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/VehicleSystem';
import { MOVEMENT } from '../../../constants/game';
import { useGameStore } from '../../../systems/GameState';
import { DodgeState, DebugContact } from '../constants';
import { RAYCAST_ORIGIN_OFFSET, RAYCAST_DISTANCE, SLOPE_RANGES } from '../constants';

export function calculateSlopeAngle({ body, world, rapier, slopeState }): number {
  if (!body || !world) return 0;

  const pos = body.translation();

  // Primary path: use castRayAndGetNormal to obtain the true trimesh face normal.
  // This gives accurate per-triangle surface orientation on the canyon walls and U-banks,
  // which the height-gradient fallback cannot capture for near-vertical faces.
  // Note: castRayAndGetNormal exists in rapier3d-compat 0.19+ but @react-three/rapier's
  // TypeScript types may not declare it, hence the runtime presence check via `as any`.
  const centerOrigin = { x: pos.x, y: pos.y + RAYCAST_ORIGIN_OFFSET, z: pos.z };
  const centerNormalRay = new rapier.Ray(centerOrigin, { x: 0, y: -1, z: 0 });
  const normalHit = (world as any).castRayAndGetNormal
    ? (world as any).castRayAndGetNormal(centerNormalRay, RAYCAST_DISTANCE, true)
    : null;
  if (typeof (centerNormalRay as any).free === 'function') (centerNormalRay as any).free();

  if (normalHit) {
    const n = normalHit.normal ?? normalHit;
    const nLen = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (nLen > 0.001) {
      slopeState.current.lastGroundNormal.set(n.x / nLen, n.y / nLen, n.z / nLen);
    }
    if (typeof (normalHit as any).free === 'function') (normalHit as any).free();

    const gn = slopeState.current.lastGroundNormal;
    // Bank angle: atan2(gn.x, gn.y) gives the lateral tilt of the surface normal.
    // Positive = normal leans toward +X (left wall tilts toward player from right side),
    // negative = normal leans toward -X.
    slopeState.current.bankAngle = (Math.atan2(gn.x, gn.y) * 180) / Math.PI;
    // Pitch angle: forward/back slope; keep existing sign convention (negative = downhill forward)
    const pitchAngleRad = Math.atan2(-gn.z, gn.y);
    let angleDeg = (pitchAngleRad * 180) / Math.PI;
    return Math.max(-60, Math.min(60, angleDeg));
  }

  // Fallback: five-point height-gradient sampling when castRayAndGetNormal unavailable
  const rayLength = RAYCAST_DISTANCE;
  const castRay = (offsetX: number, offsetZ: number): number | null => {
    const origin = {
      x: pos.x + offsetX,
      y: pos.y + RAYCAST_ORIGIN_OFFSET,
      z: pos.z + offsetZ
    };
    const ray = new rapier.Ray(origin, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, rayLength, true);
    const toi = hit ? (typeof (hit as any).timeOfImpact === 'function' ? (hit as any).timeOfImpact() : hit.timeOfImpact) : null;
    if (hit && typeof (hit as any).free === 'function') (hit as any).free();
    if (typeof (ray as any).free === 'function') (ray as any).free();
    if (toi === null) return null;
    return origin.y - toi;
  };

  const sampleDist = 0.5;
  const hCenter = castRay(0, 0);
  const hForward = castRay(0, -sampleDist);
  const hBack = castRay(0, sampleDist);

  if (hCenter === null) return 0;

  const hLeft = castRay(-sampleDist, 0);
  const hRight = castRay(sampleDist, 0);

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

  let slopeX = 0;
  let samplesX = 0;
  if (hLeft !== null) { slopeX += (hLeft - hCenter) / sampleDist; samplesX++; }
  if (hRight !== null) { slopeX += (hCenter - hRight) / sampleDist; samplesX++; }
  if (samplesX > 0) slopeX /= samplesX;

  // Store bank angle from height gradient
  slopeState.current.bankAngle = (Math.atan(slopeX) * 180) / Math.PI;

  const nx = -slopeX;
  const ny = 1.0;
  const nz = -slopeZ;
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nLen > 0.001) {
    slopeState.current.lastGroundNormal.set(nx / nLen, ny / nLen, nz / nLen);
  }

  const angleRad = Math.atan(slopeZ);
  let angleDeg = (angleRad * 180) / Math.PI;
  angleDeg = Math.max(-60, Math.min(60, angleDeg));

  return angleDeg;
}

export function calculateSlopeMultiplier(angle: number): number {
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
}

export function handleDodgeAndCollision({
    dodgeState, dodgeJustPressed, isGrounded, camera, leftward, rightward, forward, backward, dt,
    body, pos, vel, prevFrame, js, vehicle, collisionState, debugState, now
}) {
    // === DODGE STATE MACHINE (Goal 2) ===
    const ds = dodgeState.current;
    switch (ds.state) {
      case 'ready': {
        if (dodgeJustPressed && isGrounded) {
          ds.state = 'dodging';
          ds.timer = MOVEMENT.DODGE_DURATION;
          ds.nearMissAwarded = false;

          // Determine dodge direction from input
          const forwardDir = new THREE.Vector3();
          camera.getWorldDirection(forwardDir);
          forwardDir.y = 0;
          forwardDir.normalize();
          const rightDir = new THREE.Vector3();
          rightDir.crossVectors(forwardDir, camera.up).normalize();

          ds.direction.set(0, 0, 0);
          if (leftward) {
            ds.direction.sub(rightDir);
          } else if (rightward) {
            ds.direction.add(rightDir);
          } else if (controls.getControls().backward) {
            ds.direction.sub(forwardDir);
          } else {
            ds.direction.add(forwardDir);
          }
          if (ds.direction.lengthSq() < 0.001) {
            ds.direction.copy(rightDir); // Default dodge right
          }
          ds.direction.normalize();

          // Apply dodge impulse
          applyImpulseWithDebugTracking('dodge', {
            x: ds.direction.x * MOVEMENT.DODGE_FORCE,
            y: 2.0, // Slight upward lift
            z: ds.direction.z * MOVEMENT.DODGE_FORCE
          });

          // I-frames: temporarily disable collision with obstacles (not ground)
          // We achieve this by applying a collision group mask if supported
          try {
            // Rapier doesn't have simple collision group toggling on RigidBody ref,
            // so we use a flag that other systems can check
            body.userData = { ...body.userData, isDodging: true };
          } catch (e) { /* ignore */ }

          playDodgeSound();
          triggerCameraShake(0.3, 0.15);

          // Broadcast dodge state for HUD
          window.dispatchEvent(new CustomEvent('player-dodge', { detail: { state: 'start' } }));
          useGameStore.getState().setIsDodging(true);
        }
        break;
      }

      case 'dodging': {
        const dodgeSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        if (!ds.nearMissAwarded && dodgeSpeed >= NEAR_MISS_SPEED_THRESHOLD) {
          const sideDir = new THREE.Vector3(-ds.direction.z, 0, ds.direction.x);
          if (sideDir.lengthSq() > 0.001) {
            sideDir.normalize();
            const rayOrigin = { x: pos.x, y: pos.y + 0.6, z: pos.z };
            const checkSide = (sign: number) => {
              const dir = sideDir.clone().multiplyScalar(sign);
              const ray = new rapier.Ray(rayOrigin, { x: dir.x, y: 0, z: dir.z });
              const hit = world.castRay(ray, NEAR_MISS_RAY_LENGTH, true);
              const toi = hit
                ? (typeof (hit as any).timeOfImpact === 'function'
                  ? (hit as any).timeOfImpact()
                  : (hit as any).timeOfImpact)
                : null;
              if (hit && typeof (hit as any).free === 'function') (hit as any).free();
              return toi !== null && toi >= NEAR_MISS_TOI_MIN && toi <= NEAR_MISS_TOI_MAX;
            };

            if (checkSide(1) || checkSide(-1)) {
              ds.nearMissAwarded = true;
              window.dispatchEvent(new CustomEvent('player-near-miss', { detail: { speed: dodgeSpeed } }));
            }
          }
        }

        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'cooldown';
          ds.timer = MOVEMENT.DODGE_COOLDOWN;
          try {
            body.userData = { ...body.userData, isDodging: false };
          } catch (e) { /* ignore */ }
          window.dispatchEvent(new CustomEvent('player-dodge', { detail: { state: 'end' } }));
          useGameStore.getState().setIsDodging(false);
        }
        break;
      }

      case 'cooldown': {
        ds.timer -= dt;
        if (ds.timer <= 0) {
          ds.state = 'ready';
        }
        break;
      }
    }

    // === COLLISION DETECTION ===
    // Check for sudden velocity changes indicating collision
    const prevVelocity = prevFrame.current.velocity;
    const velocityDelta = new THREE.Vector3(vel.x - prevVelocity.x, vel.y - prevVelocity.y, vel.z - prevVelocity.z);
    const impactForce = velocityDelta.length() / dt;

    // Detect high-impact collision (skip if dodging with i-frames)
    const isDodging = ds.state === 'dodging' && ds.timer > (MOVEMENT.DODGE_DURATION - MOVEMENT.DODGE_I_FRAMES);
    if (impactForce > 8 && !isGrounded && !isDodging) {
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
        debugState.current.recentContacts.push({
          at: now,
          point: { x: contactPoint.x, y: contactPoint.y, z: contactPoint.z },
        });
      }
    }


}
