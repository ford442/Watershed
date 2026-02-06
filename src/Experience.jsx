import { KeyboardControls, Html } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";
import React, { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from 'three';

export const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  jump: 'jump',
};

// Absolute minimal scene to test rendering
const MinimalScene = () => {
  const { camera, gl } = useThree();
  
  useEffect(() => {
    console.log('[MinimalScene] Mounted');
    console.log('[MinimalScene] Camera pos:', camera.position.toArray());
    console.log('[MinimalScene] Canvas size:', gl.domElement.width, 'x', gl.domElement.height);
    console.log('[MinimalScene] Canvas visible:', gl.domElement.style.display !== 'none');
  }, [camera, gl]);
  
  useFrame((state) => {
    // Rotate the cube
    state.scene.getObjectByName('test-cube').rotation.y = state.clock.elapsedTime;
  });
  
  return (
    <>
      <color attach="background" args={['#000033']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      
      {/* Simple rotating cube at origin */}
      <mesh name="test-cube" position={[0, 0, 0]}>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="red" />
      </mesh>
      
      {/* Text label */}
      <Html center position={[0, 2, 0]}>
        <div style={{
          color: 'white',
          background: 'rgba(0,0,0,0.7)',
          padding: '10px 20px',
          borderRadius: '4px',
          fontFamily: 'sans-serif',
          fontSize: '16px',
          pointerEvents: 'none'
        }}>
          If you see this text and a red cube,<br/>React Three Fiber is working!
        </div>
      </Html>
    </>
  );
};

const Experience = () => {
  console.log("[Experience] Rendering...");
  
  const map = useMemo(() => [
    { name: Controls.forward, keys: ['ArrowUp'] },
    { name: Controls.backward, keys: ['KeyS', 'ArrowDown'] },
    { name: Controls.left, keys: ['KeyA', 'ArrowLeft'] },
    { name: Controls.right, keys: ['KeyD', 'ArrowRight'] },
    { name: Controls.jump, keys: ['KeyW', 'Space'] },
  ], []);
  
  const { scene } = useThree();
  
  useEffect(() => {
    console.log('[Experience] Mounted');
    console.log('[Experience] Scene children:', scene.children.length);
  }, [scene]);

  return (
    <KeyboardControls map={map}>
      <MinimalScene />
    </KeyboardControls>
  );
};

export default Experience;
