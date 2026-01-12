import { KeyboardControls, Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState } from "react";
import TrackManager from "./components/TrackManager";
import Player from "./components/Player";
import EnhancedSky from "./components/EnhancedSky";

export const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

const Experience = () => {
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['ArrowUp'] },
    { name: Controls.backward, keys: ['KeyS', 'ArrowDown'] },
    { name: Controls.left, keys: ['KeyA', 'ArrowLeft'] },
    { name: Controls.right, keys: ['KeyD', 'ArrowRight'] },
    { name: Controls.jump, keys: ['KeyW', 'Space'] },
  ], []);

  // Biome State (Lifted from TrackManager)
  const [currentBiome, setCurrentBiome] = useState('summer');

  return (
    <KeyboardControls map={map}>
      {/* Environment for realistic reflections */}
      <Environment preset="park" background={false} />

      {/* Dynamic Sky that reacts to the biome */}
      <EnhancedSky biome={currentBiome} />
      
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1.2} castShadow />
      
      <Physics gravity={[0, -9.81, 0]}>
        {/* TrackManager reports biome changes based on player position */}
        <TrackManager onBiomeChange={setCurrentBiome} />
        <Player />
      </Physics>
    </KeyboardControls>
  );
};

export default Experience;
