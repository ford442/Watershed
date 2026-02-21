import { PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useState } from "react";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";
import Player from "./components/Player";

const Experience = () => {
  // console.log("[Experience] Rendering...");
  
  const [biome, setBiome] = useState('summer');

  return (
    <KeyboardControls
      map={[
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
        { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
        { name: 'jump', keys: ['Space'] },
      ]}
    >
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
      <Physics gravity={[0, -20, 0]}>
        {/* First-person controls */}
        <PointerLockControls 
          makeDefault 
          lockOnClick
          onLock={() => {/* console.log("Locked—WASD to slide, SPACE to jump!") */}} 
        />
        
        {/* Sonic-style downhill player */}
        <Player />
        
        {/* Procedural track generation */}
        <TrackManager onBiomeChange={setBiome} />
      </Physics>
    </KeyboardControls>
  );
};

export default Experience;
