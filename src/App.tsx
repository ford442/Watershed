import React from 'react';
import { Canvas } from '@react-three/fiber';
import Experience from './Experience';
import { UI } from './components/UI';
import { Loader } from './components/Loader';
import './style.css';

function App() {
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
