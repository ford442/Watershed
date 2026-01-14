import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function Birds({ transforms, biome = 'summer' }) {
  const meshRef = useRef();

  // Simple Bird Geometry: Two triangles forming a V
  // Use useMemo to create it only once
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
       // Left Wing
       0.0, 0, 0.2,    // Body Center (Tail-ish)
       0.0, 0, -0.3,   // Head
       1.2, 0, 0.0,    // Left Wing Tip

       // Right Wing
       0.0, 0, 0.2,    // Body Center
       -1.2, 0, 0.0,   // Right Wing Tip
       0.0, 0, -0.3    // Head
    ]);

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#eeeeee',
      roughness: 0.5,
      side: THREE.DoubleSide
    });

    mat.onBeforeCompile = (shader) => {
        shader.uniforms.time = { value: 0 };
        shader.vertexShader = 'uniform float time;\n' + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>

            // Random based on instance position
            float rand = sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 54.53))) * 43758.5453;
            float birdSpeed = 0.8 + fract(rand) * 0.4;

            // Flapping Animation
            // Wing tips are far from X center
            float flapPhase = time * 12.0 * birdSpeed + rand * 10.0;
            float flap = sin(flapPhase);

            // Apply flap to wing tips
            if (abs(position.x) > 0.1) {
                transformed.y += flap * 0.4;
            }
            // Slight body bob
            transformed.y += sin(flapPhase) * 0.1;

            // Circling Movement Logic
            // We define a center point (the instance position) and orbit it
            float radius = 15.0 + fract(rand * 1.5) * 15.0;
            float angle = time * 0.3 * birdSpeed + rand * 100.0;

            float circleX = cos(angle) * radius;
            float circleZ = sin(angle) * radius;

            // Rotation to face forward (tangent to circle)
            // Tangent direction is (-sin, cos)
            float rotAngle = -angle;
            float rc = cos(rotAngle);
            float rs = sin(rotAngle);

            // Rotate the bird mesh itself
            vec3 rotatedPos;
            rotatedPos.x = transformed.x * rc - transformed.z * rs;
            rotatedPos.y = transformed.y;
            rotatedPos.z = transformed.x * rs + transformed.z * rc;

            // Apply orbital offset
            rotatedPos.x += circleX;
            rotatedPos.z += circleZ;

            // Vertical soaring motion (sine wave on circle)
            rotatedPos.y += sin(angle * 2.0) * 5.0 + 20.0; // Fly high (20 units up + variation)

            transformed = rotatedPos;
            `
        );
        mat.userData.shader = shader;
    };
    return mat;
  }, []);

  useFrame((state) => {
    if (material.userData.shader) {
        material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  useEffect(() => {
     if (!meshRef.current || !transforms) return;
     transforms.forEach((t, i) => {
         DUMMY_OBJ.position.copy(t.position);
         DUMMY_OBJ.rotation.set(0,0,0);
         DUMMY_OBJ.scale.setScalar(1);
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
        frustumCulled={false} // Important: Birds move away from their bounding box
    />
  );
}
