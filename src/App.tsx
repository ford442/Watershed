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
  const [forceHideLoading, setForceHideLoading] = useState(false);
  const { active, progress, item, total } = useProgress();

  useEffect(() => {
    console.log('[App] Component mounted');
    console.log('[App] useProgress:', { active, progress, item, total });
    
    if (window.location.search.includes('no-pointer-lock')) {
      setSkipLoader(true);
    }
    
    // Check WebGPU support
    if ('gpu' in navigator) {
      console.log('[App] WebGPU is available');
    } else {
      console.warn('[App] WebGPU not supported, falling back to WebGL');
    }
    
    // Force hide loading screen after 5 seconds to prevent stuck state
    const timeout = setTimeout(() => {
      console.log('[App] Force hiding loading screen after timeout');
      setForceHideLoading(true);
    }, 5000);
    
    return () => {
      console.log('[App] Component unmounting');
      clearTimeout(timeout);
    };
  }, []);
  
  // Log progress changes
  useEffect(() => {
    console.log('[App] Progress update:', { active, progress: Math.round(progress), item, total });
  }, [active, progress, item, total]);

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

  const showLoading = active && !forceHideLoading;

  return (
    <ErrorBoundary>
      {showLoading && (
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
          zIndex: 9999,
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div>Loading Watershed... (shaders compiling)</div>
          <div style={{ fontSize: '14px', opacity: 0.8 }}>
            Progress: {Math.round(progress)}% | Items: {total} | Current: {item || 'none'}
          </div>
          {forceHideLoading && (
            <button 
              onClick={() => setForceHideLoading(true)}
              style={{
                padding: '10px 20px',
                fontSize: '16px',
                cursor: 'pointer',
                background: 'white',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              Skip Loading
            </button>
          )}
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
