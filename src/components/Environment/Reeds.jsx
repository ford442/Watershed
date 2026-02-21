import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';

export default function Reeds({ transforms }) {
  // Geometry: Cluster of Cattails/Reeds
  const geometry = useMemo(() => {
    try {
        const geos = [];
        const count = 5; // Reeds per clump

        for (let i = 0; i < count; i++) {
            // Random offsets for this reed within the clump
            const offsetX = (Math.random() - 0.5) * 0.6;
            const offsetZ = (Math.random() - 0.5) * 0.6;
            const height = 1.2 + Math.random() * 0.8;
            const tiltX = (Math.random() - 0.5) * 0.2;
            const tiltZ = (Math.random() - 0.5) * 0.2;

            // Stalk
            const stalkRadius = 0.02;
            const stalkGeo = new THREE.CylinderGeometry(stalkRadius, stalkRadius, height, 4);
            stalkGeo.translate(0, height / 2, 0); // Base at 0

            // Tilt
            stalkGeo.rotateX(tiltX);
            stalkGeo.rotateZ(tiltZ);

            // Move to offset
            stalkGeo.translate(offsetX, 0, offsetZ);
            geos.push(stalkGeo);

            // Cattail Head (Brown part) - on 60% of reeds
            if (Math.random() > 0.4) {
                const headHeight = 0.3;
                const headRadius = 0.06;
                const headGeo = new THREE.CylinderGeometry(headRadius, headRadius, headHeight, 5);
                // Position near top
                const headY = height - 0.15;
                headGeo.translate(0, headY, 0);

                // Apply same tilt/offset
                headGeo.rotateX(tiltX);
                headGeo.rotateZ(tiltZ);
                headGeo.translate(offsetX, 0, offsetZ);

                geos.push(headGeo);
            }
        }

        if (geos.length === 0) return new THREE.BufferGeometry();

        const merged = mergeBufferGeometries(geos);
        if (!merged) return new THREE.BufferGeometry();

        merged.computeVertexNormals();
        return merged;
    } catch (e) {
        console.error("Error creating Reeds geometry:", e);
        return new THREE.BoxGeometry(0.1, 1, 0.1); // Fallback
    }
  }, []);

  // Material: Green/Brown with Wind
  const reedsMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
        color: '#4a6b3c' // Swampy green
    });
    return mat;
  }, []);

  const instances = useMemo(() => {
      if (!transforms) return [];
      return transforms.map((t, i) => {
          const isDry = Math.random() > 0.7;
          const baseColor = isDry ? new THREE.Color('#8b7e60') : new THREE.Color('#4a6b3c');
          const shade = 0.8 + Math.random() * 0.4;
          const color = baseColor.multiplyScalar(shade);

          return {
              key: `reeds-${i}`,
              position: t.position,
              rotation: t.rotation,
              scale: t.scale,
              color: color
          };
      });
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
      <Instances range={instances.length} geometry={geometry} material={reedsMaterial} castShadow receiveShadow>
          {instances.map((data) => (
              <Instance
                  key={data.key}
                  position={data.position}
                  rotation={data.rotation}
                  scale={data.scale}
                  color={data.color}
              />
          ))}
      </Instances>
  );
}
