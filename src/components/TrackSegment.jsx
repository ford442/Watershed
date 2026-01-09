import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';
import FlowingWater from './FlowingWater';
import Rock from './Obstacles/Rock';
import Vegetation from './Environment/Vegetation';
import Grass from './Environment/Grass';
import FloatingDebris from './Environment/FloatingDebris';
import Driftwood from './Environment/Driftwood';
import WaterfallParticles from './Environment/WaterfallParticles';

// Simple seeded random function
const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

// Default points to keep hooks happy when inactive
const DEFAULT_POINTS = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1)];

export default function TrackSegment({
    active = false,
    id: segmentId = -1,
    points: pathPoints,
    type = 'normal',
    biome = 'summer',
    width = 35,
    particleCount = 0,
    flowSpeed = 1.0,
    treeDensity = 1.0,
    rockDensity = 'low'
}) {
    // --- Hooks (must be called unconditionally) ---

    // Load Textures from public folder
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Create the custom Wet Rock Material
    const rockMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            map: colorMap,
            normalMap: normalMap,
            roughnessMap: roughnessMap,
            aoMap: aoMap,
            side: THREE.DoubleSide,
            vertexColors: true,
        });

        mat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>
                float dryness = smoothstep(0.4, 0.8, vColor.r);
                roughnessFactor = mix(0.15, roughnessFactor, dryness);
                `
            );
        };

        return mat;
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    const safePoints = (pathPoints && pathPoints.length > 0) ? pathPoints : DEFAULT_POINTS;

    // Create the spline path
    const segmentPath = useMemo(() => {
        // Ponds use lower tension for smoother, wider curves. Waterfalls use standard.
        const tension = type === 'pond' ? 0.1 : 0.5;
        return new THREE.CatmullRomCurve3(safePoints, false, 'catmullrom', tension);
    }, [safePoints, type]);

    const pathLength = useMemo(() => {
        return segmentPath.getLength();
    }, [segmentPath]);

    // --- Dynamic Dimensions based on Type ---
    const canyonWidth = width;
    const waterWidth  = type === 'pond' ? 45 : 10;
    const waterLevel  = 0.5;

    // Derived Placement Data (Rocks, Trees, etc.)
    const placementData = useMemo(() => {
        const rocks = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const driftwood = [];

        let seed = segmentId * 1000;
        const geoLength = pathLength;
        const zSteps = Math.ceil(pathLength / 2);

        const bankStart = waterWidth / 2;

        for(let z = 0; z < zSteps; z++) {
            const t = z / zSteps;
            const zLocal = (t - 0.5) * geoLength;
            
            const pathPoint = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

            const sides = [-1, 1];
            
            for (let sideIdx = 0; sideIdx < sides.length; sideIdx++) {
                const side = sides[sideIdx];
                const isPond = type === 'pond';

                // 1. ROCKS (Large)
                const rockChanceMultipliers = { low: 0.4, high: 0.7 };
                const rockChance = isPond ? 0.3 : rockChanceMultipliers[rockDensity] || 0.4;
                if (seededRandom(seed++) > (1.0 - rockChance)) {
                    const dist = bankStart + 1 + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3;
                    yHeight += rockNoise * (0.5 + normalizedDist);

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.8 + seededRandom(seed++) * 0.8;
                    const rotation = new THREE.Euler(
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI
                    );
                    rocks.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 2. TREES
                const baseTreeChance = (biome === 'autumn' || isPond) ? 0.6 : 0.3;
                const treeChance = baseTreeChance * treeDensity;
                if (seededRandom(seed++) > (1.0 - treeChance)) {
                    const dist = bankStart + 4 + seededRandom(seed++) * 8;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
                    yHeight += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;

                    // Clamp tree height to prevent floating/sky trees
                    if (yHeight > 25) yHeight = 25 - seededRandom(seed++) * 2;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight - 0.5;

                    const scale = 1.5 + seededRandom(seed++) * 1.0;
                    const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);
                    trees.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 3. DEBRIS
                if (seededRandom(seed++) > 0.5) {
                    const dist = bankStart + seededRandom(seed++) * 2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 0.5; 
                    debris.push({ position, rotation: new THREE.Euler(), scale: new THREE.Vector3(0.3,0.3,0.3) });
                }

                // 4. GRASS
                if (seededRandom(seed++) > 0.6) {
                    const dist = bankStart + seededRandom(seed++) * 4;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 1.0;
                    grass.push({ position, rotation: new THREE.Euler(0, Math.random(), 0), scale: new THREE.Vector3(0.5,0.5,0.5) });
                }

                // 5. DRIFTWOOD
                if (seededRandom(seed++) > 0.7) {
                    const dist = bankStart + (Math.random()-0.5)*2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += 0.2;
                    driftwood.push({ position, rotation: new THREE.Euler(0, Math.random(), 0), scale: new THREE.Vector3(1,0.5,0.5) });
                }
            }
        }
        
        return { rocks, trees, debris, grass, driftwood };
    }, [segmentPath, pathLength, segmentId, canyonWidth, waterWidth, type, biome, rockDensity, treeDensity]);

    // Canyon Geometry
    const canyonGeometry = useMemo(() => {
        const segmentsX = 40;
        const segmentsZ = Math.floor(pathLength);

        const geo = new THREE.PlaneGeometry(canyonWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x; 
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);

            let yHeight = Math.pow(Math.max(0, normalizedDist), 2.5) * 12;
            
            if (distFromCenter < waterWidth / 2) {
                yHeight *= 0.1; 
            }

            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);
            
            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2) / 2.5));
            const intensity = 0.4 + 0.6 * dryness;
            color.setScalar(intensity);
            colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight);
            positions.setZ(i, point.z);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth, waterWidth]);

    // Wall Shell Geometry (Capped Height)
    const wallShellGeometry = useMemo(() => {
        const shellWidth = canyonWidth * 1.5;
        const segmentsX = 20;
        const segmentsZ = Math.floor(pathLength / 2);

        const geo = new THREE.PlaneGeometry(shellWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            
            // Capped height scaling
            let yHeight = 15 + (distFromCenter * 0.5); 
            yHeight += Math.sin(zLocal * 0.1) * 3 + Math.cos(xLocal * 0.2) * 2;

            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight - 2); 
            positions.setZ(i, point.z);
        }
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth]);

    // Water Geometry
    const waterGeometry = useMemo(() => {
        const segmentsZ = Math.floor(pathLength / 2);
        const geo = new THREE.PlaneGeometry(waterWidth, pathLength, 4, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            positions.setX(i, point.x + x);
            positions.setY(i, point.y + waterLevel);
            positions.setZ(i, point.z);
        }
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, waterWidth]);

    // Stream Data
    const streamData = useMemo(() => {
        const startPoint = segmentPath.getPoint(0);
        const tangent = segmentPath.getTangent(0).normalize();
        return { start: startPoint, direction: tangent, length: pathLength };
    }, [segmentPath, pathLength]);

    // Get position for waterfall particles (middle of segment)
    const waterfallPos = useMemo(() => {
        if (type !== 'waterfall') return null;
        return segmentPath.getPoint(0.5);
    }, [type, segmentPath]);

    // --- Early exit for inactive segments ---
    // This must come AFTER all hooks have been called.
    if (!active) {
        return null;
    }

    // Final sanity check before rendering
    if (!canyonGeometry || !waterGeometry) {
        console.log(`TrackSegment ${segmentId}: missing geometry, returning null`);
        return null;
    }

    return (
        <group name={`track-segment-${segmentId}`}>
            <RigidBody type="fixed" colliders="trimesh" friction={1} restitution={0.1}>
                <mesh geometry={canyonGeometry} receiveShadow castShadow material={rockMaterial} />
            </RigidBody>

            <mesh geometry={wallShellGeometry} receiveShadow castShadow material={rockMaterial} />

            <Rock transforms={placementData.rocks} />
            <Vegetation transforms={placementData.trees} biome={biome} />
            <Grass transforms={placementData.grass} />
            <Driftwood transforms={placementData.driftwood} />
            <Rock transforms={placementData.debris} />

            <FlowingWater 
                geometry={waterGeometry}
                flowSpeed={flowSpeed}
                baseColor={type === 'pond' ? "#1a4b6a" : "#1a6b8a"}
            />
            
            {/* Conditional Logic: Floating Debris vs Waterfall Particles */}
            {type === 'waterfall' && waterfallPos ? (
                <group position={waterfallPos}>
                    <WaterfallParticles count={particleCount} width={15} height={30} />
                </group>
            ) : (
                streamData && (
                    <FloatingDebris
                        streamStart={streamData.start}
                        streamDirection={streamData.direction}
                        streamLength={streamData.length}
                        waterLevel={waterLevel}
                        count={type === 'pond' ? 12 : 6}
                        seed={segmentId * 1000}
                    />
                )
            )}
        </group>
    );
}
