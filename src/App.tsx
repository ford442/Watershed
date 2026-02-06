import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import ErrorBoundary from './components/ErrorBoundary';
import './style.css';
import { useProgress } from '@react-three/drei';

function App() {
  const [skipLoader, setSkipLoader] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const { active } = useProgress();

  useEffect(() => {
    console.log('[App] Component mounted');
    if (window.location.search.includes('no-pointer-lock')) {
      setSkipLoader(true);
    }
    
    // Check WebGPU support
    if ('gpu' in navigator) {
      console.log('[App] WebGPU is available');
    } else {
      console.warn('[App] WebGPU not supported, falling back to WebGL');
    }
    
    return () => {
      console.log('[App] Component unmounting');
    };
  }, []);

  const handleCanvasCreated = (state: RootState) => {
    console.log('[Canvas] Created successfully');
    console.log('[Canvas] Renderer:', state.gl.constructor.name);
    console.log('[Canvas] WebGL Version:', state.gl.capabilities?.isWebGL2 ? 'WebGL2' : 'WebGL1');
    console.log('[Canvas] Pixel Ratio:', state.gl.getPixelRatio());
    console.log('[Canvas] Viewport:', state.viewport);
    console.log('[Canvas] Camera:', state.camera.type);
    setCanvasReady(true);
  };

  useEffect(() => {
    if (canvasReady) {
      console.log('[Canvas] Ready to render');
    }
  }, [canvasReady]);

  return (
    <ErrorBoundary>
      {active && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '24px',
          fontFamily: 'sans-serif',
          zIndex: 9999
        }}>
          Loading Watershed... (shaders compiling)
        </div>
      )}
      <Canvas
        gl={{ 
          powerPreference: 'high-performance',
          antialias: false 
        }}
        camera={{ position: [0, 25, 10], fov: 75 }}
        shadows
        onCreated={handleCanvasCreated}
      >
        <Experience />
      </Canvas>
      {!skipLoader && <Loader />}
      <UI />
    </ErrorBoundary>
  );
}

export default App;

