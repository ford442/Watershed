import React, { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { Loader } from './components/Loader';
import { StartMenu } from './components/StartMenu';
import { PauseMenu } from './components/PauseMenu';
import ErrorBoundary from './components/ErrorBoundary';
import './style.css';

/** Game phase determines which overlays are visible */
type GamePhase = 'menu' | 'playing' | 'paused';

// Simple fallback scene if Experience fails
const FallbackScene = () => {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#444444" />
    </mesh>
  );
};

function App() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [skipLoader, setSkipLoader] = useState(false);

  useEffect(() => {
    if (window.location.search.includes('no-pointer-lock')) {
      setSkipLoader(true);
    }
  }, []);

  // Detect pointer lock loss as pause trigger
  useEffect(() => {
    const handlePointerLockChange = () => {
      const locked = !!document.pointerLockElement;
      setPhase((prev) => {
        if (locked && prev === 'paused') return 'playing';
        if (!locked && prev === 'playing') return 'paused';
        return prev;
      });
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  const handleStart = useCallback(() => {
    setPhase('playing');
    if (!window.location.search.includes('no-pointer-lock')) {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.requestPointerLock().catch((err) => {
          console.warn('[App] Pointer lock failed:', err);
        });
      }
    }
  }, []);

  const handleResume = useCallback(() => {
    setPhase('playing');
    if (!window.location.search.includes('no-pointer-lock')) {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        canvas.requestPointerLock().catch((err) => {
          console.warn('[App] Pointer lock failed:', err);
        });
      }
    }
  }, []);

  const handleRestart = useCallback(() => {
    window.location.reload();
  }, []);

  const handleQuit = useCallback(() => {
    setPhase('menu');
  }, []);

  return (
    <ErrorBoundary>
      <Canvas
        gl={{
          powerPreference: 'high-performance',
          antialias: true,
        }}
        camera={{ position: [0, 5, 10], fov: 75 }}
        shadows
        frameloop="always"
      >
        <React.Suspense fallback={null}>
          <Experience />
        </React.Suspense>
      </Canvas>

      {/* Asset loading overlay */}
      {!skipLoader && <Loader />}

      {/* Goal 4: Start Menu — shown before first run */}
      {phase === 'menu' && <StartMenu onStart={handleStart} />}

      {/* Goal 4: Pause Menu — shown when pointer lock is lost during play */}
      {phase === 'paused' && (
        <PauseMenu
          onResume={handleResume}
          onRestart={handleRestart}
          onQuit={handleQuit}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
