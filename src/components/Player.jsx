import * as THREE from 'three';
import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';

const SPEED = 5;
const JUMP_FORCE = 5;

export default function Player() {
  const { camera, gl } = useThree();
  const rb = useRef();
  const [, getKeys] = useKeyboardControls();

  const yaw = useRef(0);
  const pitch = useRef(0);

  useEffect(() => {
    const onClick = () => gl.domElement.requestPointerLock();
    gl.domElement.addEventListener('click', onClick);
    return () => gl.domElement.removeEventListener('click', onClick);
  }, [gl]);

  useEffect(() => {
    const onContextMenu = (e) => {
      e.preventDefault();
    }

    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
    }
  }, []);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (document.pointerLockElement !== gl.domElement) return;

      yaw.current -= e.movementX * 0.002;
      pitch.current -= e.movementY * 0.002;

      pitch.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch.current));
    }

    document.addEventListener('mousemove', onMouseMove);
    return () => document.removeEventListener('mousemove', onMouseMove);
  }, [gl]);

  useFrame(() => {
    if (!rb.current) return;

    const pos = rb.current.translation();
    camera.position.set(pos.x, pos.y + 0.8, pos.z);

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;

    const { forward, backward, left, right, jump } = getKeys();

    const direction = new THREE.Vector3(0, 0, 0);
    const frontVector = new THREE.Vector3(0, 0, 0);
    const sideVector = new THREE.Vector3(0, 0, 0);

    // W moves forward (negative Z), S moves backward (positive Z)
    if (forward) frontVector.z -= 1;
    if (backward) frontVector.z += 1;

    // A moves left (negative X), D moves right (positive X)
    if (left) sideVector.x -= 1;
    if (right) sideVector.x += 1;

    direction.addVectors(frontVector, sideVector);

    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(SPEED);
      // Apply yaw rotation so movement is relative to camera direction
      direction.applyEuler(new THREE.Euler(0, yaw.current, 0));
    }

    const linvel = rb.current.linvel();
    rb.current.setLinvel({ x: direction.x, y: linvel.y, z: direction.z });

    if (jump && Math.abs(linvel.y) < 0.1) {
      rb.current.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 });
    }
  });

  return (
    <RigidBody
      ref={rb}
      position={[0, 10, 0]}
      enabledRotations={[false, false, false]}
      colliders={false}
      friction={0}
    >
      <CapsuleCollider args={[0.4, 0.5]} />
    </RigidBody>
  );
}
