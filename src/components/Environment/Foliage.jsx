import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// Color Palettes for varied greens
const COLOR_PALETTES = {
  summer: {
    tree: ['#2a4f2a', '#3a6f3a', '#2d5c2d', '#3d7a3d', '#1e401e'],
    bush: ['#3a5f3a', '#4a7f4a', '#4d8c4d', '#5a9d5a', '#3d6b3d'],
    grass: ['#4a6f3a', '#5a8f4a', '#6a9f5a', '#5c8f3d', '#4d7a3d']
  },
  autumn: {
    tree: ['#8b4513', '#a0522d', '#cd853f', '#d2691e', '#b8860b'],
    bush: ['#9acd32', '#6b8e23', '#556b2f', '#8fbc8f', '#808000'],
    grass: ['#bdb76b', '#9acd32', '#808000', '#6b8e23', '#556b2f']
  }
};

/**
 * Foliage Component - Adds variety of vegetation (bushes, grass blades, small plants)
 * Uses instanced rendering for performance with many small objects
 * 
 * @param {Object} props
 * @param {Array} props.transforms - Array of {position, rotation, scale} for placement
 * @param {string} props.biome - 'summer' or 'autumn' for color palette
 * @param {number} props.density - Multiplier for amount of foliage (0.5 to 2.0)
 */
export default function Foliage({ transforms, biome = 'summer', density = 1.0 }) {
  const bushesRef = useRef();
  const grassRef = useRef();
  const plantsRef = useRef();

  // Get color palette based on biome
  const palette = COLOR_PALETTES[biome] || COLOR_PALETTES.summer;

  // Generate foliage data with variety
  const foliageData = useMemo(() => {
    if (!transforms || transforms.length === 0) {
      return { bushes: [], grass: [], plants: [] };
    }

    const bushes = [];
    const grass = [];
    const plants = [];

    transforms.forEach((t, i) => {
      const seed = i * 123.45;
      const rand = () => {
        const x = Math.sin(seed + Math.random() * 100) * 10000;
        return x - Math.floor(x);
      };

      // Determine type based on random chance
      const typeRoll = rand();
      
      if (typeRoll > 0.6) {
        // Bush - rounded shrub
        const bushColors = palette.bush;
        const colorHex = bushColors[Math.floor(rand() * bushColors.length)];
        const color = new THREE.Color(colorHex);
        
        // Add brightness variation
        const shade = 0.85 + rand() * 0.3;
        color.multiplyScalar(shade);

        const scale = t.scale.x * (0.8 + rand() * 0.6) * density;
        
        bushes.push({
          position: t.position,
          rotation: t.rotation,
          scale: new THREE.Vector3(scale, scale * (0.7 + rand() * 0.4), scale),
          color
        });
      } else if (typeRoll > 0.25) {
        // Grass blades cluster
        const grassColors = palette.grass;
        const colorHex = grassColors[Math.floor(rand() * grassColors.length)];
        const color = new THREE.Color(colorHex);
        
        const shade = 0.9 + rand() * 0.2;
        color.multiplyScalar(shade);

        // Each transform spawns a cluster of 3-6 grass blades
        const clusterSize = 3 + Math.floor(rand() * 4);
        for (let g = 0; g < clusterSize; g++) {
          const spread = 0.8;
          const offsetX = (rand() - 0.5) * spread;
          const offsetZ = (rand() - 0.5) * spread;
          
          const pos = t.position.clone();
          pos.x += offsetX;
          pos.z += offsetZ;

          const heightScale = t.scale.x * (0.5 + rand() * 0.8) * density;
          const widthScale = t.scale.x * (0.15 + rand() * 0.1) * density;

          grass.push({
            position: pos,
            rotation: new THREE.Euler(
              (rand() - 0.5) * 0.3,
              t.rotation.y + (rand() - 0.5) * 0.5,
              (rand() - 0.5) * 0.3
            ),
            scale: new THREE.Vector3(widthScale, heightScale, widthScale),
            color
          });
        }
      } else {
        // Small ground plants/ferns
        const plantColors = palette.grass;
        const colorHex = plantColors[Math.floor(rand() * plantColors.length)];
        const color = new THREE.Color(colorHex);
        
        const shade = 0.85 + rand() * 0.25;
        color.multiplyScalar(shade);

        const scale = t.scale.x * (0.6 + rand() * 0.5) * density;
        
        plants.push({
          position: t.position,
          rotation: new THREE.Euler(0, t.rotation.y + rand() * Math.PI, 0),
          scale: new THREE.Vector3(scale, scale * 0.5, scale),
          color
        });
      }
    });

    return { bushes, grass, plants };
  }, [transforms, palette, density]);

  // Geometries
  const bushGeometry = useMemo(() => {
    // Low poly bush shape using icosahedron
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.scale(1, 0.8, 1);
    geo.translate(0, 0.4, 0); // Sit on ground
    geo.computeVertexNormals();
    return geo;
  }, []);

  const grassGeometry = useMemo(() => {
    // Grass blade - tapered plane
    const geo = new THREE.PlaneGeometry(1, 1, 1, 3);
    const positions = geo.attributes.position;
    
    // Taper the grass blade to be wider at bottom, narrow at top
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const x = positions.getX(i);
      
      // Taper width based on height (-0.5 to 0.5)
      const taperFactor = 0.3 + 0.7 * ((y + 0.5) / 1.0); // 0.3 at bottom, 1.0 at top
      positions.setX(i, x * taperFactor);
    }
    
    geo.translate(0, 0.5, 0); // Pivot at bottom
    geo.computeVertexNormals();
    return geo;
  }, []);

  const plantGeometry = useMemo(() => {
    // Low poly fern-like shape
    const geo = new THREE.ConeGeometry(1, 1, 5, 1, true);
    geo.scale(1, 0.4, 1);
    geo.translate(0, 0.2, 0);
    geo.computeVertexNormals();
    return geo;
  }, []);

  // Materials
  const bushMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#ffffff', // White base for instance coloring
      roughness: 0.9,
      metalness: 0
    });
  }, []);

  const grassMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide
    });
  }, []);

  const plantMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide
    });
  }, []);

  // Update instance matrices and colors
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    // Update bushes
    if (bushesRef.current && foliageData.bushes.length > 0) {
      foliageData.bushes.forEach((bush, i) => {
        position.copy(bush.position);
        quaternion.setFromEuler(bush.rotation);
        scale.copy(bush.scale);
        matrix.compose(position, quaternion, scale);
        bushesRef.current.setMatrixAt(i, matrix);
        bushesRef.current.setColorAt(i, bush.color);
      });
      bushesRef.current.instanceMatrix.needsUpdate = true;
      if (bushesRef.current.instanceColor) {
        bushesRef.current.instanceColor.needsUpdate = true;
      }
    }

    // Update grass
    if (grassRef.current && foliageData.grass.length > 0) {
      foliageData.grass.forEach((blade, i) => {
        position.copy(blade.position);
        quaternion.setFromEuler(blade.rotation);
        scale.copy(blade.scale);
        matrix.compose(position, quaternion, scale);
        grassRef.current.setMatrixAt(i, matrix);
        grassRef.current.setColorAt(i, blade.color);
      });
      grassRef.current.instanceMatrix.needsUpdate = true;
      if (grassRef.current.instanceColor) {
        grassRef.current.instanceColor.needsUpdate = true;
      }
    }

    // Update plants
    if (plantsRef.current && foliageData.plants.length > 0) {
      foliageData.plants.forEach((plant, i) => {
        position.copy(plant.position);
        quaternion.setFromEuler(plant.rotation);
        scale.copy(plant.scale);
        matrix.compose(position, quaternion, scale);
        plantsRef.current.setMatrixAt(i, matrix);
        plantsRef.current.setColorAt(i, plant.color);
      });
      plantsRef.current.instanceMatrix.needsUpdate = true;
      if (plantsRef.current.instanceColor) {
        plantsRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, [foliageData]);

  // Wind sway animation
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    if (bushesRef.current) {
      bushesRef.current.rotation.z = Math.sin(time * 1.2) * 0.02;
    }
    if (grassRef.current) {
      grassRef.current.rotation.z = Math.sin(time * 2.5) * 0.05;
      grassRef.current.rotation.x = Math.cos(time * 1.8) * 0.02;
    }
    if (plantsRef.current) {
      plantsRef.current.rotation.z = Math.sin(time * 1.5) * 0.03;
    }
  });

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      {/* Bushes - Rounded shrubs */}
      {foliageData.bushes.length > 0 && (
        <instancedMesh
          ref={bushesRef}
          args={[bushGeometry, bushMaterial, foliageData.bushes.length]}
          castShadow
          receiveShadow
        />
      )}

      {/* Grass blades */}
      {foliageData.grass.length > 0 && (
        <instancedMesh
          ref={grassRef}
          args={[grassGeometry, grassMaterial, foliageData.grass.length]}
          receiveShadow
        />
      )}

      {/* Ground plants */}
      {foliageData.plants.length > 0 && (
        <instancedMesh
          ref={plantsRef}
          args={[plantGeometry, plantMaterial, foliageData.plants.length]}
          receiveShadow
        />
      )}
    </group>
  );
}
