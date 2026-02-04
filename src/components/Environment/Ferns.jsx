import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { mergeBufferGeometries } from 'three-stdlib';

export default function Ferns({ transforms, biome = 'summer' }) {
    // 1. Geometry Construction
    const geometry = useMemo(() => {
        const frondCount = 7;
        const frondGeos = [];

        for(let i=0; i<frondCount; i++) {
            // Frond: Plane 0.3 width, 1.2 length, 2 width segs, 5 height segs
            const geo = new THREE.PlaneGeometry(0.3, 1.2, 2, 5);

            // Initial Translation: Move base to origin (0,0,0) so rotation works
            // Plane is centered at (0,0,0), so Y goes from -0.6 to 0.6
            // We want it from 0.0 to 1.2
            geo.translate(0, 0.6, 0);

            // Manipulation to taper and bend
             const positions = geo.attributes.position;
             const vertex = new THREE.Vector3();

             for(let k=0; k < positions.count; k++){
                 vertex.fromBufferAttribute(positions, k);

                 // Taper width based on height (Y)
                 // Y is 0 to 1.2
                 const normalizedY = vertex.y / 1.2;
                 const widthFactor = 1.0 - Math.pow(normalizedY, 0.5); // Taper to tip
                 vertex.x *= widthFactor;

                 // Curve down (parabola)
                 // Bend "out" (Z axis negative) as we go up
                 vertex.z += -Math.pow(normalizedY * 1.5, 2.0) * 0.4;

                 // Reset
                 positions.setXYZ(k, vertex.x, vertex.y, vertex.z);
             }

             // Rotate around center
             // Spread them out in a circle
             const angle = (i / frondCount) * Math.PI * 2 + (Math.random() * 0.5);
             geo.rotateY(angle);

             // Tilt out slightly from the base
             geo.rotateX(0.2);

             frondGeos.push(geo);
        }

        if (frondGeos.length === 0) return new THREE.BufferGeometry();

        const merged = mergeBufferGeometries(frondGeos);
        merged.computeVertexNormals();
        return merged;
    }, []);

    // 2. Material with Wind
    const material = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            color: '#2d5a27', // Deep forest green
            roughness: 0.8,
            side: THREE.DoubleSide,
            flatShading: true,
        });

        mat.userData.uniforms = {
            time: { value: 0 }
        };

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.time = mat.userData.uniforms.time;

            shader.vertexShader = `
                uniform float time;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>

                // Wind Animation for Ferns (Bouncy/Springy)
                float windStrength = 0.12;
                float windSpeed = 2.5;

                // Height factor: anchor at bottom
                float heightFactor = max(0.0, transformed.y);
                float bendFactor = pow(heightFactor, 2.0); // Tip moves much more

                // Multi-frequency sway
                float swayX = sin(time * windSpeed + transformed.x * 2.0) * windStrength * bendFactor;
                float swayZ = cos(time * windSpeed * 0.8 + transformed.z * 2.0) * windStrength * bendFactor;

                // Vertical bounce
                float bounce = sin(time * windSpeed * 2.0) * 0.05 * bendFactor;

                transformed.x += swayX;
                transformed.z += swayZ;
                transformed.y += bounce;
                `
            );
        };

        return mat;
    }, []);

    // Animate Uniforms
    useFrame((state) => {
        if (material.userData.uniforms) {
            material.userData.uniforms.time.value = state.clock.elapsedTime;
        }
    });

    const instances = useMemo(() => {
        if (!transforms) return [];
        return transforms.map((t, i) => {
            // Biome Colors
            // Summer: Green variations
            // Autumn: Brown/Orange variations
            let baseColor;
            if (biome === 'autumn') {
                const isGreen = Math.random() > 0.8; // Some still green
                baseColor = isGreen ? new THREE.Color('#2d5a27') : new THREE.Color('#8b4513');
                if (!isGreen) baseColor.lerp(new THREE.Color('#d2691e'), Math.random());
            } else {
                baseColor = new THREE.Color('#2d5a27');
                // Mix in some lighter greens
                baseColor.lerp(new THREE.Color('#4a7023'), Math.random() * 0.5);
            }

            const shade = 0.8 + Math.random() * 0.4;
            const color = baseColor.clone().multiplyScalar(shade);

            return {
                key: `fern-${i}`,
                position: t.position,
                rotation: t.rotation,
                scale: t.scale,
                color: color
            };
        });
    }, [transforms, biome]);

    if (!transforms || transforms.length === 0) return null;

    return (
        <Instances range={instances.length} geometry={geometry} material={material} castShadow receiveShadow>
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
