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

    // ── Camera direction for relative movement ──
    const forwardDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();

    const rightDir = new THREE.Vector3();
    rightDir.crossVectors(forwardDir, camera.up).normalize();

    // ── AUTO RIVER FLOW ──
    body.applyImpulse({ x: 0, y: 0, z: -14 * delta }, true);

    // ── PLAYER INPUT ──
    const speed = 32;
    if (forward)  body.applyImpulse({ x: forwardDir.x * speed * delta, y: 0, z: forwardDir.z * speed * delta }, true);
    if (backward) body.applyImpulse({ x: forwardDir.x * -speed * 0.6 * delta, y: 0, z: forwardDir.z * -speed * 0.6 * delta }, true);
    if (leftward) body.applyImpulse({ x: rightDir.x * -speed * 0.8 * delta, y: 0, z: rightDir.z * -speed * 0.8 * delta }, true);
    if (rightward) body.applyImpulse({ x: rightDir.x * speed * 0.8 * delta, y: 0, z: rightDir.z * speed * 0.8 * delta }, true);

    // ── JUMP ──
    if (jump && isGrounded.current) {
      body.applyImpulse({ x: 0, y: 22, z: 0 }, true);
      isGrounded.current = false;
    }

    // ── GROUND CHECK ──
    const ray = new window.RAPIER.Ray({ x: pos.x, y: pos.y + 0.2, z: pos.z }, { x: 0, y: -1, z: 0 });
    const hit = body.getWorld().castRay(ray, 1.5, true);
    isGrounded.current = !!hit;

    // ── SMOOTH CAMERA FOLLOW (no fighting PointerLockControls) ──
    const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
    camera.position.lerp(targetPos, 0.15); // smooth follow
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders="capsule"
      position={[0, 5, 0]}        // ← SAFE START (track should be right here)
      mass={1}
      friction={0.04}
      restitution={0.15}
      linearDamping={0.35}
      angularDamping={0.9}
    >
      {/* TEMPORARY VISIBLE PLAYER so you can see where you are */}
      <mesh>
        <capsuleGeometry args={[0.55, 1.3]} />
        <meshBasicMaterial color="lime" wireframe />
      </mesh>
    </RigidBody>
  );
}
