import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import ErrorBoundary from './components/ErrorBoundary';
import './style.css';
import { useProgress } from '@react-three/drei';

// Simple fallback scene if Experience fails
const FallbackScene = () => {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="hotpink" wireframe />
    </mesh>
  );
};

function App() {
  const [skipLoader, setSkipLoader] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [experienceError, setExperienceError] = useState<Error | null>(null);
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
    
    // Check WebGL
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    console.log('[App] WebGL context test:', gl ? 'SUCCESS' : 'FAILED');
    
  }, []);
  
  useEffect(() => {
    console.log('[App] Progress update:', { active, progress: Math.round(progress), item, total });
  }, [active, progress, item, total]);

  const handleCanvasCreated = (state: RootState) => {
    console.log('[Canvas] Created successfully');
    console.log('[Canvas] Renderer:', state.gl.constructor.name);
    console.log('[Canvas] WebGL Version:', state.gl.capabilities?.isWebGL2 ? 'WebGL2' : 'WebGL1');
    console.log('[Canvas] Pixel Ratio:', state.gl.getPixelRatio());
    console.log('[Canvas] Viewport:', state.viewport);
    console.log('[Canvas] Camera:', state.camera.type, 'pos:', state.camera.position.toArray());
    setCanvasReady(true);
  };
  
  const handleCanvasError = (error: any) => {
    console.error('[Canvas] Error:', error);
  };

  return (
    <ErrorBoundary>
      <div style={{
        position: 'fixed',
        top: 10,
        left: 10,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.8)',
        color: '#0f0',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '12px',
        maxWidth: '400px',
        maxHeight: '200px',
        overflow: 'auto'
      }}>
        <div>Canvas Ready: {canvasReady ? 'YES' : 'NO'}</div>
        <div>Loading Active: {active ? 'YES' : 'NO'}</div>
        <div>Progress: {Math.round(progress)}%</div>
        <div>Experience Error: {experienceError ? experienceError.message : 'None'}</div>
      </div>
      
      <Canvas
        gl={{ 
          powerPreference: 'high-performance',
          antialias: false 
        }}
        camera={{ position: [0, 5, 10], fov: 75 }}
        shadows
        onCreated={handleCanvasCreated}
        onError={handleCanvasError}
        frameloop="always"
      >
        <React.Suspense fallback={
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color="orange" />
          </mesh>
        }>
          <Experience />
        </React.Suspense>
      </Canvas>
      
      {!skipLoader && <Loader />}
      <UI />
    </ErrorBoundary>
  );
}

export default App;
