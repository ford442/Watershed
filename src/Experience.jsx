import { KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState } from "react";
import Player from "./components/Player";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";

export const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

const Experience = () => {
  console.log("[Experience] Rendering...");
  
  const [biome, setBiome] = useState('summer');
  
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['ArrowUp'] },
    { name: Controls.backward, keys: ['KeyS', 'ArrowDown'] },
    { name: Controls.left, keys: ['KeyA', 'ArrowLeft'] },
    { name: Controls.right, keys: ['KeyD', 'ArrowRight'] },
    { name: Controls.jump, keys: ['KeyW', 'Space'] },
  ], []);

  return (
    <KeyboardControls map={map}>
      {/* Sky and environment */}
      <EnhancedSky biome={biome} />
      
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <directionalLight 
        position={[100, 50, 100]} 
        intensity={1.5} 
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      
      {/* Physics world */}
      <Physics gravity={[0, -9.81, 0]}>
        {/* Player with first-person controls */}
        <Player />
        
        {/* Procedural track generation */}
        <TrackManager onBiomeChange={setBiome} />
      </Physics>
    </KeyboardControls>
  );
};

export default Experience;
