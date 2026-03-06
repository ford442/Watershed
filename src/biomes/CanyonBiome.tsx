import React, { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useFrame, useThree } from '@react-three/fiber';
import { DefaultMapManager, BaseMapChunk } from '../systems/MapSystem';

/**
 * CanyonBiome.tsx - refactored from original CreekCanyon.jsx
 *
 * This component keeps the exact same visual track as before but
 * is driven by the standardized MapSystem.  Chunks are generated
 * ahead/behind the player and reused via pooling; water and objects
 * are plugged in separately.
 *
 * // RAPTOR-MINI: biome authors can subclass DefaultMapManager and
 * override generateChunk() to tweak appearance.
 */

export default function CanyonBiome({ playerRef }: { playerRef?: any }) {
    const mapRef = useRef(new DefaultMapManager());
    const [chunks, setChunks] = useState<BaseMapChunk[]>(mapRef.current.chunks);
    const { camera } = useThree();

    useFrame((state, delta) => {
        const pos = new THREE.Vector3();
        if (playerRef?.current && playerRef.current.translation) {
            const p = playerRef.current.translation();
            pos.set(p.x, p.y, p.z);
        } else {
            pos.copy(camera.position);
        }

        mapRef.current.update(pos);
        const newChunks = mapRef.current.chunks;
        if (newChunks !== chunks) setChunks([...newChunks]);
    });

    return (
        <group>
            {chunks.map(chunk => (
                <BiomeChunk key={chunk.id} chunk={chunk} />
            ))}
        </group>
    );
}

interface BiomeChunkProps {
    chunk: BaseMapChunk;
}

function BiomeChunk({ chunk }: BiomeChunkProps) {
    // compute orientation from path tangent so meanders line up
    const quaternion = useMemo(() => {
        if (chunk.curve) {
            const tan = chunk.curve.getTangent(0.5).normalize();
            const angle = Math.atan2(tan.x, tan.z);
            return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        }
        return new THREE.Quaternion();
    }, [chunk.curve]);

    const geom = useMemo(() => {
        const width = chunk.canyonWidth;
        const length = chunk.length;
        const segX = 20;
        const segZ = 40;
        const geo = new THREE.PlaneGeometry(width, length, segX, segZ);
        geo.rotateX(-Math.PI / 2);
        const posAttr = geo.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
            v.fromBufferAttribute(posAttr, i);
            const x = v.x;
            const z = v.z;
            const normalizedDist = Math.abs(x) / (width / 2);
            let y = Math.pow(normalizedDist, 2.5) * 12;
            y += Math.sin(z * 0.15) * Math.cos(x * 0.3) * 1.5 * normalizedDist;
            y += (Math.random() - 0.5) * 0.2;
            y -= z * 0.02;
            posAttr.setY(i, y);
        }
        geo.setAttribute('uv2', geo.attributes.uv.clone());
        geo.computeVertexNormals();
        return geo;
    }, [chunk.canyonWidth, chunk.length]);

    return (
        <group position={chunk.position.toArray()} quaternion={quaternion}>
            <RigidBody type="fixed" colliders="trimesh">
                <mesh geometry={geom} receiveShadow castShadow>
                    <meshStandardMaterial
                        color={0x886644}
                        roughness={0.85}
                        metalness={0.05}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            </RigidBody>

            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, chunk.waterLevel, 0]}>
                {/* simple water plane, WaterSystem may later control this */}
                <planeGeometry args={[chunk.waterWidth, chunk.length]} />
                <meshStandardMaterial color="#1a6b8a" transparent opacity={0.6} />
            </mesh>
        </group>
    );
}
