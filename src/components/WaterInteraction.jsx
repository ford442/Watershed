import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * WaterInteraction - Enhanced water effects for player/raft interaction
 * 
 * Features:
 * - Splash particles when near water surface at velocity > 1 m/s
 * - Bow wave mesh for raft (sine-wave plane deformed by speed)
 * - Mist spray when raft submerged > 60%
 */
export default function WaterInteraction({ 
    target,              // Physics body ref
    isRaft = false,      // Enable raft-specific effects
    waterLevel = 0.5,
    maxVelocity = 10,    // For scaling effects
}) {
    const splashMeshRef = useRef();
    const mistMeshRef = useRef();
    const bowWaveMeshRef = useRef();
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const timeRef = useRef(0);
    
    // Splash particle configuration
    const MAX_SPLASH_PARTICLES = 50;
    const SPLASH_CONFIG = {
        minSpeed: 1.0,           // m/s threshold
        proximity: 1.0,          // units from water surface
        baseCount: 5,            // particles at min speed
        maxCount: 20,            // particles at max speed
    };
    
    // Geometry and material for splash particles
    const splashGeometry = useMemo(() => new THREE.BoxGeometry(0.15, 0.15, 0.15), []);
    const splashMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#e0f7fa',
        transparent: true,
        opacity: 0.9,
        roughness: 0.1,
        emissive: '#aaddff',
        emissiveIntensity: 0.3,
    }), []);
    
    // Mist spray configuration
    const MAX_MIST_PARTICLES = 30;
    const mistGeometry = useMemo(() => new THREE.PlaneGeometry(0.3, 0.3), []);
    const mistMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
    }), []);
    
    // Bow wave mesh
    const bowWaveGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(3, 4, 16, 16);
        geo.rotateX(-Math.PI / 2); // Lay flat
        geo.translate(0, 0, -2);   // Position in front of raft
        return geo;
    }, []);
    const bowWaveMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#aaddff',
        transparent: true,
        opacity: 0.5,
        roughness: 0.1,
        metalness: 0.1,
        side: THREE.DoubleSide,
    }), []);
    
    // Particle pools
    const splashParticles = useMemo(() => {
        return new Array(MAX_SPLASH_PARTICLES).fill(0).map(() => ({
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life: 0,
            maxLife: 0,
            scale: 1,
            rotation: new THREE.Vector3(),
        }));
    }, []);
    
    const mistParticles = useMemo(() => {
        return new Array(MAX_MIST_PARTICLES).fill(0).map(() => ({
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life: 0,
            maxLife: 0,
            scale: 1,
            rotation: 0,
        }));
    }, []);
    
    // Update bow wave vertices based on speed
    const updateBowWave = (speed, delta) => {
        if (!bowWaveMeshRef.current || !isRaft) return;
        
        const mesh = bowWaveMeshRef.current;
        const positions = mesh.geometry.attributes.position;
        
        // Wave parameters scale with speed
        const waveHeight = 0.1 * (speed / maxVelocity);
        const frequency = speed * 0.5;
        const time = timeRef.current * 2;
        
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            
            // Sine wave deformation
            const y = Math.sin(x * frequency + time) * waveHeight * 
                     Math.cos(z * frequency * 0.5 + time) * 
                     (1 - Math.abs(z) / 4); // Taper at edges
            
            positions.setY(i, y);
        }
        
        positions.needsUpdate = true;
        mesh.visible = speed > 1;
    };
    
    // Spawn mist particles
    const spawnMist = (position, velocity, submergedRatio, speed) => {
        if (!isRaft || submergedRatio < 0.6 || speed <= 2) return;
        
        const opacity = Math.min(1, Math.max(0, (speed - 2) / 5));
        const spawnCount = Math.floor(opacity * 2);
        let spawned = 0;
        
        for (let p of mistParticles) {
            if (p.life <= 0 && spawned < spawnCount) {
                p.position.set(
                    position.x + (Math.random() - 0.5) * 2,
                    position.y + 0.3, // Deck level
                    position.z + (Math.random() - 0.5) * 3
                );
                
                p.velocity.set(
                    (Math.random() - 0.5) * 0.5,
                    0.5 + Math.random() * 0.5, // Upward drift
                    (Math.random() - 0.5) * 0.5
                );
                
                p.life = 1.0;
                p.maxLife = 0.8 + Math.random() * 0.6;
                p.scale = 0.5 + Math.random() * 0.5;
                p.rotation = Math.random() * Math.PI;
                spawned++;
            }
        }
    };
    
    // Spawn splash particles
    const spawnSplashes = (position, velocity, speed, isNearWater) => {
        if (!isNearWater || speed <= SPLASH_CONFIG.minSpeed) return;
        
        // Scale particle count with velocity
        const t = Math.min(1, (speed - SPLASH_CONFIG.minSpeed) / (maxVelocity - SPLASH_CONFIG.minSpeed));
        const targetCount = Math.floor(SPLASH_CONFIG.baseCount + t * (SPLASH_CONFIG.maxCount - SPLASH_CONFIG.baseCount));
        const clampedCount = Math.min(targetCount, MAX_SPLASH_PARTICLES);
        
        let spawned = 0;
        
        for (let p of splashParticles) {
            if (p.life <= 0 && spawned < clampedCount) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 0.3 + Math.random() * 0.5;
                
                p.position.set(
                    position.x + Math.cos(angle) * radius,
                    waterLevel + 0.1,
                    position.z + Math.sin(angle) * radius
                );
                
                // Velocity: outward + up + player momentum
                p.velocity.set(
                    Math.cos(angle) * (1 + speed * 0.2) + velocity.x * 0.1,
                    1.5 + Math.random() * 2 + speed * 0.15,
                    Math.sin(angle) * (1 + speed * 0.2) + velocity.z * 0.1
                );
                
                p.life = 1.0;
                p.maxLife = 0.4 + Math.random() * 0.4;
                p.scale = 0.1 + Math.random() * 0.2 + speed * 0.02;
                p.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                spawned++;
            }
        }
    };
    
    useFrame((state, delta) => {
        timeRef.current += delta;
        
        if (!target || !target.current) {
            // Hide all effects when no target
            if (splashMeshRef.current) {
                for (let i = 0; i < MAX_SPLASH_PARTICLES; i++) {
                    dummy.scale.setScalar(0);
                    dummy.updateMatrix();
                    splashMeshRef.current.setMatrixAt(i, dummy.matrix);
                }
                splashMeshRef.current.instanceMatrix.needsUpdate = true;
            }
            return;
        }
        
        const body = target.current;
        const pos = body.translation();
        const vel = body.linvel();
        const rot = body.rotation();
        
        // Calculate speed
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        
        // Check proximity to water
        const distFromWater = Math.abs(pos.y - waterLevel);
        const isNearWater = distFromWater < SPLASH_CONFIG.proximity;
        
        // Calculate submerged ratio for raft
        const raftHeight = isRaft ? 0.3 : 1.0;
        const submergedRatio = Math.max(0, Math.min(1, 
            (waterLevel + raftHeight/2 - pos.y) / raftHeight + 0.5
        ));
        
        // === UPDATE BOW WAVE ===
        if (isRaft) {
            updateBowWave(speed, delta);
            
            // Position bow wave mesh
            if (bowWaveMeshRef.current) {
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rot);
                bowWaveMeshRef.current.position.set(
                    pos.x + forward.x * 1.5,
                    waterLevel,
                    pos.z + forward.z * 1.5
                );
                bowWaveMeshRef.current.rotation.y = Math.atan2(forward.x, forward.z);
            }
            
            // === SPAWN MIST ===
            spawnMist(pos, vel, submergedRatio, speed);
        }
        
        // === SPAWN SPLASHES ===
        spawnSplashes(pos, vel, speed, isNearWater);
        
        // === UPDATE SPLASH PARTICLES ===
        if (splashMeshRef.current) {
            splashParticles.forEach((p, i) => {
                if (p.life > 0) {
                    p.life -= delta;
                    
                    // Physics
                    p.velocity.y -= 9.8 * delta; // Gravity
                    p.velocity.multiplyScalar(0.96); // Drag
                    p.position.addScaledVector(p.velocity, delta);
                    
                    // Visuals
                    const age = 1 - (p.life / p.maxLife);
                    let currentScale = p.scale;
                    if (age < 0.1) currentScale *= (age / 0.1);
                    else currentScale *= (1 - (age - 0.1) / 0.9);
                    
                    dummy.position.copy(p.position);
                    dummy.scale.setScalar(Math.max(0, currentScale));
                    dummy.rotation.set(
                        p.rotation.x + age * 2,
                        p.rotation.y + age * 3,
                        p.rotation.z + age
                    );
                    dummy.updateMatrix();
                    splashMeshRef.current.setMatrixAt(i, dummy.matrix);
                } else {
                    dummy.scale.setScalar(0);
                    dummy.updateMatrix();
                    splashMeshRef.current.setMatrixAt(i, dummy.matrix);
                }
            });
            splashMeshRef.current.instanceMatrix.needsUpdate = true;
        }
        
        // === UPDATE MIST PARTICLES ===
        if (mistMeshRef.current && isRaft) {
            mistParticles.forEach((p, i) => {
                if (p.life > 0) {
                    p.life -= delta;
                    
                    // Gentle drift upward
                    p.position.addScaledVector(p.velocity, delta);
                    p.rotation += delta * 0.5;
                    
                    // Fade out
                    const alpha = (p.life / p.maxLife) * 0.4;
                    
                    dummy.position.copy(p.position);
                    dummy.scale.setScalar(p.scale * (0.5 + p.life * 0.5));
                    dummy.rotation.set(0, 0, p.rotation);
                    dummy.updateMatrix();
                    mistMeshRef.current.setMatrixAt(i, dummy.matrix);
                } else {
                    dummy.scale.setScalar(0);
                    dummy.updateMatrix();
                    mistMeshRef.current.setMatrixAt(i, dummy.matrix);
                }
            });
            mistMeshRef.current.instanceMatrix.needsUpdate = true;
        }
    });
    
    return (
        <group>
            {/* Splash particles */}
            <instancedMesh
                ref={splashMeshRef}
                args={[splashGeometry, splashMaterial, MAX_SPLASH_PARTICLES]}
                frustumCulled={false}
            />
            
            {/* Mist spray (raft only) */}
            {isRaft && (
                <instancedMesh
                    ref={mistMeshRef}
                    args={[mistGeometry, mistMaterial, MAX_MIST_PARTICLES]}
                    frustumCulled={false}
                />
            )}
            
            {/* Bow wave mesh (raft only) */}
            {isRaft && (
                <mesh
                    ref={bowWaveMeshRef}
                    geometry={bowWaveGeometry}
                    material={bowWaveMaterial}
                    visible={false}
                />
            )}
        </group>
    );
}
