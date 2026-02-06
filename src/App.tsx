import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import './style.css';
import { useProgress } from '@react-three/drei';

function App() {
  const [skipLoader, setSkipLoader] = useState(false);
  const { active } = useProgress();

  useEffect(() => {
    if (window.location.search.includes('no-pointer-lock')) {
      setSkipLoader(true);
    }
  }, []);

  return (
    <>
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
      >
        <Experience />
      </Canvas>
      {!skipLoader && <Loader />}
      <UI />
    </>
  );
}

export default App;

