import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

const PALETTES = {
    summer: ['#ff4444', '#ff6600', '#ffaa00', '#ffffff'], // Red, Orange, Yellow, White
    autumn: ['#8b4513', '#d2691e', '#daa520', '#cd853f']  // Brown, Chocolate, Goldenrod, Peru
};

export default function Mushrooms({ transforms, biome = 'summer' }) {
    // 1. Geometries
    const { capGeometry, stemGeometry } = useMemo(() => {
        // Cap: Hemisphere, squashed
        // Radius 0.25, low poly (8 segments)
        const cap = new THREE.SphereGeometry(0.25, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        cap.scale(1, 0.5, 1); // Flatten
        cap.translate(0, 0.3, 0); // Move up to sit on stem

        // Stem: Cylinder
        // Radius top 0.04, bottom 0.06, height 0.35
        const stem = new THREE.CylinderGeometry(0.04, 0.06, 0.35, 5);
        stem.translate(0, 0.175, 0); // Move up so base is at 0

        cap.computeVertexNormals();
        stem.computeVertexNormals();

        return { capGeometry: cap, stemGeometry: stem };
    }, []);

    // 2. Materials
    const capMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#ffffff', // Will be tinted by instance color
        roughness: 0.8,
        flatShading: true,
    }), []);

    const stemMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#f0f0e0', // Off-white stem
        roughness: 0.9,
        flatShading: true,
    }), []);

    // 3. Instance Data
    const instances = useMemo(() => {
        if (!transforms) return [];

        const palette = PALETTES[biome] || PALETTES.summer;

        return transforms.map((t, i) => {
            const colorHex = palette[Math.floor(Math.random() * palette.length)];
            const color = new THREE.Color(colorHex);

            // Variation
            const shade = 0.9 + Math.random() * 0.2;
            color.multiplyScalar(shade);

            return {
                key: `mush-${i}`,
                position: t.position,
                rotation: t.rotation,
                scale: t.scale,
                color
            };
        });
    }, [transforms, biome]);

    if (!transforms || transforms.length === 0) return null;

    return (
        <group>
            {/* Stems */}
            <Instances range={instances.length} geometry={stemGeometry} material={stemMaterial} castShadow receiveShadow>
                 {instances.map(d => (
                     <Instance
                        key={`stem-${d.key}`}
                        position={d.position}
                        rotation={d.rotation}
                        scale={d.scale}
                     />
                 ))}
            </Instances>

            {/* Caps (Tinted) */}
            <Instances range={instances.length} geometry={capGeometry} material={capMaterial} castShadow receiveShadow>
                {instances.map(d => (
                    <Instance
                        key={`cap-${d.key}`}
                        position={d.position}
                        rotation={d.rotation}
                        scale={d.scale}
                        color={d.color}
                    />
                ))}
            </Instances>
        </group>
    );
}
