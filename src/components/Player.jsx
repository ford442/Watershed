import * as THREE from 'three';
import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';

const SPEED = 5;
const JUMP_FORCE = 5;

// Fallback camera position when physics isn't ready
const FALLBACK_POS = new THREE.Vector3(0, -6, 20);

const Player = forwardRef((props, ref) => {
  const { camera, gl } = useThree();
  const rb = useRef();
  const [, getKeys] = useKeyboardControls();

  // Expose the RigidBody API to the parent via ref
  useImperativeHandle(ref, () => rb.current);

  const yaw = useRef(0);
  const pitch = useRef(-0.3); // Start looking slightly down to see terrain
  const isRightMouseDown = useRef(false);
  
  // Track if physics is ready
  const physicsReady = useRef(false);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (e.button === 2) isRightMouseDown.current = true;
    };
    const onMouseUp = (e) => {
      if (e.button === 2) isRightMouseDown.current = false;
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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
    // ALWAYS set camera rotation (even if physics not ready)
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;

    if (rb.current) {
      physicsReady.current = true;
      const pos = rb.current.translation();
      camera.position.set(pos.x, pos.y + 0.8, pos.z);

      const { forward, backward, left, right, jump } = getKeys();

      const direction = new THREE.Vector3(0, 0, 0);
      const frontVector = new THREE.Vector3(0, 0, 0);
      const sideVector = new THREE.Vector3(0, 0, 0);

      // Right click or forward key moves forward (negative Z), S moves backward (positive Z)
      if (isRightMouseDown.current || forward) frontVector.z -= 1;
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
    } else {
      // Physics not ready - use fallback camera position
      if (!physicsReady.current) {
        camera.position.copy(FALLBACK_POS);
      }
    }
  });

  return (
    <>
      {/* Visible player mesh for debugging */}
      <mesh position={[0, -7, -10]}>
        <capsuleGeometry args={[0.5, 1, 4, 8]} />
        <meshBasicMaterial color="yellow" wireframe />
      </mesh>
      
      <RigidBody
        ref={rb}
        // Spawn at track level - track starts at Y=-6 at Z=30, Y=-12 at Z=-60
        // Player spawns at Z=-10, so interpolate: roughly Y=-7
        position={[0, -7, -10]}
        enabledRotations={[false, false, false]}
        colliders={false}
        friction={0}
      >
        <CapsuleCollider args={[0.4, 0.5]} />
      </RigidBody>
    </>
  );
});

export default Player;
