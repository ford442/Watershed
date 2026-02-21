import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

export function useDriftwoodAssets() {
    const geometry = useMemo(() => {
        const geos = [];

        // 1. Main Trunk Log
        // Radius top 0.12, bottom 0.22, length 4.5
        const mainLog = new THREE.CylinderGeometry(0.12, 0.22, 4.5, 6);
        mainLog.rotateZ(Math.PI / 2 + 0.1); // Lay flat, slight tilt
        geos.push(mainLog);

        // 2. Branch 1 (Sticking out)
        const branch1 = new THREE.CylinderGeometry(0.08, 0.12, 1.5, 5);
        branch1.rotateZ(Math.PI / 4); // 45 degrees
        branch1.rotateY(0.5);
        branch1.translate(1.0, 0.5, 0.2); // Position along main log
        geos.push(branch1);

        // 3. Branch 2 (Broken stub)
        const branch2 = new THREE.CylinderGeometry(0.05, 0.1, 0.8, 5);
        branch2.rotateZ(-Math.PI / 3);
        branch2.translate(-1.2, 0.3, -0.1);
        geos.push(branch2);

        const merged = mergeBufferGeometries(geos);
        merged.computeVertexNormals();
        return merged;
    }, []);

    const material = useMemo(() => new THREE.MeshBasicMaterial({
        color: '#8c8c7a' // Greyish brown (bleached wood)
    }), []);

    return { geometry, material };
}

export function usePineconeAssets() {
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
        new THREE.MeshBasicMaterial({
          color: '#5a4a3a' // Brown pinecone color
        }),
    []);

    return { geometry, material };
}
