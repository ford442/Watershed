import { PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useState } from "react";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";
import Player from "./components/Player";

const BIOME_LIGHTING = {
  summer: {
    ambientIntensity: 0.45,
    hemiSky: '#a8d8ff',
    hemiGround: '#3a3020',
    hemiIntensity: 0.9,
    dirColor: '#fff8e8',
    dirIntensity: 1.3,
    dirPosition: [10, 30, 15],
    fillColor: '#a8c8ff',
    fillIntensity: 0.25,
  },
  autumn: {
    ambientIntensity: 0.35,
    hemiSky: '#f0c878',
    hemiGround: '#3a2810',
    hemiIntensity: 0.7,
    dirColor: '#ffa840',
    dirIntensity: 1.0,
    dirPosition: [30, 20, 10],
    fillColor: '#ffd0a0',
    fillIntensity: 0.2,
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
