import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';

const PALETTES = {
    summer: ['#ff4444', '#ff6600', '#ffaa00', '#ffffff'], // Red, Orange, Yellow, White
    autumn: ['#8b4513', '#d2691e', '#daa520', '#cd853f']  // Brown, Chocolate, Goldenrod, Peru
};

const CAP_TYPES = ['button', 'table', 'young'];

const hash = (n) => {
    const x = Math.sin(n * 5.371) * 43758.5453;
    return x - Math.floor(x);
};

export default function Mushrooms({ transforms, biome = 'summer' }) {
    // 1. Geometries - several cap silhouettes + a gill disc tucked underneath
    const { capGeometries, stemGeometries, gillGeometry } = useMemo(() => {
        // Button: classic squashed hemisphere
        const button = new THREE.SphereGeometry(0.25, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        button.scale(1, 0.5, 1);
        button.translate(0, 0.3, 0);

        // Table: wide, flatter cap on a shorter stem - shelf-fungus look
        const table = new THREE.SphereGeometry(0.34, 9, 8, 0, Math.PI * 2, 0, Math.PI / 2.6);
        table.scale(1, 0.32, 1);
        table.translate(0, 0.22, 0);

        // Young: tall conical cap, not yet opened
        const young = new THREE.ConeGeometry(0.16, 0.32, 7);
        young.translate(0, 0.42, 0);

        // Stems: matched heights per cap type
        const stemButton = new THREE.CylinderGeometry(0.04, 0.06, 0.35, 5).translate(0, 0.175, 0);
        const stemTable = new THREE.CylinderGeometry(0.05, 0.07, 0.24, 5).translate(0, 0.12, 0);
        const stemYoung = new THREE.CylinderGeometry(0.035, 0.045, 0.42, 5).translate(0, 0.21, 0);

        // Gill disc - thin dark disc just under the cap rim, hints at gill structure
        const gill = new THREE.CylinderGeometry(0.21, 0.24, 0.015, 9);

        [button, table, young, stemButton, stemTable, stemYoung, gill].forEach((g) => g.computeVertexNormals());

        return {
            capGeometries: { button, table, young },
            stemGeometries: { button: stemButton, table: stemTable, young: stemYoung },
            gillGeometry: gill,
        };
    }, []);

    // 2. Materials
    const capMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#ffffff', // Will be tinted by instance color
        roughness: 0.7,
        metalness: 0,
    }), []);

    const stemMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#e8e8d8', // Off-white stem
        roughness: 0.90,
        metalness: 0,
    }), []);

    const gillMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#3a2a28', // Dark gill underside
        roughness: 0.95,
        metalness: 0,
    }), []);

    // 3. Instance Data, grouped by cap shape so each gets the right geometry
    const instancesByCap = useMemo(() => {
        const grouped = { button: [], table: [], young: [] };
        if (!transforms) return grouped;

        const palette = PALETTES[biome] || PALETTES.summer;

        transforms.forEach((t, i) => {
            const seed = t.position.x * 0.41 + t.position.z * 0.37 + i * 1.91;
            const capType = CAP_TYPES[Math.floor(hash(seed) * CAP_TYPES.length)];

            const colorHex = palette[Math.floor(hash(seed + 3.3) * palette.length)];
            const color = new THREE.Color(colorHex);
            const shade = 0.9 + hash(seed + 1.7) * 0.2;
            color.multiplyScalar(shade);

            // Gill disc sits just under the cap, scaled with the cap's footprint
            const capScaleY = capType === 'table' ? 0.22 : capType === 'young' ? 0.26 : 0.3;
            const gillPosition = t.position.clone();
            gillPosition.y += capScaleY * (t.scale?.y ?? 1);

            grouped[capType].push({
                key: `mush-${i}`,
                position: t.position,
                gillPosition,
                rotation: t.rotation,
                scale: t.scale,
                color,
            });
        });

        return grouped;
    }, [transforms, biome]);

    if (!transforms || transforms.length === 0) return null;

    return (
        <group>
            {CAP_TYPES.map((capType) => {
                const instances = instancesByCap[capType];
                if (!instances.length) return null;

                return (
                    <group key={capType}>
                        {/* Stems */}
                        <Instances range={instances.length} geometry={stemGeometries[capType]} material={stemMaterial} castShadow receiveShadow>
                            {instances.map(d => (
                                <Instance
                                    key={`stem-${d.key}`}
                                    position={d.position}
                                    rotation={d.rotation}
                                    scale={d.scale}
                                />
                            ))}
                        </Instances>

                        {/* Gill discs - dark underside detail */}
                        <Instances range={instances.length} geometry={gillGeometry} material={gillMaterial} receiveShadow>
                            {instances.map(d => (
                                <Instance
                                    key={`gill-${d.key}`}
                                    position={d.gillPosition}
                                    rotation={d.rotation}
                                    scale={d.scale}
                                />
                            ))}
                        </Instances>

                        {/* Caps (Tinted) */}
                        <Instances range={instances.length} geometry={capGeometries[capType]} material={capMaterial} castShadow receiveShadow>
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
            })}
        </group>
    );
}
