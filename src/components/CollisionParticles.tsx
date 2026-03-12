import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SurfaceMaterial } from '../systems/VehicleSystem';

interface Particle {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

interface CollisionParticlesProps {
  material: SurfaceMaterial;
  position: THREE.Vector3;
  intensity: number; // 0-1 based on impact force
  onComplete?: () => void;
}

/**
 * CollisionParticles - Visual feedback for surface collisions
 * 
 * Different effects per material:
 * - ROCK: Spark particles (orange/white)
 * - MOSS: Leaf/debris particles (green/brown)
 * - WOOD: Splinter particles (tan/brown)
 * - CONCRETE: Dust particles (gray)
 * - WATER: Splash droplets (blue/white)
 */
export const CollisionParticles: React.FC<CollisionParticlesProps> = ({
  material,
  position,
  intensity,
  onComplete,
}) => {
  const particlesRef = useRef<Particle[]>([]);
  const nextId = useRef(0);

  // Initialize particles based on material
  const particles = useMemo(() => {
    const count = Math.floor(10 + intensity * 20); // 10-30 particles
    const newParticles: Particle[] = [];

    const configs: Record<SurfaceMaterial, {
      colors: string[];
      sizeRange: [number, number];
      velocityScale: number;
      gravity: number;
    }> = {
      [SurfaceMaterial.ROCK]: {
        colors: ['#ffaa00', '#ffffff', '#ff6600'],
        sizeRange: [0.02, 0.06],
        velocityScale: 3,
        gravity: -9.8,
      },
      [SurfaceMaterial.MOSS]: {
        colors: ['#4a7c2a', '#6b8c3a', '#3a5c1a'],
        sizeRange: [0.03, 0.08],
        velocityScale: 2,
        gravity: -5,
      },
      [SurfaceMaterial.WOOD]: {
        colors: ['#8b7355', '#a08060', '#6b5344'],
        sizeRange: [0.02, 0.07],
        velocityScale: 2.5,
        gravity: -7,
      },
      [SurfaceMaterial.CONCRETE]: {
        colors: ['#888888', '#aaaaaa', '#666666'],
        sizeRange: [0.01, 0.04],
        velocityScale: 1.5,
        gravity: -3,
      },
      [SurfaceMaterial.WATER]: {
        colors: ['#aaddff', '#ffffff', '#88ccff'],
        sizeRange: [0.04, 0.1],
        velocityScale: 2,
        gravity: -4,
      },
    };

    const config = configs[material];

    for (let i = 0; i < count; i++) {
      const color = config.colors[Math.floor(Math.random() * config.colors.length)];
      const angle = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.5;
      const speed = (0.5 + Math.random() * 0.5) * config.velocityScale * intensity;

      newParticles.push({
        id: nextId.current++,
        position: position.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2
        )),
        velocity: new THREE.Vector3(
          Math.cos(angle) * Math.sin(elevation) * speed,
          Math.cos(elevation) * speed * 0.8 + 0.5, // Upward bias
          Math.sin(angle) * Math.sin(elevation) * speed
        ),
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1.0,
        size: config.sizeRange[0] + Math.random() * (config.sizeRange[1] - config.sizeRange[0]),
        color: new THREE.Color(color),
      });
    }

    return newParticles;
  }, [material, position, intensity]);

  particlesRef.current = particles;

  useFrame((state, delta) => {
    const configs: Record<SurfaceMaterial, { gravity: number }> = {
      [SurfaceMaterial.ROCK]: { gravity: -9.8 },
      [SurfaceMaterial.MOSS]: { gravity: -5 },
      [SurfaceMaterial.WOOD]: { gravity: -7 },
      [SurfaceMaterial.CONCRETE]: { gravity: -3 },
      [SurfaceMaterial.WATER]: { gravity: -4 },
    };

    const gravity = configs[material].gravity;

    particlesRef.current = particlesRef.current
      .map(p => {
        p.velocity.y += gravity * delta;
        p.position.add(p.velocity.clone().multiplyScalar(delta));
        p.life -= delta;
        return p;
      })
      .filter(p => p.life > 0);

    if (particlesRef.current.length === 0) {
      onComplete?.();
    }
  });

  return (
    <group>
      {particlesRef.current.map(particle => (
        <mesh key={particle.id} position={particle.position}>
          <sphereGeometry args={[particle.size * (particle.life / particle.maxLife)]} />
          <meshBasicMaterial
            color={particle.color}
            transparent
            opacity={particle.life / particle.maxLife}
          />
        </mesh>
      ))}
    </group>
  );
};

/**
 * CollisionManager - Manages active collision particle systems
 */
export const CollisionManager: React.FC = () => {
  const [activeCollisions, setActiveCollisions] = React.useRef<
    Array<{
      id: number;
      material: SurfaceMaterial;
      position: THREE.Vector3;
      intensity: number;
    }>
  >({ current: [] });

  React.useEffect(() => {
    const handleCollision = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { material, force, point, isHighImpact } = customEvent.detail;

      if (!isHighImpact) return;

      const newCollision = {
        id: Date.now() + Math.random(),
        material,
        position: new THREE.Vector3(point.x, point.y, point.z),
        intensity: Math.min(1, force / 10),
      };

      activeCollisions.current = [...activeCollisions.current, newCollision];
    };

    window.addEventListener('vehicle-collision', handleCollision);
    return () => window.removeEventListener('vehicle-collision', handleCollision);
  }, []);

  const removeCollision = (id: number) => {
    activeCollisions.current = activeCollisions.current.filter(c => c.id !== id);
  };

  return (
    <>
      {activeCollisions.current.map(collision => (
        <CollisionParticles
          key={collision.id}
          material={collision.material}
          position={collision.position}
          intensity={collision.intensity}
          onComplete={() => removeCollision(collision.id)}
        />
      ))}
    </>
  );
};

export default CollisionParticles;
