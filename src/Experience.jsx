import { KeyboardControls, Environment, Html } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useMemo, useState, Suspense, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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

// Debug component to verify useFrame is working
const FrameDebugger = () => {
  const frameCount = useRef(0);
  const lastLog = useRef(0);

  useFrame(() => {
    frameCount.current++;
    const now = Date.now();
    if (now - lastLog.current > 5000) { // Log every 5 seconds
      console.log(`[FrameDebugger] Frames rendered: ${frameCount.current}`);
      lastLog.current = now;
    }
  });

  return null;
};

// Physics error handler wrapper
const PhysicsWithErrorHandler = ({ children }: { children: React.ReactNode }) => {
  const [physicsError, setPhysicsError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[Physics] Initializing Rapier physics engine...');
  }, []);

  if (physicsError) {
    console.error('[Physics] Failed to initialize:', physicsError);
    return (
      <Html center>
        <div style={{ color: 'red', background: 'white', padding: '20px', borderRadius: '8px' }}>
          <h3>Physics Engine Error</h3>
          <p>{physicsError}</p>
        </div>
      </Html>
    );
  }

  return (
    <Physics 
      gravity={[0, -9.81, 0]}
      debug={false}
    >
      {children}
    </Physics>
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

  // Biome State (Lifted from TrackManager)
  const [currentBiome, setCurrentBiome] = useState('summer');

  // Reference to the Player's RigidBody
  const playerRef = useRef();

  // useThree hook to verify context
  const { gl, scene, camera } = useThree();
  
  useEffect(() => {
    console.log('[Experience] Scene setup complete');
    console.log('[Experience] Scene children count:', scene.children.length);
    console.log('[Experience] Camera position:', camera.position);
    return () => {
      console.log('[Experience] Component unmounting');
    };
  }, [scene, camera]);

  return (
    <>
      <color attach="background" args={['#87CEEB']} />
      
      {/* Add frame debugger to verify rendering loop */}
      <FrameDebugger />

      <KeyboardControls map={map}>
      {/* Environment/Sky in Suspense */}
      <Suspense fallback={
        <Html center>
          <div style={{ color: 'white', background: 'rgba(0,0,0,0.7)', padding: '10px', borderRadius: '4px' }}>
            Loading Environment...
          </div>
        </Html>
      }>
        <Environment preset="park" background={false} />
        <EnhancedSky biome={currentBiome} />
      </Suspense>

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 5]} intensity={1.2} castShadow />

        {/* 2. Main Game Physics Loop */}
        <Suspense fallback={
          <>
            <Html center>
              <div style={{ color: 'white', background: 'rgba(0,0,0,0.7)', padding: '10px', borderRadius: '4px' }}>
                Loading Physics...
              </div>
            </Html>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[5, 5, 5]} />
              <meshBasicMaterial color="red" wireframe />
            </mesh>
          </>
        }>
        <PhysicsWithErrorHandler>
            {/* TrackManager reports biome changes based on player position */}
            <TrackManager onBiomeChange={setCurrentBiome} />
            <Player ref={playerRef} />
        </PhysicsWithErrorHandler>

        {/* Visual Effects */}
        <SplashParticles target={playerRef} />
      </Suspense>
      </KeyboardControls>
    </>
  );
};

export default Experience;
