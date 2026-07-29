import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Mesh } from 'three';

/** Minimal sky fill for headless / screenshot harness (`?no-pointer-lock`). */
export default function HeadlessSkySphere() {
  const { camera, scene } = useThree();
  const meshRef = useRef<Mesh>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('no-pointer-lock')) {
      scene.fog = null;
    }
  }, [scene]);

  useFrame(() => {
    if (meshRef.current && camera) {
      meshRef.current.position.copy(camera.position);
    }
  });

  return (
    <mesh ref={meshRef} scale={[200, 200, 200]}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color="#1a4a8a" side={BackSide} />
    </mesh>
  );
}
