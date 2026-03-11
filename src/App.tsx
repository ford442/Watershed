import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
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
  const { progress } = useProgress();

  useEffect(() => {
    if (window.location.search.includes('no-pointer-lock')) {
      setSkipLoader(true);
    }
  }, []);

  return (
    <ErrorBoundary>
      <Canvas
        gl={{ 
          powerPreference: 'high-performance',
          antialias: true 
        }}
        camera={{ position: [0, 5, 10], fov: 75 }}
        shadows
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
