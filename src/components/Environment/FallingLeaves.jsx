import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const LEAF_PALETTES = {
  summer: ['#4a6b2f', '#6b8c42', '#3d5229', '#8f9e58'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#a04000']
};

const DUMMY_OBJ = new THREE.Object3D();

export default function FallingLeaves({ transforms, biome = 'summer', floating = false }) {
  const meshRef = useRef();

  // Create a simple leaf geometry (low poly diamond shape)
  const geometry = useMemo(() => {
    // PlaneGeometry(width, height, widthSegments, heightSegments)
    const geo = new THREE.PlaneGeometry(0.3, 0.3);
    geo.rotateX(-Math.PI / 2); // Flat on ground initially
    geo.rotateY(Math.PI / 4);  // Rotate to diamond
    return geo;
  }, []);

  // Custom Shader Material
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.8,
      side: THREE.DoubleSide,
      transparent: false,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.uniforms.uFloating = { value: floating ? 1.0 : 0.0 };

      // Inject uniforms and helpers safely
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        uniform float time;
        uniform float uFloating;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        `
      );

      // Inject position logic
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        // Get instance randomness based on initial position (instanceMatrix)
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

        float rand = hash(instancePos.xz);
        float rand2 = hash(instancePos.zx);

        vec3 worldOffset = vec3(0.0);

        if (uFloating > 0.5) {
             // --- FLOATING MODE ---
             // Bobbing up and down
             float bobSpeed = 2.0 + rand;
             float bobAmp = 0.05;
             float bob = sin(time * bobSpeed + rand * 10.0) * bobAmp;

             // Slight drift (Eddy motion)
             float driftSpeed = 0.5;
             float driftX = sin(time * driftSpeed + rand * 10.0) * 0.3;
             float driftZ = cos(time * driftSpeed * 0.8 + rand2 * 10.0) * 0.3;

             // Rotation (Slow spin)
             float spinSpeed = 0.5 + rand;
             float angle = time * spinSpeed;
             float c = cos(angle);
             float s = sin(angle);

             // Rotate around Y (Flat spin)
             vec3 p = transformed;
             vec3 pRot = p;
             pRot.x = p.x * c - p.z * s;
             pRot.z = p.x * s + p.z * c;
             transformed = pRot;

             worldOffset = vec3(driftX, bob, driftZ);

        } else {
             // --- FALLING MODE ---
             // Falling Animation
             float fallSpeed = 1.5 + rand * 2.0;
             float fallHeight = 25.0; // Total vertical loop distance

             // Calculate vertical offset
             float yOffset = -mod(time * fallSpeed + rand * 10.0, fallHeight);

             // Add tumble and sway
             float swayFreq = 1.0 + rand;
             float swayAmp = 1.0 + rand2 * 1.5;

             float swayX = sin(time * swayFreq + rand * 10.0) * swayAmp;
             float swayZ = cos(time * swayFreq * 0.8 + rand2 * 10.0) * swayAmp;

             // Tumble rotation
             float tumbleSpeed = 2.0 + rand * 3.0;
             float tumbleAngle = time * tumbleSpeed;

             float c = cos(tumbleAngle);
             float s = sin(tumbleAngle);

             // Rotate around X and Z for chaotic tumble
             vec3 p = transformed;
             vec3 pRot = p;
             pRot.y = p.y * c - p.z * s;
             pRot.z = p.y * s + p.z * c;
             p = pRot;

             pRot.x = p.x * c - p.y * s;
             pRot.y = p.x * s + p.y * c;
             p = pRot;

             transformed = p;

             // Start high up
             float startBias = 5.0;
             worldOffset = vec3(swayX, yOffset + startBias, swayZ);
        }

        transformed += worldOffset;
        `
      );

      mat.userData.shader = shader;
    };

    return mat;
  }, [floating]);

  useFrame((state) => {
    if (material.userData.shader) {
      material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;
    const palette = LEAF_PALETTES[biome] || LEAF_PALETTES.summer;
    const color = new THREE.Color();

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      // For floating leaves, we might want flat rotation, but FallingLeaves shader handles rotation.
      // We pass the base transform.
      DUMMY_OBJ.rotation.set(0, t.rotation.y, 0);
      DUMMY_OBJ.scale.copy(t.scale || new THREE.Vector3(1,1,1));
      DUMMY_OBJ.updateMatrix();

      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);

      // Random color from palette
      const hex = palette[Math.floor(Math.random() * palette.length)];
      color.set(hex);
      // Variation
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);

      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  }, [transforms, biome]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      castShadow
      receiveShadow
    />
  );
}
