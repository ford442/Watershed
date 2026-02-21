import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';

export default function Player() {
  const bodyRef = useRef(null);
  const { camera } = useThree();

  const [sub, get] = useKeyboardControls();
  const isGrounded = useRef(false);

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body) return;

    const pos = body.translation();
    const vel = body.linvel();

    const { forward, backward, leftward, rightward, jump } = get();
    
    // DEBUG: Log key presses
    if (forward || backward || leftward || rightward || jump) {
      console.log('Keys:', { forward, backward, leftward, rightward, jump });
    }

    // ── Get camera direction (relative movement) ──
    const forwardDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;               // no flying
    forwardDir.normalize();

    const rightDir = new THREE.Vector3();
    rightDir.crossVectors(forwardDir, camera.up).normalize();

    // ── AUTO RIVER FLOW (Sonic downhill rush) ──
    body.applyImpulse({ x: 0, y: 0, z: -14 * delta }, true);

    // ── PLAYER INPUT (relative to look) ──
    const speed = 32;
    if (forward) {
      console.log('Applying forward impulse');
      body.applyImpulse({ x: forwardDir.x * speed * delta, y: 0, z: forwardDir.z * speed * delta }, true);
    }
    if (backward) {
      console.log('Applying backward impulse');
      body.applyImpulse({ x: forwardDir.x * -speed * 0.6 * delta, y: 0, z: forwardDir.z * -speed * 0.6 * delta }, true);
    }
    if (leftward) {
      console.log('Applying leftward impulse');
      body.applyImpulse({ x: rightDir.x * -speed * 0.8 * delta, y: 0, z: rightDir.z * -speed * 0.8 * delta }, true);
    }
    if (rightward) {
      console.log('Applying rightward impulse');
      body.applyImpulse({ x: rightDir.x * speed * 0.8 * delta, y: 0, z: rightDir.z * speed * 0.8 * delta }, true);
    }

    // ── JUMP ──
    if (jump && isGrounded.current) {
      body.applyImpulse({ x: 0, y: 22, z: 0 }, true);
      isGrounded.current = false;
    }

    // ── GROUND CHECK (Rapier raycast down) ──
    if (typeof window !== 'undefined' && (window as any).RAPIER) {
      const ray = new (window as any).RAPIER.Ray(
        { x: pos.x, y: pos.y + 0.2, z: pos.z },
        { x: 0, y: -1, z: 0 }
      );
      const hit = body.getWorld().castRay(ray, 1.5, true);
      isGrounded.current = !!hit;
    } else {
      isGrounded.current = true; // fallback
    }

    // ── CAMERA FOLLOW (eye height) ──
    camera.position.set(pos.x, pos.y + 1.65, pos.z);
    
    // DEBUG: Log position occasionally
    if (Math.random() < 0.01) {
      console.log('Player pos:', pos, 'vel:', vel);
    }
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders="capsule"
      position={[0, -2, 0]}     // start just above the track
      mass={1}
      friction={0.04}           // super slippery river feel
      restitution={0.15}
      linearDamping={0.35}
      angularDamping={0.9}
    >
      {/* invisible capsule collider */}
      <mesh visible={false}>
        <capsuleGeometry args={[0.55, 1.3]} />
      </mesh>
    </RigidBody>
  );
}
