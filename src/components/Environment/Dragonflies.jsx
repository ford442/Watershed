import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

const DUMMY_OBJ = new THREE.Object3D();

export default function Dragonflies({ transforms }) {
  const meshRef = useRef();

  // Procedural Dragonfly Geometry
  const geometry = useMemo(() => {
    const geometries = [];

    // 1. Body (Thin Cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.02, 0.01, 0.5, 6);
    bodyGeo.rotateX(Math.PI / 2); // Align with Z axis (forward)
    geometries.push(bodyGeo);

    // 2. Head (Small Sphere)
    const headGeo = new THREE.SphereGeometry(0.04, 8, 6);
    headGeo.translate(0, 0, 0.25); // Move to front
    geometries.push(headGeo);

    // 3. Wings (4 Planes)
    // Front Left
    const flWing = new THREE.PlaneGeometry(0.5, 0.12);
    flWing.translate(0.25, 0, 0); // Pivot at edge
    flWing.rotateX(-Math.PI / 2); // Flat
    flWing.rotateY(-0.2); // Angle back slightly
    flWing.translate(0, 0.02, 0.1); // Position on body
    geometries.push(flWing);

    // Front Right
    const frWing = new THREE.PlaneGeometry(0.5, 0.12);
    frWing.translate(0.25, 0, 0);
    frWing.rotateX(-Math.PI / 2);
    frWing.rotateY(-0.2);
    frWing.rotateZ(Math.PI); // Mirror
    frWing.translate(0, 0.02, 0.1);
    geometries.push(frWing);

    // Back Left
    const blWing = new THREE.PlaneGeometry(0.4, 0.1);
    blWing.translate(0.2, 0, 0);
    blWing.rotateX(-Math.PI / 2);
    blWing.rotateY(-0.1);
    blWing.translate(0, 0.02, -0.05);
    geometries.push(blWing);

    // Back Right
    const brWing = new THREE.PlaneGeometry(0.4, 0.1);
    brWing.translate(0.2, 0, 0);
    brWing.rotateX(-Math.PI / 2);
    brWing.rotateY(-0.1);
    brWing.rotateZ(Math.PI);
    brWing.translate(0, 0.02, -0.05);
    geometries.push(brWing);

    if (geometries.length === 0) return new THREE.BufferGeometry();

    const merged = mergeBufferGeometries(geometries);
    merged.computeVertexNormals();
    return merged;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#00cccc', // Cyan base
      roughness: 0.2,
      metalness: 0.8,
      side: THREE.DoubleSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = { value: 0 };
      shader.vertexShader = 'uniform float time;\n' + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>

        // Randomness
        float seed = dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 54.53));
        float rand = fract(sin(seed) * 43758.5453);

        // --- ANIMATION ---

        // 1. Wing Flapping (High Frequency)
        // Wings are roughly at |x| > 0.05
        float flapFreq = 50.0 + rand * 10.0;
        float flapAmp = 0.2;

        // Detect wings by X position (body is thin)
        if (abs(position.x) > 0.03) {
            float flap = sin(time * flapFreq);
            transformed.y += flap * flapAmp * (abs(position.x) * 2.0); // Tip moves more
        }

        // 2. Hovering / Darting Movement
        // Noise-like movement using sines
        float moveSpeed = 1.5 + rand;
        float moveRad = 0.5 + rand * 0.5;

        vec3 offset = vec3(0.0);
        offset.x = sin(time * moveSpeed + rand * 10.0) * moveRad;
        offset.y = sin(time * moveSpeed * 2.0 + rand * 20.0) * 0.2; // Less vertical
        offset.z = cos(time * moveSpeed * 0.8 + rand * 5.0) * moveRad;

        // Apply movement (View Space or World Space?)
        // Applying to transformed means it rotates with instance.
        // That's fine for hovering.
        transformed += offset;

        // 3. Orientation Banking (Subtle)
        // Bank into the turn (based on X movement derivative roughly)
        float bankAngle = cos(time * moveSpeed + rand * 10.0) * 0.2;

        // Rotate Z
        float c = cos(bankAngle);
        float s = sin(bankAngle);
        vec3 p = transformed;
        transformed.x = p.x * c - p.y * s;
        transformed.y = p.x * s + p.y * c;
        `
      );

      // Fragment Shader for Iridescence
      shader.fragmentShader = `
        uniform float time;
        varying vec3 vViewPosition;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>

        // Iridescence Logic
        // Calculate view direction
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = dot(viewDir, normal);
        fresnel = clamp(1.0 - abs(fresnel), 0.0, 1.0); // Edges glow

        // Color Shift: Cyan -> Purple -> Green
        vec3 iriColor = mix(vec3(0.0, 1.0, 1.0), vec3(0.8, 0.0, 1.0), fresnel);
        iriColor = mix(iriColor, vec3(0.2, 1.0, 0.2), fresnel * fresnel);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, iriColor, 0.5);
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
      DUMMY_OBJ.rotation.copy(t.rotation || new THREE.Euler());
      DUMMY_OBJ.scale.copy(t.scale || new THREE.Vector3(1, 1, 1));
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
      frustumCulled={false} // Movement pushes them out of bounds
    />
  );
}
