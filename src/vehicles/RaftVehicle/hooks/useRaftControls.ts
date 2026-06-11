import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useRapier } from '@react-three/rapier';
import { usePlayerControls } from '../../../hooks/usePlayerControls';
import { SurfaceMaterial, MATERIAL_FROM_BIOME } from '../../../systems/VehicleSystem';
import { WATER_LEVEL, PLAYER_SPAWN } from '../../../constants/game';
import { calculateFlowForce, applyWaterForce } from '../../../physics/WaterForces';
import {
    WATER_PHYSICS, DENSITY, TIPPING, PADDLE, STAMINA, BRAKE, COLLISION, BIAS, CAMERA, SHED
} from '../constants';
import { playPaddleSound, playSplashSound, playCollisionSound, updateWaterRushingSound } from '../audio';

export function useRaftControls({
    bodyRef, raftVehicle, camera, controls, workerProxy,
    buoyancyState, tippingState, paddleState, staminaState,
    stunState, forwardBiasState, shedParticles, collisionState,
    lastWorkerSync, sharedPhysicsState
}) {
    const { world, rapier } = useRapier();

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


}
