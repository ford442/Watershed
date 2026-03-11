import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';
import { RaftVehicle as RaftVehicleClass } from '../systems/VehicleSystem';

const RaftVehicle = forwardRef((props, forwardedRef) => {
  const bodyRef = useRef<any>(null);
  const { camera } = useThree();
  const [, getKeys] = useKeyboardControls();
  
  const vehicle = useRef(new RaftVehicleClass());
  
  useImperativeHandle(forwardedRef, () => bodyRef.current);
  
  useEffect(() => {
    if (bodyRef.current) {
      vehicle.current.initialize(bodyRef.current, new THREE.Vector3(0, 5, 0));
      // Initial nudge
      bodyRef.current.applyImpulse({ x: 0, y: 2, z: 0 }, true);
    }
  }, []);
  
  useFrame((state, delta) => {
    if (!bodyRef.current) return;
    
    const body = bodyRef.current;
    const pos = body.translation();
    const { leftward, rightward } = getKeys();
    
    vehicle.current.setInput({
      moveX: rightward ? 1 : leftward ? -1 : 0,
    });
    
    vehicle.current.update(delta);
    
    // Camera follow (smoother for raft)
    const targetPos = new THREE.Vector3(pos.x, pos.y + 2.5, pos.z + 5);
    camera.position.lerp(targetPos, 0.1);
    camera.lookAt(pos.x, pos.y, pos.z);
  });
  
  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      mass={5}
      restitution={0.3}
      linearDamping={2.5}
      angularDamping={3}
      position={[0, 5, 0]}
    >
      {/* Raft deck */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2, 0.3, 3]} />
        <meshStandardMaterial color="saddlebrown" />
      </mesh>
    </RigidBody>
  );
});

export default RaftVehicle;
