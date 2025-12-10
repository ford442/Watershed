import { KeyboardControls, Sky, OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState } from "react";
import TrackManager from "./components/TrackManager";
import Player from "./components/Player";

export const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

const Experience = () => {
  const [debugMode] = useState(true); // Set to true for debugging
  
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['KeyW'] },
    { name: Controls.backward, keys: ['KeyS'] },
    { name: Controls.left, keys: ['KeyA'] },
    { name: Controls.right, keys: ['KeyD'] },
    { name: Controls.jump, keys: ['Space'] },
  ], [])

  return (
    <KeyboardControls map={map}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 5]} intensity={1.5} castShadow />
      <Sky sunPosition={[100, 50, 100]} />
      {debugMode && <OrbitControls target={[0, 0, -40]} />}
      <Physics>
        <TrackManager />
        {!debugMode && <Player />}
      </Physics>
    </KeyboardControls>
  );
};

export default Experience;
