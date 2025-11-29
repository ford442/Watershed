import { OrbitControls } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";
import { Howl } from "howler";
import React from "react";

const Experience = () => {
  const collisionSound = new Howl({
    src: ["/collision.wav"],
  });

  const onCollisionEnter = () => {
    collisionSound.play();
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <OrbitControls />
      <Physics>
        <RigidBody onCollisionEnter={onCollisionEnter}>
          <mesh>
            <boxGeometry />
            <meshStandardMaterial />
          </mesh>
        </RigidBody>
        <RigidBody type="fixed">
          <mesh position={[0, -2, 0]}>
            <boxGeometry args={[10, 1, 10]} />
            <meshStandardMaterial />
          </mesh>
        </RigidBody>
      </Physics>
    </>
  );
};

export default Experience;
