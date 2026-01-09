import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const LEAF_PALETTES = {
  summer: ['#4a6b2f', '#6b8c42', '#3d5229', '#8f9e58'],
  autumn: ['#d35400', '#e67e22', '#f1c40f', '#c0392b', '#a04000']
};

const DUMMY_OBJ = new THREE.Object3D();

export default function FallingLeaves({ transforms, biome = 'summer' }) {
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
      transparent: true, // Need transparency if we wanted alpha, but here mostly for softness?
      // Actually standard opaque is better for performance, but leaves might need alpha test
      // Let's stick to opaque for performance unless needed
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };

      // Inject uniforms
      shader.vertexShader = `
        uniform float time;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      ` + shader.vertexShader;

      // Inject position logic
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        // Get instance randomness based on initial position (instanceMatrix)
        // We use the instance's translation from the matrix
        vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

        float rand = hash(instancePos.xz);
        float rand2 = hash(instancePos.zx);

        // Falling Animation
        float fallSpeed = 1.5 + rand * 2.0;
        float fallHeight = 25.0; // Total vertical loop distance

        // Calculate vertical offset
        // We subtract time to fall down
        float yOffset = -mod(time * fallSpeed + rand * 10.0, fallHeight);

        // Add tumble and sway
        float swayFreq = 1.0 + rand;
        float swayAmp = 1.0 + rand2 * 1.5;

        float swayX = sin(time * swayFreq + rand * 10.0) * swayAmp;
        float swayZ = cos(time * swayFreq * 0.8 + rand2 * 10.0) * swayAmp;

        // Tumble rotation (modifying local position)
        float tumbleSpeed = 2.0 + rand * 3.0;
        float tumbleAngle = time * tumbleSpeed;

        float c = cos(tumbleAngle);
        float s = sin(tumbleAngle);

        // Rotate around X and Z for chaotic tumble
        // Simple 2D rotation matrix application on local coords
        // Rotate X
        vec3 p = transformed;
        vec3 pRot = p;
        pRot.y = p.y * c - p.z * s;
        pRot.z = p.y * s + p.z * c;
        p = pRot;

        // Rotate Z
        pRot.x = p.x * c - p.y * s;
        pRot.y = p.x * s + p.y * c;
        p = pRot;

        transformed = p;

        // Apply Global Offset
        // We apply this to the transformed vertex, effectively moving the instance
        // Note: This moves the mesh RELATIVE to the instance matrix position.
        // Since we want the leaves to fall FROM the sky, the 'transforms' passed in
        // should be the "center" or "spawn" point.

        // Start high up (relative to placement)
        // If placement is at Y=15, we want to fall from say +5 to -20 relative to that
        float startBias = 5.0;

        vec3 worldOffset = vec3(swayX, yOffset + startBias, swayZ);

        // Transform is applied in local space of instance, but before View Matrix
        // Ideally we want to offset in World Space.
        // Standard material: transformed -> instanceMatrix -> modelViewMatrix
        // So if we add to transformed, it gets rotated by instanceMatrix.
        // Since we pass identity rotation mostly (or simple Y rot), this is fine.
        // If instances have random rotation, the 'down' direction would change!
        // We must correct for this if inputs have rotation.

        // Assuming inputs have random Y rotation only:
        // Then local Y is world Y.
        // Local X/Z are rotated.
        // If we want absolute world Sway, we need to inverse rotate or just accept local sway.
        // Local sway is fine, it just means they sway in different directions.

        transformed += worldOffset;
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

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;
    const palette = LEAF_PALETTES[biome] || LEAF_PALETTES.summer;
    const color = new THREE.Color();

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      // We force rotation to be identity or just Y rotation to ensure 'down' is down
      // But TrackSegment passes full Euler.
      // If TrackSegment passes random rotations, our "Y down" logic in shader will be wrong
      // if the instance is rotated 90deg or 180deg on X/Z.
      // So we should OVERRIDE rotation here to be simple Y axis rotation.
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
      castShadow // Leaves cast shadows!
    />
  );
}
