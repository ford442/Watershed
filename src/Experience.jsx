import { KeyboardControls, Sky } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo } from "react";
import CreekCanyon from "./components/CreekCanyon";
import Player from "./components/Player";

export const Controls = {
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

const Experience = () => {
  const map = useMemo(()=>[
    { name: Controls.backward, keys: ['KeyS'] },
    { name: Controls.left, keys: ['KeyA'] },
    { name: Controls.right, keys: ['KeyD'] },
    { name: Controls.jump, keys: ['KeyW'] },
  ], [])

  return (
    <KeyboardControls map={map}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <Sky sunPosition={[10, 10, 5]} />
      <Physics debug>
        <CreekCanyon />
        <Player />
      </Physics>
    </KeyboardControls>
  );
};

export default Experience;
