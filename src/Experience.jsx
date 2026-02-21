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
      <ambientLight intensity={0.4} />
      <hemisphereLight 
        skyColor="#a0d8ff" 
        groundColor="#4a3f2f" 
        intensity={0.8} 
      />
      <directionalLight 
        position={[10, 30, 15]} 
        intensity={1.2} 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
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
