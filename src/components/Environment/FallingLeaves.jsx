import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export default function FallingLeaves({
    count = 50,
    width = 40,
    length = 40,
    height = 20,
    biome = 'summer'
}) {
    const meshRef = useRef();

    // Adjust count based on biome
    const particleCount = biome === 'autumn' ? count * 2 : count;

    // Leaf Geometry - Simple low-poly quad, slightly bent
    const geometry = useMemo(() => {
        // A simple diamond shape or quad
        const geo = new THREE.PlaneGeometry(0.4, 0.4);
        geo.rotateX(Math.PI / 4); // Angle it a bit
        return geo;
    }, []);

    // Initial transforms and attributes
    const { positions, randoms, colors } = useMemo(() => {
        const pos = new Float32Array(particleCount * 3);
        const rnd = new Float32Array(particleCount * 2); // speed, offset
        const col = new Float32Array(particleCount * 3);

        const palette = biome === 'autumn'
            ? ['#d35400', '#e67e22', '#c0392b', '#f1c40f']
            : ['#4a6f28', '#556b2f', '#6b8c42'];

        const colorObj = new THREE.Color();

        for(let i=0; i<particleCount; i++) {
            // Position
            pos[i*3] = (Math.random() - 0.5) * width;
            pos[i*3+1] = Math.random() * height;
            pos[i*3+2] = (Math.random() - 0.5) * length;

            // Randoms
            rnd[i*2] = 0.5 + Math.random() * 1.5; // speed
            rnd[i*2+1] = Math.random() * 100; // phase offset

            // Color
            const hex = palette[Math.floor(Math.random() * palette.length)];
            colorObj.set(hex);
            // Slight variation
            colorObj.multiplyScalar(0.8 + Math.random() * 0.4);

            col[i*3] = colorObj.r;
            col[i*3+1] = colorObj.g;
            col[i*3+2] = colorObj.b;
        }
        return { positions: pos, randoms: rnd, colors: col };
    }, [particleCount, width, length, height, biome]);

    // Custom Shader Material
    const material = useMemo(() => {
        const mat = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthWrite: false, // Particles shouldn't occlude each other too harshly
        });

        mat.userData.uniforms = {
            time: { value: 0 },
            uHeight: { value: height }
        };

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.time = mat.userData.uniforms.time;
            shader.uniforms.uHeight = mat.userData.uniforms.uHeight;

            shader.vertexShader = `
                uniform float time;
                uniform float uHeight;
                attribute vec2 aRandom;
                attribute vec3 aPos;
                attribute vec3 aColor;
                varying vec3 vColor;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                vec3 transformed = vec3( position );

                float speed = aRandom.x;
                float offset = aRandom.y;

                // Falling motion (Looping)
                // We calculate y wrapping around uHeight
                float h = uHeight + 5.0; // Buffer to prevent popping
                float y = mod(aPos.y - time * speed, h);

                // Add swaying
                float swayX = sin(time * 1.5 + offset) * 0.5;
                float swayZ = cos(time * 1.2 + offset) * 0.5;

                // Add tumbling
                float rotX = time * 2.0 + offset;
                float rotY = time * 1.0 + offset;

                float cx = cos(rotX), sx = sin(rotX);
                float cy = cos(rotY), sy = sin(rotY);

                // Rotation matrix
                mat3 rotate = mat3(
                    cy, 0.0, sy,
                    0.0, 1.0, 0.0,
                    -sy, 0.0, cy
                ) * mat3(
                    1.0, 0.0, 0.0,
                    0.0, cx, -sx,
                    0.0, sx, cx
                );

                transformed = rotate * transformed;

                // Final position: original X/Z + sway, calculated Y
                // Center Y around [0, height] or shift it down?
                // The particle system is usually placed at center.
                // Let's assume the particle block is centered at Y=height/2.
                // But aPos.y is [0, height].
                // So y is [0, height+buffer].
                // We want to center it.

                transformed.x += aPos.x + swayX;
                transformed.y += y - (uHeight / 2.0);
                transformed.z += aPos.z + swayZ;

                vColor = aColor;
                `
            );

            shader.fragmentShader = `
                varying vec3 vColor;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                'vec4 diffuseColor = vec4( diffuse, opacity );',
                'vec4 diffuseColor = vec4( vColor, opacity );'
            );
        };

        return mat;
    }, [height]);

    useFrame((state) => {
        if (material.userData.uniforms) {
            material.userData.uniforms.time.value = state.clock.elapsedTime;
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, particleCount]}>
             <instancedBufferAttribute attach="attributes-aPos" args={[positions, 3]} />
             <instancedBufferAttribute attach="attributes-aRandom" args={[randoms, 2]} />
             <instancedBufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        </instancedMesh>
    );
}
