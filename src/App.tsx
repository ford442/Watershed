import React from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import './style.css';

function App() {
  return (
    <Canvas>
      <React.Suspense fallback={null}>
        <Experience />
      </React.Suspense>
    </Canvas>
  );
}

export default App;
