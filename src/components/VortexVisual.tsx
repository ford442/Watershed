// src/components/VortexVisual.tsx
// Visual swirl effect for vortex segments

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface VortexVisualProps {
  /** Center position of the vortex */
  center: THREE.Vector3;
  /** Vortex radius */
  radius?: number;
  /** Swirl intensity (affects rotation speed) */
  intensity?: number;
  /** Number of particles in the ring */
  particleCount?: number;
  /** Color of the swirl */
  color?: string;
}

/**
 * VortexVisual — Particle ring that spins around the vortex center
 * 
 * Creates a visual indicator of the whirlpool force field.
 * Particles spiral inward and fade as they approach the center.
 */
export const VortexVisual: React.FC<VortexVisualProps> = ({
  center,
  radius = 8,
  intensity = 1.0,
  particleCount = 64,
  color = '#4a90d9',
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Pre-calculate particle positions in a spiral pattern
  const particleData = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => {
      const angle = (i / particleCount) * Math.PI * 2;
      const dist = radius * (0.3 + 0.7 * Math.random()); // Random distance from center
      const yOffset = (Math.random() - 0.5) * 1.5; // Slight vertical spread
      return { angle, dist, yOffset, speed: 0.5 + Math.random() * 0.5 };
    });
  }, [particleCount, radius]);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;
    const swirlSpeed = intensity * 2.0; // Rotation speed based on intensity

    particleData.forEach((particle, i) => {
      // Spiral motion — particles rotate and drift inward
      const currentAngle = particle.angle + time * swirlSpeed * particle.speed;
      const currentDist = particle.dist * (0.8 + 0.2 * Math.sin(time * 2 + i)); // Breathing effect
      
      // Calculate position
      const x = center.x + Math.cos(currentAngle) * currentDist;
      const z = center.z + Math.sin(currentAngle) * currentDist;
      const y = center.y + particle.yOffset + Math.sin(time * 3 + i * 0.5) * 0.3; // Bobbing

      dummy.position.set(x, y, z);
      
      // Scale fades as particles approach center
      const scale = (currentDist / radius) * 0.5 + 0.2;
      dummy.scale.setScalar(scale);
      
      // Look at center
      dummy.lookAt(center.x, y, center.z);
      
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, particleCount]}>
      <sphereGeometry args={[0.15, 8, 8]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={0.6}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
};

export default VortexVisual;
