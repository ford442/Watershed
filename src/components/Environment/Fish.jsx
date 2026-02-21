import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Fish({ transforms }) {
    const meshRef = useRef();

    // Procedural Fish Geometry: Low Poly Octahedron
    const geometry = useMemo(() => {
        const geo = new THREE.OctahedronGeometry(0.5, 0);
        // Scale to look like a fish: Long Z, Medium Y, Thin X
        geo.scale(0.2, 0.4, 1.0);
        // Rotate so Z is forward? Default octahedron points are on axes.
        // Let's ensure it "looks" forward.
        geo.rotateX(-Math.PI / 2); // Rotate to align better if needed, but Octahedron is symmetrical.
        // Actually Octahedron vertices are at +/- radius on axes.
        // Scaling X=0.2 (width), Y=0.4 (height), Z=1.0 (length) makes a nice diamond fish.

        geo.computeVertexNormals();
        return geo;
    }, []);

    const material = useMemo(() => {
        const mat = new THREE.MeshBasicMaterial({
            color: '#aaddff' // Silvery Blue
        });
        return mat;
    }, []);

    useEffect(() => {
        if (!meshRef.current || !transforms) return;
        transforms.forEach((t, i) => {
            DUMMY_OBJ.position.copy(t.position);
            DUMMY_OBJ.rotation.copy(t.rotation);
            DUMMY_OBJ.scale.setScalar(t.scale?.x || 1);
            DUMMY_OBJ.updateMatrix();
            meshRef.current.setMatrixAt(i, DUMMY_OBJ.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [transforms]);

    if (!transforms || transforms.length === 0) return null;

    return (
        <instancedMesh
            ref={meshRef}
            args={[geometry, material, transforms.length]}
            frustumCulled={false}
        />
    );
}
