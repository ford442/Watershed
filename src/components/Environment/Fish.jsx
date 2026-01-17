import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
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
        const mat = new THREE.MeshStandardMaterial({
            color: '#aaddff', // Silvery Blue
            metalness: 0.6,
            roughness: 0.3,
            side: THREE.DoubleSide
        });

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.time = { value: 0 };
            shader.vertexShader = 'uniform float time;\n' + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>

                // Instance Randomness
                float seed = dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164));
                float rand = fract(sin(seed) * 43758.5453);

                // Animation Parameters
                float jumpInterval = 6.0 + rand * 10.0; // Frequent jumps for liveness (6-16s)
                float timeOffset = rand * 100.0;
                float localTime = mod(time + timeOffset, jumpInterval);
                float jumpDur = 1.2; // Duration of jump in seconds

                // Wiggle Animation
                float wiggleSpeed = 20.0;
                float wiggleAmp = 0.15;
                // Wiggle tails (Z < 0 is tail)
                float wiggle = sin(time * wiggleSpeed - transformed.z * 3.0) * wiggleAmp;
                // Apply wiggle primarily to tail
                transformed.x += wiggle * step(0.0, -transformed.z);

                // Jump Logic
                if (localTime < jumpDur) {
                    float t = localTime / jumpDur; // 0.0 to 1.0

                    // Parabolic Arc: y = 4h * t * (1-t)
                    float jumpHeight = 1.5 + rand * 1.5;
                    float yOffset = jumpHeight * 4.0 * t * (1.0 - t);

                    // Forward motion
                    float forwardDist = 3.0 + rand * 2.0;
                    float zOffset = (t - 0.5) * forwardDist;

                    // Pitch Rotation (Head follows arc)
                    // Slope = dy/dz
                    // dy/dt = jumpHeight * 4 * (1 - 2t)
                    // dz/dt = forwardDist
                    float slope = (jumpHeight * 4.0 * (1.0 - 2.0 * t)) / forwardDist;
                    float pitchAngle = atan(slope);

                    // Rotate around X axis
                    float c = cos(pitchAngle);
                    float s = sin(pitchAngle);

                    vec3 p = transformed;
                    transformed.y = p.y * c - p.z * s;
                    transformed.z = p.y * s + p.z * c;

                    // Apply translation
                    transformed.y += yOffset - 0.5; // Start/End underwater
                    transformed.z -= zOffset; // Move forward (negative Z is forward in my orientation usually, but let's check)
                    // If Z+ is forward, then += zOffset. Let's assume Z+ is forward for now.
                    // Actually, usually Z- is forward in ThreeJS.
                    // Let's just say += zOffset and rely on Instance rotation.

                } else {
                    // Hide underwater
                    transformed.y = -50.0;
                    transformed.scale *= 0.001;
                }
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
