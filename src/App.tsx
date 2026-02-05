import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import { init as rapierInit } from '@dimforge/rapier3d-compat';
import './style.css';

function App() {
  const [physicsReady, setPhysicsReady] = useState(false);
  const [physicsError, setPhysicsError] = useState(false);

  useEffect(() => {
    const initPhysics = async () => {
      try {
        // Create a timeout promise that rejects after 5 seconds
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Physics init timed out')), 5000)
        );

        // Race the init against the timeout
        await Promise.race([
          (rapierInit as any)(),
          timeoutPromise
        ]);

        console.log('Rapier Physics initialized successfully');
        setPhysicsReady(true);
      } catch (e) {
        console.error('Failed to initialize Rapier Physics:', e);
        setPhysicsError(true);
      }
    };
    initPhysics();
  }, []);

  if (physicsError) {
    return (
      <div className="loader-overlay">
        <div className="loader-content">
          <div className="loader-header" style={{ color: '#ff4444' }}>SYSTEM FAILURE</div>
          <div className="loader-text">PHYSICS ENGINE INITIALIZATION FAILED</div>
          <div className="loader-text" style={{ fontSize: '0.8em', marginTop: '10px' }}>
            Please refresh the page or check your connection.
          </div>
        </div>
      </div>
    );
  }

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
      <Canvas
        camera={{ position: [0, 25, 10], fov: 75 }}
        shadows
      >
        <React.Suspense fallback={null}>
          <Experience />
        </React.Suspense>
      </Canvas>
      <Loader />
      <UI />
    </>
  );
}

export default App;
}

export default App;
