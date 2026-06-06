import * as THREE from 'three';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/VehicleSystem';
import { MOVEMENT } from '../../../constants/game';
import { useGameStore } from '../../../systems/GameState';
import { DodgeState, DebugContact } from '../constants';

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
