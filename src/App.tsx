import React from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import './style.css';

function App() {
  return (
    <>
      <Canvas
        gl={{ 
          powerPreference: 'high-performance',
          antialias: false 
        }}
        camera={{ position: [0, 25, 10], fov: 75 }}
        // shadows={false}  // Temp disable
      >
        <Experience />
      </Canvas>
      <Loader />
      <UI />
    </>
  );
}

export default App;

