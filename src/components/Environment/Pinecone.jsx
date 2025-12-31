import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

/**
 * Pinecone - Realistic pinecone geometry for creek environment
 * Creates a simple but recognizable pinecone shape using cones and spheres
 * 
 * @param {Array} transforms - Array of {position, rotation, scale} objects
 */
export default function Pinecone({ transforms }) {
  // Create a simple pinecone geometry using a cone with bumpy texture
  const geometry = useMemo(() => {
    // Create a cone for the basic pinecone shape
    const coneGeo = new THREE.ConeGeometry(0.3, 0.8, 8, 4);
    
    // Modify vertices to create scale-like bumps
    const positions = coneGeo.attributes.position;
    const vertex = new THREE.Vector3();
    
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      
      // Create bumpy surface to simulate scales
      const angle = Math.atan2(vertex.x, vertex.z);
      const heightFactor = (vertex.y + 0.4) / 0.8; // Normalized height
      
      // Add radial bumps that spiral around
      const bumpFrequency = 8;
      const bump = Math.sin(angle * bumpFrequency + heightFactor * Math.PI * 4) * 0.05;
      
      const direction = new THREE.Vector3(vertex.x, 0, vertex.z).normalize();
      vertex.add(direction.multiplyScalar(bump));
      
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    coneGeo.computeVertexNormals();
    return coneGeo;
  }, []);

  const material = useMemo(() => 
    new THREE.MeshStandardMaterial({ 
      color: '#5a4a3a', // Brown pinecone color
      roughness: 0.9,
      metalness: 0.1,
    }), 
  []);

  if (!transforms || transforms.length === 0) return null;

  return (
    <Instances range={transforms.length} geometry={geometry} material={material}>
      {transforms.map((t, i) => (
        <Instance
          key={i}
          position={t.position}
          rotation={t.rotation}
          scale={t.scale}
          castShadow
          receiveShadow
        />
      ))}
    </Instances>
  );
}
