import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { RunnerVehicle as RunnerVehicleClass } from '../systems/VehicleSystem';

const RunnerVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef(null);
  const { camera } = useThree();
  const [, getKeys] = useKeyboardControls();

  const vehicle = useRef(new RunnerVehicleClass());

  useImperativeHandle(forwardedRef, () => bodyRef.current);

  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(0, 5, 0));
    }
  }, []);

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body) return;

    const pos = body.translation();

    // Get keyboard state (matches the KeyboardControls map in Experience)
    const { forward, backward, leftward, rightward, jump } = getKeys();

    // Camera-relative direction
    const forwardDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();

    const rightDir = new THREE.Vector3();
    rightDir.crossVectors(forwardDir, camera.up).normalize();

    // Feed input to the new VehicleSystem class
    vehicle.current.setInput({
      moveY: forward ? 1 : backward ? -1 : 0,
      moveX: rightward ? 1 : leftward ? -1 : 0,
      jump,
      sprint: false,
      brake: false,
    });

    // Update physics
    vehicle.current.update(delta);

    // Camera follow (first-person, smooth)
    const targetPos = new THREE.Vector3(pos.x, pos.y + 1.65, pos.z);
    camera.position.lerp(targetPos, 0.12);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders="capsule"
      position={[0, 5, 0]}
      mass={1}
      friction={0.04}
      restitution={0.15}
      linearDamping={0.35}
      angularDamping={0.9}
    >
      {/* Invisible for real game, temporary lime wireframe so you can see yourself */}
      <mesh visible={false}>
        <capsuleGeometry args={[0.55, 1.3]} />
      </mesh>
    </RigidBody>
  );
});

export default RunnerVehicle;
