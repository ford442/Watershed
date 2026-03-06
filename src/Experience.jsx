import { PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useState } from "react";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";
import Player from "./components/Player";

const BIOME_LIGHTING = {
  summer: {
    ambientIntensity: 0.40,       // Slightly reduced to let directional light pop more
    hemiSky: '#9ad0f0',           // Cooler blue-white, closer to water/fog palette
    hemiGround: '#3a3828',        // Warmer ground bounce for wet-rock look
    hemiIntensity: 0.85,
    dirColor: '#fff4e0',          // Warm sunlight, slightly less yellow
    dirIntensity: 1.4,            // Stronger key light for sharper canyon shadows
    dirPosition: [12, 35, 18],    // Higher sun for better canyon illumination
    fillColor: '#a0c4e8',         // Cool-blue fill matching water tones
    fillIntensity: 0.22,
  },
  autumn: {
    ambientIntensity: 0.32,       // Slightly darker mood
    hemiSky: '#e8c070',           // Muted gold, less saturated
    hemiGround: '#382818',        // Deeper earthy ground bounce
    hemiIntensity: 0.65,
    dirColor: '#ffa040',          // Warm amber key
    dirIntensity: 1.1,            // Slightly stronger for better readability
    dirPosition: [30, 22, 12],    // Small lift for better reach into canyon
    fillColor: '#ffc888',         // Warm fill, less intense
    fillIntensity: 0.18,
  },
};

const Experience = () => {
  const [biome, setBiome] = useState('summer');
  const L = BIOME_LIGHTING[biome] || BIOME_LIGHTING.summer;

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
      
      {/* Lighting - biome responsive */}
      <ambientLight intensity={L.ambientIntensity} />
      <hemisphereLight 
        skyColor={L.hemiSky}
        groundColor={L.hemiGround}
        intensity={L.hemiIntensity}
      />
      <directionalLight 
        color={L.dirColor}
        position={L.dirPosition}
        intensity={L.dirIntensity}
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/* Soft fill light from opposite side to reduce harsh shadows */}
      <directionalLight
        color={L.fillColor}
        position={[-10, 15, -20]}
        intensity={L.fillIntensity}
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
