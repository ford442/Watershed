import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function SplashParticles({ target, count = 60 }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Use useMemo for Geometry and Material as per guidelines
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#e0f7fa",
    transparent: true,
    opacity: 0.8,
    roughness: 0.2,
    emissive: "#ffffff",
    emissiveIntensity: 0.2
  }), []);

  // Particle state pool
  const particles = useMemo(() => {
    return new Array(count).fill(0).map(() => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 0,
      scale: 1,
      rotation: 0
    }));
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current || !target || !target.current) return;

    // 1. Get Player Data
    const playerPos = target.current.translation();
    const playerVel = target.current.linvel();

    // Calculate speed in XZ plane (ignore vertical movement for splash trigger)
    const speed = Math.sqrt(playerVel.x * playerVel.x + playerVel.z * playerVel.z);

    // 2. Emission Logic
    // Only splash if moving fast enough AND near water level
    // Water level is ~0.5. Player center is ~1.3 when standing.
    // If jumping, playerPos.y increases.
    // We want to stop splashing if Y > 2.0 (approx 0.7m above water surface)
    const isNearWater = playerPos.y < 2.5;

    if (speed > 1.0 && isNearWater) {
        const spawnRate = Math.min(5, Math.floor(speed * 0.8)); // More speed = more particles
        let spawned = 0;

        for (let p of particles) {
            if (p.life <= 0 && spawned < spawnRate) {
                // Spawn at player's feet (approx)
                // Randomize slightly around the base
                const angle = Math.random() * Math.PI * 2;
                const radius = 0.3 + Math.random() * 0.4;

                p.position.set(
                    playerPos.x + Math.cos(angle) * radius,
                    playerPos.y - 0.8, // Feet level
                    playerPos.z + Math.sin(angle) * radius
                );

                // Initial Velocity: Outward + Up + inheriting some player momentum
                p.velocity.set(
                    Math.cos(angle) * 1.5 + playerVel.x * 0.2,
                    1.0 + Math.random() * 2.0, // Upward splash
                    Math.sin(angle) * 1.5 + playerVel.z * 0.2
                );

                p.life = 1.0;
                p.maxLife = 0.5 + Math.random() * 0.5; // Short burst
                p.scale = 0.2 + Math.random() * 0.3;
                p.rotation = Math.random() * Math.PI;
                spawned++;
            }
        }
    }

    // 3. Update Logic
    particles.forEach((p, i) => {
        if (p.life > 0) {
            const age = 1.0 - (p.life / p.maxLife); // 0 to 1
            p.life -= delta;

            // Physics
            p.velocity.y -= 9.8 * delta; // Gravity
            p.velocity.x *= 0.95; // Drag
            p.velocity.z *= 0.95;
            p.position.addScaledVector(p.velocity, delta);

            // Visuals
            // Scale: Pop up then shrink
            let currentScale = p.scale;
            if (age < 0.2) currentScale *= (age / 0.2); // Fade in
            else currentScale *= (1.0 - (age - 0.2) / 0.8); // Fade out

            dummy.position.copy(p.position);
            dummy.scale.setScalar(Math.max(0, currentScale));
            dummy.rotation.set(currentScale, p.rotation + age, currentScale); // Tumble

            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        } else {
            // Hide dead particles
            dummy.scale.setScalar(0);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        }
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
    />
  );
}
