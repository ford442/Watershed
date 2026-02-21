import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { RigidBody } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';

const Raft = forwardRef((props, forwardedRef) => {
  const raftRef = useRef(null);
  
  // Expose the RigidBody ref to parent
  useImperativeHandle(forwardedRef, () => raftRef.current);

  useEffect(() => {
    if (raftRef.current) {
      raftRef.current.applyImpulse({ x: 0, y: 2, z: 0 }); // starter nudge
    }
  }, []);

  // River current + wobble
  useFrame(() => {
    if (!raftRef.current) return;

    const body = raftRef.current;

    // Constant forward push (downhill river flow)
    body.applyImpulse({ x: 0, y: 0, z: -1.2 }, true);

    // Tiny random turbulence (like rapids)
    const noise = Math.sin(Date.now() * 0.001) * 0.3;
    body.applyImpulse({ x: noise * 0.5, y: noise * 0.2, z: noise }, true);

    // Cap speed so it doesn't go supersonic
    const vel = body.linvel();
    if (Math.abs(vel.z) > 15) {
      body.setLinvel({ x: vel.x, y: vel.y, z: 15 * Math.sign(vel.z) }, true);
    }
  });

  return (
    <RigidBody 
      ref={raftRef} 
      name="raft-body"
      type="dynamic" 
      mass={5} 
      restitution={0.3}
      linearDamping={2.5}
      angularDamping={3}
      position={[0, 5, 0]}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2, 0.3, 3]} />
        <meshStandardMaterial color="saddlebrown" />
      </mesh>
      {/* Debug marker */}
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color="hotpink" />
      </mesh>
    </RigidBody>
  );
});

export default Raft;
