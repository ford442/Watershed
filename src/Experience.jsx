import { KeyboardControls, Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState, Suspense, useRef } from "react";
import TrackManager from "./components/TrackManager";
import Player from "./components/Player";
import EnhancedSky from "./components/EnhancedSky";
import SplashParticles from "./components/VFX/SplashParticles";

export const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

const Experience = () => {
  console.log("Experience Rendered");
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['ArrowUp'] },
    { name: Controls.backward, keys: ['KeyS', 'ArrowDown'] },
    { name: Controls.left, keys: ['KeyA', 'ArrowLeft'] },
    { name: Controls.right, keys: ['KeyD', 'ArrowRight'] },
    { name: Controls.jump, keys: ['KeyW', 'Space'] },
  ], []);

  // Biome State (Lifted from TrackManager)
  const [currentBiome, setCurrentBiome] = useState('summer');

  // Reference to the Player's RigidBody
  const playerRef = useRef();

  return (
    <>
      {/* Set background color to avoid blank screen */}
      <color attach="background" args={['#87CEEB']} />

      {/* Debug: Simple box to confirm rendering */}
      <mesh position={[0, 0, -5]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial color="green" />
      </mesh>

      <KeyboardControls map={map}>
      {/* Environment/Sky in Suspense */}
      <Suspense fallback={null}>
        <Environment preset="park" background={false} />
        <EnhancedSky biome={currentBiome} />
      </Suspense>

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1.2} castShadow />

        {/* 2. Main Game Physics Loop */}
        <Suspense fallback={
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[5, 5, 5]} />
            <meshBasicMaterial color="red" wireframe />
          </mesh>
        }>
        <Physics gravity={[0, -9.81, 0]}>
            {/* TrackManager reports biome changes based on player position */}
            <TrackManager onBiomeChange={setCurrentBiome} />
            <Player ref={playerRef} />
        </Physics>

        {/* Visual Effects */}
        <SplashParticles target={playerRef} />
      </Suspense>
      </KeyboardControls>
    </>
  );
};

export default Experience;
