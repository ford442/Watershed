import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import { init as rapierInit } from '@dimforge/rapier3d-compat';
import './style.css';

function App() {
  const [physicsReady, setPhysicsReady] = useState(false);

  useEffect(() => {
    const initPhysics = async () => {
      try {
        // Initialize Rapier with the manually copied WASM file
        // Cast to any because the type definition incorrectly states init() takes no arguments
        await (rapierInit as any)({ module_or_path: './rapier.wasm' });
        console.log('Rapier Physics initialized successfully');
      } catch (e) {
        console.error('Failed to initialize Rapier Physics:', e);
      } finally {
        setPhysicsReady(true);
      }
    };
    initPhysics();
  }, []);

  if (!physicsReady) {
    return (
      <div className="loader-overlay">
        <div className="loader-content">
          <div className="loader-header">SYSTEM INITIALIZATION</div>
          <div className="loader-text" aria-live="polite">INITIALIZING PHYSICS ENGINE...</div>
          <div className="loader-bar">
             <div className="loader-bar-fill" style={{ width: '100%', animation: 'none' }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <React.Suspense fallback={<Loader />}>
        <Canvas
          camera={{ position: [0, 25, 10], fov: 75 }}
          shadows
        >
          <Experience />
        </Canvas>
      </React.Suspense>
      <UI />
    </>
  );
}

export default App;
