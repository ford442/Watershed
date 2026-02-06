import { KeyboardControls, Environment, Html } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState, Suspense, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from 'three';
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

// Simple debug mesh to verify rendering is working
const DebugScene = () => {
  const { camera } = useThree();
  
  useEffect(() => {
    console.log('[DebugScene] Mounted');
    console.log('[DebugScene] Camera position:', camera.position.toArray());
  }, [camera]);
  
  useFrame((state) => {
    // Rotate the debug cube
    state.scene.getObjectByName('debug-cube')?.rotation.set(
      state.clock.elapsedTime * 0.5,
      state.clock.elapsedTime * 0.3,
      0
    );
  });
  
  return (
    <>
      {/* A bright red cube at origin */}
      <mesh name="debug-cube" position={[0, 0, 0]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>
      
      {/* A green cube at player spawn */}
      <mesh position={[0, -7, -10]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="green" />
      </mesh>
      
      {/* A blue cube at track start */}
      <mesh position={[0, -6, 30]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="blue" />
      </mesh>
      
      {/* Grid helper at track level */}
      <gridHelper args={[100, 50, 'white', 'gray']} position={[0, -6, 0]} />
      
      {/* Axes helper */}
      <axesHelper args={[5]} position={[0, -6, 0]} />
      
      {/* Some text */}
      <Html center position={[0, 5, 0]}>
        <div style={{ 
          color: 'white', 
          background: 'rgba(0,0,0,0.7)', 
          padding: '10px 20px',
          borderRadius: '4px',
          fontFamily: 'sans-serif',
          fontSize: '18px',
          whiteSpace: 'nowrap'
        }}>
          Debug View - If you see this, React Three Fiber is working!
        </div>
      </Html>
    </>
  );
};

const Experience = () => {
  console.log("[Experience] Component rendering...");
  
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['ArrowUp'] },
    { name: Controls.backward, keys: ['KeyS', 'ArrowDown'] },
    { name: Controls.left, keys: ['KeyA', 'ArrowLeft'] },
    { name: Controls.right, keys: ['KeyD', 'ArrowRight'] },
    { name: Controls.jump, keys: ['KeyW', 'Space'] },
  ], []);

  const [currentBiome, setCurrentBiome] = useState('summer');
  const playerRef = useRef();
  const { scene, camera } = useThree();
  
  useEffect(() => {
    console.log('[Experience] Mounted');
    console.log('[Experience] Scene children:', scene.children.length);
    console.log('[Experience] Camera:', camera.position.toArray());
  }, []);

  return (
    <>
      <color attach="background" args={['#1a1a2e']} />
      
      {/* Always render debug scene first */}
      <DebugScene />

      <KeyboardControls map={map}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 5]} intensity={1.2} castShadow />

        <Suspense fallback={
          <Html center>
            <div style={{ color: 'white', background: 'rgba(0,0,0,0.7)', padding: '10px' }}>
              Loading Environment...
            </div>
          </Html>
        }>
          <Environment preset="park" background={false} />
          <EnhancedSky biome={currentBiome} />
        </Suspense>

        <Physics gravity={[0, -9.81, 0]}>
          <Suspense fallback={null}>
            <TrackManager onBiomeChange={setCurrentBiome} />
          </Suspense>
          <Player ref={playerRef} />
        </Physics>

        <SplashParticles target={playerRef} />
      </KeyboardControls>
    </>
  );
};

export default Experience;
