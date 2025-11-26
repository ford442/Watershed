import { OrbitControls, Sky, useTexture } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";
import { Howl } from "howler";
import React from "react";

const Experience = () => {
  const collisionSound = new Howl({
    src: ["collision.wav"],
  });

  const onCollisionEnter = () => {
    collisionSound.play();
  };

  const [colorMap, normalMap] = useTexture([
    "Rock031_1K-JPG_Color.jpg",
    "Rock031_1K-JPG_NormalGL.jpg",
  ]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <OrbitControls />
      <Sky />
      <Physics>
        <RigidBody onCollisionEnter={onCollisionEnter}>
          <mesh>
            <boxGeometry />
            <meshStandardMaterial map={colorMap} normalMap={normalMap} />
          </mesh>
        </RigidBody>
        <RigidBody type="fixed">
          <mesh position={[0, -2, 0]}>
            <boxGeometry args={[10, 1, 10]} />
            <meshStandardMaterial map={colorMap} normalMap={normalMap} />
          </mesh>
        </RigidBody>
      </Physics>
    </>
  );
};

export default Experience;
