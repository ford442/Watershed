import { OrbitControls, Sky } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";
import React from "react";
import CreekCanyon from "./components/CreekCanyon";

const Experience = () => {

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <OrbitControls />
      <Sky sunPosition={[10, 10, 5]} />
      <Physics debug>
        <CreekCanyon />

        {/* Falling box to test physics */}
        <RigidBody position={[0, 10, 0]}>
          <mesh castShadow>
            <boxGeometry />
            <meshStandardMaterial color="orange" />
          </mesh>
        </RigidBody>
      </Physics>
    </>
  );
};

export default Experience;
