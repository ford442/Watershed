/**
 * SplashSystem - Player-water collision response with particle effects
 * 
 * Spawns splash and foam particles when player enters/exits water,
 * creating tactile feedback and visual richness.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ParticlePool, VFXParticle, FoamParticle } from './ParticlePool';
import { useBiomeMaterials } from './BiomeSystem';

interface SplashSystemProps {
  playerRef: React.RefObject<any>;
  waterLevel?: number;
  waterWidth?: number;
  flowDirection?: THREE.Vector3;
  flowSpeed?: number;
}

// Splash particle factory
const createSplashParticle = (): VFXParticle => new VFXParticle();
const createFoamParticle = (): FoamParticle => new FoamParticle();

/**
 * SplashSystem - Manages water splash and foam effects
 */
export const SplashSystem: React.FC<SplashSystemProps> = ({
  playerRef,
  waterLevel = 0.5,
  waterWidth = 12,
  flowDirection = new THREE.Vector3(0, 0, -1),
  flowSpeed = 1.0,
}) => {
  const { water } = useBiomeMaterials();
  
  // Particle pools
  const splashPoolRef = useRef<ParticlePool<VFXParticle>>();
  const foamPoolRef = useRef<ParticlePool<FoamParticle>>();
  
  // Player state tracking
  const wasInWaterRef = useRef(false);
  const lastSplashTimeRef = useRef(0);
  
  // Initialize pools
  useEffect(() => {
    splashPoolRef.current = new ParticlePool(createSplashParticle, 300, 1000);
    foamPoolRef.current = new ParticlePool(createFoamParticle, 200, 800);
  }, []);
  
  // Spawn splash effect
  const spawnSplash = useCallback((position: THREE.Vector3, intensity: number) => {
    if (!splashPoolRef.current) return;
    
    const count = Math.floor(10 + intensity * 15);
    const particles = splashPoolRef.current.acquireMultiple(count);
    
    particles.forEach((p, i) => {
      p.position.copy(position);
      
      // Arc distribution
      const angle = (i / count) * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      const upward = 3 + Math.random() * 2;
      
      p.velocity.set(
        Math.cos(angle) * speed,
        upward,
        Math.sin(angle) * speed
      );
      
      p.maxLife = 0.5 + Math.random() * 0.5;
      p.scale = 0.3 + Math.random() * 0.4;
      p.color.set(water.foamColor);
      p.rotationSpeed = (Math.random() - 0.5) * 10;
    });
  }, [water.foamColor]);
  
  // Spawn foam trail
  const spawnFoam = useCallback((position: THREE.Vector3) => {
    if (!foamPoolRef.current) return;
    
    const count = Math.floor(3 + Math.random() * 3);
    const particles = foamPoolRef.current.acquireMultiple(count);
    
    particles.forEach(p => {
      p.position.copy(position);
      p.position.x += (Math.random() - 0.5) * 2;
      p.position.z += (Math.random() - 0.5) * 2;
      
      p.driftSpeed = 0.5 + Math.random() * 0.5;
      p.maxLife = 2 + Math.random() * 2;
      p.scale = 0.5 + Math.random() * 0.5;
      p.color.set(water.foamColor);
    });
  }, [water.foamColor]);
  
  // Update particles and detect collisions
  useFrame((state, delta) => {
    if (!splashPoolRef.current || !foamPoolRef.current) return;
    if (!playerRef.current) return;
    
    // Get player position
    const playerPos = playerRef.current.translation 
      ? playerRef.current.translation()
      : playerRef.current.position;
    
    if (!playerPos) return;
    
    // Check if in water
    const isInWater = playerPos.y < waterLevel && Math.abs(playerPos.x) < waterWidth / 2;
    
    // Detect water entry/exit
    if (isInWater && !wasInWaterRef.current) {
      // Entered water - big splash
      const entryPos = new THREE.Vector3(playerPos.x, waterLevel, playerPos.z);
      spawnSplash(entryPos, 1.0);
      lastSplashTimeRef.current = state.clock.elapsedTime;
    } else if (!isInWater && wasInWaterRef.current) {
      // Exited water - smaller splash
      const exitPos = new THREE.Vector3(playerPos.x, waterLevel, playerPos.z);
      spawnSplash(exitPos, 0.5);
    }
    
    // Spawn foam trail while moving in water
    if (isInWater) {
      const speed = playerRef.current.linvel
        ? Math.sqrt(
            playerRef.current.linvel().x ** 2 +
            playerRef.current.linvel().z ** 2
          )
        : 0;
      
      if (speed > 2 && Math.random() < 0.1 * speed) {
        spawnFoam(new THREE.Vector3(playerPos.x, waterLevel, playerPos.z));
      }
    }
    
    wasInWaterRef.current = isInWater;
    
    // Update splash particles
    const splashParticles = splashPoolRef.current.getActive();
    splashParticles.forEach(p => {
      const stillActive = p.update(delta, -9.8);
      if (!stillActive) {
        splashPoolRef.current!.release(p);
      }
    });
    
    // Update foam particles
    const foamParticles = foamPoolRef.current.getActive();
    foamParticles.forEach(p => {
      const stillActive = p.update(delta, flowDirection, flowSpeed);
      if (!stillActive) {
        foamPoolRef.current!.release(p);
      }
    });
  });
  
  // Visual representation would go here
  // For now, particles are tracked in pools but not rendered
  // Integration with existing particle components would happen here
  return null;
};

export default SplashSystem;
